"""The record behind the Ink TUI card, the rule for round caps, and the classic framed card."""

from __future__ import annotations

import json
import os
import re
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from .plugin_register_test_support import _load_plugin_package
    from .test_gate_surfaces import COLOUR_ENV, _snapshot
except ImportError:
    from plugin_register_test_support import _load_plugin_package
    from test_gate_surfaces import COLOUR_ENV, _snapshot

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
SUN = re.compile("[▁▂▃▄▅▆▇█]")


class RecordsCase(unittest.TestCase):
    def setUp(self):
        self.pkg = _load_plugin_package()
        self.card = self.pkg.tui_card
        self.card.reset()
        self.addCleanup(self.card.reset)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name).resolve()
        self.home, self.ws = root / "home", root / "project"
        self.home.mkdir()
        self.ws.mkdir()
        patch = mock.patch.object(self.card, "get_hermes_home", lambda: self.home)
        patch.start()
        self.addCleanup(patch.stop)

    def goal(self, session="s-1", title="Fix the export"):
        goal = self.card.runtime.create_goal(self.ws, "totals match", title=title, session_id=session)
        self.card.runtime.add_criterion(self.ws, "rows kept", session_id=session)
        return goal

    def path(self, session="s-1"):
        return self.card.record_path(session, self.home)

    def record(self, session="s-1"):
        return json.loads(self.path(session).read_text(encoding="utf-8"))


