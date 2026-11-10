"""Deterministic handoff card, written when a session ends.

``on_session_finalize`` calls :func:`finalize`. If the session holds a litgoal, three
files land under ``<workspace>/.hermes/lithermes/handoff/`` (the workspace is the folder the
session's own turns worked in, never the Hermes home; see ``workspace.py``): ``<session_id>.json``,
``latest.json`` (the same card) and ``latest.md`` (a short human-readable copy). The
card names the goal, each criterion's status, whether the quality gate is open and
why not, the last three terminal runs, and the next step. It is built from files on
disk only: no model call, no network, no subprocess. :func:`finalize` never raises.

A session without a goal writes nothing, so an empty session cannot overwrite the
card an earlier one left in ``latest.*``.

The gate, the runs and the blockers come from the session's own ``gate.json`` (in the
session's litgoal folder) when it exists and is well formed, and from the live
litgoal runtime otherwise.

The readers at the top (:func:`read_card`, :func:`read_gate_report`,
:func:`saved_time`) use only the standard library, because the read-only dashboard
route loads this file by path inside the gateway, where the plugin package is absent.
The writer imports litgoal lazily for the same reason.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG = logging.getLogger("lithermes.handoff_card")
SCHEMA = "lithermes.handoff/v1"
MAX_RUNS = 3
MAX_CRITERIA = 50
MAX_REASONS = 20
MAX_SCANNED_RUNS = 50
MAX_FILE_BYTES = 200_000
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,95}$")
_RESERVED_IDS = frozenset({"latest"})


def handoff_dir(workspace: Path) -> Path:
    return Path(workspace) / ".hermes" / "lithermes" / "handoff"


def _safe_id(session_id: Any) -> str:
    text = session_id if isinstance(session_id, str) else ""
    return text if _SAFE_ID.match(text) and text not in _RESERVED_IDS else ""


def card_path(workspace: Path, session_id: Any) -> Path | None:
    """Where the session's card lives, or None for an id that cannot be a file name."""
    safe = _safe_id(session_id)
    return handoff_dir(workspace) / f"{safe}.json" if safe else None


def _clip(value: Any, limit: int) -> str:
    return " ".join(str(value if value is not None else "").split())[:limit]


def _read_json_object(path: Path, workspace: Path) -> dict[str, Any] | None:
    """The JSON object at ``path``, if it is a small regular file that stays inside ``workspace``."""
    try:
        if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
            return None
        if Path(workspace).resolve() not in path.resolve().parents:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RuntimeError):
        return None
    return data if isinstance(data, dict) else None


def read_card(workspace: Path, session_id: Any) -> dict[str, Any] | None:
    path = card_path(workspace, session_id)
    return _read_json_object(path, workspace) if path else None


def saved_time(written_at: Any) -> str:
    """``HH:MM`` in the local zone for an ISO-8601 timestamp, or ``""`` when it cannot be read."""
    try:
        stamp = datetime.fromisoformat(str(written_at))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp.astimezone().strftime("%H:%M")
    except (ValueError, OverflowError, OSError):
        return ""


