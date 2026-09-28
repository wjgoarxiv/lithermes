"""Model-facing litgoal tools (registered via ctx.register_tool).

These provide the authoritative durable criteria/evidence/checkpoint/steering/gate
state independently of user-managed native /goal state. They operate on the
current workspace (cwd). Each returns a JSON string for the model.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from . import model, runtime, store

TOOLSET = "lithermes-goal"
NATIVE_GOAL_CAPABILITY = {
    "mode": "user_managed",
    "state": "unobserved",
    "reason": (
        "LitHermes lacks a cache-coherent host controller/post-judge API and performs "
        "no automatic update, clear, or resume."
    ),
}
CONTRACT_DESCRIPTION_SUFFIX = (
    " Contract schema lithermes_llm_contract/v1; #contract.evidence requires command/artifact refs;"
    " #contract.hard_stops keeps completion closed on missing green/scenario evidence or blockers."
)


def _workspace() -> Path:
    return Path.cwd()


def _json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


def _session_id(kwargs: dict[str, Any]) -> str:
    """Use the host session id, falling back to Hermes' tool task id."""
    return str(kwargs.get("session_id") or kwargs.get("task_id") or "")


def _snapshot(workspace: Path, session_id: str = "") -> dict[str, Any]:
    goal = runtime.get_active(workspace, session_id)
    if goal is None:
        return {
            "active_goal": None,
            "native_goal_capability": dict(NATIVE_GOAL_CAPABILITY),
        }
    gate = runtime.quality_gate(workspace, session_id=session_id)
    return {
        "active_goal": {
            "id": goal.id,
            "objective": goal.objective,
            "title": goal.title,
            "status": goal.status,
            "criteria": [
                {
                    "id": c.id,
                    "scenario": c.scenario,
                    "qa_channel": c.qa_channel,
                    "test_ref": c.test_ref,
                    "status": c.status,
                    "attempt": int(c.attempt or 1),
                    "evidence_kinds": sorted(runtime.current_attempt_evidence_kinds(c)),
                }
                for c in goal.criteria
            ],
            "unresolved_blockers": [b.id for b in goal.review_blockers if not b.resolved],
        },
        "quality_gate": gate,
        "native_goal_capability": dict(NATIVE_GOAL_CAPABILITY),
    }


# -- tool handlers (args: dict) -> str --------------------------------------

def tool_goal_status(args: dict | None = None, **kwargs) -> str:
    return _json(_snapshot(_workspace(), _session_id(kwargs)))


