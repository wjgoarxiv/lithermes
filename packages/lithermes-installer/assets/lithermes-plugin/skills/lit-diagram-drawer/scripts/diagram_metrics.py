"""Dependency-free SVG text, clipping, contrast, and accessibility metrics."""

from __future__ import annotations

from html import unescape
import math
from pathlib import Path
import re
from typing import TypedDict

from diagram_geometry import ParsedSvg, Rect, parse_svg


class ContrastFailure(TypedDict):
    text: str
    ratio: float


class DiagramMetrics(TypedDict):
    source: str
    hasSvg: bool
    viewBox: Rect | None
    title: bool
    desc: bool
    roleImage: bool
    ariaLinked: bool
    textCount: int
    textOverlaps: int
    objectOverlaps: int
    offCanvas: int
    offCanvasLabels: list[str]
    arrowCrossings: int
    contrastFailures: list[ContrastFailure]
    colors: int
    largeRadius: int
    hasShadow: bool
    fontFamilyPresent: bool
    localFont: bool
    fontFileValid: bool
    visibleText: str
    type: str
    sourceBytes: int


def _intersects(first: Rect, second: Rect) -> bool:
    return first.x < second.right - 1 and first.right > second.x + 1 and first.y < second.bottom - 1 and first.bottom > second.y + 1


def _contains(first: Rect, second: Rect) -> bool:
    return first.x <= second.x + 1 and first.y <= second.y + 1 and first.right >= second.right - 1 and first.bottom >= second.bottom - 1


