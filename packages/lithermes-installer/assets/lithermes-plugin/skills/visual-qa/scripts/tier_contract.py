from __future__ import annotations

from typing import Final

from contract_checks import exact, string_list
from review_contract import validate_reviews
from tier_checks import (
    exceptions_valid,
    fresh,
    inspections_valid,
    iteration_valid,
    reference_reasons,
    validate_findings,
)
from uiux_runtime_common import (
    ContractError,
    JsonValue,
    MAX_CONCURRENT_REVIEWERS,
    MAX_REVIEW_ROUNDS,
    MECHANICAL_TIMEOUT_SECONDS,
    REVIEW_TIMEOUT_SECONDS,
    require_mapping,
)

TIERS: Final = ("smoke", "full", "reference-fidelity")
TOP_KEYS: Final = {
    "schema_id", "tier", "required_inventory", "accounted_inventory", "evidence_created_at",
    "evidence_maximum_age_seconds", "contract_hash_matches", "source_hash_matches",
    "critical_mechanical_checks_complete", "applicable_accessibility_checks_complete",
    "inspections", "review_receipts", "findings", "accepted_exceptions", "reference_checks",
    "iteration",
}
def _limits() -> dict[str, JsonValue]:
    return {
        "maximum_concurrent_reviewers": MAX_CONCURRENT_REVIEWERS,
        "maximum_review_rounds": MAX_REVIEW_ROUNDS,
        "mechanical_timeout_seconds": MECHANICAL_TIMEOUT_SECONDS,
        "review_timeout_seconds": REVIEW_TIMEOUT_SECONDS,
    }


def evaluate_tier(value: JsonValue, *, now: str) -> dict[str, JsonValue]:
    request = require_mapping(value, code="TIER_REQUEST_INVALID")
    exact(request, TOP_KEYS, "TIER_REQUEST_INVALID", "tier request")
    if request.get("schema_id") != "litfamily.visual-qa-completion/v1alpha1":
        raise ContractError("TIER_REQUEST_INVALID", "schema_id invalid")
    tier = request.get("tier")
    if not isinstance(tier, str) or tier not in TIERS:
        raise ContractError("TIER_REQUEST_INVALID", "unknown tier")
    reasons: list[str] = []
    try:
        required = string_list(request.get("required_inventory"), "TIER_REQUEST_INVALID", "required inventory")
        accounted = string_list(request.get("accounted_inventory"), "TIER_REQUEST_INVALID", "accounted inventory")
    except ContractError:
        required, accounted = [], []
        reasons.append("TIER_INVENTORY_INVALID")
    missing = set(required) - set(accounted)
    if tier == "smoke" and "interaction:critical-submit" in missing:
        reasons.append("SMOKE_CRITICAL_INTERACTION_MISSING")
    elif missing:
        reasons.append("INVENTORY_MISSING")
    if not fresh(request, now):
        reasons.append("EVIDENCE_NOT_FRESH")
    for key, code in (
        ("contract_hash_matches", "CONTRACT_HASH_MISMATCH"),
        ("source_hash_matches", "SOURCE_HASH_MISMATCH"),
        ("critical_mechanical_checks_complete", "MECHANICAL_CHECKS_INCOMPLETE"),
    ):
        if request.get(key) is not True:
            reasons.append(code)
    if tier != "smoke" and request.get("applicable_accessibility_checks_complete") is not True:
        reasons.append("ACCESSIBILITY_CHECKS_INCOMPLETE")
    if not inspections_valid(request.get("inspections")):
        reasons.append("INSPECTION_INCOMPLETE")
    if tier == "smoke":
        if request.get("review_receipts") != []:
            reasons.append("SMOKE_REVIEW_RECEIPTS_INVALID")
    else:
        review = validate_reviews({"receipts": request.get("review_receipts")})
        reasons.extend(str(code) for code in review.get("blocked_codes", []))
        reasons.extend(str(code) for code in review.get("failure_codes", []))
    findings_valid, unresolved = validate_findings(request.get("findings"))
    if not findings_valid:
        reasons.append("FINDINGS_INVALID")
    elif tier != "smoke" and unresolved:
        reasons.append("FULL_FINDING_UNRESOLVED")
    if not exceptions_valid(request.get("accepted_exceptions"), now):
        reasons.append("EXCEPTIONS_INVALID")
    if not iteration_valid(request.get("iteration")):
        reasons.append("FINITE_LIMIT_INVALID")
    reasons.extend(reference_reasons(request.get("reference_checks"), tier))
    reasons = list(dict.fromkeys(reasons))
    verdict = "PASS" if not reasons else "BLOCKED" if any(
        reason.startswith("BLOCKED_") for reason in reasons
    ) else "FAIL"
    return {
        "complete": not reasons,
        "finite_limits": _limits(),
        "reasons": reasons,
        "similarity_advisory": tier == "reference-fidelity",
        "tier": tier,
        "verdict": verdict,
    }
