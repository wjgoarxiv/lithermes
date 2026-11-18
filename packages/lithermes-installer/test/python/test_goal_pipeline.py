"""One checkable goal per approved plan (S4).

`hermes lithermes goal propose plans/<f>.md` compiles the `## Done when` block into one condition,
lints it, and dry-runs the check to prove it is false now. Only an exact `yes` typed in the session
that was asked accepts; LitHermes never arms Hermes' native /goal, so acceptance hands the user the paste lines.
The turn-end hook runs the check as an advisory once every row is ticked.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

try:
    from .natural_routing_test_support import NaturalRoutingCase, _ASSET_DIR
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase, _ASSET_DIR

import goal_pipeline as gp  # noqa: E402

PLAN = """# Plan

## Todos
- [x] 1. Write the parser
- [ ] 2. Wire the route

## Final verification
- [ ] F1. Plan compliance

## Done when
- Every row above is ticked.
- check: `npm test`
"""


def _ran(code: int):
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return SimpleNamespace(returncode=code)

    return run, calls


class GoalPipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lithermes-goal-")
        self.addCleanup(self.tmp.cleanup)
        self.ws = Path(self.tmp.name) / "ws"
        self.ws.mkdir()
        home = patch.dict(os.environ, {"HERMES_HOME": str(Path(self.tmp.name) / "home")})
        home.start()
        self.addCleanup(home.stop)
        (self.ws / "plans").mkdir()
        self.plan = self.ws / "plans" / "p.md"
        self.plan.write_text(PLAN, encoding="utf-8")

    def test_condition_is_compiled_exactly_and_capped(self):
        built = gp.compile_condition("plans/p.md", "npm test")
        self.assertEqual(
            built["condition"],
            f"Every row in plans/p.md is ticked and `npm test` exits 0 [lit:{gp.goal_id('plans/p.md', 'npm test')}]",
        )
        self.assertFalse(gp.compile_condition("plans/p.md", "node --test " + "a" * 500)["ok"])

    def test_lint_rejects_judgment_words_and_outward_only_checks(self):
        for check in ("npm test works", "git push origin main", "npm publish", "rm -rf build", "잘 동작하면"):
            self.assertFalse(gp.lint_condition("x", check)["ok"], check)
        for check in ("npm test", "npm run check", "node --test test/a.test.js", "pytest -q", "bash scripts/verify.sh"):
            self.assertTrue(gp.lint_condition("x", check)["ok"], check)

    def test_propose_asks_the_exact_consent_line_after_a_failing_dry_run(self):
        run, calls = _ran(1)
        out = gp.propose(self.ws, "plans/p.md", run=run)
        condition = gp.compile_condition("plans/p.md", "npm test")["condition"]
        self.assertEqual(out["line"], f"Approve plan, start work and set goal: /goal {condition}? (yes / edit / no)")
        self.assertEqual(calls[0][0], ["npm", "test"])
        self.assertIs(calls[0][1]["shell"], False)
        self.assertEqual(calls[0][1]["stdin"], subprocess.DEVNULL)
        self.assertTrue((gp.goal_dir(self.ws) / "consent.json").is_file())

    def test_falsifier_refuses_a_goal_that_is_already_true(self):
        self.plan.write_text(PLAN.replace("- [ ] 2.", "- [x] 2."), encoding="utf-8")
        run, _ = _ran(0)
        self.plan.write_text(PLAN.replace("- [ ] 2.", "- [x] 2.").replace("- [ ] F1.", "- [x] F1."), encoding="utf-8")
        self.assertEqual(
            gp.propose(self.ws, "plans/p.md", run=run)["line"],
            "Approve plan and start work? (yes / no)\n"
            "No goal set: the goal is already true (every row is ticked and the check exits 0).",
        )

    def test_missing_block_goal_never_and_bad_check_are_skipped(self):
        run, calls = _ran(1)
        start_only = "Approve plan and start work? (yes / no)\n"
        self.plan.write_text("# Plan\n- [ ] 1. a\n", encoding="utf-8")
        self.assertEqual(gp.propose(self.ws, "plans/p.md", run=run)["line"], start_only + "No goal set: the plan has no `## Done when` block.")
        self.plan.write_text("# Plan\ngoal: never\n", encoding="utf-8")
        self.assertEqual(gp.propose(self.ws, "plans/p.md", run=run)["line"], start_only + "No goal set: this plan is marked goal: never.")
        self.plan.write_text(PLAN.replace("npm test", "it looks good"), encoding="utf-8")
        self.assertTrue(gp.propose(self.ws, "plans/p.md", run=run)["line"].startswith(start_only + "No goal set: "))
        self.assertEqual(calls, [])
        self.assertEqual(
            gp.propose(self.ws, "../outside.md", run=run)["line"],
            "Plan not started: give the plan as plans/<slug>.md inside this project.",
        )

    def _ask(self, run, session="s1", now=0.0):
        """Propose as the asking turn of `session`, then end that turn (which binds the question)."""
        out = gp.propose(self.ws, "plans/p.md", run=run, now=now)
        self.assertTrue(gp.bind_consent(self.ws, session, since=now))
        return out

    def _starter(self, ok=True, detail="<run context>"):
        calls = []

        def start(workspace, plan):
            calls.append((workspace, plan))
            return ok, detail

        return start, calls

    def test_only_an_exact_yes_to_a_live_question_starts_and_accepts(self):
        run, _ = _ran(1)
        consent = self._ask(run, now=1000.0)["consent"]
        start, started = self._starter()
        for other in ("yes please", "ok", "Y", "네", "go"):
            self.assertEqual(gp.answer_consent(self.ws, other, session_id="s1", now=1001.0, start=start), {})
        self.assertEqual(started, [])
        answer = gp.answer_consent(self.ws, "YES", session_id="s1", now=1001.0, start=start)
        self.assertEqual(started, [(self.ws, "plans/p.md")])
        self.assertEqual(
            answer["line"],
            "Work started from plans/p.md. Goal accepted, not set by LitHermes: Hermes /goal stays yours. "
            f"Paste these two lines to arm it: /goal {consent['condition']}  then  /goal gate add npm test",
        )
        self.assertEqual(answer["context"], "<run context>")
        self.assertTrue((gp.goal_dir(self.ws) / "intent.json").is_file())
        self.assertEqual(gp.answer_consent(self.ws, "yes", session_id="s1", now=1002.0, start=start), {})
        self.assertEqual(len(started), 1)

    def test_refused_start_sets_no_goal(self):
        run, _ = _ran(1)
        self._ask(run)
        start, _ = self._starter(ok=False, detail="BLOCKED: /start-work plan structure is invalid for plans/p.md.")
        answer = gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=start)
        self.assertEqual(answer, {"line": "Plan not started and no goal set: /start-work plan structure is invalid for plans/p.md."})
        self.assertFalse((gp.goal_dir(self.ws) / "intent.json").exists())

    def test_start_only_question_starts_without_a_goal(self):
        run, _ = _ran(1)
        self.plan.write_text(PLAN.replace("npm test", "it looks good"), encoding="utf-8")
        self._ask(run)
        start, started = self._starter()
        self.assertEqual(gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=start)["line"], "Work started from plans/p.md. No goal set.")
        self.assertEqual(len(started), 1)
        self.assertFalse((gp.goal_dir(self.ws) / "intent.json").exists())

    def test_another_session_or_an_unbound_question_starts_nothing(self):
        run, _ = _ran(1)
        start, started = self._starter()
        refused = {"line": "Approval not recorded for this session. Run: /start-work plans/p.md"}
        gp.propose(self.ws, "plans/p.md", run=run, now=0.0)
        self.assertEqual(gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=start), refused, "unbound")
        self.assertTrue(gp.bind_consent(self.ws, "s1", since=0.0))
        self.assertFalse(gp.bind_consent(self.ws, "s2", since=0.0), "a bound question is never re-bound")
        for other in ("s2", ""):
            self.assertEqual(gp.answer_consent(self.ws, "yes", session_id=other, now=1.0, start=start), refused, other)
            self.assertEqual(gp.answer_consent(self.ws, "no", session_id=other, now=1.0, start=start), {}, other)
        self.assertEqual(started, [])
        self.assertTrue((gp.goal_dir(self.ws) / "consent.json").is_file(), "the asker can still answer")
        self.assertEqual(gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=start)["line"][:28], "Work started from plans/p.md")

    def test_a_question_asked_before_this_turn_is_not_bound(self):
        run, _ = _ran(1)
        gp.propose(self.ws, "plans/p.md", run=run, now=10.0)
        self.assertFalse(gp.bind_consent(self.ws, "s1", since=20.0))
        self.assertFalse(gp.bind_consent(self.ws, "s1", since=None))
        self.assertTrue(gp.bind_consent(self.ws, "s1", since=10.0))

    def test_the_workspace_holds_no_approval_record(self):
        run, _ = _ran(1)
        self._ask(run)
        gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=self._starter()[0])
        self.assertEqual([p for p in self.ws.rglob("*.json")], [])
        self.assertTrue(str(gp.goal_dir(self.ws)).startswith(os.environ["HERMES_HOME"]))
        for skill in ("lit-plan", "start-work"):
            text = (Path(_ASSET_DIR) / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
            self.assertRegex(text, r"Never read or write the (?:plan-)?approval\s+or goal records", skill)
            self.assertRegex(text, r"only the hook\s+handles approval", skill)

    def test_tampered_question_and_edit_no_answers(self):
        run, _ = _ran(1)
        start, started = self._starter()
        for field, value in (("condition", " or anything"), ("plan", "x"), ("check", " && true"), ("session", "x")):
            self._ask(run)
            path = gp.goal_dir(self.ws) / "consent.json"
            data = json.loads(path.read_text())
            path.write_text(json.dumps({**data, field: data[field] + value}))
            self.assertIn(gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=start).get("line", ""), ("", "Approval not recorded for this session. Run: /start-work plans/p.md"), field)
        self._ask(run)
        self.assertEqual(gp.answer_consent(self.ws, "edit", session_id="s1", now=1.0, start=start), {"line": gp.STATUS["edit"]})
        self._ask(run)
        self.assertEqual(gp.answer_consent(self.ws, "no", session_id="s1", now=1.0, start=start), {"line": gp.STATUS["declined"]})
        self.assertEqual(started, [])
        self.assertFalse((gp.goal_dir(self.ws) / "intent.json").exists())

    def test_turn_end_check_runs_only_when_every_row_is_ticked(self):
        run, calls = _ran(1)
        self._ask(run)
        gp.answer_consent(self.ws, "yes", session_id="s1", now=1.0, start=self._starter()[0])
        calls.clear()
        self.assertIsNone(gp.turn_end_check(self.ws, run=run))
        self.assertEqual(calls, [])
        self.plan.write_text(PLAN.replace("- [ ] 2.", "- [x] 2.").replace("- [ ] F1.", "- [x] F1."), encoding="utf-8")
        gp.turn_end_check(self.ws, run=run)
        self.assertEqual(gp.take_result_line(self.ws), "Goal condition not met yet: `npm test` exited 1.")
        ok, _ = _ran(0)
        gp.turn_end_check(self.ws, run=ok)
        self.assertTrue(gp.take_result_line(self.ws).startswith("Goal condition met: Every row in plans/p.md"))
        self.assertFalse((gp.goal_dir(self.ws) / "intent.json").exists())
        self.assertEqual(gp.take_result_line(self.ws), "")


class GoalHook(NaturalRoutingCase):
    def test_yes_is_answered_by_the_hook_and_never_arms_native_goal(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "plans").mkdir()
            (ws / "plans" / "p.md").write_text(PLAN, encoding="utf-8")
            run, _ = _ran(1)
            prev = os.getcwd()
            os.chdir(tmp)
            try:
                # The asking turn: g1's turn starts, lit-plan runs propose, the turn ends.
                self.pkg._pre_llm_call(user_message="plan the thing", session_id="g1", platform="cli")
                condition = gp.propose(ws, "plans/p.md", run=run)["consent"]["condition"]
                self.pkg._post_llm_call(session_id="g1", platform="cli", user_message="plan the thing", assistant_response="")
                other = self.pkg._pre_llm_call(user_message="yes", session_id="g2", platform="cli")
                result = self.pkg._pre_llm_call(user_message="yes", session_id="g1", platform="cli")
                again = self.pkg._pre_llm_call(user_message="yes", session_id="g1", platform="cli")
            finally:
                os.chdir(prev)
            runs = [json.loads(f.read_text()) for f in (ws / ".hermes" / "lithermes" / "runs").glob("*/state.json")]
        self.assertIn("Approval not recorded for this session. Run: /start-work plans/p.md", other["context"])
        self.assertNotIn("Work started", other["context"])
        context = result["context"]
        self.assertIn("<lithermes-goal-status>", context)
        self.assertIn("Work started from plans/p.md.", context)
        self.assertIn(f"/goal {condition}  then  /goal gate add npm test", context)
        self.assertNotIn("Goal accepted", str((again or {}).get("context") or ""))
        self.assertEqual([(r["command"], Path(r["plan"]).name) for r in runs], [("start-work", "p.md")])
        source = (Path(_ASSET_DIR) / "goal_pipeline.py").read_text(encoding="utf-8")
        self.assertNotIn("GoalManager", source.split('"""', 2)[2])

    def test_goal_propose_cli_prints_the_question(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "plans").mkdir()
            (ws / "plans" / "p.md").write_text(PLAN.replace("npm test", "it works"), encoding="utf-8")
            from litgoal import cli

            import contextlib
            import io

            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = cli.main(["--workspace", tmp, "propose", "plans/p.md"])
        self.assertEqual(code, 0)
        self.assertTrue(out.getvalue().startswith("Approve plan and start work? (yes / no)\nNo goal set: "), out.getvalue())


