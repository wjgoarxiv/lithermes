"""`gate.json`: a read-only picture of the last gate evaluation, for the dashboard.

The gate itself stays in-process (runtime._evaluate_gate); this file only mirrors its
verdict so a UI can show it without running the gate. It is rewritten atomically on
every evaluation, every recorded terminal run, every evidence add, every criterion
status change and every review-blocker change. A write that fails never affects the gate.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import fingerprint, model, runs, store

RUNS_SHOWN = 8


def gate_path(workspace: Path, session_id: Any = "") -> Path:
    return store.state_dir(workspace, session_id) / "gate.json"


CHANGED_SHOWN = 8


def _run_entry(record: dict[str, Any], now: fingerprint.Current) -> dict[str, Any]:
    """One signed run as the pane shows it: when it ran and, once stale, which files moved since."""
    moved, names = fingerprint.changed(record.get("fp"), now.get())
    return {
        "id": record.get("id"),
        "exit": record.get("exit_code"),
        "preview": record.get("cmd_preview", ""),
        "at": record.get("at", ""),
        "stale": moved,
        "changed": names[:CHANGED_SHOWN] if moved else [],
    }


def write(
    workspace: Path, session_id: Any, goal: model.Goal, gate: dict[str, Any], now: fingerprint.Current
) -> None:
    try:
        recent = runs.recent_runs(workspace, session_id, limit=RUNS_SHOWN)
        payload = {
            "open": bool(gate["passed"]),
            "reasons": list(gate["reasons"]),
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "runs": [_run_entry(r, now) for r in recent],
            "blockers": [
                {"source": b.source or "review", "text": b.detail, "resolved": b.resolved}
                for b in goal.review_blockers
            ],
        }
        store.write_json_atomic(gate_path(workspace, session_id), payload)
    except Exception:  # noqa: BLE001 - includes the isolation refusal; the mirror never affects the gate
        return None
