from __future__ import annotations

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
DESIGN_ROOT = PLUGIN_ROOT / "skills" / "frontend-ui-ux"
VISUAL_ROOT = PLUGIN_ROOT / "skills" / "visual-qa"
sys.path.insert(0, str(PLUGIN_ROOT))
sys.path.insert(0, str(DESIGN_ROOT / "scripts"))
sys.path.insert(0, str(VISUAL_ROOT / "scripts"))

import design_contract_validation
import evidence_contract
import review_contract


def _valid_beta_contract() -> dict:
    script = (
        "const {designContract}=require('./qa/lib/documents');"
        "process.stdout.write(JSON.stringify(designContract()));"
    )
    result = subprocess.run(
        ["node", "-e", script],
        cwd=PACKAGE_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def _visual_document(expression: str) -> dict:
    script = (
        "const documents=require('./qa/lib/documents');"
        f"process.stdout.write(JSON.stringify({expression}));"
    )
    result = subprocess.run(
        ["node", "-e", script],
        cwd=PACKAGE_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def _valid_evidence(tier: str | None = None) -> dict:
    options = ", {tier: 'smoke'}" if tier else ""
    return _visual_document(
        f"documents.evidenceManifest(new Date('2026-07-24T00:10:00Z'){options})"
    )


def _valid_review() -> dict:
    receipt = _visual_document(
        "documents.reviewReceipt(new Date('2026-07-24T00:10:00Z'), "
        "{reviewId: 'review-a', contextId: 'context-a'})"
    )
    receipt["findings"] = [{
        "finding_id": "finding-a",
        "severity": "low",
        "status": "resolved",
        "evidence_pointer": "capture:apply-320",
    }]
    return receipt


class BetaSchemaRuntimeParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        schema_path = DESIGN_ROOT / "schemas" / "design-contract-v1beta1.schema.json"
        cls.schema = json.loads(schema_path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(cls.schema)
        cls.validator = Draft202012Validator(cls.schema)
        visual_schema_paths = sorted((VISUAL_ROOT / "schemas").glob("*.schema.json"))
        schemas = [json.loads(path.read_text(encoding="utf-8")) for path in visual_schema_paths]
        cls.visual_schemas = {schema["$id"]: schema for schema in schemas}
        expected_ids = {
            "litfamily.evidence-manifest/v1alpha1",
            "litfamily.evidence-manifest/v1beta1",
            "litfamily.review-receipt/v1alpha1",
        }
        if set(cls.visual_schemas) != expected_ids:
            raise AssertionError(f"published visual QA schemas changed: {set(cls.visual_schemas)!r}")
        for schema in cls.visual_schemas.values():
            Draft202012Validator.check_schema(schema)

    def assertParity(self, candidate: dict, expected: bool) -> None:
        schema_valid = self.validator.is_valid(candidate)
        runtime_valid = not design_contract_validation.validate_design_contract(candidate)
        self.assertEqual(schema_valid, expected, list(self.validator.iter_errors(candidate)))
        self.assertEqual(
            runtime_valid,
            expected,
            design_contract_validation.validate_design_contract(candidate),
        )

    def assertResultParity(self, schema_id: str, candidate: dict, expected: bool) -> None:
        document = _valid_evidence("smoke" if schema_id.endswith("v1beta1") else None)
        document["mechanical_results"] = [candidate]
        validator = Draft202012Validator(self.visual_schemas[schema_id])
        schema_valid = validator.is_valid(document)
        try:
            evidence_contract._result(candidate)
            runtime_valid = True
        except evidence_contract.ContractError:
            runtime_valid = False
        self.assertEqual(schema_valid, expected, list(validator.iter_errors(document)))
        self.assertEqual(runtime_valid, expected)

    def assertFindingParity(self, candidate: dict, expected: bool) -> None:
        document = _valid_review()
        document["findings"] = [candidate]
        schema = self.visual_schemas["litfamily.review-receipt/v1alpha1"]
        validator = Draft202012Validator(schema)
        self.assertEqual(
            validator.is_valid(document),
            expected,
            list(validator.iter_errors(document)),
        )
        self.assertEqual(review_contract._finding(candidate), expected)

    def test_valid_beta_contract_is_accepted_in_both_directions(self):
        self.assertParity(_valid_beta_contract(), True)
        for schema_id in (
            "litfamily.evidence-manifest/v1alpha1",
            "litfamily.evidence-manifest/v1beta1",
        ):
            with self.subTest(schema_id=schema_id):
                self.assertResultParity(
                    schema_id,
                    {
                        "check_id": "dimensions",
                        "status": "PASS",
                        "evidence_pointer": "capture:apply-320",
                    },
                    True,
                )
        self.assertFindingParity(_valid_review()["findings"][0], True)

    def test_beta_text_boundary_agrees_at_512_and_513_characters(self):
        for length, expected in ((512, True), (513, False)):
            with self.subTest(length=length):
                candidate = _valid_beta_contract()
                candidate["tokens"][0]["value"] = "x" * length
                self.assertParity(candidate, expected)

    def test_whitespace_only_published_text_is_rejected_in_both_directions(self):
        candidate = _valid_beta_contract()
        candidate["tokens"][0]["value"] = " \t\n"
        self.assertParity(candidate, False)

        for schema_id in (
            "litfamily.evidence-manifest/v1alpha1",
            "litfamily.evidence-manifest/v1beta1",
        ):
            for field in ("check_id", "evidence_pointer"):
                with self.subTest(schema_id=schema_id, field=field):
                    result = {
                        "check_id": "dimensions",
                        "status": "PASS",
                        "evidence_pointer": "capture:apply-320",
                    }
                    result[field] = " \t\n"
                    self.assertResultParity(schema_id, result, False)

        for field in ("finding_id", "severity", "status", "evidence_pointer"):
            with self.subTest(schema_id="litfamily.review-receipt/v1alpha1", field=field):
                finding = _valid_review()["findings"][0]
                finding[field] = " \t\n"
                self.assertFindingParity(finding, False)

    def test_beta_base_objects_are_required_and_closed_in_both_directions(self):
        missing = _valid_beta_contract()
        del missing["intent"]["audiences"]
        self.assertParity(missing, False)

        extra = copy.deepcopy(_valid_beta_contract())
        extra["direction"]["unapproved"] = True
        self.assertParity(extra, False)

        valid_result = {
            "check_id": "dimensions",
            "status": "PASS",
            "evidence_pointer": "capture:apply-320",
        }
        beta_schema = "litfamily.evidence-manifest/v1beta1"
        for field in valid_result:
            with self.subTest(result_missing=field):
                missing_result = copy.deepcopy(valid_result)
                del missing_result[field]
                self.assertResultParity(beta_schema, missing_result, False)

        extra_result = copy.deepcopy(valid_result)
        extra_result["unapproved"] = True
        self.assertResultParity(beta_schema, extra_result, False)

        invalid_status = copy.deepcopy(valid_result)
        invalid_status["status"] = "UNKNOWN"
        self.assertResultParity(beta_schema, invalid_status, False)


if __name__ == "__main__":
    unittest.main()
