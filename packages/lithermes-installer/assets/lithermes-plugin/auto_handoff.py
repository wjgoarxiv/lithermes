"""Opt-in automatic handoff for Hermes sessions.

Off by default. The user turns it on with ``/lit-handoff auto on <percent>`` or
with ``LITHERMES_AUTO_HANDOFF=1`` plus ``LITHERMES_AUTO_HANDOFF_PERCENT``. The
percent is always the user's own: there is no built-in value, and a value that
is not a whole number from 1 to 99 leaves the feature off.

How it works on this host, step by step:

1. ``post_api_request`` reports the prompt size of every model call. The plugin
   divides it by the model's context window and keeps the latest reading per
   session. Crossing the user's percent marks one pending directive.
2. ``pre_llm_call`` is the only hook whose return value reaches the model, so
   the directive rides on the next user turn. It asks the model to write the
   handoff with the bundled lit-handoff procedure, to put a one-time id line in
   the file, and to tell the user to run the compact command.
3. A plugin cannot start compaction on Hermes. The user runs it, or Hermes
   compacts on its own threshold. The next ``pre_llm_call`` notices the new
   compaction summary in the history and loads a bounded digest of the handoff,
   but only if the file carries this session's id and was written after the
   directive. Anything else is refused.
4. Hermes moves a compacted conversation to a new session id. When a turn
   arrives under an id this process has no waiting state for, carries a new
   compaction summary, and exactly one session with the same platform and
   profile is waiting for its reload, that state moves to the new id (a
   ``parent_session_id`` that names a waiting session settles it directly).
   With two or more waiting sessions and no named parent, nothing is adopted.

The feature fires once per crossing of the percent, never inside a tool call,
and never for delegate children. State is kept in memory per session; only the
user's switch and last percent persist, in Hermes home ``lithermes/``.

Save before compaction (on by default)
--------------------------------------

The steps above need the user to opt in and the model to write the file. A second,
quieter path is on unless the user turns it off with ``/lit-handoff auto save off``
or ``LITHERMES_HANDOFF_SAVE=0``. A plain plugin cannot act inside Hermes' compression
(``on_pre_compress`` belongs to memory providers, and ``post_compaction`` only observes
a compaction that already committed), so it saves earlier and reloads later:

1. ``post_api_request`` keeps the latest context reading per session, as above.
2. ``post_llm_call`` runs when a turn ends. Past ``SAVE_PERCENT`` of the window it writes
   ``<workspace>/.hermes/lithermes/handoff/auto-<session>.md`` from what the plugin
   already knows: the last request and reply, the litgoal card, and the open start-work
   plan with its current row. No model call; redacted and bounded.
3. ``post_compaction`` (committed compactions only) moves that save to the session Hermes
   continues in, and the next ``pre_llm_call`` carries a digest of it once.

A compaction that fires before any turn crossed ``SAVE_PERCENT`` has nothing to reload.
"""

from __future__ import annotations

import contextlib
import hashlib
import html
import importlib
import json
import os
import re
import secrets
import stat
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

try:
    from .core_runtime import assert_within_isolation, get_hermes_home, utc_now
    from .provider_metrics import _nonnegative_int, _value
    from .redaction import redact_text
    from .rules import constants as _RULE_CONSTANTS
    from .session_context import is_delegate_child_platform
    from .workspace import locate as locate_workspace
    from .workspace import resolve as resolve_workspace
except (ImportError, ModuleNotFoundError):
    from core_runtime import assert_within_isolation, get_hermes_home, utc_now  # type: ignore
    from provider_metrics import _nonnegative_int, _value  # type: ignore
    from redaction import redact_text  # type: ignore
    from rules import constants as _RULE_CONSTANTS  # type: ignore
    from session_context import is_delegate_child_platform  # type: ignore
    from workspace import locate as locate_workspace  # type: ignore
    from workspace import resolve as resolve_workspace  # type: ignore


