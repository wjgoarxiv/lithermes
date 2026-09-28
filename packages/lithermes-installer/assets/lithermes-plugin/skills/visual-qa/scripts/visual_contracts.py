from evidence_contract import validate_evidence
from review_contract import validate_reviews
from tier_contract import evaluate_tier
from uiux_runtime_common import ContractError, JsonValue, require_mapping


def evaluate_capabilities(value: JsonValue) -> dict[str, JsonValue]:
    request = require_mapping(value, code="CAPABILITY_REQUEST_INVALID")
    if set(request) != {"tier", "capabilities"}:
        raise ContractError("CAPABILITY_REQUEST_INVALID", "exact tier and capabilities fields required")
    if request.get("tier") not in {"smoke", "full", "reference-fidelity"}:
        raise ContractError("CAPABILITY_REQUEST_INVALID", "tier invalid")
    capabilities = request.get("capabilities")
    if not isinstance(capabilities, dict) or set(capabilities) != {
        "capture", "auth", "safe_test_account", "independent_review", "renderer_ownership"
    }:
        raise ContractError("CAPABILITY_REQUEST_INVALID", "exact capability inventory required")
    checks = (
        ("capture", "BLOCKED_RENDERER_UNAVAILABLE"),
        ("auth", "BLOCKED_AUTH_UNAVAILABLE"),
        ("safe_test_account", "BLOCKED_TEST_ACCOUNT_UNSAFE"),
        ("independent_review", "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"),
        ("renderer_ownership", "BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED"),
    )
    blocked = [code for key, code in checks if capabilities.get(key) is not True]
    if request["tier"] != "smoke" and "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE" not in blocked:
        blocked.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
    return {"blocked_codes": blocked, "verdict": "BLOCKED" if blocked else "PASS"}


__all__ = ["evaluate_capabilities", "evaluate_tier", "validate_evidence", "validate_reviews"]
