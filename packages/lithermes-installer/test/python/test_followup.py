"""The report-only follow-up: a printed cron blueprint, a read-only woken run, [SILENT] when nothing changed.

`hermes lithermes followup` prints a `hermes cron create` line and the matching cronjob_manage
arguments; it creates nothing. When Hermes' scheduler fires that job (platform `cron`, the marker in its
prompt), LitHermes adds the project's state and decides: unchanged since the last report -> the model is
told to answer exactly [SILENT]; changed -> one report, recorded in shown.jsonl. Every tool but a read is
blocked in that session, and the run happens in Hermes' cron approval context, whose default is deny.
Scratch folders only; no network, no model call, no cron job is created.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import shlex
import sys
import unittest
from pathlib import Path
from unittest import mock

try:
    from .test_bounded_autopilot import _AutopilotCase
except ImportError:
    from test_bounded_autopilot import _AutopilotCase

# The runner uses the interpreter of Hermes' own checkout (<checkout>/venv/bin/python3), so its source sits
# three levels up; any other interpreter skips the host case.
HERMES_SOURCE = Path(sys.executable).parent.parent.parent


class FollowUp(_AutopilotCase):
    def setUp(self):
        super().setUp()
        self.fu = self.pkg.followup
        self.fu._reset_for_tests()
        self.addCleanup(self.fu._reset_for_tests)
        self.record = self.ws / ".hermes" / "lithermes" / "shown.jsonl"
        self.plan_md = self.ws / "plan.md"
        self.plan_md.write_text("# Plan\n\n- [x] 1. a.txt\n- [x] 2. b.txt\n- [ ] 3. c.txt\n- [ ] 4. d.txt\n", encoding="utf-8")

    def cron_prompt(self) -> str:
        # Hermes puts its cron notice and the loaded skill text before the job's own prompt.
        return "[IMPORTANT: You are running as a scheduled cron job. ...]\n\n" + "skill text\n" * 2000 + self.fu.prompt(self.ws)

    def fire(self, session="cron_job1_1"):
        return self.pkg._pre_llm_call(user_message=self.cron_prompt(), session_id=session, platform="cron", turn_id="t1")

    def tick(self, row: str):
        text = self.plan_md.read_text(encoding="utf-8").replace(f"- [ ] {row}", f"- [x] {row}")
        self.plan_md.write_text(text, encoding="utf-8")

    def test_the_cli_prints_a_cron_line_and_tool_arguments_and_creates_nothing(self):
        parser = argparse.ArgumentParser()
        self.fu.setup_cli(parser)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.fu.handle_cli(parser.parse_args(["--worktree", str(self.ws), "--every", "every 3h"]))
        self.assertEqual(code, 0)
        text = out.getvalue()
        line = next(l for l in text.splitlines() if l.startswith("hermes cron create "))
        argv = shlex.split(line)
        self.assertEqual(argv[3], "every 3h")
        self.assertIn('<lithermes-followup v="1"', argv[4])
        self.assertEqual(argv[argv.index("--skill") + 1], "lithermes:litgoal")
        self.assertEqual(argv[argv.index("--workdir") + 1], str(self.ws.resolve()))
        args = json.loads(text[text.index("{"): text.rindex("}") + 1])
        self.assertEqual(args["action"], "create")
        self.assertEqual(args["skills"], ["lithermes:litgoal"])
        self.assertEqual(args["workdir"], str(self.ws.resolve()))
        self.assertIn("[SILENT]", text)
        self.assertFalse((Path(os.environ["HERMES_HOME"]) / "cron").exists(), "no job store was written")
        self.assertFalse(self.record.exists())

    def test_the_cli_is_registered_under_hermes_lithermes(self):
        parser = argparse.ArgumentParser()
        self.pkg._setup_lithermes_cli(parser)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.pkg._handle_lithermes_cli(parser.parse_args(["followup", "--worktree", str(self.ws)]))
        self.assertEqual(code, 0)
        self.assertIn("hermes cron create", out.getvalue())
        self.assertIn("followup", parser.epilog)

    def test_first_run_reports_once_and_an_unchanged_second_run_is_silent(self):
        first = self.fire("cron_a")["context"]
        self.assertIn('changed="true"', first)
        self.assertIn("plan.md: 2/4 rows done", first)
        self.assertIn("next: 3. c.txt", first)
        second = self.fire("cron_b")["context"]
        self.assertIn('changed="false"', second)
        self.assertIn("[SILENT]", second)
        self.assertNotIn("plan.md:", second)

    def test_one_plan_file_is_reported_once_on_a_case_insensitive_disk(self):
        # plan.md and PLAN.md name the same file on a case-insensitive disk (the macOS default).
        report = self.fire("cron_a")["context"]
        rows = [line for line in report.splitlines() if line.lower().startswith("- plan.md:")]
        self.assertEqual(len(rows), 1, report)

    def test_ticking_a_plan_row_makes_exactly_one_new_report(self):
        self.fire("cron_a")
        self.tick("3. c.txt")
        report = self.fire("cron_b")["context"]
        self.assertIn('changed="true"', report)
        self.assertIn("3/4 rows done", report)
        self.assertIn('changed="false"', self.fire("cron_c")["context"])

    def test_a_parked_step_is_part_of_the_report(self):
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        report = self.fire("cron_a")["context"]
        self.assertIn(f"bounded work {work_id}: active, 1 step(s) parked", report)
        self.assertIn("lit approve", report)

    def test_the_report_is_recorded_as_a_hash_in_shown_jsonl(self):
        self.fire("cron_a")
        entries = [json.loads(line) for line in self.record.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(e["kind"], e["name"]) for e in entries], [("notice", "followup")])
        self.assertNotIn("plan.md", self.record.read_text(encoding="utf-8"))

    def test_a_damaged_record_reports_again_rather_than_staying_silent(self):
        self.fire("cron_a")
        self.record.write_text("{broken\n", encoding="utf-8")
        self.assertIn('changed="true"', self.fire("cron_b")["context"])

    def test_writes_and_commands_are_blocked_in_the_follow_up_session(self):
        self.fire("cron_a")
        for tool, args in (
            ("write_file", {"path": str(self.ws / "x.txt"), "content": "x"}),
            ("patch", {"path": str(self.plan_md), "old_string": "[ ]", "new_string": "[x]"}),
            ("terminal", {"command": "rm -rf docs"}),
            ("web_search", {"query": "x"}),
            ("cronjob_manage", {"action": "create"}),
            ("lithermes_work_progress", {}),
        ):
            decision = self.pkg._pre_tool_call(tool_name=tool, args=args, session_id="cron_a")
            self.assertEqual((decision or {}).get("action"), "block", tool)
        self.assertFalse((self.ws / "x.txt").exists())

    def test_reads_stay_allowed_in_the_follow_up_session(self):
        self.fire("cron_a")
        self.assertIsNone(self.pkg._pre_tool_call(tool_name="read_file", args={"path": str(self.plan_md)}, session_id="cron_a"))
        self.assertIsNone(self.pkg._pre_tool_call(tool_name="terminal", args={"command": "grep -n x plan.md"}, session_id="cron_a"))

    def test_other_sessions_are_untouched(self):
        self.fire("cron_a")
        self.assertIsNone(self.pkg._pre_tool_call(
            tool_name="write_file", args={"path": str(self.ws / "y.txt"), "content": "y"}, session_id="someone-else",
        ))

    def test_the_marker_outside_cron_does_nothing(self):
        result = self.pkg._pre_llm_call(user_message=self.cron_prompt(), session_id="cli-1", platform="cli", turn_id="t1")
        self.assertNotIn("lithermes-followup-result", str((result or {}).get("context", "")))
        self.assertIsNone(self.pkg._pre_tool_call(
            tool_name="write_file", args={"path": str(self.ws / "z.txt"), "content": "z"}, session_id="cli-1",
        ))

    def test_a_cron_job_without_the_marker_is_left_alone(self):
        result = self.pkg._pre_llm_call(user_message="check the weather", session_id="cron_x", platform="cron", turn_id="t1")
        self.assertNotIn("lithermes-followup-result", str((result or {}).get("context", "")))
        self.assertIsNone(self.fu.pre_tool_call("write_file", {"path": "/tmp/x"}, "cron_x"))

    def test_a_finalized_session_releases_its_guard(self):
        self.fire("cron_a")
        self.pkg._finalize_session(session_id="cron_a")
        self.assertIsNone(self.fu.pre_tool_call("write_file", {"path": "/tmp/x"}, "cron_a"))


@unittest.skipUnless((HERMES_SOURCE / "tools" / "approval_context.py").is_file(), "Hermes source not present")
class HostCronApprovalContext(unittest.TestCase):
    """The woken run is a Hermes cron session, so the host's own approval mode for it (default deny) applies."""

    def setUp(self):
        sys.path.insert(0, str(HERMES_SOURCE))
        self.addCleanup(sys.path.remove, str(HERMES_SOURCE))

    def test_a_cron_session_is_the_cron_approval_context_and_defaults_to_deny(self):
        try:
            from tools import approval_context
            from hermes_cli.config_defaults import DEFAULT_CONFIG
        except Exception as exc:  # noqa: BLE001 - another interpreter cannot import the host
            self.skipTest(f"Hermes modules not importable here: {type(exc).__name__}")
        with mock.patch.dict(os.environ, {"HERMES_CRON_SESSION": ""}):
            self.assertFalse(approval_context._is_cron_approval_context())
        # Hermes' scheduler binds HERMES_CRON_SESSION for every job it runs (cron/scheduler.py).
        with mock.patch.dict(os.environ, {"HERMES_CRON_SESSION": "1"}):
            self.assertTrue(approval_context._is_cron_approval_context())
        self.assertEqual(str((DEFAULT_CONFIG.get("approvals") or {}).get("cron_mode")), "deny")
