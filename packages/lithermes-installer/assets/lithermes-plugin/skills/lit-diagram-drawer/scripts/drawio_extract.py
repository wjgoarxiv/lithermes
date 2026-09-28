#!/usr/bin/env python3
"""Bounded stdlib-only draw.io extraction; labels are inert and never executed."""

# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 drawio_extract.py input.drawio [--page 0]

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from drawio_source import ImportFailure, MAX_DEPTH, parse_source, reject
import sys
from pathlib import Path
from typing import Final, TypeAlias

JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
MAX_NODES: Final = 2_000
MAX_EDGES: Final = 5_000
URL_RE: Final = re.compile(r"(?i)\b(?:https?|ftp|file|javascript|data):[^\s<>\"']+")
TAG_RE: Final = re.compile(r"<[^>]*>")
BREAK_RE: Final = re.compile(r"(?i)<br\s*/?>|</(?:p|div)\s*>")
EXEC_RE: Final = re.compile(r"(?is)<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=")
SAFE_ID_RE: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
SHAPE_ALIASES: Final = (("rhombus", "diamond"), ("diamond", "diamond"), ("ellipse", "ellipse"), ("actor", "ellipse"), ("cylinder", "cylinder"), ("database", "cylinder"), ("swimlane", "container"), ("text", "text"), ("group", "group"), ("table", "table"), ("hexagon", "hexagon"), ("cloud", "cloud"), ("parallelogram", "parallelogram"), ("document", "document"), ("image", "image"))






def safe_id(source_id: str, used: set[str]) -> str:
    """Map a source identifier to a stable, bounded identifier."""
    if not source_id: reject("diagram contains an element without an id")
    candidate = source_id if SAFE_ID_RE.fullmatch(source_id) else f"n-{hashlib.sha256(source_id.encode()).hexdigest()[:16]}"
    if candidate in used: reject("diagram contains duplicate element ids")
    used.add(candidate)
    return candidate


def plain_label(value: str) -> tuple[str, int]:
    """Keep plain label text while removing executable markup and URL tokens."""
    if EXEC_RE.search(value): reject("executable markup or event attributes in labels are unsupported")
    url_count = len(URL_RE.findall(value))
    text = URL_RE.sub("", value)
    text = BREAK_RE.sub("\n", text)
    text = TAG_RE.sub("", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)[:2_000], url_count












def shape_name(style: str) -> str:
    """Reduce source shape syntax to the portable shape vocabulary."""
    match = re.search(r"(?:^|;)shape=([^;]+)", style)
    raw = match.group(1).casefold() if match else "rect"
    return next((shape for token, shape in SHAPE_ALIASES if token in raw), "rectangle")




