"""The pre_verify hook holds a finish while the litgoal gate is closed.

Hermes (0.18 and later, so inside this plugin's 0.21.3 floor) asks every pre_verify hook once
the agent has edited code and is about to deliver its answer. A dict with action "continue"
and a non-empty message keeps the turn going, bounded by the host's agent.max_verify_nudges.
The hook speaks only for a session whose goal gate is closed and whose draft answer claims
completion; every other case returns None and the answer goes out untouched.
"""

from __future__ import annotations

import unittest

try:
    from .plugin_register_test_support import _FakeCtx
    from .test_litgoal_stale_and_testguard import SESSION, Base
except ImportError:
    from plugin_register_test_support import _FakeCtx
    from test_litgoal_stale_and_testguard import SESSION, Base


class PreVerify(Base):
    def verify(self, text="All done, the tests pass.", **extra):
        return self.pkg._pre_verify(
            session_id=SESSION, platform="cli", model="m", coding=True, attempt=0,
            final_response=text, changed_paths=["export.py"], **extra,
        )

    def open_goal(self):
        self.write("export.py", "rows = ['a']\n")
        self.goal()

    def assert_host_accepts(self, result):
        """The two fields Hermes' get_pre_verify_continue_message reads."""
        self.assertIsInstance(result, dict)
        self.assertEqual(result["action"], "continue")
        self.assertIsInstance(result["message"], str)
        self.assertTrue(result["message"].strip())

    def test_registered_for_the_host_to_call(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertIn("pre_verify", ctx.hooks)

    def test_a_closed_gate_and_a_completion_claim_hold_the_finish_with_the_reasons(self):
        self.open_goal()
        result = self.verify()
        self.assert_host_accepts(result)
        reasons = self.gate()["reasons"]
        self.assertTrue(reasons)
        self.assertIn(reasons[0], result["message"])

    def test_the_message_is_bounded(self):
        self.open_goal()
        self.assertLessEqual(len(self.verify()["message"].encode("utf-8")), 1200)

    def test_an_open_gate_lets_the_finish_through(self):
        self.open_goal()
        self.green(self.terminal("pytest -q"))
        self.finish_criterion()
        self.assertTrue(self.gate()["passed"], self.gate()["reasons"])
        self.assertIsNone(self.verify())

    def test_a_goal_this_install_completed_lets_the_finish_through(self):
        self.open_goal()
        self.green(self.terminal("pytest -q"))
        self.finish_criterion()
        self.assertTrue(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])
        self.assertIsNone(self.verify())

    def test_a_session_without_a_goal_is_left_alone(self):
        self.assertIsNone(self.verify())

    def test_a_draft_that_does_not_claim_completion_is_left_alone(self):
        self.open_goal()
        for text in ("Which of the two exports should I keep?", "This is not fixed yet.", "고쳐 볼게요."):
            with self.subTest(text=text):
                self.assertIsNone(self.verify(text))

    def test_a_delegate_child_is_left_alone(self):
        self.open_goal()
        self.assertIsNone(self.pkg._pre_verify(
            session_id=SESSION, platform="subagent", final_response="All done.", changed_paths=["a.py"],
        ))

    def test_a_garbled_goal_file_never_raises(self):
        path = self.store.goals_path(self.ws, SESSION)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.verify())

    def test_missing_arguments_never_raise(self):
        self.assertIsNone(self.pkg._pre_verify())
        self.assertIsNone(self.pkg._pre_verify(session_id=None, final_response=None))


if __name__ == "__main__":
    unittest.main()
