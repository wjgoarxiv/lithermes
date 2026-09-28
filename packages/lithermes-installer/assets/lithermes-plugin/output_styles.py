"""Output-style block injection for LitHermes.

Reads the configured output style id from ~/.hermes/config.yaml (or the path
pointed to by HERMES_HOME) and returns the corresponding style file's text for
injection into the pre_llm_call context.

Style IDs: off | asd-ste100 | asd-ste100-ko | eli5 | eli5-ko

All errors are caught and silently return '' so the hook always fails open.
"""
from __future__ import annotations

import os
from pathlib import Path

_STYLE_IDS = frozenset({"asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"})
_STYLES_DIR = Path(__file__).resolve().parent / "output-styles"


def _hermes_config_path() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    home = Path(raw).expanduser() if raw else Path.home() / ".hermes"
    return home / "config.yaml"


def _read_style_id() -> str:
    """Return the configured outputStyle value, or '' if unset/off/unavailable."""
    try:
        text = _hermes_config_path().read_text(encoding="utf-8")
    except OSError:
        return ""
    try:
        import yaml
    except (ImportError, ModuleNotFoundError):
        return ""
    try:
        config = yaml.safe_load(text)
    except Exception:
        return ""
    if not isinstance(config, dict):
        return ""
    value = config.get("outputStyle", "")
    if not isinstance(value, str):
        return ""
    return value.strip()


def output_style_block() -> str:
    """Return the output-style instruction text, or '' if off/unset/unavailable.

    Never raises: all exceptions are caught and silently return ''.
    """
    try:
        style_id = _read_style_id()
        if not style_id or style_id == "off":
            return ""
        if style_id not in _STYLE_IDS:
            return ""
        style_file = _STYLES_DIR / f"{style_id}.md"
        return style_file.read_text(encoding="utf-8")
    except Exception:
        return ""
