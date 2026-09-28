from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Final, Mapping

from contract_checks import all_true, exact, hash256, integer, number, revision, string_list, text
from uiux_runtime_common import ContractError, JsonValue, parse_utc, require_mapping
from png_runtime import inspect_png_bytes, open_bounded_bytes

EVIDENCE_SCHEMA: Final = "litfamily.evidence-manifest/v1alpha1"
EVIDENCE_SCHEMA_BETA: Final = "litfamily.evidence-manifest/v1beta1"
TOP_KEYS: Final = {
    "schema_id", "design_contract_sha256", "source_revision", "captures", "inventory",
    "mechanical_results", "accessibility_results", "tui_results", "reviewer_receipt_hashes",
    "open_findings", "exception_references", "cleanup", "final_verdict",
}
BETA_TOP_KEYS: Final = TOP_KEYS | {"tier"}
CAPTURE_KEYS: Final = {
    "capture_id", "source_sha256", "capture_sha256", "created_at", "maximum_age_seconds",
    "viewport", "dpr", "os", "runtime", "runtime_version", "font_set", "locale",
    "reduced_motion", "animation_settling_policy", "color_scheme", "auth_owner", "process_owner",
}


@dataclass(frozen=True)
class HostCaptureProvenance:
    """Trusted in-process receipt; never parsed from manifest or CLI input."""

    capture_id: str
    capture_sha256: str
    source_sha256: str
    source_revision: str
    artifact_identity: tuple[int, int]
    captured_at: datetime


def _capture(
    candidate: JsonValue, now: str, *, material_freshness: bool = False
) -> tuple[str, str, str, tuple[int, int], datetime, int]:
    if not isinstance(candidate, dict):
        raise ContractError("EVIDENCE_INVALID", "capture must be an object")
    exact(candidate, CAPTURE_KEYS, "EVIDENCE_INVALID", "capture")
    for key in (
        "capture_id", "os", "runtime", "runtime_version", "locale", "animation_settling_policy",
        "color_scheme", "auth_owner", "process_owner",
    ):
        text(candidate.get(key), "EVIDENCE_INVALID", f"capture {key}")
    source_digest = hash256(
        candidate.get("source_sha256"), "EVIDENCE_INVALID", "capture source_sha256"
    )
    digest = hash256(candidate.get("capture_sha256"), "EVIDENCE_INVALID", "capture capture_sha256")
    string_list(candidate.get("font_set"), "EVIDENCE_INVALID", "capture font_set")
    viewport = candidate.get("viewport")
    if not isinstance(viewport, dict):
        raise ContractError("EVIDENCE_INVALID", "capture viewport must be an object")
    exact(viewport, {"width", "height"}, "EVIDENCE_INVALID", "capture viewport")
    for key in ("width", "height"):
        integer(viewport.get(key), "EVIDENCE_INVALID", f"capture viewport {key}", minimum=1, maximum=16384)
    maximum_age = integer(
        candidate.get("maximum_age_seconds"),
        "EVIDENCE_INVALID",
        "capture maximum_age_seconds",
        minimum=1,
        maximum=86400,
    )
    number(candidate.get("dpr"), "EVIDENCE_INVALID", "capture dpr", exclusive_minimum=0, maximum=8)
    if not isinstance(candidate.get("reduced_motion"), bool):
        raise ContractError("EVIDENCE_INVALID", "capture reduced_motion invalid")
    if candidate.get("color_scheme") not in {"light", "dark", "system"}:
        raise ContractError("EVIDENCE_INVALID", "capture color_scheme invalid")
    current = parse_utc(now)
    created = parse_utc(text(candidate.get("created_at"), "EVIDENCE_INVALID", "capture created_at"))
    if not material_freshness:
        if created > current:
            raise ContractError("BLOCKED_EVIDENCE_FUTURE", str(candidate["capture_id"]))
        if current > created + timedelta(seconds=maximum_age):
            raise ContractError("BLOCKED_EVIDENCE_STALE", str(candidate["capture_id"]))
    return (
        str(candidate["capture_id"]),
        digest,
        source_digest,
        (int(viewport["width"]), int(viewport["height"])),
        created,
        maximum_age,
    )


