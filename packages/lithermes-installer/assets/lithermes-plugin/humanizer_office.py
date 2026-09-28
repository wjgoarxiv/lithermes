"""Public plugin-root adapter for the skill's bounded Office/PDF extractor."""

from __future__ import annotations

import importlib.util
from pathlib import Path


_SCRIPT = Path(__file__).resolve().parent / "skills" / "lit-humanizer" / "scripts" / "extract_office_text.py"
_SPEC = importlib.util.spec_from_file_location("_lithermes_humanizer_office", _SCRIPT)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError("LitHumanizer Office extractor is missing")
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

extract_text = _MODULE.extract_text
extract_office_bytes = _MODULE.extract_office_bytes
extract_pdf_bytes = _MODULE.extract_pdf_bytes
