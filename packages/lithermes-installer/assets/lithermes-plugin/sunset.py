"""The sun, the sea and the terminal facts of the classic CLI's framed HUD card (``hud_frame``)."""

from __future__ import annotations

import math
import os
import re
import sys
import unicodedata
from typing import Mapping

SUN_W = 18
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
FAINT = (0x30, 0x36, 0x3D)
SUN_INK = ((0xFF, 0xDC, 0x65), (0xFF, 0x9C, 0x46), (0xFF, 0x3C, 0x8B))
_SEA = ((0xFF, 0xDC, 0x73), (0xFF, 0x9A, 0x4A), (0xFF, 0x4F, 0x8B), (0xB4, 0x57, 0xD6), (0x5A, 0x46, 0xA8))
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def mix(a: tuple[int, ...], b: tuple[int, ...], k: float) -> tuple[int, ...]:
    return tuple(round(x + (y - x) * k) for x, y in zip(a, b))


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


def columns() -> int:
    """The width of the terminal this process writes to; 0 in a gateway, which has none."""
    try:
        return os.get_terminal_size(sys.__stdout__.fileno()).columns
    except (AttributeError, OSError, ValueError):
        return 0


def sea(dx: float) -> tuple[str, tuple[int, ...]] | None:
    far = abs(dx)
    wave = math.sin(far * 0.62) + 0.8 * math.sin(dx * 0.31) + 0.6 * math.sin(dx * 1.37)
    level = wave * 0.62 + 1.05 - far / 34
    if level < 0.22:
        return None
    hue = min(3.99, far / 13)
    base = mix(_SEA[int(hue)], _SEA[int(hue) + 1], hue % 1)
    return "~" if level > 1.0 else "-" if level > 0.55 else ".", mix(FAINT, base, min(1.0, 0.18 + level * 0.55))


def sun_cells(r: int) -> list[tuple[str, bool]]:
    """One row of the dome as (glyph, whether a dark slit stands under it)."""
    out = []
    for x in range(SUN_W):
        d = (x - (SUN_W - 1) / 2) / (SUN_W / 2)
        fill = max(0, min(8, math.floor(math.sqrt(1 - d * d) * 24 + 0.5) - (2 - r) * 8))
        glyph = " ▁▂▃▄▅▆▇█"[fill] if fill < 8 or r == 0 else "▇" if r == 1 else "▆"
        out.append((glyph, fill == 8 and r > 0))
    return out
