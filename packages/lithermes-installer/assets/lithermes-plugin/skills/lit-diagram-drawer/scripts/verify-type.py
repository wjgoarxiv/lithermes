#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/verify-type.py --type=<catalog-id> <diagram.html|diagram.svg>

from diagram_cli import verify_type_main

if __name__ == "__main__":
    raise SystemExit(verify_type_main())
