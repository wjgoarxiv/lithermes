"""Small geometry predicates shared by the visual-quality checks."""

from __future__ import annotations

from math import hypot

from diagram_records import Boundary, Marker, Rect, Route, Segment, TextBox


def segment_hits_rect(segment: Segment, rect: Rect, pad: float = 0) -> bool:
    """Check axis-aligned routes exactly and diagonal routes by bounded sampling."""
    x1, y1, x2, y2 = segment
    left, right = rect.x - pad, rect.right + pad
    top, bottom = rect.y - pad, rect.bottom + pad
    if x1 == x2:
        return left <= x1 <= right and max(y1, y2) >= top and min(y1, y2) <= bottom
    if y1 == y2:
        return top <= y1 <= bottom and max(x1, x2) >= left and min(x1, x2) <= right
    return any(
        left <= x1 + (x2 - x1) * step / 24 <= right
        and top <= y1 + (y2 - y1) * step / 24 <= bottom
        for step in range(25)
    )


def segment_hits_text(segment: Segment, text: TextBox, pad: float = 1) -> bool:
    bounds = text.bounds
    return segment_hits_rect(segment, Rect(bounds.x - pad, bounds.y - pad, bounds.w + 2 * pad, bounds.h + 2 * pad))


def text_overlaps_node(text: TextBox, node: Rect, pad: float = 1) -> bool:
    bounds = text.bounds
    return bounds.x < node.right + pad and bounds.right > node.x - pad and bounds.y < node.bottom + pad and bounds.bottom > node.y - pad


def rectangle_gap(first: Rect, second: Rect) -> float:
    dx = max(0.0, first.x - second.right, second.x - first.right)
    dy = max(0.0, first.y - second.bottom, second.y - first.bottom)
    return hypot(dx, dy)


def point_segment_distance(point: tuple[float, float], segment: Segment) -> float:
    x1, y1, x2, y2 = segment
    dx, dy = x2 - x1, y2 - y1
    length = dx * dx + dy * dy
    weight = max(0.0, min(1.0, ((point[0] - x1) * dx + (point[1] - y1) * dy) / length)) if length else 0.0
    return hypot(point[0] - (x1 + weight * dx), point[1] - (y1 + weight * dy))


def route_distance(point: tuple[float, float], route: Route) -> float:
    return min((point_segment_distance(point, segment) for segment in route.segments), default=float("inf"))


def route_length(route: Route) -> float:
    return sum(hypot(segment[2] - segment[0], segment[3] - segment[1]) for segment in route.segments)


def route_bends(route: Route) -> int:
    directions = []
    for x1, y1, x2, y2 in route.segments:
        length = hypot(x2 - x1, y2 - y1)
        if length:
            directions.append(((x2 - x1) / length, (y2 - y1) / length))
    return sum(
        directions[index - 1][0] * directions[index][0] + directions[index - 1][1] * directions[index][1] < 2**-0.5
        for index in range(1, len(directions))
    )


def route_manhattan_distance(route: Route) -> float | None:
    if not route.segments:
        return None
    first, last = route.segments[0], route.segments[-1]
    distance = abs(first[0] - last[2]) + abs(first[1] - last[3])
    return distance or None


def route_crosses_boundary(route: Route, boundary: Boundary) -> bool:
    points = [
        point
        for x1, y1, x2, y2 in route.segments
        for point in ((x1, y1), (x2, y2), ((x1 + x2) / 2, (y1 + y2) / 2))
    ]
    inside = any(boundary.rect.x < x < boundary.rect.right and boundary.rect.y < y < boundary.rect.bottom for x, y in points)
    outside = any(x < boundary.rect.x or x > boundary.rect.right or y < boundary.rect.y or y > boundary.rect.bottom for x, y in points)
    return inside and outside


def segment_along_boundary(segment: Segment, boundary: Boundary) -> bool:
    x1, y1, x2, y2 = segment
    rect = boundary.rect
    if abs(y1 - y2) <= 1:
        overlap = min(max(x1, x2), rect.right) - max(min(x1, x2), rect.x)
        return overlap > 12 and (abs(y1 - rect.y) <= 4 or abs(y1 - rect.bottom) <= 4)
    if abs(x1 - x2) <= 1:
        overlap = min(max(y1, y2), rect.bottom) - max(min(y1, y2), rect.y)
        return overlap > 12 and (abs(x1 - rect.x) <= 4 or abs(x1 - rect.right) <= 4)
    return False


