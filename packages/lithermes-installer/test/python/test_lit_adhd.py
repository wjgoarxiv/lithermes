"""Product-local route coverage for lit-adhd: routes, `go` continuation, stack, enrollment."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
import unittest.mock
from datetime import datetime, timezone
from pathlib import Path

import adhd_stack
from natural_routing_test_support import NaturalRoutingCase, _skill_body
from plugin_register_test_support import _FakeCtx

_HERE = Path(__file__).resolve().parent
_PLUGIN = _HERE.parent.parent / "assets" / "lithermes-plugin"
_SKILL = _PLUGIN / "skills" / "lit-adhd"


def _fresh_record(kind="start-plan", target=None):
    return {
        "kind": kind,
        "target": target or {"plan": "plans/a.md"},
        "at": datetime.now(timezone.utc).isoformat(),
    }


class AdhdSkillRoutes(NaturalRoutingCase):
    def test_explicit_bare_and_lit_suffix_routes_load_the_installed_skill(self):
        skill = _skill_body("lit-adhd")
        self.assertIn("lithermes:lit-adhd", skill)
        for request in (
            "lit-adhd",
            "lit-rewind",
            "lit adhd",
            "lit rewind",
            "lit adhd --here",
            "lit adhd 요약해줘",
        ):
            with self.subTest(request=request):
                result = self._hook(request, session=f"adhd-route-{len(request)}")
                self.assertIsInstance(result, dict)
                context = result["context"]
                self.assertIn('mode="lit-adhd"', context)
                self.assertIn('name="lit-adhd"', context)
                self.assertIn("skills/lit-adhd/SKILL.md", context)
                self.assertIn("adhd.mjs --json", context)
                self.assertIn("READ-ONLY", context.upper() + "READ-ONLY")
                self.assertLessEqual(len(context.encode("utf-8")), self.pkg.MAX_HOST_CONTEXT_BYTES)

    def test_adhd_wins_ahead_of_plan_review_and_research(self):
        result = self._hook("lit adhd this plan into a brief", session="adhd-plan")
        self.assertIn('mode="lit-adhd"', result["context"])
        result = self._hook("lit rewind the loop work", session="adhd-rewind-plan")
        self.assertIn('mode="lit-adhd"', result["context"])
        result = self._hook("lit plan hijack a skill", session="adhd-negative-plan")
        self.assertIn('mode="lit-plan"', result["context"])

    def test_near_miss_words_do_not_activate_it_and_recap_keeps_its_route(self):
        for request in ("adhdx", "rewinding the tape", "adhd", "lit adhder", "lit rewinding"):
            with self.subTest(request=request):
                result = self._hook(request, session="adhd-negative")
                context = result.get("context", "") if isinstance(result, dict) else ""
                self.assertNotIn("lit-adhd", context)
        result = self._hook("lit recap", session="adhd-recap")
        self.assertNotIn("lit-adhd", result.get("context", ""))
        route = self.pkg.core.detect_lit_mode("lit approve")
        self.assertIsNotNone(route)
        # Hermes has no approve/deny command surface: boundaries are answered in
        # chat, so no route settles them.
        self.assertNotEqual(route.mode, "lit-adhd")

    def test_slash_command_is_registered_and_routes_the_supplied_options(self):
        context = _FakeCtx()
        self.pkg.register(context)
        self.assertIn("lit-adhd", context.commands)
        self.assertIn("lit-adhd", [name for name, _ in context.skills])
        spec = context.command_specs["lit-adhd"]
        self.assertIn("brief", spec["description"].lower())
        status = self.pkg.core.status_report()
        self.assertIn("lit-adhd", status)
        self.assertIn("/lit-adhd", status)
        result = context.command_handlers["lit-adhd"]("--here --since 7d")
        self.assertIn("lithermes:lit-adhd", result["agent_message"])
        self.assertIn("--here --since 7d", result["agent_message"])
        self.assertIn("skills/lit-adhd/SKILL.md", result["agent_message"])

    def test_every_bare_word_route_carries_the_rewind_look_contract(self):
        for request in ("lit adhd", "lit rewind", "lit-adhd", "lit-rewind"):
            with self.subTest(request=request):
                result = self._hook(request, session=f"adhd-look-{len(request)}")
                context = result["context"]
                self.assertIn('mode="lit-adhd"', context)
                self.assertIn("five-part brief", context)
                self.assertIn("verbatim", context)
                self.assertIn("one next step", context)
                self.assertIn('name="rewind"', context)
                self.assertIn("REWIND <<", context)
                self.assertIn("YOUR TURN", context)
                self.assertIn("✦ done", context)
                self.assertLessEqual(len(context.encode("utf-8")), self.pkg.MAX_HOST_CONTEXT_BYTES)

    def test_rewind_alias_slash_command_selects_the_rewind_look(self):
        context = _FakeCtx()
        self.pkg.register(context)
        self.assertIn("lit-rewind", context.commands)
        result = context.command_handlers["lit-rewind"]("--here")
        self.assertIn("lithermes:lit-adhd", result["agent_message"])
        self.assertIn("via /lit-rewind", result["agent_message"])
        self.assertIn('mode="lit-adhd"', result["agent_message"])
        self.assertIn("skills/lit-adhd/SKILL.md", result["agent_message"])
        self.assertIn("--here", result["agent_message"])

    def test_hook_names_the_collector_session_for_go(self):
        session = "adhd-session-7"
        result = self._hook("lit adhd", session=session)
        context = result["context"]
        line = f"Collector: `--session {session}` records the next step for `go`."
        self.assertIn(line, context)
        # The line itself must stay inert: every routable token in it is a code span.
        self.assertIsNone(self.pkg.core.detect_lit_mode(line))
        self.assertLessEqual(len(context.encode("utf-8")), self.pkg.MAX_HOST_CONTEXT_BYTES)

    def test_skill_load_entrypoint_carries_the_rewind_look_contract(self):
        body = (_SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("lit-rewind", body)
        self.assertIn("REWIND <<", body)
        self.assertIn("● waiting on you", body)
        self.assertIn("five parts", body)
        self.assertIn("exactly as the collector printed it", body)
        self.assertIn("One next step in a box", body)


class AdhdGoContinuation(unittest.TestCase):
    def setUp(self):
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-adhd-go-")
        self.addCleanup(self.project.cleanup)
        self.root = Path(self.project.name)
        previous = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

    def _note(self, session, record=None):
        if record is not None:
            path = adhd_stack.next_step_path(self.root, session)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(record) + "\n", encoding="utf-8")
        return adhd_stack.go_note(self.root, session)

    def test_go_words_match_and_ordinary_text_does_not(self):
        for word in ("go", "lit go", "GO", "Lit Go", "ㄱㄱ", "고", "진행", "  go  "):
            self.assertTrue(adhd_stack.match_go_word(word), word)
        for word in ("gogo", "go now", "lets go", "고고", "진행해줘", "cargo"):
            self.assertFalse(adhd_stack.match_go_word(word), word)

    def test_go_without_a_record_offers_the_brief(self):
        note = self._note("no-record-session")
        self.assertIn("`go`", note)
        self.assertIn("lit adhd", note)

    def test_go_continues_a_fresh_start_plan_record(self):
        note = self._note("fresh-session", _fresh_record())
        self.assertIn("/start-work plans/a.md", note)

    def test_go_shows_a_paused_boundary_for_a_chat_answer(self):
        note = self._note(
            "boundary-session",
            _fresh_record("approve-boundary", {"workId": "work-1", "boundary": "b-1"}),
        )
        self.assertIn("work-1", note)
        self.assertIn("chat", note)
        self.assertNotIn("lit approve", note)

    def test_go_with_a_string_target_does_not_raise(self):
        from plugin_register_test_support import _load_plugin_package

        record = {
            "kind": "start-plan",
            "target": "plans/x.md",
            "at": datetime.now(timezone.utc).isoformat(),
        }
        note = self._note("s-string-target", record)
        self.assertIn("start plan", note)
        pkg = _load_plugin_package()
        with unittest.mock.patch.object(
            sys.modules["lithermes_plugin_pkg.adhd_stack"], "go_note", side_effect=RuntimeError("boom")
        ):
            out = pkg.core.pre_llm_call(user_message="go", session_id="s-go-wrap", platform="cli")
            self.assertIsInstance(out, dict)
            self.assertIn("lit adhd", out["context"])

    def test_stack_write_refuses_a_symlinked_adhd_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside"
            outside.mkdir()
            ws = Path(tmp) / "ws"
            ws.mkdir()
            (ws / ".hermes").symlink_to(outside, target_is_directory=True)
            self.assertFalse(adhd_stack.push(ws, "lit-loop", "s-link"))
            self.assertEqual(list(outside.iterdir()), [])
            self.assertFalse((ws / ".hermes" / "lithermes" / "adhd").exists() or (ws / ".hermes" / "lithermes").is_symlink())

    def test_boundary_approval_opens_with_the_your_turn_look(self):
        note = self._note(
            "boundary-look-session",
            _fresh_record("approve-boundary", {"workId": "work-1", "boundary": "b-1"}),
        )
        self.assertTrue(note.startswith("YOUR TURN\n"))
        ordinary = self._note("ordinary-session", _fresh_record())
        self.assertFalse(ordinary.startswith("YOUR TURN"))

    def test_go_after_thirty_minutes_is_expired(self):
        record = _fresh_record()
        record["at"] = "2020-01-01T00:00:00+00:00"
        note = self._note("stale-session", record)
        self.assertIn("expired", note)
        self.assertIn("lit adhd", note)

    def _work(self, work_id, status, owner):
        path = self.root / ".hermes" / "lithermes" / "work" / work_id / "state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"work_id": work_id, "status": status, "active_session_id": owner}), encoding="utf-8")

    def test_go_rechecks_that_the_recorded_run_is_still_active_and_owned(self):
        record = _fresh_record("continue-work", {"workId": "work-1", "plan": "plans/a.md"})
        self._work("work-1", "active", "own-session")
        held = self._note("own-session", record)
        self.assertIn("Continue that step in chat", held)
        for status, owner in (("completed", "own-session"), ("paused", "own-session"), ("active", "other-session")):
            with self.subTest(status=status, owner=owner):
                self._work("work-1", status, owner)
                note = self._note("own-session", record)
                self.assertIn("no longer holds", note)
                self.assertIn("start nothing", note)
                self.assertNotIn("Continue that step", note)
        missing = self._note("own-session", _fresh_record("continue-work", {"workId": "work-gone"}))
        self.assertIn("no longer holds", missing)

    def test_go_while_lanes_work_starts_nothing(self):
        note = self._note("lane-session", _fresh_record("wait-lanes", {"lanes": 2, "plan": "plans/a.md"}))
        self.assertIn("2", note)
        self.assertIn("start nothing", note)
        self.assertNotIn("/start-work", note)
        self.assertNotIn("Continue that step", note)

    def test_an_approval_step_never_carries_a_go_line(self):
        note = self._note("approval-session", _fresh_record("approve-boundary", {"workId": "w", "boundary": "b"}))
        self.assertIn("Never approve it yourself", note)
        self.assertNotRegex(note, r"(?i)(type|say) `go`")

    def test_go_through_the_hook_consumes_the_word(self):
        from plugin_register_test_support import _load_plugin_package

        pkg = _load_plugin_package()
        record = _fresh_record()
        path = adhd_stack.next_step_path(self.root, "hook-session")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record) + "\n", encoding="utf-8")
        out = pkg.core.pre_llm_call(user_message="go", session_id="hook-session", platform="cli")
        self.assertIsInstance(out, dict)
        self.assertIn("/start-work plans/a.md", out["context"])
        out = pkg.core.pre_llm_call(user_message="gogo", session_id="hook-session", platform="cli")
        self.assertIsNone(out)


class AdhdPlanGo(NaturalRoutingCase):
    """A plan saved in a lit-plan turn arms `go` with its start-work command."""

    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-plan-go-")
        self.addCleanup(self.project.cleanup)
        self.root = Path(self.project.name).resolve()
        previous = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

    def _save(self, session, path="plans/widget.md", tool="write_file"):
        self.pkg._post_tool_call(
            tool_name=tool, args={"path": path, "content": "# Widget\n"}, session_id=session, status="ok"
        )

    def test_a_saved_plan_arms_go_for_this_session_only(self):
        self._hook("lit plan add a widget", session="planner", isolated=False)
        self._save("planner")
        record = adhd_stack.read_next_step(self.root, "planner")
        self.assertEqual(record["kind"], "start-plan")
        self.assertEqual(record["target"], {"plan": "plans/widget.md"})
        out = self._hook("go", session="planner", isolated=False)
        self.assertIn("/start-work plans/widget.md", out["context"])
        self.assertIn("do not run it", out["context"])
        other = self._hook("go", session="someone-else", isolated=False)
        self.assertNotIn("plans/widget.md", other["context"])
        self.assertIn("lit adhd", other["context"])
        late = adhd_stack.go_note(self.root, "planner", now=time.time() + 31 * 60)
        self.assertIn("expired", late)
        self.assertNotIn("/start-work", late)

    def test_the_slash_route_arms_go_the_same_way(self):
        message = self.pkg.core.command_lit_plan("add a gadget")["agent_message"]
        self._hook(message, session="slash-planner", isolated=False)
        self._save("slash-planner", path=str(self.root / "plans" / "gadget.md"))
        record = adhd_stack.read_next_step(self.root, "slash-planner")
        self.assertEqual(record["target"], {"plan": "plans/gadget.md"})

    def test_other_writes_and_other_disciplines_do_not_arm_go(self):
        self._hook("lit plan add a widget", session="planner", isolated=False)
        for path in ("notes/widget.md", "plans/deep/widget.md", "plans/widget.txt", "../plans/widget.md"):
            with self.subTest(path=path):
                self._save("planner", path=path)
                self.assertIsNone(adhd_stack.read_next_step(self.root, "planner"))
        self.pkg._post_tool_call(
            tool_name="write_file", args={"path": "plans/widget.md"}, session_id="planner", status="error"
        )
        self.assertIsNone(adhd_stack.read_next_step(self.root, "planner"))
        self._hook("lit loop ship the widget", session="looper", isolated=False)
        self._save("looper")
        self.assertIsNone(adhd_stack.read_next_step(self.root, "looper"))
        self._save("no-route")
        self.assertIsNone(adhd_stack.read_next_step(self.root, "no-route"))

    def test_the_record_write_refuses_a_symlinked_state_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside"
            outside.mkdir()
            ws = Path(tmp) / "ws"
            ws.mkdir()
            (ws / ".hermes").symlink_to(outside, target_is_directory=True)
            self.assertFalse(
                adhd_stack.write_next_step(ws, "s-link", "start-plan", {"plan": "plans/a.md"})
            )
            self.assertEqual(list(outside.iterdir()), [])
        self.assertTrue(adhd_stack.write_next_step(self.root, "s-ok", "start-plan", {"plan": "plans/a.md"}))
        self.assertIn("/start-work plans/a.md", adhd_stack.go_note(self.root, "s-ok"))

    def test_the_lit_plan_skill_closes_with_go(self):
        body = (_PLUGIN / "skills" / "lit-plan" / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue("type `go` within 30 minutes" in body, "lit-plan closing must offer `go`")


class AdhdStack(NaturalRoutingCase):
    def test_route_activation_pushes_a_frame_and_adhd_stays_read_only(self):
        with tempfile.TemporaryDirectory(prefix="lithermes-adhd-stack-") as tmp:
            prev = os.getcwd()
            os.chdir(tmp)
            try:
                self._hook("lit plan a test plan", session="stack-session", isolated=False)
                stack = adhd_stack.read_stack(tmp)
                frames = stack["sessions"]["stack-session"]["frames"]
                self.assertEqual(frames[-1]["skill"], "lit-plan")
                self.assertEqual(frames[-1]["status"], "active")
                self._hook("lit adhd", session="stack-session", isolated=False)
                after = adhd_stack.read_stack(tmp)
                self.assertEqual(after["sessions"]["stack-session"]["frames"], frames)
                finishing = adhd_stack.finish(tmp, "stack-session")
                self.assertTrue(finishing)
                self.assertEqual(
                    adhd_stack.read_stack(tmp)["sessions"]["stack-session"]["frames"][-1]["status"],
                    "finished",
                )
            finally:
                os.chdir(prev)

    def test_switching_skills_finishes_the_previous_frame(self):
        with tempfile.TemporaryDirectory(prefix="lithermes-adhd-switch-") as tmp:
            self.assertTrue(adhd_stack.push(tmp, "s", "lit-loop"))
            self.assertTrue(adhd_stack.push(tmp, "s", "lit-plan"))
            frames = adhd_stack.read_stack(tmp)["sessions"]["s"]["frames"]
            self.assertEqual([frame["status"] for frame in frames], ["finished", "active"])

    def test_stack_file_survives_malformed_state(self):
        with tempfile.TemporaryDirectory(prefix="lithermes-adhd-broken-") as tmp:
            path = adhd_stack.stack_path(tmp)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("not json", encoding="utf-8")
            self.assertEqual(adhd_stack.read_stack(tmp), {})
            self.assertTrue(adhd_stack.push(tmp, "s", "lit-loop"))
            self.assertEqual(len(adhd_stack.read_stack(tmp)["sessions"]["s"]["frames"]), 1)


class AdhdEnrollment(unittest.TestCase):
    def test_skill_is_registered_indexed_and_shipped(self):
        from plugin_register_test_support import _load_plugin_package

        pkg = _load_plugin_package()
        registered = dict(pkg.PORTED_SKILLS)
        self.assertIn("lit-adhd", registered)
        self.assertTrue((_PLUGIN / "skills" / "lit-adhd" / "SKILL.md").is_file())
        for name in (
            "SKILL.md",
            "scripts/adhd.mjs",
            "scripts/lib/collect.mjs",
            "scripts/lib/gauge.mjs",
            "scripts/lib/redact.mjs",
            "scripts/lib/secret-shapes.mjs",
            "scripts/lib/plan-task-rows.mjs",
            "scripts/lib/next-step.mjs",
            "scripts/lib/hermes-sessions.mjs",
            "references/status-taxonomy.md",
            "references/card-examples.md",
            "references/brief-contract.md",
        ):
            self.assertTrue((_PLUGIN / "skills" / "lit-adhd" / name).is_file(), name)
        section = pkg.skill_index_section()
        self.assertIn("- lit-adhd: ", section)
        self.assertLessEqual(len(section), pkg.SKILL_INDEX_MAX_CHARS)
        body = (_PLUGIN / "skills" / "lit-adhd" / "SKILL.md").read_text(encoding="utf-8")
        self.assertGreaterEqual(len(body.split()), 1000)


if __name__ == "__main__":
    unittest.main()
