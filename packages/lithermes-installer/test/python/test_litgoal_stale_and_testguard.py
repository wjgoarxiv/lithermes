"""Stale evidence (run fingerprints), the test-weakening guard, and the gate snapshot file.

Three behaviours share one fixture style: a throwaway workspace, the real
``post_tool_call`` hook recording terminal runs, and the real runtime gate.

* N1 - a verified green stops counting once the workspace changed after its run.
* N2 - a test file that lost tests/asserts or gained skips since the goal started
  raises a review blocker only the user's slash command can clear.
* ``gate.json`` - every gate evaluation leaves a small read-only snapshot for the
  dashboard; the real gate stays in-process.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from datetime import datetime
from importlib import import_module
from pathlib import Path
from unittest import mock

try:
    from .plugin_register_test_support import _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _FakeCtx, _load_plugin_package

SESSION = "s1"
GIT = shutil.which("git")

GOOD_TESTS = (
    "from export import rows\n\n"
    "def test_last_row_is_kept():\n"
    "    assert len(rows()) == 3\n"
    "    assert rows()[-1] == 'c'\n\n"
    "def test_refund_cent():\n"
    "    assert total() == 100\n"
)


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.runtime = import_module("lithermes_plugin_pkg.litgoal.runtime")
        cls.store = import_module("lithermes_plugin_pkg.litgoal.store")
        cls.tools = import_module("lithermes_plugin_pkg.litgoal.tools")
        cls.hook = import_module("lithermes_plugin_pkg.litgoal.hook")
        cls.runs = import_module("lithermes_plugin_pkg.litgoal.runs")
        cls.fingerprint = import_module("lithermes_plugin_pkg.litgoal.fingerprint")
        cls.testguard = import_module("lithermes_plugin_pkg.litgoal.testguard")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev = os.getcwd()
        self.ws = Path(self._tmp.name).resolve()
        os.chdir(self.ws)
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        os.chdir(self._prev)
        self._tmp.cleanup()

    def write(self, rel, text):
        path = self.ws / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def terminal(self, command="pytest -q", exit_code=0, session_id=SESSION):
        before = len(self.runs.recent_runs(self.ws, session_id, limit=500))
        self.pkg._post_tool_call(
            tool_name="terminal",
            args={"command": command},
            result=json.dumps({"output": "...", "exit_code": exit_code}),
            session_id=session_id,
            task_id="t1",
        )
        runs = self.runs.recent_runs(self.ws, session_id, limit=500)
        return runs[-1]["id"] if len(runs) > before else None

    def goal(self, session_id=SESSION):
        self.tools.tool_goal_set(
            {"objective": "fix the export", "criteria": [{"scenario": "export keeps every row"}]},
            session_id=session_id,
        )

    def green(self, run_id, session_id=SESSION):
        return self.runtime.add_evidence(self.ws, "C001", "green", f"run:{run_id}", session_id=session_id)

    def finish_criterion(self, session_id=SESSION):
        self.runtime.add_evidence(self.ws, "C001", "scenario", "qa.txt", session_id=session_id)
        self.runtime.set_criterion_status(self.ws, "C001", "pass", session_id=session_id)

    def gate(self, session_id=SESSION):
        return self.runtime.quality_gate(self.ws, session_id=session_id, persist=True)

    def state_file(self, name, session_id=SESSION):
        return self.store.state_dir(self.ws, session_id) / name

    def blockers(self, session_id=SESSION):
        return self.runtime.get_active(self.ws, session_id).review_blockers


@unittest.skipUnless(GIT, "git is required")
class GitStaleEvidence(Base):
    def setUp(self):
        super().setUp()
        self.git("init", "-q")
        self.write("export.py", "def rows():\n    return ['a', 'b']\n")
        self.write("tests/test_export.py", GOOD_TESTS)
        self.git("add", "-A")
        self.git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")
        self.goal()

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.ws, check=True, capture_output=True)

    def green_pass(self):
        run_id = self.terminal("pytest -q")
        self.green(run_id)
        self.finish_criterion()
        return run_id

    def test_an_unchanged_workspace_keeps_the_green_verified(self):
        self.green_pass()
        gate = self.gate()
        self.assertTrue(gate["passed"], gate["reasons"])

    def test_the_run_record_carries_a_git_fingerprint(self):
        self.terminal("pytest -q")
        (record,) = self.runs.recent_runs(self.ws, SESSION)
        self.assertEqual(record["fp"]["kind"], "git")
        self.assertTrue(record["fp"]["digest"])

    def test_an_edit_after_the_run_makes_the_evidence_stale_and_names_the_file(self):
        run_id = self.green_pass()
        self.write("export.py", "def rows():\n    return ['a', 'b', 'c']\n")
        gate = self.gate()
        self.assertFalse(gate["passed"])
        self.assertEqual(
            gate["reasons"][0],
            f"C001 evidence {run_id} is stale: export.py changed after the run (re-run the tests)",
        )
        self.assertFalse(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])

    def test_a_second_edit_to_an_already_dirty_file_is_still_noticed(self):
        self.write("export.py", "def rows():\n    return ['a']\n")
        self.green_pass()
        self.assertTrue(self.gate()["passed"])
        self.write("export.py", "def rows():\n    return ['a', 'b', 'c']\n")
        self.assertIn("export.py changed after the run", self.gate()["reasons"][0])

    def test_a_new_untracked_file_after_the_run_is_stale(self):
        self.green_pass()
        self.write("extra.py", "x = 1\n")
        self.assertIn("extra.py changed after the run", self.gate()["reasons"][0])

    def test_more_than_three_changed_files_are_summarised(self):
        self.green_pass()
        for name in "abcde":
            self.write(f"{name}.txt", name)
        reason = self.gate()["reasons"][0]
        self.assertIn("a.txt, b.txt, c.txt and 2 more changed after the run", reason)

    def test_litgoal_own_state_writes_do_not_make_the_run_stale(self):
        self.green_pass()
        self.runtime.record_checkpoint(self.ws, "progress", session_id=SESSION)
        self.gate()
        self.assertTrue(self.gate()["passed"])

    def test_rerunning_the_tests_and_citing_the_new_run_reopens_the_gate(self):
        self.green_pass()
        self.write("export.py", "def rows():\n    return ['a', 'b', 'c']\n")
        self.assertFalse(self.gate()["passed"])
        second = self.terminal("pytest -q")
        self.green(second)
        self.assertTrue(self.gate()["passed"], self.gate()["reasons"])

    def test_the_fingerprint_is_part_of_the_signature(self):
        self.green_pass()
        path = self.state_file("runs.jsonl")
        record = json.loads(path.read_text().splitlines()[0])
        record["fp"]["digest"] = "0" * 64
        path.write_text(json.dumps(record) + "\n")
        reasons = self.gate()["reasons"]
        self.assertTrue(any("cannot verify as passing" in r for r in reasons), reasons)

    def test_git_runs_with_a_scrubbed_environment_and_a_short_timeout(self):
        seen = []
        real = subprocess.run

        def spy(cmd, *args, **kwargs):
            if cmd and cmd[0] == "git":
                seen.append(kwargs)
            return real(cmd, *args, **kwargs)

        planted = {"OPENAI_API_KEY": "sk-secret", "XAI_API_KEY": "x", "GIT_DIR": "/nope", "GIT_SSH_COMMAND": "boom"}
        with mock.patch.dict(os.environ, planted), mock.patch("subprocess.run", spy):
            self.fingerprint.capture(self.ws)
        self.assertTrue(seen)
        for kwargs in seen:
            self.assertLessEqual(set(kwargs["env"]), {"PATH", "HOME", "LANG", "LC_ALL"})
            self.assertTrue(0 < kwargs["timeout"] <= 2.0)

    def test_a_git_timeout_stores_no_fingerprint_and_the_green_is_stale(self):
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 2)):
            run_id = self.terminal("pytest -q")
        (record,) = self.runs.recent_runs(self.ws, SESSION)
        self.assertIsNone(record["fp"])
        self.green(run_id)
        self.finish_criterion()
        self.assertEqual(
            self.gate()["reasons"][0],
            f"C001 evidence {run_id} is stale: the workspace changed after the run (re-run the tests)",
        )


class NonGitFallback(Base):
    def setUp(self):
        super().setUp()
        self.write("export.py", "rows = ['a']\n")
        self.goal()

    def green_pass(self):
        run_id = self.terminal("pytest -q")
        self.green(run_id)
        self.finish_criterion()
        return run_id

    def test_a_plain_directory_uses_a_content_fingerprint(self):
        self.terminal("pytest -q")
        (record,) = self.runs.recent_runs(self.ws, SESSION)
        self.assertEqual(record["fp"]["kind"], "files")

    def test_an_edit_is_stale_with_the_generic_reason(self):
        run_id = self.green_pass()
        self.assertTrue(self.gate()["passed"])
        time.sleep(0.01)
        self.write("export.py", "rows = ['a', 'b']\n")
        self.assertEqual(
            self.gate()["reasons"][0],
            f"C001 evidence {run_id} is stale: the workspace changed after the run (re-run the tests)",
        )

    def test_vendor_and_cache_directories_are_ignored(self):
        self.green_pass()
        for rel in ("node_modules/x.js", ".venv/lib.py", "__pycache__/m.pyc", ".git/HEAD"):
            self.write(rel, "changed")
        self.assertTrue(self.gate()["passed"], self.gate()["reasons"])

    def test_the_walk_is_capped(self):
        for index in range(30):
            self.write(f"bulk/f{index:02d}.txt", "x")
        with mock.patch.object(self.fingerprint, "MAX_FILES", 10):
            fp = self.fingerprint.capture(self.ws)
        self.assertEqual(fp["kind"], "files")
        self.assertLessEqual(fp["count"], 10)

    def test_a_null_run_fingerprint_is_treated_as_stale(self):
        with mock.patch.object(self.fingerprint, "capture", return_value=None):
            run_id = self.terminal("pytest -q")
        self.green(run_id)
        self.finish_criterion()
        self.assertEqual(
            self.gate()["reasons"][0],
            f"C001 evidence {run_id} is stale: the workspace changed after the run (re-run the tests)",
        )


class NoGoalRun(Base):
    def test_a_terminal_run_without_a_goal_session_stores_a_null_fingerprint(self):
        run_id = self.terminal("pytest -q", session_id="nogoal")
        self.assertEqual(run_id, "R001")
        (record,) = self.runs.recent_runs(self.ws, "nogoal")
        self.assertIsNone(record["fp"])


class TestguardCase(Base):
    def setUp(self):
        super().setUp()
        self.write("tests/test_export.py", GOOD_TESTS)
        self.goal()

    def open_testguard(self):
        return [b for b in self.blockers() if b.source == "testguard" and not b.resolved]

    def test_goal_set_snapshots_the_test_files(self):
        data = json.loads(self.state_file("testguard.json").read_text())
        (baseline,) = data.values()
        entry = baseline["files"]["tests/test_export.py"]
        self.assertEqual((entry["tests"], entry["asserts"], entry["skips"]), (2, 3, 0))

    def test_unchanged_tests_raise_nothing(self):
        self.assertFalse(self.open_testguard())
        self.assertFalse(any("testguard" in r or "lost" in r for r in self.gate()["reasons"]))

    def test_a_deleted_assert_raises_a_blocker_the_gate_reports_first(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        gate = self.gate()
        (blocker,) = self.open_testguard()
        self.assertEqual(blocker.detail, "tests/test_export.py lost 1 assertion since the goal started")
        self.assertIn(blocker.detail, gate["reasons"][0])
        self.assertEqual(self.runtime.get_active(self.ws, SESSION).status, "review_blocked")

    def test_a_removed_assert_plus_an_added_skip_reads_like_the_demo_line(self):
        weakened = GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", "").replace(
            "def test_refund_cent", "@pytest.mark.skip\ndef test_refund_cent"
        )
        self.write("tests/test_export.py", weakened)
        self.gate()
        (blocker,) = self.open_testguard()
        self.assertEqual(
            blocker.detail,
            "tests/test_export.py lost 1 assertion and gained 1 skip since the goal started",
        )

    def test_a_deleted_test_function_is_reported(self):
        self.write("tests/test_export.py", GOOD_TESTS.split("def test_refund_cent")[0])
        self.gate()
        (blocker,) = self.open_testguard()
        self.assertIn("lost 1 test and 1 assertion", blocker.detail)

    def test_a_deleted_test_file_is_reported(self):
        (self.ws / "tests/test_export.py").unlink()
        self.gate()
        (blocker,) = self.open_testguard()
        self.assertEqual(blocker.detail, "tests/test_export.py was deleted since the goal started")

    def test_every_skip_marker_counts(self):
        markers = [
            "@pytest.mark.skip",
            "@pytest.mark.skipif(True, reason='x')",
            "@pytest.mark.xfail",
            "@unittest.skip('x')",
        ]
        for marker in markers:
            with self.subTest(marker=marker):
                self.write("tests/test_export.py", GOOD_TESTS + f"\n{marker}\ndef test_extra():\n    assert 1\n")
                self.gate()
                self.assertTrue(any("gained 1 skip" in b.detail for b in self.open_testguard()), marker)
                self.write("tests/test_export.py", GOOD_TESTS)
                self.gate()

    def test_javascript_tests_are_guarded_too(self):
        js = "describe('x', () => {\n  it('a', () => {\n    expect(1).toBe(1);\n    expect(2).toBe(2);\n  });\n});\n"
        self.write("web/app.test.js", js)
        self.goal()  # a second goal re-snapshots while inheriting the stricter baseline
        self.write("web/app.test.js", js.replace("it('a'", "it.skip('a'").replace("    expect(2).toBe(2);\n", ""))
        self.gate()
        details = " ".join(b.detail for b in self.open_testguard())
        self.assertIn("web/app.test.js lost 1 test and 1 assertion and gained 1 skip", details)

    def test_only_and_xit_markers_count(self):
        self.write("web/a.spec.ts", "it('a', () => { expect(1).toBe(1); });\n")
        self.goal()
        self.write("web/a.spec.ts", "xit('a', () => { expect(1).toBe(1); });\nit.only('b', () => {});\n")
        self.gate()
        details = " ".join(b.detail for b in self.open_testguard())
        self.assertIn("gained 2 skips", details)

    def test_restoring_the_file_auto_resolves_the_blocker(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.gate()
        self.assertTrue(self.open_testguard())
        self.write("tests/test_export.py", GOOD_TESTS)
        self.gate()
        self.assertFalse(self.open_testguard())
        self.assertTrue(all(b.resolved for b in self.blockers() if b.source == "testguard"))
        self.assertEqual(self.runtime.get_active(self.ws, SESSION).status, "active")

    def test_the_model_cannot_resolve_it(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.gate()
        (blocker,) = self.open_testguard()
        with self.assertRaisesRegex(ValueError, "lit-accept-tests"):
            self.runtime.resolve_review_blocker(self.ws, blocker.id, session_id=SESSION)
        with self.assertRaises(ValueError):
            self.runtime.resolve_review_blocker(self.ws, blocker.id, session_id=SESSION, force=True)
        self.assertFalse(any("resolve" in spec["name"] or "accept" in spec["name"] for spec in self.tools.TOOL_SPECS))
        self.assertTrue(self.open_testguard())

    def test_hand_editing_goals_json_does_not_clear_it(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.gate()
        path = self.state_file("goals.json")
        data = json.loads(path.read_text())
        for blocker in data["goals"][0]["review_blockers"]:
            blocker["resolved"] = True
        path.write_text(json.dumps(data))
        gate = self.gate()
        self.assertFalse(gate["passed"])
        self.assertTrue(self.open_testguard())

    def test_a_second_goal_cannot_launder_the_weakened_tests(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.goal()
        self.gate()
        self.assertTrue(self.open_testguard())

    def test_the_slash_command_needs_a_reason(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.gate()
        self.assertIn("reason", self.testguard.command_accept_tests("").lower())
        self.assertTrue(self.open_testguard())

    def test_the_slash_command_resolves_and_rebaselines(self):
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", ""))
        self.gate()
        import_module("lithermes_plugin_pkg.workspace").resolve(session_id=SESSION)  # the session whose turn just ran
        message = self.testguard.command_accept_tests("replaced by the property test")
        self.assertIn("accepted", message.lower())
        self.assertFalse(self.open_testguard())
        self.assertFalse(any(b.source == "testguard" and not b.resolved for b in self.blockers()))
        self.gate()
        self.assertFalse(self.open_testguard(), "the re-baselined snapshot must not re-raise")
        ledger = [json.loads(line) for line in self.state_file("ledger.jsonl").read_text().splitlines()]
        accepted = [e for e in ledger if e["kind"] == "testguard_accepted"]
        self.assertEqual(accepted[-1]["reason"], "replaced by the property test")
        # weakening again after the acceptance is caught against the new baseline
        self.write("tests/test_export.py", GOOD_TESTS.replace("    assert rows()[-1] == 'c'\n", "").replace("    assert len(rows()) == 3\n", ""))
        self.gate()
        self.assertTrue(self.open_testguard())

    def test_the_slash_command_without_an_open_blocker_says_so(self):
        self.assertIn("nothing", self.testguard.command_accept_tests("because").lower())

    def test_the_command_is_registered_as_a_plain_user_command(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertIn("lit-accept-tests", ctx.commands)
        self.assertTrue(ctx.command_specs["lit-accept-tests"]["description"])
        self.assertNotIn("lit-accept-tests", [spec["name"] for spec in self.tools.TOOL_SPECS])

    def test_oversized_files_are_not_scanned(self):
        self.write("tests/test_big.py", "def test_x():\n    assert 1\n" + "# pad\n" * 300000)
        scan = self.testguard.scan(self.ws)
        self.assertNotIn("tests/test_big.py", scan)

    def test_the_file_count_is_capped(self):
        for index in range(12):
            self.write(f"many/test_{index:02d}.py", "def test_a():\n    assert 1\n")
        with mock.patch.object(self.testguard, "MAX_FILES", 5):
            scan = self.testguard.scan(self.ws)
        self.assertLessEqual(len(scan), 5)

    def test_pathological_lines_scan_quickly(self):
        self.write("tests/test_wide.py", "def test_x():\n    assert 1  " + "assert " * 100000 + "\n")
        self.write("web/wide.test.js", "it(" * 150000 + "\n")
        started = time.monotonic()
        scan = self.testguard.scan(self.ws)
        self.assertLess(time.monotonic() - started, 2.0)
        self.assertIn("tests/test_wide.py", scan)

    def test_the_baseline_is_carried_into_an_adopted_session(self):
        self.store.save(self.ws, self.store.load_or_create(self.ws, SESSION), SESSION)
        self.store.adopt(self.ws, SESSION, "adopted")
        self.assertTrue(self.state_file("testguard.json", "adopted").is_file())


class GateSnapshot(Base):
    def setUp(self):
        super().setUp()
        self.write("export.py", "rows = ['a']\n")
        self.goal()

    def read(self):
        return json.loads(self.state_file("gate.json").read_text())

    def test_no_goal_no_snapshot(self):
        self.gate("fresh")
        self.assertFalse(self.state_file("gate.json", "fresh").exists())

    def test_the_default_read_only_form_neither_writes_gate_json_nor_raises_blockers(self):
        self.write("tests/test_export.py", GOOD_TESTS)
        self.goal()
        self.write("tests/test_export.py", "def test_x():\n    pass\n")
        before = sorted((str(p), p.stat().st_mtime_ns) for p in self.ws.rglob("*") if p.is_file())
        self.runtime.quality_gate(self.ws, session_id=SESSION)
        after = sorted((str(p), p.stat().st_mtime_ns) for p in self.ws.rglob("*") if p.is_file())
        self.assertEqual(before, after)

    def test_evaluating_the_gate_writes_the_snapshot(self):
        gate = self.gate()
        data = self.read()
        self.assertEqual(set(data), {"open", "reasons", "evaluated_at", "runs", "blockers"})
        self.assertIs(data["open"], False)
        self.assertEqual(data["reasons"], gate["reasons"])
        datetime.fromisoformat(data["evaluated_at"])

    def test_a_recorded_run_updates_the_snapshot_without_a_gate_call(self):
        run_id = self.terminal("pytest -q tests/", 0)
        (entry,) = self.read()["runs"]
        datetime.fromisoformat(entry.pop("at"))
        self.assertEqual(entry, {"id": run_id, "exit": 0, "preview": "pytest -q tests/", "stale": False, "changed": []})

    def test_added_evidence_updates_the_snapshot(self):
        run_id = self.terminal()
        self.green(run_id)
        before = self.read()["evaluated_at"]
        time.sleep(0.01)
        self.runtime.add_evidence(self.ws, "C001", "scenario", "qa.txt", session_id=SESSION)
        self.assertNotEqual(self.read()["evaluated_at"], before)

    def test_an_open_gate_is_written_open(self):
        run_id = self.terminal()
        self.green(run_id)
        self.finish_criterion()
        self.gate()
        data = self.read()
        self.assertIs(data["open"], True)
        self.assertEqual(data["reasons"], [])

    def test_stale_runs_and_blockers_are_listed(self):
        run_id = self.terminal()
        self.green(run_id)
        self.finish_criterion()
        time.sleep(0.01)
        self.write("export.py", "rows = ['a', 'b']\n")
        self.write("tests/test_export.py", GOOD_TESTS)
        self.runtime.add_review_blocker(self.ws, "reviewer wants a retry", session_id=SESSION)
        self.gate()
        data = self.read()
        self.assertIs(data["open"], False)
        self.assertTrue(data["runs"][0]["stale"])
        self.assertIn(
            {"source": "review", "text": "reviewer wants a retry", "resolved": False}, data["blockers"]
        )

    def test_testguard_blockers_carry_their_source(self):
        self.write("tests/test_export.py", GOOD_TESTS)
        self.goal()
        self.write("tests/test_export.py", "def test_x():\n    pass\n")
        self.gate()
        sources = {b["source"] for b in self.read()["blockers"]}
        self.assertIn("testguard", sources)

    def test_the_write_is_atomic_and_leaves_no_temp_files(self):
        self.gate()
        names = sorted(p.name for p in self.state_file("gate.json").parent.iterdir())
        self.assertIn("gate.json", names)
        self.assertFalse([n for n in names if n.endswith(".tmp")])

    def test_the_not_done_line_lists_stale_reasons_first(self):
        run_id = self.terminal()
        self.green(run_id)
        time.sleep(0.01)
        self.write("export.py", "rows = ['a', 'b']\n")
        mark = self.hook.not_done_mark(response_text="All done.", session_id=SESSION)
        self.assertIn("is stale:", mark.split("not done — ", 1)[1].split("; ")[0])


if __name__ == "__main__":
    unittest.main()