def _orientation(first: tuple[float, float], second: tuple[float, float], third: tuple[float, float]) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def segment_intersection(first: Segment, second: Segment) -> tuple[float, float] | None:
    rx, ry, sx, sy = first[2] - first[0], first[3] - first[1], second[2] - second[0], second[3] - second[1]
    denominator = rx * sy - ry * sx
    if abs(denominator) < 1e-8:
        return None
    qx, qy = second[0] - first[0], second[1] - first[1]
    t, u = (qx * sy - qy * sx) / denominator, (qx * ry - qy * rx) / denominator
    return (first[0] + t * rx, first[1] + t * ry) if -1e-8 <= t <= 1 + 1e-8 and -1e-8 <= u <= 1 + 1e-8 else None


def route_crossings(first: Route, second: Route) -> tuple[tuple[float, float], ...]:
    first_endpoints = ((first.from_id, first.segments[0][:2]), (first.to_id, first.segments[-1][2:])) if first.segments else ()
    second_endpoints = ((second.from_id, second.segments[0][:2]), (second.to_id, second.segments[-1][2:])) if second.segments else ()
    points: list[tuple[float, float]] = []
    for left in first.segments:
        for right in second.segments:
            point = segment_intersection(left, right)
            if point is None:
                continue
            shared = any(
                left_id == right_id and hypot(left_point[0] - right_point[0], left_point[1] - right_point[1]) <= 0.5
                and hypot(left_point[0] - point[0], left_point[1] - point[1]) <= 0.5
                for left_id, left_point in first_endpoints for right_id, right_point in second_endpoints
            )
            if not shared and not any(hypot(old[0] - point[0], old[1] - point[1]) <= 0.5 for old in points):
                points.append(point)
    return tuple(points)


def routes_overlap_collinearly(first: Route, second: Route) -> bool:
    for ax1, ay1, ax2, ay2 in first.segments:
        for bx1, by1, bx2, by2 in second.segments:
            if abs(ay1 - ay2) <= 0.5 and abs(by1 - by2) <= 0.5 and abs(ay1 - by1) < 12:
                if min(max(ax1, ax2), max(bx1, bx2)) - max(min(ax1, ax2), min(bx1, bx2)) >= 12:
                    return True
            if abs(ax1 - ax2) <= 0.5 and abs(bx1 - bx2) <= 0.5 and abs(ax1 - bx1) < 12:
                if min(max(ay1, ay2), max(by1, by2)) - max(min(ay1, ay2), min(by1, by2)) >= 12:
                    return True
    return False


def marker_scale(marker: Marker, route: Route) -> float:
    return 1.0 if marker.units == "userSpaceOnUse" else route.stroke_width


def marker_length(marker: Marker) -> float:
    return max((point[0] for point in marker.points), default=0) - min((point[0] for point in marker.points), default=0)


def marker_tip(route: Route, marker: Marker, edge: str) -> tuple[float, float] | None:
    if not route.segments:
        return None
    segment = route.segments[-1] if edge == "end" else route.segments[0]
    x1, y1, x2, y2 = segment
    dx, dy = x2 - x1, y2 - y1
    length = hypot(dx, dy) or 1
    direction = 1 if edge == "end" else -1
    forward = max((direction * (point[0] - marker.ref_x) for point in marker.points), default=0) * marker_scale(marker, route)
    anchor = (x2, y2) if edge == "end" else (x1, y1)
    return anchor[0] + direction * dx / length * forward, anchor[1] + direction * dy / length * forward


def distance_to_rect_boundary(point: tuple[float, float], rect: Rect) -> float:
    x, y = point
    candidates = []
    if rect.y - 2 <= y <= rect.bottom + 2:
        candidates.extend((abs(x - rect.x), abs(x - rect.right)))
    if rect.x - 2 <= x <= rect.right + 2:
        candidates.extend((abs(y - rect.y), abs(y - rect.bottom)))
    if candidates:
        return min(candidates)
    return hypot(max(rect.x - x, 0, x - rect.right), max(rect.y - y, 0, y - rect.bottom))


def marker_overlaps_rect(route: Route, rect: Rect, marker: Marker) -> bool:
    """Transform marker outline points onto the final routed segment."""
    if not route.segments:
        return False
    x1, y1, x2, y2 = route.segments[-1]
    length = hypot(x2 - x1, y2 - y1) or 1
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    nx, ny = -uy, ux
    scale = marker_scale(marker, route)
    points = tuple(
        (
            x2 + ux * (x - marker.ref_x) * scale + nx * (y - marker.ref_y) * scale,
            y2 + uy * (x - marker.ref_x) * scale + ny * (y - marker.ref_y) * scale,
        )
        for x, y in marker.points
    )
    if any(rect.x + 1 < x < rect.right - 1 and rect.y + 1 < y < rect.bottom - 1 for x, y in points):
        return True
    edges = tuple((points[index][0], points[index][1], points[index + 1][0], points[index + 1][1]) for index in range(len(points) - 1))
    if marker.closed and len(points) > 2:
        edges += ((points[-1][0], points[-1][1], points[0][0], points[0][1]),)
    return any(segment_hits_rect(edge, rect, -1) for edge in edges)
