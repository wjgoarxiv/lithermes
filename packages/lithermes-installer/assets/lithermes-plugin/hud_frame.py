"""The classic CLI's HUD card as one framed card (truecolor, dark background, a known width).

The same parts in the same places as the TUI card: brand and route on the top edge with the state on
the right, the stage map, the proof gauge with the next step, the goal, its runs, and the gate on the
bottom edge. A slash command prints once, so nothing in it moves. ``hud_card`` keeps its bar rows for
every other client.
"""

from __future__ import annotations

import unicodedata
from typing import Any, Mapping

try:
    from . import round_caps, sunset
except ImportError:  # standalone import (tests load modules from the payload folder)
    import round_caps  # type: ignore
    import sunset  # type: ignore

MIN_WIDTH, MAX_WIDTH = 60, 100
_STAGES = ("plan", "runs", "review", "gate", "handoff")
_PINK, _VIOLET, _ACCENT = (255, 45, 149), (180, 140, 255), (95, 215, 255)
_WARM, _TRACK = (255, 99, 55), (42, 35, 64)
_INK, _DIM, _WHITE = (11, 15, 20), (139, 148, 158), (230, 237, 243)
_TONE = {"ok": (107, 219, 143), "warn": (255, 175, 60), "bad": (255, 95, 95), "dim": _DIM}
_BRAND = ((255, 160, 51), (255, 106, 85), (255, 51, 136))
_STARS = ((0, -22, "."), (0, -9, "*"), (1, -15, "+"), (1, -5, "."), (0, 21, "+"), (1, 23, "*"), (0, 27, "."))
Cell = tuple  # (text, fg, bg, bold); a wide character's second cell is None


def _ramp(stops, k: float):
    at = min(len(stops) - 1.001, max(0.0, k) * (len(stops) - 1))
    return tuple(round(a + (b - a) * (at % 1)) for a, b in zip(stops[int(at)], stops[int(at) + 1]))


def _words(text: str, fg, bold: bool = False, bg=None) -> list:
    out: list = []
    for ch in text:
        wide = sunset.cells(ch)
        if wide:
            out += [(ch, fg, bg, bold)] + [None] * (wide - 1)
    return out


def _clip(text: Any, width: int) -> str:
    # No control, format or combining characters, and no emoji: terminals disagree on their width.
    plain = " ".join("".join(
        " " if unicodedata.category(ch)[0] in "CMZ" or (unicodedata.category(ch) == "So" and sunset.cells(ch) == 2) else ch
        for ch in unicodedata.normalize("NFC", str(text or ""))
    ).split())
    if sunset.cells(plain) <= width:
        return plain
    while plain and sunset.cells(plain) > width - 1:
        plain = plain[:-1]
    return plain + "…"


def _pill(text: str, stops, caps: bool) -> list:
    body = _words(text, _INK, True)
    last = max(1, len(body) - 1)
    body = [cell and (cell[0], cell[1], _ramp(stops, i / last), True) for i, cell in enumerate(body)]
    if caps:
        return [(round_caps.LEFT, stops[0], None, False), *body, (round_caps.RIGHT, stops[-1], None, False)]
    return [(" ", None, stops[0], False), *body, (" ", None, stops[-1], False)]


def _gauge(part: float, caps: bool, stops, width: int = 8) -> list:
    lit = 0 if part <= 0 else max(1, round(min(1.0, part) * width))
    out = []
    for i in range(width):
        hue = _ramp(stops, i / (width - 1)) if i < lit else _TRACK
        end = caps and i in (0, width - 1)
        out.append((round_caps.LEFT if i == 0 else round_caps.RIGHT, hue, None, False) if end else (" ", None, hue, False))
    return out


def _stage_map(stages: list, width: int, caps: bool) -> list:
    def draw(rail: bool) -> list:
        out: list = []
        for i, (key, state) in enumerate(stages):
            hue = _ramp((_WARM, _PINK), i / 5)
            walked = state != "todo"
            if i:
                out += _words((" ━━ " if walked else " ── ") if rail else " ", hue if walked else (70, 80, 92))
            if state == "active":
                out += _pill(key.upper(), (_VIOLET, _ACCENT), caps)
            else:
                out += _words(f"{key.upper()} {'✓' if walked else '·'}", hue if walked else _DIM)
        return out
    return next((row for row in (draw(True), draw(False)) if len(row) <= width), [])


def _fit(cells: list, width: int) -> list:
    cells = cells[:width]
    if cells and cells[-1] and sunset.cells(cells[-1][0]) == 2:
        cells[-1] = (" ", None, None, False)
    return cells + [(" ", None, None, False)] * (width - len(cells))


def _free(cell) -> bool:
    return bool(cell) and cell[0] == " " and cell[2] is None


def _clear(row: list, x: int) -> bool:
    return all(_free(row[n]) for n in range(max(0, x - 3), min(len(row), x + 4)))


