from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

try:
    from .bounded_work import *
    from .core_commands import *
    from .core_commands import _command_lit_dispatch, _escape_command_content, _join_positional
    from .core_contexts import *
    from .core_contexts import (
        BROWSER_IDENTITY_BLOCKER,
        _SKILL_ROUTE_CONTRACTS,
        _probe_browser_driver_report as _browser_drive_probe_report,
    )
    from .core_contract import *
    from .core_contract import _post_edit_skill_names, _skill_body, _skill_body_block
    from .core_plans import *
    from .core_plans import _CRITERION_PATTERN
    from .core_recap_command import *
    from .core_recap_command import _recap_render_options, _recap_safe_value
    from .core_recap_state import *
    from .core_recap_state import _recap_item, _recap_run_completions, _recap_tech_kind
    from .core_review import *
    from .core_review import _run_git
    from .core_routing import *
    from .core_routing import _after_mode_word, _after_start_work, _extract_bind_goal, _extract_run_context_task, _normalized_exact_phrase
    from .core_runs import *
    from .core_runs import _same_plan_path
    from .core_runtime import *
    from .core_runtime import _clamp_task, _redact_local_only_preview
    from .core_workflow_commands import *
    from .session_context import is_delegate_child_platform
except (ImportError, ModuleNotFoundError):
    from bounded_work import *
    from core_commands import *
    from core_commands import _command_lit_dispatch, _escape_command_content, _join_positional
    from core_contexts import *
    from core_contexts import (
        BROWSER_IDENTITY_BLOCKER,
        _SKILL_ROUTE_CONTRACTS,
        _probe_browser_driver_report as _browser_drive_probe_report,
    )
    from core_contract import *
    from core_contract import _post_edit_skill_names, _skill_body, _skill_body_block
    from core_plans import *
    from core_plans import _CRITERION_PATTERN
    from core_recap_command import *
    from core_recap_command import _recap_render_options, _recap_safe_value
    from core_recap_state import *
    from core_recap_state import _recap_item, _recap_run_completions, _recap_tech_kind
    from core_review import *
    from core_review import _run_git
    from core_routing import *
    from core_routing import _after_mode_word, _after_start_work, _extract_bind_goal, _extract_run_context_task, _normalized_exact_phrase
    from core_runs import *
    from core_runs import _same_plan_path
    from core_runtime import *
    from core_runtime import _clamp_task, _redact_local_only_preview
    from core_workflow_commands import *
    from session_context import is_delegate_child_platform

# The rules engine is a subpackage, so it is imported separately from the flat
# star-imports above: it must not leak its module names into this facade.
try:
    from . import rules as _rules
except (ImportError, ModuleNotFoundError):
    import rules as _rules

try:
    from . import auto_update as _auto_update
except (ImportError, ModuleNotFoundError):
    import auto_update as _auto_update

try:
    from . import output_styles as _output_styles
except (ImportError, ModuleNotFoundError):
    import output_styles as _output_styles

try:
    from . import provider_metrics as _provider_metrics
except (ImportError, ModuleNotFoundError):
    import provider_metrics as _provider_metrics

try:
    from . import motion_receipts as _motion_receipts
except (ImportError, ModuleNotFoundError):
    import motion_receipts as _motion_receipts

try:
    from . import deliverable_hedge_guard as _deliverable_hedges
except (ImportError, ModuleNotFoundError):
    import deliverable_hedge_guard as _deliverable_hedges

# Current-turn state stays in the compatibility facade because tests and the
# plugin register surface intentionally inspect it directly.
_PENDING_IGNITE: set[str] = set()
_PENDING_DISCIPLINE: dict[str, str] = {}
_PENDING_BLOCK: dict[str, str] = {}
# Mutated paths observed by post_tool_call, keyed by session, drained by the next
# pre_llm_call. Bounded so an abandoned or delegate-child session cannot grow it.
_PENDING_POST_EDIT: dict[str, list[str]] = {}
_MAX_POST_EDIT_SESSIONS = 64
_MAX_POST_EDIT_PATHS = 40


def post_tool_call(**kwargs: Any) -> None:
    """Record the paths a completed tool call mutated, for event-shaped routing.

    Hermes treats ``post_tool_call`` as an observer: ``model_tools.
    _emit_post_tool_call_hook`` discards whatever a handler returns, so this hook
    structurally cannot put text in front of the model. It is still the correct
    event source — it is the only hook that sees a *completed* mutation — so it
    buffers the routing input here and ``pre_llm_call``, the one hook whose return
    value Hermes uses, renders and delivers it on the next turn.

    Side-effect-free by design: no ledger write, because this fires once per tool
    call and an events.jsonl line per edit would be pure noise.
    """
    if str(kwargs.get("status") or "ok") != "ok":
        return None
    _motion_receipts.observe(str(kwargs.get("tool_name") or ""), kwargs.get("args"), workspace=kwargs.get("workspace"))
    paths = mutated_tool_paths(
        str(kwargs.get("tool_name") or ""), kwargs.get("args"), kwargs.get("result")
    )
    if not paths:
        return None
    key = str(kwargs.get("session_id") or "") or str(kwargs.get("task_id") or "")
    if not key:
        return None
    _deliverable_hedges.observe_completed_paths(
        key,
        paths,
        workspace=kwargs.get("workspace"),
    )
    pending = _PENDING_POST_EDIT.setdefault(key, [])
    for path in paths:
        if path in pending:
            pending.remove(path)
        pending.append(path)
    del pending[:-_MAX_POST_EDIT_PATHS]
    while len(_PENDING_POST_EDIT) > _MAX_POST_EDIT_SESSIONS:
        _PENDING_POST_EDIT.pop(next(iter(_PENDING_POST_EDIT)), None)
    return None


def post_api_request(**kwargs: Any) -> None:
    """Record Hermes' numeric provider usage receipt in the local ledger.

    The provider observer payload also carries request/response compatibility
    fields, but the measurement module intentionally ignores them.  Returning
    ``None`` preserves the observer-only hook contract.
    """
    return _provider_metrics.post_api_request(**kwargs)


def consume_post_edit_skill_context(session_id: Any) -> str:
    """Drain this session's buffered mutations into a model-facing route block."""
    paths = _PENDING_POST_EDIT.pop(str(session_id or ""), None)
    return conditional_post_edit_skill_blocks(paths) if paths else ""


def consume_post_edit_context(session_id: Any, compacted: bool = False) -> str:
    """Drain buffered mutations into BOTH event-shaped lanes.

    The skill route and the dynamic rules lane read the same buffer, so it is
    popped exactly once here rather than by each consumer.
    """
    paths = _PENDING_POST_EDIT.pop(str(session_id or ""), None)
    if not paths:
        return ""
    blocks = [
        conditional_post_edit_skill_blocks(paths),
        _rules.dynamic_rules_block(paths, session_id, compacted=compacted),
    ]
    return "\n\n".join(block for block in blocks if block)


def on_session_start(**kwargs: Any) -> None:
    """Initialize session-scoped rule state for a brand-new session.

    Hermes ignores this hook's return value, so it cannot inject the static rule
    block itself; it resets the dedup ledger so a recycled session id cannot
    inherit "already injected" from a previous session. `pre_llm_call` renders
    the static lane on the first turn.
    """
    release_browser_drive_state(kwargs.get("session_id"))
    _deliverable_hedges.release_session(kwargs.get("session_id"))
    _rules.begin_session(str(kwargs.get("session_id") or ""))
    _print_agents_nudge(str(kwargs.get("platform") or ""))
    return None


def _print_agents_nudge(platform: str) -> None:
    """Point interactive classic-CLI sessions at Hermes' native /agents view.

    ADR-001: the /agents overlay (alias /tasks) is the host-owned surface for
    live delegate_task visibility; LitHermes only nudges, it renders nothing.
    Gated to platform "cli" (cli.py fires the hook with platform="cli") AND a
    real stdout tty: the TUI/gateway/telegram surfaces and test runs stay
    byte-identical, and a gateway process under a pseudo-tty never prints
    because its platform is not "cli".
    """
    try:
        if platform == "cli" and sys.stdout.isatty():
            print("helper agents: type /agents")
    except Exception:
        pass


