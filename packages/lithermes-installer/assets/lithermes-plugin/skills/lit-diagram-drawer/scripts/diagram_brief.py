"""Brief-to-SVG checks for required content and trust-boundary membership."""

from __future__ import annotations

import re
from typing import TypedDict

from diagram_geometry import ParsedSvg, Shape, parse_svg


class BriefEdge(TypedDict):
    from_: str
    to: str
    label: str


class BoundaryMembership(TypedDict):
    declarationPresent: bool
    declared: bool
    internal: list[str]
    external: list[str]


class ParsedBrief(TypedDict):
    nodes: list[str]
    edges: list[BriefEdge]
    language: str
    allowedEnglishTerms: list[str]
    boundaryMembership: BoundaryMembership


class BoundaryReport(TypedDict):
    declared: bool
    boundaryCount: int
    internal: list[str]
    external: list[str]
    issues: list[str]


class BriefReport(TypedDict):
    language: str
    nodes: int
    relationships: int
    missingNodes: list[str]
    missingLabels: list[str]
    missingEdges: list[str]
    unpairedLabels: list[str]
    languageMismatches: list[str]
    boundaryMembership: BoundaryReport


def _terms(value: str) -> set[str]:
    return {term.lower() for term in re.findall(r"[A-Za-z][A-Za-z0-9]*(?:[.+/#-][A-Za-z0-9]+)*", value)}


def parse_brief(text: str) -> ParsedBrief:
    """Parse the explicit node, route, language, and boundary brief fields."""
    lines = [line.strip() for line in text.splitlines()]
    nodes: list[str] = []
    edges: list[BriefEdge] = []
    for line in lines:
        fact = re.match(r"^[-*]\s*(.+?)\s+participates in the labeled relationships below\.$", line)
        relation = re.match(r"^[-*]\s*(.+?)\s+→\s+(.+?)\s+\((.+)\)$", line)
        if fact:
            nodes.append(fact.group(1))
        elif relation:
            edges.append({"from_": relation.group(1), "to": relation.group(2), "label": relation.group(3)})
    unique_nodes = list(dict.fromkeys(nodes))
    title = next((line[2:].strip() for line in lines if line.startswith("# ")), "")
    title = re.sub(r"^(?:Diagram brief\s*[·:]\s*|Blind brief:\s*)", "", title, flags=re.IGNORECASE)
    purpose = next((re.sub(r"^[-*]\s*Purpose:\s*", "", line, flags=re.IGNORECASE) for line in lines if re.match(r"^[-*]\s*Purpose:", line, re.IGNORECASE)), "")
    content_parts = [title, purpose, *unique_nodes, *(part for edge in edges for part in (edge["from_"], edge["to"], edge["label"]))]
    language_sample = " ".join(content_parts)
    language = "ko" if len(re.findall(r"[\uac00-\ud7a3]", language_sample)) > len(re.findall(r"[A-Za-z]", language_sample)) else "en"
    internal_line = next((line for line in lines if re.match(r"^[-*]\s*Trust boundary internal nodes:", line, re.IGNORECASE)), "")
    external_line = next((line for line in lines if re.match(r"^[-*]\s*Trust boundary external nodes:", line, re.IGNORECASE)), "")

    def members(line: str) -> list[str]:
        return [name.strip() for name in line.split(":", 1)[1].split(";") if name.strip()] if line else []

    allowed = _terms(" ".join(part for part in content_parts if part))
    allowed.update(term.lower() for code in re.findall(r"`([^`]+)`", text) for term in _terms(code))
    allowed.update(
        term.lower()
        for line in lines
        if re.match(r"^[-*]\s*Allowed (?:English )?terms:", line, re.IGNORECASE)
        for term in _terms(re.sub(r"^[-*]\s*Allowed (?:English )?terms:\s*", "", line, flags=re.IGNORECASE))
    )
    membership: BoundaryMembership = {
        "declarationPresent": bool(internal_line or external_line),
        "declared": bool(internal_line and external_line),
        "internal": members(internal_line),
        "external": members(external_line),
    }
    return {
        "nodes": unique_nodes,
        "edges": edges,
        "language": language,
        "allowedEnglishTerms": sorted(allowed),
        "boundaryMembership": membership,
    }


