"""Litgoal lifecycle operations on top of the durable store.

Every mutation: load -> mutate -> save -> append a typed ledger event. The
quality gate is the completion contract — a goal cannot complete until every
criterion is proven (status=pass + RED/GREEN + manual-QA scenario evidence) and
no review blocker is unresolved.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import model, store

try:
    from ..redaction import redact_text
except (ImportError, ModuleNotFoundError):  # standalone import fallback
    try:
        from redaction import redact_text  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def redact_text(value: str) -> str:  # type: ignore
            return str(value or "")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_id(prefix: str, existing: list[str]) -> str:
    n = 1
    used = set(existing)
    while f"{prefix}{n:03d}" in used:
        n += 1
    return f"{prefix}{n:03d}"


def _derive_open_blocker_status(goal: model.Goal) -> str:
    """Strengthen stale loaded state without clearing an explicit status."""
    if (
        goal.status not in ("complete", "blocked")
        and any(not blocker.resolved for blocker in goal.review_blockers)
    ):
        goal.status = "review_blocked"
    return goal.status


# -- goal lifecycle ---------------------------------------------------------

def create_goal(
    workspace: Path,
    objective: str,
    *,
    title: str = "",
    criteria: list[dict[str, Any]] | None = None,
    session_id: str = "",
) -> model.Goal:
    objective = redact_text(objective).strip()
    if not objective:
        raise ValueError("objective must be non-empty")
    state = store.load_or_create(workspace, session_id)
    goal_id = _next_id("G", [g.id for g in state.goals])
    goal = model.Goal(id=goal_id, objective=objective, title=title.strip())
    for spec in criteria or []:
        goal.criteria.append(
            model.Criterion(
                id=_next_id("C", [c.id for c in goal.criteria]),
                scenario=redact_text(str(spec.get("scenario", ""))).strip(),
                qa_channel=redact_text(str(spec.get("qa_channel", ""))).strip(),
                test_ref=redact_text(str(spec.get("test_ref", ""))).strip(),
            )
        )
    state.goals.append(goal)
    state.active_goal_id = goal_id
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace,
        {"kind": "goal_created", "goal_id": goal_id, "objective": objective},
        session_id,
    )
    return goal


def get_active(workspace: Path, session_id: str = "") -> model.Goal | None:
    goal = store.load_or_create(workspace, session_id).active_goal()
    if goal is not None:
        _derive_open_blocker_status(goal)
    return goal


def _require_active(state: model.LitgoalState, *, force: bool = False) -> model.Goal:
    goal = state.active_goal()
    if goal is None:
        raise ValueError("no active litgoal — create one first")
    _derive_open_blocker_status(goal)
    if goal.status == "complete" and not force:
        raise ValueError(
            "goal {0} is already complete; its evidence is a finished record. "
            "Open new state with --session-id <new-id> for new work, or pass --force "
            "to deliberately overwrite completed evidence.".format(goal.id)
        )
    return goal


def _sync_goal_status(goal: model.Goal) -> str:
    """Derive the goal status the blockers imply. Returns the new status.

    `complete` and a hand-set `blocked` status are never overwritten here.
    An unresolved review blocker outranks every other nonterminal status.
    """
    if goal.status in ("complete", "blocked"):
        return goal.status
    unresolved = any(not b.resolved for b in goal.review_blockers)
    if unresolved:
        goal.status = "review_blocked"
    elif goal.status == "review_blocked":
        goal.status = "active"
    return goal.status


def set_goal_status(workspace: Path, status: str, *, session_id: str = "", force: bool = False) -> str:
    """Set a goal status by hand. The only route to `needs_user_decision`."""
    if status not in model.GOAL_STATUSES:
        raise ValueError(f"invalid goal status '{status}' (valid: {model.GOAL_STATUSES})")
    if status == "complete":
        raise ValueError("use goal_complete — completion is gated on evidence, not settable by hand")
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    goal.status = status
    actual_status = (
        _sync_goal_status(goal)
        if any(not blocker.resolved for blocker in goal.review_blockers)
        else goal.status
    )
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace, {"kind": "goal_status", "goal_id": goal.id, "status": actual_status}, session_id
    )
    return actual_status


# -- criteria + evidence ----------------------------------------------------

def add_criterion(
    workspace: Path,
    scenario: str,
    *,
    qa_channel: str = "",
    test_ref: str = "",
    session_id: str = "",
    force: bool = False,
) -> model.Criterion:
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    crit = model.Criterion(
        id=_next_id("C", [c.id for c in goal.criteria]),
        scenario=redact_text(scenario).strip(),
        qa_channel=redact_text(qa_channel).strip(),
        test_ref=redact_text(test_ref).strip(),
    )
    goal.criteria.append(crit)
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace,
        {"kind": "criterion_added", "goal_id": goal.id, "criterion_id": crit.id},
        session_id,
    )
    return crit


# Leaving one of these for active work is a retry: the criterion was proven
# unmet, and whatever the next attempt produces must not land on top of the
# evidence that proved it unmet.
_RETRY_FROM = ("fail", "blocked")
_RETRY_TO = ("in_progress", "pending")


def set_criterion_status(
    workspace: Path,
    criterion_id: str,
    status: str,
    *,
    session_id: str = "",
    force: bool = False,
) -> int:
    """Set a criterion status. Returns the criterion's (possibly bumped) attempt."""
    if status not in model.CRITERION_STATUSES:
        raise ValueError(f"invalid criterion status '{status}' (valid: {model.CRITERION_STATUSES})")
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    for crit in goal.criteria:
        if crit.id == criterion_id:
            retried = crit.status in _RETRY_FROM and status in _RETRY_TO
            if retried:
                crit.attempt = int(crit.attempt or 1) + 1
            crit.status = status
            store.save(workspace, state, session_id)
            store.append_ledger(
                workspace,
                {
                    "kind": "criterion_status",
                    "criterion_id": criterion_id,
                    "status": status,
                    "attempt": crit.attempt,
                },
                session_id,
            )
            if retried:
                store.append_ledger(
                    workspace,
                    {
                        "kind": "criterion_retry",
                        "criterion_id": criterion_id,
                        "attempt": crit.attempt,
                        "evidence_dir": str(
                            store.attempt_evidence_dir(workspace, criterion_id, crit.attempt, session_id)
                        ),
                    },
                    session_id,
                )
            return crit.attempt
    raise ValueError(f"criterion '{criterion_id}' not found")


