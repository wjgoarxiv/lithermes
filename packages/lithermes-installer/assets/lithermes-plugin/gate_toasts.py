"""Keyed toasts when the litgoal gate really changes, through Hermes' ``ctx.post_message``.

Hermes 0.23 gives a plugin ``ctx.post_message(text)``: it posts into the session the
calling hook runs for and returns a handle whose ``edit(text)`` replaces the same
message. In a local session the text goes out as a keyed ``notification.show``: the Ink
TUI and Desktop replace it in place, and the classic CLI prints each version as a line
at the end of the turn. The call never raises; outside a session or without a live
gateway it returns a refused handle.

LitHermes keeps one handle per (session, goal), so a goal has one toast that changes
instead of a stack of them. It posts or edits only when the gate's own picture changes:

- the gate opens, or closes (including the first reading after a goal is set);
- a cited run becomes stale (a file changed after the run the evidence points at);
- the test guard raises a new blocker (a test was weakened or removed).

The picture is the session's ``gate.json``, the same file the Desktop pane reads. After
a tool call that changed files the gate is re-evaluated first, so an edit that makes a
receipt stale shows at once rather than at the next terminal run.

Desktop shows each of these as a toast too; the Desktop pane raises none of its own, so
there is one toast per change on every surface. Everything here is fail-open: any error,
an older host without ``post_message``, or a refused post leaves the session untouched.
Toast text is plain: it is a notification, not a reply, and carries no ANSI.
"""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

try:
    from . import handoff_card
    from .litgoal import gate_snapshot, runtime, store, testguard
except ImportError:  # standalone import (tests load modules from the payload folder)
    import handoff_card  # type: ignore
    from litgoal import gate_snapshot, runtime, store, testguard  # type: ignore

_LOCK = threading.Lock()
_CTX: Any = None
_SEEN: dict[tuple[str, str], tuple[Any, Any]] = {}
_MAX_TRACKED = 256
_TEXT_LIMIT = 240
_STALE = re.compile(r"^(?P<criterion>\S+) evidence (?P<run>\S+) is stale: (?P<what>.+?) after the run")
_PLAIN = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def bind(ctx: Any) -> None:
    """Remember the plugin context once at register; a host without post_message disables toasts."""
    global _CTX
    _CTX = ctx if callable(getattr(ctx, "post_message", None)) else None


def reset() -> None:
    with _LOCK:
        _SEEN.clear()


def forget_session(session_id: Any) -> None:
    key = str(session_id or "")
    with _LOCK:
        for seen in [k for k in _SEEN if k[0] == key]:
            _SEEN.pop(seen, None)


def _clip(text: Any, limit: int) -> str:
    plain = " ".join(_PLAIN.sub(" ", str(text or "")).split())
    return plain if len(plain) <= limit else plain[: limit - 1] + "…"


def picture(report: dict[str, Any], goal: Any) -> dict[str, Any]:
    """What a toast reports: gate state, stale cited runs, open test-guard blockers, proof count."""
    stale = []
    for reason in report.get("reasons", []):
        match = _STALE.match(str(reason))
        if match:
            stale.append((match.group("run"), match.group("what")))
    guard = [
        b["text"] for b in report.get("blockers", [])
        if b.get("source") == testguard.SOURCE and not b.get("resolved")
    ]
    criteria = list(getattr(goal, "criteria", []) or [])
    return {
        "open": bool(report.get("open")),
        "stale": stale,
        "guard": guard,
        "reasons": list(report.get("reasons", [])),
        "passed": sum(1 for c in criteria if getattr(c, "status", "") == "pass"),
        "total": len(criteria),
        "title": _clip(getattr(goal, "title", "") or getattr(goal, "objective", ""), 60),
    }


def signature(view: dict[str, Any]) -> tuple[Any, ...]:
    return (view["open"], tuple(sorted(run for run, _ in view["stale"])), tuple(sorted(view["guard"])))


def message(view: dict[str, Any]) -> str:
    """One plain line; the most urgent change wins (test guard, then stale run, then the gate)."""
    proof = f"{view['passed']}/{view['total']} criteria proven"
    if view["guard"]:
        text = f"⛔ lit: a test was weakened · {view['guard'][0]} — restore it, or /lit-accept-tests <reason>"
    elif view["stale"]:
        run, what = view["stale"][0]
        text = f"⛔ lit gate CLOSED · {run} is stale: {what} after the run — re-run it · {proof}"
    elif view["open"]:
        text = f"🔥 lit gate OPEN · {view['title']} · {proof}"
    else:
        first = view["reasons"][0] if view["reasons"] else "proof is missing"
        text = f"⛔ lit gate CLOSED · {view['title']} · {proof} · next: {first}"
    return _clip(text, _TEXT_LIMIT)


def _deliver(ctx: Any, key: tuple[str, str], handle: Any, text: str) -> Any:
    """Edit the goal's toast in place when it exists, else post a new one; the handle that took it."""
    if handle is not None:
        result = handle.edit(text)
        if isinstance(result, dict) and result.get("ok"):
            return handle
    posted = ctx.post_message(text)
    return posted if getattr(posted, "ok", False) else None


def observe(workspace: Path | None, session_id: Any, *, files_changed: bool = False) -> str | None:
    """Toast a real gate change for the session's goal. Returns the text it sent, or None. Never raises."""
    ctx = _CTX
    if ctx is None or workspace is None:
        return None
    try:
        session = str(session_id or "")
        if not store.goals_path(workspace, session).is_file():
            return None
        goal = runtime.get_active(workspace, session)
        if goal is None:
            return None
        if files_changed:
            runtime.refresh_gate(workspace, session)
        report = handoff_card.read_gate_report(gate_snapshot.gate_path(workspace, session), workspace)
        if report is None:
            return None
        view = picture(report, goal)
        key = (session, str(goal.id))
        with _LOCK:
            last = _SEEN.get(key)
        mark = signature(view)
        if last is not None and last[0] == mark:
            return None
        text = message(view)
        handle = _deliver(ctx, key, last[1] if last else None, text)
        with _LOCK:
            if len(_SEEN) >= _MAX_TRACKED and key not in _SEEN:
                _SEEN.pop(next(iter(_SEEN)))
            _SEEN[key] = (mark, handle)
        return text if handle is not None else None
    except Exception:  # noqa: BLE001 - a toast must never break the tool call it follows
        return None
