from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit


_KEY_VALUE_RE = re.compile(
    r"(?i)(?<![A-Z0-9_.-])("
    r"[\"']?[A-Z0-9_.-]*(?:api[_-]?key|access[_-]?token|secret[_-]?access[_-]?key|private[_-]?key|database[_-]?url|authorization|password|token|secret)[A-Z0-9_.-]*[\"']?"
    r"\s*[=:]\s*(?:(?:basic|bearer|token)\s+)?[\"']?)([^\s,;\"'}]+)([\"']?)"
)
_SENSITIVE_KEY_FRAGMENTS = (
    "apikey",
    "accesskey",
    "accesstoken",
    "secretaccesskey",
    "privatekey",
    "databaseurl",
    "authorization",
    "password",
    "token",
    "secret",
)

_URI_PATTERN = re.compile(r"(?i)(?<![A-Z0-9])((?:[A-Z][A-Z0-9+.-]*:)?//[^\s<>\"']+)")

_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"(?im)(?<![A-Z0-9_.-])((?:proxy-)?authorization)\s*:[ \t]*([^\r\n]*\S[^\r\n]*)"
        ),
        r"\1: [REDACTED_SECRET]",
    ),
    (
        re.compile(r"(?i)\b(?:basic|bearer)\s+[A-Za-z0-9+/=_-]{8,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(
            r"-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----"
            r"[\s\S]*?"
            r"(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----|$)",
            re.IGNORECASE,
        ),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\b(sk-[A-Za-z0-9_-]{8,})\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,})\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"(?i)\bgithub_pat_[A-Za-z0-9_]{16,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\b(?:AKIA|ASIA|AIDA)[0-9A-Z]{12,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{8,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\bnpm_[A-Za-z0-9_-]{8,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"(?i)\bwhsec_[A-Za-z0-9]{16,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"(?i)\b[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^@\s]+@[^ \t\r\n]+"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\bhf_[A-Za-z0-9_-]{20,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\bglpat-[A-Za-z0-9_-]{8,}\b"),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
        "[REDACTED_SECRET]",
    ),
)


def _redact_key_value(match: re.Match[str]) -> str:
    key = match.group(1)
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    if any(fragment in normalized for fragment in _SENSITIVE_KEY_FRAGMENTS):
        return f"{key}[REDACTED_SECRET]{match.group(3)}"
    return match.group(0)


def _redact_uri_userinfo(match: re.Match[str]) -> str:
    candidate = match.group(1)
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        if "@" in candidate:
            return "[REDACTED_SECRET]"
        return candidate
    if "@" in parsed.netloc:
        return "[REDACTED_SECRET]"
    return candidate


def redact_text(value: str) -> str:
    """Best-effort redaction before user text is persisted or re-injected.

    This is intentionally conservative and local: it catches common bearer-token,
    key/value, OpenAI-style, GitHub-style, and AWS-style secrets without trying to
    classify every high-entropy string as a secret.
    """
    text = str(value or "")
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    text = _KEY_VALUE_RE.sub(_redact_key_value, text)
    text = _URI_PATTERN.sub(_redact_uri_userinfo, text)
    return text


def redact_obj(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_obj(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_obj(item) for item in value)
    if isinstance(value, dict):
        return {key: redact_obj(item) for key, item in value.items()}
    return value
