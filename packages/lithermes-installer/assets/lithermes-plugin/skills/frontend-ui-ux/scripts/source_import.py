from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from pathlib import Path
from typing import Final

from source_manifest import LICENSE_SHA256, REPAIRED_JAVAFX_SHA256, SOURCE_COMMIT
from uiux_runtime_common import ContractError, JsonValue

DATASET_SHA256: Final = "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8"
DATASET_BYTES: Final = 1_023_482
PLACEHOLDER = re.compile(r"(?i)(?:TODO|TBD|lorem\s+ipsum)")
PUNCTUATION_ONLY = re.compile(r"^[^\w\s]+$", re.UNICODE)


def _csv_rows(text: str, relative: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        rows = list(reader)
    except csv.Error as error:
        raise ContractError("SOURCE_CSV_INVALID", f"{relative}: {error}") from error
    if not rows:
        raise ContractError("SOURCE_CSV_INVALID", f"{relative}: empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows[1:]):
        raise ContractError("SOURCE_CSV_INVALID", f"{relative}: row width drift")
    return rows


def _repair(text: str, entry: dict[str, JsonValue]) -> str:
    repair = entry.get("repair")
    if repair is None:
        return text
    expected = {
        "occurrences": 18,
        "repaired_sha256": REPAIRED_JAVAFX_SHA256,
        "rule": "backslash_quote_to_rfc4180_double_quote",
    }
    if entry.get("path") != "src/ui-ux-pro-max/data/stacks/javafx.csv" or repair != expected:
        raise ContractError("SOURCE_REPAIR_INVALID", str(entry.get("path")))
    try:
        _csv_rows(text, str(entry["path"]))
    except ContractError:
        pass
    else:
        raise ContractError("SOURCE_REPAIR_INVALID", "repair source unexpectedly parses")
    if text.count('\\"') != 18:
        raise ContractError("SOURCE_REPAIR_INVALID", "repair occurrence drift")
    repaired = text.replace('\\"', '""')
    if hashlib.sha256(repaired.encode("utf-8")).hexdigest() != REPAIRED_JAVAFX_SHA256:
        raise ContractError("SOURCE_REPAIR_INVALID", "repaired hash drift")
    return repaired


def _source_bytes(source_root: Path, entry: dict[str, JsonValue]) -> bytes:
    relative = Path(str(entry["path"]))
    path = source_root / relative
    if path.is_symlink() or not path.is_file():
        raise ContractError("SOURCE_FILE_MISSING", str(relative))
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry.get("raw_sha256"):
        raise ContractError("SOURCE_HASH_MISMATCH", str(relative))
    if b"\x00" in raw:
        raise ContractError("SOURCE_CSV_INVALID", f"{relative}: NUL")
    return raw


def _entry_records(source_root: Path, entry: dict[str, JsonValue]) -> list[dict[str, JsonValue]]:
    relative = str(entry["path"])
    try:
        text = _source_bytes(source_root, entry).decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContractError("SOURCE_CSV_INVALID", f"{relative}: UTF-8") from error
    text = _repair(text.replace("\r\n", "\n").replace("\r", "\n"), entry)
    rows = _csv_rows(text, relative)
    header = rows[0]
    if header != entry.get("header") or len(header) != len(set(header)):
        raise ContractError("SOURCE_HEADER_MISMATCH", relative)
    if len(rows) - 1 != entry.get("data_row_count"):
        raise ContractError("SOURCE_ROW_COUNT_MISMATCH", relative)
    selected = list(entry["selected_columns"])
    positions = {column: header.index(column) for column in selected}
    source_path = Path(relative)
    stack = source_path.stem if source_path.parent.name == "stacks" else None
    domain = f"stack/{stack}" if stack else source_path.stem
    records: list[dict[str, JsonValue]] = []
    for row_number, row in enumerate(rows[1:], start=2):
        values = {column: row[positions[column]].strip(" \t\r\n\v\f") for column in selected}
        if any(PLACEHOLDER.fullmatch(value) or (value and PUNCTUATION_ONLY.fullmatch(value)) for value in values.values()):
            raise ContractError("SOURCE_TEXT_INVALID", f"{relative}: row {row_number}")
        try:
            source_no = int(values["No"], 10)
        except ValueError as error:
            raise ContractError("SOURCE_RECORD_INVALID", f"{relative}: row {row_number}") from error
        if source_no < 1 or str(source_no) != values["No"]:
            raise ContractError("SOURCE_RECORD_INVALID", f"{relative}: noncanonical No")
        record: dict[str, JsonValue] = dict(values)
        record["No"] = source_no
        record["domain"] = domain
        record["record_id"] = f"{domain}/{source_no}"
        if stack:
            record["stack"] = stack
        records.append(record)
    if len(records) != entry.get("normalized_record_count"):
        raise ContractError("SOURCE_ROW_COUNT_MISMATCH", relative)
    return records


def canonicalize(
    source_root: Path,
    entries: list[dict[str, JsonValue]],
    expected_records: int,
    maximum_bytes: int,
) -> bytes:
    license_path = source_root / "LICENSE"
    if license_path.is_symlink() or not license_path.is_file():
        raise ContractError("SOURCE_LICENSE_INVALID", "LICENSE missing")
    if hashlib.sha256(license_path.read_bytes()).hexdigest() != LICENSE_SHA256:
        raise ContractError("SOURCE_LICENSE_INVALID", "LICENSE hash drift")
    records: list[dict[str, JsonValue]] = []
    record_ids: set[str] = set()
    for entry in entries:
        for record in _entry_records(source_root, entry):
            record_id = str(record["record_id"])
            if record_id in record_ids:
                raise ContractError("SOURCE_RECORD_INVALID", f"duplicate {record_id}")
            record_ids.add(record_id)
            records.append(record)
    if len(records) != expected_records:
        raise ContractError("SOURCE_RECORD_COUNT_MISMATCH", f"{len(records)} != {expected_records}")
    payload = {"records": records, "schema_version": "litfamily.design-intelligence/v1", "source_commit": SOURCE_COMMIT}
    canonical = (
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode("utf-8")
    digest = hashlib.sha256(canonical).hexdigest()
    if len(canonical) > maximum_bytes:
        raise ContractError("SOURCE_OUTPUT_TOO_LARGE", f"{len(canonical)} > {maximum_bytes}")
    if len(canonical) != DATASET_BYTES or digest != DATASET_SHA256:
        raise ContractError("SOURCE_CANONICAL_MISMATCH", f"bytes={len(canonical)} sha256={digest}")
    return canonical
