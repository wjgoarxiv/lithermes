#!/usr/bin/env python3
"""Hermes-native entrypoint for the bundled, dependency-free text detector."""

from pathlib import Path
import sys

sys.dont_write_bytecode = True

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from humanizer_detector import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
