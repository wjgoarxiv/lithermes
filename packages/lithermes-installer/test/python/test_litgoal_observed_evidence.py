"""Observed-evidence gate: green proof must cite a terminal run the plugin itself saw.

The plugin records terminal runs from ``post_tool_call`` (signed in memory), a
``green`` evidence item is verified only when it cites ``run:<id>`` of a recorded
exit-0 run, and a reply that claims completion while the gate is closed gets a
visible ``not done`` line appended. Everything runs in a throwaway workspace.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from importlib import import_module
from pathlib import Path

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package

SESSION = "s1"


class ObservedEvidenceCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.runtime = import_module("lithermes_plugin_pkg.litgoal.runtime")
        cls.store = import_module("lithermes_plugin_pkg.litgoal.store")
        cls.tools = import_module("lithermes_plugin_pkg.litgoal.tools")
        cls.hook = import_module("lithermes_plugin_pkg.litgoal.hook")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev = os.getcwd()
        os.chdir(self._tmp.name)
        self.ws = Path.cwd()
        self.runs = import_module("lithermes_plugin_pkg.litgoal.runs")
        self._key = self.runs._KEY

    def tearDown(self):
        self.runs._KEY = self._key
        os.chdir(self._prev)
        self._tmp.cleanup()

    def terminal(self, command, exit_code, *, session_id=SESSION, tool_name="terminal"):
        """Drive the real post_tool_call hook the way Hermes does; return the new run id."""
        before = len(self.runs.recent_runs(self.ws, session_id, limit=500))
        result = json.dumps({"output": "…", "exit_code": exit_code, "error": None})
        out = self.pkg._post_tool_call(
            tool_name=tool_name,
            args={"command": command},
            result=result,
            session_id=session_id,
            task_id="t1",
            tool_call_id="call-1",
            status="ok",
            duration_ms=5,
        )
        self.assertIsNone(out, "post_tool_call must stay observational")
        runs = self.runs.recent_runs(self.ws, session_id, limit=500)
        return runs[-1]["id"] if len(runs) > before else None

    def goal(self, session_id=SESSION):
        self.runtime.create_goal(
            self.ws, "ship it", criteria=[{"scenario": "it works"}], session_id=session_id
        )

    def green(self, ref, session_id=SESSION):
        return self.runtime.add_evidence(self.ws, "C001", "green", ref, session_id=session_id)

    def scenario_and_pass(self, session_id=SESSION):
        self.runtime.add_evidence(self.ws, "C001", "scenario", "evidence/qa.txt", session_id=session_id)
        self.runtime.set_criterion_status(self.ws, "C001", "pass", session_id=session_id)

    def gate(self, session_id=SESSION):
        return self.runtime.quality_gate(self.ws, session_id=session_id)


class RunRecording(ObservedEvidenceCase):
    def test_terminal_run_is_recorded_with_hash_exit_code_and_preview(self):
        command = "pytest -q tests/test_app.py"
        run_id = self.terminal(command, 0)
        self.assertEqual(run_id, "R001")
        (record,) = self.runs.recent_runs(self.ws, SESSION)
        self.assertEqual(record["tool"], "terminal")
        self.assertEqual(record["exit_code"], 0)
        self.assertEqual(record["cmd_sha256"], hashlib.sha256(command.encode("utf-8")).hexdigest())
        self.assertEqual(record["cmd_preview"], command)
        self.assertTrue(record["at"])
        self.assertTrue(
            (self.store.state_dir(self.ws, SESSION) / "runs.jsonl").is_file(),
            "runs live in the session litgoal dir",
        )

    def test_run_ids_increase_and_failures_are_recorded_too(self):
        self.assertEqual(self.terminal("pytest", 1), "R001")
        self.assertEqual(self.terminal("pytest", 0), "R002")
        codes = [r["exit_code"] for r in self.runs.recent_runs(self.ws, SESSION)]
        self.assertEqual(codes, [1, 0])

    def test_only_terminal_type_tools_are_recorded(self):
        for tool in ("read_file", "write_file", "browser_click", "delegate_task"):
            with self.subTest(tool=tool):
                self.assertIsNone(self.terminal("pytest", 0, tool_name=tool))
        self.assertEqual(self.runs.recent_runs(self.ws, SESSION), [])

    def test_a_run_with_no_exit_status_is_not_recorded(self):
        out = self.pkg._post_tool_call(
            tool_name="terminal",
            args={"command": "pytest"},
            result=json.dumps({"output": "", "exit_code": None, "error": None,
                               "status": "yielded_to_background"}),
            session_id=SESSION,
            status="ok",
        )
        self.assertIsNone(out)
        self.assertEqual(self.runs.recent_runs(self.ws, SESSION), [])

    def test_hostile_or_malformed_observations_never_raise(self):
        for result in ("not json", None, 7, "[]", json.dumps({"exit_code": "0"}),
                       json.dumps({"exit_code": True})):
            with self.subTest(result=result):
                self.assertIsNone(self.pkg._post_tool_call(
                    tool_name="terminal", args={"command": "x"}, result=result,
                    session_id=SESSION, status="ok"))
        self.assertIsNone(self.pkg._post_tool_call(
            tool_name="terminal", args=None, result='{"exit_code": 0}', session_id="bad/id",
            status="ok"))
        self.assertEqual(self.runs.recent_runs(self.ws, SESSION), [])

    def test_the_command_preview_is_redacted_and_bounded(self):
        self.terminal("curl -H 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789' " + "x" * 400, 0)
        (record,) = self.runs.recent_runs(self.ws, SESSION)
        self.assertNotIn("sk-abcdefghijklmnopqrstuvwxyz0123456789", record["cmd_preview"])
        self.assertLessEqual(len(record["cmd_preview"]), 120)


class ObservedGreenEvidence(ObservedEvidenceCase):
    def test_claimed_green_is_stored_unverified_and_leaves_the_gate_closed(self):
        self.goal()
        ev = self.green("tests/test_app.py::test_ok")
        self.assertFalse(ev.verified)
        self.scenario_and_pass()
        gate = self.gate()
        self.assertFalse(gate["passed"])
        self.assertIn(
            "C001 green evidence is claimed, not observed (cite run:<id> from a passing test run)",
            gate["reasons"],
        )
        self.assertFalse(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])

    def test_an_observed_exit_zero_run_opens_the_gate(self):
        self.goal()
        run_id = self.terminal("pytest -q", 0)
        ev = self.green(f"run:{run_id}")
        self.assertTrue(ev.verified)
        self.scenario_and_pass()
        gate = self.gate()
        self.assertTrue(gate["passed"], gate["reasons"])
        self.assertTrue(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])

    def test_an_exit_one_run_does_not_open_the_gate(self):
        self.goal()
        run_id = self.terminal("pytest -q", 1)
        self.assertFalse(self.green(f"run:{run_id}").verified)
        self.scenario_and_pass()
        self.assertFalse(self.gate()["passed"])

    def test_an_unknown_run_id_is_claimed(self):
        self.goal()
        self.assertFalse(self.green("run:R042").verified)
        self.assertFalse(self.green("run:").verified)

    def test_a_forged_record_is_rejected(self):
        self.goal()
        runs_file = self.store.state_dir(self.ws, SESSION) / "runs.jsonl"
        runs_file.parent.mkdir(parents=True, exist_ok=True)
        forged = {"id": "R001", "tool": "terminal", "cmd_sha256": "0" * 64,
                  "cmd_preview": "pytest -q", "exit_code": 0, "at": "2026-11-09T00:00:00+00:00",
                  "sig": "0" * 64}
        runs_file.write_text(json.dumps(forged) + "\n", encoding="utf-8")
        self.assertFalse(self.green("run:R001").verified)
        self.scenario_and_pass()
        self.assertFalse(self.gate()["passed"])

    def test_a_record_with_an_edited_exit_code_is_rejected(self):
        self.goal()
        run_id = self.terminal("pytest -q", 1)
        runs_file = self.store.state_dir(self.ws, SESSION) / "runs.jsonl"
        record = json.loads(runs_file.read_text(encoding="utf-8").splitlines()[0])
        record["exit_code"] = 0
        runs_file.write_text(json.dumps(record) + "\n", encoding="utf-8")
        self.assertFalse(self.green(f"run:{run_id}").verified)

    def test_a_record_from_a_previous_process_key_is_rejected(self):
        self.goal()
        run_id = self.terminal("pytest -q", 0)
        self.runs._KEY = b"another-process-key-0123456789ab"
        self.assertFalse(self.green(f"run:{run_id}").verified)

    def test_a_verified_green_stops_counting_once_the_key_changes(self):
        self.goal()
        run_id = self.terminal("pytest -q", 0)
        self.assertTrue(self.green(f"run:{run_id}").verified)
        self.scenario_and_pass()
        self.assertTrue(self.gate()["passed"])
        self.runs._KEY = b"another-process-key-0123456789ab"
        gate = self.gate()
        self.assertFalse(gate["passed"])
        self.assertTrue(
            any("re-run the tests in this session" in reason for reason in gate["reasons"]),
            gate["reasons"],
        )

    def test_hand_editing_the_verified_flag_does_not_open_the_gate(self):
        self.goal()
        self.green("tests/test_app.py::test_ok")
        self.scenario_and_pass()
        goals = self.store.goals_path(self.ws, SESSION)
        data = json.loads(goals.read_text(encoding="utf-8"))
        for crit in data["goals"][0]["criteria"]:
            for ev in crit["evidence"]:
                ev["verified"] = True
        goals.write_text(json.dumps(data), encoding="utf-8")
        self.assertFalse(self.gate()["passed"])

    def test_a_record_copied_from_another_session_is_rejected(self):
        self.goal()
        other = self.terminal("pytest -q", 0, session_id="other")
        source = self.store.state_dir(self.ws, "other") / "runs.jsonl"
        target = self.store.state_dir(self.ws, SESSION) / "runs.jsonl"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        self.assertFalse(self.green(f"run:{other}").verified)

    def test_other_evidence_kinds_are_unchanged(self):
        self.goal()
        for kind in ("red", "scenario", "cleanup", "note"):
            with self.subTest(kind=kind):
                ev = self.runtime.add_evidence(self.ws, "C001", kind, "anything", session_id=SESSION)
                self.assertEqual(ev.kind, kind)
                self.assertFalse(ev.verified)

    def test_the_verified_flag_round_trips_through_the_store(self):
        self.goal()
        run_id = self.terminal("pytest -q", 0)
        self.green(f"run:{run_id}")
        crit = self.runtime.get_active(self.ws, SESSION).criteria[0]
        self.assertTrue(crit.evidence[0].verified)

    def test_the_goal_evidence_tool_verifies_a_cited_run(self):
        self.goal()
        run_id = self.terminal("pytest -q", 0)
        self.tools.tool_goal_evidence(
            {"criterion_id": "C001", "kind": "green", "ref": f"run:{run_id}"}, session_id=SESSION
        )
        self.assertTrue(self.runtime.get_active(self.ws, SESSION).criteria[0].evidence[0].verified)

    def test_the_snapshot_lists_citable_runs_and_asks_for_run_ids(self):
        self.goal()
        run_id = self.terminal("pytest -q tests/", 0)
        self.terminal("pytest -q tests/broken", 1)
        ctx = self.hook.snapshot_context(user_message="hi", session_id=SESSION)
        self.assertIn(f"run:{run_id}", ctx)
        self.assertIn("pytest -q tests/", ctx)
        self.assertIn("exit 0", ctx)
        self.assertIn("exit 1", ctx)
        self.assertIn("run:<id>", ctx)

    def test_the_snapshot_flags_claimed_green_as_still_missing(self):
        self.goal()
        self.green("tests/test_app.py::test_ok")
        ctx = self.hook.snapshot_context(user_message="hi", session_id=SESSION)
        self.assertIn("missing: green", ctx)


class CompletionMark(ObservedEvidenceCase):
    def reply(self, text, session_id=SESSION):
        return self.pkg._transform_llm_output(response_text=text, session_id=session_id)

    def test_english_completion_claims_get_the_mark_appended(self):
        self.goal()
        for text in ("All done!", "I have completed the task.", "Finished.",
                     "All tests pass now.", "This is ready to ship."):
            with self.subTest(text=text):
                out = self.reply(text)
                self.assertTrue(out.startswith(text), "the reply must never be rewritten")
                self.assertIn("⛔ LIT: not done — ", out)

    def test_korean_completion_claims_get_the_mark_appended(self):
        self.goal()
        for text in ("작업을 완료했습니다.", "다 했어요!", "이제 끝났어요.", "모두 마쳤습니다."):
            with self.subTest(text=text):
                out = self.reply(text)
                self.assertTrue(out.startswith(text))
                self.assertIn("⛔ LIT: not done — ", out)

    def test_the_mark_carries_the_first_two_gate_reasons_only(self):
        self.goal()
        reasons = self.gate()["reasons"]
        self.assertGreater(len(reasons), 2)
        out = self.reply("Done.")
        mark = out.split("⛔ LIT: not done — ", 1)[1]
        self.assertIn(reasons[0], mark)
        self.assertIn(reasons[1], mark)
        self.assertNotIn(reasons[2], mark)

    def test_claimed_green_still_earns_the_mark(self):
        self.goal()
        self.green("tests::x")
        self.scenario_and_pass()
        out = self.reply("Everything is finished.")
        self.assertIn("claimed, not observed", out)

    def test_no_mark_without_an_active_goal(self):
        self.assertIsNone(self.reply("All done!"))

    def test_no_mark_for_another_session_without_a_goal(self):
        self.goal()
        self.assertIsNone(self.reply("All done!", session_id="elsewhere"))

    def test_no_mark_once_the_gate_is_open(self):
        self.goal()
        self.green(f"run:{self.terminal('pytest -q', 0)}")
        self.scenario_and_pass()
        self.assertIsNone(self.reply("All done!"))

    def test_no_mark_when_the_reply_claims_nothing(self):
        self.goal()
        for text in ("Working on it.", "I will run the tests next.", "this is not done yet",
                     "아직 완료되지 않았어요.", "미완료 상태입니다."):
            with self.subTest(text=text):
                self.assertIsNone(self.reply(text))

    def test_the_mark_is_not_duplicated(self):
        self.goal()
        first = self.reply("Done.")
        self.assertIsNone(self.reply(first))

    def test_a_complete_goal_is_not_marked(self):
        self.goal()
        self.green(f"run:{self.terminal('pytest -q', 0)}")
        self.scenario_and_pass()
        self.assertTrue(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])
        self.assertIsNone(self.reply("All done!"))


class GoalCompleteWithoutAGoal(ObservedEvidenceCase):
    def test_the_runtime_refuses_instead_of_raising(self):
        self.assertEqual(
            self.runtime.complete_goal(self.ws, session_id=SESSION),
            {"completed": False, "reasons": ["no active litgoal"]},
        )

    def test_the_model_facing_tool_refuses_instead_of_raising(self):
        out = json.loads(self.tools.tool_goal_complete({}, session_id=SESSION))
        self.assertEqual(out, {"completed": False, "reasons": ["no active litgoal"]})

    def test_other_mutators_still_raise_without_a_goal(self):
        with self.assertRaises(ValueError):
            self.runtime.add_criterion(self.ws, "x", session_id=SESSION)


if __name__ == "__main__":
    unittest.main()
