"""Per-session discipline stack and `go` continuation for lit-adhd.

The prompt hook records each lit route activation as a frame in one guarded JSON file per
workspace (``.hermes/lithermes/adhd/stack.json``) so a later brief in another session can see
which disciplines are active. Hermes has a single chat lane per session and nothing can pause
a discipline, so a session holds at most one active frame: pushing a new skill finishes the
previous active frame, and there are no pause/resume transitions. lit-adhd and lit-recap are
read-only disciplines and never push a frame, so a brief in the middle of a lit-loop leaves
the loop exactly where it was.

A bare ``go`` (also ``lit go``, ``ㄱㄱ``, ``고``, ``진행``, as the whole prompt) continues the
step the last brief offered: the hook reads the next-step record the collector wrote for this
session (``.hermes/lithermes/adhd/next-<session>.json``) and returns a short context note for
the model. A plan saved under ``plans/`` during a lit-plan turn writes the same record
(``start-plan``), so ``go`` right after planning shows that plan's ``/start-work`` command. A record older than 30 minutes, or no record at all, reads as no next step on
record. Hermes has no typed ``go`` command; ``go`` is a word the hook consumes.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

STACK_VERSION = 1
STACK_DIRNAME = "adhd"
STACK_FILENAME = "stack.json"
MAX_SESSIONS = 64
MAX_FRAMES_PER_SESSION = 20
MAX_STATE_BYTES = 2 * 1024 * 1024
GO_TTL_SECONDS = 30 * 60

# Read-only disciplines never push a stack frame.
READ_ONLY_DISCIPLINES = frozenset({"lit-adhd", "lit-recap"})

_GO_WORD = re.compile(r"^(?:go|lit go|ㄱㄱ|고|진행)$", re.IGNORECASE)
_SESSION_SAFE = re.compile(r"[^A-Za-z0-9_-]")


def match_go_word(text: str) -> bool:
    """True when the whole prompt is a go word the hook should consume."""
    return _GO_WORD.match(str(text or "").strip()) is not None


def adhd_dir(workspace: Path | str) -> Path:
    return Path(workspace) / ".hermes" / "lithermes" / STACK_DIRNAME


def stack_path(workspace: Path | str) -> Path:
    return adhd_dir(workspace) / STACK_FILENAME


def next_step_path(workspace: Path | str, session_id: Any) -> Path:
    safe = _SESSION_SAFE.sub("_", str(session_id or "session"))[:128] or "session"
    return adhd_dir(workspace) / f"next-{safe}.json"


def read_stack(workspace: Path | str) -> dict[str, Any]:
    """The stack file, or {} when it is missing, oversized or malformed. Never raises."""
    try:
        path = stack_path(workspace)
        if not path.is_file() or path.stat().st_size > MAX_STATE_BYTES:
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_stack(workspace: Path | str, data: dict[str, Any]) -> bool:
    """Whole-file write through a temporary file. False when the write failed."""
    try:
        directory = adhd_dir(workspace)
        # Refuse to write through a planted link: neither the adhd directory
        # nor its `.hermes` parent may be a symlink. Missing paths are fine.
        workspace_path = Path(workspace)
        for probe in (directory, workspace_path / ".hermes"):
            try:
                if probe.is_symlink():
                    return False
            except OSError:
                return False
        directory.mkdir(parents=True, exist_ok=True)
        fd, staging = tempfile.mkstemp(dir=str(directory), prefix="stack-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"version": STACK_VERSION, "sessions": data.get("sessions", {})}, handle)
                handle.write("\n")
            os.replace(staging, stack_path(workspace))
        finally:
            try:
                os.unlink(staging)
            except OSError:
                pass
        return True
    except (OSError, ValueError):
        return False


def _frames(data: dict[str, Any], session_id: str) -> list[dict[str, Any]]:
    sessions = data.get("sessions")
    if not isinstance(sessions, dict):
        return []
    record = sessions.get(session_id)
    if not isinstance(record, dict):
        return []
    frames = record.get("frames")
    return [frame for frame in frames if isinstance(frame, dict)] if isinstance(frames, list) else []


def push(workspace: Path | str, session_id: Any, skill: str, *, stage: str = "", at: str = "") -> bool:
    """Record an activation: the previous active frame of this session finishes. Never raises."""
    key = str(session_id or "")
    skill = str(skill or "")
    if not key or not skill or skill in READ_ONLY_DISCIPLINES:
        return False
    try:
        data = read_stack(workspace)
        sessions = data.get("sessions")
        if not isinstance(sessions, dict):
            sessions = {}
            data["sessions"] = sessions
        frames = _frames(data, key)
        for frame in frames:
            if frame.get("status") == "active":
                frame["status"] = "finished"
        frames.append({"skill": skill, "stage": stage, "status": "active", "at": at})
        sessions[key] = {"frames": frames[-MAX_FRAMES_PER_SESSION:]}
        while len(sessions) > MAX_SESSIONS:
            oldest = next(iter(sessions))
            if oldest == key:
                break
            del sessions[oldest]
        return _write_stack(workspace, data)
    except (OSError, ValueError):
        return False


def finish(workspace: Path | str, session_id: Any, skill: str = "") -> bool:
    """Mark this session's latest active frame finished. Never raises."""
    key = str(session_id or "")
    if not key:
        return False
    try:
        data = read_stack(workspace)
        sessions = data.get("sessions")
        if not isinstance(sessions, dict) or key not in sessions:
            return False
        frames = _frames(data, key)
        for frame in reversed(frames):
            if frame.get("status") == "active" and (not skill or frame.get("skill") == skill):
                frame["status"] = "finished"
                break
        sessions[key] = {"frames": frames[-MAX_FRAMES_PER_SESSION:]}
        return _write_stack(workspace, data)
    except (OSError, ValueError):
        return False


