"""What LitHermes already told the user is remembered, and each bounded run's end is recorded.

Notices and the cross-session goal offer are printed once per distinct content; a missing, damaged or
oversized record falls back to the earlier behaviour (print it). Run ends are recorded as
`sent`, `nothing` or `waiting`. Everything runs in scratch folders: no network, no model call.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

try:
    from .natural_routing_test_support import NaturalRoutingCase
    from .test_bounded_autopilot import _AutopilotCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase
    from test_bounded_autopilot import _AutopilotCase

from litgoal import runtime, store  # noqa: E402  (path set up by the support module)

VERSION = "9.1.2"
OFFER_MARK = "type lit to resume"
EXTENSIONS_MARK = "LitFamily extensions"


class NoticeRecord(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.home = Path(os.environ["HERMES_HOME"])
        self.notices = self.home / "lithermes" / "notices"
        self.notices.mkdir(parents=True)
        (self.home / "lithermes" / "install-manifest.json").write_text(json.dumps({"version": VERSION}), encoding="utf-8")
        self.record = self.home / "lithermes" / "shown.jsonl"

    def write(self, name: str = "extensions", **record):
        fields = {"version": VERSION, "upgradedFrom": None, "leftovers": []} if name == "extensions" else {}
        (self.notices / f"{name}.json").write_text(
            json.dumps({"schemaVersion": 1, "kind": name, **fields, **record}), encoding="utf-8"
        )

    def reply(self, text: str = "ok", session: str = "s1") -> str:
        return self.pkg._transform_llm_output_with_offer(session_id=session, response_text=text, platform="cli") or text

    def test_the_same_notice_written_again_is_shown_once(self):
        self.write(writtenAt="2026-11-01T00:00:00Z")
        self.assertIn(EXTENSIONS_MARK, self.reply(session="s1"))
        self.write(writtenAt="2026-11-02T00:00:00Z")
        self.assertEqual(self.reply(session="s2"), "ok")
        self.assertFalse((self.notices / "extensions.json").exists(), "a repeat is still claimed, so it cannot pile up")

    def test_a_notice_with_new_content_is_shown_again(self):
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply())
        self.write(upgradedFrom="1.0.39", leftovers=["/x/.cache/lithermes/office"])
        self.assertIn("left these behind", self.reply(session="s2"))

    def test_the_language_of_the_reply_does_not_make_it_a_new_notice(self):
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply("Done."))
        self.write()
        self.assertEqual(self.reply("고쳤습니다.", session="s2"), "고쳤습니다.")

    def test_a_blocked_update_is_shown_once_per_content(self):
        self.write("update-blocked", targetVersion="9.2.0", currentVersion=VERSION, summary="skills/x changed", remedy="npx fix")
        self.assertIn("could not update to 9.2.0", self.reply())
        self.write("update-blocked", targetVersion="9.2.0", currentVersion=VERSION, summary="skills/x changed", remedy="npx fix")
        self.assertEqual(self.reply(session="s2"), "ok")
        self.write("update-blocked", targetVersion="9.3.0", currentVersion=VERSION, summary="skills/x changed", remedy="npx fix")
        self.assertIn("could not update to 9.3.0", self.reply(session="s3"))

    def test_the_record_is_one_json_line_per_notice_with_no_notice_text(self):
        self.write()
        self.reply()
        lines = self.record.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 1)
        entry = json.loads(lines[0])
        self.assertEqual((entry["kind"], entry["name"]), ("notice", "extensions"))
        self.assertRegex(entry["hash"], r"^[0-9a-f]{16}$")
        self.assertNotIn("LitHermes", lines[0])

    def test_a_damaged_record_behaves_as_before_and_then_heals(self):
        self.record.write_text("{not json\n\x00\x01\n[1,2]\n", encoding="utf-8")
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply())
        self.write()
        self.assertEqual(self.reply(session="s2"), "ok")

    def test_a_missing_record_behaves_as_before(self):
        self.assertFalse(self.record.exists())
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply())

    def test_a_record_that_cannot_be_written_never_costs_the_notice(self):
        self.record.mkdir()
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply())
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply(session="s2"), "no record means the earlier behaviour")

    def test_a_symlinked_record_is_never_written_through(self):
        victim = self.home / "victim.txt"
        victim.write_text("keep", encoding="utf-8")
        self.record.symlink_to(victim)
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply())
        self.assertEqual(victim.read_text(encoding="utf-8"), "keep")

    def test_an_oversized_record_is_ignored_and_not_grown(self):
        self.write()
        self.reply()
        size = 300 * 1024
        self.record.write_text(self.record.read_text(encoding="utf-8") + "x" * size, encoding="utf-8")
        self.write()
        self.assertIn(EXTENSIONS_MARK, self.reply(session="s2"), "past the cap the record is not trusted")
        self.assertLess(self.record.stat().st_size, size + 1024)


class OfferRecord(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-shown-project-")
        self.addCleanup(self.project.cleanup)
        self.ws = Path(self.project.name).resolve()
        previous = os.getcwd()
        os.chdir(self.ws)
        self.addCleanup(os.chdir, previous)
        self.core._lit_reentry._GOAL_OFFERS.clear()
        self.core._lit_reentry._ACTIVE.clear()
        env = patch.dict(os.environ, {"LITHERMES_GOAL_RESUME": "1"})
        env.start()
        self.addCleanup(env.stop)
        self.record = self.ws / ".hermes" / "lithermes" / "shown.jsonl"

    def seed(self, session: str, objective: str = "ship the parser", criteria: int = 2):
        runtime.create_goal(
            self.ws, objective, title=objective, session_id=session,
            criteria=[{"scenario": f"scenario {n}"} for n in range(criteria)],
        )

    def session(self, session: str, message: str = "hello") -> tuple[str, str]:
        context = (self.pkg._pre_llm_call(user_message=message, session_id=session, platform="cli") or {}).get("context", "")
        shown = self.pkg._transform_llm_output_with_offer(session_id=session, response_text="ok", platform="cli") or "ok"
        return context, shown

    def test_the_same_offer_in_three_sessions_is_said_once(self):
        self.seed("old")
        context, shown = self.session("s1")
        self.assertIn("lithermes-goal-resume-offer", context)
        self.assertIn(OFFER_MARK, shown)
        for later in ("s2", "s3"):
            context, shown = self.session(later)
            self.assertNotIn("lithermes-goal-resume-offer", context, later)
            self.assertNotIn(OFFER_MARK, shown, later)

    def test_an_offer_whose_text_changed_is_said_again(self):
        self.seed("old", criteria=2)
        self.session("s1")
        self.seed("newer", "a different goal", criteria=1)
        _, shown = self.session("s2")
        self.assertIn("a different goal", shown)

    def test_a_repeated_offer_can_still_be_adopted_with_a_bare_lit(self):
        self.seed("old", "ship the parser")
        self.session("s1")
        self.session("s2")
        self.pkg._pre_llm_call(user_message="lit", session_id="s2", platform="cli")
        adopted = json.loads(store.goals_path(self.ws, "s2").read_text(encoding="utf-8"))
        self.assertEqual(adopted["adopted_from"], "old")

    def test_a_damaged_or_missing_record_offers_again(self):
        self.seed("old")
        self.session("s1")
        self.record.write_text("{broken\n", encoding="utf-8")
        _, shown = self.session("s2")
        self.assertIn(OFFER_MARK, shown)
        self.record.unlink()
        _, shown = self.session("s3")
        self.assertIn(OFFER_MARK, shown)

    def test_the_record_lives_in_the_project_not_the_hermes_home(self):
        self.seed("old")
        self.session("s1")
        self.assertTrue(self.record.is_file())
        self.assertFalse((Path(os.environ["HERMES_HOME"]) / "lithermes" / "shown.jsonl").exists())


class RunEnds(_AutopilotCase):
    def ends(self, work_id):
        return self.bw.shown_record.outcomes(self.ws / ".hermes" / "lithermes", work_id)

    def test_a_completed_run_is_recorded_as_sent(self):
        work_id = self._start(complete=True)
        self.bw.complete_bounded_work(self.ws, work_id, self._state(work_id)["revision"])
        entries = self.ends(work_id)
        self.assertEqual([entry["outcome"] for entry in entries], ["sent"])
        self.assertEqual(entries[0]["status"], "completed")

    def test_a_cancelled_run_is_recorded_as_nothing(self):
        work_id = self._start()
        self.bw.cancel_bounded_work(self.ws, work_id, self._state(work_id)["revision"])
        self.assertEqual([entry["outcome"] for entry in self.ends(work_id)], ["nothing"])

    def test_a_run_left_with_a_session_is_recorded_as_waiting_with_its_parked_steps(self):
        work_id = self._start(session="gone")
        self._write(self.ws / "docs" / "a.md", session="gone")
        self.pkg._release_bounded_session(session_id="gone")
        entries = self.ends(work_id)
        self.assertEqual([entry["outcome"] for entry in entries], ["waiting"])
        self.assertEqual(entries[0]["parked"], 1)

    def test_an_unwritable_record_never_costs_the_run_its_end(self):
        work_id = self._start(complete=True)
        (self.ws / ".hermes" / "lithermes" / "shown.jsonl").mkdir()
        completed = self.bw.complete_bounded_work(self.ws, work_id, self._state(work_id)["revision"])
        self.assertEqual(completed["status"], "completed")

    def test_only_the_three_outcomes_are_accepted(self):
        shown = self.bw.shown_record
        self.assertFalse(shown.record_outcome(self.ws / ".hermes" / "lithermes", "w", "done"))
        self.assertEqual(shown.outcomes(self.ws / ".hermes" / "lithermes"), [])
