#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/check-visible-text.py <text.txt|diagram.html|diagram.svg>

from diagram_cli import check_visible_text_main

if __name__ == "__main__":
    raise SystemExit(check_visible_text_main())