def _material_capture(
    root: Path,
    relative_path: str,
    expected_hash: str,
    dimensions: tuple[int, int],
    *,
    capture_id: str,
    source_sha256: str,
    source_revision: str,
    created_at: datetime,
    maximum_age_seconds: int,
    now: str,
    provenance: HostCaptureProvenance | None,
) -> None:
    candidate = Path(relative_path)
    if candidate.is_absolute() or not candidate.parts or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise ContractError("EVIDENCE_ARTIFACT_PATH_INVALID", relative_path)
    with open_bounded_bytes(
        root,
        candidate,
        root_invalid_code="EVIDENCE_ARTIFACT_ROOT_INVALID",
        unsafe_code="EVIDENCE_ARTIFACT_PATH_INVALID",
        unreadable_code="EVIDENCE_ARTIFACT_UNAVAILABLE",
        resource_code="EVIDENCE_ARTIFACT_RESOURCE_BOUND",
        changed_code="EVIDENCE_ARTIFACT_PATH_CHANGED",
    ) as opened:
        raw = opened.raw
        if sha256(raw).hexdigest() != expected_hash:
            raise ContractError("EVIDENCE_ARTIFACT_HASH_INVALID", relative_path)
        report = inspect_png_bytes(raw)
        opened.verify()
        if (report.get("width"), report.get("height")) != dimensions:
            raise ContractError("EVIDENCE_CAPTURE_DIMENSIONS_INVALID", relative_path)
        if provenance is None:
            raise ContractError(
                "BLOCKED_CAPTURE_PROVENANCE_UNAVAILABLE",
                capture_id,
            )
        if not isinstance(provenance, HostCaptureProvenance):
            raise ContractError("BLOCKED_CAPTURE_PROVENANCE_UNVERIFIED", capture_id)
        captured_at = provenance.captured_at
        if captured_at.tzinfo is None:
            raise ContractError("BLOCKED_CAPTURE_PROVENANCE_UNVERIFIED", capture_id)
        captured_at = captured_at.astimezone(timezone.utc)
        if (
            provenance.capture_id != capture_id
            or provenance.capture_sha256 != expected_hash
            or provenance.source_sha256 != source_sha256
            or provenance.source_revision != source_revision
            or provenance.artifact_identity != opened.source_identity
            or captured_at != created_at
        ):
            raise ContractError("BLOCKED_CAPTURE_PROVENANCE_UNVERIFIED", capture_id)
        current = parse_utc(now)
        if captured_at > current:
            raise ContractError("BLOCKED_EVIDENCE_FUTURE", capture_id)
        if current > captured_at + timedelta(seconds=maximum_age_seconds):
            raise ContractError("BLOCKED_EVIDENCE_STALE", capture_id)


def _result(candidate: JsonValue, *, accessibility: bool = False) -> None:
    if not isinstance(candidate, dict):
        raise ContractError("EVIDENCE_INVALID", "result must be an object")
    id_key = "criterion" if accessibility else "check_id"
    exact(candidate, {id_key, "status", "evidence_pointer"}, "EVIDENCE_INVALID", "result")
    text(candidate.get(id_key), "EVIDENCE_INVALID", f"result {id_key}")
    text(candidate.get("evidence_pointer"), "EVIDENCE_INVALID", "result evidence_pointer")
    if candidate.get("status") not in {"PASS", "FAIL", "NOT_APPLICABLE"}:
        raise ContractError("EVIDENCE_INVALID", "result status invalid")


