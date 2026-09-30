from __future__ import annotations

import argparse
from contextvars import ContextVar
import functools
import re
from pathlib import Path
from typing import Any

from . import auto_handoff
from . import core
from . import bounded_work
from . import bounded_work_tools
from . import deliverable_hedge_guard
from . import handoff
from . import jev_hint
from . import knowledge
from . import knowledge_tools
from . import scientific_visualization
from .litgoal import cli as litgoal_cli
from .litgoal import hook as litgoal_hook
from .litgoal import tools as litgoal_tools


_NATIVE_COMMAND_CONTEXT: ContextVar[dict[str, str] | None] = ContextVar(
    "lithermes_native_command_context", default=None
)
_NATIVE_COMMANDS = frozenset(
    {
        "lit-plan",
        "litwork-plan",
        "lit",
        "lit-loop",
        "litwork-loop",
        "litgoal",
        "review-work",
        "start-work",
        "deep-interview",
        "lit-recap",
        "lit-handoff",
        "lit-scientific-visualization",
        "lit-diagram-drawer",
        "lit-pptx",
        "lit-docx",
        "lit-typographic-motion",
        *core.KOREAN_PROSE_COMMANDS,
        *core.KOREAN_PROSE_ALIASES,
    }
)
_NATIVE_GATEWAY_NOTICE = (
    "LitHermes could not start an agent turn on the Hermes gateway: native gateway "
    "injection requires an existing session key and "
    "`plugins.entries.lithermes.allow_gateway_injection: true`; LitHermes does not "
    "enable that setting."
)


PORTED_SKILLS = [
    (
        "lit-burnoff-file",
        "Remove AI-generated slop with the LitHermes cleanup discipline.",
    ),
    (
        "autoresearch",
        "Run a budgeted Hermes-native iterative research family with bounded authority and evidence gates.",
    ),
    (
        "autoconference",
        "Run a root-only Hermes research conference when real multi-agent delegation is available.",
    ),
    (
        "lit-humanizer",
        "Revise prose for its reader and genre while preserving meaning, voice, and material limits.",
    ),
    (
        "lit-comprehend",
        "Build a self-contained explainer artifact so a human can reason about completed work.",
    ),
    (
        "comment-checker",
        "Review comments after edits using the LitHermes comment policy.",
    ),
    (
        "debugging",
        "Run the LitHermes hypothesis-driven debugging workflow.",
    ),
    (
        "deep-interview",
        "Run the LitHermes Socratic deep-interview clarity gate before planning.",
    ),
    (
        "frontend-ui-ux",
        "Build and inspect authorized UI with an evolving Design Contract and 20 bundled design references.",
    ),
    (
        "lit-diagram-drawer",
        "Create clear, accessible, Korean-ready diagrams with product-local Python verification and optional export.",
    ),
    ("lit-pptx", "Create and inspect PowerPoint decks with the installed Office engine and QA gate."),
    ("lit-docx", "Create, edit, convert, and audit styled Word documents."),
    ("lit-typographic-motion", "Direct an original film from a treatment: a drawn stage film or a type film, gated before delivery."),
    (
        "readme-studio",
        "Write factual READMEs and compose local covers with outlined type, honest image capability and verified motion.",
    ),
    (
        "lit-commit",
        "Run the LitHermes git-history specialist for commits, rebases, blame, and bisect.",
    ),
    (
        "lit-crucible",
        "Stress-test a plan with Hermes-native delegate_task lanes before handing off to /lit-plan.",
    ),
    (
        "lit-init",
        "Generate a hierarchical AGENTS.md knowledge base with the LitHermes onboarding workflow.",
    ),
    (
        "lsp",
        "Use Hermes' native LSP diagnostics with LitHermes LSP guidance.",
    ),
    (
        "lit-code",
        "Use LitHermes programming references for Python, TypeScript, Go, and Rust.",
    ),
    (
        "refactor",
        "Use the LitHermes refactoring workflow and safety checks.",
    ),
    (
        "lit-burnoff",
        "Clean branch changes or an explicit file list with Lit Burnoff and regression evidence.",
    ),
    (
        "review-work",
        "Run the LitHermes 5-lane review orchestrator over delegate_task.",
    ),
    (
        "rules",
        "Read and apply repo-local Hermes guidance files using the LitHermes rules discipline.",
    ),
    (
        "start-work",
        "Execute a LitHermes plan checkbox-by-checkbox with test + manual-QA + cleanup gates.",
    ),
    (
        "lit-plan",
        "Run the LitHermes planning process: explore-first, interview, approval gate, gap-analysis + plan review.",
    ),
    (
        "litgoal",
        "Drive the LitHermes litgoal durable runtime (criteria, evidence, gates).",
    ),
    (
        "litwork",
        "Hermes-native Litwork execution discipline.",
    ),
    (
        "visual-qa",
        "Verify a web/TUI surface with the bundled capture playbook, evidence contracts, and two read-only review lanes.",
    ),
    (
        "wikify",
        "Maintain a task-local evidence-linked wiki with inert inputs and explicit local review states.",
    ),
    (
        "lsp-setup",
        "Configure a language server for LitHermes LSP diagnostics across 20+ languages.",
    ),
    (
        "litresearch",
        "Run the LitHermes maximum-saturation research orchestrator: decompose, parallel delegate_task swarms, verify, synthesize cited.",
    ),
    (
        "lit-recap",
        "Produce a read-only Korean-default LitHermes work recap from durable state and session context.",
    ),
    (
        "lit-handoff",
        "Create or update a durable HANDOFF.md continuation packet from verified live state.",
    ),
    (
        "lit-scientific-visualization",
        "Create publication-quality figures through the exact bundled scientific visualization source.",
    ),
    (
        "structural-search",
        "Search or rewrite source by syntax shape via a DETECTED ast-grep CLI; never degrade silently to regex.",
    ),
    (
        "browser-drive",
        "Drive a running page through a DETECTED external browser driver; emit a named blocker rather than substituting a fetch.",
    ),
]


