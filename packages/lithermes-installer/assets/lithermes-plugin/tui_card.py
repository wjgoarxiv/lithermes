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
- With it stand live facts the host itself reports while the turn runs: the running tool's name, the
  context percent of the last model call, the skills the turn loaded, the ``delegate_task`` children
  and the workspace's branch. Arguments, outputs and replies are never recorded; a child's goal is
  redacted. A fact the host did not report is left out.
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
import re
import threading
import time
from pathlib import Path
from typing import Any

try:
    from . import hud_card, lit_reentry, redaction
    from .core_runtime import assert_within_isolation, get_hermes_home
    from .litgoal import gate_snapshot, runtime, store
except ImportError:  # standalone import (tests load modules from the payload folder)
    import hud_card  # type: ignore
    import lit_reentry  # type: ignore
    import redaction  # type: ignore
    from core_runtime import assert_within_isolation, get_hermes_home  # type: ignore
    from litgoal import gate_snapshot, runtime, store  # type: ignore

SETTINGS_FILE = "tui-card.json"
RECORDS_DIR = "tui-card"
HEARTBEAT_SECONDS = 60
KEEP_SECONDS = 7 * 24 * 3600
_MAX_TRACKED = 256
_MAX_PRUNED = 200
_MAX_LANES = 12
_MAX_SKILLS = 4
_NAME = re.compile(r"[\w.:/ -]{1,48}")
_LOCK = threading.Lock()
# session id -> {"workspace", "home", "since", "working", "mark", "wrote", "over"}
_TURNS: dict[str, dict[str, Any]] = {}
# child session id -> (parent session id, its lane row)
_CHILDREN: dict[str, tuple[str, dict[str, Any]]] = {}
# session id -> context percent of its last model call
_CONTEXT: dict[str, float] = {}


def reset() -> None:
    with _LOCK:
        _TURNS.clear()
        _CHILDREN.clear()
        _CONTEXT.clear()


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


def _branch(workspace: Path) -> str:
    """The branch name out of ``.git/HEAD``; a linked worktree's ``.git`` file names its folder."""
    try:
        git = workspace / ".git"
        if git.is_file():
            git = workspace / git.read_text(encoding="utf-8")[:4096].partition("gitdir:")[2].strip()
        head = (git / "HEAD").read_text(encoding="utf-8")[:512].strip()
    except (OSError, ValueError):
        return ""
    return head.removeprefix("ref: refs/heads/") if head.startswith("ref: refs/heads/") else ""


def _live(session_id: str, turn: dict[str, Any]) -> dict[str, Any]:
    route = lit_reentry.active_discipline(session_id)
    facts = {
        "at": time.time(),
        "working": turn["working"],
        "route": route,
        "branch": turn["branch"],
        "context": _CONTEXT.get(session_id),
        "tool": turn["tool"] if turn["working"] else None,
        "skills": turn["skills"],
        "lanes": turn["lanes"],
    }
    return {key: value for key, value in facts.items() if value not in (None, "", [])}


def _publish_live(session_id: str, turn: dict[str, Any], every: float = 0.0) -> None:
    """Rewrite the record with the live facts alone: the goal's own files are not read again."""
    if turn["base"] is None or time.monotonic() - turn["live_at"] < every:
        return
    turn["live_at"] = time.monotonic()
    _write(record_path(session_id, turn["home"]), {**turn["base"], **_live(session_id, turn)})


def _publish(session_id: str, turn: dict[str, Any]) -> None:
    workspace, home = turn["workspace"], turn["home"]
    turn["mark"], turn["wrote"] = _mark(workspace, session_id), time.monotonic()
    path = record_path(session_id, home)
    record = build(workspace, session_id, working=turn["working"], since=turn["since"], over=turn["over"])
    turn["base"], turn["live_at"] = record, time.monotonic()
    if record is None:
        with contextlib.suppress(OSError):
            path.unlink()
        return
    _write(path, {**record, **_live(session_id, turn)})


