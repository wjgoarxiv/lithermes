"""Durable litgoal data model.

Plain dataclasses with explicit (de)serialization so state survives across turns
and sessions as human-auditable JSON.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

STATE_VERSION = 1

CRITERION_STATUSES = (
    "pending", "in_progress", "blocked", "needs_user_decision", "pass", "fail",
)
# `review_blocked` is set automatically while an unresolved review blocker exists
# and cleared when the last one resolves; `needs_user_decision` is set by hand when
# work cannot proceed without an answer only the user can give. Both were
# previously unrepresentable, so a stalled goal was indistinguishable from a
# running one by status alone.
GOAL_STATUSES = (
    "active", "review_blocked", "needs_user_decision", "blocked", "complete",
)
# A goal in one of these states is stalled: it is not complete, and no further
# progress is expected until something outside the loop changes.
GOAL_STALLED_STATUSES = ("review_blocked", "needs_user_decision", "blocked")
EVIDENCE_KINDS = ("red", "green", "scenario", "cleanup", "note")
# Structured steering kinds. Steering can redirect or extend the goal; it can
# NEVER weaken the completion gate (see runtime._weakening_reason).
STEERING_KINDS = ("redirect", "add_criterion", "narrow_scope", "reprioritize", "annotate")


@dataclass
class Evidence:
    kind: str
    ref: str
    detail: str = ""
    at: str = ""
    # Which attempt of the criterion produced this. Evidence is append-only, so a
    # retry never overwrites a prior record; the attempt number is what lets a
    # reader tell attempt-1 evidence from attempt-2 evidence for the same criterion.
    attempt: int = 1

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Evidence":
        return Evidence(
            kind=str(d.get("kind", "note")),
            ref=str(d.get("ref", "")),
            detail=str(d.get("detail", "")),
            at=str(d.get("at", "")),
            attempt=int(d.get("attempt", 1) or 1),
        )


@dataclass
class Criterion:
    id: str
    scenario: str
    qa_channel: str = ""
    test_ref: str = ""
    status: str = "pending"
    # Bumped when a criterion leaves a terminal-negative state (fail/blocked) and
    # is picked back up. Evidence artifacts are written under a per-attempt
    # directory so a retry cannot overwrite what the previous attempt proved.
    attempt: int = 1
    evidence: list[Evidence] = field(default_factory=list)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Criterion":
        return Criterion(
            id=str(d.get("id", "")),
            scenario=str(d.get("scenario", "")),
            qa_channel=str(d.get("qa_channel", "")),
            test_ref=str(d.get("test_ref", "")),
            status=str(d.get("status", "pending")),
            attempt=int(d.get("attempt", 1) or 1),
            evidence=[Evidence.from_dict(e) for e in d.get("evidence", []) or []],
        )


@dataclass
class Checkpoint:
    id: str
    at: str
    summary: str
    active_criterion: str = ""

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Checkpoint":
        return Checkpoint(
            id=str(d.get("id", "")),
            at=str(d.get("at", "")),
            summary=str(d.get("summary", "")),
            active_criterion=str(d.get("active_criterion", "")),
        )


@dataclass
class Steering:
    id: str
    at: str
    directive: str
    kind: str = "redirect"
    # Both required at the CLI and tool surfaces. A steering directive that
    # carries no evidence and no rationale is an unattributable change of course.
    evidence: str = ""
    rationale: str = ""
    # Set when the directive structurally changed the goal (currently only
    # kind="add_criterion"); empty for annotation-only kinds.
    applied: str = ""

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Steering":
        return Steering(
            id=str(d.get("id", "")),
            at=str(d.get("at", "")),
            directive=str(d.get("directive", "")),
            kind=str(d.get("kind", "redirect")),
            evidence=str(d.get("evidence", "")),
            rationale=str(d.get("rationale", "")),
            applied=str(d.get("applied", "")),
        )


@dataclass
class ReviewBlocker:
    id: str
    detail: str
    resolved: bool = False

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "ReviewBlocker":
        return ReviewBlocker(
            id=str(d.get("id", "")),
            detail=str(d.get("detail", "")),
            resolved=bool(d.get("resolved", False)),
        )


@dataclass
class Goal:
    id: str
    objective: str
    title: str = ""
    status: str = "active"
    criteria: list[Criterion] = field(default_factory=list)
    checkpoints: list[Checkpoint] = field(default_factory=list)
    steering: list[Steering] = field(default_factory=list)
    review_blockers: list[ReviewBlocker] = field(default_factory=list)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Goal":
        return Goal(
            id=str(d.get("id", "")),
            objective=str(d.get("objective", "")),
            title=str(d.get("title", "")),
            status=str(d.get("status", "active")),
            criteria=[Criterion.from_dict(c) for c in d.get("criteria", []) or []],
            checkpoints=[Checkpoint.from_dict(c) for c in d.get("checkpoints", []) or []],
            steering=[Steering.from_dict(s) for s in d.get("steering", []) or []],
            review_blockers=[ReviewBlocker.from_dict(b) for b in d.get("review_blockers", []) or []],
        )


@dataclass
class LitgoalState:
    version: int = STATE_VERSION
    created_at: str = ""
    updated_at: str = ""
    active_goal_id: str = ""
    goals: list[Goal] = field(default_factory=list)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "LitgoalState":
        return LitgoalState(
            version=int(d.get("version", STATE_VERSION)),
            created_at=str(d.get("created_at", "")),
            updated_at=str(d.get("updated_at", "")),
            active_goal_id=str(d.get("active_goal_id", "")),
            goals=[Goal.from_dict(g) for g in d.get("goals", []) or []],
        )

    def active_goal(self) -> Goal | None:
        for g in self.goals:
            if g.id == self.active_goal_id:
                return g
        return None

    def goal_by_id(self, goal_id: str) -> Goal | None:
        for g in self.goals:
            if g.id == goal_id:
                return g
        return None


def to_dict(obj: Any) -> Any:
    """Recursive dataclass→dict that preserves field order and nested lists."""
    from dataclasses import asdict, is_dataclass

    if is_dataclass(obj):
        return asdict(obj)
    return obj