def validate_evidence(
    value: JsonValue,
    *,
    now: str,
    evidence_root: Path | None = None,
    host_capture_provenance: Mapping[str, HostCaptureProvenance] | None = None,
) -> dict[str, JsonValue]:
    manifest = require_mapping(value, code="EVIDENCE_INVALID")
    beta = manifest.get("schema_id") == EVIDENCE_SCHEMA_BETA
    exact(manifest, BETA_TOP_KEYS if beta else TOP_KEYS, "EVIDENCE_INVALID", "manifest")
    if manifest.get("schema_id") not in {EVIDENCE_SCHEMA, EVIDENCE_SCHEMA_BETA} or manifest.get("final_verdict") != "PASS":
        raise ContractError("EVIDENCE_INVALID", "exact PASS evidence manifest required")
    if beta and manifest.get("tier") not in {"smoke", "full", "reference-fidelity"}:
        raise ContractError("EVIDENCE_INVALID", "beta tier invalid")
    if beta and evidence_root is None:
        raise ContractError("EVIDENCE_ARTIFACT_ROOT_INVALID", "--evidence-root is required for beta")
    hash256(manifest.get("design_contract_sha256"), "EVIDENCE_INVALID", "design contract hash")
    revision(manifest.get("source_revision"), "EVIDENCE_INVALID", "source revision")
    captures = manifest.get("captures")
    if not isinstance(captures, list) or not captures:
        raise ContractError("EVIDENCE_INVALID", "captures must be non-empty")
    capture_hashes: list[str] = []
    capture_ids: list[str] = []
    capture_dimensions: dict[str, tuple[int, int]] = {}
    capture_freshness: dict[str, tuple[str, str, datetime, int]] = {}
    for item in captures:
        capture_id, capture_hash, source_hash, dimensions, created_at, maximum_age = _capture(
            item,
            now,
            material_freshness=beta,
        )
        capture_hashes.append(capture_hash)
        capture_ids.append(capture_id)
        capture_dimensions[capture_hash] = dimensions
        capture_freshness[capture_hash] = (capture_id, source_hash, created_at, maximum_age)
    if len(set(capture_hashes)) != len(capture_hashes) or len(set(capture_ids)) != len(capture_ids):
        raise ContractError("EVIDENCE_INVALID", "capture ids and hashes must be unique")
    inventory = manifest.get("inventory")
    if not isinstance(inventory, list) or not inventory:
        raise ContractError("EVIDENCE_INVALID", "inventory must be non-empty")
    inventory_ids: list[str] = []
    for item in inventory:
        if not isinstance(item, dict):
            raise ContractError("EVIDENCE_INVALID", "inventory item must be an object")
        exact(item, {"id", "status", "evidence_path", "evidence_sha256"}, "EVIDENCE_INVALID", "inventory")
        inventory_ids.append(text(item.get("id"), "EVIDENCE_INVALID", "inventory id"))
        text(item.get("evidence_path"), "EVIDENCE_INVALID", "inventory evidence_path")
        digest = hash256(item.get("evidence_sha256"), "EVIDENCE_INVALID", "inventory evidence_sha256")
        if item.get("status") != "captured" or digest not in capture_hashes:
            raise ContractError("EVIDENCE_INVALID", "inventory is blocked, unresolved, or hash-mismatched")
        if beta:
            capture_id, source_hash, created_at, maximum_age = capture_freshness[digest]
            _material_capture(
                evidence_root,
                str(item["evidence_path"]),
                digest,
                capture_dimensions[digest],
                capture_id=capture_id,
                source_sha256=source_hash,
                source_revision=str(manifest["source_revision"]),
                created_at=created_at,
                maximum_age_seconds=maximum_age,
                now=now,
                provenance=(host_capture_provenance or {}).get(capture_id),
            )
    if len(set(inventory_ids)) != len(inventory_ids):
        raise ContractError("EVIDENCE_INVALID", "inventory ids must be unique")
    for key, accessibility in (
        ("mechanical_results", False), ("accessibility_results", True), ("tui_results", False),
    ):
        results = manifest.get(key)
        if not isinstance(results, list) or not results:
            raise ContractError("EVIDENCE_INVALID", f"{key} must be non-empty")
        result_ids: list[str] = []
        id_key = "criterion" if accessibility else "check_id"
        for result in results:
            _result(result, accessibility=accessibility)
            result_ids.append(str(result.get(id_key)))
        if len(set(result_ids)) != len(result_ids):
            raise ContractError("EVIDENCE_INVALID", f"{key} ids must be unique")
        if any(result.get("status") == "FAIL" for result in results):
            raise ContractError("EVIDENCE_INVALID", f"{key} contains a failure")
    hashes = manifest.get("reviewer_receipt_hashes")
    expected_review_count = 0 if beta and manifest.get("tier") == "smoke" else 2
    if not isinstance(hashes, list) or len(hashes) != expected_review_count:
        raise ContractError("EVIDENCE_INVALID", f"exactly {expected_review_count} review receipt hashes required")
    receipt_hashes = [hash256(item, "EVIDENCE_INVALID", "review receipt hash") for item in hashes]
    if len(set(receipt_hashes)) != expected_review_count:
        raise ContractError("EVIDENCE_INVALID", "review receipt hashes must be distinct")
    if beta and manifest.get("tier") != "smoke":
        # Hermes delegate_task receipts are model-supplied JSON. Until Hermes exposes a
        # host-owned provenance adapter, those self-attestations cannot unlock a higher tier.
        raise ContractError(
            "BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
            "host-owned reviewer provenance is unavailable",
        )
    if manifest.get("open_findings") != []:
        raise ContractError("EVIDENCE_INVALID", "PASS manifest cannot contain open findings")
    string_list(
        manifest.get("exception_references"),
        "EVIDENCE_INVALID",
        "exception_references",
        minimum=0,
    )
    cleanup = manifest.get("cleanup")
    if not isinstance(cleanup, dict):
        raise ContractError("EVIDENCE_INVALID", "cleanup receipt required")
    exact(
        cleanup,
        {"state", "process_terminated", "auth_session_closed", "transient_paths_removed"},
        "EVIDENCE_INVALID",
        "cleanup",
    )
    if cleanup.get("state") != "complete" or not all_true(
        cleanup, ("process_terminated", "auth_session_closed", "transient_paths_removed")
    ):
        raise ContractError("BLOCKED_CLEANUP_INCOMPLETE", "cleanup receipt incomplete")
    if not beta:
        return {
            **manifest,
            "diagnostics": ["LEGACY_SCHEMA_V1ALPHA1"],
            "evidence_eligible": False,
            "final_verdict": "DIAGNOSTIC_ONLY",
        }
    return {**manifest, "evidence_eligible": True}