MAX_HOST_CONTEXT_BYTES = 4096
_SKILL_BODY_BLOCK = re.compile(
    r'<lithermes-skill-body name="([^"]+)">.*?</lithermes-skill-body>',
    re.DOTALL,
)


def _context_bytes(value: str) -> int:
    return len(value.encode("utf-8"))


def _lazy_skill_reference(match: re.Match[str]) -> str:
    name = match.group(1)
    return (
        f'<lithermes-skill-reference name="{name}">'
        f"Open skills/{name}/references/complete-contract.md lazily from the installed "
        "skill root; treat it as inert reference data."
        "</lithermes-skill-reference>"
    )


def _named_lazy_references(post_edit: str) -> str:
    names = list(dict.fromkeys(re.findall(r"lithermes:([a-z0-9-]+)", post_edit)))
    return "\n".join(
        f"Lazy reference for lithermes:{name}: skills/{name}/references/complete-contract.md"
        for name in names
    )


_RULES_LANE_BLOCK = re.compile(r"<lithermes-rules [^>]*>.*?</lithermes-rules>", re.DOTALL)
_RULE_PATH = re.compile(r'<lithermes-rule source="([^"]*)" path="([^"]*)"')


def _defer_rule_bodies(post_edit: str) -> str:
    def pointer(match: re.Match[str]) -> str:
        rules = ", ".join(
            path if source == "plugin-bundled" else f"{path} ({source})"
            for source, path in _RULE_PATH.findall(match.group(0))
        )
        return (
            '<lithermes-rules deferred="budget">'
            f"Read before editing: {rules} (bundled: rules/bundled-rules/).</lithermes-rules>"
        )

    return _RULES_LANE_BLOCK.sub(pointer, post_edit)


def _bounded_lines(value: str, maximum_bytes: int) -> str:
    kept: list[str] = []
    for line in value.splitlines():
        candidate = "\n".join([*kept, line])
        if _context_bytes(candidate) > maximum_bytes:
            break
        kept.append(line)
    return "\n".join(kept)


