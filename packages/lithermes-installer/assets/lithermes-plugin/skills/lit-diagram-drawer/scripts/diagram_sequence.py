"""Sequence-diagram lifeline, endpoint, and message-order checks."""

from __future__ import annotations

import re

from diagram_geometry import ParsedSvg
from diagram_records import Shape
from diagram_records import attributes


def sequence_issues(source: str, parsed: ParsedSvg, nodes: tuple[Shape, ...]) -> list[str]:
    """Check participants and ordered messages when the source declares a sequence."""
    declared = re.search(r"\bdata-type\s*=\s*['\"]sequence(?:-oauth)?['\"]", source, re.IGNORECASE)
    identified = re.search(r"\bid\s*=\s*['\"]diagram-sequence(?:-oauth)?-[^'\"]+['\"]", parsed.svg, re.IGNORECASE)
    if not declared and not identified:
        return []
    lifelines: dict[str, tuple[float, float, float]] = {}
    for match in re.finditer(r"<line\b([^>]*)/?>", parsed.svg, re.IGNORECASE):
        attrs = attributes(match.group(1))
        name = attrs.get("data-lifeline-for", "")
        if name and attrs.get("stroke-dasharray") and attrs.get("x1") == attrs.get("x2"):
            try:
                top, bottom = float(attrs.get("y1", "nan")), float(attrs.get("y2", "nan"))
            except ValueError:
                continue
            if bottom > top:
                lifelines[name] = (float(attrs["x1"]), top, bottom)
    messages = [
        (route, route.segments[0][:2], route.segments[-1][2:], (route.segments[0][1] + route.segments[-1][3]) / 2)
        for route in parsed.routes if route.segments
    ]
    issues: list[str] = []
    last_message_y = max((message[3] for message in messages), default=0)
    for node in nodes:
        name = node.attributes["data-node-id"]
        line = lifelines.get(name)
        if line is None:
            issues.append(f"SEQUENCE_LIFELINE_MISSING {name}")
            continue
        if abs(line[0] - (node.rect.x + node.rect.w / 2)) > 1 or abs(line[1] - node.rect.bottom) > 1:
            issues.append(f"SEQUENCE_LIFELINE_ALIGNMENT {name}")
        if line[2] + 1 < last_message_y:
            issues.append(f"SEQUENCE_LIFELINE_SHORT {name} ends before last message")
    previous_y = float("-inf")
    for route, start, end, message_y in messages:
        from_line, to_line = lifelines.get(route.from_id), lifelines.get(route.to_id)
        if from_line is None or to_line is None:
            continue
        if abs(start[0] - from_line[0]) > 1 or abs(end[0] - to_line[0]) > 1:
            issues.append(f"SEQUENCE_MESSAGE_OFF_LIFELINE {route.from_id}->{route.to_id}")
        if message_y <= previous_y:
            issues.append(f"SEQUENCE_MESSAGE_ORDER {route.from_id}->{route.to_id} is not top-to-bottom")
        previous_y = message_y
    return issues
