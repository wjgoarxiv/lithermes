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


def write(
    workspace: Path, session_id: Any, goal: model.Goal, gate: dict[str, Any], now: fingerprint.Current
) -> None:
    try:
        recent = runs.recent_runs(workspace, session_id, limit=RUNS_SHOWN)
        payload = {
            "open": bool(gate["passed"]),
            "reasons": list(gate["reasons"]),
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "runs": [
                {
                    "id": r.get("id"),
                    "exit": r.get("exit_code"),
                    "preview": r.get("cmd_preview", ""),
                    "stale": fingerprint.changed(r.get("fp"), now.get())[0],
                }
                for r in recent
            ],
            "blockers": [
                {"source": b.source or "review", "text": b.detail, "resolved": b.resolved}
                for b in goal.review_blockers
            ],
        }
        store.write_json_atomic(gate_path(workspace, session_id), payload)
    except Exception:  # noqa: BLE001 - includes the isolation refusal; the mirror never affects the gate
        return None