class Records(RecordsCase):
    def test_a_turn_writes_work_then_rest_then_nothing(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        first = self.record()
        self.assertEqual((first["v"], first["working"], first["pid"]), (1, True, os.getpid()))
        self.assertEqual((first["title"], first["passed"], first["total"], first["gate"]), ("Fix the export", 0, 1, False))
        self.assertEqual([row[0] for row in first["stages"]][:4], ["plan", "runs", "review", "gate"])
        self.assertTrue(first["next"])
        self.assertEqual(stat.S_IMODE(self.path().stat().st_mode), 0o600)
        self.card.turn_ended("s-1")
        self.assertFalse(self.record()["working"])
        self.card.forget("s-1")
        self.assertFalse(self.path().exists())
        self.assertEqual(list(self.path().parent.iterdir()), [], "no temporary file stays behind")

    def test_only_a_tui_session_with_its_own_goal_gets_a_record(self):
        self.goal("other")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertFalse(self.path().exists(), "another session's goal in the same folder is not this one's")
        self.goal()
        for platform in ("cli", "desktop", "telegram", "subagent", "", None):
            self.card.turn_started(self.ws, "s-1", platform)
            self.assertFalse(self.path().exists(), platform)
        self.card.turn_started(None, "s-1", "tui")
        self.assertFalse(self.path().exists())

    def test_a_goal_set_mid_turn_appears_and_a_quiet_tool_call_writes_nothing(self):
        self.card.turn_started(self.ws, "s-1", "tui")
        self.goal()
        self.card.observe("s-1")
        self.assertTrue(self.record()["working"])
        with mock.patch.object(self.card, "build") as build:
            for _ in range(50):
                self.card.observe("s-1")
            build.assert_not_called()
            self.card._TURNS["s-1"]["wrote"] -= self.card.HEARTBEAT_SECONDS + 1
            build.return_value = None
            self.card.observe("s-1")
            build.assert_called_once()
        self.card.observe("unknown")

    def run_tests(self, session="s-1"):
        runs = self.card.runtime.runs
        run_id = runs.record_run(self.ws, session, "terminal", {"command": "pytest -q"}, '{"exit_code": 0}')
        self.card.runtime.refresh_gate(self.ws, session)
        return run_id

    def classic(self, session="s-1"):
        hud = self.card.hud_card
        return hud.render(hud.snapshot_for(self.ws, session), "litgoal", "desktop", {"LANG": "en_US.UTF-8"})

    def test_a_new_goal_does_not_inherit_the_last_goals_runs_or_gate(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(self.run_tests(), "R001")
        self.card.observe("s-1")
        self.assertEqual(self.record()["runs"], [["R001 ✓", "ok"]])
        self.assertIn("R001 ✓", self.classic())
        self.card.runtime.add_review_blocker(self.ws, "a blocker of the first goal", session_id="s-1")

        self.goal(title="Second goal")
        self.card.observe("s-1")
        second = self.record()
        self.assertEqual((second["title"], second["runs"]), ("Second goal", []))
        self.assertNotIn("first goal", second["next"])
        self.assertEqual(dict(second["stages"])["runs"], "active", "the runs stage waits for a first run")
        self.assertNotIn("R001", self.classic())
        self.assertIn("no signed runs yet", self.classic())

        self.card.runtime.refresh_gate(self.ws, "s-1")
        self.card.observe("s-1")
        self.assertEqual(self.record()["runs"], [], "a gate evaluated for the new goal lists only its own runs")
        self.assertEqual(self.run_tests(), "R002")
        self.card.observe("s-1")
        self.assertEqual(self.record()["runs"], [["R002 ✓", "ok"]])
        self.assertNotIn("R001", self.classic())

    def test_an_earlier_run_the_goal_cites_is_shown(self):
        self.goal()
        self.run_tests()
        self.goal(title="Second goal")
        self.card.runtime.add_evidence(self.ws, "C001", "green", "run:R001", session_id="s-1")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(self.record()["runs"], [["R001 ✓", "ok"]])

    def test_the_goal_a_run_belongs_to_is_signed(self):
        runs = self.card.runtime.runs
        self.goal()
        self.run_tests()
        path = runs.runs_path(self.ws, "s-1")
        line = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(line["goal"], "G001")
        path.write_text(json.dumps({**line, "goal": "G002"}) + "\n", encoding="utf-8")
        self.assertEqual(runs.recent_runs(self.ws, "s-1"), [])

    def finish(self, sealed=True):
        """The goal reaches `complete`; only a sealed one counts as finished."""
        goal = self.card.runtime.get_active(self.ws, "s-1")
        path = self.card.store.goals_path(self.ws, "s-1")
        data = json.loads(path.read_text(encoding="utf-8"))
        data["goals"][0]["status"] = "complete"
        path.write_text(json.dumps(data), encoding="utf-8")
        patch = mock.patch.object(self.card.runtime, "is_finished", lambda ws, sid, g: sealed and g.id == goal.id)
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_finished_goal_rests_as_done_and_leaves_with_the_next_turn(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        self.finish()
        self.card.observe("s-1")
        self.card.turn_ended("s-1")
        self.assertEqual(self.record()["status"], "complete", "the turn that closed the goal shows it")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertFalse(self.path().exists(), "an ordinary turn later keeps no rows for a finished goal")
        self.card.turn_ended("s-1")
        self.assertFalse(self.path().exists())
        self.card.turn_started(self.ws, "s-1", "tui")
        self.card.runtime.create_goal(self.ws, "second", session_id="s-1")
        self.card.observe("s-1")
        self.assertEqual(self.record()["title"], "second", "a new goal in that turn brings the card back")

    def test_a_status_written_from_outside_is_not_done(self):
        self.goal()
        self.finish(sealed=False)
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(self.record()["status"], "active")

    def test_off_writes_nothing_and_errors_never_escape(self):
        self.goal()
        settings = self.home / "lithermes" / self.card.SETTINGS_FILE
        settings.parent.mkdir()
        settings.write_text('{"mode": "off"}', encoding="utf-8")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertFalse(self.path().exists())
        settings.write_text("[]", encoding="utf-8")
        self.assertEqual(self.card.mode(self.home), "on")
        with mock.patch.object(self.card, "build", side_effect=RuntimeError("x")):
            self.card.turn_started(self.ws, "s-1", "tui")
            self.card.observe("s-1")
            self.card.turn_ended("s-1")
            self.card.forget("s-1")

    def test_a_symlinked_records_folder_is_not_written_through(self):
        self.goal()
        outside = self.home.parent / "outside"
        outside.mkdir()
        (self.home / "lithermes").mkdir()
        (self.home / "lithermes" / self.card.RECORDS_DIR).symlink_to(outside, target_is_directory=True)
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(list(outside.iterdir()), [])

    def test_hooks_drive_the_card(self):
        self.goal()
        kwargs = {"session_id": "s-1", "platform": "tui", "user_message": "hello", "turn_id": "t"}
        with mock.patch.object(self.pkg, "_session_workspace", lambda kw: self.ws):
            self.pkg._pre_llm_call(**kwargs)
            self.assertTrue(self.record()["working"])
            self.pkg._on_session_end(session_id="s-1", interrupted=True)
            self.assertFalse(self.record()["working"], "an interrupted turn also rests")
            self.pkg._pre_llm_call(**kwargs)
            self.pkg._release_bounded_session(session_id="s-1")
        self.assertFalse(self.path().exists())


class LiveFacts(RecordsCase):
    """What the host reports while the turn runs stands beside the goal in the record."""

    def test_the_running_tool_is_named_and_leaves_when_it_ends(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertNotIn("tool", self.record())
        self.card.tool_started("s-1", "terminal", {"command": "cat secret"})
        name, since = self.record()["tool"]
        self.assertEqual(name, "terminal")
        self.assertGreater(since, 1e9)
        self.assertNotIn("secret", self.path().read_text(encoding="utf-8"))
        self.card.observe("s-1")
        self.assertNotIn("tool", self.record())
        self.card.tool_started("s-1", "terminal")
        self.card.turn_ended("s-1")
        self.assertNotIn("tool", self.record(), "an interrupted call does not run on")
        self.card.tool_started("s-1", "terminal")
        self.assertNotIn("tool", self.record())
        for name in ("x" * 49, "a\x1b[2J", "", None):
            self.card.tool_started("s-1", name)
        self.card.tool_started("unknown", "terminal")

    def test_skills_are_the_ones_the_turn_loaded(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        for name in ("lithermes:lit-loop", "debugging", "lit-loop", "bad\x1bname", None):
            self.card.tool_started("s-1", "skill_view", {"name": name})
        self.assertEqual(self.record()["skills"], ["lit-loop", "debugging"])
        self.card.tool_started("s-1", "read_file", {"name": "not-a-skill"})
        self.assertEqual(self.record()["skills"], ["lit-loop", "debugging"])
        for i in range(9):
            self.card.tool_started("s-1", "skill_view", {"name": f"s{i}"})
        self.assertEqual(self.record()["skills"], ["s5", "s6", "s7", "s8"])
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertNotIn("skills", self.record(), "the next turn loaded none yet")

    def test_context_is_the_hosts_own_numbers_or_nothing(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        for usage, window in (({"prompt_tokens": 10}, None), ({"prompt_tokens": 10}, 0), ({}, 100), (None, 100), ({"prompt_tokens": "9"}, 100), ({"prompt_tokens": 5}, True)):
            self.card.note_usage("s-1", usage, window)
            self.assertNotIn("context", self.record())
        self.card.note_usage("s-1", {"prompt_tokens": 25_000}, 200_000)
        self.assertEqual(self.record()["context"], 12.5)
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(self.record()["context"], 12.5, "the last reading stays until the next one")
        self.card.forget("s-1")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertNotIn("context", self.record())

    def test_lanes_follow_the_delegated_children(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        self.card.lane_started("s-1", "c-1", "review the rounding\nwith care")
        self.card.lane_started("s-1", "c-2", "use api_key=sk-abcdefghijklmnopqrstuvwxyz012345 " + "x" * 90)
        self.card.lane_started("other", "c-3", "not ours")
        self.card.lane_started("s-1", "", "no id")
        lanes = self.record()["lanes"]
        self.assertEqual([lane["state"] for lane in lanes], ["running", "running"])
        self.assertEqual(lanes[0]["name"], "review the rounding with care")
        self.assertNotIn("sk-abc", lanes[1]["name"])
        self.assertLessEqual(len(lanes[1]["name"]), 40)
        self.card.tool_started("c-1", "read_file")
        self.card.tool_started("c-1", "terminal")
        self.assertNotIn("tool", self.record(), "a child's tool is not the session's")
        self.card.lane_stopped("c-1", "completed")
        self.card.lane_stopped("c-1", "failed")
        self.card.lane_stopped("unknown", "completed")
        first = self.record()["lanes"][0]
        self.assertEqual((first["state"], first["calls"]), ("ok", 2))
        self.assertGreaterEqual(first["ended"], first["since"])
        self.card.turn_ended("s-1")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual([lane["state"] for lane in self.record()["lanes"]], ["running"], "a child in the background goes on")
        self.card.lane_stopped("c-2", "failed")
        self.assertEqual(self.record()["lanes"][0]["state"], "bad")

    def test_the_branch_is_read_from_the_workspace(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertNotIn("branch", self.record())
        (self.ws / ".git").mkdir()
        (self.ws / ".git" / "HEAD").write_text("ref: refs/heads/fix/totals\n", encoding="utf-8")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertEqual(self.record()["branch"], "fix/totals")
        (self.ws / ".git" / "HEAD").write_text("0123456789abcdef\n", encoding="utf-8")
        self.card.turn_started(self.ws, "s-1", "tui")
        self.assertNotIn("branch", self.record(), "a detached head has no branch")

    def test_live_facts_do_not_read_the_goal_again_and_never_raise(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        with mock.patch.object(self.card, "build") as build:
            self.card.tool_started("s-1", "terminal")
            self.card.note_usage("s-1", {"prompt_tokens": 1}, 10)
            self.card.lane_started("s-1", "c-1", "x")
            build.assert_not_called()
        with mock.patch.object(self.card, "_write", side_effect=RuntimeError("x")):
            self.card.tool_started("s-1", "terminal")
            self.card.note_usage("s-1", {"prompt_tokens": 1}, 10)
            self.card.lane_started("s-1", "c-2", "x")
            self.card.lane_stopped("c-2", "completed")

    def test_the_hooks_feed_the_card(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        with mock.patch.object(self.pkg, "_session_workspace", lambda kw: self.ws):
            self.pkg._pre_tool_call(session_id="s-1", tool_name="read_file", args={"path": "a.txt"})
            self.assertEqual(self.record()["tool"][0], "read_file")
        with mock.patch.object(self.pkg.core, "post_api_request") as ledger:
            self.pkg._post_api_request(session_id="s-1", usage={"prompt_tokens": 50}, context_length=100)
            ledger.assert_called_once()
        self.pkg._subagent_start(parent_session_id="s-1", child_session_id="c-1", child_goal="look")
        with mock.patch.object(self.pkg.core, "subagent_stop") as ledger:
            self.pkg._subagent_stop(parent_session_id="s-1", child_session_id="c-1", child_status="completed")
            ledger.assert_called_once()
        record = self.record()
        self.assertEqual((record["context"], record["lanes"][0]["state"]), (50.0, "ok"))

    def test_a_refused_call_is_not_shown_as_running(self):
        self.goal()
        self.card.turn_started(self.ws, "s-1", "tui")
        with mock.patch.object(self.pkg.bounded_work_tools, "pre_tool_call", return_value={"action": "block", "message": "no"}):
            self.assertIsNotNone(self.pkg._pre_tool_call(session_id="s-1", tool_name="terminal", args={"command": "ls"}))
        self.assertNotIn("tool", self.record())


class RoundCaps(unittest.TestCase):
    def test_one_rule_the_same_as_the_widgets(self):
        rule = _load_plugin_package().hud_card.round_caps
        table = json.loads((Path(__file__).parents[1] / "fixtures" / "round-caps.json").read_text(encoding="utf-8"))
        for row in table:
            with self.subTest(row["name"]), tempfile.TemporaryDirectory() as home:
                for font in row.get("fonts", []):
                    path = Path(home, "fonts", font)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.touch()
                env = {"XDG_DATA_HOME": home, "HOME": home + "/none", **row.get("env", {})}
                self.assertIs(rule.round_caps(env, row.get("choice", "auto"), lambda: rule.has_icon_font(env, "linux")), row["round"])
        with tempfile.TemporaryDirectory() as home:
            Path(home, "fonts").mkdir()
            Path(home, "fonts", "HackNerdFont-Regular.ttf").touch()
            self.assertFalse(rule.has_icon_font({"XDG_DATA_HOME": home, "HOME": home}, "linux", 0), "the read is bounded")

    def test_the_saved_choice_and_one_read_per_process(self):
        rule = _load_plugin_package().hud_card.round_caps
        with tempfile.TemporaryDirectory() as home:
            path = Path(home, "lithermes", "tui-card.json")
            self.assertEqual(rule.saved_choice(home), "auto")
            path.parent.mkdir()
            for text, expected in (('{"glyphs": "square"}', "square"), ('{"glyphs": "x"}', "auto"), ("[]", "auto"), ("{", "auto")):
                path.write_text(text, encoding="utf-8")
                self.assertEqual(rule.saved_choice(home), expected)
        rule._FOUND.clear()
        self.addCleanup(rule._FOUND.clear)
        with mock.patch.object(rule, "has_icon_font", return_value=True) as look:
            for _ in range(3):
                self.assertTrue(rule.round_caps({"HOME": "/h"}))
            look.assert_called_once()


class FramedCard(unittest.TestCase):
    ROUND, SQUARE = {**COLOUR_ENV, "TERM_PROGRAM": "ghostty"}, {**COLOUR_ENV, "SSH_CONNECTION": "x"}

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.card, cls.sunset = cls.pkg.hud_card, cls.pkg.hud_card.sunset

    def render(self, columns=102, env=None, snapshot=None, surface="cli", first=False):
        with mock.patch.object(self.sunset, "columns", lambda: columns), mock.patch.object(self.card, "get_hermes_home", lambda: "/nonexistent"):
            return self.card.render(None if first else snapshot or self.snapshot(), "litwork", surface, env or self.SQUARE)

    @staticmethod
    def snapshot(**over):
        stages = [{"key": key, "state": state} for key, state in (("plan", "done"), ("runs", "active"), ("review", "todo"), ("gate", "todo"), ("handoff", "todo"), ("resume", "todo"))]
        return {**_snapshot(), "stages": stages, **over}

    def test_every_row_is_framed_in_column_at_every_width(self):
        for title in ("Fix", "분기 내보내기 합계가 맞도록 고치기", "x" * 300, "a🔥b\x1b[2J e\u0301 \u200b\u202e", "👩‍👩‍👧 ⚠️"):
            snapshot = self.snapshot(goal={"id": "G1", "title": title, "objective": "", "status": "active"})
            for columns in range(62, 130):
                for env in (self.ROUND, self.SQUARE):
                    for first in (False, True):
                        rows = self.render(columns, env, snapshot, first=first).splitlines()
                        for row in rows:
                            self.assertEqual(self.sunset.cells(row), min(100, columns - 2), row)
                            self.assertRegex(_ANSI.sub("", row), "^[╭│╰].*[╮│╯]$")
                            self.assertNotIn("\x1b[2J", row)

    def test_the_card_says_what_the_snapshot_says(self):
        plain = _ANSI.sub("", self.render())
        for part in ("🔥 LIT  · litwork ─", "─ RUNS ● ─╮", "PLAN ✓ ━━  RUNS  ── REVIEW ·", "proof 2/3", "next ▸ C002 evidence R007 is stale", "● Fix the quarterly export",
                     "runs R004 ✓ · R006 ✗ exit 1 · R007 ⚠ stale", "╰─ gate CLOSED ─"):
            self.assertIn(part, plain)
        self.assertRegex(plain, SUN)
        self.assertIn("no signed runs yet", _ANSI.sub("", self.render(snapshot=self.snapshot(receipts=[]))))
        first = _ANSI.sub("", self.render(first=True))
        for part in ("READY ○", "the agent writes criteria before it works", "/litgoal any time", "no goal yet"):
            self.assertIn(part, first)
        self.assertEqual(self.render(), self.render(), "the picture is the same every time")

    def test_round_is_round_and_square_is_square(self):
        caps = re.compile("[\ue0b6\ue0b4]")
        for first in (False, True):
            round_card, square = self.render(env=self.ROUND, first=first), self.render(env=self.SQUARE, first=first)
            self.assertNotRegex(square, caps)
            self.assertEqual(caps.sub(" ", _ANSI.sub("", round_card)), _ANSI.sub("", square))
            for row in round_card.splitlines():
                self.assertEqual(row.count("\ue0b6"), row.count("\ue0b4"))
            self.assertNotRegex(_ANSI.sub("", round_card + square), "[▯▮▰▱░▒▓▌]|\\[[#█ -]")
        self.assertEqual(self.render(env=self.ROUND).count("\ue0b6"), 3, "brand, stage and gauge")

    def test_no_room_no_colour_and_light_backgrounds_keep_the_bar_rows(self):
        bars = self.render(0)
        self.assertIn("▌", bars)
        for columns in (0, 40, 61):
            self.assertEqual(self.render(columns), bars)
        for name, value in (("COLORFGBG", "0;15"), ("HERMES_LIGHT", "1"), ("HERMES_TUI_THEME", "light"), ("HERMES_TUI_BACKGROUND", "#ffffff")):
            self.assertEqual(self.render(env={**self.SQUARE, name: value}), bars, name)
        self.assertNotEqual(self.render(env={**self.SQUARE, "COLORFGBG": "15;0"}), bars)
        for surface, env in (("tui", COLOUR_ENV), ("local", COLOUR_ENV), ("desktop", COLOUR_ENV), ("cli", {"LANG": "en_US.UTF-8"}), ("cli", {**COLOUR_ENV, "NO_COLOR": "1"})):
            self.assertEqual(self.render(120, env, surface=surface), self.render(0, env, surface=surface))
            self.assertNotRegex(self.render(120, env, surface=surface), "[╭\ue0b6]")


if __name__ == "__main__":
    unittest.main()
