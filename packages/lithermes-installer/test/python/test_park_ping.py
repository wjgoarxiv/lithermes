"""One message per parked step, off by default, never an approval.

A bounded run parks a call its grants do not cover. With `/lit-loop ping on` (or LITHERMES_PARK_PING=1)
the hook call that parks it posts one line through ctx.post_message naming the step and the words to
type; a retry of the same call posts nothing. Off, nothing is posted or recorded. Without a session or
gateway Hermes refuses the post and the plugin records `no signal` in shown.jsonl. Scratch folders only.
"""

from __future__ import annotations

import os
from unittest import mock

try:
    from .plugin_register_test_support import _FakeCtx
    from .test_bounded_autopilot import _AutopilotCase
except ImportError:
    from plugin_register_test_support import _FakeCtx
    from test_bounded_autopilot import _AutopilotCase


class _Handle:
    def __init__(self, ok: bool, error: str | None = None):
        self.ok = ok
        self.error = error


class _PostingCtx(_FakeCtx):
    """A plugin context whose post_message is the gateway: it records each text, or refuses all."""

    def __init__(self, refuse: str | None = None):
        super().__init__()
        self.posted: list[str] = []
        self.refuse = refuse

    def post_message(self, text):
        if self.refuse:
            return _Handle(False, self.refuse)
        self.posted.append(text)
        return _Handle(True)


class ParkPing(_AutopilotCase):
    def setUp(self):
        super().setUp()
        self.ctx = _PostingCtx()
        self.pkg.register(self.ctx)
        self.state = self.ws / ".hermes" / "lithermes"
        for name in [key for key in os.environ if key.startswith("LITHERMES_PARK")]:
            self.addCleanup(os.environ.__setitem__, name, os.environ.pop(name))

    def on(self):
        env = mock.patch.dict(os.environ, {"LITHERMES_PARK_PING": "1"})
        env.start()
        self.addCleanup(env.stop)

    def pings(self, work_id=None):
        return self.bw.shown_record.pings(self.state, work_id)

    def test_with_the_switch_on_a_parked_step_posts_exactly_one_message(self):
        self.on()
        work_id = self._start()
        blocked = self._write(self.ws / "docs" / "a.md")
        self.assertIn("queued write", blocked["message"])
        self.assertEqual(len(self.ctx.posted), 1)
        text = self.ctx.posted[0]
        self.assertIn(work_id, text)
        self.assertIn("docs/a.md", text)
        self.assertIn("lit approve", text)
        self.assertIn("lit deny", text)
        self.assertEqual([entry["result"] for entry in self.pings(work_id)], ["sent"])

    def test_retries_of_the_same_call_post_nothing_more(self):
        self.on()
        self._start()
        for _ in range(4):
            self._write(self.ws / "docs" / "a.md")
        self.assertEqual(len(self.ctx.posted), 1)

    def test_a_second_different_parked_step_gets_its_own_message(self):
        self.on()
        self._start()
        self._write(self.ws / "docs" / "a.md")
        self._write(self.ws / "docs" / "b.md")
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(len(self.ctx.posted), 2)

    def test_off_by_default_nothing_is_posted_or_recorded(self):
        self._start()
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(self.ctx.posted, [])
        self.assertEqual(self.pings(), [])

    def test_the_environment_zero_wins_over_a_saved_on(self):
        self.assertIn("is on", self.pkg.park_ping.run_command("ping on"))
        env = mock.patch.dict(os.environ, {"LITHERMES_PARK_PING": "0"})
        env.start()
        self.addCleanup(env.stop)
        self._start()
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(self.ctx.posted, [])

    def test_the_saved_switch_turns_it_on_and_off(self):
        ping = self.pkg.park_ping
        self.assertIn("is off (the default)", ping.run_command("ping"))
        self.assertIn("is on", ping.run_command("ping on"))
        self.assertIn("is on (your saved setting)", ping.run_command("ping status"))
        self._start()
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(len(self.ctx.posted), 1)
        self.assertIn("is off", ping.run_command("ping off"))
        self._write(self.ws / "docs" / "b.md")
        self.assertEqual(len(self.ctx.posted), 1)

    def test_lit_loop_routes_the_ping_switch_and_nothing_else(self):
        reply = self.pkg.core.command_lit_loop("ping on")
        self.assertIsInstance(reply, str)
        self.assertIn("is on", reply)
        self.assertEqual(self.pkg.park_ping.run_command("pong on"), None)
        self.assertIn("Usage", self.pkg.park_ping.run_command("ping maybe"))

    def test_a_damaged_settings_file_leaves_it_off(self):
        path = self.pkg.park_ping.settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{broken", encoding="utf-8")
        self._start()
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(self.ctx.posted, [])

    def test_no_gateway_records_no_signal_and_does_nothing_else(self):
        refusing = _PostingCtx(refuse="gateway_unavailable")
        self.pkg.register(refusing)
        self.on()
        work_id = self._start()
        blocked = self._write(self.ws / "docs" / "a.md")
        self.assertIn("queued write", blocked["message"], "the park itself is unchanged")
        entries = self.pings(work_id)
        self.assertEqual([entry["result"] for entry in entries], ["no signal"])
        self.assertEqual(entries[0]["error"], "gateway_unavailable")
        self._write(self.ws / "docs" / "a.md")
        self.assertEqual(len(self.pings(work_id)), 1, "a retry neither re-posts nor re-records")

    def test_a_post_that_raises_never_costs_the_park(self):
        class Exploding(_PostingCtx):
            def post_message(self, text):
                raise RuntimeError("boom")

        self.pkg.register(Exploding())
        self.on()
        work_id = self._start()
        self.assertIn("queued write", self._write(self.ws / "docs" / "a.md")["message"])
        self.assertEqual([entry["result"] for entry in self.pings(work_id)], ["no signal"])

    def test_the_ping_never_approves_the_step(self):
        self.on()
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        state = self._state(work_id)
        self.assertEqual(len(self._parked(work_id)), 1, "the step stays parked")
        self.assertFalse(
            any(str(grant.get("root", "")).endswith("docs") or "docs/a.md" in str(grant.get("root", ""))
                for grant in state.get("authority") or []),
            "no grant was added",
        )
        again = self._write(self.ws / "docs" / "a.md")
        self.assertEqual(again["action"], "block")

    def test_a_step_the_model_asks_for_through_progress_is_announced_once(self):
        self.on()
        work_id = self._start()
        revision = self._state(work_id)["revision"]
        boundary = {"id": "b-docs", "action": "write", "root": str(self.ws / "docs"), "reason": "docs row"}
        result = self.bw.record_bounded_progress(
            self.ws, work_id, expected_revision=revision, replay_id="r1", session_id="session-a",
            progress=[{"id": "T001", "status": "blocked"}], boundary=boundary,
        )
        self.assertEqual(result["outcome"], "parked")
        self.assertEqual(len(self.ctx.posted), 1)
        self.assertIn("docs", self.ctx.posted[0])
        self.bw.record_bounded_progress(
            self.ws, work_id, expected_revision=revision, replay_id="r1", session_id="session-a",
            progress=[{"id": "T001", "status": "blocked"}], boundary=boundary,
        )
        self.assertEqual(len(self.ctx.posted), 1, "a replay posts nothing")

    def test_the_message_is_one_plain_bounded_line(self):
        text = self.pkg.park_ping.message("w1", "write", "/x/" + "y" * 400 + "\x1b[31m")
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\n", text)
        self.assertLessEqual(len(text), 280)
