"""Bounded Mermaid and Markdown source reading."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final, NoReturn

MAX_INPUT: Final = 4 * 1024 * 1024

class ImportFailure(Exception):
    """An input rejection suitable for a concise CLI diagnostic."""

def reject(message: str) -> NoReturn:
    raise ImportFailure(message)

def read_blocks(path: Path) -> tuple[bytes, list[tuple[str, int]]]:
    """Read one bounded source or fenced Mermaid blocks from Markdown."""
    try:
        with path.open("rb") as stream: data = stream.read(MAX_INPUT + 1)
    except OSError as error: reject(f"cannot read input: {error.strerror or 'I/O error'}")
    if len(data) > MAX_INPUT: reject("input exceeds the 4 MiB limit")
    try: source = data.decode("utf-8", "strict")
    except UnicodeDecodeError: reject("input is not valid UTF-8")
    if path.suffix.casefold() in {".mmd", ".mermaid"}: return data, [(source, 1)]
    if path.suffix.casefold() not in {".md", ".markdown", ".mdown", ".mkd"}: reject("provide .mmd, .mermaid, or Markdown")
    blocks: list[tuple[str, int]] = []
    active, fence, content = 0, "", []
    for number, line in enumerate(source.splitlines(), 1):
        if not active:
            found = re.match(r"^\s*(`{3,}|~{3,})\s*mermaid\s*$", line, re.I)
            if found: active, fence, content = number + 1, found.group(1), []
        elif re.match(rf"^\s*{re.escape(fence[0])}{{{len(fence)},}}\s*$", line):
            blocks.append(("\n".join(content), active))
            active, fence, content = 0, "", []
        else: content.append(line)
    if active: reject(f"unterminated Mermaid fence at line {active - 1}")
    if not blocks: reject("Markdown contains no fenced Mermaid block")
    return data, blocks
