#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/verify-brief.py --brief <brief.md> <diagram.html|diagram.svg>

from diagram_cli import verify_brief_main

if __name__ == "__main__":
    raise SystemExit(verify_brief_main())