def consume_rules_context(**kwargs: Any) -> str:
    """Render both rule lanes plus the post-edit skill route for this turn.

    One owner, because all three share state that must be consumed exactly once:
    the compaction budget and the mutated-path buffer.

    Static lane runs on the first turn of a session and once more after a context
    compaction. Hermes stamps its compaction summary message with
    `_compressed_summary`, so the reopen is detected structurally rather than
    guessed from token counts. The reopen also shrinks both budgets and clears the
    dedup ledger, since the compacted history no longer holds the earlier copy.
    """
    session_id = str(kwargs.get("session_id") or "")
    reopened = False
    if _rules.history_was_compacted(kwargs.get("conversation_history")):
        reopened = _rules.consume_compaction_budget(session_id)

    blocks = []
    if kwargs.get("is_first_turn") or reopened:
        try:
            blocks.append(_rules.static_rules_block(Path.cwd(), session_id, compacted=reopened))
        except OSError:
            pass
        style_block = _output_styles.output_style_block()
        if style_block:
            blocks.append(style_block)
    blocks.append(_deliverable_hedges.consume_context(session_id))
    blocks.append(consume_post_edit_context(session_id, compacted=reopened))
    return "\n\n".join(block for block in blocks if block)


def release_rules_session(session_id: Any) -> None:
    _rules.end_session(str(session_id or ""))
    _deliverable_hedges.release_session(session_id)

def ignite(result: str | dict[str, str], route: str = "litwork") -> str | dict[str, str]:
    """Draw a command acknowledgement and require a separate model probe."""
    mark = acknowledgement(route, color=True)
    if isinstance(result, dict):
        updated = dict(result)
        display = result.get("display")
        if display and not str(display).startswith(mark):
            updated["display"] = f"{mark}\n{display}"
        if result.get("agent_message"):
            updated["agent_message"] = f"{probe_contract(route)}\n\n{result['agent_message']}"
        return updated
    if isinstance(result, str) and result.strip() and not result.startswith(mark):
        return f"{mark}\n{result}"
    return result

# browser-drive substitution guard.
#
# The route already measures the driver and states the verdict in context. On this
# host that was not enough: the model read `status: unavailable` and an explicit
# prohibition, then fetched the page anyway in two separate toolset configurations.
# A contract the host can overrule is a suggestion. So when the route fires and the
# driver is absent, the substitution is refused at the tool boundary, where the
# answer is a fact rather than a request.
#
# Scope is deliberately narrow. Only page-retrieval is refused: exact browser/web
# tools, URL-bearing aliases, and a terminal command that performs a fetch. Ordinary
# terminal and file work in the same turn is untouched.
_BROWSER_DRIVE_GUARD: set[str] = set()
_BROWSER_DRIVE_REPORTS: dict[str, dict[str, Any]] = {}
# Keep state-loss blocking tied to the sessions that actually lost their entry.
_BROWSER_DRIVE_EVICTED_SESSIONS: set[str] = set()

