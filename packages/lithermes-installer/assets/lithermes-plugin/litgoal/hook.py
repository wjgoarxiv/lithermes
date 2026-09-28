"""pre_llm_call snapshot injection for the active litgoal.

Returns a compact context block reminding the model of the live objective, the
next unmet criteria, unresolved review blockers, and that completion is gated on
proven evidence. Returns None when no active goal exists.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    from ..session_context import is_delegate_child_platform
except ImportError:  # standalone litgoal tests import this package at top level
    from session_context import is_delegate_child_platform
from . import model, runtime


def snapshot_context(**kwargs: Any) -> str | None:
    if is_delegate_child_platform(str(kwargs.get("platform") or "")):
        return None
    workspace = Path.cwd()
    session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
    try:
        goal = runtime.get_active(workspace, session_id)
    except Exception:
        return None
    if goal is None or goal.status == "complete":
        return None

    gate = runtime.quality_gate(workspace, session_id=session_id)
    open_crit = [
        c
        for c in goal.criteria
        if c.status != "pass"
        or not {"green", "scenario"}.issubset(runtime.current_attempt_evidence_kinds(c))
    ]
    stalled = goal.status in model.GOAL_STALLED_STATUSES
    lines = [
        "<lithermes-litgoal-snapshot>",
        "schema_version: lithermes_llm_contract/v1",
        "#contract.activation: active litgoal snapshot is in force for this turn.",
        "#contract.inputs: criteria, blockers, and evidence below are durable state, not optional prose.",
        "#contract.outputs: do not claim completion until the quality gate allows goal_complete.",
        "#contract.evidence: every passed criterion needs green + scenario evidence.",
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
        kinds = sorted(runtime.current_attempt_evidence_kinds(crit))
        missing = [k for k in ("green", "scenario") if k not in kinds]
        miss = f" missing: {', '.join(missing)}" if missing else ""
        attempt = f" attempt {crit.attempt}" if int(crit.attempt or 1) > 1 else ""
        lines.append(
            f"- {crit.id} [{crit.status}]{attempt} {crit.scenario} "
            f"(channel {crit.qa_channel or '?'}).{miss}"
        )
    unresolved = [b for b in goal.review_blockers if not b.resolved]
    for blocker in unresolved:
        lines.append(f"- BLOCKER {blocker.id}: {blocker.detail}")
    if gate["passed"]:
        lines.append("Quality gate: PASS — you may call goal_complete.")
    else:
        lines.append("Quality gate: CLOSED — goal_complete is refused until every criterion has green + scenario evidence and blockers are resolved.")
    lines.append("</lithermes-litgoal-snapshot>")
    return "\n".join(lines)