class GoalSurfaces(unittest.TestCase):
    def test_read_only_skills_carry_goal_never(self):
        skills = Path(_ASSET_DIR) / "skills"
        for name in ("lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm", "lit-crucible"):
            head = (skills / name / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[1]
            self.assertIn("\ngoal: never\n", head, name)

    def test_the_absent_goal_tool_sentences_are_gone(self):
        for rel in ("core_plans.py", "core_contract.py", "skills/litwork/SKILL.md", "skills/start-work/SKILL.md", "skills/lit-plan/SKILL.md"):
            text = (Path(_ASSET_DIR) / rel).read_text(encoding="utf-8")
            self.assertNotRegex(text, r"get_goal|create_goal|update_goal", rel)
        plan_skill = (Path(_ASSET_DIR) / "skills" / "lit-plan" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("## Done when", plan_skill)
        self.assertIn("Approve plan, start work and set goal: /goal <condition>? (yes / edit / no)", plan_skill)
        self.assertIn("Approve plan and start work? (yes / no)", plan_skill)

    def test_read_only_skills_never_propose_a_plan_start(self):
        skills = Path(_ASSET_DIR) / "skills"
        for name in ("lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm", "lit-crucible"):
            body = "\n".join(p.read_text(encoding="utf-8") for p in (skills / name).rglob("*.md"))
            self.assertNotIn("goal propose", body, name)


if __name__ == "__main__":
    sys.exit(unittest.main())
