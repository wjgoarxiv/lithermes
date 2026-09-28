"""Native Hermes goals stay user-managed; package routes never mutate GoalManager."""

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import core  # noqa: E402


class _FakeGoalManager:
    set_calls: list[tuple[str, str]] = []

    def __init__(self, session_id):
        self.session_id = session_id

    def is_active(self):
        return False

    def set(self, goal, max_turns=None):
        self.set_calls.append((self.session_id, goal))


def _install_fake_goals():
    goals_mod = types.ModuleType("hermes_cli.goals")
    goals_mod.GoalManager = _FakeGoalManager
    pkg = types.ModuleType("hermes_cli")
    pkg.goals = goals_mod
    sys.modules["hermes_cli"] = pkg
    sys.modules["hermes_cli.goals"] = goals_mod


class NativeGoalUserManaged(unittest.TestCase):
    def setUp(self):
        _FakeGoalManager.set_calls = []
        _install_fake_goals()

    def tearDown(self):
        sys.modules.pop("hermes_cli.goals", None)
        sys.modules.pop("hermes_cli", None)

    def _fire(self, message: str) -> None:
        core.pre_llm_call(session_id="surface-session", user_message=message, platform="cli")

    def test_native_goal_mutation_helper_is_not_exposed(self):
        self.assertFalse(hasattr(core, "bind_native_goal"))

    def test_pre_llm_call_routes_make_zero_goal_manager_set_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            direct_messages = [
                "lit build the widget",
                "lit plan build the widget",
                "/lit build the widget",
                "/lit-loop build the widget",
                "/lit-plan build the widget",
            ]
            for message in direct_messages:
                previous = os.getcwd()
                os.chdir(workspace)
                try:
                    self._fire(message)
                finally:
                    os.chdir(previous)

            command_messages = [
                core.command_lit(f"build the widget --worktree {workspace}")["agent_message"],
                core.command_lit_loop(f"build the widget --worktree {workspace}")["agent_message"],
                core.command_lit_plan(f"build the widget --worktree {workspace}")["agent_message"],
                core.command_litgoal(f"build the widget --worktree {workspace}")["agent_message"],
            ]
            for message in command_messages:
                self._fire(message)

        self.assertEqual(_FakeGoalManager.set_calls, [])

    def test_bind_marker_and_run_context_remain_non_mutating_route_envelopes(self):
        marker = core.bind_goal_marker("ship the parity feature")
        self.assertEqual(core._extract_bind_goal(marker), "ship the parity feature")
        self.assertIsNone(self._fire(marker))

        run_context = "\n".join([
            "do the migration",
            "<lithermes-run-context>",
            "run_id: x",
            "task: do the migration",
            "</lithermes-run-context>",
        ])
        self.assertIsNone(self._fire(run_context))
        self.assertEqual(_FakeGoalManager.set_calls, [])


class NoPhantomTools(unittest.TestCase):
    def test_goal_instruction_does_not_command_phantom_tools(self):
        msg = core.build_goal_instruction("ship it", workspace=Path("/tmp/ws"))
        self.assertIn("goal_set", msg)
        for phantom in ["call get_goal", "call create_goal", "call update_goal", "create_goal payload"]:
            self.assertNotIn(phantom, msg, f"phantom tool directive still present: {phantom}")


if __name__ == "__main__":
    unittest.main()
