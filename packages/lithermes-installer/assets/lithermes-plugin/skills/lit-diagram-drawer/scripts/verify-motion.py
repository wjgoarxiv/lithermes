#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/verify-motion.py <diagram.html|diagram.svg>

from diagram_cli import verify_motion_main

if __name__ == "__main__":
    raise SystemExit(verify_motion_main())