def _merge_post_edit(result: dict[str, str] | None, post_edit: str) -> dict[str, str] | None:
    """Front-load the post-edit skill route onto whatever this turn already injects.

    ``post_tool_call`` is observer-only in Hermes, so the block it buffered can only
    reach the model through ``pre_llm_call`` — the one hook whose return value the
    host consumes. It leads because it names a concrete follow-up for work the model
    just did.
    """
    if not post_edit:
        return result
    if isinstance(result, dict) and result.get("context"):
        existing = str(result["context"])
        combined = f"{post_edit}\n\n{existing}"
        if _context_bytes(combined) <= MAX_HOST_CONTEXT_BYTES:
            return {**result, "context": combined}

        lazy_references = _named_lazy_references(post_edit)
        compact_existing = _SKILL_BODY_BLOCK.sub(_lazy_skill_reference, existing)
        compact = "\n\n".join(
            part for part in (post_edit, lazy_references, compact_existing) if part
        )
        if _context_bytes(compact) <= MAX_HOST_CONTEXT_BYTES:
            return {**result, "context": compact}

        # A natural route is this turn's task; the static rules are standing
        # conventions. Cutting the route at a line boundary leaves only its
        # activation line, so keep the route whole: defer the static rule bodies
        # to a pointer, and drop even that when the route fills the budget.
        # Post-edit routes and every other block keep their place.
        if "<lithermes-natural-route " in existing and _RULES_LANE_BLOCK.search(post_edit):
            for rules_part in (_defer_rule_bodies(post_edit), _RULES_LANE_BLOCK.sub("", post_edit).strip()):
                route_first = "\n\n".join(part for part in (rules_part, lazy_references, compact_existing) if part)
                if _context_bytes(route_first) <= MAX_HOST_CONTEXT_BYTES:
                    return {**result, "context": route_first}

        suffix = "\n</lithermes-bounded-composition>"
        prefix = "\n".join(
            [
                '<lithermes-bounded-composition replaced="oversized-skill-bodies">',
                post_edit,
                lazy_references,
                "Essential existing route instructions (bounded at line boundaries):",
            ]
        )
        remaining = MAX_HOST_CONTEXT_BYTES - _context_bytes(prefix + suffix + "\n")
        bounded_existing = _bounded_lines(compact_existing, max(remaining, 0))
        replacement = f"{prefix}\n{bounded_existing}{suffix}"
        return {**result, "context": replacement}
    return {"context": post_edit}


def _merge_knowledge(
    result: dict[str, str] | None,
    knowledge_context: str,
) -> dict[str, str] | None:
    if not knowledge_context:
        return result
    if not isinstance(result, dict) or not result.get("context"):
        return {"context": knowledge_context}
    existing = str(result["context"])
    combined = f"{existing}\n\n{knowledge_context}"
    if _context_bytes(combined) <= MAX_HOST_CONTEXT_BYTES:
        return {**result, "context": combined}
    return result


def _auto_handoff_block(kwargs: dict[str, Any]) -> str:
    """The opt-in automatic-handoff directive or reload for this turn, or an empty string.

    It rides with the post-edit route so the bounded composition keeps it whole,
    and a failure here never costs the turn its other context.
    """
    try:
        return auto_handoff.pre_llm_call(
            session_id=kwargs.get("session_id"),
            user_message=kwargs.get("user_message"),
            conversation_history=kwargs.get("conversation_history"),
            platform=kwargs.get("platform"),
        )
    except Exception:  # noqa: BLE001 - advisory only
        return ""