def _luminance(color: str) -> float | None:
    if not re.fullmatch(r"#[0-9a-f]{3}(?:[0-9a-f]{3})?", color, re.IGNORECASE):
        return None
    digits = color[1:]
    if len(digits) == 3:
        digits = "".join(character * 2 for character in digits)
    channels = [int(digits[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(foreground: str, background: str) -> float | None:
    """Return WCAG contrast for literal hex colors; unresolved CSS stays unscored."""
    first, second = _luminance(foreground), _luminance(background)
    if first is None or second is None:
        return None
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)


def _visible_text(source: str, parsed: ParsedSvg) -> str:
    from_svg = "\n".join(re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", match.group(1)))).strip() for match in re.finditer(r"<(?:text|title|desc)\b[^>]*>([\s\S]*?)</(?:text|title|desc)\s*>", parsed.svg, re.IGNORECASE))
    document = re.sub(r"<head\b[^>]*>[\s\S]*?</head\s*>|<style\b[^>]*>[\s\S]*?</style\s*>|<script\b[^>]*>[\s\S]*?</script\s*>|<svg\b[^>]*>[\s\S]*?</svg\s*>", " ", source, flags=re.IGNORECASE)
    html_text = re.sub(r"<[^>]*>", " ", unescape(document))
    html_text = re.sub(r"\s+", " ", html_text).strip()
    return "\n".join(value for value in (from_svg, html_text) if value)


def _line_crossings(parsed: ParsedSvg) -> int:
    segments = list(dict.fromkeys([*parsed.line_segments, *(segment for route in parsed.routes for segment in route.segments)]))
    crossings = 0
    for index, first in enumerate(segments):
        for second in segments[index + 1:]:
            a = (first[0], first[1])
            b = (first[2], first[3])
            c = (second[0], second[1])
            d = (second[2], second[3])
            shared = any(math.hypot(point[0] - other[0], point[1] - other[1]) < 2 for point in (a, b) for other in (c, d))
            if not shared and _orientation(a, b, c) * _orientation(a, b, d) < 0 and _orientation(c, d, a) * _orientation(c, d, b) < 0:
                crossings += 1
    return crossings


def _orientation(first: tuple[float, float], second: tuple[float, float], third: tuple[float, float]) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def source_metrics(source: str, source_path: str = "<stdin>") -> DiagramMetrics:
    """Measure accessible text and geometric warning conditions in an SVG document."""
    parsed = parse_svg(source)
    view = parsed.view_box
    geometry = [shape.rect for shape in parsed.shapes] + [text.bounds for text in parsed.texts]
    off_canvas: list[str] = []
    if view is not None:
        for index, rect in enumerate(geometry):
            if rect.x < view.x - 1 or rect.y < view.y - 1 or rect.right > view.right + 1 or rect.bottom > view.bottom + 1:
                off_canvas.append(parsed.texts[index - len(parsed.shapes)].label if index >= len(parsed.shapes) else parsed.shapes[index].kind)
    text_overlaps = sum(_intersects(first.bounds, second.bounds) for index, first in enumerate(parsed.texts) for second in parsed.texts[index + 1:])
    visible_shapes = [shape for shape in parsed.shapes if not (view is not None and shape.rect.w >= view.w - 2 and shape.rect.h >= view.h - 2)]
    venn = re.search(r"diagram-venn-(?:light|dark|full)", parsed.attributes.get("id", "")) is not None
    object_overlaps = 0
    for index, first in enumerate(visible_shapes):
        for second in visible_shapes[index + 1:]:
            venn_pair = venn and first.kind == "circle" and second.kind == "circle"
            if not venn_pair and _intersects(first.rect, second.rect) and not _contains(first.rect, second.rect) and not _contains(second.rect, first.rect):
                object_overlaps += 1
    visible_rects = [shape for shape in parsed.shapes if shape.kind == "rect" and shape.fill.lower() not in {"none", "transparent"}]
    paper = "#ffffff"
    if visible_rects:
        visible_rects.sort(key=lambda shape: (bool(view and shape.rect.x <= view.x + 1 and shape.rect.y <= view.y + 1 and shape.rect.w >= view.w - 2 and shape.rect.h >= view.h - 2), shape.rect.w * shape.rect.h), reverse=True)
        paper = visible_rects[0].fill or paper
    failures: list[ContrastFailure] = []
    for label in parsed.texts:
        ratio = contrast_ratio(label.fill, paper)
        if ratio is not None and ratio < 4.5:
            failures.append({"text": label.label, "ratio": round(ratio, 2)})
    colors = {
        match.group(1).lower()
        for match in re.finditer(r"\b(?:fill|stroke)\s*=\s*['\"](#[0-9a-f]{3,8})['\"]", parsed.svg, re.IGNORECASE)
    }
    family_present = bool(re.search(r"Pretendard", parsed.svg, re.IGNORECASE) and re.search(r"Pretendard", source, re.IGNORECASE))
    font_urls = [unescape(match.group(1).strip()) for match in re.finditer(r"@font-face\b[\s\S]{0,250}?url\(\s*['\"]?([^'\")]+)['\"]?\)", source, re.IGNORECASE)]
    local_font = any(url.lower().startswith("data:font/") or not re.match(r"https?://", url, re.IGNORECASE) and re.search(r"\.(?:woff2?|ttf|otf)(?:[?#].*)?$", url, re.IGNORECASE) for url in font_urls)
    font_file_valid = any(
        url.lower().startswith("data:font/")
        or not re.match(r"https?://", url, re.IGNORECASE)
        and source_path != "<stdin>"
        and (Path(source_path).resolve().parent / re.split(r"[?#]", url, maxsplit=1)[0]).is_file()
        for url in font_urls
    )
    return {
        "source": source_path,
        "hasSvg": bool(parsed.svg),
        "viewBox": view,
        "title": bool(re.search(r"<title\b[^>]*>[\s\S]*?</title\s*>", parsed.svg, re.IGNORECASE)),
        "desc": bool(re.search(r"<desc\b[^>]*>[\s\S]*?</desc\s*>", parsed.svg, re.IGNORECASE)),
        "roleImage": bool(re.search(r"\brole\s*=\s*['\"]img['\"]", parsed.svg, re.IGNORECASE)),
        "ariaLinked": bool(parsed.attributes.get("aria-labelledby")),
        "textCount": len(parsed.texts),
        "textOverlaps": text_overlaps,
        "objectOverlaps": object_overlaps,
        "offCanvas": len(off_canvas),
        "offCanvasLabels": off_canvas[:12],
        "arrowCrossings": _line_crossings(parsed),
        "contrastFailures": failures,
        "colors": len(colors),
        "largeRadius": sum(float(shape.attributes.get("rx", "0") or 0) > 8 for shape in parsed.shapes if shape.kind == "rect"),
        "hasShadow": bool(re.search(r"\bbox-shadow\s*:|filter\s*=\s*['\"]url\(#", source, re.IGNORECASE)),
        "fontFamilyPresent": family_present,
        "localFont": local_font,
        "fontFileValid": font_file_valid,
        "visibleText": _visible_text(source, parsed),
        "type": parsed.attributes.get("id", ""),
        "sourceBytes": len(source.encode("utf-8")),
    }
