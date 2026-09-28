#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT))

from uiux_runtime_common import ContractError, emit_error, emit_json

from design_contract_validation import (
    BETA2_SCHEMA_ID,
    BETA_SCHEMA_ID,
    SCHEMA_ID,
    canonical_design_contract,
    design_contract_report,
    load_design_contract_path,
    load_design_contract_stdin,
    validate_design_contract,
)
from design_runtime import query_dataset

DEFAULT_DATASET = Path(__file__).resolve().parents[1] / "resources" / "design-intelligence.json"

# Exit-code contract for the Design Contract commands:
#   0  the contract satisfies every rule; stdout carries one line of JSON
#      {"issues": [], "schema": "<id>", "valid": true}
#   1  the input parsed but broke rules; stdout carries the same envelope with a
#      populated issues array
#   2  the input could not be trusted at all (oversize, non-UTF-8, NUL byte, duplicate
#      JSON key, trailing data, unreadable or non-regular file); a human sentence goes
#      to stderr and stdout stays empty
# Every command hands its code back to `run`, which hands it to SystemExit at the bottom
# of this file. Nothing exits from inside a nested call, so buffered stdout is always
# flushed by normal interpreter shutdown before the code reaches the caller.


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="LitHermes offline design intelligence")
    commands = root.add_subparsers(dest="command", required=True)
    validate = commands.add_parser(
        "validate-design-contract",
        help="check a Design Contract; exits 0 valid, 1 invalid, 2 untrusted input",
    )
    validate.add_argument("--contract", type=Path, help="contract path; defaults to stdin")
    validate.add_argument("--json", action="store_true", help="stdout is always the JSON envelope")
    canonical = commands.add_parser(
        "canonical-design-contract",
        help="emit the canonical hashable text of a valid Design Contract",
    )
    canonical.add_argument("--contract", type=Path, help="contract path; defaults to stdin")
    query = commands.add_parser("query")
    query.add_argument("--query", required=True)
    query.add_argument("--domain", required=True)
    query.add_argument("--limit", type=int, default=20)
    query.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    query.add_argument("--json", action="store_true")
    return root


def _load_contract(contract: Path):
    if contract is None:
        return load_design_contract_stdin()
    return load_design_contract_path(contract)


def _report_untrusted(error: ContractError) -> int:
    sys.stderr.write("design contract input rejected: {0}\n".format(error.detail))
    return 2


def _validate_command(contract: Path) -> int:
    try:
        value = _load_contract(contract)
    except ContractError as error:
        return _report_untrusted(error)
    report = design_contract_report(value)
    emit_json(report)
    return 0 if report["evidence_eligible"] else 1


def _canonical_command(contract: Path) -> int:
    try:
        value = _load_contract(contract)
    except ContractError as error:
        return _report_untrusted(error)
    issues = validate_design_contract(value)
    if issues:
        sys.stderr.write("design contract is invalid; canonical text withheld:\n")
        for issue in issues:
            sys.stderr.write("  - {0}\n".format(issue))
        return 1
    if value.get("schema_id") == SCHEMA_ID:
        sys.stderr.write(
            "design contract v1alpha1 is diagnostic-only; canonical completion requires v1beta1 or v1beta2\n"
        )
        return 1
    if value.get("schema_id") not in (BETA_SCHEMA_ID, BETA2_SCHEMA_ID):
        sys.stderr.write("design contract schema is not canonical\n")
        return 1
    sys.stdout.write(canonical_design_contract(value))
    return 0


def run(arguments: list[str]) -> int:
    args = parser().parse_args(arguments)
    if args.command == "validate-design-contract":
        return _validate_command(args.contract)
    if args.command == "canonical-design-contract":
        return _canonical_command(args.contract)
    try:
        emit_json(
            query_dataset(
                args.dataset,
                query=args.query,
                domain=args.domain,
                limit=args.limit,
            )
        )
        return 0
    except ContractError as error:
        return emit_error(error)


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
