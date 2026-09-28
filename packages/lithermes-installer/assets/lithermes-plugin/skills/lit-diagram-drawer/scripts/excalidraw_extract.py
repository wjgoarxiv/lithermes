#!/usr/bin/env python3
"""Bounded stdlib-only Excalidraw extraction; labels are inert, never executed."""

# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 excalidraw_extract.py board.excalidraw

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from excalidraw_support import (
    ImportFailure, JsonObject, JsonValue, MAX_DEPTH, URL_RE, check_json_depth,
    clean_label, finite_geometry, reject, safe_id,
)
from pathlib import Path
from typing import Final

MAX_INPUT: Final = 16 * 1024 * 1024
MAX_ELEMENTS: Final = 10_000
MAX_NODES: Final = 2_000
MAX_RELATIONSHIPS: Final = 5_000
NODE_SHAPES: Final = {"rectangle": "rectangle", "ellipse": "ellipse", "diamond": "diamond", "image": "image", "embeddable": "embed", "iframe": "embed"}
EDGE_TYPES: Final = {"arrow", "line"}
CONTAINER_TYPES: Final = {"frame", "magicframe"}














def extract(path: Path) -> JsonObject:
    """Parse one saved scene into the shared canonical import schema."""
    suffix = path.name.casefold()
    if not (suffix.endswith(".excalidraw") or suffix.endswith(".excalidraw.json")): reject("unsupported form; provide a saved .excalidraw scene")
    try:
        with path.open("rb") as source:
            data = source.read(MAX_INPUT + 1)
    except OSError as error:
        reject(f"cannot read input: {error.strerror or 'I/O error'}")
    if len(data) > MAX_INPUT: reject("input exceeds the 16 MiB limit")
    try:
        text = data.decode("utf-8", "strict")
    except UnicodeDecodeError:
        reject("scene is not valid UTF-8 JSON")
    check_json_depth(text)
    try:
        document = json.loads(text, parse_constant=lambda token: reject(f"non-finite JSON number {token} is unsupported"))
    except (json.JSONDecodeError, RecursionError):
        reject("scene is malformed JSON")
    if not isinstance(document, dict) or document.get("type") != "excalidraw": reject("input is not an Excalidraw scene")
    elements = document.get("elements")
    if not isinstance(elements, list): reject("scene has no elements array")
    if len(elements) > MAX_ELEMENTS: reject("element limit exceeded (max 10,000)")

    live: list[dict[str, JsonValue]] = []
    used: set[str] = set()
    id_map: dict[str, str] = {}
    discarded: dict[str, JsonValue] = {
        "styles": 0, "links": 0, "urls": 0, "scripts": 0,
        "assets": 0, "unsupportedElements": 0, "deletedElements": 0,
        "freehandStrokes": 0, "danglingRelationships": 0,
    }
    for item in elements:
        if not isinstance(item, dict): reject("scene element must be an object")
        source_id, element_type = item.get("id"), item.get("type")
        if not isinstance(source_id, str) or not isinstance(element_type, str): reject("scene elements require string id and type fields")
        if source_id in id_map: reject("scene contains duplicate element ids")
        id_map[source_id] = safe_id(source_id, used)
        finite_geometry(item)
        if item.get("isDeleted") is True:
            discarded["deletedElements"] = int(discarded["deletedElements"]) + 1
            continue
        live.append(item)
    frame_ids = {element["id"] for element in live if element.get("type") in CONTAINER_TYPES and isinstance(element.get("id"), str)}

    labels: dict[str, list[str]] = {}
    for element in live:
        if element.get("type") != "text":
            continue
        container = element.get("containerId")
        raw_text = element.get("text", "")
        if not isinstance(raw_text, str):
            reject("text element content must be a string")
        label, count = clean_label(raw_text)
        discarded["urls"] = int(discarded["urls"]) + count
        if isinstance(container, str) and container in id_map and label:
            labels.setdefault(container, []).append(label)

    nodes: list[JsonObject] = []
    node_source_ids: set[str] = set()
    for element in live:
        source_id = element["id"]
        element_type = element["type"]
        if not isinstance(source_id, str) or not isinstance(element_type, str):
            reject("scene element id and type must be strings")
        if element_type in EDGE_TYPES or element_type == "text" and isinstance(element.get("containerId"), str):
            continue
        if element_type in {"selection", "laser"}:
            continue
        if element_type == "freedraw":
            discarded["freehandStrokes"] = int(discarded["freehandStrokes"]) + 1
            continue
        if element_type in CONTAINER_TYPES:
            shape, kind = "container", "container"
            label = element.get("name", "")
            if not isinstance(label, str):
                label = ""
        elif element_type == "text":
            shape, kind = "text", "annotation"
            label = element.get("text", "")
            if not isinstance(label, str):
                label = ""
        elif element_type in NODE_SHAPES:
            shape, kind = NODE_SHAPES[element_type], "component"
            label = ""
            if element_type in {"image", "embeddable", "iframe"}:
                discarded["assets"] = int(discarded["assets"]) + 1
        else:
            discarded["unsupportedElements"] = int(discarded["unsupportedElements"]) + 1
            continue
        label, count = clean_label(label)
        discarded["urls"] = int(discarded["urls"]) + count
        bound = labels.get(source_id, [])
        if bound:
            label = "\n".join(bound)[:2_000]
        link = element.get("link")
        if isinstance(link, str) and link:
            discarded["links"] = int(discarded["links"]) + 1
            discarded["urls"] = int(discarded["urls"]) + bool(URL_RE.search(link))
        if len(nodes) >= MAX_NODES:
            reject("node limit exceeded (max 2,000)")
        node: JsonObject = {"id": id_map[source_id], "label": label, "kind": kind, "shape": shape}
        parent = element.get("frameId")
        if isinstance(parent, str) and parent in frame_ids:
            node["parentId"] = id_map[parent]
        nodes.append(node)
        node_source_ids.add(source_id)

    relationships: list[JsonObject] = []
    for element in live:
        if element.get("type") not in EDGE_TYPES:
            continue
        source_id = element.get("id")
        if not isinstance(source_id, str):
            continue
        start = element.get("startBinding")
        end = element.get("endBinding")
        start_id = start.get("elementId") if isinstance(start, dict) else None
        end_id = end.get("elementId") if isinstance(end, dict) else None
        if not isinstance(start_id, str) or not isinstance(end_id, str) or start_id not in node_source_ids or end_id not in node_source_ids:
            discarded["danglingRelationships"] = int(discarded["danglingRelationships"]) + 1
            continue
        raw_label = "\n".join(labels.get(source_id, []))
        label, count = clean_label(raw_label)
        discarded["urls"] = int(discarded["urls"]) + count
        start_head = element.get("startArrowhead")
        end_head = element.get("endArrowhead")
        has_start = isinstance(start_head, str) and start_head not in {"", "none"}
        has_end = isinstance(end_head, str) and end_head not in {"", "none"}
        direction = "both" if has_start and has_end else "reverse" if has_start else "forward" if has_end or element.get("type") == "arrow" else "none"
        relationships.append({"from": id_map[start_id], "to": id_map[end_id], "label": label, "kind": "flow" if element.get("type") == "arrow" else "association", "direction": direction})
    if len(relationships) > MAX_RELATIONSHIPS:
        reject("relationship limit exceeded (max 5,000)")

    groups: list[JsonObject] = []
    for frame_id in sorted(frame_ids):
        members = [element.get("id") for element in live if element.get("frameId") == frame_id and isinstance(element.get("id"), str) and element.get("id") in node_source_ids]
        if members:
            label = next((str(node["label"]) for node in nodes if node["id"] == id_map[frame_id]), "Frame")
            groups.append({"id": id_map[frame_id], "label": label, "nodeIds": [id_map[item] for item in members]})
    source_groups: dict[str, list[str]] = {}
    for element in live:
        element_id = element.get("id")
        group_ids = element.get("groupIds")
        if isinstance(element_id, str) and element_id in node_source_ids and isinstance(group_ids, list):
            for group_id in group_ids[:64]:
                if isinstance(group_id, str):
                    if group_id not in source_groups and len(source_groups) >= MAX_NODES: reject("group limit exceeded (max 2,000)")
                    source_groups.setdefault(group_id, []).append(element_id)
    for group_id, members in source_groups.items():
        group_safe_id = f"g-{hashlib.sha256(group_id.encode()).hexdigest()[:16]}"
        if group_safe_id in used: reject("group id collides with an element id")
        used.add(group_safe_id)
        groups.append({"id": group_safe_id, "label": "Group", "nodeIds": [id_map[item] for item in members]})

    if not nodes:
        reject("scene contains no supported diagram elements")
    discarded["styles"] = sum(1 for element in live if any(key in element for key in ("backgroundColor", "strokeColor", "strokeStyle", "roughness")))
    files = document.get("files")
    if isinstance(files, dict):
        discarded["assets"] = int(discarded["assets"]) + len(files)
    suggested = "flowchart" if relationships else "architecture"
    return {
        "schemaVersion": 1, "sourceFormat": "excalidraw",
        "sourceDigest": hashlib.sha256(data).hexdigest(),
        "title": path.name.removesuffix(".excalidraw.json").removesuffix(".excalidraw") or "Imported diagram",
        "suggestedType": suggested,
        "nodes": nodes, "relationships": relationships, "groups": groups,
        "discarded": discarded,
        "warnings": ["Source coordinates and styling are omitted; label text is inert data."],
    }


def main() -> int:
    """Run the standalone JSON extractor."""
    parser = argparse.ArgumentParser(description="Extract inert diagram meaning from Excalidraw JSON.")
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    try:
        result = extract(args.file)
    except ImportFailure as error:
        print(f"excalidraw_extract: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