_FETCH_TOOL_NAMES = frozenset(
    {
        "browser_navigate",
        "browser_open",
        "browser_snapshot",
        "fetch",
        "fetch_url",
        "get_url",
        "http.client",
        "http.get",
        "http.request",
        "http_client",
        "open_url",
        "page_fetch",
        "page_open",
        "url_fetch",
        "web_fetch",
        "web_open",
        "web_search",
    }
)
_FETCH_TOOL_ALIASES = frozenset({"browse", "get", "navigate", "open", "request", "retrieve"})
_FETCH_COMMAND_NAMES = frozenset(
    {
        "curl",
        "fetch",
        "http",
        "http.client",
        "httpie",
        "lynx",
        "nc",
        "netcat",
        "open_url",
        "socat",
        "telnet",
        "wget",
        "w3m",
    }
)
_SHELL_COMMAND_NAMES = frozenset({"ash", "bash", "dash", "fish", "ksh", "sh", "zsh"})
_HOST_BROWSER_TOOL = re.compile(
    r"(?:^|[^a-z0-9])(?:browser|web|computer[_\-.]?use)(?:$|[^a-z0-9])",
    re.IGNORECASE,
)
_SHELL_NETWORK_ACCESS = re.compile(r"/dev/(?:tcp|udp)/", re.IGNORECASE)
_URL_INERT_COMMAND_NAMES = frozenset(
    {
        "awk",
        "cat",
        "cut",
        "echo",
        "grep",
        "head",
        "git",
        "less",
        "ls",
        "more",
        "printf",
        "pwd",
        "rg",
        "sed",
        "sort",
        "tail",
        "tr",
        "true",
        "false",
        "uniq",
        "wc",
        "bun",
        "deno",
        "node",
        "nodejs",
        "perl",
        "php",
        "python",
        "python2",
        "python3",
        "ruby",
    }
)
_GIT_NETWORK_SUBCOMMANDS = frozenset({"clone", "fetch", "pull", "push", "ls-remote"})
_PYTHON_COMMAND_NAMES = frozenset({"python", "python2", "python3"})
_NODE_COMMAND_NAMES = frozenset({"bun", "deno", "node", "nodejs"})
_COMMAND_FIELDS = ("command", "cmd", "script", "code", "input")
_MAX_URL_ARGUMENT_DEPTH = 16
_MAX_URL_ARGUMENT_NODES = 256
_HTTP_URL = re.compile(r"(?<![A-Za-z0-9+.-])https?://[^\s'\"`<>()|;&]+", re.IGNORECASE)
_SHELL_SEPARATOR_NAMES = frozenset({";", "&", "|", "&&", "||"})
_SHELL_ASSIGNMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(\+?=)(.*)$")
_SHELL_CONTROL_WORD_NAMES = frozenset(
    {
        "!",
        "if",
        "while",
        "until",
        "then",
        "do",
        "else",
        "elif",
    }
)
_SHELL_PARAMETER_COMMAND_START = re.compile(
    r'(?m)(?:^|[;&|])\s*(?:(?:if|while|until|then|do|else|elif|!)\s+)?'
    r'"?(\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*)'
)
_SHELL_PARAMETER = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")
_OPAQUE_SHELL_VALUE = "\x00lithermes-opaque-shell-value\x00"
_NODE_REQUEST = re.compile(
    r"(?:\bfetch\s*\()"
    r"|(?:\b(?:http|https|node:http|node:https)\s*\.\s*(?:get|request)\s*\()"
    r"|(?:\brequire\s*\(\s*['\"]?(?:node:)?https?['\"]?\s*\)\s*\.\s*(?:get|request)\s*\()"
    r"|(?:\brequire\s*\(\s*['\"](?:node:)?https?['\"]\s*\)[^\n]{0,512}\b(?:get|request)\s*\()"
    r"|(?:\brequire\s*\([^)]{1,128}\)[^\n]{0,512}\b(?:get|request)\s*\()"
    r"|(?:\[['\"](?:fetch|get|request)['\"]\]\s*\()"
    r"|(?:\b(?:axios|undici)\s*\.\s*(?:fetch|get|request)\s*\()",
    re.IGNORECASE,
)
_PYTHON_REQUEST = re.compile(
    r"(?:\b(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp)\s*\.\s*"
    r"(?:delete|get|patch|post|put|request|urlopen|urlretrieve)\s*\()"
    r"|(?:\b(?:urlopen|urlretrieve)\s*\()"
    r"|(?:\bhttp\s*\.\s*client\s*\.\s*(?:HTTPConnection|HTTPSConnection|request)\s*\()"
    r"|(?:\b(?:HTTPConnection|HTTPSConnection)\s*\()"
    r"|(?:\bgetattr\s*\(\s*http\s*\.\s*client\b[^)]{0,160}\)\s*\()"
    r"|(?:\bgetattr\s*\([^,()]{1,80},\s*['\"](?:request|get|connect|urlopen|create_connection|create_server|socket|HTTPConnection|HTTPSConnection)['\"]\s*\)\s*\()"
    r"|(?:\bsocket\s*\.\s*(?:create_connection|create_server|socket)\s*\()"
    r"|(?:\b(?:create_connection|create_server)\s*\()"
    r"|(?:\b(?:import|from)\s+(?:requests|httpx|urllib3|aiohttp|socket)\b[^\n]{0,256}\b[A-Za-z_]\w*\s*\.\s*(?:delete|get|patch|post|put|request|urlopen|urlretrieve|create_connection|create_server)\s*\()",
    re.IGNORECASE,
)
_BASE64_DECODE = re.compile(
    r"(?:\bbase64\s+(?:-[A-Za-z]*d|--decode)\b"
    r"|\b(?:base64\.)?(?:b64decode|urlsafe_b64decode)\s*\("
    r"|\bBuffer\s*\.\s*from\s*\([^\n]{0,8192}['\"]base64['\"])",
    re.IGNORECASE,
)
_BASE64_EXECUTION = re.compile(
    r"(?:"
    r"\|\s*(?:(?:/[A-Za-z0-9_.-]+)*/)?(?:env\s+)?(?:(?:/[A-Za-z0-9_.-]+)*/)?(?:busybox\s+)?(?:ash|bash|dash|fish|ksh|node|perl|php|python|python3|ruby|sh|zsh)\b"
    r"|\b(?:ash|bash|dash|fish|ksh|node|python|python3|sh|zsh)\s+-c\b"
    r"|\b(?:exec|eval|popen|source|system)\s*\(?"
    r"|\b(?:new\s+Function|os\s*\.\s*system|subprocess\s*\.\s*"
    r"(?:call|Popen|run))\s*\("
    r")",
    re.IGNORECASE,
)
_MAX_GUARD_TEXT = 8192
_MAX_COMMAND_DEPTH = 8
_MAX_BROWSER_DRIVE_SESSIONS = 64
_MAX_BROWSER_SESSION_ID_LENGTH = 256
_MAX_BROWSER_REPORT_FIELD_LENGTH = 512
_BLOCKER_STATE = "BLOCKED_BROWSER_DRIVER_STATE_UNAVAILABLE"
_BROWSER_DRIVER_VERSION = re.compile(
    r"^agent-browser\s+v?\d+(?:\.\d+)+$", re.IGNORECASE
)
_RUBY_NETWORK_REQUEST = re.compile(r"\b(?:URI\s*\.\s*open|Net\s*::\s*HTTP|open-uri)\b", re.IGNORECASE)
_PHP_NETWORK_REQUEST = re.compile(
    r"\b(?:file_get_contents|fopen|curl_exec|fsockopen)\s*\(", re.IGNORECASE
)
_PYTHON_NETWORK_MEMBERS = frozenset(
    {
        "create_connection",
        "create_server",
        "delete",
        "get",
        "patch",
        "post",
        "put",
        "request",
        "socket",
        "urlopen",
        "urlretrieve",
        "HTTPConnection",
        "HTTPSConnection",
    }
)
_PYTHON_NETWORK_MODULES = frozenset(
    {"aiohttp", "http", "http.client", "httpx", "requests", "socket", "urllib", "urllib.request", "urllib3"}
)
_PYTHON_NETWORK_IMPORT = re.compile(
    r"(?:\bimport\s+(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp|http(?:\.client)?|socket)\b"
    r"|\bfrom\s+(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp|http(?:\.client)?|socket)\s+import\b"
    r"|(?:^|[^A-Za-z0-9_])(?:__import__|importlib\s*\.\s*import_module)\s*\(\s*['\"]"
    r"(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp|http(?:\.client)?|socket)['\"]\s*\))",
    re.IGNORECASE,
)
_PYTHON_MEMBER_ASSIGNMENT = re.compile(
    r"\b([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\s*\.\s*"
    r"(?:delete|get|patch|post|put|request|urlopen|urlretrieve|create_connection|create_server|socket|"
    r"HTTPConnection|HTTPSConnection)\b",
    re.IGNORECASE,
)
_PYTHON_ALIAS_IMPORT = re.compile(
    r"\bfrom\s+(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp|http(?:\.client)?|socket)\s+import\b[^;]*"
    r"\bas\s+([A-Za-z_]\w*)\b",
    re.IGNORECASE,
)
_PYTHON_MEMBER_CALL = re.compile(
    r"\b[A-Za-z_]\w*\s*\.\s*(?:delete|get|patch|post|put|request|urlopen|urlretrieve|"
    r"create_connection|create_server|socket|HTTPConnection|HTTPSConnection)\s*\(",
    re.IGNORECASE,
)
_PYTHON_DYNAMIC_ALIAS = re.compile(r"\b([A-Za-z_]\w*)\s*=\s*getattr\s*\([^;]{1,256}\)", re.IGNORECASE)
_PYTHON_FROM_REQUEST = re.compile(
    r"\bfrom\s+(?:requests|httpx|urllib(?:\.request)?|urllib3|aiohttp|http(?:\.client)?|socket)\s+import\b"
    r"[^\n]{0,256}\b(?:delete|get|patch|post|put|request|urlopen|urlretrieve|create_connection|create_server|socket|"
    r"HTTPConnection|HTTPSConnection)\s*\(",
    re.IGNORECASE,
)
_NODE_NETWORK_MARKER = re.compile(
    r"(?:\bfetch\b|\b(?:node:)?https?\b|\b(?:axios|undici)\b|"
    r"\brequire\s*\(\s*['\"](?:node:)?https?['\"]\s*\))",
    re.IGNORECASE,
)
_NODE_GLOBAL_FETCH_ALIAS = re.compile(
    r"\b(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*globalThis\s*\[\s*['\"]fetch['\"]\s*\]",
    re.IGNORECASE,
)
_NODE_REQUIRE_ALIAS = re.compile(
    r"\b(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*require\s*\(\s*['\"](?:node:)?https?['\"]\s*\)\s*\.\s*(get|request)\b",
    re.IGNORECASE,
)
_NODE_IMPORT_ALIASES = re.compile(
    r"\bimport\s*\{([^}]*)\}\s*from\s*['\"](?:node:)?https?['\"]",
    re.IGNORECASE,
)
_NODE_REQUIRE_DESTRUCTURED = re.compile(
    r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['\"](?:node:)?https?['\"]\s*\)",
    re.IGNORECASE,
)
_NODE_SIMPLE_ALIAS = re.compile(
    r"\b(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*(?![=])([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?",
    re.IGNORECASE,
)
_NODE_MEMBER_ASSIGNMENT = re.compile(
    r"\b([A-Za-z_]\w*)\s*=\s*(?:[A-Za-z_]\w*\s*\.\s*)?"
    r"(?:fetch|get|request)\b|\b([A-Za-z_]\w*)\s*=\s*"
    r"(?:require\s*\([^)]{0,128}\)|[A-Za-z_]\w*)\s*\.\s*(?:get|request)\b",
    re.IGNORECASE,
)
_NODE_DIRECT_ALIAS = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:globalThis\s*\.\s*)?fetch\b", re.IGNORECASE)
_NODE_NAMED_IMPORT_ALIAS = re.compile(
    r"\bimport\s*\{[^}]*\b(?:fetch|get|request)\s+as\s+([A-Za-z_]\w*)\b",
    re.IGNORECASE,
)
_NODE_DESTRUCTURED_ALIAS = re.compile(
    r"\b(?:const|let|var)\s*\{[^}]*\b(?:fetch|get|request)\s*:\s*([A-Za-z_]\w*)\b",
    re.IGNORECASE,
)
_PRIVILEGE_WRAPPER_NAME = "su" + "do"
_SHELL_EXECUTION_NAMES = frozenset({".", "eval", "source", "xargs"})
_SHELL_PREFIX_WRAPPER_NAMES = frozenset(
    {"command", "exec", "env", _PRIVILEGE_WRAPPER_NAME, "time", "nice", "nohup"}
)
_SHELL_EXECUTION_WRAPPER_NAMES = frozenset(
    {"command", "exec", "env", _PRIVILEGE_WRAPPER_NAME, "time", "nice", "nohup"}
) | _SHELL_EXECUTION_NAMES
_SHELL_SCRIPT_EXECUTION_NAMES = frozenset({".", "eval", "source"})
_SHELL_WRAPPER_OPTION_VALUES = {
    "exec": frozenset({"-a"}),
    "env": frozenset({"-u", "--unset", "-C", "--chdir"}),
    "nice": frozenset({"-n", "--adjustment"}),
    _PRIVILEGE_WRAPPER_NAME: frozenset({"-u", "--user", "-g", "--group", "-h", "--host", "-C", "--chdir"}),
    "xargs": frozenset({"-a", "--arg-file", "-d", "--delimiter", "-I", "--replace", "-P", "--max-procs"}),
}
_RUBY_COMMAND_NAMES = frozenset({"ruby"})
_PHP_COMMAND_NAMES = frozenset({"php"})