def _scene(rows: list, at: int) -> bool:
    if at < 2 or not all(_free(cell) for row in rows for cell in row[at - 2:at + sunset.SUN_W + 2]):
        return False
    text = [list(row) for row in rows]
    for r, dx, glyph in _STARS:
        x = at + dx
        if 0 <= x < len(rows[r]) and _clear(text[r], x):
            rows[r][x] = (glyph, sunset.mix(sunset.FAINT, (169, 155, 255), 0.7), None, False)
    for x in range(len(rows[2])):
        wave = sunset.sea(x - (at + sunset.SUN_W / 2 - 0.5)) if _clear(text[2], x) else None
        if wave:
            rows[2][x] = (wave[0], wave[1], None, False)
    for r, row in enumerate(rows):
        for x, (glyph, slit) in enumerate(sunset.sun_cells(r)):
            if glyph != " ":
                row[at + x] = (glyph, sunset.SUN_INK[r], (26, 16, 48) if slit else None, False)
    return True


def _paint(cells: list) -> str:
    out, style = [], (None, None, False)
    for cell in cells:
        if cell is None:
            continue
        glyph, fg, bg, bold = cell
        if glyph == " " and bg == style[1]:
            out.append(glyph)
            continue
        if (fg, bg, bold) != style:
            codes = ["0", *(["1"] if bold else []), *(["38;2;%d;%d;%d" % fg] if fg else []), *(["48;2;%d;%d;%d" % bg] if bg else [])]
            out.append(f"\x1b[{';'.join(codes)}m")
            style = (fg, bg, bold)
        out.append(glyph)
    return "".join(out) + "\x1b[0m"


def width_for(columns: int) -> int | None:
    width = min(MAX_WIDTH, columns - 2)
    return width if width >= MIN_WIDTH else None


def render(snapshot: Mapping[str, Any] | None, label: str, *, width: int, caps: bool, runs: list, next_step: str) -> list[str]:
    inner = width - 4
    at = inner - sunset.SUN_W - 2 if inner < 90 else round(inner * 0.66)
    reach = at - 3 if at >= 40 else inner
    goal = (snapshot or {}).get("goal")
    if goal:
        gate = (snapshot.get("gate") or {}).get("open") is True
        criteria = snapshot.get("criteria") or []
        passed = sum(1 for item in criteria if item.get("status") == "pass")
        states = {row.get("key"): row.get("state") for row in snapshot.get("stages") or []}
        stages = [(key, states[key]) for key in _STAGES if states.get(key) in ("done", "active", "todo")]
        now = next((key for key, state in stages if state == "active"), "")
        state = ("DONE ✓", "ok") if goal.get("status") == "complete" and gate else (f"{(now or 'goal').upper()} ●", None)
        proven = bool(criteria) and passed == len(criteria)
        task = (_words("└ ", _DIM) + _words("proof ", _DIM) + _words(str(passed), _TONE["ok"] if proven else _WHITE, True)
                + _words(f"/{len(criteria)} ", _DIM)
                + _gauge(passed / len(criteria) if criteria else 0, caps, (_TONE["ok"], _ACCENT) if proven else (_VIOLET, _ACCENT)))
        task += _words(" · ", _DIM) + _words("next ▸ ", _ACCENT) + _words(_clip(next_step, inner - len(task) - 10), _WHITE)
        marks = [part for i, (text, tone) in enumerate(runs) for part in (_words(" · " if i else "", _DIM) + _words(text, _TONE[tone]))]
        body = [_stage_map(stages, inner, caps), task,
                _words("● ", _TONE["ok"]) + _words(_clip(goal.get("title"), reach - 2), _WHITE, True),
                _words("└ ", _DIM) + (_words("runs ", _DIM) + marks if marks else _words("no signed runs yet", _DIM)), []]
        foot = _words("gate ", _DIM) + _words("OPEN ✓" if gate else "CLOSED", _TONE["ok" if gate else "bad"], True)
    else:
        state = ("READY ○", None)
        body = [_words("next ▸ ", _ACCENT) + _words("the agent writes criteria before it works", _WHITE),
                _words("gate   ", _DIM) + _words('"done" waits until each criterion has proof', _WHITE),
                _words("see    ", _DIM) + _words("/litgoal any time · Desktop: lit goal pane", _WHITE), []]
        foot = _words("no goal yet", _DIM)
    grid = [_fit(row, inner) for row in body]
    _scene(grid[-3:], at)

    def edge(col: int):
        return _ramp((_PINK, _VIOLET, _ACCENT), col / width)

    def frame(bottom: bool, left: list, right: list) -> list:
        cells = [("─", edge(i), None, False) for i in range(width)]
        cells[0], cells[-1] = [(glyph, edge(i), None, False) for glyph, i in zip("╰╯" if bottom else "╭╮", (0, width - 1))]
        gap = [(" ", None, None, False)]
        for spans, start in ((left, 2), (right, width - 4 - len(right))):
            if spans:
                cells[start:start + len(spans) + 2] = gap + spans + gap
        return cells

    top = _pill("🔥 LIT", _BRAND, caps) + _words(" · ", _DIM) + _words(_clip(label, 24), _ACCENT, True)
    word = _words(state[0], _TONE[state[1]] if state[1] else _ACCENT, True)
    sides = [("│", edge(0), None, False), (" ", None, None, False)], [(" ", None, None, False), ("│", edge(width - 1), None, False)]
    return [_paint(row) for row in (frame(False, top, word), *(sides[0] + row + sides[1] for row in grid), frame(True, foot, []))]