def add_evidence(
    workspace: Path,
    criterion_id: str,
    kind: str,
    ref: str,
    detail: str = "",
    *,
    session_id: str = "",
    force: bool = False,
) -> model.Evidence:
    if kind not in model.EVIDENCE_KINDS:
        raise ValueError(f"invalid evidence kind '{kind}' (valid: {model.EVIDENCE_KINDS})")
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    for crit in goal.criteria:
        if crit.id == criterion_id:
            ev = model.Evidence(
                kind=kind,
                ref=redact_text(ref),
                detail=redact_text(detail),
                at=_utc_now(),
                attempt=int(crit.attempt or 1),
            )
            crit.evidence.append(ev)
            store.save(workspace, state, session_id)
            store.append_ledger(
                workspace,
                {
                    "kind": "evidence_added",
                    "criterion_id": criterion_id,
                    "evidence_kind": kind,
                    "ref": redact_text(ref),
                    "attempt": ev.attempt,
                },
                session_id,
            )
            return ev
    raise ValueError(f"criterion '{criterion_id}' not found")


# -- checkpoints + steering -------------------------------------------------

def record_checkpoint(
    workspace: Path,
    summary: str,
    *,
    active_criterion: str = "",
    session_id: str = "",
    force: bool = False,
) -> model.Checkpoint:
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    cp = model.Checkpoint(
        id=_next_id("K", [c.id for c in goal.checkpoints]),
        at=_utc_now(),
        summary=redact_text(summary).strip(),
        active_criterion=active_criterion.strip(),
    )
    goal.checkpoints.append(cp)
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace,
        {"kind": "checkpoint", "goal_id": goal.id, "checkpoint_id": cp.id},
        session_id,
    )
    return cp


