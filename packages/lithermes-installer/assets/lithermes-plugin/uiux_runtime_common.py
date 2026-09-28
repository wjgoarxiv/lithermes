from __future__ import annotations

import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Final, List, Tuple

JsonValue = Any
RFC3339_TIME: Final = re.compile(
    r"^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$"
)


@dataclass(frozen=True)
class ContractError(Exception):
    code: str
    detail: str

    def __str__(self) -> str:
        return f"{self.code}: {self.detail}"


def _pairs_without_duplicates(pairs: List[Tuple[str, JsonValue]]) -> Dict[str, JsonValue]:
    result: Dict[str, JsonValue] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("DUPLICATE_JSON_KEY", key)
        result[key] = value
    return result


def _reject_nonfinite(value: str) -> float:
    raise ContractError("NON_FINITE_NUMBER", value)


def parse_json_bytes(raw: bytes, *, maximum_bytes: int) -> JsonValue:
    if len(raw) > maximum_bytes:
        raise ContractError("INPUT_TOO_LARGE", f"{len(raw)} > {maximum_bytes}")
    if b"\x00" in raw:
        raise ContractError("NUL_BYTE", "JSON transport contains NUL")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContractError("INVALID_UTF8", str(error)) from error
    try:
        return json.loads(
            text,
            object_pairs_hook=_pairs_without_duplicates,
            parse_constant=_reject_nonfinite,
        )
    except ContractError:
        raise
    except json.JSONDecodeError as error:
        raise ContractError("MALFORMED_JSON", str(error)) from error


def read_stdin_json(*, maximum_bytes: int) -> JsonValue:
    return parse_json_bytes(sys.stdin.buffer.read(maximum_bytes + 1), maximum_bytes=maximum_bytes)


def read_stdin_text(*, maximum_bytes: int) -> str:
    raw = sys.stdin.buffer.read(maximum_bytes + 1)
    if len(raw) > maximum_bytes:
        raise ContractError("INPUT_TOO_LARGE", f"{len(raw)} > {maximum_bytes}")
    try:
        return raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContractError("INVALID_UTF8", str(error)) from error


def require_mapping(value: JsonValue, *, code: str) -> Dict[str, JsonValue]:
    if not isinstance(value, dict):
        raise ContractError(code, "expected JSON object")
    return value


def canonical_json(value: JsonValue) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def emit_json(value: JsonValue) -> None:
    sys.stdout.write(canonical_json(value) + "\n")


def emit_error(error: ContractError) -> int:
    # An absent capability is BLOCKED and outranks FAIL; everything else is a plain failure.
    verdict = "BLOCKED" if error.code.startswith("BLOCKED_") else "FAIL"
    emit_json({"error_code": error.code, "detail": error.detail, "verdict": verdict})
    return 2


def parse_utc(value: str) -> datetime:
    if RFC3339_TIME.fullmatch(value) is None:
        raise ContractError("INVALID_TIME", value)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError as error:
        raise ContractError("INVALID_TIME", value) from error
    if parsed.tzinfo is None:
        raise ContractError("INVALID_TIME", "timezone required")
    return parsed.astimezone(timezone.utc)


def require_string(mapping: Dict[str, JsonValue], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ContractError("SCHEMA_INVALID", f"{key} must be a non-empty string")
    return value


MAX_REVIEW_ROUNDS: Final = 2
MAX_CONCURRENT_REVIEWERS: Final = 2
REVIEW_TIMEOUT_SECONDS: Final = 600
MECHANICAL_TIMEOUT_SECONDS: Final = 30
