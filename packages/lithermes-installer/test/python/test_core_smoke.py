"""Smoke tests for the LitHermes Hermes plugin Python runtime.

Kept OUTSIDE the shipped asset tree (assets/lithermes-plugin) so test files
never enter the npm package or the installed plugin payload. The plugin source
is imported by inserting the asset dir on sys.path.
"""

import os
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(
    os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin")
)
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import core  # noqa: E402


class CoreImportSmoke(unittest.TestCase):
    def test_core_imports(self):
        self.assertTrue(hasattr(core, "slugify"))

    def test_litgoal_state_dirname_constant(self):
        # W1 litgoal durable runtime persists under this dir name inside
        # .hermes/lithermes/. The constant anchors all litgoal state paths.
        self.assertTrue(
            hasattr(core, "LITGOAL_STATE_DIRNAME"),
            "core.LITGOAL_STATE_DIRNAME must exist (anchors litgoal state paths)",
        )
        self.assertEqual(core.LITGOAL_STATE_DIRNAME, "litgoal")


if __name__ == "__main__":
    unittest.main()
