"""What the Ink TUI's goal card shows, written for ``tui-widgets/lit-card.mjs``.

A Hermes TUI widget runs inside the TUI's own Node process and gets neither the session's
folder nor its turn state, so this module leaves one small JSON record per TUI session in
Hermes home ``lithermes/tui-card/``. The name is a hash of the session id; the widget finds
its own through the session id the TUI itself records.

- Written only for a TUI session whose own litgoal is active, and only with data the HUD card
  and the Desktop pane already show (the redacted ``workspace_snapshot``).
- At the start and end of a turn, and after a tool call only when the goal's own files moved
  (two ``stat`` calls otherwise) or a minute passed, so a long turn is still known to be alive.
- A goal completed in a turn shows as done until the next turn starts; then the card leaves.
- Removed when the session has no active goal, is finalized or is reset. ``pid`` names the
  process that wrote it: a turn whose process is gone no longer counts as working.

Everything is fail-open: an error costs the card, never the turn. ``lithermes hud card off``
stops the writes.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

try:
    from . import hud_card
    from .core_runtime import assert_within_isolation, get_hermes_home
    from .litgoal import gate_snapshot, runtime, store
except ImportError:  # standalone import (tests load modules from the payload folder)
    import hud_card  # type: ignore
    from core_runtime import assert_within_isolation, get_hermes_home  # type: ignore
    from litgoal import gate_snapshot, runtime, store  # type: ignore

SETTINGS_FILE = "tui-card.json"
RECORDS_DIR = "tui-card"
HEARTBEAT_SECONDS = 60
KEEP_SECONDS = 7 * 24 * 3600
_MAX_TRACKED = 256
_MAX_PRUNED = 200
_LOCK = threading.Lock()
# session id -> {"workspace", "home", "since", "working", "mark", "wrote", "over"}
_TURNS: dict[str, dict[str, Any]] = {}


def reset() -> None:
    with _LOCK:
        _TURNS.clear()


def _home() -> Path:
    return Path(get_hermes_home())


def mode(home: Path) -> str:
    """``on`` / ``still`` / ``off``, as ``lithermes hud card`` saved it; unreadable means ``on``."""
    try:
        data = json.loads((home / "lithermes" / SETTINGS_FILE).read_text(encoding="utf-8")[:4096])
    except (OSError, ValueError):
        return "on"
    saved = data.get("mode") if isinstance(data, dict) else None
    return saved if saved in ("still", "off") else "on"


def record_path(session_id: str, home: Path) -> Path:
    name = hashlib.sha256(session_id.encode("utf-8", "replace")).hexdigest()[:32]
    return home / "lithermes" / RECORDS_DIR / f"{name}.json"


def _mark(workspace: Path, session_id: str) -> tuple[Any, ...]:
    marks = []
    for path in (store.goals_path(workspace, session_id), gate_snapshot.gate_path(workspace, session_id)):
        try:
            info = path.stat()
            marks.append((info.st_mtime_ns, info.st_size))
        except OSError:
            marks.append(None)
    return tuple(marks)


def _goal(workspace: Path, session_id: str) -> tuple[Any, bool]:
    """The session's own goal and whether this install finished it (a status alone is not proof)."""
    if not store.goals_path(workspace, session_id).is_file():
        return None, False
    goal = runtime.get_active(workspace, session_id)
    return goal, goal is not None and runtime.is_finished(workspace, session_id, goal)


def build(workspace: Path, session_id: str, *, working: bool, since: float, over: str = "") -> dict[str, Any] | None:
    """The record for the session's own goal, or None when it has none. ``over`` names a goal that was
    already finished when the turn began."""
    active, finished = _goal(workspace, session_id)
    if active is None or (finished and active.id == over):
        return None
    snapshot = hud_card.snapshot_for(workspace, session_id)
    goal = (snapshot or {}).get("goal")
    if not goal:
        return None
    gate = snapshot.get("gate") or {}
    criteria = snapshot.get("criteria") or []
    return {
        "v": 1,
        "pid": os.getpid(),
        "at": time.time(),
        "since": since,
        "working": working,
        "title": goal.get("title") or "",
        "status": "complete" if finished else "active" if goal.get("status") == "complete" else goal.get("status") or "",
        "passed": sum(1 for item in criteria if item.get("status") == "pass"),
        "total": len(criteria),
        "gate": bool(gate.get("open")),
        "next": hud_card.next_step(snapshot),
        "stages": [[row["key"], row["state"]] for row in snapshot.get("stages") or []],
        "runs": hud_card.run_marks(snapshot.get("receipts") or [], gate.get("reasons") or []),
    }


def _prune(folder: Path) -> None:
    limit = time.time() - KEEP_SECONDS
    for path in list(folder.glob("*.json"))[:_MAX_PRUNED]:
        with contextlib.suppress(OSError):
            if path.lstat().st_mtime < limit:
                path.unlink()


def _write(path: Path, record: dict[str, Any]) -> None:
    assert_within_isolation(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.is_symlink():
        return
    if not path.exists():
        _prune(path.parent)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with contextlib.suppress(OSError):
            temporary.unlink()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, ensure_ascii=False)
        os.replace(temporary, path)
    except OSError:
        with contextlib.suppress(OSError):
            temporary.unlink()


def _publish(session_id: str, turn: dict[str, Any]) -> None:
    workspace, home = turn["workspace"], turn["home"]
    turn["mark"], turn["wrote"] = _mark(workspace, session_id), time.monotonic()
    path = record_path(session_id, home)
    record = build(workspace, session_id, working=turn["working"], since=turn["since"], over=turn["over"])
    if record is None:
        with contextlib.suppress(OSError):
            path.unlink()
        return
    _write(path, record)


def turn_started(workspace: Path | None, session_id: Any, platform: Any) -> None:
    """A turn begins in a TUI session. Any other client has no widget to read a record."""
    try:
        session = str(session_id or "")
        home = _home()
        if not session or workspace is None or str(platform or "").strip().lower() != "tui" or mode(home) == "off":
            return
        goal, finished = _goal(workspace, session)
        turn = {"workspace": workspace, "home": home, "since": time.time(), "working": True, "mark": None, "wrote": 0.0,
                "over": goal.id if finished else ""}
        with _LOCK:
            if len(_TURNS) >= _MAX_TRACKED and session not in _TURNS:
                _TURNS.pop(next(iter(_TURNS)))
            _TURNS[session] = turn
        _publish(session, turn)
    except Exception:  # noqa: BLE001 - decoration never costs the turn
        return


def observe(session_id: Any) -> None:
    """After a tool call: rewrite the record when the goal's files moved, or once a minute."""
    try:
        session = str(session_id or "")
        with _LOCK:
            turn = _TURNS.get(session)
        if turn is None or not turn["working"]:
            return
        if turn["mark"] == _mark(turn["workspace"], session) and time.monotonic() - turn["wrote"] < HEARTBEAT_SECONDS:
            return
        _publish(session, turn)
    except Exception:  # noqa: BLE001
        return


def turn_ended(session_id: Any) -> None:
    """The turn is over, finished or interrupted: the card comes to rest."""
    try:
        session = str(session_id or "")
        with _LOCK:
            turn = _TURNS.get(session)
        if turn is None or not turn["working"]:
            return
        turn["working"] = False
        _publish(session, turn)
    except Exception:  # noqa: BLE001
        return


def forget(session_id: Any) -> None:
    """A finalized or reset session leaves no record behind."""
    try:
        session = str(session_id or "")
        with _LOCK:
            turn = _TURNS.pop(session, None)
        if session:
            record_path(session, turn["home"] if turn else _home()).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        return
