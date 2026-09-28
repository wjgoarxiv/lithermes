"""Canonical LIT rows, terminal policy, and native Hermes ignition surfaces."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_ROWS = json.loads(Path(__file__).with_name("lit_mark_rows.json").read_text(encoding="utf-8"))
standard = [row["text"] for row in _ROWS["standard"]]
banner = [row["text"] for row in _ROWS["banner"]]
micro = [row["text"] for row in _ROWS["micro"]]
_GLYPHS = frozenset("█▓▀▄▌▐▖▗▘▝▙▛▜▟▚▞")
_INDEXED = {"#FF6337": 203, "#D7F75B": 191, "#F2EFDF": 230}
_ACTIVATION_STOPS = ((255, 99, 55), (255, 45, 149), (0, 229, 255))
_XTERM_LEVELS = (0, 95, 135, 175, 215, 255)
_XTERM_256 = (
    [(16 + 36 * r + 6 * g + b, (red, green, blue))
     for r, red in enumerate(_XTERM_LEVELS)
     for g, green in enumerate(_XTERM_LEVELS)
     for b, blue in enumerate(_XTERM_LEVELS)]
    + [(232 + i, (value, value, value)) for i, value in enumerate(range(8, 239, 10))]
)


def lockup(productName: str, rows=None) -> list[str]:
    if not isinstance(productName, str) or not re.fullmatch(r"[a-zA-Z0-9 .·_-]+", productName):
        raise ValueError("product name must be a plain single line")
    rows = standard if rows is None else rows
    column = max(map(len, rows)) + 8
    return [row.ljust(column) + productName if i == len(rows) // 2 else row for i, row in enumerate(rows)]


def _cells_for(rows):
    return next((cells for cells in _ROWS.values() if len(cells) == len(rows)
                 and all(row.startswith(cell["text"]) for row, cell in zip(rows, cells))), None)


def colorize(rows, options=None, *, mode=None, shadow=None) -> list[str]:
    options = options or {}
    mode = mode or options.get("mode", "none")
    if mode not in {"none", "256", "truecolor"}:
        raise ValueError("invalid color mode")
    if mode == "none":
        return list(rows)
    # Keep the old shadow keyword callable; the flat approved mark has no shadow.
    cells = _cells_for(rows)
    output = []
    for i, row in enumerate(rows):
        painted = []
        for column, ch in enumerate(row):
            hex_color = (cells[i]["colors"][column] if column < len(cells[i]["colors"]) else None) if cells else "#F2EFDF"
            if ch not in _GLYPHS or not hex_color:
                painted.append(ch)
                continue
            ink = f"38;5;{_INDEXED[hex_color]}" if mode == "256" else "38;2;" + ";".join(
                str(int(hex_color[offset:offset + 2], 16)) for offset in (1, 3, 5))
            painted.append(f"\x1b[{ink}m{ch}\x1b[0m")
        output.append("".join(painted))
    return output


def utf8_terminal(env=None) -> bool:
    env = os.environ if env is None else env
    locale = env.get("LC_ALL") or env.get("LC_CTYPE") or env.get("LANG", "")
    return env.get("TERM") != "dumb" and (not locale or bool(re.search(r"utf-?8", locale, re.I)))


def color_mode(*, stream=None, env=None, json=False) -> str:
    env = os.environ if env is None else env
    stream = sys.stdout if stream is None else stream
    if json or "NO_COLOR" in env or "CI" in env or not stream.isatty() or not utf8_terminal(env):
        return "none"
    return "truecolor" if re.search(r"truecolor|24bit", env.get("COLORTERM", ""), re.I) or "direct" in env.get("TERM", "").lower() else "256"


def render(rows, *, env=None, stream=None, json=False, mode=None) -> list[str]:
    if not utf8_terminal(env):
        return ["LIT"]
    detected = color_mode(env=env, stream=stream, json=json)
    return colorize(rows, mode="none" if detected == "none" else mode or detected)


def discipline(route: str) -> str:
    canonical = {"lit": "litwork", "litwork-loop": "lit-loop", "litwork-plan": "lit-plan",
                 "durable-workflow": "lit-loop", "kanban-team": "lit-team",
                 "korean-prose-cleanup": "lit-humanizer"}.get(route, route)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", canonical):
        raise ValueError("invalid route discipline")
    return canonical


def probe_line(route: str) -> str:
    return f"🔥 **LIT IGNITED · {discipline(route)}** 🔥"


def harness_banner(route: str) -> str:
    return f"🔥 LIT IGNITED · {discipline(route)} 🔥"


def _gradient_color(progress: float) -> tuple[int, int, int]:
    segment = min(len(_ACTIVATION_STOPS) - 2, int(progress * (len(_ACTIVATION_STOPS) - 1)))
    fraction = progress * (len(_ACTIVATION_STOPS) - 1) - segment
    start, end = _ACTIVATION_STOPS[segment:segment + 2]
    return tuple(int(a + (b - a) * fraction + 0.5) for a, b in zip(start, end))


def _nearest_256(rgb: tuple[int, int, int]) -> int:
    return min(_XTERM_256, key=lambda item: sum((a - b) ** 2 for a, b in zip(rgb, item[1])))[0]


def _paint_activation(text: str, mode: str) -> str:
    if mode == "none":
        return text
    chars = list(text)
    last = len(chars) - 1
    painted = []
    for index, char in enumerate(chars):
        if char == " ":
            painted.append(char)
            continue
        rgb = _gradient_color(index / last if last else 0)
        color = ("38;2;" + ";".join(map(str, rgb)) if mode == "truecolor"
                 else f"38;5;{_nearest_256(rgb)}")
        painted.append(f"\x1b[1m\x1b[{color}m{char}\x1b[0m")
    return "".join(painted)


def probe_contract(route: str) -> str:
    return (f"Begin your reply with exactly this one model-emitted line: `{probe_line(route)}`\n"
            "Emit it once, exactly as shown, on its own first line. This route's discipline overrides any generic skill probe. "
            "The harness renders the mark separately; do not draw or repeat it.")


def acknowledgement(route: str, *, color=False, mode=None, **options) -> str:
    # Slash display accepts ANSI; natural reply transforms enter Markdown and
    # transcripts, where the mark remains plain. Never color the model probe.
    label = f"LIT IGNITED · {discipline(route)}"
    if not utf8_terminal(options.get("env")):
        return f"LIT\n🔥 {label} 🔥"
    detected = color_mode(**options)
    paint_mode = "none" if not color or detected == "none" else mode or detected
    if paint_mode not in {"none", "256", "truecolor"}:
        raise ValueError("invalid color mode")
    rows = [row.rstrip() for row in micro]
    width = max(map(len, rows))
    rows = [row.ljust(width) for row in rows]
    middle = len(rows) // 2
    rows = [_paint_activation(row, paint_mode) for row in rows]
    rows[middle] += "  🔥 " + _paint_activation(label, paint_mode) + " 🔥"
    return "\n".join(rows)


def acknowledge_reply(route: str, response: str) -> str:
    # The host keeps only the suffix when a transformed response starts with
    # the streamed body. Indented plain lines preserve MICRO rows in Markdown
    # without replaying the model response or adding a fence.
    suffix = "\n".join(f"    {row}" for row in acknowledgement(route).splitlines())
    return f"{response}\n\n{suffix}" if response else suffix


def skin_logo(*, env=None, stream=None, json=False) -> str:
    if not utf8_terminal(env):
        return "LIT"
    mode = color_mode(env=env, stream=stream, json=json)
    if mode == "none":
        return "\n".join(standard)
    output = []
    for row in _ROWS["standard"]:
        painted = []
        for ch, hex_color in zip(row["text"], row["colors"]):
            if hex_color:
                ink = hex_color if mode == "truecolor" else f"color({_INDEXED[hex_color]})"
                painted.append(f"[{ink}]{ch}[/]")
            else:
                painted.append(ch)
        output.append("".join(painted))
    return "\n".join(output)


def configure_welcome_skin() -> None:
    """Adjust the active managed skin in memory; the host draws it at welcome."""
    try:
        from hermes_cli.skin_engine import get_active_skin, get_active_skin_name
    except ImportError:
        return
    if get_active_skin_name().startswith("lithermes-"):
        get_active_skin().banner_logo = skin_logo(json="--json" in sys.argv)