def extract(path: Path, page_index: int) -> JsonObject:
    """Return one page in the shared canonical import schema."""
    data, source_root, pages = parse_source(path)
    if page_index < 0 or page_index >= len(pages): reject(f"page index is out of range (file contains {len(pages)} page(s))")
    model = pages[page_index]
    root = next((child for child in model if child.tag.rsplit("}", 1)[-1] == "root"), None)
    if root is None: reject("mxGraphModel has no root cell list")

    records: list[dict[str, str]] = []
    for wrapper in root:
        tag = wrapper.tag.rsplit("}", 1)[-1]
        cell = wrapper if tag == "mxCell" else next((item for item in wrapper if item.tag.rsplit("}", 1)[-1] == "mxCell"), None)
        if cell is None:
            continue
        attrs = dict(wrapper.attrib)
        attrs.update(cell.attrib)
        if "value" not in attrs:
            attrs["value"] = wrapper.get("label", "")
        records.append(attrs)
    if len(records) > MAX_NODES + MAX_EDGES: reject("diagram exceeds the 7,000 cell limit")

    used: set[str] = set()
    id_map: dict[str, str] = {}
    for attrs in records:
        raw_id = attrs.get("id", "")
        if raw_id in id_map: reject("diagram contains duplicate element ids")
        id_map[raw_id] = safe_id(raw_id, used)

    vertices = [attrs for attrs in records if attrs.get("vertex") == "1"]
    edge_records = [attrs for attrs in records if attrs.get("edge") == "1"]
    if len(vertices) > MAX_NODES or len(edge_records) > MAX_EDGES: reject("diagram exceeds the node or relationship limit")

    node_ids = {attrs["id"] for attrs in vertices}
    child_ids: dict[str, list[str]] = {}
    for attrs in vertices:
        parent = attrs.get("parent", "")
        if parent in node_ids:
            child_ids.setdefault(parent, []).append(attrs["id"])

    discarded: dict[str, JsonValue] = {
        "styles": 0, "links": 0, "urls": 0,
        "assets": 0, "unsupportedElements": 0, "danglingRelationships": 0,
    }
    nodes: list[JsonObject] = []
    groups: list[JsonObject] = []
    for attrs in vertices:
        source_id = attrs["id"]
        label, url_count = plain_label(attrs.get("value", ""))
        discarded["urls"] = int(discarded["urls"]) + url_count
        style = attrs.get("style", "")
        discarded["styles"] = int(discarded["styles"]) + bool(style)
        discarded["links"] = int(discarded["links"]) + bool(attrs.get("link") or attrs.get("href"))
        discarded["assets"] = int(discarded["assets"]) + ("image=" in style.casefold() or shape_name(style) == "image")
        children = child_ids.get(source_id, [])
        source_shape = shape_name(style)
        is_group = bool(children) or source_shape in {"container", "group"}
        node: JsonObject = {
            "id": id_map[source_id], "label": label,
            "kind": "container" if is_group else "component",
            "shape": "container" if is_group else source_shape,
        }
        parent = attrs.get("parent", "")
        if parent in node_ids:
            node["parentId"] = id_map[parent]
        nodes.append(node)
        if children:
            groups.append({
                "id": id_map[source_id], "label": label or "Group",
                "nodeIds": [id_map[child] for child in children],
            })

    relationships: list[JsonObject] = []
    for attrs in edge_records:
        source = attrs.get("source", "")
        target = attrs.get("target", "")
        if source not in node_ids or target not in node_ids:
            discarded["danglingRelationships"] = int(discarded["danglingRelationships"]) + 1
            continue
        label, url_count = plain_label(attrs.get("value", ""))
        discarded["urls"] = int(discarded["urls"]) + url_count
        style = attrs.get("style", "")
        discarded["styles"] = int(discarded["styles"]) + bool(style)
        discarded["links"] = int(discarded["links"]) + bool(attrs.get("link") or attrs.get("href"))
        start_arrow = re.search(r"(?:^|;)startArrow=(?!none(?:;|$))", style) is not None
        end_arrow = re.search(r"(?:^|;)endArrow=(?!none(?:;|$))", style) is not None
        direction = "both" if start_arrow and end_arrow else "reverse" if start_arrow else "forward" if end_arrow else "none"
        relationships.append({
            "from": id_map[source], "to": id_map[target], "label": label,
            "kind": "flow" if direction != "none" else "association", "direction": direction,
        })

    parents = {attrs["id"]: attrs.get("parent", "") for attrs in vertices}
    for attrs in vertices:
        parent, depth, seen = parents[attrs["id"]], 0, {attrs["id"]}
        while parent in parents:
            if parent in seen: reject("container hierarchy contains a cycle")
            seen.add(parent)
            depth += 1
            if depth > MAX_DEPTH: reject("container hierarchy exceeds the depth limit")
            parent = parents[parent]

    page_name = next((child.get("name", "") for index, child in enumerate(item for item in source_root if item.tag.rsplit("}", 1)[-1] == "diagram") if index == page_index), "")
    suggested_type = "flowchart" if edge_records or any(node["shape"] == "diamond" for node in nodes) else "architecture"
    return {
        "schemaVersion": 1, "sourceFormat": "drawio",
        "sourceDigest": hashlib.sha256(data).hexdigest(),
        "title": plain_label(page_name or path.stem)[0] or "Imported diagram",
        "suggestedType": suggested_type,
        "nodes": nodes, "relationships": relationships, "groups": groups,
        "discarded": discarded,
        "warnings": ["Source styles and coordinates are omitted; label text is inert data."],
    }


def main() -> int:
    """Run the standalone JSON extractor."""
    parser = argparse.ArgumentParser(description="Extract inert diagram meaning from bounded draw.io XML, SVG, or PNG.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--page", type=int, default=0, help="zero-based page index (default: 0)")
    args = parser.parse_args()
    try:
        result = extract(args.file, args.page)
    except ImportFailure as error:
        print(f"drawio_extract: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
