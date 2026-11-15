"""Append-only record of what LitHermes already told the user, and how each bounded run ended.

One JSON object per line in ``shown.jsonl``, in a state folder: Hermes home ``lithermes/`` for the
installer's notices (they belong to the profile), and the workspace's ``.hermes/lithermes/`` for the
cross-session goal offer and run outcomes (they belong to the project).

- ``{"kind": "notice", "name", "hash", "at"}``: a notice the plugin printed. ``hash`` covers the notice's
  own content, not the language it was rendered in, so a Korean reply after an English one does not
  repeat it. A surface that finds its hash here prints nothing.
- ``{"kind": "run-end", "run", "outcome", "at", ...}``: how a bounded run ended. ``sent``: the completion
  report went to the user. ``nothing``: the user ended it, so there is nothing left to report. ``waiting``:
  the session ended while the run waits for the user, and the line names how many steps were parked.
- ``{"kind": "park-ping", "run", "step", "result", "at"}``: the one message for a parked step (``park_ping``,
  off by default). ``sent`` when Hermes took it, ``no signal`` (with the host's error code) when no session
  or gateway could carry it.

Only text the plugin prints itself is recorded; the model's own replies are never read. A missing,
unreadable, damaged or oversized record means "nothing was shown": every surface then behaves as it did
before this file existed. Nothing here raises, and nothing here is ever sent anywhere.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

try:
    from .core_runtime import assert_within_isolation
except (ImportError, ModuleNotFoundError):
    from core_runtime import assert_within_isolation  # type: ignore

FILENAME = "shown.jsonl"
MAX_BYTES = 256 * 1024
OUTCOMES = frozenset({"sent", "nothing", "waiting"})
PING_RESULTS = frozenset({"sent", "no signal"})
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


def _path(folder: Path | str) -> Path:
    return Path(folder) / FILENAME


def digest(name: str, key: str) -> str:
    return hashlib.sha256(f"{name}\x00{key}".encode("utf-8", "replace")).hexdigest()[:16]


def _entries(folder: Path | str) -> Iterator[dict[str, Any]]:
    try:
        info = os.lstat(_path(folder))
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            return
        fd = os.open(_path(folder), os.O_RDONLY | _NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            raw = handle.read(MAX_BYTES + 1)
    except OSError:
        return
    for line in raw.decode("utf-8", "replace").splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            yield value


def was_shown(folder: Path | str, name: str, key: str) -> bool:
    """True when this notice (by name and content key) is already in the record."""
    wanted = digest(name, key)
    return any(entry.get("kind") == "notice" and entry.get("hash") == wanted for entry in _entries(folder))


def _append(folder: Path | str, entry: dict[str, Any]) -> bool:
    target = _path(folder)
    line = json.dumps({**entry, "at": datetime.now(timezone.utc).isoformat()}, sort_keys=True, ensure_ascii=False) + "\n"
    try:
        assert_within_isolation(target)
        Path(folder).mkdir(parents=True, exist_ok=True)
        try:
            if os.lstat(target).st_size > MAX_BYTES:
                return False
        except FileNotFoundError:
            pass
        fd = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT | _NOFOLLOW, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as handle:
            handle.write(line)
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def mark_shown(folder: Path | str, name: str, key: str) -> bool:
    return _append(folder, {"kind": "notice", "name": name, "hash": digest(name, key)})


def record_outcome(folder: Path | str, run: str, outcome: str, **fields: Any) -> bool:
    if outcome not in OUTCOMES:
        return False
    return _append(folder, {"kind": "run-end", "run": str(run)[:96], "outcome": outcome, **fields})


def record_ping(folder: Path | str, run: str, step: str, result: str, **fields: Any) -> bool:
    """How the message for one parked step went: ``sent``, or ``no signal`` when the host refused it."""
    if result not in PING_RESULTS:
        return False
    return _append(folder, {"kind": "park-ping", "run": str(run)[:96], "step": str(step)[:96], "result": result, **fields})


def pings(folder: Path | str, run: str | None = None) -> list[dict[str, Any]]:
    return [
        entry for entry in _entries(folder)
        if entry.get("kind") == "park-ping" and (run is None or entry.get("run") == run)
    ]


def outcomes(folder: Path | str, run: str | None = None) -> list[dict[str, Any]]:
    """The recorded run ends, oldest first, optionally for one run."""
    return [
        entry for entry in _entries(folder)
        if entry.get("kind") == "run-end" and (run is None or entry.get("run") == run)
    ]