# Directives that try to weaken the completion contract are refused: steering can
# redirect or extend the work, never lower the evidence bar or force completion.
_STEERING_WEAKENS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bskip(p?ing)?\s+(the\s+|all\s+)?(unit\s+|integration\s+)?tests?\b",
        r"\bbypass(ing)?\s+(the\s+)?(quality\s+)?(gate|tests?|qa|review|criteri)",
        r"\bdisabl(e|ing)\s+(the\s+)?(tests?|gate|check|qa)",
        r"\bwithout\s+(running\s+|a\s+|any\s+)?(tests?|qa|review|evidence)",
        r"\bauto[-\s]?complet",
        r"\b(force|mark)\s+\w*\s*complet",
        r"\bignore\s+(the\s+)?(criteri|tests?|gate|evidence|qa)",
        r"\b(lower|relax|loosen)\s+(the\s+)?(bar|gate|criteri|standard)",
        r"\bskip\s+(the\s+)?(qa|review|gate|verification|evidence)",
    )
]


def _weakening_reason(directive: str) -> str | None:
    for pattern in _STEERING_WEAKENS:
        if pattern.search(directive):
            return f"directive matches a completion-weakening pattern ({pattern.pattern})"
    return None


def record_steering(
    workspace: Path,
    directive: str,
    *,
    kind: str = "redirect",
    evidence: str = "",
    rationale: str = "",
    session_id: str = "",
    force: bool = False,
) -> model.Steering:
    """Record a steering directive. `evidence` and `rationale` are REQUIRED.

    Semantics by kind:
      add_criterion  — STRUCTURAL. Appends a real criterion, so the directive
                       actually changes what the gate demands. It can only ever
                       add work, never remove it.
      redirect / narrow_scope / reprioritize / annotate
                     — ANNOTATION-ONLY, deliberately. Nothing in the aggregate
                       is rewritten; the directive is recorded and surfaced in
                       the pre_llm_call snapshot so the model reads it every
                       turn. `narrow_scope` in particular must NOT delete or
                       disable criteria: dropping a criterion is exactly the
                       gate-weakening this runtime refuses.
    """
    if kind not in model.STEERING_KINDS:
        raise ValueError(f"invalid steering kind '{kind}' (valid: {model.STEERING_KINDS})")
    directive = redact_text(directive)
    if not directive.strip():
        raise ValueError("steering refused: directive must be non-empty")
    evidence = redact_text(evidence).strip()
    rationale = redact_text(rationale).strip()
    missing = [
        name for name, value in (("evidence", evidence), ("rationale", rationale)) if not value
    ]
    if missing:
        raise ValueError(
            "steering refused: {0} required. A directive with no {0} is an "
            "unattributable change of course — cite what you observed and why it "
            "changes the plan.".format(" and ".join(missing))
        )
    reason = _weakening_reason(directive)
    if reason is not None:
        raise ValueError(
            f"steering refused: {reason}. Steering can redirect or extend the goal, "
            "but never weaken the completion gate (skip tests/QA/review or auto-complete)."
        )
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    st = model.Steering(
        id=_next_id("S", [s.id for s in goal.steering]),
        at=_utc_now(),
        directive=directive.strip(),
        kind=kind,
        evidence=evidence,
        rationale=rationale,
    )
    if kind == "add_criterion":
        crit = model.Criterion(
            id=_next_id("C", [c.id for c in goal.criteria]),
            scenario=directive.strip(),
            test_ref=evidence,
        )
        goal.criteria.append(crit)
        st.applied = crit.id
    goal.steering.append(st)
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace,
        {
            "kind": "steer",
            "goal_id": goal.id,
            "steering_id": st.id,
            "steer_kind": kind,
            "applied": st.applied,
        },
        session_id,
    )
    return st


def record_steering_rejection(
    workspace: Path, directive: str, reason: str, *, kind: str = "", session_id: str = ""
) -> None:
    """Persist a refused steering attempt.

    A rejection that leaves no trace is indistinguishable from one that never
    happened, which is precisely what an audit of the gate needs to see.
    """
    try:
        store.append_ledger(
            workspace,
            {
                "kind": "steering_rejected",
                "steer_kind": kind,
                "directive": redact_text(directive)[:500],
                "reason": redact_text(reason)[:500],
            },
            session_id,
        )
    except OSError:
        pass