def _pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    """Compose the Litwork directive and the active-litgoal snapshot.

    Hermes appends a returned ``{"context": ...}`` to the user message. We merge
    both injections so the model sees the litwork loop discipline and the live
    goal/criteria/evidence gate in one block.
    """
    if core.is_delegate_child_platform(str(kwargs.get("platform") or "")):
        core.release_browser_drive_state(kwargs.get("session_id"))
        return None
    deliverable_hedge_guard.begin_root_turn(
        kwargs.get("session_id"), kwargs.get("turn_id")
    )
    deliverable_hedge_guard.capture_user_text(
        kwargs.get("session_id"), kwargs.get("user_message"), kwargs.get("turn_id")
    )
    post_edit = core.consume_rules_context(**kwargs)
    auto_handoff_block = _auto_handoff_block(kwargs)
    if auto_handoff_block:
        post_edit = f"{auto_handoff_block}\n\n{post_edit}" if post_edit else auto_handoff_block
    workspace = kwargs.get("workspace")
    knowledge_context = knowledge.query(workspace, str(kwargs.get("user_message") or ""))
    base = core.pre_llm_call(**kwargs)
    activation = bounded_work.consume_activation_message(
        str(kwargs.get("user_message") or ""),
        session_id=str(kwargs.get("session_id") or ""),
    )
    if activation:
        parts = [activation]
        if isinstance(base, dict) and base.get("context"):
            parts.append(str(base["context"]))
        elif isinstance(base, str) and base.strip():
            parts.append(base)
        snapshot = litgoal_hook.snapshot_context(**kwargs)
        if snapshot:
            parts.append(snapshot)
        return _merge_knowledge(
            _merge_post_edit({"context": "\n\n".join(parts)}, post_edit),
            knowledge_context,
        )
    handoff_context = handoff.pre_llm_call(**kwargs)
    if handoff_context:
        deliverable_hedge_guard.activate_skill(kwargs.get("session_id"), "lit-handoff")
        return _merge_knowledge(_merge_post_edit(handoff_context, post_edit), knowledge_context)
    science_context = scientific_visualization.pre_llm_call(**kwargs)
    if science_context:
        deliverable_hedge_guard.activate_skill(
            kwargs.get("session_id"), "lit-scientific-visualization"
        )
        return _merge_knowledge(_merge_post_edit(science_context, post_edit), knowledge_context)
    parts: list[str] = []
    if isinstance(base, dict) and base.get("context"):
        parts.append(str(base["context"]))
    elif isinstance(base, str) and base.strip():
        parts.append(base)
    routed = bool(parts)
    snapshot = litgoal_hook.snapshot_context(**kwargs)
    if snapshot:
        parts.append(snapshot)
    if not routed:
        # No deterministic route claimed this turn; the optional Jev hint may
        # add one advisory line. It is inert unless LITHERMES_JEV and the key are set,
        # and an unexpected failure there never costs the turn its other context.
        try:
            skill_hint = jev_hint.pre_llm_call(
                session_id=str(kwargs.get("session_id") or ""),
                user_message=str(kwargs.get("user_message") or ""),
                catalog=PORTED_SKILLS,
            )
        except Exception:  # noqa: BLE001 - advisory only
            skill_hint = ""
        if skill_hint:
            parts.append(skill_hint)
    if not parts:
        return _merge_knowledge(_merge_post_edit(None, post_edit), knowledge_context)
    return _merge_knowledge(
        _merge_post_edit({"context": "\n\n".join(parts)}, post_edit),
        knowledge_context,
    )


def _setup_lithermes_cli(parser) -> None:
    try:
        parser.formatter_class = argparse.RawDescriptionHelpFormatter
    except Exception:
        pass
    parser.description = (
        "LitHermes — Hermes-native Litwork toolkit (litgoal runtime, skills, hooks) "
        "with lithermes_llm_contract/v1 route contracts."
    )
    parser.epilog = (
        "slash commands: /lit /lit-loop /lit-plan /litgoal /review-work /start-work /deep-interview "
        "/lit-humanizer (legacy aliases: /lit-korean /text-naturalization /text-neutralization "
        "/korean-ai-slop-remover) /lit-recap "
        "/lit-handoff /lit-scientific-visualization /lit-diagram-drawer /lit-pptx /lit-docx /lit-typographic-motion\n"
        f"skills: {len(PORTED_SKILLS)} lithermes:* skills — `hermes lithermes status` lists them\n"
        "contract schema: lithermes_llm_contract/v1 headings include #contract.activation, "
        "#contract.inputs, #contract.outputs, #contract.evidence, and #contract.hard_stops\n"
        "hooks: on_session_start, pre_llm_call, pre_tool_call, pre_command, post_tool_call, "
        "post_api_request, subagent_stop, transform_llm_output, on_session_finalize, on_session_reset\n"
        "bounded work: schema 3 via /lit-loop init|status|resume|cancel|complete and lithermes_work_progress\n"
        "wikify knowledge: hermes lithermes knowledge status|query|capture|save|review\n"
        "run `hermes lithermes status` for versions + full surface, or `doctor` for health checks"
    )
    parser.add_argument("--version", action="store_true", help="print the LitHermes plugin version")
    sub = parser.add_subparsers(dest="lh_cmd")
    sub.add_parser("version", help="print the LitHermes plugin version")
    sub.add_parser("status", help="show LitHermes + Hermes versions, hooks, commands, skills")
    sub.add_parser("doctor", help="run LitHermes health checks")
    goal_parser = sub.add_parser("goal", help="LitHermes litgoal durable runtime")
    litgoal_cli.setup(goal_parser)
    knowledge_parser = sub.add_parser("knowledge", help="product-local Wikify knowledge runtime")
    knowledge.setup_cli(knowledge_parser)


