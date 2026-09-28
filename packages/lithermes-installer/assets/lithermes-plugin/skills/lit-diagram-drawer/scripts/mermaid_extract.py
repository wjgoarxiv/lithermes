#!/usr/bin/env python3
"""Bounded stdlib-only Mermaid extraction; labels are inert and never executed."""

# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python3 mermaid_extract.py input.mmd [--diagram 0]

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from mermaid_source import ImportFailure, read_blocks, reject
from pathlib import Path
from typing import Final, TypeAlias

JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
MAX_NODES: Final = 2_000
MAX_EDGES: Final = 5_000
MAX_DEPTH: Final = 64
URL_RE: Final = re.compile(r"(?i)\b(?:https?|ftp|file|javascript|data):[^\s<>\"']+")
EXEC_RE: Final = re.compile(r"(?is)<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=")
ID_RE: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
HEADER_RE: Final = re.compile(r"(?i)^(flowchart|graph|sequenceDiagram|stateDiagram-v2|erDiagram)\b(.*)$")
KINDS: Final = {"flowchart": "flowchart", "graph": "flowchart", "sequencediagram": "sequence", "statediagram-v2": "state", "erdiagram": "er"}

def safe_id(raw: str, used: set[str]) -> str:
    """Return a stable, bounded output identifier."""
    if not raw: reject("diagram contains an empty element id")
    safe = raw if ID_RE.fullmatch(raw) else f"n-{hashlib.sha256(raw.encode()).hexdigest()[:16]}"
    if safe in used: reject("diagram contains duplicate or colliding ids")
    used.add(safe)
    return safe

def label(raw: str) -> tuple[str, int]:
    """Normalize visible text without executing markup or retaining URLs."""
    if EXEC_RE.search(raw): reject("executable markup or event attributes in labels are unsupported")
    urls = len(URL_RE.findall(raw))
    raw = URL_RE.sub("", raw).replace("<br/>", "\n").replace("<br>", "\n")
    raw = re.sub(r"<[^>]*>", "", raw)
    raw = html.unescape(raw).replace("\xa0", " ")
    raw = re.sub(r"\*\*(.*?)\*\*|__(.*?)__", lambda m: m.group(1) or m.group(2), raw)
    return "\n".join(re.sub(r"[ \t]+", " ", s).strip() for s in raw.splitlines() if s.strip())[:2_000], urls

