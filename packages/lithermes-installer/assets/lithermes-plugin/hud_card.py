"""The LIT HUD card a slash command shows: goal, proof count, signed runs, gate, next step.

``/lit``, ``/lit-loop`` and ``/litgoal`` add it under their acknowledgement. The data is
the Desktop pane's own read-only snapshot (``dashboard/plugin_api.workspace_snapshot``),
so the three surfaces never disagree about the gate.

Colour follows the client the command came from, as ``ctx.session_surface()`` names it,
never ``isatty``: the TUI gateway's stdout is a JSON-RPC pipe, so a tty check would
always print plain there even though Ink draws ANSI system lines.

- ``cli``: ANSI (truecolor when COLORTERM says so, else 256 colours).
- ``tui``: the same, painted per segment rather than per glyph, because Ink folds a
  system line longer than 400 characters (escape bytes included) behind a toggle.
  :func:`fit_tui` keeps the whole slash output under that.
- ``local`` (what Hermes 0.23 reports for a slash command from any local app, because
  the command runs in the gateway): the lean TUI painting, which the classic CLI, the
  TUI's slash pager and Desktop (which strips it) all take.
- ``desktop`` and messaging platforms: plain text (Desktop strips ANSI from slash output).
- ``NO_COLOR``, ``TERM=dumb`` or a non-UTF-8 locale: plain, and ASCII-safe glyphs where needed.

The card goes into slash-command output only. Replies stay plain: ``transform_llm_output``
text is stored in the session database and replayed, so it never carries escapes.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any, Mapping

try:
    from . import lit_mark
except ImportError:  # standalone import (tests load modules from the payload folder)
    import lit_mark  # type: ignore

TUI_LIMIT = 400
_LINE_WIDTH = 58
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_NAMED_STALE = re.compile(r"\bevidence (\S+) is stale\b")
# LIT inks: orange for work, lime for proof, cream for text; the gate colours are
# the LitHermes skin severity pair (good / critical) and its warn amber.
_INK = {
    "work": (255, 99, 55),
    "proof": (215, 247, 91),
    "text": (242, 239, 223),
    "dim": (150, 150, 140),
    "ok": (95, 211, 141),
    "warn": (255, 194, 75),
    "bad": (255, 40, 90),
}


def color_mode(surface: str, env: Mapping[str, str] | None = None) -> str:
    """``none`` / ``256`` / ``truecolor`` for the client that will draw the text."""
    return lit_mark.surface_color_mode(surface, env)


class _Painter:
    """SGR spans for one card. ``lean`` (the TUI) skips the dim and text inks, so the
    escape bytes Ink counts toward its 400-character fold go to state, not labels."""

    def __init__(self, mode: str, lean: bool) -> None:
        self.mode, self.lean = mode, lean

    def __call__(self, text: str, ink: str, bold: bool = False) -> str:
        if self.mode == "none" or not text or (self.lean and ink in ("dim", "text")):
            return text
        rgb = _INK[ink]
        colour = "38;2;" + ";".join(map(str, rgb)) if self.mode == "truecolor" else f"38;5;{lit_mark._nearest_256(rgb)}"
        return f"\x1b[{'1;' if bold else ''}{colour}m{text}\x1b[0m"


def _clip(text: Any, width: int) -> str:
    plain = " ".join(str(text or "").split())
    return plain if len(plain) <= width else plain[: max(0, width - 1)] + "…"


def _run_marks(receipts: list[dict[str, Any]], reasons: list[str], paint: _Painter) -> list[str]:
    """Only a run the gate names as stale evidence warns; another stale run is superseded."""
    named = {m.group(1) for reason in reasons for m in [_NAMED_STALE.search(str(reason))] if m}
    marks = []
    for run in list(reversed(receipts[:3])):
        run_id = str(run.get("id") or "?")
        if run.get("stale") and run_id in named:
            marks.append(paint(f"{run_id} ⚠ stale", "warn"))
        elif run.get("stale"):
            marks.append(paint(f"{run_id} superseded", "dim"))
        elif run.get("exit") == 0:
            marks.append(paint(f"{run_id} ✓", "ok"))
        elif run.get("exit") is None:
            marks.append(paint(f"{run_id} ?", "dim"))
        else:
            marks.append(paint(f"{run_id} ✗ exit {run.get('exit')}", "bad"))
    return marks


def _next_step(snapshot: Mapping[str, Any]) -> str:
    gate = snapshot.get("gate") or {}
    if gate.get("open"):
        return "every criterion has proof; the agent may say done"
    reasons = gate.get("reasons") or []
    if reasons:
        return str(reasons[0])
    return "add red→green and scenario evidence per criterion"


def render(snapshot: Mapping[str, Any] | None, route: str, surface: str, env: Mapping[str, str] | None = None) -> str:
    """The card as text for ``surface``; a missing or empty snapshot gives the first-run card."""
    mode = color_mode(surface, env)
    lean = surface in ("tui", "local") and mode != "none"
    # 256-colour codes are the shorter spelling of the same inks under the TUI fold.
    paint = _Painter("256" if lean else mode, lean)
    bar = paint("▌", "work")
    label = lit_mark.discipline(route) if re.fullmatch(r"[a-z0-9-]+", str(route or "")) else "lit"
    head = f"{bar}{paint('LIT', 'proof', bold=True)} {paint('· ' + label, 'text')}"
    goal = (snapshot or {}).get("goal")
    if not goal:
        return "\n".join([
            f"{head} {paint('── no goal yet', 'dim')}",
            f"{bar} {paint('next', 'dim')}  the agent writes criteria before it works",
            f"{bar} {paint('gate', 'dim')}  \"done\" waits until each criterion has proof",
            f"{bar} {paint('see ', 'dim')}  /litgoal any time · Desktop: lit goal pane",
        ])
    gate = snapshot.get("gate") or {}
    criteria = snapshot.get("criteria") or []
    passed = sum(1 for item in criteria if item.get("status") == "pass")
    state = paint("gate OPEN ✓", "ok", bold=True) if gate.get("open") else paint("gate CLOSED ⛔", "bad", bold=True)
    runs = _run_marks(snapshot.get("receipts") or [], gate.get("reasons") or [], paint)
    proof = paint(f"{passed}/{len(criteria)} criteria", "proof" if criteria and passed == len(criteria) else "text")
    rows = [
        f"{head} {paint('──', 'dim')} {state}",
        f"{bar} {paint('goal', 'dim')}  {_clip(goal.get('title'), _LINE_WIDTH - 8)}",
        f"{bar} {paint('proof', 'dim')} {proof}" + (f" · {' '.join(runs)}" if runs else " · no signed runs yet"),
        f"{bar} {paint('next', 'dim')}  {_clip(_next_step(snapshot), _LINE_WIDTH - 8)}",
    ]
    return "\n".join(rows)


def fit_tui(card: str, display: str) -> str:
    """Card first, then as much of the command's own display as fits under the TUI fold."""
    room = TUI_LIMIT - len(card) - 1
    if room <= 0:
        plain = _ANSI.sub("", card)
        return plain[:TUI_LIMIT]
    rest = _ANSI.sub("", str(display or "")).strip()
    if not rest:
        return card
    first = rest.splitlines()[0]
    return f"{card}\n{_clip(first, room)}" if room > 8 else card


def snapshot_for(workspace: Any) -> dict[str, Any] | None:
    """The pane's snapshot for ``workspace``, or None; never raises into a slash command."""
    if workspace is None:
        return None
    try:
        return _plugin_api().workspace_snapshot(Path(workspace))
    except Exception:  # noqa: BLE001 - the card is decoration; a broken read shows the first-run card
        return None


_API_MODULE = "_lithermes_hud_plugin_api"


def _plugin_api():
    """The dashboard route module, loaded by path exactly as the gateway mounts it."""
    if _API_MODULE not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            _API_MODULE, Path(__file__).resolve().parent / "dashboard" / "plugin_api.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]
        sys.modules[_API_MODULE] = module
    return sys.modules[_API_MODULE]
