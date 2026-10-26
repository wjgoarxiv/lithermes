"""Additive diagram craft signals use the product's parsed SVG records."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2] / "assets/lithermes-plugin/skills/lit-diagram-drawer"
sys.path.insert(0, str(SKILL / "scripts"))
from diagram_quality import quality_issues


class DiagramCraftChecks(unittest.TestCase):
    def test_group_ratio_accents_case_and_label_fit(self):
        source = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" role="img" aria-labelledby="t d">
          <title id="t">Sample flow</title><desc id="d">Four nodes in two groups</desc>
          <rect data-boundary="A" data-group-id="A" x="0" y="0" width="170" height="170" fill="none"/>
          <rect data-boundary="B" data-group-id="B" x="175" y="0" width="170" height="170" fill="none"/>
          <rect data-node-id="a" x="20" y="25" width="40" height="35" fill="#dd4433"/>
          <rect data-node-id="b" x="100" y="25" width="40" height="35" fill="#22aa44"/>
          <rect data-node-id="c" x="175" y="25" width="40" height="35" fill="#3355dd"/>
          <rect data-node-id="d" x="260" y="25" width="40" height="35" fill="#ddaa22"/>
          <rect data-node-id="e" x="20" y="110" width="40" height="35" fill="#aa33cc"/>
          <rect data-node-id="f" x="100" y="110" width="40" height="35" fill="#22aaaa"/>
          <text data-role="node" x="22" y="48" font-size="16">Review Of System</text>
        </svg>'''
        issues = quality_issues(source)
        for code in ("OF-201", "OF-202", "OF-203", "OF-204"):
            with self.subTest(code=code):
                self.assertTrue(any(issue.startswith(code) for issue in issues), issues)

    def test_three_to_five_accent_families_pass_and_six_fail(self):
        def nodes(fills):
            rects = "".join(
                f'<rect data-node-id="n{index}" x="{20 + 50 * index}" y="25" width="40" height="35" fill="{fill}"/>'
                for index, fill in enumerate(fills)
            )
            return (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" role="img" aria-labelledby="t d">'
                '<title id="t">Roles</title><desc id="d">Role colours</desc>' + rects + "</svg>"
            )

        families = ["#dd4433", "#22aa44", "#3355dd", "#ddaa22", "#aa33cc", "#22aaaa"]
        for count in (3, 4, 5):
            with self.subTest(count=count):
                issues = quality_issues(nodes(families[:count]))
                self.assertFalse(any(issue.startswith("OF-202") for issue in issues), issues)
        issues = quality_issues(nodes(families))
        self.assertTrue(any(issue.startswith("OF-202") for issue in issues), issues)

    def test_flat_single_accent_diagram_does_not_gain_group_or_accent_issue(self):
        source = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" role="img" aria-labelledby="t d">
          <title id="t">Simple</title><desc id="d">One node</desc>
          <rect data-node-id="one" x="20" y="20" width="130" height="55" fill="#226688"/>
          <text data-role="node" x="30" y="55" font-size="16">One node</text>
        </svg>'''
        issues = quality_issues(source)
        self.assertFalse(any(issue.startswith(("OF-201", "OF-202", "OF-204")) for issue in issues), issues)


if __name__ == "__main__":
    unittest.main()
