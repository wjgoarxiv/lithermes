"""Immutable geometry records and SVG lexical helpers."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
import re
from types import MappingProxyType
from typing import Mapping

_ATTR_RE = re.compile(r"([\w:-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')")
_PATH_TOKEN_RE = re.compile(r"[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?", re.IGNORECASE)

@dataclass(frozen=True, slots=True)
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h


@dataclass(frozen=True, slots=True)
class Shape:
    kind: str
    rect: Rect
    fill: str
    attributes: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class TextBox:
    label: str
    bounds: Rect
    anchor: tuple[float, float]
    font_size: float
    fill: str
    role: str
    edge_for: str
    boundary_for: str


Segment = tuple[float, float, float, float]


@dataclass(frozen=True, slots=True)
class Route:
    from_id: str
    to_id: str
    label: str
    segments: tuple[Segment, ...]
    marker_start: str
    marker_end: str
    stroke_width: float


@dataclass(frozen=True, slots=True)
class Boundary:
    name: str
    labels: tuple[str, ...]
    rect: Rect
    stroke_width: float


@dataclass(frozen=True, slots=True)
class Marker:
    name: str
    ref_x: float
    ref_y: float
    units: str
    points: tuple[tuple[float, float], ...]
    closed: bool


@dataclass(frozen=True, slots=True)
class ParsedSvg:
    source: str
    svg: str
    attributes: Mapping[str, str]
    view_box: Rect | None
    shapes: tuple[Shape, ...]
    texts: tuple[TextBox, ...]
    routes: tuple[Route, ...]
    line_segments: tuple[Segment, ...]
    boundaries: tuple[Boundary, ...]
    markers: Mapping[str, Marker]


def attributes(markup: str) -> Mapping[str, str]:
    """Read quoted SVG attributes without evaluating or normalizing source markup."""
    return MappingProxyType({
        match.group(1): unescape(match.group(2) if match.group(2) is not None else match.group(3) or "")
        for match in _ATTR_RE.finditer(markup)
    })


def _number(value: str | None, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()


def glyph_width(text: str, font_size: float) -> float:
    units = 0.0
    for character in text:
        if character.isspace():
            units += 0.28
        elif "\u1100" <= character <= "\ud7af":
            units += 0.98
        elif character in "ilI.,:;!|":
            units += 0.32
        elif character in "MW@#%":
            units += 0.82
        else:
            units += 0.56
    return units * font_size


def _path_segments(path_data: str, *, curve_steps: int = 12) -> tuple[Segment, ...]:
    tokens = _PATH_TOKEN_RE.findall(path_data)
    segments: list[Segment] = []
    index = 0
    command = ""
    x = y = start_x = start_y = 0.0

    def is_command(token: str) -> bool:
        return len(token) == 1 and token.isalpha()

    def point(relative: bool) -> tuple[float, float]:
        nonlocal index
        px = float(tokens[index])
        py = float(tokens[index + 1])
        index += 2
        return (x + px, y + py) if relative else (px, py)

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            index += 1
        if not command:
            break
        relative = command.islower()
        verb = command.upper()
        if verb == "Z":
            if (x, y) != (start_x, start_y):
                segments.append((x, y, start_x, start_y))
            x, y, command = start_x, start_y, ""
        elif verb in {"M", "L"}:
            if index + 1 >= len(tokens) or is_command(tokens[index]):
                command = ""
                continue
            nx, ny = point(relative)
            if verb == "L":
                segments.append((x, y, nx, ny))
            x, y = nx, ny
            if verb == "M":
                start_x, start_y = x, y
                command = "l" if relative else "L"
        elif verb in {"H", "V"}:
            if index >= len(tokens) or is_command(tokens[index]):
                command = ""
                continue
            value = float(tokens[index])
            index += 1
            nx, ny = (x + value if relative else value, y) if verb == "H" else (x, y + value if relative else value)
            segments.append((x, y, nx, ny))
            x, y = nx, ny
        elif verb == "C":
            if index + 5 >= len(tokens) or is_command(tokens[index]):
                command = ""
                continue
            c1 = point(relative)
            c2 = point(relative)
            end = point(relative)
            origin = (x, y)
            previous = origin
            for step in range(1, curve_steps + 1):
                t = step / curve_steps
                u = 1 - t
                current = (
                    u**3 * origin[0] + 3 * u**2 * t * c1[0] + 3 * u * t**2 * c2[0] + t**3 * end[0],
                    u**3 * origin[1] + 3 * u**2 * t * c1[1] + 3 * u * t**2 * c2[1] + t**3 * end[1],
                )
                segments.append((previous[0], previous[1], current[0], current[1]))
                previous = current
            x, y = end
        else:
            while index < len(tokens) and not is_command(tokens[index]):
                index += 1
            command = ""
    return tuple(segments)