def active_skill(workspace: Path | str, session_id: Any) -> str:
    """The skill of this session's latest active frame, or "" when none is active."""
    for frame in reversed(_frames(read_stack(workspace), str(session_id or ""))):
        if frame.get("status") == "active":
            return str(frame.get("skill") or "")
    return ""


def write_next_step(
    workspace: Path | str, session_id: Any, kind: str, target: dict[str, Any], *, now: float | None = None
) -> bool:
    """Write this session's `{kind, target, at}` record, the shape the collector writes.

    Refuses a symlinked adhd or ``.hermes`` directory and stages through an exclusive,
    no-follow, pid-unique file, so a planted link is never written through. Never raises.
    """
    import time as _time
    from datetime import datetime, timezone

    try:
        directory = adhd_dir(workspace)
        for probe in (directory, Path(workspace) / ".hermes"):
            if probe.is_symlink():
                return False
        directory.mkdir(parents=True, exist_ok=True)
        at = datetime.fromtimestamp(now if now is not None else _time.time(), tz=timezone.utc)
        payload = {"kind": kind, "target": target, "at": at.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
        path = next_step_path(workspace, session_id)
        staging = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(staging, flags, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(json.dumps(payload) + "\n")
            os.replace(staging, path)
        except BaseException:
            staging.unlink(missing_ok=True)
            raise
        return True
    except (OSError, ValueError, TypeError):
        return False


def read_next_step(workspace: Path | str, session_id: Any) -> dict[str, Any] | None:
    """This session's next-step record, or None when it is missing or malformed. Never raises."""
    try:
        path = next_step_path(workspace, session_id)
        if not path.is_file() or path.stat().st_size > MAX_STATE_BYTES:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and isinstance(data.get("kind"), str) else None


def go_note(workspace: Path | str, session_id: Any, *, now: float | None = None) -> str:
    """The context note a consumed `go` injects: what to do next, or that nothing is on record."""
    import time as _time
    from datetime import datetime, timezone

    def _stamp(raw: str) -> float:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()

    record = read_next_step(workspace, session_id)
    if record is None:
        return (
            "The user typed `go` with no brief on record: no next-step record exists for this "
            "session. Offer `lit adhd` for a cross-session brief instead of inventing a step."
        )
    try:
        at = _stamp(str(record.get("at", "")))
        now_s = now if now is not None else _time.time()
        if now_s - at > GO_TTL_SECONDS:
            raise ValueError("expired")
    except (ValueError, OverflowError, TypeError):
        return (
            "The user typed `go` but the brief's next-step record is older than 30 minutes: it "
            "has expired. Offer `lit adhd` for a fresh brief instead of continuing the old step."
        )
    kind = str(record.get("kind", "none")).replace("-", " ")
    target = record.get("target") or {}
    if not isinstance(target, dict):
        # A hand-edited or foreign record may store a bare string here; treat
        # it as an empty detail rather than raising on `.get`.
        target = {}
    detail = target.get("plan") or target.get("workId") or target.get("skill") or ""
    if record.get("kind") == "start-plan" and detail:
        return (
            f"The user typed `go` after a brief whose next step is: start plan {detail} with "
            f"`/start-work {detail}`. Present that command for the user to run; do not run it, "
            "and do not start anything else."
        )
    if record.get("kind") == "approve-boundary":
        return (
            "YOUR TURN\n"
            "The user typed `go` after a brief whose next step is a bounded-work boundary "
            f"({detail}): show what it wants and ask the user to approve or deny it in chat. "
            "Never approve it yourself."
        )
    if kind != "none":
        return (
            f"The user typed `go` after a brief whose next step is: {kind}"
            f"{f' ({detail})' if detail else ''}. Continue that step in chat; start nothing else."
        )
    return (
        "The user typed `go` but the brief recorded no next step: say there is none instead "
        "of inventing one."
    )