def _handle_lithermes_cli(args) -> int:
    cmd = getattr(args, "lh_cmd", None)
    if getattr(args, "version", False) or cmd == "version":
        print(core.version_line())
        return 0
    if cmd == "doctor":
        lines, code = core.doctor_report()
        print("\n".join(lines))
        return code
    if cmd == "goal":
        return litgoal_cli.handle(args)
    if cmd == "knowledge":
        return knowledge.handle_cli(args)
    # status, or bare `hermes lithermes` → the most useful "who am I" answer
    print(core.status_report())
    return 0


def _ignited(handler, route):
    """Wrap a slash command with a harness mark and a model probe contract."""

    @functools.wraps(handler)
    def wrapped(user_args):
        return core.ignite(handler(user_args), route)

    return wrapped


def _capture_pre_command(**kwargs: Any) -> None:
    """Remember the host route immediately before Hermes invokes a command.

    Hermes 0.21 fires ``pre_command`` for both the CLI and gateway surfaces. The
    command handler itself only receives raw arguments, so this small
    context-local bridge carries the surface/session pair into the native
    ``PluginContext.inject_message`` adapter below. Older Hermes releases do not
    expose ``inject_message`` and never register this hook.
    """
    surface = str(kwargs.get("surface") or "").strip().lower()
    if surface not in {"cli", "gateway"}:
        return None
    command = str(
        kwargs.get("command")
        or kwargs.get("alias_used")
        or ""
    ).strip().lstrip("/").lower()
    if command not in _NATIVE_COMMANDS:
        return None
    session_key = str(kwargs.get("session_key") or "").strip()
    _NATIVE_COMMAND_CONTEXT.set(
        {"surface": surface, "session_key": session_key}
    )
    return None


def _native_command_dispatch(ctx, handler):
    """Adapt structured LitHermes results to Hermes 0.21's native API.

    Hermes 0.17/0.19 have no ``inject_message`` method, so registration keeps
    returning the legacy structured payload for the installer source patch. On
    0.21 the plugin API owns the queueing/turn lifecycle; returning the dict to
    the host would otherwise print its Python representation to users.
    """
    inject_message = getattr(ctx, "inject_message", None)
    if not callable(inject_message):
        return handler

    @functools.wraps(handler)
    def wrapped(user_args):
        context = _NATIVE_COMMAND_CONTEXT.get() or {}
        try:
            result = handler(user_args)
            if not isinstance(result, dict):
                return result

            display = result.get("display") or result.get("message")
            agent_message = result.get("agent_message")
            injected = False
            if agent_message:
                try:
                    injected = bool(
                        inject_message(
                            str(agent_message),
                            role="user",
                            session_key=context.get("session_key") or None,
                        )
                    )
                except Exception:
                    # A host-side refusal must remain a visible, actionable
                    # result rather than leaking the structured dict repr.
                    injected = False

            if context.get("surface") == "gateway" and not injected:
                display_text = str(display) if display else ""
                return (
                    f"{display_text}\n\n{_NATIVE_GATEWAY_NOTICE}"
                    if display_text
                    else _NATIVE_GATEWAY_NOTICE
                )
            if display is not None:
                return str(display)
            return ""
        finally:
            _NATIVE_COMMAND_CONTEXT.set(None)

    return wrapped


def _command_handler(ctx, handler, route=None):
    """Build a command handler that works on both legacy and native Hermes."""
    ignited = _ignited(handler, route) if route else handler
    return _native_command_dispatch(ctx, ignited)


def _transform_llm_output(**kwargs: Any) -> str | None:
    named = handoff.transform_llm_output(**kwargs)
    if named is None:
        named = scientific_visualization.transform_llm_output(**kwargs)
    if named is None:
        named = core.transform_llm_output(**kwargs)
    # The reply transform is the plugin's only user-visible channel, so the
    # once-per-session Jev banner and fallback note are prefixed here, banner
    # first; the reply stays intact.
    session_id = str(kwargs.get("session_id") or "")
    lines = (jev_hint.consume_banner(session_id), jev_hint.consume_note(session_id))
    prefix = "\n".join(line for line in lines if line)
    if not prefix:
        return named
    reply = named if named is not None else str(kwargs.get("response_text") or "")
    return f"{prefix}\n\n{reply}"


