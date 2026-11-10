"""pre_llm_call snapshot injection for the active litgoal.

Returns a compact context block reminding the model of the live objective, the
next unmet criteria, unresolved review blockers, and that completion is gated on
proven evidence. Returns None when no active goal exists.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    from ..session_context import is_delegate_child_platform
except ImportError:  # standalone litgoal tests import this package at top level
    from session_context import is_delegate_child_platform
from . import model, runs, runtime, store
try:
    from ..workspace import resolve as resolve_workspace
except ImportError:  # standalone litgoal tests import this package at top level
    from workspace import resolve as resolve_workspace

NOT_DONE_PREFIX = "⛔ LIT: not done — "
NO_GOAL_LINE = NOT_DONE_PREFIX + "no goal was opened, so nothing was verified (type lit to start one)"
_SCAN_TAIL = 20000
_HOLD_REASON_BYTES = 900
_COMPLETION_CLAIM = re.compile(
    r"(?<!not )(?<!n't )\b(?:done|completed?|finished|fixed|shipped|ready to ship"
    r"|all (?:tests (?:pass|passed|passing)|green))\b"
    r"|(?<!미)완료(?!되지|\s*(?:안|못))|다 했|끝났|끝냈|마쳤|고쳤",
    re.IGNORECASE,
)


def _has_line(text: str, line: str) -> bool:
    """Whether `line` stands alone on a line of `text`, outside code fences and HTML comments."""
    fenced = commented = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith(("```", "~~~")):
            fenced = not fenced
            continue
        if fenced:
            continue
        if commented:
            commented = "-->" not in stripped
            continue
        if stripped == line:
            return True
        commented = "<!--" in stripped and "-->" not in stripped.split("<!--", 1)[1]
    return False


def not_done_mark(**kwargs: Any) -> str | None:
    """The visible line to append when a reply claims completion the gate has not allowed.

    Appended, never substituted: the reply stays the model's own words. Fires for an
    unfinished active goal whose quality gate is closed, and, when `lit_route_active`
    says a work route is running, for a session that never opened a goal at all. It is
    not repeated when the reply already carries that exact line on a line of its own.
    """
    text = str(kwargs.get("response_text") or "")
    if not _COMPLETION_CLAIM.search(text[-_SCAN_TAIL:]):
        return None
    if is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return None
    workspace = resolve_workspace(session_id=kwargs.get("session_id"), task_id=kwargs.get("task_id"))
    if workspace is None:
        return None
    session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
    try:
        goal = runtime.get_active(workspace, session_id)
        if goal is None:
            opened = store.load_or_create(workspace, session_id).goals
            if opened or not kwargs.get("lit_route_active"):
                return None
            return None if _has_line(text, NO_GOAL_LINE) else NO_GOAL_LINE
        if runtime.is_finished(workspace, session_id, goal):
            return None
        gate = runtime.quality_gate(workspace, session_id=session_id, persist=True)
    except Exception:
        return None
    if gate["passed"]:
        return None
    mark = NOT_DONE_PREFIX + "; ".join(gate["reasons"][:2])
    return None if _has_line(text, mark) else mark


def hold_finish(**kwargs: Any) -> dict[str, str] | None:
    """The pre_verify answer: keep the turn going while the goal gate is closed and the draft claims done.

    Hermes calls this once the agent has edited code and is about to deliver its answer. The
    returned message carries the gate's own reasons; the host bounds how often it can repeat
    (agent.max_verify_nudges), and the not-done line still marks a reply that goes out anyway.
    """
    text = str(kwargs.get("final_response") or "")
    if not _COMPLETION_CLAIM.search(text[-_SCAN_TAIL:]):
        return None
    if is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return None
    workspace = resolve_workspace(session_id=kwargs.get("session_id"), task_id=kwargs.get("task_id"))
    if workspace is None:
        return None
    session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
    try:
        goal = runtime.get_active(workspace, session_id)
        if goal is None or runtime.is_finished(workspace, session_id, goal):
            return None
        gate = runtime.quality_gate(workspace, session_id=session_id, persist=True)
    except Exception:
        return None
    if gate["passed"]:
        return None
    reasons = "; ".join(gate["reasons"][:3])[:_HOLD_REASON_BYTES]
    return {
        "action": "continue",
        "message": (
            "The litgoal quality gate is still closed, so this is not done yet: "
            f"{reasons}. Close the gap (run the tests, add the evidence, resolve the blockers) "
            "or tell the user plainly what is left."
        ),
    }


def _green_missing(state: str) -> str:
    """'' when green is verified, else the snapshot's explanation of what is missing."""
    if state == "verified":
        return ""
    if state == "stale":
        return "green (stale: the workspace changed after the run, re-run the tests)"
    return "green" if state == "none" else "green (claimed, not observed)"