FLAG = "LITHERMES_AUTO_HANDOFF"
SAVE_FLAG = "LITHERMES_HANDOFF_SAVE"
SAVE_PERCENT = 40
SAVE_FILE_PREFIX = "auto-"
MAX_SAVE_CHARS = 6000
MAX_SAVE_DIGEST_BYTES = 2000
MAX_PLAN_ROWS = 30
PERCENT_ENV = "LITHERMES_AUTO_HANDOFF_PERCENT"
SESSION_ENV = "HERMES_SESSION_ID"
SETTINGS_FILE = "auto-handoff.json"
ROUTE = "/lit-handoff auto"
SAVE_USAGE = f"Usage: {ROUTE} save on | save off"
SOURCE_ROOT = Path(__file__).resolve().parent / "vendor" / "handoff"
SOURCE_SKILL = SOURCE_ROOT / "SKILL.md"
SOURCE_TEMPLATE = SOURCE_ROOT / "templates" / "HANDOFF.md"
MAX_TRACKED_SESSIONS = 256
MAX_SETTINGS_BYTES = 4096
MAX_HANDOFF_READ_BYTES = 64 * 1024
MAX_HANDOFF_FILE_BYTES = 2 * 1024 * 1024
MAX_DIGEST_BYTES = 1400
MAX_DIGEST_LINES = 10
MAX_DIGEST_LINE_CHARS = 200
HOST_LOOKUP_SECONDS = 3.0
FAILED_LOOKUP_RETRY_SECONDS = 60.0
CLOCK_SLACK_SECONDS = 2.0
HANDOFF_CANDIDATES = ("HANDOFF.md", ".handoff/HANDOFF.md")
PERCENT_RULE = "a whole number from 1 to 99"
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_PERCENT = re.compile(r"[0-9]{1,2}")
_BARE_HANDOFF = re.compile(r"^\s*handoff\s*$", re.IGNORECASE)
_PLAN_ROW = re.compile(r"^\s*- \[([ xX])\] (.+?)\s*$")
_HEADING = re.compile(r"^#{1,4}\s*(.+?)\s*$")
_MARKDOWN_DECORATION = re.compile(r"[*_`]|<!--|-->")
_WANTED_SECTIONS = (("current state", "Current State"), ("next steps", "Next Steps"))
_LOCK = threading.RLock()
_SESSIONS: dict[str, dict[str, Any]] = {}
_WINDOWS: dict[tuple[str, str, str], tuple[int | None, float]] = {}
_LAST_SESSION: list[str] = [""]
# session id -> {"percent", "path", "relative", "saved_at", "saved_percent"}: the latest reading and the latest save.
_SAVE: dict[str, dict[str, Any]] = {}
# session id Hermes continues in after a compaction -> the save to hand back once.
_RELOAD: dict[str, dict[str, Any]] = {}


@dataclass(frozen=True)
class Setting:
    on: bool
    percent: int | None
    flag_source: str
    percent_source: str
    warnings: tuple[str, ...]


def _reset_for_tests() -> None:
    with _LOCK:
        _SESSIONS.clear()
        _WINDOWS.clear()
        _SAVE.clear()
        _RELOAD.clear()
        _LAST_SESSION[0] = ""


def parse_percent(text: Any) -> int | None:
    """Return the percent for a whole number from 1 to 99, else None."""
    value = str(text or "").strip()
    if value.endswith("%"):
        value = value[:-1]
    if not _PERCENT.fullmatch(value):
        return None
    number = int(value)
    return number if 1 <= number <= 99 else None


# ---- the user's switch -----------------------------------------------------

def settings_path() -> Path:
    return get_hermes_home() / "lithermes" / SETTINGS_FILE