def _pre_tool_call(**kwargs: Any) -> dict[str, str] | None:
    # Refusing a page-retrieval substitution outranks the other guards: it is the
    # one decision this turn's measured capability verdict already settled.
    browser_denial = core.browser_drive_tool_guard(**kwargs)
    if browser_denial is not None:
        return browser_denial
    humanizer_denial = deliverable_hedge_guard.pre_tool_call(
        tool_name=kwargs.get("tool_name"),
        args=kwargs.get("args"),
        session_id=kwargs.get("session_id"),
        workspace=kwargs.get("workspace"),
    )
    if humanizer_denial is not None:
        return humanizer_denial
    if knowledge_tools.pre_tool_call(**kwargs):
        return None
    return bounded_work_tools.pre_tool_call(**kwargs)


def _post_tool_call(**kwargs: Any) -> None:
    return core.post_tool_call(**kwargs)


def _on_session_start(**kwargs: Any) -> None:
    return core.on_session_start(**kwargs)


def _release_bounded_session(**kwargs: Any) -> None:
    # A guard that outlives its turn would refuse page retrieval in unrelated work.
    raw_session_id = kwargs.get("session_id")
    core.release_browser_drive_state(raw_session_id)
    session_id = raw_session_id if isinstance(raw_session_id, str) else ""
    bounded_work.release_bounded_session(session_id)
    jev_hint.release_session(session_id)
    auto_handoff.release_session(session_id)
    # A finalized/reset session must not leave its rule dedup ledger behind: the
    # next session reusing the id would see every rule as "already injected".
    core.release_rules_session(session_id)
    return None


