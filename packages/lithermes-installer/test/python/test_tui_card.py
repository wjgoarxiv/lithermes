"""The record behind the Ink TUI card, and the still sunset on the classic HUD card."""

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


class Records(unittest.TestCase):
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


class StillSunset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.card, cls.sunset = cls.pkg.hud_card, cls.pkg.hud_card.sunset

    def render(self, columns=120, env=None, snapshot=None, surface="cli"):
        with mock.patch.object(self.sunset, "_columns", lambda: columns):
            return self.card.render(snapshot or _snapshot(), "litwork", surface, env or COLOUR_ENV)

    def test_the_words_stay_and_the_sun_stands_beside_them(self):
        for title in ("Fix the export", "분기 내보내기 합계가 맞도록 고치기", "x" * 300):
            snapshot = _snapshot(goal={"id": "G1", "title": title, "objective": "", "status": "active"})
            without, scene = self.render(0, snapshot=snapshot).splitlines(), self.render(snapshot=snapshot).splitlines()
            self.assertEqual(len(without), len(scene))
            self.assertEqual(without[0], scene[0])
            for before, after in zip(without, scene):
                self.assertTrue(after.startswith(before), after)
                self.assertLessEqual(self.sunset.cells(after), self.sunset.WIDTH)
                rest = _ANSI.sub("", after[len(before):])
                if rest.strip():
                    self.assertTrue(rest.startswith("  "), rest)
        self.assertRegex("\n".join(self.render().splitlines()), SUN)

    def test_no_room_no_colour_and_light_backgrounds_keep_the_old_card(self):
        plain = self.render(0)
        for columns in (0, 40, 79):
            self.assertEqual(self.render(columns), plain)
        for name, value in (("COLORFGBG", "0;15"), ("HERMES_LIGHT", "1"), ("HERMES_TUI_THEME", "light"), ("HERMES_TUI_BACKGROUND", "#ffffff")):
            self.assertEqual(self.render(env={**COLOUR_ENV, name: value}), plain, name)
        self.assertRegex(self.render(env={**COLOUR_ENV, "COLORFGBG": "15;0"}), SUN)
        long_runs = _snapshot()
        long_runs["receipts"] = [{**row, "id": "R" + "0" * 20, "stale": True} for row in long_runs["receipts"]]
        self.assertNotRegex(self.render(snapshot=long_runs), "[▁▂▃]")
        for surface, env in (("tui", COLOUR_ENV), ("local", COLOUR_ENV), ("desktop", COLOUR_ENV), ("cli", {"LANG": "en_US.UTF-8"}), ("cli", {**COLOUR_ENV, "NO_COLOR": "1"})):
            self.assertEqual(self.render(120, env, surface=surface), self.render(0, env, surface=surface))
        first = self.card.render(None, "litwork", "cli", COLOUR_ENV)
        self.assertNotRegex(first, "[▁▂▃]")

    def test_the_picture_is_the_same_every_time(self):
        self.assertEqual(self.render(), self.render())


if __name__ == "__main__":
    unittest.main()
