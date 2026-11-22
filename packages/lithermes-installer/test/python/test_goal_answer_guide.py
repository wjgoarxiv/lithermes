"""The answer guide under every goal question: what to type and what each answer does.

The question lines stay byte-for-byte; the guide follows them. One option list in goal_pipeline
builds both the Markdown guide the model copies (plan approval and `propose --loop` output) and the
plain rows the prompt hook draws under the reply for a lit-loop.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
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
- [ ] 1. Wire the route

## Done when
- check: `npm test`
"""
OBJECTIVE = "fix the login redirect"


def _ran(code: int):
    return lambda argv, **kwargs: SimpleNamespace(returncode=code)


def _dry(*args, **kwargs):
    return {"ok": True, "exit": 1}


def _rows(guide: str) -> list[str]:
    return re.findall(r"^> \| \*\*`(\w+)`\*\* \|", guide, re.MULTILINE)


class AnswerGuideText(unittest.TestCase):
    def test_each_guide_lists_exactly_the_words_its_question_offers(self):
        for kind in ("asked", "asked_start", "loop_asked"):
            words = [word for word, _ in gp.ANSWERS[kind]]
            self.assertIn("(" + " / ".join(words) + ")", gp.STATUS[kind], kind)
            self.assertEqual(_rows(gp.answer_guide(kind, "c")), words, kind)
            plain = gp.answer_guide(kind, "c", plain=True)
            self.assertEqual(re.findall(r"^  (\w+) +→ ", plain, re.MULTILINE), words, kind)

    def test_the_markdown_guide_names_the_goal_and_ends_with_type_the_word_alone(self):
        condition = "Every row in plans/p.md is ticked and `npm test` exits 0 [lit:abcd1234]"
        guide = gp.answer_guide("asked", condition)
        self.assertTrue(guide.startswith("> **▶ Answer: approve plan · start work · set goal**\n>\n"), guide)
        self.assertIn(f"> Goal: `` /goal {condition} ``\n", guide)
        self.assertIn("> | Type | What happens |\n> |---|---|\n", guide)
        self.assertTrue(guide.endswith(">\n> Type the word alone."), guide)
        start = gp.answer_guide("asked_start")
        self.assertNotIn("Goal:", start)
        self.assertIn("no goal", start)

    def test_the_plain_guide_has_no_markdown(self):
        plain = gp.answer_guide("loop_asked", "c", plain=True)
        self.assertNotRegex(plain, r"[|*>`]")
        self.assertTrue(plain.rstrip().endswith("Type the word alone."), plain)


class AnswerGuideSurfaces(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lithermes-guide-")
        self.addCleanup(self.tmp.cleanup)
        self.ws = Path(self.tmp.name) / "ws"
        (self.ws / "plans").mkdir(parents=True)
        (self.ws / "plans" / "p.md").write_text(PLAN, encoding="utf-8")
        home = patch.dict(os.environ, {"HERMES_HOME": str(Path(self.tmp.name) / "home")})
        home.start()
        self.addCleanup(home.stop)

    def test_propose_keeps_the_line_and_adds_the_guide(self):
        out = gp.propose(self.ws, "plans/p.md", run=_ran(1))
        self.assertEqual(out["line"], gp.STATUS["asked"].format(condition=out["consent"]["condition"]))
        self.assertEqual(out["guide"], gp.answer_guide("asked", out["consent"]["condition"]))
        (self.ws / "plans" / "p.md").write_text(PLAN + "goal: never\n", encoding="utf-8")
        refused = gp.propose(self.ws, "plans/p.md", run=_ran(1))
        self.assertEqual(refused["guide"], gp.answer_guide("asked_start"))
        self.assertNotIn("guide", gp.propose(self.ws, "plans/missing.md"))

    def test_the_cli_prints_the_question_then_the_guide(self):
        from litgoal import cli

        out = io.StringIO()
        with patch.object(gp, "falsify", _dry), patch.object(gp, "falsify_loop", _dry), contextlib.redirect_stdout(out):
            self.assertEqual(cli.main(["--workspace", str(self.ws), "propose", "plans/p.md"]), 0)
        line, guide = out.getvalue().rstrip("\n").split("\n\n", 1)
        self.assertTrue(line.startswith("Approve plan, start work and set goal: /goal "), line)
        self.assertEqual(_rows(guide), ["yes", "edit", "no"])

    def test_the_loop_cli_prints_the_two_row_guide(self):
        from litgoal import cli

        (self.ws / "package.json").write_text(json.dumps({"scripts": {"test": "node --test"}}), encoding="utf-8")
        out = io.StringIO()
        with patch.object(gp, "falsify", _dry), patch.object(gp, "falsify_loop", _dry), contextlib.redirect_stdout(out):
            cli.main(["--workspace", str(self.ws), "propose", "--loop", "--check", "npm test", *OBJECTIVE.split()])
        line, guide = out.getvalue().rstrip("\n").split("\n\n", 1)
        self.assertTrue(line.startswith("Set goal for this lit-loop: /goal "), line)
        self.assertEqual(_rows(guide), ["yes", "no"])

    def test_the_skills_tell_the_model_to_keep_the_guide(self):
        skills = Path(_ASSET_DIR) / "skills"
        for name in ("lit-plan", "litwork"):
            text = (skills / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn("Type the word alone.", text, name)
            self.assertIn("user's language", text, name)


class AnswerGuideHookRow(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.ws = Path(self.isolated_root.name) / "proj"
        self.ws.mkdir()
        (self.ws / "package.json").write_text(json.dumps({"scripts": {"test": "node --test"}}), encoding="utf-8")
        previous = os.getcwd()
        os.chdir(self.ws)
        self.addCleanup(os.chdir, previous)
        self.core._PENDING_GOAL_ROW.clear()

    def test_the_hook_row_is_the_line_then_the_plain_guide(self):
        self.pkg._pre_llm_call(user_message=f"lit {OBJECTIVE}", session_id="gd1", platform="cli")
        reply = self.pkg._transform_llm_output_with_offer(session_id="gd1", platform="cli", response_text="done")
        condition = gp.compile_loop_condition(OBJECTIVE, "npm test")["condition"]
        question = gp.STATUS["loop_asked"].format(condition=condition)
        self.assertIn(question + "  \n" + gp.answer_guide("loop_asked", condition, plain=True), reply)
        self.assertTrue(reply.rstrip().endswith("Type the word alone."), reply)


if __name__ == "__main__":
    sys.exit(unittest.main())
