"""Command-line boundaries for the bundled deterministic diagram checks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from diagram_checks import check_brief, check_visible_text, verify_corpus, verify_diagram, verify_motion, verify_type
from diagram_metrics import source_metrics


def _read_source(path: str) -> str:
    return Path(path).expanduser().read_text(encoding="utf-8")


def _emit_issues(label: str, issues: list[str]) -> int:
    print(json.dumps({"result": label, "issues": issues}, ensure_ascii=False, indent=2))
    return 1 if issues else 0


def verify_diagram_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify SVG geometry, accessibility, and visible text.")
    parser.add_argument("source", help="diagram HTML or SVG")
    parser.add_argument("--canvas", action="store_true", help="enforce title, font, and content-fill floors")
    args = parser.parse_args(argv)
    try:
        report = verify_diagram(_read_source(args.source), args.source, enforce_canvas=args.canvas)
    except OSError as error:
        print(f"VERIFY_DIAGRAM_READ_ERROR {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["issues"] else 0


def verify_type_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify catalog identity and type-specific requirements.")
    parser.add_argument("--type", required=True, help="catalog type ID")
    parser.add_argument("source", help="diagram HTML or SVG")
    args = parser.parse_args(argv)
    try:
        return _emit_issues("TYPE", verify_type(_read_source(args.source), args.type))
    except OSError as error:
        print(f"VERIFY_TYPE_READ_ERROR {error}", file=sys.stderr)
        return 2


def verify_brief_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check diagram content and trust-boundary membership against a brief.")
    parser.add_argument("--brief", required=True, help="Markdown diagram brief")
    parser.add_argument("source", help="diagram HTML or SVG")
    args = parser.parse_args(argv)
    try:
        report = check_brief(_read_source(args.source), _read_source(args.brief))
    except OSError as error:
        print(f"VERIFY_BRIEF_READ_ERROR {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    issues = [*report["missingNodes"], *report["missingLabels"], *report["missingEdges"], *report["unpairedLabels"], *report["languageMismatches"], *report["boundaryMembership"]["issues"]]
    return 1 if issues else 0


def verify_motion_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check SVG and CSS motion for bounded reduced-motion behavior.")
    parser.add_argument("source", help="diagram HTML or SVG")
    args = parser.parse_args(argv)
    try:
        return _emit_issues("MOTION", verify_motion(_read_source(args.source)))
    except OSError as error:
        print(f"VERIFY_MOTION_READ_ERROR {error}", file=sys.stderr)
        return 2


def check_visible_text_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the product-local LitHumanizer detector on text or diagram HTML.")
    parser.add_argument("source", help="text, diagram HTML, or SVG")
    args = parser.parse_args(argv)
    try:
        source = _read_source(args.source)
    except OSError as error:
        print(f"CHECK_TEXT_READ_ERROR {error}", file=sys.stderr)
        return 2
    text = source_metrics(source, args.source)["visibleText"] if "<svg" in source.lower() else source
    report = check_visible_text(text)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if report["summary"]["block"] else 1 if report["summary"]["warn"] else 0


def verify_corpus_main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Verify all 183 catalog templates and eight after-examples.").parse_args(argv)
    report = verify_corpus()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["issues"] else 0
