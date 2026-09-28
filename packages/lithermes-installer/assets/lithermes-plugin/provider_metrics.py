"""Local-only numeric provider receipt measurements.

Hermes exposes a sanitized ``post_api_request`` observer payload.  This module
uses only its runtime labels and normalized numeric ``usage`` buckets; request,
response, prompt, transcript, URL, and credential fields are deliberately
ignored.  A zero cache counter is not treated as a cache miss because some
providers do not report cache details at all.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Mapping
from typing import Any

try:
    from .core_runtime import record_event
    from .redaction import redact_text
except (ImportError, ModuleNotFoundError):
    from core_runtime import record_event
    from redaction import redact_text


SCHEMA = "lithermes.provider-cache/v1"
HOOK = "post_api_request"
RECEIPT_FIELDS = (
    "input_tokens",
    "output_tokens",
    "prompt_tokens",
    "total_tokens",
    "reasoning_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
)


def capability_report() -> dict[str, Any]:
    """Return the host capability and the honest live-measurement boundary."""
    return {
        "state": "CAPABLE",
        "surface": HOOK,
        "receipt_fields": list(RECEIPT_FIELDS),
        "storage": "local-only numeric event ledger",
        "live_measurement": "UNPROVEN",
        "reason": "a provider receipt must arrive before a cache hit is claimed",
        "raw_payloads": "ignored",
    }


def capability_line() -> str:
    """Render a short status/doctor line without claiming a live cache hit."""
    return (
        "provider cache metrics: CAPABLE (Hermes post_api_request usage receipt; "
        "local numeric ledger only); live cache hit: UNPROVEN until a receipt arrives"
    )


def _value(source: Any, key: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(key)
    try:
        return getattr(source, key)
    except Exception:
        return None


def _nonnegative_int(value: Any) -> int | None:
    """Accept only finite, non-negative integer-shaped usage values."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer() or value < 0:
            return None
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip()):
        return int(value.strip())
    return None


def _label_digest(value: Any) -> str | None:
    """Keep provider/model labels joinable without persisting their raw text."""
    text = redact_text(str(value or "")).strip()
    if not text or "[REDACTED_SECRET]" in text:
        return None
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:16]


def _measurement(kwargs: Mapping[str, Any]) -> dict[str, Any]:
    usage = kwargs.get("usage")
    raw_values = (
        {field: _value(usage, field) for field in RECEIPT_FIELDS}
        if usage is not None
        else {}
    )
    values = {field: _nonnegative_int(raw_values.get(field)) for field in RECEIPT_FIELDS}
    cache_read = values["cache_read_tokens"]
    cache_write = values["cache_write_tokens"]
    prompt = values["prompt_tokens"]
    if prompt is None:
        input_tokens = values["input_tokens"]
        if input_tokens is not None and cache_read is not None and cache_write is not None:
            prompt = input_tokens + cache_read + cache_write
            values["prompt_tokens"] = prompt

    result: dict[str, Any] = {
        "schema": SCHEMA,
        "measurement_status": "UNPROVEN",
        "cache_state": "unknown",
        "cache_hit_ratio": None,
        "receipt_fields_present": bool(usage is not None),
        "provider_sha256_16": _label_digest(kwargs.get("provider")),
        "model_sha256_16": _label_digest(kwargs.get("model")),
        "api_mode_sha256_16": _label_digest(kwargs.get("api_mode")),
    }
    result.update({field: value for field, value in values.items() if value is not None})

    if usage is None:
        result["reason"] = "provider usage receipt unavailable"
        return result
    missing = [
        field
        for field in ("cache_read_tokens", "cache_write_tokens")
        if values[field] is None
    ]
    if missing:
        result["reason"] = "provider usage receipt missing: " + ", ".join(missing)
        return result
    if cache_read is not None and cache_read > 0:
        result["measurement_status"] = "MEASURED"
        result["cache_state"] = "hit"
        if prompt and prompt > 0:
            result["cache_hit_ratio"] = cache_read / prompt
        return result
    if cache_write is not None and cache_write > 0:
        result["measurement_status"] = "MEASURED"
        result["cache_state"] = "write_only"
        result["reason"] = "cache write reported; no positive cache read in this receipt"
        return result
    result["reason"] = "zero cache counters are not treated as a provider cache miss"
    return result


def post_api_request(**kwargs: Any) -> None:
    """Append one bounded numeric receipt; never retain raw hook payloads."""
    measurement = _measurement(kwargs)
    record_event("provider_cache_measurement", **measurement)
    return None


__all__ = [
    "HOOK",
    "RECEIPT_FIELDS",
    "SCHEMA",
    "capability_line",
    "capability_report",
    "post_api_request",
]
