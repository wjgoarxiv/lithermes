"""Taste dials on litfamily.design-contract/v1beta2.

v1beta2 is v1beta1 plus one optional ``taste`` object, and nothing else. The
point of the additive rule is negative: a v1beta1 document must keep the meaning
it had before this file existed, and a v1beta2 document that omits taste must
still be complete. Both are asserted here rather than assumed.

A defect in a dial produces exactly one issue. A reviewer fixing a dial wants the
dial named, not every consequence of the same mistake listed back at them.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
DESIGN_ROOT = PLUGIN_ROOT / "skills" / "frontend-ui-ux"
sys.path.insert(0, str(DESIGN_ROOT / "scripts"))

import design_contract_validation as dcv


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


class DesignContractTaste(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.beta = _valid_beta_contract()

    def _beta2(self, taste=...) -> dict:
        contract = copy.deepcopy(self.beta)
        contract["schema_id"] = dcv.BETA2_SCHEMA_ID
        if taste is not ...:
            contract["taste"] = taste
        return contract

    @staticmethod
    def _taste_issues(issues) -> list:
        return [issue for issue in issues if "taste" in issue]

    def test_v1beta2_without_taste_is_complete_and_evidence_eligible(self) -> None:
        report = dcv.design_contract_report(self._beta2())
        self.assertEqual(report["issues"], [])
        self.assertTrue(report["valid"])
        self.assertTrue(report["evidence_eligible"])
        self.assertEqual(report["schema"], "litfamily.design-contract/v1beta2")
        self.assertEqual(report["diagnostics"], [])

    def test_dials_are_accepted_across_the_whole_range(self) -> None:
        for dials in (
            {"variance": 1, "motion": 1, "density": 1},
            {"variance": 10, "motion": 10, "density": 10},
            {"variance": 8, "motion": 6, "density": 3},
        ):
            with self.subTest(dials=dials):
                report = dcv.design_contract_report(self._beta2(dials))
                self.assertEqual(report["issues"], [])
                self.assertTrue(report["evidence_eligible"])

    def test_every_taste_defect_is_one_issue_naming_the_dial(self) -> None:
        cases = (
            ({"variance": 11, "motion": 5, "density": 5}, "taste.variance"),
            ({"variance": 0, "motion": 5, "density": 5}, "taste.variance"),
            ({"variance": 5.5, "motion": 5, "density": 5}, "taste.variance"),
            ({"variance": "8", "motion": 5, "density": 5}, "taste.variance"),
            ({"variance": True, "motion": 5, "density": 5}, "taste.variance"),
            ({"variance": 5, "motion": 5}, "density"),
            ({"variance": 5, "motion": 5, "density": 5, "rhythm": 5}, "rhythm"),
            ("bold", "taste"),
            ([], "taste"),
            (None, "taste"),
        )
        for taste, expected in cases:
            with self.subTest(taste=taste):
                report = dcv.design_contract_report(self._beta2(taste))
                named = self._taste_issues(report["issues"])
                self.assertFalse(report["valid"])
                self.assertEqual(len(named), 1, named)
                self.assertIn(expected, named[0])

    def test_v1beta1_keeps_the_meaning_it_had_before_taste_existed(self) -> None:
        untouched = dcv.design_contract_report(copy.deepcopy(self.beta))
        self.assertEqual(untouched["issues"], [])
        self.assertEqual(untouched["schema"], dcv.BETA_SCHEMA_ID)
        self.assertTrue(untouched["evidence_eligible"])

        smuggled = copy.deepcopy(self.beta)
        smuggled["taste"] = {"variance": 5, "motion": 5, "density": 5}
        report = dcv.design_contract_report(smuggled)
        self.assertFalse(report["valid"], "v1beta1 must not silently accept a v1beta2 key")
        self.assertIn("taste", "\n".join(report["issues"]))

    def test_v1alpha1_stays_migration_only(self) -> None:
        alpha = copy.deepcopy(self.beta)
        alpha["schema_id"] = dcv.SCHEMA_ID
        for field in ("lane", "tokens", "component_behaviors",
                      "responsive_transformations", "motion", "acceptance_criteria"):
            alpha.pop(field, None)
        report = dcv.design_contract_report(alpha)
        self.assertEqual(report["diagnostics"], ["LEGACY_SCHEMA_V1ALPHA1"])
        self.assertFalse(report["evidence_eligible"])

    def test_an_unknown_schema_id_is_refused_by_name(self) -> None:
        contract = self._beta2()
        contract["schema_id"] = "litfamily.design-contract/v1beta3"
        report = dcv.design_contract_report(contract)
        self.assertFalse(report["valid"])
        self.assertIn("v1beta2", "\n".join(report["issues"]))

    def test_schema_file_is_v1beta1_plus_one_optional_taste_object(self) -> None:
        schemas = DESIGN_ROOT / "schemas"
        beta1 = json.loads((schemas / "design-contract-v1beta1.schema.json").read_text("utf8"))
        beta2 = json.loads((schemas / "design-contract-v1beta2.schema.json").read_text("utf8"))
        self.assertEqual(beta2["$id"], "litfamily.design-contract/v1beta2")
        self.assertEqual(beta2["properties"]["schema_id"]["const"],
                         "litfamily.design-contract/v1beta2")
        self.assertIs(beta2["additionalProperties"], False)
        self.assertEqual(beta2["required"], beta1["required"],
                         "v1beta2 must require exactly what v1beta1 required")
        added = [key for key in beta2["properties"] if key not in beta1["properties"]]
        self.assertEqual(added, ["taste"], "taste is the only key v1beta2 adds")
        taste = beta2["$defs"]["taste"]
        self.assertIs(taste["additionalProperties"], False)
        self.assertEqual(taste["required"], ["variance", "motion", "density"])
        for dial in ("variance", "motion", "density"):
            self.assertEqual(
                {k: taste["properties"][dial][k] for k in ("type", "minimum", "maximum")},
                {"type": "integer", "minimum": 1, "maximum": 10},
            )


if __name__ == "__main__":
    unittest.main()