def _read_saved() -> tuple[dict[str, Any], str]:
    """Return the saved switch and, when the file is damaged, one warning."""
    blank: dict[str, Any] = {"enabled": False, "percent": None, "exists": False, "save": True}
    try:
        fd = os.open(settings_path(), os.O_RDONLY | _NOFOLLOW)
    except OSError:
        return blank, ""
    try:
        with os.fdopen(fd, "rb") as handle:
            raw = handle.read(MAX_SETTINGS_BYTES + 1)
        data = json.loads(raw[:MAX_SETTINGS_BYTES].decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return blank, "the saved setting file could not be read, so automatic handoff stays off"
    if not isinstance(data, dict):
        return blank, "the saved setting file could not be read, so automatic handoff stays off"
    enabled = data.get("enabled") is True
    save = data.get("save") is not False
    percent = data.get("percent")
    if percent is None:
        return {"enabled": enabled, "percent": None, "exists": True, "save": save}, ""
    if isinstance(percent, bool) or not isinstance(percent, int) or not 1 <= percent <= 99:
        return {"enabled": enabled, "percent": None, "exists": True, "save": save}, (
            f"the saved percent is not {PERCENT_RULE}, so automatic handoff stays off"
        )
    return {"enabled": enabled, "percent": percent, "exists": True, "save": save}, ""


def _write_saved(enabled: bool, percent: int | None, save: bool = True) -> None:
    path = settings_path()
    assert_within_isolation(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    payload = {"enabled": enabled, "percent": percent, "save": save, "updated": utc_now().isoformat()}
    try:
        with contextlib.suppress(OSError):
            temporary.unlink()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, sort_keys=True)
        # os.replace swaps a symlink planted at the final path instead of writing through it.
        os.replace(temporary, path)
    except OSError:
        with contextlib.suppress(OSError):
            temporary.unlink()
        raise


def resolve(env: Mapping[str, str] | None = None) -> Setting:
    """Combine the environment and the saved switch into the effective setting.

    The environment wins when it names a value, so a shell profile can pin the
    feature; the saved value fills in otherwise. No percent is ever invented.
    """
    values = os.environ if env is None else env
    saved, saved_warning = _read_saved()
    warnings: list[str] = []

    raw_flag = (values.get(FLAG) or "").strip()
    if raw_flag:
        enabled, flag_source = raw_flag == "1", "environment"
    else:
        enabled, flag_source = bool(saved["enabled"]), ("saved" if saved["exists"] else "default")

    raw_percent = (values.get(PERCENT_ENV) or "").strip()
    if raw_percent:
        percent, percent_source = parse_percent(raw_percent), "environment"
        if percent is None:
            warnings.append(f"{PERCENT_ENV} is {raw_percent[:20]!r}, which is not {PERCENT_RULE}, so automatic handoff stays off")
    else:
        percent = saved["percent"]
        percent_source = "saved" if percent is not None else "none"
        if saved_warning:
            warnings.append(saved_warning)

    if enabled and percent is None and not warnings:
        warnings.append(f"it is switched on but no percent is chosen; run {ROUTE} on <percent>")
    return Setting(enabled and percent is not None, percent, flag_source, percent_source, tuple(warnings))


def save_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Whether the save-before-compaction path is on; it is, unless the user said otherwise.

    The environment wins when it holds ``0`` or ``1``; any other value falls through to the saved switch,
    and a damaged settings file leaves the save on.
    """
    values = os.environ if env is None else env
    raw = (values.get(SAVE_FLAG) or "").strip()
    if raw in ("0", "1"):
        return raw == "1"
    saved, _ = _read_saved()
    return bool(saved["save"])


def parse_route(raw_args: str) -> str | None:
    """Return the text after ``auto`` when the route's first word is exactly ``auto``."""
    parts = str(raw_args or "").strip().split(None, 1)
    if not parts or parts[0].lower() != "auto":
        return None
    return parts[1].strip() if len(parts) > 1 else ""


def _shown(value: Any) -> str:
    return redact_text(str(value))[:20]


def run_command(rest: str, env: Mapping[str, str] | None = None, session_id: str = "") -> str:
    """Handle ``/lit-handoff auto on <percent> | on | off | status`` as plain text."""
    values = os.environ if env is None else env
    tokens = str(rest or "").split()
    sub = tokens[0].lower() if tokens else "status"
    if sub == "status" and len(tokens) <= 1:
        return _status_text(values, session_id)
    if sub == "off" and len(tokens) == 1:
        return _command_off(values)
    if sub == "on" and len(tokens) <= 2:
        return _command_on(values, tokens[1] if len(tokens) == 2 else "")
    if sub == "save":
        return _command_save(values, tokens[1].lower() if len(tokens) == 2 else "")
    return f"Usage: {ROUTE} on <percent> | off | status | save on | save off"


def _command_save(values: Mapping[str, str], argument: str) -> str:
    if argument not in ("on", "off"):
        return SAVE_USAGE
    saved, _ = _read_saved()
    try:
        _write_saved(saved["enabled"], saved["percent"], argument == "on")
    except (OSError, RuntimeError) as exc:
        return f"Could not save the setting ({type(exc).__name__}); nothing changed."
    if argument == "on":
        line = (
            f"Handoff save before compaction is on. A turn that ends past {SAVE_PERCENT}% of the context window "
            "writes a handoff file, and the first turn after Hermes compacts gets a digest of it back."
        )
    else:
        line = "Handoff save before compaction is off. No file is written and nothing is reloaded."
    flag = (values.get(SAVE_FLAG) or "").strip()
    if flag in ("0", "1") and (flag == "1") != (argument == "on"):
        line += f" {SAVE_FLAG}={flag} is set in your environment and wins until you unset that variable."
    return line


def _command_off(values: Mapping[str, str]) -> str:
    saved, _ = _read_saved()
    try:
        _write_saved(False, saved["percent"], saved["save"])
    except (OSError, RuntimeError) as exc:
        return f"Could not save the setting ({type(exc).__name__}); nothing changed."
    lines = ["Automatic handoff is off."]
    if saved["percent"] is not None:
        lines.append(f"Your last percent, {saved['percent']}%, is remembered for the next time you turn it on.")
    if (values.get(FLAG) or "").strip() == "1":
        lines.append(f"{FLAG}=1 is set in your environment, so it stays on until you unset that variable.")
    return " ".join(lines)


def _command_on(values: Mapping[str, str], argument: str) -> str:
    saved, _ = _read_saved()
    if argument:
        percent = parse_percent(argument)
        if percent is None:
            return f"{_shown(argument)!r} is not {PERCENT_RULE}. Nothing changed."
    elif saved["percent"] is not None:
        percent = saved["percent"]
    else:
        return (
            f"Which percent should trigger it? Run {ROUTE} on <percent> with {PERCENT_RULE}. "
            "LitHermes has no built-in value and will not pick one for you."
        )
    try:
        _write_saved(True, percent, saved["save"])
    except (OSError, RuntimeError) as exc:
        return f"Could not save the setting ({type(exc).__name__}); nothing changed."
    lines = [
        f"Automatic handoff is ON at {percent}%. Once a model call passes {percent}% of the context window, "
        f"your next message carries a request to write a handoff, and you then run {_compact_command()}. "
        "It starts with your next message."
    ]
    flag = (values.get(FLAG) or "").strip()
    if flag and flag != "1":
        lines.append(f"{FLAG}={_shown(flag)} is set in your environment, which keeps it off until you unset that variable.")
    environment_percent = (values.get(PERCENT_ENV) or "").strip()
    if environment_percent:
        lines.append(f"{PERCENT_ENV}={_shown(environment_percent)} is set in your environment and wins over the saved {percent}%; unset it to use {percent}%.")
    lines.append(_host_comparison(resolve(values))[0])
    return "\n".join(lines)


def _status_text(values: Mapping[str, str], session_id: str) -> str:
    setting = resolve(values)
    if setting.on:
        head = f"Automatic handoff: ON at {setting.percent}% (percent from your {setting.percent_source} setting)"
    elif setting.warnings:
        head = f"Automatic handoff: off ({'; '.join(setting.warnings)})"
    else:
        head = "Automatic handoff: off"
    lines = [head]
    if setting.on:
        lines.append(_reading_line(session_id or (values.get(SESSION_ENV) or "").strip() or _LAST_SESSION[0]))
        lines.append(_host_comparison(setting)[0])
    lines.append(save_status_line(values))
    return "\n".join(lines)


def save_status_line(env: Mapping[str, str] | None = None) -> str:
    if save_enabled(env):
        return f"Handoff save before compaction: on (a turn that ends past {SAVE_PERCENT}% of the window; turn off with {ROUTE} save off)"
    return f"Handoff save before compaction: off (turn on with {ROUTE} save on)"


def _reading_line(session_id: str) -> str:
    with _LOCK:
        state = _SESSIONS.get(session_id)
        reading = dict(state) if state else {}
    if not reading or reading.get("used") is None:
        return "Last reading in this session: no reading yet"
    if reading.get("percent") is None:
        return "Last reading in this session: unavailable (the model's context window is unknown)"
    return (
        f"Last reading in this session: {reading['percent']:.0f}% "
        f"({reading['used']:,} of {reading['window']:,} tokens)"
    )


def status_line(env: Mapping[str, str] | None = None) -> str:
    setting = resolve(env)
    if setting.on:
        return f"Automatic handoff: on at {setting.percent}%"
    if setting.warnings:
        return f"Automatic handoff: off ({'; '.join(setting.warnings)})"
    return "Automatic handoff: off"


def doctor_line(env: Mapping[str, str] | None = None) -> tuple[str, str]:
    """Return (tag, text) for doctor: NOTE when off, WARN when it cannot work as chosen."""
    setting = resolve(env)
    if setting.warnings and not setting.on:
        return "WARN", f"Automatic handoff: off ({'; '.join(setting.warnings)})"
    if not setting.on:
        return "NOTE", "Automatic handoff: off"
    point, reason = host_estimate()
    if point is None:
        return "OK", f"Automatic handoff: on at {setting.percent}% ({reason}; no comparison with Hermes' own compaction point)"
    if setting.percent >= round(point):
        return "WARN", (
            f"Automatic handoff: on at {setting.percent}%, but Hermes compacts at about {point:.0f}% of the window, "
            "so Hermes compacts first; choose a lower percent"
        )
    return "OK", f"Automatic handoff: on at {setting.percent}% (Hermes compacts at about {point:.0f}% of the window)"


def _host_comparison(setting: Setting) -> tuple[str, bool]:
    """Say where Hermes' own compaction sits next to the user's percent; True when it wins."""
    point, reason = host_estimate()
    if point is None:
        return f"Hermes' own compaction point: unavailable ({reason})", False
    if setting.percent >= round(point):
        return (
            f"Heads up: Hermes compacts at about {point:.0f}% of the window, so it compacts first and "
            "no handoff is written. Choose a lower percent.",
            True,
        )
    return f"Hermes' own compaction point is about {point:.0f}% of the window, above yours.", False


# ---- the host's own compaction point ---------------------------------------

def _yaml_module() -> Any:
    try:
        return importlib.import_module("yaml")
    except ImportError:
        return None


def _host_config() -> dict[str, Any]:
    yaml = _yaml_module()
    if yaml is None:
        return {"_lithermes_yaml": "missing"}
    try:
        path = get_hermes_home() / "config.yaml"
        if path.stat().st_size > 1024 * 1024:
            return {}
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError, yaml.YAMLError):
        return {}
    return data if isinstance(data, dict) else {}


