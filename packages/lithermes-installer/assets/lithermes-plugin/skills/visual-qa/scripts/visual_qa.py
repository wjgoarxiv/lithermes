#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT))

from uiux_runtime_common import ContractError, emit_error, emit_json, read_stdin_json, read_stdin_text

from png_runtime import compare_png, inspect_png
from tui_runtime import inspect_tui
from visual_contracts import evaluate_capabilities, evaluate_tier, validate_evidence, validate_reviews


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="LitHermes dependency-free visual QA")
    commands = root.add_subparsers(dest="command", required=True)
    evidence = commands.add_parser("validate-evidence")
    evidence.add_argument("--now", required=True)
    evidence.add_argument("--evidence-root", type=Path)
    evidence.add_argument("--json", action="store_true")
    capabilities = commands.add_parser("evaluate-capabilities")
    capabilities.add_argument("--json", action="store_true")
    png = commands.add_parser("inspect-png")
    png.add_argument("path", type=Path)
    png.add_argument("--json", action="store_true")
    compare = commands.add_parser("compare-png")
    compare.add_argument("reference", type=Path)
    compare.add_argument("actual", type=Path)
    compare.add_argument("--json", action="store_true")
    tui = commands.add_parser("check-tui")
    tui.add_argument("--cols", required=True, type=int)
    tui.add_argument("--ambiguous-width", choices=(1, 2), default=1, type=int)
    tui.add_argument("--json", action="store_true")
    reviews = commands.add_parser("validate-reviews")
    reviews.add_argument("--json", action="store_true")
    tier = commands.add_parser("evaluate-tier")
    tier.add_argument("--now", required=True)
    tier.add_argument("--json", action="store_true")
    return root


def run(arguments: list[str]) -> int:
    args = parser().parse_args(arguments)
    try:
        if args.command == "inspect-png":
            emit_json(inspect_png(args.path))
        elif args.command == "compare-png":
            emit_json(compare_png(args.reference, args.actual))
        elif args.command == "check-tui":
            emit_json(inspect_tui(
                read_stdin_text(maximum_bytes=1024 * 1024),
                columns=args.cols,
                ambiguous_width=args.ambiguous_width,
            ))
        elif args.command == "validate-evidence":
            report = validate_evidence(
                read_stdin_json(maximum_bytes=4 * 1024 * 1024),
                now=args.now,
                evidence_root=args.evidence_root,
            )
            emit_json(report)
            return 0 if report.get("evidence_eligible") is True else 1
        elif args.command == "evaluate-capabilities":
            emit_json(evaluate_capabilities(read_stdin_json(maximum_bytes=1024 * 1024)))
        elif args.command == "validate-reviews":
            emit_json(validate_reviews(read_stdin_json(maximum_bytes=1024 * 1024)))
        else:
            emit_json(evaluate_tier(read_stdin_json(maximum_bytes=4 * 1024 * 1024), now=args.now))
        return 0
    except ContractError as error:
        return emit_error(error)


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