# -- review blockers --------------------------------------------------------

def add_review_blocker(
    workspace: Path, detail: str, *, session_id: str = "", force: bool = False
) -> model.ReviewBlocker:
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    blocker = model.ReviewBlocker(
        id=_next_id("B", [b.id for b in goal.review_blockers]),
        detail=redact_text(detail).strip(),
    )
    goal.review_blockers.append(blocker)
    status = _sync_goal_status(goal)
    store.save(workspace, state, session_id)
    store.append_ledger(
        workspace,
        {"kind": "review_blocker", "goal_id": goal.id, "blocker_id": blocker.id, "status": status},
        session_id,
    )
    return blocker


def resolve_review_blocker(
    workspace: Path, blocker_id: str, *, session_id: str = "", force: bool = False
) -> None:
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    for blocker in goal.review_blockers:
        if blocker.id == blocker_id:
            blocker.resolved = True
            status = _sync_goal_status(goal)
            store.save(workspace, state, session_id)
            store.append_ledger(
                workspace,
                {"kind": "review_blocker_resolved", "blocker_id": blocker_id, "status": status},
                session_id,
            )
            return
    raise ValueError(f"review blocker '{blocker_id}' not found")


# -- quality gate + completion ---------------------------------------------

def current_attempt_evidence_kinds(criterion: model.Criterion) -> set[str]:
    """Evidence kinds produced by the criterion's current attempt only."""
    attempt = int(criterion.attempt or 1)
    return {e.kind for e in criterion.evidence if int(e.attempt or 1) == attempt}


def _evaluate_gate(goal: model.Goal) -> dict[str, Any]:
    reasons: list[str] = []
    if not goal.criteria:
        reasons.append("no success criteria defined")
    for crit in goal.criteria:
        attempt = int(crit.attempt or 1)
        kinds = current_attempt_evidence_kinds(crit)
        if crit.status != "pass":
            reasons.append(f"{crit.id} status is '{crit.status}' (need 'pass')")
        if "green" not in kinds:
            reasons.append(
                f"{crit.id} missing RED->GREEN proof (green evidence for attempt {attempt})"
            )
        if "scenario" not in kinds:
            reasons.append(
                f"{crit.id} missing manual-QA scenario evidence for attempt {attempt}"
            )
    for blocker in goal.review_blockers:
        if not blocker.resolved:
            reasons.append(f"unresolved review blocker {blocker.id}: {blocker.detail}")
    if goal.status in model.GOAL_STALLED_STATUSES:
        reasons.append(f"goal status is '{goal.status}' — resolve it before completing")
    return {
        "passed": len(reasons) == 0,
        "reasons": reasons,
        "goal_id": goal.id,
        "status": goal.status,
    }


def quality_gate(workspace: Path, goal_id: str | None = None, *, session_id: str = "") -> dict[str, Any]:
    state = store.load_or_create(workspace, session_id)
    goal = state.goal_by_id(goal_id) if goal_id else state.active_goal()
    if goal is None:
        return {"passed": False, "reasons": ["no active goal"]}
    _derive_open_blocker_status(goal)
    return _evaluate_gate(goal)


def complete_goal(workspace: Path, *, session_id: str = "", force: bool = False) -> dict[str, Any]:
    # Single load: evaluate the gate and mutate the same state to avoid any
    # read-decide-read race between the gate check and the completion write.
    state = store.load_or_create(workspace, session_id)
    goal = _require_active(state, force=force)
    gate = _evaluate_gate(goal)
    if not gate["passed"]:
        return {"completed": False, "reasons": gate["reasons"], "status": goal.status}
    goal.status = "complete"
    store.save(workspace, state, session_id)
    store.append_ledger(workspace, {"kind": "goal_completed", "goal_id": goal.id}, session_id)
    return {"completed": True, "goal_id": goal.id, "status": goal.status}
