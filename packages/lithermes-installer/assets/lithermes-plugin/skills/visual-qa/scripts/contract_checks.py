from __future__ import annotations

import re
from typing import Dict, Iterable, Set

from uiux_runtime_common import ContractError, JsonValue

SHA256 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[0-9a-f]{40}$")


def exact(mapping: Dict[str, JsonValue], keys: Set[str], code: str, label: str) -> None:
    if set(mapping) != keys:
        missing = sorted(keys - set(mapping))
        unknown = sorted(set(mapping) - keys)
        raise ContractError(code, f"{label} missing={missing} unknown={unknown}")


def text(value: JsonValue, code: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(code, f"{label} must be a non-empty string")
    return value


def hash256(value: JsonValue, code: str, label: str) -> str:
    result = text(value, code, label)
    if SHA256.fullmatch(result) is None:
        raise ContractError(code, f"{label} must be a lowercase sha256")
    return result


def revision(value: JsonValue, code: str, label: str) -> str:
    result = text(value, code, label)
    if REVISION.fullmatch(result) is None:
        raise ContractError(code, f"{label} must be a 40-character revision")
    return result


def integer(value: JsonValue, code: str, label: str, *, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ContractError(code, f"{label} must be an integer in {minimum}..{maximum}")
    return value


def number(value: JsonValue, code: str, label: str, *, exclusive_minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(code, f"{label} must be a number")
    result = float(value)
    if not exclusive_minimum < result <= maximum:
        raise ContractError(code, f"{label} must be in ({exclusive_minimum}, {maximum}]")
    return result


def string_list(
    value: JsonValue,
    code: str,
    label: str,
    *,
    minimum: int = 1,
    unique: bool = True,
) -> list[str]:
    if not isinstance(value, list) or len(value) < minimum:
        raise ContractError(code, f"{label} must contain at least {minimum} entries")
    items = [text(item, code, label) for item in value]
    if unique and len(set(items)) != len(items):
        raise ContractError(code, f"{label} must be unique")
    return items


def all_true(mapping: Dict[str, JsonValue], keys: Iterable[str]) -> bool:
    return all(mapping.get(key) is True for key in keys)