class _NormalisedBrowserDriverReport(dict[str, Any]):
    pass


def _default_browser_driver_report() -> dict[str, Any]:
    return _NormalisedBrowserDriverReport(
        {
            "status": "unavailable",
            "command": None,
            "version": None,
            "blocker": "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
            "detail": "the browser driver was not measured",
        }
    )


def _browser_session_id(value: Any) -> str | None:
    if (
        isinstance(value, str)
        and value.strip()
        and len(value) <= _MAX_BROWSER_SESSION_ID_LENGTH
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return value
    return None


def _bounded_report_value(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value[:_MAX_BROWSER_REPORT_FIELD_LENGTH]


def _normalise_browser_driver_report(report: Any) -> dict[str, Any]:
    if isinstance(report, _NormalisedBrowserDriverReport):
        return report
    if not isinstance(report, dict):
        return _default_browser_driver_report()
    status = report.get("status")
    command = _bounded_report_value(report.get("command"))
    version = _bounded_report_value(report.get("version"))
    blocker = report.get("blocker")
    detail = _bounded_report_value(report.get("detail")) or "the browser driver was not measured"
    if status == "available":
        command_name = command.replace("\\", "/").rsplit("/", 1)[-1].casefold() if command else None
        if (
            command_name not in {"agent-browser", "agent-browser.exe"}
            or version is None
            or _BROWSER_DRIVER_VERSION.fullmatch(version) is None
            or blocker is not None
        ):
            status = "unverified-identity"
            blocker = "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED"
        else:
            blocker = None
    elif status not in {"unavailable", "unverified-identity", "unknown"}:
        status = "unknown"
        blocker = "BLOCKED_BROWSER_DRIVER_UNAVAILABLE"
    elif blocker not in {
        "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
        "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED",
        BROWSER_IDENTITY_BLOCKER,
        None,
    }:
        blocker = (
            "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED"
            if status == "unverified-identity"
            else "BLOCKED_BROWSER_DRIVER_UNAVAILABLE"
        )
    return _NormalisedBrowserDriverReport(
        {
            "status": status,
            "command": command,
            "version": version,
            "blocker": blocker,
            "detail": detail,
        }
    )


def _evict_browser_drive_state() -> None:
    while len(_BROWSER_DRIVE_REPORTS) > _MAX_BROWSER_DRIVE_SESSIONS:
        stale = next(iter(_BROWSER_DRIVE_REPORTS))
        _BROWSER_DRIVE_GUARD.discard(stale)
        _BROWSER_DRIVE_REPORTS.pop(stale, None)
        _BROWSER_DRIVE_EVICTED_SESSIONS.add(stale)
    while len(_BROWSER_DRIVE_GUARD) > _MAX_BROWSER_DRIVE_SESSIONS:
        stale = next(iter(_BROWSER_DRIVE_GUARD))
        _BROWSER_DRIVE_GUARD.discard(stale)
        _BROWSER_DRIVE_REPORTS.pop(stale, None)
        _BROWSER_DRIVE_EVICTED_SESSIONS.add(stale)


def arm_browser_drive_guard(session_id: Any, report: dict[str, Any] | None = None) -> None:
    session = _browser_session_id(session_id)
    if session is not None:
        _BROWSER_DRIVE_EVICTED_SESSIONS.discard(session)
        _BROWSER_DRIVE_GUARD.add(session)
        normalised = (
            report
            if isinstance(report, _NormalisedBrowserDriverReport)
            else _normalise_browser_driver_report(report)
        )
        _BROWSER_DRIVE_REPORTS[session] = dict(normalised)
        _evict_browser_drive_state()


def release_browser_drive_guard(session_id: Any) -> None:
    session = _browser_session_id(session_id)
    if session is None:
        return None
    _BROWSER_DRIVE_GUARD.discard(session)
    _BROWSER_DRIVE_REPORTS.pop(session, None)
    _BROWSER_DRIVE_EVICTED_SESSIONS.discard(session)


def release_browser_drive_state(session_id: Any) -> None:
    session = _browser_session_id(session_id)
    if session is None:
        return None
    release_browser_drive_guard(session)
    _PENDING_IGNITE.discard(session)
    _PENDING_DISCIPLINE.pop(session, None)
    _PENDING_BLOCK.pop(session, None)
    _PENDING_POST_EDIT.pop(session, None)


def _evict_pending_browser_state() -> None:
    while len(_PENDING_IGNITE) > _MAX_BROWSER_DRIVE_SESSIONS:
        stale = next(iter(_PENDING_IGNITE))
        _PENDING_IGNITE.discard(stale)
        _PENDING_DISCIPLINE.pop(stale, None)
    while len(_PENDING_BLOCK) > _MAX_BROWSER_DRIVE_SESSIONS:
        _PENDING_BLOCK.pop(next(iter(_PENDING_BLOCK)), None)


def _has_http_url(value: str) -> bool:
    for match in _HTTP_URL.finditer(value):
        candidate = match.group(0).rstrip(".,!?]}")
        try:
            parsed = urlsplit(candidate)
        except ValueError:
            continue
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
            return True
    return False


def _shell_tokens(command: str) -> list[str]:
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except (TypeError, ValueError):
        return []


def _split_unquoted_newlines(command: str) -> list[str]:
    parts: list[str] = []
    start = 0
    quote: str | None = None
    escaped = False
    index = 0
    while index < len(command):
        character = command[index]
        if escaped:
            escaped = False
        elif character == "\\" and quote != "'":
            escaped = True
        elif quote is not None:
            if character == quote:
                quote = None
        elif character in {"'", '"'}:
            quote = character
        elif character in {"\r", "\n"}:
            parts.append(command[start:index])
            if character == "\r" and index + 1 < len(command) and command[index + 1] == "\n":
                index += 1
            start = index + 1
        index += 1
    parts.append(command[start:])
    return parts


def _command_segments(tokens: list[str]) -> list[list[str]]:
    segments: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token in _SHELL_SEPARATOR_NAMES:
            if current:
                segments.append(current)
                current = []
            continue
        current.append(token)
    if current:
        segments.append(current)
    return segments


def _shell_substitutions(command: str) -> list[str]:
    if len(command) > _MAX_GUARD_TEXT:
        return []
    substitutions: list[str] = []
    index = 0
    quote: str | None = None
    while index < len(command):
        character = command[index]
        if quote == "'":
            if character == "'":
                quote = None
            index += 1
            continue
        if character == "\\":
            index += 2
            continue
        if quote == '"':
            if character == '"':
                quote = None
                index += 1
                continue
        elif character in {'"', "'"}:
            quote = character
            index += 1
            continue
        if character == "`":
            end = index + 1
            escaped = False
            while end < len(command):
                nested = command[end]
                if escaped:
                    escaped = False
                elif nested == "\\":
                    escaped = True
                elif nested == "`":
                    substitutions.append(command[index + 1 : end])
                    index = end + 1
                    break
                end += 1
            else:
                return substitutions
            continue
        if character == "$" and index + 1 < len(command) and command[index + 1] == "(":
            end = index + 2
            depth = 1
            nested_quote: str | None = None
            escaped = False
            while end < len(command):
                nested = command[end]
                if escaped:
                    escaped = False
                elif nested == "\\":
                    escaped = True
                elif nested_quote == "'":
                    if nested == "'":
                        nested_quote = None
                elif nested_quote == '"':
                    if nested == '"':
                        nested_quote = None
                elif nested in {'"', "'"}:
                    nested_quote = nested
                elif nested == "(":
                    depth += 1
                elif nested == ")":
                    depth -= 1
                    if depth == 0:
                        substitutions.append(command[index + 2 : end])
                        index = end + 1
                        break
                end += 1
            else:
                return substitutions
            continue
        index += 1
    return substitutions


def _shell_substitution_is_opaque(command: str) -> bool:
    if len(command) > _MAX_GUARD_TEXT and re.search(r"(?:\$\(|`)", command):
        return True
    word: list[str] = []
    has_substitution = False
    quote: str | None = None
    expect_command = True
    redirection = False
    control_mode: str | None = None
    execution_wrapper: str | None = None
    wrapper_option_value = False
    wrapper_options_ended = False
    find_command = False

    def flush_word() -> bool:
        nonlocal control_mode, execution_wrapper, expect_command, find_command
        nonlocal has_substitution, redirection, wrapper_option_value, wrapper_options_ended
        if not word:
            return False
        token = "".join(word)
        word.clear()
        token_has_substitution = has_substitution
        has_substitution = False
        lowered = token.casefold()
        if execution_wrapper is not None:
            if token_has_substitution:
                return True
            if wrapper_option_value:
                wrapper_option_value = False
                return False
            if not wrapper_options_ended and lowered == "--":
                wrapper_options_ended = True
                return False
            option_values = _SHELL_WRAPPER_OPTION_VALUES.get(execution_wrapper, frozenset())
            if not wrapper_options_ended and lowered in option_values:
                wrapper_option_value = True
                return False
            if not wrapper_options_ended and lowered.startswith("-"):
                return False
            if execution_wrapper == "env" and _SHELL_ASSIGNMENT.fullmatch(token) is not None:
                return False
            if lowered in _SHELL_EXECUTION_WRAPPER_NAMES:
                execution_wrapper = lowered
                wrapper_option_value = False
                wrapper_options_ended = False
                return False
            if execution_wrapper in _SHELL_SCRIPT_EXECUTION_NAMES:
                return False
            find_command = lowered == "find"
            execution_wrapper = None
            wrapper_option_value = False
            wrapper_options_ended = False
            expect_command = False
            return False
        if redirection:
            redirection = False
            return False
        if control_mode == "for_name":
            control_mode = "for_in"
            return False
        if control_mode == "for_in":
            control_mode = "for_list" if lowered == "in" else None
            return False
        if control_mode == "for_list":
            if lowered == "do":
                control_mode = None
                expect_command = True
            return False
        if control_mode == "case_expr":
            if lowered == "in":
                control_mode = "case_pattern"
            return False
        if control_mode == "case_pattern":
            return False
        if control_mode == "case_body" and lowered == "esac":
            control_mode = None
            expect_command = False
            return False
        if token_has_substitution and expect_command and _SHELL_ASSIGNMENT.fullmatch(token) is None:
            return True
        if expect_command and lowered == "for":
            control_mode = "for_name"
            expect_command = False
            return False
        if expect_command and lowered == "case":
            control_mode = "case_expr"
            expect_command = False
            return False
        if find_command and lowered in {"-exec", "-execdir"}:
            execution_wrapper = "find-exec"
            wrapper_option_value = False
            wrapper_options_ended = False
            find_command = False
            return False
        if expect_command and lowered in _SHELL_EXECUTION_WRAPPER_NAMES:
            execution_wrapper = lowered
            wrapper_option_value = False
            wrapper_options_ended = False
            return False
        if expect_command and lowered in _SHELL_CONTROL_WORD_NAMES:
            return False
        if expect_command and _SHELL_ASSIGNMENT.fullmatch(token) is not None:
            return False
        if expect_command and lowered == "find":
            find_command = True
        expect_command = False
        return False

    index = 0
    while index < len(command):
        character = command[index]
        if quote == "'":
            word.append(character)
            if character == "'":
                quote = None
            index += 1
            continue
        if quote == '"':
            if character == "\\" and index + 1 < len(command):
                word.extend((character, command[index + 1]))
                index += 2
                continue
            if character == '"':
                word.append(character)
                quote = None
                index += 1
                continue
            if character not in {"$", "`"}:
                word.append(character)
                index += 1
                continue
        elif character in {'"', "'"}:
            word.append(character)
            quote = character
            index += 1
            continue
        if character == "\\":
            word.append(character)
            if index + 1 < len(command):
                word.append(command[index + 1])
                index += 2
            else:
                index += 1
            continue
        if character == "$" and index + 1 < len(command) and command[index + 1] == "(":
            word.append("x")
            has_substitution = True
            index += 2
            depth = 1
            nested_quote: str | None = None
            nested_backtick = False
            escaped = False
            while index < len(command):
                nested = command[index]
                if escaped:
                    escaped = False
                elif nested == "\\":
                    escaped = True
                elif nested_backtick:
                    if nested == "`":
                        nested_backtick = False
                elif nested_quote == "'":
                    if nested == "'":
                        nested_quote = None
                elif nested_quote == '"':
                    if nested == '"':
                        nested_quote = None
                elif nested in {'"', "'"}:
                    nested_quote = nested
                elif nested == "`":
                    nested_backtick = True
                elif nested == "(":
                    depth += 1
                elif nested == ")":
                    depth -= 1
                    if depth == 0:
                        index += 1
                        break
                index += 1
            continue
        if character == "`":
            word.append("x")
            has_substitution = True
            index += 1
            escaped = False
            while index < len(command):
                nested = command[index]
                if escaped:
                    escaped = False
                elif nested == "\\":
                    escaped = True
                elif nested == "`":
                    index += 1
                    break
                index += 1
            continue
        if character.isspace():
            if flush_word():
                return True
            if character in {"\r", "\n"}:
                expect_command = True
                execution_wrapper = None
                wrapper_option_value = False
                wrapper_options_ended = False
                find_command = False
            index += 1
            continue
        if character == "#" and not word:
            newline = command.find("\n", index)
            if newline == -1:
                break
            expect_command = True
            execution_wrapper = None
            wrapper_option_value = False
            wrapper_options_ended = False
            find_command = False
            index = newline + 1
            continue
        if character in ";&|":
            if flush_word():
                return True
            if control_mode != "case_pattern":
                expect_command = True
                execution_wrapper = None
                wrapper_option_value = False
                wrapper_options_ended = False
                find_command = False
            index += 1
            continue
        if character in "(){}":
            if flush_word():
                return True
            if character == "(" and control_mode != "case_pattern":
                expect_command = True
            elif character == ")" and control_mode == "case_pattern":
                control_mode = "case_body"
                expect_command = True
            elif character == ")":
                expect_command = False
            elif character == "{":
                expect_command = True
            else:
                expect_command = False
            index += 1
            continue
        if character in "<>":
            if flush_word():
                return True
            redirection = True
            index += 1
            if index < len(command) and command[index] == character:
                index += 1
            continue
        word.append(character)
        index += 1
    return flush_word()


def _runtime_reads_code_from_stdin(tokens: list[str], aliases: dict[str, str]) -> bool:
    for index, token in enumerate(tokens):
        if token != "|":
            continue
        end = index + 1
        while end < len(tokens) and tokens[end] not in _SHELL_SEPARATOR_NAMES:
            end += 1
        segment = tokens[index + 1 : end]
        if not segment:
            continue
        name = _resolve_shell_alias(_command_name(segment), aliases)
        command_index = next(
            (
                candidate
                for candidate, value in enumerate(segment)
                if _resolve_shell_alias(
                    value[1:] if value.startswith("$") else value.rsplit("/", 1)[-1], aliases
                )
                == name
            ),
            0,
        )
        arguments = segment[command_index + 1 :]
        if name in _PYTHON_COMMAND_NAMES:
            if "-" in arguments or not any(not argument.startswith("-") for argument in arguments):
                return True
        if name in _NODE_COMMAND_NAMES:
            has_runtime_option = any(
                argument in {"-e", "--eval", "-p", "--print", "--check"}
                or argument.startswith(("-e", "--eval=", "-p", "--print="))
                for argument in arguments
            )
            has_script_argument = any(not argument.startswith("-") for argument in arguments)
            if not has_runtime_option and not has_script_argument:
                return True
    return False


def _shell_prefix_command_name(tokens: list[str]) -> str:
    index = 0
    while index < len(tokens):
        token = tokens[index]
        lowered = token.casefold()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token):
            index += 1
            continue
        if lowered not in _SHELL_PREFIX_WRAPPER_NAMES:
            if token.startswith("$"):
                return token.casefold()
            return token.rsplit("/", 1)[-1].casefold()
        option_values = _SHELL_WRAPPER_OPTION_VALUES.get(lowered, frozenset())
        index += 1
        while index < len(tokens):
            option = tokens[index]
            if option == "--":
                index += 1
                break
            if lowered == "env" and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", option):
                index += 1
                continue
            if option in option_values:
                index += 2
                continue
            if option.startswith("-"):
                index += 1
                continue
            break
    return ""


def _command_name(tokens: list[str]) -> str:
    return _shell_prefix_command_name(tokens)


def _shell_aliases(command: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for token in _shell_tokens(command):
        match = _SHELL_ASSIGNMENT.fullmatch(token)
        if match is None:
            continue
        alias, operator, target = match.groups()
        alias = alias.casefold()
        if operator == "+=":
            target = aliases.get(alias, "") + target
        aliases[alias] = (
            _OPAQUE_SHELL_VALUE
            if _shell_substitutions(target) or "`" in target
            else target.casefold()
        )
    for match in re.finditer(
        r'(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?=[^;&|\n]*(?:\$\(|`))', command
    ):
        substitutions = _shell_substitutions(command[match.start() :])
        if substitutions or re.search(r"(?:\$\(|`)", command[match.start() :]):
            aliases[match.group(1).casefold()] = _OPAQUE_SHELL_VALUE
    for match in re.finditer(
        r"(?m)(?:^|[;&|{}])\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^\n]*?)\s*(?:;|\n)\s*do\b",
        command,
    ):
        words = match.group(2)
        source_is_opaque = bool(_shell_substitutions(words) or re.search(r"(?:\$\(|`)", words))
        resolved_sources: list[str] = []
        if not source_is_opaque:
            for parameter in _SHELL_PARAMETER.finditer(words):
                resolved = _resolve_shell_alias(parameter.group(0), aliases)
                if resolved == _OPAQUE_SHELL_VALUE:
                    source_is_opaque = True
                    break
                if resolved:
                    resolved_sources.append(resolved)
        if source_is_opaque:
            aliases[match.group(1).casefold()] = _OPAQUE_SHELL_VALUE
        elif resolved_sources and len(set(resolved_sources)) == 1:
            aliases[match.group(1).casefold()] = resolved_sources[0]
    return aliases


def _resolve_shell_alias(name: str, aliases: dict[str, str]) -> str:
    resolved = name.casefold()
    seen: set[str] = set()
    for _ in range(_MAX_COMMAND_DEPTH):
        if _OPAQUE_SHELL_VALUE in resolved:
            return _OPAQUE_SHELL_VALUE
        single_parameter = re.fullmatch(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", resolved)
        if single_parameter:
            resolved = single_parameter.group(1)
        expanded = _SHELL_PARAMETER.sub(
            lambda match: aliases.get(
                (match.group(1) or match.group(2)).casefold(), match.group(0)
            ),
            resolved,
        )
        if expanded != resolved:
            resolved = expanded
            continue
        if resolved not in aliases or resolved in seen:
            break
        seen.add(resolved)
        resolved = aliases[resolved]
    if _OPAQUE_SHELL_VALUE in resolved:
        return _OPAQUE_SHELL_VALUE
    return resolved.strip().split(None, 1)[0].rsplit("/", 1)[-1] if resolved.strip() else ""


def _inline_shell_commands(tokens: list[str]) -> list[str]:
    if _command_name(tokens) not in _SHELL_COMMAND_NAMES:
        return []
    commands: list[str] = []
    for index, token in enumerate(tokens[:-1]):
        if token in {"-c", "--command"} or (token.startswith("-") and "c" in token[1:]):
            commands.append(tokens[index + 1])
    return commands


def _find_exec_shell_commands(tokens: list[str]) -> list[str]:
    commands: list[str] = []
    index = 0
    while index < len(tokens):
        if tokens[index] not in {"-exec", "-execdir"}:
            index += 1
            continue
        end = index + 1
        while end < len(tokens) and tokens[end] not in {"+", ";"}:
            end += 1
        commands.extend(_inline_shell_commands(tokens[index + 1 : end]))
        index = end + 1 if end < len(tokens) else end
    return commands


def _base64_followed_by_execution(command: str) -> bool:
    bounded = command[:_MAX_GUARD_TEXT]
    if _BASE64_DECODE.search(bounded) and _BASE64_EXECUTION.search(bounded):
        return True
    if len(command) > _MAX_GUARD_TEXT:
        return bool(_BASE64_DECODE.search(command) or _BASE64_EXECUTION.search(command))
    return False


def _alias_is_called(command: str, alias: str) -> bool:
    return re.search(rf"\b{re.escape(alias)}\s*\(", command) is not None


def _python_aliases(command: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for match in re.finditer(
        r"\bimport\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)(?:\s+as\s+([A-Za-z_]\w*))?",
        command,
        re.IGNORECASE,
    ):
        module, alias = match.groups()
        if module.casefold() in _PYTHON_NETWORK_MODULES:
            aliases[(alias or module.rsplit(".", 1)[-1]).casefold()] = module
    for match in re.finditer(
        r"\bfrom\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+import\s+([^;\n]+)",
        command,
        re.IGNORECASE,
    ):
        module, imported_names = match.groups()
        if module.casefold() not in _PYTHON_NETWORK_MODULES:
            continue
        for imported in imported_names.split(","):
            parts = imported.strip().split()
            if not parts or parts[0] == "*":
                continue
            name = parts[0]
            alias = parts[2] if len(parts) >= 3 and parts[1].casefold() == "as" else name
            aliases[alias.casefold()] = f"{module}.{name}"
    for match in re.finditer(
        r"\b([A-Za-z_]\w*)\s*=(?!=)\s*([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?",
        command,
        re.IGNORECASE,
    ):
        alias, base, member = match.groups()
        aliases[alias.casefold()] = f"{base}.{member}" if member else base
    return aliases


def _python_target_is_network(target: str, aliases: dict[str, str], seen: set[str] | None = None) -> bool:
    current = target.strip()
    lowered = current.casefold()
    if lowered in _PYTHON_NETWORK_MODULES:
        return True
    seen = set() if seen is None else seen
    if lowered in seen:
        return False
    seen.add(lowered)
    if "." in current:
        base, member = current.rsplit(".", 1)
        if member.casefold() in {name.casefold() for name in _PYTHON_NETWORK_MEMBERS}:
            if _python_target_is_network(base, aliases, seen):
                return True
    alias_target = aliases.get(lowered)
    return bool(alias_target and _python_target_is_network(alias_target, aliases, seen))


def _python_request_shaped(command: str) -> bool:
    if _PYTHON_REQUEST.search(command):
        return True
    compact = re.sub(r"\s+", " ", command)
    if _PYTHON_NETWORK_IMPORT.search(compact) is None:
        return False
    for match in _PYTHON_MEMBER_ASSIGNMENT.finditer(compact):
        if _alias_is_called(compact, match.group(1)):
            return True
    for match in _PYTHON_ALIAS_IMPORT.finditer(compact):
        if _alias_is_called(compact, match.group(1)):
            return True
    for match in _PYTHON_DYNAMIC_ALIAS.finditer(compact):
        if _alias_is_called(compact, match.group(1)):
            return True
    aliases = _python_aliases(compact)
    for match in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", compact):
        if _python_target_is_network(match.group(1), aliases):
            return True
    return bool(
        _PYTHON_MEMBER_CALL.search(compact)
        or _PYTHON_FROM_REQUEST.search(compact)
        or _PYTHON_REQUEST.search(compact)
    )


def _node_request_shaped(command: str) -> bool:
    if _NODE_REQUEST.search(command):
        return True
    compact = re.sub(r"\s+", " ", command)
    if _NODE_NETWORK_MARKER.search(compact) is None:
        return False
    aliases: dict[str, str] = {}
    for match in _NODE_SIMPLE_ALIAS.finditer(compact):
        alias, base, member = match.groups()
        aliases[alias.casefold()] = f"{base}.{member}" if member else base
    for match in _NODE_GLOBAL_FETCH_ALIAS.finditer(compact):
        aliases[match.group(1).casefold()] = "fetch"
    for match in _NODE_REQUIRE_ALIAS.finditer(compact):
        aliases[match.group(1).casefold()] = f"https.{match.group(2)}"
    for match in _NODE_IMPORT_ALIASES.finditer(compact):
        for imported in match.group(1).split(","):
            parts = imported.strip().split()
            if not parts:
                continue
            name = parts[0]
            alias = parts[2] if len(parts) >= 3 and parts[1].casefold() == "as" else name
            aliases[alias.casefold()] = f"https.{name}"
    for match in _NODE_REQUIRE_DESTRUCTURED.finditer(compact):
        for imported in match.group(1).split(","):
            parts = imported.strip().split(":", 1)
            name = parts[0].strip()
            alias = parts[1].strip() if len(parts) == 2 else name
            if name in {"get", "request"}:
                aliases[alias.casefold()] = f"https.{name}"
    for match in _NODE_MEMBER_ASSIGNMENT.finditer(compact):
        member_aliases = [alias for alias in match.groups() if alias]
        if any(_alias_is_called(compact, alias) for alias in member_aliases):
            return True
    for match in _NODE_DIRECT_ALIAS.finditer(compact):
        if _alias_is_called(compact, match.group(1)):
            return True
    for pattern in (_NODE_NAMED_IMPORT_ALIAS, _NODE_DESTRUCTURED_ALIAS):
        for match in pattern.finditer(compact):
            if _alias_is_called(compact, match.group(1)):
                return True
    def target_is_network(target: str, seen: set[str] | None = None) -> bool:
        current = target.casefold()
        if current == "fetch" or re.fullmatch(r"(?:node:)?https?\.(?:get|request)", current):
            return True
        seen = set() if seen is None else seen
        if current in seen:
            return False
        seen.add(current)
        alias_target = aliases.get(current)
        return bool(alias_target and target_is_network(alias_target, seen))

    for match in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", compact):
        if target_is_network(match.group(1)):
            return True
    return bool(re.search(r"\b(?:fetch|get|request)\s*\(", compact))


def _runtime_code_is_opaque(tokens: list[str]) -> bool:
    for index, token in enumerate(tokens[:-1]):
        if token in {"-c", "-e", "--eval", "--command"} and tokens[index + 1].startswith(("$", "<")):
            return True
    return False


def _git_network_command(tokens: list[str]) -> bool:
    if not tokens or _command_name(tokens) != "git":
        return False
    return any(token.casefold() in _GIT_NETWORK_SUBCOMMANDS for token in tokens[1:])


def _url_is_retrieval_shaped(tokens: list[str], command: str, name: str) -> bool:
    if not _has_http_url(command):
        return False
    if name in _URL_INERT_COMMAND_NAMES and name != "git":
        return False
    if name == "git":
        return _git_network_command(tokens)
    return True


def _command_is_fetch_shaped(
    command: str, _depth: int = 0, _aliases: dict[str, str] | None = None
) -> bool:
    if not isinstance(command, str):
        return False
    if _SHELL_NETWORK_ACCESS.search(command):
        return True
    if _shell_substitution_is_opaque(command):
        return True
    aliases = _aliases if _aliases is not None else _shell_aliases(command)
    if any(
        _resolve_shell_alias(match.group(1), aliases) in (_FETCH_COMMAND_NAMES | {_OPAQUE_SHELL_VALUE})
        for match in _SHELL_PARAMETER_COMMAND_START.finditer(command)
    ):
        return True
    if any(_command_is_fetch_shaped(value, _depth + 1, aliases) for value in _shell_substitutions(command)):
        return True
    lines = _split_unquoted_newlines(command)
    if len(lines) > 1:
        return any(_command_is_fetch_shaped(line, _depth, aliases) for line in lines)
    if command.lstrip().startswith("#"):
        return False
    if _depth >= _MAX_COMMAND_DEPTH:
        tokens = _shell_tokens(command)
        names = {_command_name(segment) for segment in _command_segments(tokens)}
        return bool(
            names & (_SHELL_COMMAND_NAMES | _FETCH_COMMAND_NAMES | _NODE_COMMAND_NAMES | _PYTHON_COMMAND_NAMES)
            or _has_http_url(command)
            or _base64_followed_by_execution(command)
        )
    if _base64_followed_by_execution(command):
        return True
    tokens = _shell_tokens(command)
    if not tokens:
        return _has_http_url(command)
    if _runtime_reads_code_from_stdin(tokens, aliases):
        return True
    for segment in _command_segments(tokens):
        name = _command_name(segment)
        effective_name = _resolve_shell_alias(name, aliases)
        if effective_name == _OPAQUE_SHELL_VALUE:
            return True
        if effective_name == "find":
            nested = _find_exec_shell_commands(segment)
            if nested and any(_command_is_fetch_shaped(value, _depth + 1, aliases) for value in nested):
                return True
        if effective_name in _SHELL_COMMAND_NAMES:
            nested = _inline_shell_commands(segment)
            if nested and any(_command_is_fetch_shaped(value, _depth + 1, aliases) for value in nested):
                return True
            if nested and any(value.lstrip().startswith(("$", "<")) for value in nested):
                return True
            if nested:
                continue
        if effective_name in _FETCH_COMMAND_NAMES:
            return True
        if _git_network_command(segment):
            return True
        body = " ".join(segment)
        if effective_name in _SHELL_EXECUTION_NAMES:
            if any(token.startswith(("$", "<")) for token in segment[1:]):
                return True
            if re.search(
                r"\b(?:curl|fetch|http|http\.client|httpie|lynx|open_url|wget|w3m)\b",
                body,
                re.IGNORECASE,
            ):
                return True
        if effective_name in _NODE_COMMAND_NAMES and _node_request_shaped(body):
            return True
        if effective_name in _PYTHON_COMMAND_NAMES and _python_request_shaped(body):
            return True
        if effective_name in _RUBY_COMMAND_NAMES and _RUBY_NETWORK_REQUEST.search(body):
            return True
        if effective_name in _PHP_COMMAND_NAMES and _PHP_NETWORK_REQUEST.search(body):
            return True
        if effective_name in (_NODE_COMMAND_NAMES | _PYTHON_COMMAND_NAMES) and _runtime_code_is_opaque(segment):
            return True
        if any(token.startswith("$") for token in segment) and (
            _node_request_shaped(body) or _python_request_shaped(body)
        ):
            return True
        if _base64_followed_by_execution(body):
            return True
        if _url_is_retrieval_shaped(segment, body, effective_name):
            return True
    return False


def _url_argument_present(args: Any) -> bool:
    seen: set[int] = set()
    nodes = 0

    def visit(value: Any, depth: int) -> bool:
        nonlocal nodes
        if isinstance(value, str):
            return _has_http_url(value)
        if not isinstance(value, (dict, list, tuple)):
            return False
        marker = id(value)
        if marker in seen:
            return False
        if depth > _MAX_URL_ARGUMENT_DEPTH or nodes >= _MAX_URL_ARGUMENT_NODES:
            return True
        seen.add(marker)
        nodes += 1
        children = value.items() if isinstance(value, dict) else value
        for child in children:
            if isinstance(value, dict):
                key, item = child
                if visit(key, depth + 1) or visit(item, depth + 1):
                    return True
            elif visit(child, depth + 1):
                return True
        return False

    return visit(args, 0)


def _is_fetch_shaped(tool_name: str, args: Any) -> bool:
    raw_tool_name = tool_name.strip() if isinstance(tool_name, str) else str(tool_name or "")
    lowered = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", raw_tool_name).casefold()
    if lowered in _FETCH_TOOL_NAMES or lowered.startswith(("browser_", "web_")) or _HOST_BROWSER_TOOL.search(lowered):
        return True
    if lowered in _FETCH_TOOL_ALIASES and _url_argument_present(args):
        return True
    if not isinstance(args, dict):
        return False
    for key in _COMMAND_FIELDS:
        value = args.get(key)
        if isinstance(value, str) and _command_is_fetch_shaped(value):
            return True
    return False


def browser_drive_tool_guard(
    tool_name: str = "", args: Any = None, session_id: Any = "", **_: Any
) -> dict[str, str] | None:
    session = _browser_session_id(session_id)
    tool = str(tool_name or "")
    fetch_shaped = _is_fetch_shaped(tool, args)
    if session is None:
        return None
    if session not in _BROWSER_DRIVE_GUARD:
        if not fetch_shaped:
            return None
        if session in _BROWSER_DRIVE_EVICTED_SESSIONS:
            return {
                "action": "block",
                "message": (
                    f"{_BLOCKER_STATE}: the browser-drive route state exceeded its bounded session limit. "
                    "Release the tracked session before retrieving a page."
                ),
            }
        return None
    if not fetch_shaped:
        return None
    report = _BROWSER_DRIVE_REPORTS.get(session, _default_browser_driver_report())
    if report.get("status") == "available":
        return None
    blocker = report.get("blocker")
    if blocker not in {
        "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED",
        "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
        BROWSER_IDENTITY_BLOCKER,
    }:
        blocker = "BLOCKED_BROWSER_DRIVER_UNAVAILABLE"
    # The harness's canonical denial payload is {"action": "block", "message": ...}.
    # An invented shape is silently ignored, which is how the first attempt at this
    # guard passed its own tests and changed nothing on the host.
    return {
        "action": "block",
        "message": (
            f"{blocker}: this turn routed to lithermes:browser-drive and the "
            "capability probe measured no verified driver. Retrieving the page by another means is the "
            "substitution this contract exists to prevent. Report the blocker and mark what could not "
            "be established as [UNVERIFIED]."
        ),
    }


def pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    # Hermes identifies delegate_task children with platform="subagent".
    # Child goals may quote words such as "lit" or "lit-crucible" as inert task
    # context; re-running top-level activation here would contaminate the lane.
    if is_delegate_child_platform(str(kwargs.get("platform") or "")):
        release_browser_drive_state(kwargs.get("session_id"))
        return None
    # A first interactive top-level turn is the only plugin lifecycle point
    # where the Python payload can safely foreground an exact npm update. The
    # bridge owns its own recursion guard, timeout, transaction, rollback, and
    # receipt; it never contributes text to the model-facing context.
    try:
        _auto_update.pre_llm_call(**kwargs)
    except _auto_update.UnknownStateError:
        # A failed restore is not an advisory miss: continuing would let the
        # model operate against a profile whose installed payload is unknown.
        raise
    except Exception:
        # Ordinary registry/installer failures remain fail-open for this turn;
        # the transaction receipt records the redacted reason.
        pass
    user_message = str(kwargs.get("user_message") or "")
    requested_reader_mode = reader_facing_mode_from_user_request(user_message)
    reader_contract = reader_facing_contract_block(
        requested_reader_mode,
        authority="current_user_request" if requested_reader_mode is not None else None,
    )

    def with_reader_contract(context: str, *, compact: bool = False) -> dict[str, str]:
        contract = (
            reader_facing_contract_block(
                requested_reader_mode,
                authority=(
                    "current_user_request" if requested_reader_mode is not None else None
                ),
                compact=True,
            )
            if compact
            else reader_contract
        )
        return {"context": f"{context.rstrip()}\n\n{contract}"}

    session_id = _browser_session_id(kwargs.get("session_id")) or ""
    if session_id:
        # The guard belongs to this turn's route. Clear a previous browser route
        # before a new message can select another mode.
        release_browser_drive_guard(session_id)
    # Clear any stale ignite flag from an interrupted previous turn so it can't
    # leak the banner onto this turn's response. Re-added below only if THIS turn
    # is a keyword-lit turn — keeping the flag scoped to the current turn.
    _PENDING_IGNITE.discard(session_id)
    _PENDING_DISCIPLINE.pop(session_id, None)
    _PENDING_BLOCK.pop(session_id, None)
    # /litgoal & /lit-plan carry a legacy bind-goal marker. It remains a bounded
    # route envelope only; native /goal is user-managed and never mutated here.
    bind_obj = _extract_bind_goal(user_message)
    if bind_obj:
        return None
    # /lit and /lit-loop inject a run-context message. Durable run state already
    # exists, so skip re-injecting context without touching native /goal state.
    if "<lithermes-run-context>" in user_message:
        return None
    # Read-only recap route runs FIRST so `lit recap` never falls through to
    # the run-writing litwork path. It never binds a goal or writes run state.
    recap_args = detect_recap(user_message)
    if recap_args is not None:
        record_event(
            "litwork_trigger",
            session_id=session_id,
            platform=str(kwargs.get("platform") or ""),
            mode="lit-recap",
        )
        if session_id:
            _PENDING_IGNITE.add(session_id)
            _PENDING_DISCIPLINE[session_id] = "lit-recap"
            _evict_pending_browser_state()
        return {"context": command_lit_recap(recap_args)["agent_message"]}
    route = detect_lit_mode(user_message)
    if route is None:
        return None
    _deliverable_hedges.activate_skill(session_id, route.mode)

    record_event(
        "litwork_trigger",
        session_id=session_id,
        platform=str(kwargs.get("platform") or ""),
        mode=route.mode,
    )
    if session_id:
        _PENDING_IGNITE.add(session_id)
        _PENDING_DISCIPLINE[session_id] = discipline(route.mode)
        _evict_pending_browser_state()

    if route.blocked:
        if session_id:
            _PENDING_BLOCK[session_id] = route.block_message
            _evict_pending_browser_state()
        return with_reader_contract(build_natural_mode_context(route), compact=True)

    browser_report = None
    if route.mode == "browser-drive":
        # Measure once. The same structured report goes to the context and the guard.
        browser_report = _normalise_browser_driver_report(_browser_drive_probe_report())
        if session_id:
            arm_browser_drive_guard(session_id, browser_report)
    if route.mode == "lit-plan" and route.objective:
        planned = command_lit_plan(shlex.quote(route.objective))
        return with_reader_contract(
                f"{build_natural_mode_context(route)}\n\n"
                f"Durable plan: {planned['plan']}",
                compact=True,
        )
    if route.mode != "litwork":
        if route.mode in _SKILL_ROUTE_CONTRACTS:
            compact_contract = reader_facing_contract_block(
                requested_reader_mode,
                authority=(
                    "current_user_request" if requested_reader_mode is not None else None
                ),
                compact=True,
            )
            return {
                "context": build_natural_mode_context(
                    route,
                    browser_report=browser_report,
                    reader_contract=compact_contract,
                )
            }
        return with_reader_contract(
            build_natural_mode_context(route, browser_report=browser_report),
            compact=True,
        )

    direct = DIRECT_LIT_PATTERN.match(route.visible_message)
    run_context = ""
    if direct or route.objective:
        task = route.objective or _clamp_task(direct.group("task") if direct else "")
        if task:
            workspace = Path.cwd().resolve()
            run_dir = write_run_state(
                workspace,
                task=task,
                command="lit",
            )
            run_context = "\n\n" + build_run_agent_message(
                load_run_state(run_dir), include_reader_contract=False
            )
    lit_context = LIT_CONTEXT + litwork_ui_handoff(route.objective)
    if requested_reader_mode is None:
        if run_context:
            return {
                "context": (
                    f"{lit_context}{run_context}\n\n"
                    "#contract.parent_projection_final: reader disclosure still governs this parent reply; detailed run/evidence/DoneClaim clauses above remain internal unless requested or materially necessary."
                )
            }
        return {"context": lit_context}
    return with_reader_contract(LIT_CONTEXT_BASE + litwork_ui_handoff(route.objective) + run_context)


def transform_llm_output(**kwargs: Any) -> str | None:
    """Draw the route mark once, without forging or normalizing a model probe.

    Natural routes have no native display return channel before inference.
    Hermes applies this transform when the reply arrives. A blocked route still
    replaces unsafe output with its measured denial, independently of the probe.
    """
    session_id = str(kwargs.get("session_id") or "")
    block = _PENDING_BLOCK.pop(session_id, "")
    route = _PENDING_DISCIPLINE.pop(session_id, "litwork")
    pending = session_id in _PENDING_IGNITE
    _PENDING_IGNITE.discard(session_id)
    if not pending and not block:
        return None
    response = block or str(kwargs.get("response_text") or "")
    return acknowledge_reply(route, response)


def subagent_stop(**kwargs: Any) -> None:
    """Record each delegate_task child (e.g. a review lane) to the LitHermes ledger.

    Hermes fires this once per child after delegate_task finishes. Observer-only:
    the return value is ignored.
    """
    record_event(
        "subagent_stop",
        parent_session_id=str(kwargs.get("parent_session_id") or ""),
        child_role=str(kwargs.get("child_role") or ""),
        child_status=str(kwargs.get("child_status") or ""),
        duration_ms=kwargs.get("duration_ms"),
    )
    return None


try:
    from . import diagnostics as _diagnostics
except (ImportError, ModuleNotFoundError):
    import diagnostics as _diagnostics

rules = _rules

PLUGIN_ROOT = _diagnostics.PLUGIN_ROOT
HOOKS = _diagnostics.HOOKS
SLASH_COMMANDS = _diagnostics.SLASH_COMMANDS
GOAL_TOOLS = _diagnostics.GOAL_TOOLS
plugin_version = _diagnostics.plugin_version
version_line = _diagnostics.version_line
hermes_host_version = _diagnostics.hermes_host_version


def status_report() -> str:
    return _diagnostics.status_report(hermes_host_version())


def doctor_report() -> tuple[list[str], int]:
    return _diagnostics.doctor_report(hermes_host_version())
