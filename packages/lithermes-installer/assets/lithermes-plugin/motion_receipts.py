"""Host-event receipts for the film director's look rounds.

``post_tool_call`` sees every completed tool call. When ``vision_analyze``
loads a stills PNG that belongs to a motion run directory (one holding
``treatment.json`` and ``stills/stills.json``), this module appends a receipt
with the file's SHA-256 to ``<run>/.run/host-events.jsonl``; when a terminal
call runs the motion CLI with an absolute ``--out`` it appends a marker. The
motion ``complete`` command then requires a receipt for every frame the last
look round lists. Nothing else is written, and a failure here never reaches
the tool call.
"""

from __future__ import annotations

import hashlib
import os
import shlex
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

try:
    from .core_runtime import append_jsonl
except (ImportError, ModuleNotFoundError):
    from core_runtime import append_jsonl

_MAX_LEVELS = 4


def _run_dir(path: Path) -> Path | None:
    for parent in list(path.parents)[:_MAX_LEVELS]:
        if (parent / "treatment.json").is_file() and (parent / "stills" / "stills.json").is_file():
            return parent
    return None


def _local_image(value: Any, workspace: Any = None) -> Path | None:
    text = str(value or "").strip()
    if not text or text.startswith(("http://", "https://", "data:")):
        return None
    if text.startswith("file://"):
        text = unquote(urlsplit(text).path)
    path = Path(os.path.expanduser(text))
    if not path.is_absolute():
        base = Path(str(workspace)) if workspace else Path.cwd()
        path = base / path
    try:
        path = path.resolve()
    except OSError:
        return None
    return path if path.is_file() and path.suffix.lower() == ".png" else None


def _append(run: Path, event: dict[str, Any]) -> None:
    append_jsonl(run / ".run" / "host-events.jsonl", event)


def observe(tool_name: str, args: Any, *, workspace: Any = None) -> None:
    """Record a motion receipt for a completed tool call, when it is one."""
    try:
        params = args if isinstance(args, dict) else {}
        if tool_name == "vision_analyze":
            image = _local_image(params.get("image_url"), workspace)
            run = _run_dir(image) if image else None
            if run:
                digest = hashlib.sha256(image.read_bytes()).hexdigest()
                _append(run, {"tool": "vision_analyze", "file": image.relative_to(run.resolve()).as_posix(), "sha256": digest})
        elif tool_name == "terminal":
            command = str(params.get("command") or "")
            if "motion.mjs" not in command:
                return
            words = shlex.split(command, posix=True)
            for index, word in enumerate(words[:-1]):
                if word == "--out":
                    out = Path(os.path.expanduser(words[index + 1]))
                    if out.is_absolute() and (out / "treatment.json").is_file():
                        _append(out, {"tool": "terminal", "motion": True})
                    break
    except Exception:  # noqa: BLE001 - an observer must never break the tool call it watches
        return
