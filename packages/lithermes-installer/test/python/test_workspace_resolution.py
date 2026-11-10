"""Session workspace: plugin state follows the session's cwd, not the host process's cwd.

Hermes 0.23 runs ``hermes -z`` and Desktop chat through one shared gateway whose process cwd is
``~/.hermes``; the session's own folder reaches plugins only through the host's cwd carriers
(``agent.runtime_cwd`` context, ``tools.terminal_tool`` task overrides and session record).
These cases stand a fake host in front of the real plugin hooks and tools and look at where the
durable state lands. ``on_session_finalize`` carries no cwd at all, so the card case also checks
that the workspace seen during the turn is the one used at the end of the session.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase


class _Host:
    """The two host modules the plugin may consult; every field is swappable per case."""

    def __init__(self):
        self.scoped = ""
        self.overrides: dict[str, dict] = {}
        self.records: dict[str, str] = {}
        self.terminal_cwd = ""
        runtime_cwd = types.ModuleType("agent.runtime_cwd")
        runtime_cwd.scoped_session_cwd = lambda: self.scoped
        runtime_cwd.scope_terminal_cwd = lambda: self.terminal_cwd
        terminal = types.ModuleType("tools.terminal_tool")
        terminal.resolve_task_overrides = lambda task_id: self.overrides.get(task_id or "default", {})
        terminal.get_session_cwd = lambda key: self.records.get(key or "default")
        self.modules = {"agent.runtime_cwd": runtime_cwd, "tools.terminal_tool": terminal}


class WorkspaceFollowsSession(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.base = Path(tempfile.mkdtemp(prefix="lithermes-ws-res-", dir=self.isolated_root.name)).resolve()
        self.gateway_cwd = self.base / "gateway"
        self.session_cwd = self.base / "project"
        for folder in (self.gateway_cwd, self.session_cwd):
            folder.mkdir()
        self.host = _Host()
        patcher = patch.dict(sys.modules, self.host.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        previous = os.getcwd()
        os.chdir(self.gateway_cwd)
        self.addCleanup(os.chdir, previous)
        self.tools = sys.modules[self.pkg.__name__ + ".litgoal.tools"]
        self.workspace = sys.modules[self.pkg.__name__ + ".workspace"]
        self.workspace.forget_all()
        self.addCleanup(self.workspace.forget_all)

    def state_in(self, folder: Path) -> Path:
        return folder / ".hermes" / "lithermes"

    def set_goal(self, session="s1"):
        return json.loads(self.tools.tool_goal_set(
            {"objective": "fix the export", "title": "Fix", "criteria": [{"scenario": "export", "qa_channel": "cli"}]},
            session_id=session, task_id=session,
        ))

    @contextmanager
    def in_turn(self):
        """The gateway sets the session cwd for the length of one turn."""
        self.host.scoped = str(self.session_cwd)
        try:
            yield
        finally:
            self.host.scoped = ""

    def test_goal_tools_write_into_the_session_workspace(self):
        with self.in_turn():
            snapshot = self.set_goal()
        self.assertEqual(snapshot["active_goal"]["objective"], "fix the export")
        self.assertTrue((self.state_in(self.session_cwd) / "litgoal").is_dir())
        self.assertFalse(self.state_in(self.gateway_cwd).exists(), "state leaked into the host process cwd")

    def test_a_registered_task_override_is_the_workspace_when_no_turn_scope_exists(self):
        self.host.overrides["s1"] = {"cwd": str(self.session_cwd)}
        self.set_goal()
        self.assertTrue((self.state_in(self.session_cwd) / "litgoal").is_dir())
        self.assertFalse(self.state_in(self.gateway_cwd).exists())

    def test_the_terminal_session_record_is_used_when_nothing_more_specific_exists(self):
        self.host.records["s1"] = str(self.session_cwd)
        self.set_goal()
        self.assertTrue((self.state_in(self.session_cwd) / "litgoal").is_dir())
        self.assertFalse(self.state_in(self.gateway_cwd).exists())

    def test_the_turn_scope_outranks_a_terminal_cd_record(self):
        elsewhere = self.base / "elsewhere"
        elsewhere.mkdir()
        self.host.records["s1"] = str(elsewhere)
        with self.in_turn():
            self.set_goal()
        self.assertTrue((self.state_in(self.session_cwd) / "litgoal").is_dir())
        self.assertFalse(self.state_in(elsewhere).exists())

    def test_no_host_information_keeps_the_process_cwd(self):
        self.set_goal()
        self.assertTrue((self.state_in(self.gateway_cwd) / "litgoal").is_dir())

    def test_a_relative_or_missing_carrier_is_ignored(self):
        self.host.records["s1"] = "relative/dir"
        self.host.terminal_cwd = str(self.base / "does-not-exist")
        self.set_goal()
        self.assertTrue((self.state_in(self.gateway_cwd) / "litgoal").is_dir())

    def test_terminal_runs_are_recorded_and_fingerprinted_in_the_session_workspace(self):
        (self.session_cwd / "app.py").write_text("print('hi')\n", encoding="utf-8")
        with self.in_turn():
            self.set_goal()
            self.pkg._post_tool_call(
                tool_name="terminal", args={"command": "pytest -q"}, result=json.dumps({"exit_code": 0}),
                session_id="s1", task_id="s1",
            )
        runs = list((self.state_in(self.session_cwd) / "litgoal").rglob("runs.jsonl"))
        self.assertEqual(len(runs), 1, runs)
        record = json.loads(runs[0].read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(record["tool"], "terminal")
        self.assertTrue(record["fp"], "the run must carry a fingerprint of the session workspace")
        self.assertFalse(self.state_in(self.gateway_cwd).exists())

    def test_the_goal_snapshot_context_reads_the_session_workspace(self):
        with self.in_turn():
            self.set_goal()
            context = self.pkg._pre_llm_call(
                user_message="continue", session_id="s1", task_id="s1", platform="cli", is_first_turn=False,
            )
        self.assertIn("fix the export", json.dumps(context))
        self.assertFalse(self.state_in(self.gateway_cwd).exists())

    def test_the_session_card_is_written_at_session_end_into_the_turn_workspace(self):
        with self.in_turn():
            self.set_goal()
            self.pkg._pre_llm_call(
                user_message="continue", session_id="s1", task_id="s1", platform="cli", is_first_turn=False,
            )
        # on_session_finalize runs later, off the turn, from the gateway's own cwd, with no cwd argument.
        self.assertEqual(self.host.scoped, "")
        self.assertIsNone(self.pkg._finalize_session(session_id="s1", platform="cli", reason="ws_orphan_reap"))
        card = self.state_in(self.session_cwd) / "handoff" / "s1.json"
        self.assertTrue(card.is_file(), "no handoff card in the session workspace")
        self.assertEqual(json.loads(card.read_text(encoding="utf-8"))["goal"]["title"], "Fix")
        self.assertFalse(self.state_in(self.gateway_cwd).exists())

    def test_a_session_that_never_ran_a_turn_writes_no_card(self):
        self.assertIsNone(self.pkg._finalize_session(session_id="never-seen", platform="cli"))
        self.assertFalse(self.state_in(self.session_cwd).exists())
        self.assertFalse(self.state_in(self.gateway_cwd).exists())


class HermesHomeIsNeverAWorkspace(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.home = Path(os.environ["HERMES_HOME"]).resolve()
        self.host = _Host()
        patcher = patch.dict(sys.modules, self.host.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        previous = os.getcwd()
        os.chdir(self.home)
        self.addCleanup(os.chdir, previous)
        self.tools = sys.modules[self.pkg.__name__ + ".litgoal.tools"]
        self.workspace = sys.modules[self.pkg.__name__ + ".workspace"]
        self.workspace.forget_all()
        self.addCleanup(self.workspace.forget_all)

    def test_the_process_cwd_being_the_hermes_home_writes_nothing_and_says_so(self):
        with self.assertLogs("lithermes.workspace", level="WARNING") as logged:
            result = json.loads(self.tools.tool_goal_set({"objective": "x"}, session_id="s1", task_id="s1"))
        self.assertIn("workspace", result["error"].lower())
        self.assertTrue(any("hermes home" in line.lower() for line in logged.output), logged.output)
        self.assertFalse((self.home / ".hermes").exists())

    def test_a_session_cwd_equal_to_the_hermes_home_is_refused_too(self):
        self.host.scoped = str(self.home)
        result = json.loads(self.tools.tool_goal_status(session_id="s1", task_id="s1"))
        self.assertIn("error", result)
        self.assertFalse((self.home / ".hermes").exists())

    def test_the_dot_hermes_folder_of_the_user_home_is_refused(self):
        user_home_state = Path.home() / ".hermes"
        user_home_state.mkdir(exist_ok=True)
        self.host.scoped = str(user_home_state)
        self.assertIsNone(self.workspace.resolve(session_id="s1"))

    def test_hooks_skip_instead_of_raising(self):
        self.assertIsNone(self.pkg._finalize_session(session_id="s1", platform="cli"))
        self.assertIsNone(self.pkg._post_tool_call(
            tool_name="terminal", args={"command": "pytest -q"}, result=json.dumps({"exit_code": 0}),
            session_id="s1", task_id="s1",
        ))
        self.assertFalse((self.home / ".hermes").exists())

    def test_a_folder_inside_the_hermes_home_is_refused_too(self):
        inside = self.home / "workspace"
        inside.mkdir()
        self.host.scoped = str(inside)
        self.assertIsNone(self.workspace.resolve(session_id="s1"))


if __name__ == "__main__":
    unittest.main()
