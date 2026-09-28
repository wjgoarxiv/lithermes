"""Absence checks for the retired automatic skill review feature."""

from __future__ import annotations

import unittest
import importlib
import tempfile
from pathlib import Path

try:
    from .plugin_register_test_support import _ASSET_DIR, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


class SkillLoopRemoval(unittest.TestCase):
    def test_removed_runtime_and_skill_are_absent(self):
        asset_dir = Path(_ASSET_DIR)
        self.assertFalse((asset_dir / "skill_loop.py").exists())
        self.assertFalse((asset_dir / "skill_observer.py").exists())
        self.assertFalse((asset_dir / "skills" / "skill-observer").exists())

    def test_registration_and_routing_do_not_expose_removed_behavior(self):
        package = _load_plugin_package()
        self.assertFalse(hasattr(package, "skill_loop"))
        self.assertFalse(hasattr(package, "skill_observer"))
        self.assertNotIn("skill-observer", [name for name, _ in package.PORTED_SKILLS])
        routing = importlib.import_module(f"{package.__name__}.core_routing")
        route = routing.detect_lit_mode("skill-observer review")
        self.assertNotEqual(getattr(route, "mode", None), "skill-observer")

    def test_stale_review_state_is_inert_during_plugin_hooks(self):
        package = _load_plugin_package()
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            hermes_home = Path(root) / "hermes-home"
            stale = {
                workspace / ".litclaude" / "pending-review.json": b'{"status":"pending"}\n',
                workspace / ".hermes" / "lithermes" / "skill-loop-state.json": b'{"v":1}\n',
                workspace / ".hermes" / "lithermes" / "skill-observer" / "observations.jsonl": b'{"applied":false}\n',
                hermes_home / "lithermes" / "skill-loop-ledger.jsonl": b'{"schema":"legacy"}\n',
            }
            for path, data in stale.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            before = {path: path.read_bytes() for path in stale}

            package._pre_tool_call(
                workspace=str(workspace),
                hermes_home=str(hermes_home),
                tool_name="unrelated_read_only_tool",
                session_id="inert-state-session",
            )
            package._release_bounded_session(session_id="inert-state-session")

            self.assertEqual({path: path.read_bytes() for path in stale}, before)


if __name__ == "__main__":
    unittest.main()
