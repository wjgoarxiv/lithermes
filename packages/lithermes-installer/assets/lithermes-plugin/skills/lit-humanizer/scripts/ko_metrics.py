#!/usr/bin/env python3
"""Emit review-only Korean prose metrics as JSON or a compact text report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from humanizer_ko_metrics import analyze_ko_text  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("path", nargs="*")
    args = parser.parse_args()
    text = "\n\n".join(Path(name).read_text(encoding="utf-8") for name in args.path) if args.path else sys.stdin.read()
    result = analyze_ko_text(text)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("Korean prose signals (review only)")
        print(json.dumps(result["metrics"], ensure_ascii=False, indent=2))
        print("Warnings: " + (", ".join(result["warnings"]) or "none"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
