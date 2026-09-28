from __future__ import annotations

from typing import Final

from contract_checks import exact, hash256, string_list, text
from uiux_runtime_common import (
    JsonValue,
    MAX_REVIEW_ROUNDS,
    REVIEW_TIMEOUT_SECONDS,
    parse_utc,
    require_mapping,
)

REVIEW_SCHEMA: Final = "litfamily.review-receipt/v1alpha1"
RECEIPT_KEYS: Final = {
    "schema_id", "review_id", "fresh_context_id", "reviewer_capability_class", "input_hashes",
    "reviewed_inventory", "findings", "confidence", "independence_assertion", "started_at",
    "ended_at", "timed_out", "cancelled", "verdict",
}
# A reviewer that ran and rejected the work reports a review verdict. Only a reviewer that
# could not run at all is a blocked capability, and BLOCKED outranks FAIL.
REVIEW_VERDICTS: Final = ("PASS", "REVISE", "FAIL")


def _outcome(
    blocked: list[str], failures: list[str], *, independent: bool
) -> dict[str, JsonValue]:
    unique_blocked = list(dict.fromkeys(blocked))
    unique_failures = list(dict.fromkeys(failures))
    if unique_blocked:
        verdict = "BLOCKED"
    elif unique_failures:
        verdict = "FAIL"
    else:
        verdict = "PASS"
    return {
        "blocked_codes": unique_blocked,
        "failure_codes": unique_failures,
        "independent": independent and not unique_blocked,
        "max_review_rounds": MAX_REVIEW_ROUNDS,
        "verdict": verdict,
    }


def _blocked(codes: list[str]) -> dict[str, JsonValue]:
    return _outcome(codes, [], independent=False)


def _finding(candidate: JsonValue) -> bool:
    if not isinstance(candidate, dict):
        return False
    if set(candidate) != {"finding_id", "severity", "status", "evidence_pointer"}:
        return False
    return (
        isinstance(candidate.get("finding_id"), str)
        and bool(candidate["finding_id"].strip())
        and candidate.get("severity") in {"critical", "high", "medium", "low"}
        and candidate.get("status") in {"open", "resolved", "accepted_exception"}
        and isinstance(candidate.get("evidence_pointer"), str)
        and bool(candidate["evidence_pointer"].strip())
    )


def validate_reviews(value: JsonValue) -> dict[str, JsonValue]:
    # Public receipts are model-supplied data. No current Hermes adapter can attach
    # host-owned provenance, so a public validation route cannot certify independence.
    codes: list[str] = ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]
    failures: list[str] = []
    try:
        request = require_mapping(value, code="REVIEW_RECEIPTS_INVALID")
        exact(request, {"receipts"}, "REVIEW_RECEIPTS_INVALID", "review request")
        receipts = request.get("receipts")
        if not isinstance(receipts, list) or len(receipts) != 2:
            return _blocked(["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"])
        ids: list[str] = []
        contexts: list[str] = []
        inputs: list[list[str]] = []
        inventories: list[list[str]] = []
        for index, receipt in enumerate(receipts):
            invalid_id = "__invalid_review_{0}".format(index)
            invalid_context = "__invalid_context_{0}".format(index)
            if not isinstance(receipt, dict):
                codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                ids.append(invalid_id)
                contexts.append(invalid_context)
                inputs.append([])
                inventories.append([])
                continue
            verdict = receipt.get("verdict")
            if verdict in REVIEW_VERDICTS and verdict != "PASS":
                failures.append("REVIEW_VERDICT_" + str(verdict))
            try:
                exact(receipt, RECEIPT_KEYS, "REVIEW_RECEIPTS_INVALID", "receipt")
                if receipt.get("schema_id") != REVIEW_SCHEMA:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                review_id = text(receipt.get("review_id"), "REVIEW_RECEIPTS_INVALID", "review_id")
                context_id = text(receipt.get("fresh_context_id"), "REVIEW_RECEIPTS_INVALID", "fresh_context_id")
                text(receipt.get("reviewer_capability_class"), "REVIEW_RECEIPTS_INVALID", "capability class")
                raw_hashes = receipt.get("input_hashes")
                if not isinstance(raw_hashes, list) or len(raw_hashes) < 2:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                    hashes = []
                else:
                    hashes = [hash256(item, "REVIEW_RECEIPTS_INVALID", "input hash") for item in raw_hashes]
                    if len(set(hashes)) != len(hashes):
                        codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                inventory = string_list(
                    receipt.get("reviewed_inventory"),
                    "REVIEW_RECEIPTS_INVALID",
                    "reviewed inventory",
                )
                findings = receipt.get("findings")
                if not isinstance(findings, list) or any(not _finding(item) for item in findings):
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                if receipt.get("confidence") not in {"HIGH", "MEDIUM", "LOW"}:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                if receipt.get("independence_assertion") is not True:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                if receipt.get("timed_out") is not False:
                    codes.append("BLOCKED_REVIEW_TIMEOUT")
                if receipt.get("cancelled") is not False:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                if verdict not in REVIEW_VERDICTS:
                    codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                started = parse_utc(text(receipt.get("started_at"), "REVIEW_RECEIPTS_INVALID", "started_at"))
                ended = parse_utc(text(receipt.get("ended_at"), "REVIEW_RECEIPTS_INVALID", "ended_at"))
                duration = (ended - started).total_seconds()
                if duration <= 0 or duration > REVIEW_TIMEOUT_SECONDS:
                    codes.append("BLOCKED_REVIEW_TIMEOUT")
            except Exception:
                codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
                ids.append(invalid_id)
                contexts.append(invalid_context)
                inputs.append([])
                inventories.append([])
                continue
            ids.append(review_id)
            contexts.append(context_id)
            inputs.append(hashes)
            inventories.append(inventory)
        if len(set(ids)) != 2 or len(set(contexts)) != 2:
            codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
        if inputs[0] != inputs[1] or inventories[0] != inventories[1]:
            codes.append("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE")
        return _outcome(codes, failures, independent=True)
    except Exception:
        return _outcome(
            codes + ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"],
            failures,
            independent=False,
        )