def _boundary_membership(parsed: ParsedSvg, membership: BoundaryMembership) -> BoundaryReport:
    boundary_shapes = [shape for shape in parsed.shapes if "data-trust-boundary" in shape.attributes]
    issues: list[str] = []
    declared = membership["declared"]
    if not membership["declarationPresent"]:
        if boundary_shapes:
            issues.append("BOUNDARY_MEMBERSHIP_DECLARATION_MISSING")
        return {"declared": False, "boundaryCount": len(boundary_shapes), "internal": [], "external": [], "issues": issues}
    if not declared:
        issues.append("BOUNDARY_MEMBERSHIP_DECLARATION_INCOMPLETE")
    internal, external = membership["internal"], membership["external"]
    if not internal:
        issues.append("BOUNDARY_INTERNAL_LIST_EMPTY")
    if not external:
        issues.append("BOUNDARY_EXTERNAL_LIST_EMPTY")
    for names in (internal, external):
        seen: set[str] = set()
        for name in names:
            if name in seen:
                issues.append(f"BOUNDARY_MEMBERSHIP_DUPLICATE name={name}")
            seen.add(name)
    external_names = set(external)
    for name in internal:
        if name in external_names:
            issues.append(f"BOUNDARY_MEMBERSHIP_CONFLICT name={name}")
    if len(boundary_shapes) != 1:
        issues.append(f"BOUNDARY_COUNT expected=1 actual={len(boundary_shapes)}")
        return {"declared": True, "boundaryCount": len(boundary_shapes), "internal": internal, "external": external, "issues": issues}
    boundary = boundary_shapes[0].rect
    if boundary.w <= 0 or boundary.h <= 0:
        issues.append("BOUNDARY_GEOMETRY_INVALID")
        return {"declared": True, "boundaryCount": 1, "internal": internal, "external": external, "issues": issues}
    nodes = [shape for shape in parsed.shapes if shape.attributes.get("data-node-id")]
    node_names = {shape.attributes["data-node-id"] for shape in nodes}
    expected = set(internal + external)
    for name in sorted(expected - node_names):
        issues.append(f"BOUNDARY_NODE_MISSING name={name}")
    for node in nodes:
        name = node.attributes["data-node-id"]
        rect = node.rect
        if rect.w <= 0 or rect.h <= 0:
            issues.append(f"BOUNDARY_NODE_GEOMETRY_INVALID name={name}")
        elif name not in expected:
            issues.append(f"BOUNDARY_NODE_UNDECLARED name={name}")
        else:
            inside = rect.x >= boundary.x and rect.y >= boundary.y and rect.right <= boundary.right and rect.bottom <= boundary.bottom
            outside = rect.right <= boundary.x or rect.x >= boundary.right or rect.bottom <= boundary.y or rect.y >= boundary.bottom
            if name in internal and not inside:
                issues.append(f"BOUNDARY_NODE_NOT_INTERNAL name={name}")
            if name in external_names and not outside:
                issues.append(f"BOUNDARY_NODE_NOT_EXTERNAL name={name}")
    return {"declared": True, "boundaryCount": 1, "internal": internal, "external": external, "issues": issues}


def check_brief(source: str, brief: str) -> BriefReport:
    """Compare visible labels and declared edge endpoints with an authored brief."""
    contract = parse_brief(brief)
    parsed = parse_svg(source)
    texts = {text.label for text in parsed.texts}
    allowed = set(contract["allowedEnglishTerms"])
    mismatches = []
    if contract["language"] == "ko":
        for text in texts:
            unapproved = [term for term in re.findall(r"[A-Za-z][A-Za-z0-9]*(?:[.+/#-][A-Za-z0-9]+)*", text) if term.lower() not in allowed]
            if unapproved:
                mismatches.append(f"{text}: {' | '.join(unapproved)}")
    missing_nodes = [name for name in contract["nodes"] if name not in texts]
    missing_labels = [edge["label"] for edge in contract["edges"] if edge["label"] not in texts]
    missing_edges = [
        f"{edge['from_']}->{edge['to']}:{edge['label']}"
        for edge in contract["edges"]
        if not any(route.from_id == edge["from_"] and route.to_id == edge["to"] and route.label == edge["label"] for route in parsed.routes)
    ]
    unpaired = [
        edge["label"]
        for edge in contract["edges"]
        if not any(text.edge_for == f"{edge['from_']}|{edge['to']}" and text.label == edge["label"] for text in parsed.texts)
    ]
    return {
        "language": contract["language"],
        "nodes": len(contract["nodes"]),
        "relationships": len(contract["edges"]),
        "missingNodes": missing_nodes,
        "missingLabels": missing_labels,
        "missingEdges": missing_edges,
        "unpairedLabels": unpaired,
        "languageMismatches": mismatches,
        "boundaryMembership": _boundary_membership(parsed, contract["boundaryMembership"]),
    }
