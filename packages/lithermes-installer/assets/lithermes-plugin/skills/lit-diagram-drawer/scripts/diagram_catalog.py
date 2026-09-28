"""Catalog closure, type identity, and reduced-motion checks."""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import TypedDict

from diagram_geometry import parse_svg
from diagram_metrics import source_metrics
from diagram_sequence import sequence_issues

SKILL_ROOT = Path(__file__).resolve().parents[1]


class CatalogEntry(TypedDict):
    id: str
    reference: str
    variants: list[str]
    family: str


class DiagramCatalog(TypedDict):
    entries: list[CatalogEntry]


class CatalogAudit(TypedDict):
    issues: list[str]
    entries: int
    templates: int


def audit_catalog(catalog: DiagramCatalog) -> CatalogAudit:
    """Check reference and template closure and reject duplicate or missing types."""
    issues: list[str] = []
    expected_templates: set[str] = set()
    seen: set[str] = set()
    entries = catalog["entries"]
    for entry in entries:
        type_id = entry["id"]
        if type_id in seen:
            issues.append(f"DUPLICATE_ID {type_id}")
        seen.add(type_id)
        reference = SKILL_ROOT / "references" / entry["reference"]
        if not reference.is_file():
            issues.append(f"TYPE_GUIDE_MISSING {type_id} {entry['reference']}")
        for variant in ("light", "dark", "full"):
            if variant not in entry["variants"]:
                issues.append(f"VARIANT_MISSING {type_id} {variant}")
            template = f"assets/examples/type-{type_id}-{variant}.html"
            expected_templates.add(template)
            if not (SKILL_ROOT / template).is_file():
                issues.append(f"TEMPLATE_MISSING {template}")
    actual_templates = {
        path.relative_to(SKILL_ROOT).as_posix()
        for path in (SKILL_ROOT / "assets" / "examples").glob("type-*.html")
    }
    for orphan in sorted(actual_templates - expected_templates):
        issues.append(f"TEMPLATE_ORPHAN {orphan}")
    if not (SKILL_ROOT / "assets" / "fonts" / "OFL.txt").is_file():
        issues.append("PRETENDARD_OFL_MISSING")
    if not (SKILL_ROOT / "assets" / "fonts" / "PretendardVariable.woff2").is_file():
        issues.append("PRETENDARD_FONT_MISSING")
    if not (SKILL_ROOT / "assets" / "icons.html").is_file():
        issues.append("ICON_SHEET_MISSING")
    return {"issues": issues, "entries": len(entries), "templates": len(actual_templates)}


def _catalog_entry(type_id: str) -> CatalogEntry | None:
    catalog_path = SKILL_ROOT / "references" / "type-catalog.json"
    catalog: DiagramCatalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    return next((entry for entry in catalog["entries"] if entry["id"] == type_id), None)


def verify_type(source: str, type_id: str) -> list[str]:
    """Check type ID, template variant, family minimums, and declared semantics."""
    entry = _catalog_entry(type_id)
    if entry is None:
        return [f"TYPE_UNKNOWN {type_id}"]
    parsed = parse_svg(source)
    metrics = source_metrics(source)
    issues: list[str] = []
    type_markers = (f'data-type="{type_id}"', f"id=\"diagram-{type_id}-")
    if not any(marker in source for marker in type_markers):
        issues.append("TYPE_ID_MISMATCH")
    if not (SKILL_ROOT / "references" / entry["reference"]).is_file():
        issues.append("TYPE_GUIDE_MISSING")
    has_variant = bool(re.search(r"data-variant\s*=\s*['\"](?:light|dark|full)['\"]", source, re.IGNORECASE))
    has_variant = has_variant or bool(re.search(r"id=['\"]diagram-[a-z0-9-]+-(?:light|dark|full)['\"]", parsed.svg, re.IGNORECASE))
    if not has_variant:
        issues.append("VARIANT_MISSING")
    if entry["family"] == "quantitative" and metrics["textCount"] < 3:
        issues.append("QUANTITATIVE_LABELS_MISSING")
    rectangle_count = len(re.findall(r"<rect\b", source, re.IGNORECASE))
    circle_count = len(re.findall(r"<circle\b", source, re.IGNORECASE))
    if type_id == "heatmap" and rectangle_count < 16:
        issues.append("HEATMAP_GRID_TOO_SMALL")
    if type_id == "treemap" and rectangle_count < 6:
        issues.append("TREEMAP_TILES_TOO_FEW")
    if type_id == "sankey" and not re.search(r"<path\b[^>]*stroke-width\s*=\s*['\"][1-9]", source, re.IGNORECASE):
        issues.append("SANKEY_RIBBON_WIDTH_MISSING")
    if type_id == "waterfall" and rectangle_count < 5:
        issues.append("WATERFALL_STEPS_TOO_FEW")
    if type_id == "beeswarm" and circle_count < 20:
        issues.append("BEESWARM_MARKS_TOO_FEW")
    if type_id == "bubble" and circle_count < 6:
        issues.append("BUBBLE_MARKS_TOO_FEW")
    if type_id in {"polar", "radar"} and not re.search(r"<polygon\b", source, re.IGNORECASE):
        issues.append(f"{type_id.upper()}_SHAPE_MISSING")
    if type_id in {"sequence", "sequence-oauth"}:
        nodes = tuple(shape for shape in parsed.shapes if shape.attributes.get("data-node-id"))
        issues.extend(f"SEQUENCE {issue}" for issue in sequence_issues(source, parsed, nodes))
    semantic_terms = {
        "policy-trace-animated": ("rule", "policy", "allow", "deny"),
        "queue-animated": ("queue", "buffer", "drain", "fan-in"),
        "paved-road-animated": ("boundary", "guardrail", "secure", "policy"),
    }.get(type_id, ())
    if semantic_terms and not re.search(r"\b(?:" + "|".join(semantic_terms) + r")\b", source, re.IGNORECASE):
        issues.append(type_id.upper().replace("-", "_") + "_SEMANTIC_MISSING")
    return issues


def verify_motion(source: str) -> list[str]:
    """Require static SVG and reduced-motion safeguards for authored animation."""
    issues: list[str] = []
    if re.search(r"<(?:animate|set)\b", source, re.IGNORECASE):
        issues.append("SVG_ANIMATION_NOT_STATIC")
    if re.search(r"animation\s*:\s*(?!none\b)[^;}]+", source, re.IGNORECASE) and not re.search(r"@media\s*\(prefers-reduced-motion\s*:\s*reduce\)[\s\S]*?animation\s*:\s*none", source, re.IGNORECASE):
        issues.append("REDUCED_MOTION_RULE_MISSING")
    if re.search(r"autoplay|infinite", source, re.IGNORECASE):
        issues.append("UNBOUNDED_MOTION")
    if re.search(r"<script\b", source, re.IGNORECASE) and not re.search(r"prefers-reduced-motion|matchMedia", source, re.IGNORECASE):
        issues.append("MOTION_CONTROLLER_REDUCED_MOTION_MISSING")
    return issues