def snapshot_context(**kwargs: Any) -> str | None:
    if is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return None
    workspace = resolve_workspace(session_id=kwargs.get("session_id"), task_id=kwargs.get("task_id"))
    if workspace is None:
        return None
    session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
    try:
        goal = runtime.get_active(workspace, session_id)
    except Exception:
        return None
    if goal is None or runtime.is_finished(workspace, session_id, goal):
        return None

    try:
        gate = runtime.quality_gate(workspace, session_id=session_id, persist=True)
    except Exception:
        return None
    greens = gate.get("green_states", {})
    open_crit = [
        c
        for c in goal.criteria
        if c.status != "pass"
        or _green_missing(greens.get(c.id, "none"))
        or "scenario" not in runtime.current_attempt_evidence_kinds(c)
    ]
    stalled = goal.status in model.GOAL_STALLED_STATUSES
    lines = [
        "<lithermes-litgoal-snapshot>",
        "schema_version: lithermes_llm_contract/v1",
        "#contract.activation: active litgoal snapshot is in force for this turn.",
        "#contract.inputs: criteria, blockers, and evidence below are durable state, not optional prose.",
        "#contract.outputs: do not claim completion until the quality gate allows goal_complete.",
        "#contract.evidence: every passed criterion needs green + scenario evidence; green counts only as ref `run:<id>` of an exit-0 terminal run this session observed.",
        "#contract.hard_stops: unresolved blockers or missing evidence keep the gate closed.",
        f"Active goal {goal.id} [{goal.status}]: {goal.objective}",
    ]
    if stalled:
        lines.append(
            "STALLED: this goal is '{0}'. Do not keep implementing — resolve the "
            "blocker or get the user's decision first.".format(goal.status)
        )
    if goal.steering:
        latest = goal.steering[-1]
        lines.append(
            "Latest steering [{0}]: {1} | evidence: {2} | rationale: {3}".format(
                latest.kind, latest.directive, latest.evidence or "-", latest.rationale or "-"
            )
        )
    if not goal.criteria:
        lines.append("No success criteria yet — define them (goal_add_criterion) before claiming progress.")
    for crit in open_crit:
        kinds = runtime.current_attempt_evidence_kinds(crit)
        missing = [m for m in (_green_missing(greens.get(crit.id, "none")),) if m]
        missing += [k for k in ("scenario",) if k not in kinds]
        miss = f" missing: {', '.join(missing)}" if missing else ""
        attempt = f" attempt {crit.attempt}" if int(crit.attempt or 1) > 1 else ""
        lines.append(
            f"- {crit.id} [{crit.status}]{attempt} {crit.scenario} "
            f"(channel {crit.qa_channel or '?'}).{miss}"
        )
    unresolved = [b for b in goal.review_blockers if not b.resolved]
    for blocker in unresolved:
        lines.append(f"- BLOCKER {blocker.id}: {blocker.detail}")
    observed = runs.recent_runs(workspace, session_id)
    if observed:
        lines.append("Observed terminal runs (cite as run:<id> in goal_evidence kind=green; only exit 0 counts):")
        lines.extend(
            f"- run:{r['id']} exit {r['exit_code']} `{r.get('cmd_preview', '')}`" for r in observed
        )
    else:
        lines.append("No terminal run observed yet this session — run the tests, then cite run:<id> as green evidence.")
    if gate["passed"]:
        lines.append("Quality gate: PASS — you may call goal_complete.")
    else:
        lines.append("Quality gate: CLOSED — goal_complete is refused until every criterion has green + scenario evidence and blockers are resolved.")
    lines.append("</lithermes-litgoal-snapshot>")
    return "\n".join(lines)
