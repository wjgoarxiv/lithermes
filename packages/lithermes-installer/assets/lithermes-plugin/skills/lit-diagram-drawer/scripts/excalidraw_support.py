"""Bounded JSON and inert-label helpers for Excalidraw extraction."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Final, NoReturn, TypeAlias

JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
MAX_DEPTH: Final = 64
URL_RE: Final = re.compile(r"(?i)\b(?:https?|ftp|file|javascript|data):[^\s<>\"']+")
EXEC_RE: Final = re.compile(r"(?is)<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=")
ID_RE: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")

class ImportFailure(Exception):
    """A bounded, user-correctable import rejection."""

def reject(message: str) -> NoReturn:
    raise ImportFailure(message)

def safe_id(source_id: str, used: set[str]) -> str:
    """Keep readable ids when safe and hash all other source identifiers."""
    if not source_id: reject("scene contains an element without an id")
    candidate = source_id if ID_RE.fullmatch(source_id) else f"n-{hashlib.sha256(source_id.encode()).hexdigest()[:16]}"
    if candidate in used: reject("scene contains duplicate or colliding element ids")
    used.add(candidate)
    return candidate

def clean_label(raw: str) -> tuple[str, int]:
    """Normalize inert label text and remove URL tokens."""
    if EXEC_RE.search(raw):
        reject("executable markup or event attributes in labels are unsupported")
    urls = len(URL_RE.findall(raw))
    text = URL_RE.sub("", raw).replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(char for char in text if char in "\n\t" or ord(char) >= 32)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)[:2_000], urls

def check_json_depth(text: str) -> None:
    """Reject excessive structural nesting before the JSON decoder recurses."""
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif char == '"': quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
        if depth > MAX_DEPTH: reject("scene nesting exceeds the depth limit (64)")
        elif char in "]}":
            depth -= 1

def finite_geometry(element: dict[str, JsonValue]) -> None:
    """Validate present numeric geometry even though it is never exported."""
    for key in ("x", "y", "width", "height"):
        value = element.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)): reject(f"element geometry field {key} must be numeric")
        if abs(value) > 10_000_000 or isinstance(value, float) and not math.isfinite(value): reject(f"element geometry field {key} is outside the supported range")
