"""A still half-sunk sun over a sea, in the HUD card's free cells (classic CLI, truecolor, dark).

The classic CLI prints a slash command's output once, so this picture never moves. It is drawn
right of the card's words and only where no word stands: a card with a long row, a terminal
narrower than the picture or of unknown width, and a light background keep the rows as they were.
"""

from __future__ import annotations

import math
import os
import re
import sys
import unicodedata
from typing import Mapping

WIDTH = 79
SUN_W = 18
SUN_AT = 61
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_FAINT = (0x30, 0x36, 0x3D)
_SUN = ((0xFF, 0xDC, 0x65), (0xFF, 0x9C, 0x46), (0xFF, 0x3C, 0x8B))
_SLIT = "\x1b[48;2;26;16;48m"
_SEA = ((0xFF, 0xDC, 0x73), (0xFF, 0x9A, 0x4A), (0xFF, 0x4F, 0x8B), (0xB4, 0x57, 0xD6), (0x5A, 0x46, 0xA8))
_STARS = ((0, 42, "."), (1, 48, "*"), (0, 51, "+"), (1, 55, "."), (0, 57, "*"))
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def _mix(a: tuple[int, ...], b: tuple[int, ...], k: float) -> tuple[int, ...]:
    return tuple(round(x + (y - x) * k) for x, y in zip(a, b))


def _ink(rgb: tuple[int, ...]) -> str:
    return "\x1b[38;2;" + ";".join(map(str, rgb)) + "m"


def cells(text: str) -> int:
    """Terminal columns of a row; escapes and combining marks take none."""
    plain = _ANSI.sub("", text)
    return sum(0 if unicodedata.combining(ch) else 2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in plain)


def light_background(env: Mapping[str, str]) -> bool:
    """The signals Hermes itself reads, without its terminal query."""
    for name in ("HERMES_LIGHT", "HERMES_TUI_LIGHT"):
        value = env.get(name, "").strip().lower()
        if value in _TRUE | _FALSE:
            return value in _TRUE
    theme = env.get("HERMES_TUI_THEME", "").strip().lower()
    if theme in ("light", "dark"):
        return theme == "light"
    hint = re.fullmatch(r"#?([0-9a-fA-F]{6})", env.get("HERMES_TUI_BACKGROUND", "").strip())
    if hint:
        r, g, b = (int(hint.group(1)[i:i + 2], 16) for i in (0, 2, 4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 128
    last = env.get("COLORFGBG", "").strip().split(";")[-1]
    return last in ("7", "15")


def _columns() -> int:
    """The width of the terminal this process writes to; 0 in a gateway, which has none."""
    try:
        return os.get_terminal_size(sys.__stdout__.fileno()).columns
    except (AttributeError, OSError, ValueError):
        return 0


def _sea(dx: float) -> tuple[str, tuple[int, ...]] | None:
    far = abs(dx)
    wave = math.sin(far * 0.62) + 0.8 * math.sin(dx * 0.31) + 0.6 * math.sin(dx * 1.37)
    level = wave * 0.62 + 1.05 - far / 34
    if level < 0.22:
        return None
    hue = min(3.99, far / 13)
    base = _mix(_SEA[int(hue)], _SEA[int(hue) + 1], hue % 1)
    return "~" if level > 1.0 else "-" if level > 0.55 else ".", _mix(_FAINT, base, min(1.0, 0.18 + level * 0.55))


def _sun_row(r: int) -> list[str]:
    out = []
    for x in range(SUN_W):
        d = (x - (SUN_W - 1) / 2) / (SUN_W / 2)
        fill = max(0, min(8, math.floor(math.sqrt(1 - d * d) * 24 + 0.5) - (2 - r) * 8))
        if fill == 0:
            out.append(" ")
        elif fill < 8:
            out.append(f"{_ink(_SUN[r])}{'▁▂▃▄▅▆▇'[fill - 1]}\x1b[0m")
        elif r == 0:
            out.append(f"{_ink(_SUN[r])}█\x1b[0m")
        else:
            out.append(f"{_ink(_SUN[r])}{_SLIT}{'▇' if r == 1 else '▆'}\x1b[0m")
    return out


def behind(rows: list[str], env: Mapping[str, str] | None = None, columns: int | None = None) -> list[str]:
    """``rows`` with the scene right of the last three, or the same rows when it has no room."""
    env = os.environ if env is None else env
    columns = _columns() if columns is None else columns
    if len(rows) < 4 or columns <= WIDTH or light_background(env):
        return rows
    used = [cells(row) for row in rows[-3:]]
    if max(used) > SUN_AT - 2:
        return rows
    out = []
    for r, (row, width) in enumerate(zip(rows[-3:], used)):
        line = [" "] * (WIDTH - width)
        for star_row, x, glyph in _STARS:
            if star_row == r and x >= width + 3:
                line[x - width] = f"{_ink(_mix(_FAINT, (0xA9, 0x9B, 0xFF), 0.7))}{glyph}\x1b[0m"
        if r == 2:
            for x in range(width + 3, WIDTH):
                wave = _sea(x - (SUN_AT + SUN_W / 2 - 0.5))
                if wave:
                    line[x - width] = f"{_ink(wave[1])}{wave[0]}\x1b[0m"
        line[SUN_AT - width:SUN_AT - width + SUN_W] = [
            cell if cell != " " else line[SUN_AT - width + x] for x, cell in enumerate(_sun_row(r))
        ]
        out.append(row + "".join(line).rstrip(" "))
    return rows[:-3] + out
