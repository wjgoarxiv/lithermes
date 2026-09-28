"""Standard-library parsing and geometry assembly for inline SVG diagrams."""

from __future__ import annotations

import re
from math import isfinite
from types import MappingProxyType
from typing import assert_never

from diagram_records import (
    Boundary, Marker, ParsedSvg, Rect, Route, Shape, TextBox,
    _PATH_TOKEN_RE, _clean, _number, _path_segments, attributes, glyph_width,
)

_SVG_RE = re.compile(r"<svg\b([^>]*)>([\s\S]*?)</svg\s*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<(rect|circle|line|path|text|polygon)\b([^>]*)>([\s\S]*?)</\1\s*>|<(rect|circle|line|path|polygon)\b([^>]*)/?>", re.IGNORECASE)

def _parse_shape(kind: str, raw_attrs: str, body: str = "") -> Shape | TextBox | None:
    attrs = attributes(raw_attrs)
    if kind.lower() == "text":
        label = _clean(body)
        if not label:
            return None
        size = _number(attrs.get("font-size"), 16)
        width = glyph_width(label, size)
        anchor = attrs.get("text-anchor", "start")
        x = _number(attrs.get("x")) - (width / 2 if anchor == "middle" else width if anchor == "end" else 0)
        y = _number(attrs.get("y")) - size * 0.82
        return TextBox(
            label=label,
            bounds=Rect(x, y, width, size * 1.22),
            anchor=(_number(attrs.get("x")), _number(attrs.get("y"))),
            font_size=size,
            fill=attrs.get("fill", "#000000"),
            role=attrs.get("data-role", ""),
            edge_for=attrs.get("data-edge-for", ""),
            boundary_for=attrs.get("data-boundary-for", attrs.get("data-group-for", "")),
        )
    kind = kind.lower()
    if kind == "rect":
        rect = Rect(_number(attrs.get("x")), _number(attrs.get("y")), _number(attrs.get("width")), _number(attrs.get("height")))
    elif kind == "circle":
        radius = _number(attrs.get("r"))
        center_x, center_y = _number(attrs.get("cx")), _number(attrs.get("cy"))
        rect = Rect(center_x - radius, center_y - radius, radius * 2, radius * 2)
    else:
        return None
    if rect.w <= 2 or rect.h <= 2:
        return None
    return Shape(kind, rect, attrs.get("fill", ""), attrs)


def _marker_points(body: str) -> tuple[tuple[float, float], ...]:
    points: list[tuple[float, float]] = []
    for match in re.finditer(r"<(path|polygon)\b([^>]*)>", body, re.IGNORECASE):
        attrs = attributes(match.group(2))
        if match.group(1).lower() == "polygon":
            values = [float(value) for value in _PATH_TOKEN_RE.findall(attrs.get("points", "")) if not value.isalpha()]
            points.extend((values[i], values[i + 1]) for i in range(0, len(values) - 1, 2))
        else:
            for segment in _path_segments(attrs.get("d", "")):
                if not points:
                    points.append((segment[0], segment[1]))
                points.append((segment[2], segment[3]))
    return tuple(points)


def parse_svg(source: str) -> ParsedSvg:
    """Parse SVG tags and geometric metadata without invoking a renderer."""
    matches = tuple(_SVG_RE.finditer(source))
    svg = "\n".join(match.group(0) for match in matches)
    first_attrs = attributes(matches[0].group(1)) if matches else MappingProxyType({})
    try:
        view_values = [float(value) for value in re.split(r"[\s,]+", first_attrs.get("viewBox", "").strip()) if value]
    except ValueError:
        view_values = []
    view_box = Rect(*view_values) if len(view_values) == 4 else None
    shapes: list[Shape] = []
    texts: list[TextBox] = []
    routes: list[Route] = []
    line_segments: list[Segment] = []
    boundaries: list[Boundary] = []
    for match in _TAG_RE.finditer(svg):
        kind = match.group(1) or match.group(4)
        raw_attrs = match.group(2) if match.group(1) else match.group(5) or ""
        body = match.group(3) or ""
        if kind is None:
            continue
        attrs = attributes(raw_attrs)
        parsed = _parse_shape(kind, raw_attrs, body)
        match parsed:
            case TextBox():
                texts.append(parsed)
            case Shape():
                shapes.append(parsed)
            case None:
                pass
            case unreachable:
                assert_never(unreachable)
        if kind.lower() == "line":
            points = tuple(_number(attrs.get(key), float("nan")) for key in ("x1", "y1", "x2", "y2"))
            if all(isfinite(value) for value in points):
                segment = (points[0], points[1], points[2], points[3])
                if "data-lifeline-for" not in attrs:
                    line_segments.append(segment)
                if attrs.get("data-from") and attrs.get("data-to"):
                    routes.append(Route(attrs["data-from"], attrs["data-to"], attrs.get("data-label", ""), (segment,), attrs.get("marker-start", ""), attrs.get("marker-end", ""), _number(attrs.get("stroke-width"), 1)))
        if kind.lower() == "rect" and "data-from" in attrs and "data-to" in attrs:
            continue
        if kind.lower() == "path" and attrs.get("data-from") and attrs.get("data-to"):
            segments = _path_segments(attrs.get("d", ""), curve_steps=16)
            if segments:
                routes.append(Route(attrs["data-from"], attrs["data-to"], attrs.get("data-label", ""), segments, attrs.get("marker-start", ""), attrs.get("marker-end", ""), _number(attrs.get("stroke-width"), 1)))
    for shape in shapes:
        attrs = shape.attributes
        marker_keys = ("data-trust-boundary", "data-boundary", "data-boundary-name", "data-group-boundary", "data-group-name", "data-group-label", "data-group-id")
        class_marker = re.search(r"\b(?:boundary|group)(?:[-_][\w-]+)?\b", attrs.get("class", ""), re.IGNORECASE)
        if shape.kind != "rect" or not any(key in attrs for key in marker_keys) and not class_marker:
            continue
        labels = tuple(attrs[key] for key in ("data-trust-boundary", "data-boundary-name", "data-group-boundary", "data-group-name", "data-group-label") if attrs.get(key) and attrs[key] != "true")
        name = attrs.get("data-group-id", attrs.get("id", labels[0] if labels else "outline"))
        boundaries.append(Boundary(name, labels, shape.rect, _number(attrs.get("stroke-width"), 1)))
    markers: dict[str, Marker] = {}
    for match in re.finditer(r"<marker\b([^>]*)>([\s\S]*?)</marker\s*>", svg, re.IGNORECASE):
        attrs = attributes(match.group(1))
        name = attrs.get("id", "")
        if name:
            body = match.group(2)
            markers[name] = Marker(name, _number(attrs.get("refX")), _number(attrs.get("refY")), attrs.get("markerUnits", "strokeWidth"), _marker_points(body), bool(re.search(r"\bz\b|<polygon\b", body, re.IGNORECASE)))
    return ParsedSvg(source, svg, first_attrs, view_box, tuple(shapes), tuple(texts), tuple(routes), tuple(line_segments), tuple(boundaries), MappingProxyType(markers))
