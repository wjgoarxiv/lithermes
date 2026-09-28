from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Final

from uiux_runtime_common import ContractError, JsonValue, parse_json_bytes, require_mapping

MANIFEST_SHA256: Final = "9adf471d95aaf17e7866e1c7674cb1a101daae9abdab87c71c96a60f2a58e6fa"
SOURCE_COMMIT: Final = "1307d97a72e6c1cda572cb65471ae5ce82995218"
LICENSE_SHA256: Final = "738f69dfa83db5c347c678fb9d90e560877059f0de93a327c39001bff92dc014"
REPAIRED_JAVAFX_SHA256: Final = "cb424eee50fff9fb6f503ce9a2793177e6eafa6eb7d2ba68561fb3e1b7301ba0"
HASH = re.compile(r"^[0-9a-f]{64}$")


def load_manifest(path: Path) -> tuple[dict[str, JsonValue], list[dict[str, JsonValue]]]:
    if path.is_symlink() or not path.is_file():
        raise ContractError("SOURCE_MANIFEST_INVALID", "manifest must be a regular file")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256:
        raise ContractError("SOURCE_MANIFEST_INVALID", "manifest hash drift")
    manifest = require_mapping(
        parse_json_bytes(raw, maximum_bytes=256 * 1024),
        code="SOURCE_MANIFEST_INVALID",
    )
    if set(manifest) != {"schema_version", "source", "sources"}:
        raise ContractError("SOURCE_MANIFEST_INVALID", "manifest fields drift")
    if manifest.get("schema_version") != "litfamily.source-import-manifest/v1":
        raise ContractError("SOURCE_MANIFEST_INVALID", "manifest schema drift")
    source = manifest.get("source")
    if not isinstance(source, dict) or source.get("commit") != SOURCE_COMMIT:
        raise ContractError("SOURCE_MANIFEST_INVALID", "source commit drift")
    license_info = source.get("license")
    if not isinstance(license_info, dict) or license_info.get("sha256") != LICENSE_SHA256:
        raise ContractError("SOURCE_MANIFEST_INVALID", "license identity drift")
    entries = manifest.get("sources")
    if not isinstance(entries, list) or len(entries) != 34:
        raise ContractError("SOURCE_MANIFEST_INVALID", "exactly 34 sources required")
    paths: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ContractError("SOURCE_MANIFEST_INVALID", "source entry must be an object")
        required = {
            "data_row_count", "header", "normalized_record_count", "path", "profile",
            "raw_sha256", "selected_columns",
        }
        if set(entry) not in (required, required | {"repair"}):
            raise ContractError("SOURCE_MANIFEST_INVALID", "source entry fields drift")
        source_path = entry.get("path")
        if not isinstance(source_path, str) or not source_path.startswith("src/ui-ux-pro-max/data/"):
            raise ContractError("SOURCE_MANIFEST_INVALID", "source path invalid")
        paths.append(source_path)
        if not isinstance(entry.get("header"), list) or not isinstance(entry.get("selected_columns"), list):
            raise ContractError("SOURCE_MANIFEST_INVALID", f"column inventory invalid: {source_path}")
        if not set(entry["selected_columns"]).issubset(set(entry["header"])) or "No" not in entry["selected_columns"]:
            raise ContractError("SOURCE_MANIFEST_INVALID", f"selected columns invalid: {source_path}")
        if HASH.fullmatch(str(entry.get("raw_sha256", ""))) is None:
            raise ContractError("SOURCE_MANIFEST_INVALID", f"source hash invalid: {source_path}")
        for key in ("data_row_count", "normalized_record_count"):
            if not isinstance(entry.get(key), int) or isinstance(entry.get(key), bool) or entry[key] < 1:
                raise ContractError("SOURCE_MANIFEST_INVALID", f"{key} invalid: {source_path}")
    if len(set(paths)) != 34:
        raise ContractError("SOURCE_MANIFEST_INVALID", "source paths must be unique")
    return manifest, entries
