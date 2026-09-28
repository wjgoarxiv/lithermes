from __future__ import annotations

from datetime import timedelta
from typing import Optional

from contract_checks import exact, integer, text
from uiux_runtime_common import (
    ContractError,
    JsonValue,
    MAX_CONCURRENT_REVIEWERS,
    MAX_REVIEW_ROUNDS,
    MECHANICAL_TIMEOUT_SECONDS,
    REVIEW_TIMEOUT_SECONDS,
    parse_utc,
)

FINDING_KEYS = {"finding_id", "severity", "status", "evidence_pointer"}
EXCEPTION_KEYS = {"exception_id", "rationale", "owner", "expires_at", "evidence_pointer"}


def fresh(request: dict[str, JsonValue], now: str) -> bool:
    try:
        maximum_age = integer(
            request.get("evidence_maximum_age_seconds"),
            "TIER_REQUEST_INVALID",
            "evidence maximum age",
            minimum=1,
            maximum=86400,
        )
        current = parse_utc(now)
        created = parse_utc(text(
            request.get("evidence_created_at"),
            "TIER_REQUEST_INVALID",
            "evidence_created_at",
        ))
        return created <= current <= created + timedelta(seconds=maximum_age)
    except ContractError:
        return False


def inspections_valid(value: JsonValue) -> bool:
    if not isinstance(value, list) or len(value) != 2:
        return False
    views: list[str] = []
    contexts: list[str] = []
    try:
        for candidate in value:
            if not isinstance(candidate, dict):
                return False
            exact(candidate, {"view", "fresh_context_id"}, "TIER_REQUEST_INVALID", "inspection")
            view = text(candidate.get("view"), "TIER_REQUEST_INVALID", "inspection view")
            if view not in {"product", "evidence"}:
                return False
            views.append(view)
            contexts.append(text(
                candidate.get("fresh_context_id"),
                "TIER_REQUEST_INVALID",
                "inspection fresh_context_id",
            ))
    except ContractError:
        return False
    return set(views) == {"product", "evidence"} and len(set(contexts)) == 2


def validate_findings(value: JsonValue) -> tuple[bool, bool]:
    if not isinstance(value, list):
        return False, False
    ids: list[str] = []
    unresolved = False
    try:
        for candidate in value:
            if not isinstance(candidate, dict):
                return False, False
            exact(candidate, FINDING_KEYS, "TIER_REQUEST_INVALID", "finding")
            ids.append(text(candidate.get("finding_id"), "TIER_REQUEST_INVALID", "finding id"))
            text(candidate.get("evidence_pointer"), "TIER_REQUEST_INVALID", "finding evidence_pointer")
            if candidate.get("severity") not in {"critical", "high", "medium", "low"}:
                return False, False
            if candidate.get("status") not in {"open", "resolved", "accepted_exception"}:
                return False, False
            unresolved = unresolved or candidate.get("status") == "open"
    except ContractError:
        return False, False
    return len(ids) == len(set(ids)), unresolved


def exceptions_valid(value: JsonValue, now: str) -> bool:
    if not isinstance(value, list):
        return False
    ids: list[str] = []
    try:
        current = parse_utc(now)
        for candidate in value:
            if not isinstance(candidate, dict):
                return False
            exact(candidate, EXCEPTION_KEYS, "TIER_REQUEST_INVALID", "accepted exception")
            ids.append(text(candidate.get("exception_id"), "TIER_REQUEST_INVALID", "exception id"))
            for key in ("rationale", "owner", "evidence_pointer"):
                text(candidate.get(key), "TIER_REQUEST_INVALID", f"exception {key}")
            expires = text(candidate.get("expires_at"), "TIER_REQUEST_INVALID", "exception expires_at")
            if parse_utc(expires) <= current:
                return False
    except ContractError:
        return False
    return len(ids) == len(set(ids))


def iteration_valid(value: JsonValue) -> bool:
    if not isinstance(value, dict):
        return False
    try:
        exact(
            value,
            {"review_round", "concurrent_reviewers", "review_timeout_seconds", "mechanical_timeout_seconds"},
            "TIER_REQUEST_INVALID",
            "iteration",
        )
        integer(
            value.get("review_round"), "TIER_REQUEST_INVALID", "review round",
            minimum=1, maximum=MAX_REVIEW_ROUNDS,
        )
        integer(
            value.get("concurrent_reviewers"), "TIER_REQUEST_INVALID", "concurrent reviewers",
            minimum=1, maximum=MAX_CONCURRENT_REVIEWERS,
        )
        review_timeout = integer(
            value.get("review_timeout_seconds"), "TIER_REQUEST_INVALID", "review timeout",
            minimum=1, maximum=REVIEW_TIMEOUT_SECONDS,
        )
        mechanical_timeout = integer(
            value.get("mechanical_timeout_seconds"), "TIER_REQUEST_INVALID", "mechanical timeout",
            minimum=1, maximum=MECHANICAL_TIMEOUT_SECONDS,
        )
        return review_timeout == REVIEW_TIMEOUT_SECONDS and mechanical_timeout == MECHANICAL_TIMEOUT_SECONDS
    except ContractError:
        return False


def _dimensions(value: JsonValue) -> Optional[tuple[int, int]]:
    if not isinstance(value, list) or len(value) != 2:
        return None
    try:
        return (
            integer(value[0], "TIER_REQUEST_INVALID", "dimension width", minimum=1, maximum=16384),
            integer(value[1], "TIER_REQUEST_INVALID", "dimension height", minimum=1, maximum=16384),
        )
    except ContractError:
        return None


def reference_reasons(value: JsonValue, tier: str) -> list[str]:
    if tier != "reference-fidelity":
        return [] if value == [] else ["UNEXPECTED_REFERENCE_COMPARISON"]
    if not isinstance(value, list) or not value:
        return ["REFERENCE_COMPARISON_MISSING"]
    reasons: list[str] = []
    ids: list[str] = []
    keys = {
        "comparison_id", "target_dimensions", "reference_dimensions",
        "structure_matches", "content_matches", "similarity",
    }
    for candidate in value:
        if not isinstance(candidate, dict) or set(candidate) != keys:
            reasons.append("REFERENCE_COMPARISON_INVALID")
            continue
        comparison_id = candidate.get("comparison_id")
        target = _dimensions(candidate.get("target_dimensions"))
        reference = _dimensions(candidate.get("reference_dimensions"))
        similarity = candidate.get("similarity")
        if (
            not isinstance(comparison_id, str)
            or not comparison_id.strip()
            or target is None
            or reference is None
            or isinstance(similarity, bool)
            or not isinstance(similarity, (int, float))
            or not 0 <= similarity <= 1
        ):
            reasons.append("REFERENCE_COMPARISON_INVALID")
            continue
        ids.append(comparison_id)
        if (
            target != reference
            or candidate.get("structure_matches") is not True
            or candidate.get("content_matches") is not True
        ):
            reasons.append("REFERENCE_STRUCTURE_DEFECT")
    if len(ids) != len(set(ids)):
        reasons.append("REFERENCE_COMPARISON_INVALID")
    return reasons
