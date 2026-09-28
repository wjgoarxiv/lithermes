#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/verify-diagram.py <diagram.html|diagram.svg> [--canvas]

from diagram_cli import verify_diagram_main

if __name__ == "__main__":
    raise SystemExit(verify_diagram_main())
