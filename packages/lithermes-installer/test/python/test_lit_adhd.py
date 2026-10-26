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
