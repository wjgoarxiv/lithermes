#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT))

from uiux_runtime_common import ContractError, emit_error, emit_json

from source_import import canonicalize
from source_manifest import load_manifest

DEFAULT_MANIFEST = Path(__file__).resolve().parents[1] / "resources" / "import-manifest.json"


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Validate the pinned 34-source design-intelligence import")
    result.add_argument("--source-root", required=True, type=Path)
    result.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    result.add_argument("--check", action="store_true", required=True)
    result.add_argument("--expect-records", type=int, required=True)
    result.add_argument("--max-bytes", type=int, required=True)
    return result


def run(arguments: list[str]) -> int:
    args = parser().parse_args(arguments)
    try:
        if args.expect_records != 2277 or args.max_bytes != 4_194_304:
            raise ContractError("SOURCE_CONTRACT_INVALID", "approved record and byte bounds required")
        source_root = args.source_root.resolve()
        if not source_root.is_dir():
            raise ContractError("SOURCE_ROOT_INVALID", str(source_root))
        _, entries = load_manifest(args.manifest.resolve())
        canonical = canonicalize(source_root, entries, args.expect_records, args.max_bytes)
        emit_json(
            {
                "bytes": len(canonical),
                "dataset_sha256": hashlib.sha256(canonical).hexdigest(),
                "records": args.expect_records,
                "status": "SOURCE_CONTRACT_PASS",
            }
        )
        return 0
    except (ContractError, OSError) as error:
        if isinstance(error, ContractError):
            return emit_error(error)
        return emit_error(ContractError("SOURCE_IO_ERROR", str(error)))


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
