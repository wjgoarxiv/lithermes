from __future__ import annotations

import hashlib
import stat
from pathlib import Path
from typing import Final

from uiux_runtime_common import ContractError, JsonValue, parse_json_bytes, require_mapping

# The packaged corpus identity lives with the corpus loader. The Design Contract does
# not carry, pin, or depend on it.
DATASET_SCHEMA: Final = "litfamily.design-intelligence/v1"
DATASET_SHA256: Final = "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8"
DATASET_BYTES: Final = 1_023_482
QUERY_MAX_BYTES: Final = 4096
OUTPUT_RECORD_LIMIT: Final = 20
DATASET_MAX_BYTES: Final = 4 * 1024 * 1024


def _records(dataset: dict[str, JsonValue]) -> list[dict[str, JsonValue]]:
    raw_records = dataset.get("records")
    if not isinstance(raw_records, list) or not raw_records:
        raise ContractError("DATASET_RECORD_INVALID", "records must be a non-empty array")
    checked: list[dict[str, JsonValue]] = []
    for index, candidate in enumerate(raw_records):
        if not isinstance(candidate, dict):
            raise ContractError("DATASET_RECORD_INVALID", f"record {index} is not an object")
        required = ("record_id", "domain", "No")
        if any(key not in candidate for key in required):
            raise ContractError("DATASET_RECORD_INVALID", f"record {index} missing required fields")
        if len(candidate) < 4:
            raise ContractError("DATASET_RECORD_INVALID", f"record {index} has no content fields")
        checked.append(candidate)
    return checked


def load_dataset(path: Path) -> tuple[dict[str, JsonValue], list[dict[str, JsonValue]]]:
    try:
        stat_result = path.lstat()
    except OSError as error:
        raise ContractError("DATASET_UNREADABLE", str(error)) from error
    if path.is_symlink() or not stat.S_ISREG(stat_result.st_mode):
        raise ContractError("DATASET_UNSAFE_PATH", str(path))
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ContractError("DATASET_UNREADABLE", str(error)) from error
    try:
        parsed = parse_json_bytes(raw, maximum_bytes=DATASET_MAX_BYTES)
    except ContractError as error:
        raise ContractError("DATASET_MALFORMED", error.detail) from error
    dataset = require_mapping(parsed, code="DATASET_MALFORMED")
    if dataset.get("schema_version") != DATASET_SCHEMA:
        raise ContractError("DATASET_RECORD_INVALID", "unknown dataset schema")
    records = _records(dataset)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != DATASET_SHA256:
        raise ContractError("DATASET_HASH_MISMATCH", digest)
    return dataset, records


def query_dataset(
    path: Path,
    *,
    query: str,
    domain: str,
    limit: int,
) -> dict[str, JsonValue]:
    query_bytes = len(query.encode("utf-8"))
    if query_bytes > QUERY_MAX_BYTES:
        raise ContractError("QUERY_UTF8_TOO_LARGE", f"{query_bytes} > {QUERY_MAX_BYTES}")
    if limit < 1 or limit > OUTPUT_RECORD_LIMIT:
        raise ContractError("LIMIT_INVALID", f"limit must be 1..{OUTPUT_RECORD_LIMIT}")
    _, records = load_dataset(path)
    domains = {str(record["domain"]) for record in records}
    if domain not in domains:
        raise ContractError("UNKNOWN_DOMAIN", f"unknown domain: {domain}")
    terms = [term for term in query.casefold().split() if term]
    matches: list[dict[str, JsonValue]] = []
    for record in records:
        if record["domain"] != domain:
            continue
        searchable = " ".join(str(value) for value in record.values()).casefold()
        if terms and not all(term in searchable for term in terms):
            continue
        matches.append(record)
        if len(matches) == limit:
            break
    return {
        "dataset_sha256": DATASET_SHA256,
        "empty_result": not matches,
        "fallback_applied": False,
        "files_written": 0,
        "network_access": False,
        "query_utf8_bytes": query_bytes,
        "records": matches,
        "schema_id": "litfamily.design-intelligence-query/v1alpha1",
    }
