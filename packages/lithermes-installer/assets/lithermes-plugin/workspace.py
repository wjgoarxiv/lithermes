"""The workspace a session works in, as the host reports it.

Hermes 0.23 runs ``hermes -z`` and Desktop chat through one shared gateway process whose own
cwd is the Hermes home, so ``os.getcwd()`` names the gateway and not the session. The session's
folder reaches a plugin only through the host's cwd carriers, read here in this order:

1. a ``workspace`` / ``cwd`` hook argument, if a host ever sends one;
2. ``agent.runtime_cwd.scoped_session_cwd()``, the folder the gateway pins for the length of a turn
   (``gateway/session_policy.py``: ``set_session_cwd(policy.cwd)``);
3. ``tools.terminal_tool.resolve_task_overrides(task_id)['cwd']``, a registered per-session folder;
4. the folder this plugin saw earlier in the same session, because ``on_session_finalize`` and other
   off-turn hooks carry no cwd at all;
5. ``tools.terminal_tool.get_session_cwd(task_id)``, the folder the session's last terminal command
   finished in (it follows a ``cd``, so it ranks below the frozen folders above);
6. ``agent.runtime_cwd.scope_terminal_cwd()``, the configured ``TERMINAL_CWD`` of the active profile;
7. ``$TERMINAL_CWD`` itself, on hosts that predate ``agent.runtime_cwd``.

Only when none of them names an existing absolute folder does the process cwd stand in. Neither the
Hermes home, anything inside it (or inside ``~/.hermes``), the user's own home folder, nor a folder whose
``.hermes`` is a Hermes home is ever a workspace: state written there would be shared by every project
or would land next to the Hermes installation.

The host modules are read from ``sys.modules`` and never imported, so a plugin running outside a
host (tests, ``hermes lithermes`` CLI) sees only the process cwd.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

LOG = logging.getLogger("lithermes.workspace")
_SENTINELS = frozenset({"", ".", "./", "auto", "cwd"})
_MAX_REMEMBERED = 256
_REMEMBERED: OrderedDict[str, Path] = OrderedDict()
_REFUSED: set[str] = set()
_LAST_ACTIVE: tuple[str, Path] | None = None
_LOCK = threading.Lock()


def _existing_dir(raw: Any) -> Path | None:
    if isinstance(raw, os.PathLike):
        raw = os.fspath(raw)
    if not isinstance(raw, str) or raw.strip().lower() in _SENTINELS:
        return None
    try:
        candidate = Path(raw.strip()).expanduser()  # `~nosuchuser/x` raises RuntimeError
        if not candidate.is_absolute():
            return None
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved if resolved.is_dir() else None


def _host_call(module: str, attribute: str, *args: Any) -> Any:
    function = getattr(sys.modules.get(module), attribute, None)
    if not callable(function):
        return None
    try:
        return function(*args)
    except Exception:  # noqa: BLE001 - a failing host helper only drops one carrier
        return None


def _session_keys(session_id: Any, task_id: Any) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(value) for value in (session_id, task_id) if value))


def _recall(keys: tuple[str, ...]) -> Path | None:
    with _LOCK:
        return next((_REMEMBERED[key] for key in keys if key in _REMEMBERED), None)


def _remember(keys: tuple[str, ...], path: Path) -> None:
    with _LOCK:
        for key in keys:
            _REMEMBERED[key] = path
            _REMEMBERED.move_to_end(key)
        while len(_REMEMBERED) > _MAX_REMEMBERED:
            _REMEMBERED.popitem(last=False)


def _override_cwd(key: str) -> Any:
    overrides = _host_call("tools.terminal_tool", "resolve_task_overrides", key)
    return overrides.get("cwd") if isinstance(overrides, dict) else None


def _find(explicit: Any, keys: tuple[str, ...]) -> Path | None:
    stages: list[Any] = [
        lambda: explicit,
        lambda: _host_call("agent.runtime_cwd", "scoped_session_cwd"),
        lambda: next((cwd for cwd in map(_override_cwd, keys) if _existing_dir(cwd)), None),
        lambda: _recall(keys),
        lambda: next(
            (cwd for cwd in (_host_call("tools.terminal_tool", "get_session_cwd", key) for key in keys) if _existing_dir(cwd)),
            None,
        ),
        lambda: _host_call("agent.runtime_cwd", "scope_terminal_cwd"),
        lambda: None if "agent.runtime_cwd" in sys.modules else os.environ.get("TERMINAL_CWD"),
    ]
    for stage in stages:
        found = _existing_dir(stage())
        if found is not None:
            return found
    return None


def _host_homes() -> list[Path]:
    homes: list[Path] = []
    getter = getattr(sys.modules.get("hermes_constants"), "get_hermes_home", None)
    for source in (getter() if callable(getter) else None, os.environ.get("HERMES_HOME"), Path.home() / ".hermes"):
        if source:
            try:
                homes.append(Path(source).expanduser().resolve())
            except (OSError, RuntimeError):
                continue
    return homes


def _user_home() -> Path | None:
    try:
        return Path.home().resolve()
    except (OSError, RuntimeError):
        return None


def is_hermes_home(path: Path) -> bool:
    """True for a Hermes home, anything inside one, a folder whose ``.hermes`` is one, or the user's home."""
    homes = _host_homes()
    if path == _user_home() or any(path == home or home in path.parents for home in homes):
        return True
    try:
        return (path / ".hermes").resolve() in homes
    except (OSError, RuntimeError):
        return False


def _process_cwd() -> Path | None:
    try:
        return Path.cwd().resolve()
    except OSError:
        return None


def locate(*, session_id: Any = "", task_id: Any = "", explicit: Any = None) -> Path | None:
    """The session's folder, or the process cwd when the host names none; None if even that is gone.

    Unlike :func:`resolve` this does not refuse the Hermes home: it is for read-only anchoring.
    """
    return _find(explicit, _session_keys(session_id, task_id)) or _process_cwd()


def resolve(*, session_id: Any = "", task_id: Any = "", explicit: Any = None) -> Path | None:
    """The folder durable state may be written to, or None when there is no safe one (logged once)."""
    keys = _session_keys(session_id, task_id)
    found = _find(explicit, keys)
    path = found or _process_cwd()
    if path is None:
        return None
    if is_hermes_home(path):
        with _LOCK:
            first = str(path) not in _REFUSED
            _REFUSED.add(str(path))
        if first:
            LOG.warning(
                "lithermes: %s is the Hermes home (or inside it, or the user home), so it is not used as a workspace "
                "and no state is written there; "
                "start the session inside a project folder",
                path,
            )
        return None
    if found is not None and keys:
        _remember(keys, path)
    if keys:
        _note_active(keys[0], path)
    return path


def _note_active(session_id: str, path: Path) -> None:
    global _LAST_ACTIVE
    with _LOCK:
        _LAST_ACTIVE = (session_id, path)


def last_active() -> tuple[str, Path] | None:
    """The (session id, workspace) of the most recent session that resolved a workspace in this process."""
    with _LOCK:
        return _LAST_ACTIVE


def forget_all() -> None:
    """Drop what was remembered and the once-per-path refusal log (tests, plugin reload)."""
    global _LAST_ACTIVE
    with _LOCK:
        _REMEMBERED.clear()
        _REFUSED.clear()
        _LAST_ACTIVE = None