def _host_facts() -> dict[str, Any]:
    """Read the running host's own compaction defaults; empty outside Hermes."""
    facts: dict[str, Any] = {}
    with contextlib.suppress(Exception):
        module = importlib.import_module("agent.context_compressor")
        facts["floor"] = (int(module._SMALL_CTX_WINDOW_LIMIT), float(module._SMALL_CTX_THRESHOLD_PERCENT))
    with contextlib.suppress(Exception):
        defaults = importlib.import_module("hermes_cli.config_defaults").DEFAULT_CONFIG["compression"]
        if isinstance(defaults, dict):
            facts["compression"] = dict(defaults)
    return facts


def _ratio(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if 0 < value <= 1 else None


def host_trigger_percent(
    window: int,
    compression: Mapping[str, Any],
    model: str,
    floor: tuple[int, float] | None = None,
) -> float | None:
    """Estimate where Hermes' own compaction starts, as a percent of the window.

    Follows the documented compression settings: the ratio (with a per-model
    override and the small-window floor when the host has one) and the absolute
    token cap. Returns None when compression is switched off.
    """
    if compression.get("enabled") is False:
        return None
    ratio = _ratio(compression.get("threshold")) or 0.50
    overrides = compression.get("model_thresholds")
    if isinstance(overrides, Mapping) and model:
        keys = [key for key in overrides if isinstance(key, str) and key and key.lower() in model.lower()]
        if keys:
            best = max(keys, key=len)
            ratio = _ratio(overrides[best]) or ratio
    if floor is not None and window < floor[0]:
        ratio = max(ratio, floor[1])
    trigger = int(window * ratio)
    cap = compression.get("threshold_tokens")
    if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0:
        trigger = min(trigger, cap, window)
    return trigger * 100 / window


def _bounded(function: Callable[[], Any], seconds: float = HOST_LOOKUP_SECONDS) -> Any:
    """Run a host lookup that may touch the network, giving up after a few seconds."""
    box: list[Any] = [None]

    def work() -> None:
        with contextlib.suppress(Exception):
            box[0] = function()

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(seconds)
    return box[0]


def _host_context_length(model: str, base_url: str, provider: str) -> int | None:
    """Ask the running Hermes for the model's context window; None outside a host."""
    function = importlib.import_module("agent.model_metadata").get_model_context_length
    value = function(model, base_url or "", provider=provider or "")
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _context_window(model: str, base_url: str, provider: str, config: Mapping[str, Any] | None = None) -> int | None:
    key = (model, base_url, provider)
    now = time.monotonic()
    with _LOCK:
        cached = _WINDOWS.get(key)
        if cached and (cached[0] is not None or cached[1] > now):
            return cached[0]
    section = (config if config is not None else _host_config()).get("model")
    section = section if isinstance(section, Mapping) else {}
    configured = section.get("context_length")
    window: int | None = None
    if isinstance(configured, int) and not isinstance(configured, bool) and configured > 0:
        if not section.get("default") or section.get("default") == model:
            window = configured
    if window is None and model:
        found = _bounded(lambda: _host_context_length(model, base_url, provider))
        window = found if isinstance(found, int) and found > 0 else None
    with _LOCK:
        while len(_WINDOWS) >= MAX_TRACKED_SESSIONS:
            _WINDOWS.pop(next(iter(_WINDOWS)), None)
        _WINDOWS[key] = (window, now + FAILED_LOOKUP_RETRY_SECONDS)
    return window


def host_estimate() -> tuple[float | None, str]:
    """Estimate Hermes' compaction point for the configured model, or say why not."""
    config = _host_config()
    if config.get("_lithermes_yaml") == "missing":
        return None, "PyYAML is not importable, so the compaction comparison is missing"
    section = config.get("model") if isinstance(config.get("model"), Mapping) else {}
    model = str(section.get("default") or "")
    window = _context_window(model, str(section.get("base_url") or ""), str(section.get("provider") or ""), config)
    if window is None:
        return None, "the model's context window is unknown (window unknown)"
    facts = _host_facts()
    compression = dict(facts.get("compression") or {})
    user = config.get("compression")
    if isinstance(user, Mapping):
        compression.update(user)
    point = host_trigger_percent(window, compression, model, facts.get("floor"))
    if point is None:
        return None, "Hermes compression is switched off"
    return point, ""


def _compact_command() -> str:
    """The slash command that compacts here; only Hermes 0.19 and later know /compact."""
    try:
        resolve_command = importlib.import_module("hermes_cli.commands").resolve_command
        return "/compact" if resolve_command("compact") else "/compress"
    except Exception:  # noqa: BLE001 - outside a host the plain wording is the right default
        return "/compact"


# ---- reading the model's context use ----------------------------------------

def _prompt_tokens(usage: Any) -> int | None:
    if usage is None:
        return None
    prompt = _nonnegative_int(_value(usage, "prompt_tokens"))
    if prompt is not None:
        return prompt
    parts = [_nonnegative_int(_value(usage, name)) for name in ("input_tokens", "cache_read_tokens", "cache_write_tokens")]
    return sum(parts) if all(part is not None for part in parts) else None


def _state(session_id: str) -> dict[str, Any]:
    state = _SESSIONS.get(session_id)
    if state is None:
        while len(_SESSIONS) >= MAX_TRACKED_SESSIONS:
            _SESSIONS.pop(next(iter(_SESSIONS)), None)
        state = _SESSIONS[session_id] = {
            "percent": None, "used": None, "window": None,
            "above": False, "pending": False, "awaiting": False, "dropped": False,
            "nonce": "", "fired_at": 0.0, "cwd": "", "summary": "", "platform": "", "home": "",
        }
    return state


def begin_session(session_id: Any) -> None:
    with _LOCK:
        _SESSIONS.pop(str(session_id or ""), None)


def release_session(session_id: Any) -> None:
    begin_session(session_id)


def post_api_request(**kwargs: Any) -> None:
    """Keep the latest context reading and mark a crossing of the user's percent."""
    setting = resolve()
    saving = save_enabled()
    if not setting.on and not saving:
        return None
    session_id = str(kwargs.get("session_id") or "")
    if not session_id or is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return None
    used = _prompt_tokens(kwargs.get("usage"))
    if used is None:
        return None
    window = _context_window(str(kwargs.get("model") or ""), str(kwargs.get("base_url") or ""), str(kwargs.get("provider") or ""))
    if saving:
        _note_save_reading(session_id, None if window is None else used * 100 / window)
    if not setting.on:
        return None
    with _LOCK:
        state = _state(session_id)
        _LAST_SESSION[0] = session_id
        state["used"], state["window"] = used, window
        if window is None:
            state["percent"] = None
            return None
        percent = used * 100 / window
        state["percent"] = percent
        if percent >= setting.percent:
            if not state["above"]:
                state["above"] = True
                if not state["awaiting"]:
                    state["pending"] = True
        else:
            state["above"] = False
            state["pending"] = False
            if state["awaiting"]:
                state["dropped"] = True
    return None


# ---- save before compaction, on by default ----------------------------------

def _note_save_reading(session_id: str, percent: float | None) -> None:
    with _LOCK:
        entry = _SAVE.get(session_id)
        if entry is None:
            while len(_SAVE) >= MAX_TRACKED_SESSIONS:
                _SAVE.pop(next(iter(_SAVE)), None)
            entry = _SAVE[session_id] = {"percent": None, "path": "", "relative": "", "saved_at": 0.0, "saved_percent": 0.0}
        entry["percent"] = percent


def _siblings() -> tuple[Any, Any]:
    """The handoff card and re-entry modules, imported on first use so this module loads without them."""
    try:
        from . import handoff_card, lit_reentry
    except (ImportError, ModuleNotFoundError):
        import handoff_card  # type: ignore
        import lit_reentry  # type: ignore
    return handoff_card, lit_reentry


def _quoted(value: Any, limit: int) -> str:
    return "> " + " ".join(str(value if value is not None else "").split())[:limit]


def _goal_lines(workspace: Path, session_id: str) -> list[str]:
    try:
        card = _siblings()[0].build_card(workspace, session_id)
    except Exception:  # noqa: BLE001 - a save never costs the turn; the section is just left out
        return []
    if not card:
        return []
    rows = [
        f"- [{'x' if row['status'] == 'pass' else ' '}] {row['id']} {row['text']}" for row in card["criteria"][:8]
    ]
    return ["## Goal", f"- {card['goal']['title']} ({card['goal']['status']})", f"- Next step: {card['next_step']}", *rows, ""]


def _plan_lines(workspace: Path) -> list[str]:
    """The open start-work plan's rows, with the first unticked one named as current."""
    try:
        work = _siblings()[1]._resumable_work(workspace)
        if not work:
            return []
        state = json.loads((Path(work["dir"]) / "state.json").read_text(encoding="utf-8"))
        plan = Path(str(state.get("plan") or ""))
        # Opened without following a link, like the other reads here: a linked plan is not carried.
        fd = os.open(str(plan), os.O_RDONLY | _NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_HANDOFF_FILE_BYTES:
                return []
            text = handle.read(MAX_HANDOFF_FILE_BYTES).decode("utf-8", "replace")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return []
    rows = [(match.group(1) != " ", match.group(2)[:160]) for match in map(_PLAN_ROW.match, text.splitlines()) if match]
    if not rows:
        return []
    current = next((row for done, row in rows if not done), "")
    lines = [f"## Plan {plan.name}"]
    if current:
        lines.append(f"Current row: {current}")
    lines += [f"- [{'x' if done else ' '}] {row}" for done, row in rows[:MAX_PLAN_ROWS]]
    return [*lines, ""]


def _save_body(session_id: str, percent: float, workspace: Path, user_message: Any, reply: Any) -> str:
    lines = [
        f"# Auto handoff - saved {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        f"- Session: {session_id}",
        f"- Context use: {percent:.0f}% of the model's window when this turn ended",
        "",
        *_plan_lines(workspace),
        *_goal_lines(workspace, session_id),
        "## Last request",
        _quoted(user_message, 400),
        "",
        "## Last reply",
        _quoted(reply, 600),
        "",
    ]
    return redact_text("\n".join(lines))[:MAX_SAVE_CHARS]


def _write_save(workspace: Path, session_id: str, body: str) -> tuple[Path, str] | None:
    handoff_card, _ = _siblings()
    safe = handoff_card._safe_id(session_id)
    if not safe:
        return None
    target = handoff_card.handoff_dir(workspace) / f"{SAVE_FILE_PREFIX}{safe}.md"
    try:
        assert_within_isolation(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        handoff_card._write_atomic(target, body)
    except (OSError, RuntimeError, ValueError):
        return None
    return target, str(target.relative_to(workspace))


def post_llm_call(**kwargs: Any) -> None:
    """Turn end: past SAVE_PERCENT of the window, write the handoff file for this session."""
    if not save_enabled():
        return None
    session_id = str(kwargs.get("session_id") or "")
    platform = str(kwargs.get("platform") or "")
    if not session_id or is_delegate_child_platform(platform) or platform.strip().lower() == "cron":
        return None
    with _LOCK:
        entry = _SAVE.get(session_id)
        percent = entry["percent"] if entry else None
    if percent is None or percent < SAVE_PERCENT:
        return None
    workspace = resolve_workspace(session_id=session_id, task_id=kwargs.get("task_id"))
    if workspace is None:
        return None
    written = _write_save(
        workspace, session_id, _save_body(session_id, percent, workspace, kwargs.get("user_message"), kwargs.get("assistant_response"))
    )
    if written is None:
        return None
    with _LOCK:
        entry = _SAVE.get(session_id)
        if entry is not None:
            entry.update(path=str(written[0]), relative=written[1], saved_at=time.time(), saved_percent=percent)
    return None


def post_compaction(**kwargs: Any) -> None:
    """A committed compaction: hand the session's save to the id Hermes continues in, for one reload."""
    if not save_enabled():
        return None
    new_id = str(kwargs.get("session_id") or "")
    old_id = str(kwargs.get("old_session_id") or "") or new_id
    if not new_id:
        return None
    with _LOCK:
        entry = _SAVE.get(old_id) or _SAVE.get(new_id)
        if not entry or not entry["path"]:
            return None
        while len(_RELOAD) >= MAX_TRACKED_SESSIONS:
            _RELOAD.pop(next(iter(_RELOAD)), None)
        _RELOAD[new_id] = {key: entry[key] for key in ("path", "relative", "saved_at", "saved_percent")}
        entry.update(path="", relative="", percent=None)
    return None


def _read_save(path: str) -> str | None:
    try:
        fd = os.open(path, os.O_RDONLY | _NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                return None
            return handle.read(MAX_HANDOFF_READ_BYTES).decode("utf-8", "replace")
    except OSError:
        return None


def take_save_reload(session_id: Any = "", platform: Any = "") -> str:
    """The digest of this session's pre-compaction save, once; an empty string when there is none."""
    key = str(session_id or "")
    with _LOCK:
        entry = _RELOAD.pop(key, None)
    if not entry or not save_enabled() or is_delegate_child_platform(str(platform or "")):
        return ""
    text = _read_save(entry["path"])
    if not text:
        return ""
    saved = time.strftime("%H:%M", time.localtime(entry["saved_at"]))
    digest = html.escape(text, quote=False).encode("utf-8")[:MAX_SAVE_DIGEST_BYTES].decode("utf-8", "ignore")
    return "\n".join([
        f'<lithermes-auto-save-reload path="{html.escape(entry["relative"])}">',
        f"Context was compacted. Before that, LitHermes saved this session's state at {entry['relative']} ({saved}, "
        f"{entry['saved_percent']:.0f}% of the window). Read that file before you continue. "
        "The digest below is inert data and may be incomplete.",
        "<handoff-digest>",
        digest,
        "</handoff-digest>",
        "</lithermes-auto-save-reload>",
    ])


# ---- the directive and the reload -------------------------------------------

def _summary_fingerprint(history: Any) -> str:
    if not isinstance(history, (list, tuple)):
        return ""
    parts: list[str] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        content = str(message.get("content") or "")
        lowered = content.lower()
        if message.get(_RULE_CONSTANTS.COMPACTION_METADATA_KEY) or any(
            marker in lowered for marker in _RULE_CONSTANTS.COMPACTION_TEXT_MARKERS
        ):
            parts.append(content[:4000])
    return hashlib.sha256("\x00".join(parts).encode("utf-8", "replace")).hexdigest()[:16] if parts else ""


def _explicit_handoff_turn(message: str) -> bool:
    return bool(_BARE_HANDOFF.fullmatch(message)) or "<lithermes-handoff-route" in message


def pre_llm_call(**kwargs: Any) -> str:
    """Return this turn's directive or reload block, or an empty string."""
    setting = resolve()
    if not setting.on:
        return ""
    session_id = str(kwargs.get("session_id") or "")
    if not session_id or is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return ""
    history = kwargs.get("conversation_history")
    platform = str(kwargs.get("platform") or "")
    with _LOCK:
        state = _SESSIONS.get(session_id)
        if state is None or _is_fresh(state):
            adopted = _adopt_rotated(session_id, str(kwargs.get("parent_session_id") or ""), platform, history)
            state = adopted or state
        if state is None:
            return ""
        _LAST_SESSION[0] = session_id
        if state["awaiting"]:
            fingerprint = _summary_fingerprint(history)
            if fingerprint and fingerprint != state["summary"]:
                state["awaiting"], state["dropped"] = False, False
                return _reload_block(state)
            if state["dropped"]:
                state["awaiting"], state["dropped"] = False, False
            return ""
        if not state["pending"] or _explicit_handoff_turn(str(kwargs.get("user_message") or "")):
            return ""
        if state["percent"] is None:
            return ""
        nonce = secrets.token_hex(6)
        block = _directive_block({**state, "nonce": nonce}, setting.percent)
        state["pending"], state["awaiting"], state["dropped"] = False, True, False
        state["nonce"] = nonce
        state["fired_at"] = time.time()
        state["cwd"] = str(locate_workspace(session_id=session_id) or os.getcwd())
        state["summary"] = _summary_fingerprint(history)
        state["platform"], state["home"] = platform, str(get_hermes_home())
        return block


def _is_fresh(state: Mapping[str, Any]) -> bool:
    """A state that has only read usage: never crossed, never fired."""
    return not (state["awaiting"] or state["pending"] or state["nonce"])


def _adopt_rotated(
    session_id: str, parent_session_id: str, platform: str, history: Any
) -> dict[str, Any] | None:
    """Move a waiting state to the new id Hermes gave the conversation when it compacted.

    Returns the moved state, or None when nothing is adopted. Caller holds the lock.
    """
    if not any(value["awaiting"] for value in _SESSIONS.values()):
        return None
    summary = _summary_fingerprint(history)
    if not summary:
        return None
    home = str(get_hermes_home())
    waiting = {
        key: value for key, value in _SESSIONS.items()
        if key != session_id and value["awaiting"] and value["platform"] == platform
        and value["home"] == home and summary != value["summary"]
    }
    if parent_session_id in waiting:
        old_id = parent_session_id
    elif len(waiting) == 1:
        old_id = next(iter(waiting))
    else:
        return None
    state = waiting[old_id]
    fresh = _SESSIONS.pop(session_id, None)
    if fresh is not None:
        for name in ("percent", "used", "window", "above"):
            state[name] = fresh[name]
    del _SESSIONS[old_id]
    _SESSIONS[session_id] = state
    return state


def _directive_block(state: Mapping[str, Any], percent: int) -> str:
    return "\n".join([
        f'<lithermes-auto-handoff id="{state["nonce"]}" used="{state["percent"]:.0f}%" threshold="{percent}%">',
        f"This conversation has used {state['percent']:.0f}% of the model's context window, past the {percent}% "
        "the user chose for an automatic handoff. Write the handoff now, before anything else:",
        f"1. Read {SOURCE_SKILL} and follow that lit-handoff procedure. The template is {SOURCE_TEMPLATE}.",
        f"2. Save the handoff where the procedure says, and put this exact line on its own line near the top: auto-handoff-id: {state['nonce']}",
        f"3. Read the file back, then tell the user exactly this one line: Handoff saved. Run {_compact_command()} now.",
        "After that, carry on with the user's request. The user set this up in their own settings.",
        "</lithermes-auto-handoff>",
    ])


def _marker_on_line(line: str, nonce: str) -> bool:
    """True when the line carries this session's marker, however Markdown dresses it (bullet, quote,
    bold, italics, backticks, comment, a leading label). The id must match exactly and end on a
    non-hex character."""
    plain = _MARKDOWN_DECORATION.sub("", line)
    return re.search(rf"(?i:auto-handoff-id)[ \t]*:[ \t]*{re.escape(nonce)}(?![0-9a-f])", plain) is not None


def _find_handoff(state: Mapping[str, Any]) -> tuple[str, float, str] | None:
    found: tuple[str, float, str] | None = None
    for relative in HANDOFF_CANDIDATES:
        path = Path(state["cwd"]) / relative
        try:
            info = os.lstat(path)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_HANDOFF_FILE_BYTES:
                continue
            if info.st_mtime < state["fired_at"] - CLOCK_SLACK_SECONDS:
                continue
            fd = os.open(path, os.O_RDONLY | _NOFOLLOW)
            with os.fdopen(fd, "rb") as handle:
                text = handle.read(MAX_HANDOFF_READ_BYTES).decode("utf-8", "replace")
        except OSError:
            continue
        if not any(_marker_on_line(line, state["nonce"]) for line in text.splitlines()):
            continue
        if found is None or info.st_mtime > found[1]:
            found = (relative, info.st_mtime, text)
    return found


def _digest(text: str, nonce: str) -> str:
    sections: dict[str, list[str]] = {}
    current = ""
    body: list[str] = []
    for line in text.splitlines():
        heading = _HEADING.match(line)
        if heading:
            title = heading.group(1).lower()
            current = next((label for key, label in _WANTED_SECTIONS if key in title), "")
            continue
        if nonce in line or _marker_on_line(line, nonce) or not line.strip():
            continue
        if len(body) < MAX_DIGEST_LINES:
            body.append(line.strip()[:MAX_DIGEST_LINE_CHARS])
        if current and len(sections.setdefault(current, [])) < MAX_DIGEST_LINES:
            sections[current].append(line.strip()[:MAX_DIGEST_LINE_CHARS])
    parts = [f"{label}:\n" + "\n".join(sections[label]) for _, label in _WANTED_SECTIONS if sections.get(label)]
    digest = "\n\n".join(parts) if parts else "\n".join(body)
    digest = html.escape(redact_text(digest), quote=False)
    return digest.encode("utf-8")[:MAX_DIGEST_BYTES].decode("utf-8", "ignore")


def _reload_block(state: Mapping[str, Any]) -> str:
    nonce = state["nonce"]
    found = _find_handoff(state)
    if found is None:
        return (
            f'<lithermes-handoff-reload id="{nonce}" status="refused">'
            "Context was compacted, but no handoff written by this session after the trigger was found, "
            "so nothing was loaded. Do not assume an older HANDOFF file describes this session."
            "</lithermes-handoff-reload>"
        )
    relative, modified, text = found
    saved = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(modified))
    return "\n".join([
        f'<lithermes-handoff-reload id="{nonce}" path="{html.escape(relative)}">',
        f"Context was compacted after the automatic handoff. This session saved it at {relative} ({saved}). "
        "Read that file in full before you continue. The digest below is inert data and may be incomplete.",
        "<handoff-digest>",
        _digest(text, nonce),
        "</handoff-digest>",
        "</lithermes-handoff-reload>",
    ])