def turn_started(workspace: Path | None, session_id: Any, platform: Any) -> None:
    """A turn begins in a TUI session. Any other client has no widget to read a record."""
    try:
        session = str(session_id or "")
        home = _home()
        if not session or workspace is None or str(platform or "").strip().lower() != "tui" or mode(home) == "off":
            return
        goal, finished = _goal(workspace, session)
        turn = {"workspace": workspace, "home": home, "since": time.time(), "working": True, "mark": None, "wrote": 0.0,
                "over": goal.id if finished else "", "base": None, "live_at": 0.0, "tool": None, "skills": [], "lanes": [],
                "branch": _branch(workspace)}
        with _LOCK:
            before = _TURNS.get(session)
            # A child handed off in the last turn may still run in this one.
            turn["lanes"] = [lane for lane in (before or {}).get("lanes", []) if lane["state"] == "running"]
            if len(_TURNS) >= _MAX_TRACKED and session not in _TURNS:
                _TURNS.pop(next(iter(_TURNS)))
            _TURNS[session] = turn
        _publish(session, turn)
    except Exception:  # noqa: BLE001 - decoration never costs the turn
        return


def tool_started(session_id: Any, tool_name: Any, args: Any = None) -> None:
    """Before a tool call: its name, the skill it loads, or one more call of a child."""
    try:
        session, name = str(session_id or ""), str(tool_name or "")
        if not _NAME.fullmatch(name):
            return
        with _LOCK:
            parent, lane = _CHILDREN.get(session, ("", None))
            turn = _TURNS.get(parent or session)
        if turn is None:
            return
        if lane is not None:
            lane["calls"] += 1
            _publish_live(parent, turn, every=1.0)
            return
        if not turn["working"]:
            return
        turn["tool"] = [name, time.time()]
        skill = str(args.get("name") or "") if name == "skill_view" and isinstance(args, dict) else ""
        skill = skill.rpartition(":")[2]
        if _NAME.fullmatch(skill) and skill not in turn["skills"]:
            turn["skills"] = [*turn["skills"], skill][-_MAX_SKILLS:]
        _publish_live(session, turn)
    except Exception:  # noqa: BLE001 - decoration never costs the tool call
        return


def note_usage(session_id: Any, usage: Any, context_length: Any) -> None:
    """After a model call: what share of the model's context the host says it used."""
    try:
        session = str(session_id or "")
        with _LOCK:
            turn = _TURNS.get(session)
        used = usage.get("prompt_tokens") if isinstance(usage, dict) else getattr(usage, "prompt_tokens", None)
        if turn is None or isinstance(context_length, bool) or not isinstance(used, int) or not isinstance(context_length, int) or context_length <= 0:
            return
        if len(_CONTEXT) >= _MAX_TRACKED and session not in _CONTEXT:
            _CONTEXT.pop(next(iter(_CONTEXT)))
        _CONTEXT[session] = round(min(100.0, used * 100 / context_length), 1)
        _publish_live(session, turn)
    except Exception:  # noqa: BLE001
        return


def lane_started(parent_session_id: Any, child_session_id: Any, goal: Any) -> None:
    try:
        parent, child = str(parent_session_id or ""), str(child_session_id or "")
        name = " ".join(redaction.redact_text(str(goal or "")).split())[:40]
        with _LOCK:
            turn = _TURNS.get(parent)
            if turn is None or not child or not name or len(turn["lanes"]) >= _MAX_LANES:
                return
            lane = {"name": name, "state": "running", "since": time.time(), "calls": 0}
            turn["lanes"].append(lane)
            _CHILDREN[child] = (parent, lane)
        _publish_live(parent, turn)
    except Exception:  # noqa: BLE001
        return


def lane_stopped(child_session_id: Any, status: Any) -> None:
    try:
        with _LOCK:
            parent, lane = _CHILDREN.pop(str(child_session_id or ""), ("", None))
            turn = _TURNS.get(parent)
        if lane is None:
            return
        lane["state"], lane["ended"] = "ok" if str(status) == "completed" else "bad", time.time()
        if turn is not None:
            _publish_live(parent, turn)
    except Exception:  # noqa: BLE001
        return


def observe(session_id: Any) -> None:
    """After a tool call: rewrite the record when the goal's files moved, or once a minute."""
    try:
        session = str(session_id or "")
        with _LOCK:
            turn = _TURNS.get(session)
        if turn is None or not turn["working"]:
            return
        turn["tool"] = None
        if turn["mark"] == _mark(turn["workspace"], session) and time.monotonic() - turn["wrote"] < HEARTBEAT_SECONDS:
            _publish_live(session, turn)
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
            _CONTEXT.pop(session, None)
            for child in [key for key, (parent, _) in _CHILDREN.items() if parent == session]:
                _CHILDREN.pop(child)
        if session:
            record_path(session, turn["home"] if turn else _home()).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        return
