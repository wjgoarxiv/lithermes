"""One message to the user when a bounded run parks a step (off by default).

When a call outside the run's grants is parked (``bounded_work._park_step``) or the model asks for a
step the grants do not cover (``record_bounded_progress``), the run keeps going and the step waits for
``lit approve`` or ``lit deny``. A user who is not watching the session does not see that. With this
switch on, the hook call that parks the step also posts one line through Hermes'
``ctx.post_message``: into the chat on a messaging gateway (Telegram, Slack and the rest), or as a
notification in a local TUI or Desktop session. The line names what waits and the words to type.

- Off unless the user turns it on: ``/lit-loop ping on`` (saved in Hermes home
  ``lithermes/park-ping.json``) or ``LITHERMES_PARK_PING=1``; ``LITHERMES_PARK_PING=0`` wins over a saved on.
  A damaged settings file leaves it off.
- One message per parked step. A retry of the same call only counts hits on the step that is already
  parked, so it never posts again.
- It only tells. It never approves, denies or resumes anything; the user still types the word.
- ``post_message`` needs a session bound to the call and a live gateway. Without them Hermes refuses
  the post, and the plugin records ``no signal`` in the workspace's ``shown.jsonl`` and does nothing
  else: no retry, no other route, no timer.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Any

try:
    from . import shown_record
    from .core_runtime import assert_within_isolation, get_hermes_home, utc_now
except (ImportError, ModuleNotFoundError):
    import shown_record  # type: ignore
    from core_runtime import assert_within_isolation, get_hermes_home, utc_now  # type: ignore

FLAG = "LITHERMES_PARK_PING"
SETTINGS_FILE = "park-ping.json"
ROUTE = "/lit-loop ping"
USAGE = f"Usage: {ROUTE} on | off | status"
MAX_SETTINGS_BYTES = 4096
_TEXT_LIMIT = 280
_ROOT_LIMIT = 120
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_PLAIN = re.compile(r"[\x00-\x1f\x7f]")
_CTX: Any = None


def bind(ctx: Any) -> None:
    """Remember the plugin context once at register; a host without post_message cannot ping."""
    global _CTX
    _CTX = ctx if callable(getattr(ctx, "post_message", None)) else None


def settings_path() -> Path:
    return get_hermes_home() / "lithermes" / SETTINGS_FILE


def _saved() -> bool | None:
    """The saved switch, or None when there is no readable one."""
    try:
        fd = os.open(settings_path(), os.O_RDONLY | _NOFOLLOW)
    except OSError:
        return None
    try:
        with os.fdopen(fd, "rb") as handle:
            data = json.loads(handle.read(MAX_SETTINGS_BYTES + 1)[:MAX_SETTINGS_BYTES].decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return data.get("enabled") is True if isinstance(data, dict) else None


def enabled(env: Any = None) -> tuple[bool, str]:
    """Whether a park posts a message, and where that answer came from."""
    values = os.environ if env is None else env
    raw = str(values.get(FLAG) or "").strip()
    if raw in ("0", "1"):
        return raw == "1", "environment"
    saved = _saved()
    return (bool(saved), "saved") if saved is not None else (False, "default")


def _write(on: bool) -> None:
    path = settings_path()
    assert_within_isolation(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        with contextlib.suppress(OSError):
            temporary.unlink()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"enabled": on, "updated": utc_now().isoformat()}, handle, sort_keys=True)
        os.replace(temporary, path)
    except OSError:
        with contextlib.suppress(OSError):
            temporary.unlink()
        raise


def run_command(command_args: str, env: Any = None) -> str | None:
    """``/lit-loop ping on | off | status`` as plain text; None when the args are not a ping route."""
    tokens = str(command_args or "").split()
    if not tokens or tokens[0].lower() != "ping":
        return None
    values = os.environ if env is None else env
    sub = tokens[1].lower() if len(tokens) == 2 else ("status" if len(tokens) == 1 else "")
    if sub == "status":
        on, source = enabled(values)
        where = {"environment": f"{FLAG} in your environment", "saved": "your saved setting", "default": "the default"}[source]
        state = "on" if on else "off"
        return f"Ping on a parked step is {state} ({where}). {ROUTE} on | off changes it."
    if sub not in ("on", "off"):
        return USAGE
    try:
        _write(sub == "on")
    except (OSError, RuntimeError) as exc:
        return f"Could not save the setting ({type(exc).__name__}); nothing changed."
    if sub == "on":
        line = (
            "Ping on a parked step is on. When a bounded run parks a step, this session gets one message "
            "naming the step and the word to type. It needs a live Hermes gateway; it never approves anything."
        )
    else:
        line = "Ping on a parked step is off. A parked step waits quietly until you look."
    flag = str(values.get(FLAG) or "").strip()
    if flag in ("0", "1") and (flag == "1") != (sub == "on"):
        line += f" {FLAG}={flag} is set in your environment and wins until you unset that variable."
    return line


def _clip(text: Any, limit: int) -> str:
    plain = " ".join(_PLAIN.sub(" ", str(text or "")).split())
    return plain if len(plain) <= limit else plain[: limit - 1] + "…"


def _tail(text: Any, limit: int) -> str:
    """Keep the end of a path, where the file name is."""
    plain = " ".join(_PLAIN.sub(" ", str(text or "")).split())
    return plain if len(plain) <= limit else "…" + plain[-(limit - 1):]


def message(work_id: str, action: str, root: str, worktree: Path | str | None = None) -> str:
    shown = str(root)
    if worktree is not None:
        with contextlib.suppress(ValueError, OSError):
            shown = Path(root).relative_to(Path(worktree)).as_posix() or "."
    return _clip(
        f"LIT: bounded work {_clip(work_id, 40)} is waiting on you. "
        f"{_clip(action, 24)} {_tail(shown, _ROOT_LIMIT)} was parked, not run. "
        "Type `lit approve` to allow it or `lit deny` to refuse it; `lit cancel` ends the run.",
        _TEXT_LIMIT,
    )


def announce(state_folder: Path | str, work_id: str, step_id: str, action: str, root: str) -> str | None:
    """Post one message for a step parked just now. Returns the text when a gateway took it.

    Off: nothing happens and nothing is recorded. On: one ``post_message``; the outcome (``sent`` or
    ``no signal`` with the host's error code) is appended to ``shown.jsonl``. Never raises.
    """
    try:
        on, _ = enabled()
        if not on:
            return None
        text = message(work_id, action, root, Path(state_folder).parent.parent)
        ctx = _CTX
        error = "no_post_message"
        handle = None
        if ctx is not None:
            try:
                handle = ctx.post_message(text)
                error = str(getattr(handle, "error", "") or "")
            except Exception as exc:  # noqa: BLE001 - the host promises a result, but a ping never costs the call
                error = type(exc).__name__
        sent = bool(getattr(handle, "ok", False))
        shown_record.record_ping(
            state_folder, work_id, step_id, "sent" if sent else "no signal",
            **({} if sent else {"error": error[:40] or "refused"}),
        )
        return text if sent else None
    except Exception:  # noqa: BLE001 - a ping must never break the tool call that parked the step
        return None
