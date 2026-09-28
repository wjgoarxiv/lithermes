"""Hermes-local verifier API backed by Python stdlib and LitHumanizer."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import TypedDict

_PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

import humanizer_detector
from diagram_brief import BriefReport, check_brief
from diagram_catalog import CatalogAudit, DiagramCatalog, audit_catalog, verify_motion, verify_type
from diagram_metrics import DiagramMetrics, source_metrics
from diagram_quality import quality_issues


class HumanizerFinding(TypedDict):
    file: str
    rule: str
    severity: str
    line: int
    line_end: int
    match: str
    excerpt: str


class HumanizerSummary(TypedDict):
    block: int
    warn: int


class VisibleTextReport(TypedDict):
    findings: list[HumanizerFinding]
    summary: HumanizerSummary


class DiagramReport(TypedDict):
    issues: list[str]
    metrics: DiagramMetrics
    visibleText: VisibleTextReport


class CorpusReport(TypedDict):
    issues: list[str]
    templatesChecked: int
    examplesChecked: int


def check_visible_text(text: str) -> VisibleTextReport:
    """Run the installed plugin's exact LitHumanizer rules on diagram text."""
    raw = humanizer_detector.scan_text(text, rules=humanizer_detector.load_rules(), file="<stdin>")
    findings: list[HumanizerFinding] = [
        {
            "file": str(item["file"]),
            "rule": str(item["rule"]),
            "severity": str(item["severity"]),
            "line": int(item["line"]),
            "line_end": int(item["line_end"]),
            "match": str(item["match"]),
            "excerpt": str(item["excerpt"]),
        }
        for item in raw
    ]
    return {
        "findings": findings,
        "summary": {
            "block": sum(item["severity"] == "block" for item in findings),
            "warn": sum(item["severity"] == "warn" for item in findings),
        },
    }


def verify_diagram(source: str, source_path: str = "<stdin>", *, enforce_canvas: bool = False) -> DiagramReport:
    """Run geometry, accessibility, and direct LitHumanizer checks for one source."""
    metrics = source_metrics(source, source_path)
    visible = check_visible_text(metrics["visibleText"])
    issues = quality_issues(source, enforce_canvas=enforce_canvas)
    blocks = [item for item in visible["findings"] if item["severity"] == "block"]
    issues.extend(f"VISIBLE_TEXT_BLOCK {item['rule']} line={item['line']}" for item in blocks)
    return {"issues": list(dict.fromkeys(issues)), "metrics": metrics, "visibleText": visible}


def verify_corpus() -> CorpusReport:
    """Check every catalog template and every approved after-example in the payload."""
    catalog: DiagramCatalog = json.loads((Path(__file__).resolve().parents[1] / "references" / "type-catalog.json").read_text(encoding="utf-8"))
    audit: CatalogAudit = audit_catalog(catalog)
    issues = list(audit["issues"])
    if len(catalog["entries"]) != 61:
        issues.append(f"CATALOG_COUNT expected=61 actual={len(catalog['entries'])}")
    skill_root = Path(__file__).resolve().parents[1]
    template_count = 0
    for entry in catalog["entries"]:
        for variant in ("light", "dark", "full"):
            path = skill_root / "assets" / "examples" / f"type-{entry['id']}-{variant}.html"
            if not path.is_file():
                continue
            template_count += 1
            source = path.read_text(encoding="utf-8")
            report = verify_diagram(source, str(path))
            issues.extend(f"{path.name}: {issue}" for issue in report["issues"])
            issues.extend(f"{path.name}: {issue}" for issue in verify_type(source, entry["id"]))
            issues.extend(f"{path.name}: {issue}" for issue in verify_motion(source))
    if template_count != 183:
        issues.append(f"TEMPLATE_COUNT expected=183 actual={template_count}")
    examples = sorted((skill_root / "examples").glob("*/after.html"))
    for path in examples:
        source = path.read_text(encoding="utf-8")
        report = verify_diagram(source, str(path), enforce_canvas=True)
        issues.extend(f"{path.parent.name}: {issue}" for issue in report["issues"])
        issues.extend(f"{path.parent.name}: {issue}" for issue in verify_motion(source))
        brief_path = path.with_name("brief.md")
        if brief_path.is_file():
            brief = check_brief(source, brief_path.read_text(encoding="utf-8"))
            for key in ("missingNodes", "missingLabels", "missingEdges", "unpairedLabels", "languageMismatches"):
                issues.extend(f"{path.parent.name}: BRIEF_{key.upper()} {value}" for value in brief[key])
            issues.extend(f"{path.parent.name}: {issue}" for issue in brief["boundaryMembership"]["issues"])
    if len(examples) != 8:
        issues.append(f"EXAMPLE_COUNT expected=8 actual={len(examples)}")
    return {"issues": list(dict.fromkeys(issues)), "templatesChecked": template_count, "examplesChecked": len(examples)}