def register(ctx) -> None:
    core.configure_welcome_skin()
    base = Path(__file__).resolve().parent

    # Session-scoped rule state. Hermes ignores this hook's return value, so it
    # resets the dedup ledger only; pre_llm_call renders the static rule lane.
    ctx.register_hook("on_session_start", _on_session_start)
    # Hooks: Litwork directive + litgoal snapshot/gate, both via pre_llm_call.
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    # The host-supplied session id authorizes progress before the model-facing
    # tool handler runs. The tool itself has no resume/grant lifecycle bypass.
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    # Hermes 0.21 gives native plugin commands a host-owned turn injection API.
    # Register the route bridge only when that API exists; older Hermes releases
    # continue through the installer-managed source patch below.
    if callable(getattr(ctx, "inject_message", None)):
        ctx.register_hook("pre_command", _capture_pre_command)
    # Observer over completed mutations. Hermes ignores this hook's return value, so
    # it only buffers the mutated paths; pre_llm_call renders them into the
    # event-shaped skill route on the next turn.
    ctx.register_hook("post_tool_call", _post_tool_call)
    # Hermes exposes normalized provider usage here. The callback records only
    # bounded numeric cache counters and hashed labels; raw request/response
    # compatibility fields are intentionally ignored.
    ctx.register_hook("post_api_request", core.post_api_request)
    # Record each delegate_task child (review lanes, reviewer gate) to the ledger.
    ctx.register_hook("subagent_stop", core.subagent_stop)
    # Draw natural-route acknowledgements without synthesizing model probe lines.
    ctx.register_hook("transform_llm_output", _transform_llm_output)
    # A finalized/reset session cannot retain live mutation authority.
    ctx.register_hook("on_session_finalize", _release_bounded_session)
    ctx.register_hook("on_session_reset", _release_bounded_session)

    # Model-facing litgoal tools (durable criteria/evidence/checkpoint/steering/gate).
    litgoal_tools.register_tools(ctx)
    bounded_work_tools.register_tools(ctx)
    knowledge_tools.register_tools(ctx)

    # `hermes lithermes goal ...` CLI surface.
    ctx.register_cli_command(
        "lithermes",
        "LitHermes workflow runtime (litgoal durable goal CLI; lithermes_llm_contract/v1)",
        _setup_lithermes_cli,
        _handle_lithermes_cli,
    )

    ctx.register_command(
        "lit-plan",
        _command_handler(ctx, core.command_lit_plan, "lit-plan"),
        description="Create a durable Litwork implementation plan",
        args_hint='"what to build"',
    )
    ctx.register_command(
        "litwork-plan",
        _command_handler(ctx, core.command_lit_plan, "lit-plan"),
        description="Alias for /lit-plan",
        args_hint='"what to build"',
    )
    ctx.register_command(
        "lit",
        _command_handler(ctx, core.command_lit, "litwork"),
        description="Start a Litwork run and execute the task immediately",
        args_hint='"task"',
    )
    ctx.register_command(
        "lit-loop",
        _command_handler(ctx, core.command_lit_loop, "lit-loop"),
        description="Start a Litwork run or operate its bounded lifecycle",
        args_hint='"task" [--completion-promise TEXT] [--strategy reset|continue] | init <plan> --grant ACTION@ROOT[,ACTION@ROOT] [--worktree PATH] | status <work-id> [--worktree PATH] | resume <work-id> --revision N --boundary ID --grant ACTION@ROOT [--worktree PATH] | cancel|complete <work-id> --revision N [--worktree PATH]',
    )
    ctx.register_command(
        "litwork-loop",
        _command_handler(ctx, core.command_lit_loop, "lit-loop"),
        description="Alias for /lit-loop",
        args_hint='"task"',
    )
    ctx.register_command(
        "litgoal",
        _command_handler(ctx, core.command_litgoal, "litgoal"),
        description="Open or inspect the LitHermes litgoal durable runtime",
        args_hint='["objective"] [--worktree PATH]',
    )
    ctx.register_command(
        "review-work",
        _command_handler(ctx, core.command_review_work, "review-work"),
        description="Run the LitHermes 5-lane review orchestrator on the current diff",
        args_hint="[--base REF]",
    )
    ctx.register_command(
        "start-work",
        _command_handler(ctx, core.command_start_work, "start-work"),
        description="Open or dry-run a LitHermes plan against a workspace",
        args_hint="[plan-name] [--worktree PATH] [--dry-run]",
    )
    ctx.register_command(
        "deep-interview",
        _command_handler(ctx, core.command_deep_interview, "deep-interview"),
        description="Run the LitHermes Socratic clarity gate before planning/execution",
        args_hint="[--quick|--standard|--deep] <idea>",
    )
    ctx.register_command(
        "lit-recap",
        _command_handler(ctx, core.command_lit_recap, "lit-recap"),
        description="Read-only Korean recap of finalized work (side-effect-free)",
        args_hint="[--brief] [--en] [--worktree PATH]",
    )
    ctx.register_command(
        "lit-handoff",
        _command_handler(ctx, handoff.command_lit_handoff),
        description="Create or update a verified LitHermes continuation handoff, or set the automatic handoff",
        args_hint="[focus] | auto on <percent> | auto off | auto status",
    )
    ctx.register_command(
        "lit-scientific-visualization",
        _command_handler(ctx, scientific_visualization.command_lit_scientific_visualization),
        description="Create a publication-quality scientific figure with the bundled source",
        args_hint="[figure request or dataset paths]",
    )
    ctx.register_command(
        "lit-diagram-drawer",
        _command_handler(ctx, core.command_lit_diagram_drawer, "lit-diagram-drawer"),
        description="Create and verify an accessible diagram from a supplied brief",
        args_hint="<diagram brief>",
    )
    for name in ("lit-pptx", "lit-docx"):
        ctx.register_command(
            name,
            _command_handler(ctx, lambda raw, skill=name: core.command_office_skill(raw, skill), name),
            description="Create and verify a PowerPoint deck" if name == "lit-pptx" else "Create and audit a Word document",
            args_hint="<document brief>",
        )
    ctx.register_command(
        "lit-typographic-motion",
        _command_handler(ctx, core.command_motion_skill, "lit-typographic-motion"),
        description="Direct and gate an original film from a treatment",
        args_hint="<film request>",
    )
    for name in core.KOREAN_PROSE_COMMANDS:
        ctx.register_command(
            name,
            _command_handler(ctx, core.command_lit_humanizer, "lit-humanizer"),
            description="Open LitHumanizer for side-effect-free Korean or English prose cleanup",
            args_hint="[Korean or English text]",
        )

    # Hermes registers handlers instead of command files. Keep old slash names
    # as one-release redirects while cataloging only the canonical skill.
    def korean_rename_redirect(alias):
        def redirect(raw_args):
            result = core.command_korean_prose_cleanup(raw_args)
            note = core.skill_rename_note(alias)
            return {key: f"{note}\n{value}" for key, value in result.items()}

        return redirect

    for alias in core.KOREAN_PROSE_ALIASES:
        ctx.register_command(
            alias,
            _command_handler(ctx, korean_rename_redirect(alias), "lit-humanizer"),
            description=f"Compatibility alias for /lit-humanizer; removed in the next minor",
            args_hint="[Korean text]",
        )

    for name, description in PORTED_SKILLS:
        ctx.register_skill(
            name,
            base / "skills" / name / "SKILL.md",
            description,
        )