def _run_row(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip():
        return None
    code = item.get("exit")
    return {
        "id": _clip(item["id"], 40),
        "exit": code if type(code) is int else None,
        "preview": _clip(item.get("preview"), 100),
        "stale": item.get("stale") is True,
    }


def _blocker_row(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict) or not isinstance(item.get("text"), str):
        return None
    return {
        "source": _clip(item.get("source"), 40),
        "text": _clip(item["text"], 300),
        "resolved": item.get("resolved") is True,
    }


def read_gate_report(path: Path, workspace: Path) -> dict[str, Any] | None:
    """The session's ``gate.json`` as a bounded, typed report, or None when absent or malformed.

    Its contract is ``{"open": bool, "reasons": [str], "evaluated_at": str, "runs":
    [{"id", "exit", "preview", "stale"}], "blockers": [{"source", "text", "resolved"}]}``.
    Callers show it as "reported by the session": it is a file, not a proof.
    """
    data = _read_json_object(path, workspace)
    if data is None or type(data.get("open")) is not bool or not isinstance(data.get("reasons"), list):
        return None
    runs, blockers = data.get("runs", []), data.get("blockers", [])
    if not isinstance(runs, list) or not isinstance(blockers, list):
        return None
    run_rows = [row for row in map(_run_row, runs[-MAX_SCANNED_RUNS:]) if row]
    blocker_rows = [row for row in map(_blocker_row, blockers[:MAX_REASONS]) if row]
    return {
        "open": data["open"],
        "reasons": [_clip(r, 300) for r in data["reasons"][:MAX_REASONS] if isinstance(r, str)],
        "evaluated_at": _clip(data.get("evaluated_at"), 40),
        "runs": run_rows,
        "blockers": blocker_rows,
    }


def _litgoal() -> tuple[Any, Any, Any, Any]:
    try:
        from . import redaction
        from .litgoal import runs, runtime, store
    except (ImportError, ModuleNotFoundError):
        import redaction  # type: ignore
        from litgoal import runs, runtime, store  # type: ignore
    return runs, runtime, store, redaction


def _next_step(goal: Any, criteria: list[dict[str, str]], reasons: list[str]) -> str:
    if goal.status == "complete":
        return "goal complete - nothing is left open"
    for row in criteria:
        if row["status"] != "pass":
            return _clip(f"{row['id']}: {row['text']}", 200)
    if reasons:
        return _clip(reasons[0], 200)
    return "every criterion passes and the gate is open - complete the goal"


def build_card(workspace: Path, session_id: str, now: datetime | None = None) -> dict[str, Any] | None:
    """The card for ``session_id``, or None when the session holds no litgoal."""
    runs, runtime, store, redaction = _litgoal()
    goal = runtime.get_active(workspace, session_id)
    if goal is None:
        return None
    report = read_gate_report(store.state_dir(workspace, session_id) / "gate.json", workspace)
    if report:
        gate = {"open": report["open"], "reasons": report["reasons"], "source": "gate.json"}
        observed = report["runs"]
    else:
        verdict = runtime.quality_gate(workspace, session_id=session_id)
        gate = {
            "open": bool(verdict.get("passed")),
            "reasons": [_clip(r, 300) for r in verdict.get("reasons", [])[:MAX_REASONS]],
            "source": "live",
        }
        observed = [
            {"id": r.get("id"), "exit": r.get("exit_code"), "preview": r.get("cmd_preview"), "stale": False}
            for r in runs.recent_runs(workspace, session_id, limit=MAX_RUNS)
        ]
    criteria = [
        {"id": _clip(c.id, 40), "text": _clip(c.scenario, 300), "status": _clip(c.status, 40)}
        for c in goal.criteria[:MAX_CRITERIA]
    ]
    stamp = now or datetime.now(timezone.utc)
    card = {
        "schema": SCHEMA,
        "session_id": session_id,
        "goal": {"id": _clip(goal.id, 40), "title": _clip(goal.title or goal.objective, 200), "status": _clip(goal.status, 40)},
        "criteria": criteria,
        "gate": gate,
        "runs": [row for row in map(_run_row, observed[-MAX_RUNS:]) if row],
        "next_step": _next_step(goal, criteria, gate["reasons"]),
        "written_at": stamp.isoformat(),
    }
    return redaction.redact_obj(card)


def _run_outcome(run: dict[str, Any]) -> str:
    if run["stale"]:
        return "stale"
    return "ok" if run["exit"] == 0 else f"exit {run['exit']}"


def render_markdown(card: dict[str, Any]) -> str:
    gate = card["gate"]
    lines = [
        f"# Handoff - {card['goal']['title']}",
        "",
        f"- Session: {card['session_id']}",
        f"- Written: {card['written_at']}",
        f"- Goal status: {card['goal']['status']}",
        f"- Gate: {'OPEN' if gate['open'] else 'CLOSED'} (from {gate['source']})",
        f"- Next step: {card['next_step']}",
        "",
        "## Criteria",
        *[f"- [{'x' if c['status'] == 'pass' else ' '}] {c['id']} {c['text']} ({c['status']})" for c in card["criteria"]],
    ]
    if gate["reasons"]:
        lines += ["", "## Why the gate is closed", *[f"- {reason}" for reason in gate["reasons"]]]
    if card["runs"]:
        lines += ["", "## Last runs", *[f"- {r['id']} ({_run_outcome(r)}) {r['preview']}" for r in card["runs"]]]
    return "\n".join(lines) + "\n"


def _write_atomic(path: Path, text: str) -> None:
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)


def write_session_card(workspace: Path, session_id: Any, now: datetime | None = None) -> Path | None:
    """Write the card files for a session; returns the per-session path, or None when nothing was written."""
    safe = _safe_id(session_id)
    if not safe:
        return None
    card = build_card(workspace, safe, now)
    if card is None:
        return None
    _, _, store, _ = _litgoal()
    folder = handoff_dir(workspace)
    payload = json.dumps(card, indent=2, ensure_ascii=False) + "\n"
    targets = [(folder / f"{safe}.json", payload), (folder / "latest.json", payload), (folder / "latest.md", render_markdown(card))]
    for path, _ in targets:
        store.assert_within_isolation(path)
    folder.mkdir(parents=True, exist_ok=True)
    for path, text in targets:
        _write_atomic(path, text)
    return targets[0][0]


def _session_workspace(session_id: Any) -> Path | None:
    """The folder the session worked in; ``on_session_finalize`` carries no cwd, so this is what the turns saw."""
    try:
        from .workspace import resolve
    except (ImportError, ModuleNotFoundError):
        from workspace import resolve  # type: ignore
    return resolve(session_id=session_id)


def finalize(session_id: Any, workspace: Path | None = None) -> None:
    """The ``on_session_finalize`` entry point: write the card, log and return on any failure."""
    try:
        root = workspace if workspace is not None else _session_workspace(session_id)
        if root is not None:
            write_session_card(root, session_id)
    except Exception as exc:  # a session end must never fail because a card could not be written
        LOG.warning("handoff card not written for %r: %s", _clip(session_id, 40), type(exc).__name__)
