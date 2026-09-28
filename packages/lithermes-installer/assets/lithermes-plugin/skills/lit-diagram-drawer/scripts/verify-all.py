#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
# ─── How to run ───
# python scripts/verify-all.py

from diagram_cli import verify_corpus_main

if __name__ == "__main__":
    raise SystemExit(verify_corpus_main())
