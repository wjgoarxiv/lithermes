"""The six-stage timeline the dashboard route returns for a goal.

Plan, Runs, Review, Gate, Handoff, Resume: one dict per stage with ``key``, ``label``,
``state`` (``done`` / ``active`` / ``todo``), a one-line ``detail``, a ``tone`` (``""``,
``ok``, ``warn`` or ``danger``) and optional ``items`` the pane draws as separate
coloured lines (each run, each blocker). Pure and standard-library only: the route
loads this file by path inside the gateway and hands it text that is already
redacted and length-capped.
"""

from __future__ import annotations

from typing import Any

STAGES = (
    ("plan", "Plan"),
    ("runs", "Runs"),
    ("review", "Review"),
    ("gate", "Gate"),
    ("handoff", "Handoff"),
    ("resume", "Resume"),
)
MAX_RUNS_SHOWN = 3
MAX_BLOCKERS_SHOWN = 3
DETAIL_LIMIT = 300
_TONE_RANK = {"": 0, "ok": 0, "warn": 1, "danger": 2}


def _count(number: int, one: str, many: str) -> str:
    return f"{number} {one if number == 1 else many}"


def _run_item(run: dict[str, Any]) -> dict[str, str]:
    code = run.get("exit")
    if run.get("stale"):
        return {"text": f"{run['id']} ⚠ stale", "tone": "warn"}
    if code == 0:
        return {"text": f"{run['id']} ✓", "tone": ""}
    if code is None:
        return {"text": f"{run['id']} ?", "tone": ""}
    return {"text": f"{run['id']} ✗ exit {code}", "tone": "danger"}


def _worst(items: list[dict[str, str]]) -> str:
    return max((item["tone"] for item in items), key=_TONE_RANK.__getitem__, default="")


def _runs_stage(runs: list[dict[str, Any]]) -> tuple[dict[str, Any], bool]:
    shown = runs[-MAX_RUNS_SHOWN:]
    items = [_run_item(run) for run in shown]
    detail = "  ".join(item["text"] for item in items) or "no runs yet"
    latest_ok = bool(shown) and shown[-1].get("exit") == 0 and not shown[-1].get("stale")
    return {"detail": detail, "tone": _worst(items), "items": items}, latest_ok


def _review_stage(blockers: list[dict[str, Any]]) -> tuple[dict[str, Any], bool]:
    open_blockers = [b for b in blockers if not b.get("resolved")]
    if not open_blockers:
        return {"detail": "no blockers", "tone": "", "items": []}, True
    items = [{"text": b["text"], "tone": "danger"} for b in open_blockers[:MAX_BLOCKERS_SHOWN]]
    detail = f"{_count(len(open_blockers), 'blocker', 'blockers')}: {open_blockers[0]['text'][:120]}"
    return {"detail": detail, "tone": "danger", "items": items}, False


def _gate_stage(gate_open: bool, reasons: list[str]) -> dict[str, Any]:
    if gate_open:
        return {"detail": "OPEN", "tone": "ok", "items": []}
    detail = f"CLOSED — {_count(len(reasons), 'reason', 'reasons')}" if reasons else "CLOSED"
    return {"detail": detail, "tone": "danger", "items": []}


def build_stages(
    *,
    criteria: int,
    runs: list[dict[str, Any]],
    blockers: list[dict[str, Any]],
    gate_open: bool,
    gate_reasons: list[str],
    handoff_time: str,
    adopted_from: str,
) -> list[dict[str, Any]]:
    """Plan, runs, review and gate advance in order; handoff and resume are facts about the session."""
    runs_view, runs_ok = _runs_stage(runs)
    review_view, review_ok = _review_stage(blockers)
    plain = {"tone": "", "items": []}
    views = {
        "plan": {"detail": _count(criteria, "criterion", "criteria") if criteria else "no criteria yet", **plain},
        "runs": runs_view,
        "review": review_view,
        "gate": _gate_stage(gate_open, gate_reasons),
        "handoff": {"detail": f"saved {handoff_time}" if handoff_time else "not written yet", **plain},
        "resume": {"detail": f"from session {adopted_from[:4]}…" if adopted_from else "fresh session", **plain},
    }
    states: list[str] = []
    reached_open = False
    for ok in (criteria > 0, runs_ok, review_ok, gate_open):
        if reached_open:
            states.append("todo")
        elif ok:
            states.append("done")
        else:
            states.append("active")
            reached_open = True
    states.append("done" if handoff_time else ("todo" if reached_open else "active"))
    states.append("done" if adopted_from else "todo")
    return [
        {"key": key, "label": label, "state": state, **views[key], "detail": views[key]["detail"][:DETAIL_LIMIT]}
        for (key, label), state in zip(STAGES, states)
    ]