def tool_goal_set(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    objective = str((args or {}).get("objective", "")).strip()
    title = str((args or {}).get("title", "")).strip()
    criteria = (args or {}).get("criteria") or []
    runtime.create_goal(ws, objective, title=title, criteria=criteria, session_id=session_id)
    return _json(_snapshot(ws, session_id))


def tool_goal_add_criterion(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    crit = runtime.add_criterion(
        ws,
        str((args or {}).get("scenario", "")),
        qa_channel=str((args or {}).get("qa_channel", "")),
        test_ref=str((args or {}).get("test_ref", "")),
        session_id=session_id,
    )
    return _json({"criterion_id": crit.id, **_snapshot(ws, session_id)})


def tool_goal_evidence(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    runtime.add_evidence(
        ws,
        str((args or {}).get("criterion_id", "")),
        str((args or {}).get("kind", "note")),
        str((args or {}).get("ref", "")),
        str((args or {}).get("detail", "")),
        session_id=session_id,
    )
    return _json(_snapshot(ws, session_id))


def tool_goal_criterion_status(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    runtime.set_criterion_status(
        ws,
        str((args or {}).get("criterion_id", "")),
        str((args or {}).get("status", "")),
        session_id=session_id,
    )
    return _json(_snapshot(ws, session_id))


def tool_goal_steer(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    payload = args or {}
    directive = str(payload.get("directive", ""))
    kind = str(payload.get("kind", "redirect")) or "redirect"
    try:
        runtime.record_steering(
            ws,
            directive,
            kind=kind,
            evidence=str(payload.get("evidence", "")),
            rationale=str(payload.get("rationale", "")),
            session_id=session_id,
        )
    except ValueError as exc:
        # A refusal that leaves no durable trace cannot be audited later; the
        # ledger is the only place a reviewer can see the gate actually held.
        runtime.record_steering_rejection(
            ws, directive, str(exc), kind=kind, session_id=session_id
        )
        return _json({"rejected": True, "reason": str(exc), **_snapshot(ws, session_id)})
    return _json(_snapshot(ws, session_id))


def tool_goal_status_set(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    status = str((args or {}).get("status", ""))
    try:
        runtime.set_goal_status(ws, status, session_id=session_id)
    except ValueError as exc:
        return _json({"rejected": True, "reason": str(exc), **_snapshot(ws, session_id)})
    return _json(_snapshot(ws, session_id))


def tool_goal_checkpoint(args: dict, **kwargs) -> str:
    ws = _workspace()
    session_id = _session_id(kwargs)
    runtime.record_checkpoint(
        ws,
        str((args or {}).get("summary", "")),
        active_criterion=str((args or {}).get("active_criterion", "")),
        session_id=session_id,
    )
    return _json(_snapshot(ws, session_id))


def tool_goal_complete(args: dict | None = None, **kwargs) -> str:
    return _json(runtime.complete_goal(_workspace(), session_id=_session_id(kwargs)))


def _spec(name: str, description: str, handler: Callable, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "toolset": TOOLSET,
        "description": description + CONTRACT_DESCRIPTION_SUFFIX,
        "handler": handler,
        "schema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


TOOL_SPECS: list[dict] = [
    _spec("goal_status", "Show the active LitHermes litgoal, its criteria, evidence, and quality gate.", tool_goal_status, {}, []),
    _spec(
        "goal_set",
        "Create the active litgoal with an objective and optional upfront success criteria.",
        tool_goal_set,
        {
            "objective": {"type": "string", "description": "the concrete user-visible objective"},
            "title": {"type": "string"},
            "criteria": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "scenario": {"type": "string"},
                        "qa_channel": {"type": "string", "enum": ["http", "tmux", "browser", "computer", "cli"]},
                        "test_ref": {"type": "string"},
                    },
                    "required": ["scenario"],
                },
            },
        },
        ["objective"],
    ),
    _spec(
        "goal_add_criterion",
        "Add one success criterion (scenario + QA channel + test reference) to the active goal.",
        tool_goal_add_criterion,
        {
            "scenario": {"type": "string"},
            "qa_channel": {"type": "string", "enum": ["http", "tmux", "browser", "computer", "cli"]},
            "test_ref": {"type": "string"},
        },
        ["scenario"],
    ),
    _spec(
        "goal_evidence",
        "Attach evidence (red|green|scenario|cleanup|note) to a criterion.",
        tool_goal_evidence,
        {
            "criterion_id": {"type": "string"},
            "kind": {"type": "string", "enum": ["red", "green", "scenario", "cleanup", "note"]},
            "ref": {"type": "string", "description": "test id or artifact path"},
            "detail": {"type": "string"},
        },
        ["criterion_id", "kind", "ref"],
    ),
    _spec(
        "goal_criterion_status",
        "Set a criterion status (pending|in_progress|blocked|needs_user_decision|pass|fail). "
        "Moving a criterion out of fail/blocked back into in_progress/pending counts as a "
        "retry: the attempt counter increments and later evidence is filed under the new attempt.",
        tool_goal_criterion_status,
        {
            "criterion_id": {"type": "string"},
            "status": {"type": "string", "enum": list(model.CRITERION_STATUSES)},
        },
        ["criterion_id", "status"],
    ),
    _spec(
        "goal_steer",
        "Record a steering directive that redirects or extends the active goal mid-flight. "
        "`evidence` and `rationale` are both REQUIRED. kind=add_criterion is structural — it "
        "appends a real criterion; every other kind is annotation-only by design and never "
        "rewrites the aggregate. Refused if it tries to weaken the completion gate "
        "(skip tests/QA/review or auto-complete); a refusal is recorded in the ledger.",
        tool_goal_steer,
        {
            "directive": {"type": "string"},
            "kind": {"type": "string", "enum": list(model.STEERING_KINDS)},
            "evidence": {"type": "string", "description": "what you observed that forced the change"},
            "rationale": {"type": "string", "description": "why that observation changes the plan"},
        },
        ["directive", "evidence", "rationale"],
    ),
    _spec(
        "goal_status_set",
        "Set the active goal status to needs_user_decision, review_blocked, blocked, or active. "
        "Use needs_user_decision when work cannot proceed without an answer only the user can "
        "give. Completion is not settable here — it stays gated on evidence.",
        tool_goal_status_set,
        {"status": {"type": "string", "enum": [s for s in model.GOAL_STATUSES if s != "complete"]}},
        ["status"],
    ),
    _spec("goal_checkpoint", "Record a durable checkpoint snapshot for resume.", tool_goal_checkpoint, {"summary": {"type": "string"}, "active_criterion": {"type": "string"}}, ["summary"]),
    _spec("goal_complete", "Attempt to complete the goal; refused with reasons unless the quality gate passes.", tool_goal_complete, {}, []),
]


def register_tools(ctx) -> list[str]:
    """Register every litgoal tool on the plugin context. Returns the names."""
    names: list[str] = []
    for spec in TOOL_SPECS:
        ctx.register_tool(
            name=spec["name"],
            toolset=spec["toolset"],
            schema=spec["schema"],
            handler=spec["handler"],
            description=spec["description"],
        )
        names.append(spec["name"])
    return names