def extract(path: Path, index: int) -> JsonObject:
    """Parse one supported Mermaid block into the shared import schema."""
    data, blocks = read_blocks(path)
    if index < 0 or index >= len(blocks): reject(f"diagram index out of range ({len(blocks)} block(s))")
    source, first_line = blocks[index]
    lines = source.splitlines()
    if lines and lines[0].strip() == "---":
        try: end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
        except StopIteration: reject("unterminated Mermaid frontmatter")
        lines = lines[end + 1:]
        first_line += end + 1
    lines = [(first_line + i, line.strip()) for i, line in enumerate(lines) if line.strip() and not line.strip().startswith("%%")]
    header = next(((i, text, number) for i, (number, text) in enumerate(lines) if HEADER_RE.match(text)), None)
    if header is None: reject("unsupported or missing Mermaid diagram declaration")
    header_i, header_text, header_line = header
    match = HEADER_RE.match(header_text)
    if match is None: reject(f"malformed diagram declaration at line {header_line}")
    raw_kind = match.group(1).casefold()
    if raw_kind not in KINDS: reject(f"unsupported Mermaid grammar at line {header_line}")
    grammar = KINDS[raw_kind]
    direction = re.search(r"\b(TD|TB|BT|LR|RL)\b", match.group(2), re.I)
    direction_hint = direction.group(1).upper() if direction else ""
    nodes: dict[str, tuple[str, str, str, str | None]] = {}
    groups: dict[str, str] = {}
    relations: list[tuple[str, str, str, str, str]] = []
    stack: list[str] = []
    fields: dict[str, list[str]] = {}
    entity: str | None = None
    title = ""
    discarded: dict[str, JsonValue] = {"styles": 0, "links": 0, "urls": 0, "scripts": 0, "directives": 0, "unsupportedElements": 0}

    def add(raw_id: str, text: str = "", shape: str = "rectangle", kind: str = "component") -> None:
        if raw_id not in nodes:
            if len(nodes) >= MAX_NODES: reject("node limit exceeded (max 2,000)")
            nodes[raw_id] = (text or raw_id, shape, kind, stack[-1] if stack else None)
        elif text and nodes[raw_id][0] == raw_id:
            nodes[raw_id] = (text, shape, nodes[raw_id][2], nodes[raw_id][3])

    def connect(a: str, b: str, caption: str, kind: str, arrow: str) -> None:
        if len(relations) >= MAX_EDGES: reject("relationship limit exceeded (max 5,000)")
        relations.append((a, b, caption, kind, arrow))

    for number, text in lines[header_i + 1:]:
        if text.startswith("%%{"):
            discarded["directives"] = int(discarded["directives"]) + 1
            continue
        if re.match(r"(?i)^(click|href|link)\b", text):
            discarded["links"] = int(discarded["links"]) + 1
            continue
        if re.match(r"(?i)^(style|classDef|class|linkStyle)\b", text):
            discarded["styles"] = int(discarded["styles"]) + 1
            continue
        if text.startswith("title "):
            title, count = label(text[6:])
            discarded["urls"] = int(discarded["urls"]) + count
            continue
        if text.casefold().startswith("direction "):
            direction_hint = text.split(None, 1)[1].upper()
            if direction_hint not in {"TD", "TB", "BT", "LR", "RL"}: reject(f"invalid direction at line {number}")
            continue
        if grammar == "flowchart":
            if text.casefold() == "end":
                if not stack: reject(f"unexpected subgraph end at line {number}")
                stack.pop()
                continue
            sub = re.match(r"(?i)^subgraph\s+([\w.-]+)(?:\s*\[([^]]*)\])?$", text)
            if sub:
                gid = sub.group(1)
                groups[gid], count = label(sub.group(2) or gid)
                discarded["urls"] = int(discarded["urls"]) + count
                add(gid, groups[gid], "container", "container")
                stack.append(gid)
                if len(stack) > MAX_DEPTH: reject("subgraph depth exceeds 64")
                continue
            edge = re.match(r"^([\w.-]+)(?:\[([^]]*)\]|\{([^}]*)\}|\(([^)]*)\))?\s*(<-->|<--|-->|---|-.->|==>|->|--o|--x)\s*(?:\|([^|]*)\|\s*)?([\w.-]+)(?:\[([^]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$", text)
            if edge:
                a, al, ad, ae, arrow, et, b, bl, bd, be = edge.groups()
                left, c1 = label(al or ad or ae or a)
                right, c2 = label(bl or bd or be or b)
                caption, c3 = label(et or "")
                discarded["urls"] = int(discarded["urls"]) + c1 + c2 + c3
                add(a, left, "diamond" if ad else "ellipse" if ae else "rectangle")
                add(b, right, "diamond" if bd else "ellipse" if be else "rectangle")
                connect(a, b, caption, "flow", "both" if arrow == "<-->" else "reverse" if arrow == "<--" else "none" if arrow == "---" else "forward")
                continue
            node = re.match(r"^([\w.-]+)(?:\[([^]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$", text)
            if node:
                nid, rect, diamond, ellipse = node.groups()
                visible, count = label(rect or diamond or ellipse or nid)
                discarded["urls"] = int(discarded["urls"]) + count
                add(nid, visible, "diamond" if diamond else "ellipse" if ellipse else "rectangle")
                continue
            reject(f"unsupported flowchart syntax at line {number}")
        if grammar == "sequence":
            participant = re.match(r'(?i)^(?:participant|actor)\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)(?:\s+as\s+(?:"([^"]+)"|([\w.-]+)))?$', text)
            if participant:
                quoted, pid, quoted_alias, alias = participant.groups()
                name, count = label(quoted_alias or alias or quoted or pid)
                discarded["urls"] = int(discarded["urls"]) + count
                add(pid, name, "rectangle", "participant")
                continue
            message = re.match(r"^([\w.-]+)\s*(<<->>|<-->|->>|-->>|->|-->|-x|--x)(?:[+-])?\s*([\w.-]+)(?:\s*:\s*(.*))?$", text)
            if message:
                a, arrow, b, raw_label = message.groups()
                caption, count = label(raw_label or "")
                discarded["urls"] = int(discarded["urls"]) + count
                add(a, kind="participant")
                add(b, kind="participant")
                connect(a, b, caption, "message", "both" if "<<" in arrow or arrow == "<-->" else "forward")
                continue
            reject(f"unsupported sequence syntax at line {number}")
        if grammar == "state":
            alias = re.match(r'^state\s+"([^"]+)"\s+as\s+([\w.-]+)$', text, re.I)
            if alias:
                name, count = label(alias.group(1))
                discarded["urls"] = int(discarded["urls"]) + count
                add(alias.group(2), name, "ellipse", "state")
                continue
            transition = re.match(r"^(\[\s*\*\s*\]|[\w.-]+)\s*(-->|-[.])\s*(\[\s*\*\s*\]|[\w.-]+)(?:\s*:\s*(.*))?$", text)
            if transition:
                a, _, b, raw_label = transition.groups()
                a, b = ("initial" if "*" in a else a), ("final" if "*" in b else b)
                caption, count = label(raw_label or "")
                discarded["urls"] = int(discarded["urls"]) + count
                add(a, "Initial" if a == "initial" else a, "ellipse", "state")
                add(b, "Final" if b == "final" else b, "ellipse", "state")
                connect(a, b, caption, "transition", "forward")
                continue
            if re.fullmatch(r"[\w.-]+", text):
                add(text, text, "ellipse", "state")
                continue
            reject(f"unsupported state syntax at line {number}")
        if grammar == "er":
            if text == "}":
                entity = None
                continue
            declaration = re.match(r"^([\w.-]+)\s*\{$", text)
            if declaration:
                entity = declaration.group(1)
                fields.setdefault(entity, [])
                add(entity, entity, "rectangle", "entity")
                continue
            relation = re.match(r"^([\w.-]+)\s+([|}o{.]+--[|}o{.]+)\s+([\w.-]+)(?:\s*:\s*(.*))?$", text)
            if relation:
                a, cardinality, b, raw_label = relation.groups()
                caption, count = label(raw_label or "")
                discarded["urls"] = int(discarded["urls"]) + count
                add(a, kind="entity")
                add(b, kind="entity")
                connect(a, b, f"{cardinality}: {caption}" if caption else cardinality, "association", "forward")
                continue
            if entity:
                field = re.match(r"^[\w.-]+\s+([\w.-]+)(?:\s+\w+)?$", text)
                if field:
                    fields[entity].append(field.group(1))
                    continue
            reject(f"unsupported ER syntax at line {number}")

    if stack: reject("flowchart has an unterminated subgraph")
    if entity: reject("ER diagram has an unterminated entity")
    if not nodes: reject("diagram contains no supported nodes")
    used: set[str] = set()
    ids = {raw_id: safe_id(raw_id, used) for raw_id in nodes}
    output_nodes: list[JsonObject] = []
    for raw_id, (name, shape, kind, parent) in nodes.items():
        if fields.get(raw_id): name += "\n" + "\n".join(fields[raw_id][:100])
        item: JsonObject = {"id": ids[raw_id], "label": name, "kind": kind, "shape": shape}
        if parent in ids: item["parentId"] = ids[parent]
        output_nodes.append(item)
    output_groups = [{"id": ids[gid], "label": name, "nodeIds": [ids[nid] for nid, value in nodes.items() if value[3] == gid]} for gid, name in groups.items() if any(value[3] == gid for value in nodes.values())]
    output_relations: list[JsonObject] = [{"from": ids[a], "to": ids[b], "label": caption, "kind": kind, "direction": direction} for a, b, caption, kind, direction in relations if a in ids and b in ids]
    warnings = ["Source layout and styling are omitted; labels are inert data."]
    if direction_hint: warnings.append(f"Declared direction: {direction_hint}.")
    return {"schemaVersion": 1, "sourceFormat": "mermaid", "sourceDigest": hashlib.sha256(data).hexdigest(), "title": title or path.stem or "Imported diagram", "suggestedType": "architecture" if grammar == "flowchart" and groups else grammar, "nodes": output_nodes, "relationships": output_relations, "groups": output_groups, "discarded": discarded, "warnings": warnings}

def main() -> int:
    """Run the standalone JSON extractor."""
    parser = argparse.ArgumentParser(description="Extract inert diagram meaning from Mermaid source.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--diagram", type=int, default=0, help="zero-based Markdown block (default: 0)")
    args = parser.parse_args()
    try: result = extract(args.file, args.diagram)
    except ImportFailure as error:
        print(f"mermaid_extract: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__": raise SystemExit(main())
