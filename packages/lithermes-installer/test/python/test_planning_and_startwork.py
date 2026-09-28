"""A+B+E: planning handoff, start-work execution-only contract, dry-run."""

import os
import json
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import core  # noqa: E402


def _skill_body(name: str) -> str:
    return (Path(_ASSET_DIR) / "skills" / name / "SKILL.md").read_text(encoding="utf-8").strip()


class PlanningHandoff(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_plan_agent_message_drives_the_planning_process(self):
        msg = core.build_plan_agent_message(
            "ship the parser", self.ws / "plans" / "p.md", self.ws
        )
        # A: explore-first + interview + approval gate, via the lit-plan skill
        self.assertIn("lithermes:lit-plan", msg)
        self.assertIn("explore-first", msg)
        self.assertIn("APPROVAL GATE", msg)
        # B: pre-finalize gap-analysis + plan-review
        self.assertIn("gap-analysis", msg)
        self.assertIn("plan-review", msg)
        self.assertIn(_skill_body("lit-plan"), msg)
        # no longer the bare "execute now" handoff
        self.assertNotIn("Execute this LitHermes plan now", msg)


class StartWorkContract(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = str(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def _write_plan(self, name: str, body: str) -> Path:
        plans = Path(self.ws) / "plans"
        plans.mkdir(parents=True, exist_ok=True)
        plan = plans / f"{name}.md"
        plan.write_text(body, encoding="utf-8")
        return plan

    def test_no_plan_with_brief_blocks_instead_of_bootstrapping(self):
        with self.assertRaisesRegex(ValueError, "execution-only"):
            core.command_start_work(f"--worktree {self.ws} build the widget")
        # start-work must not create a plan: planning belongs to /lit-plan.
        self.assertFalse((Path(self.ws) / "plans").exists())

    def test_no_plan_no_brief_raises(self):
        with self.assertRaises(ValueError):
            core.command_start_work(f"--worktree {self.ws}")

    def test_dry_run_no_plan_reports_safe_block(self):
        out = core.command_start_work(f"--worktree {self.ws} --dry-run build the widget")
        self.assertIsInstance(out, str)
        self.assertIn("BLOCKED", out)
        self.assertIn("/lit-plan", out)
        # dry-run must NOT create a plan file
        self.assertFalse((Path(self.ws) / "plans").exists())

    def test_malformed_plan_blocks_before_creating_run_state(self):
        self._write_plan(
            "malformed",
            "\n".join(
                [
                    "# Malformed",
                    "",
                    "## Success Criteria",
                    "- [ ] C001 | channel: cli | test: command | scenario: outcome",
                    "",
                    "## Scope",
                    "- [ ] A deliverable is not an execution row",
                    "",
                    "## Final verification gates",
                    "- [ ] F1. Final audit",
                    "",
                ]
            ),
        )

        with self.assertRaisesRegex(ValueError, r"BLOCKED: .*plan structure"):
            core.command_start_work(f"--worktree {self.ws} malformed")

        self.assertFalse(
            (Path(self.ws) / ".hermes" / "lithermes" / "runs").exists(),
            "invalid plans must be rejected before run-state mutation",
        )

    def test_malformed_plan_diagnostics_never_echo_quoted_secrets_or_headings(self):
        secret = "correct horse battery staple 7391"
        secret_tail = "horse battery staple 7391"
        secret_heading = "Production credentials for oracle 8842"
        self._write_plan(
            "malformed-secret",
            "\n".join(
                [
                    "# Malformed secret",
                    "",
                    "## Todos",
                    f'- [ ] 1 password="{secret}"',
                    "",
                    f"## {secret_heading}",
                    "- [ ] 2. Deploy the service",
                    "",
                    "## Final verification",
                    "- [ ] F1. Final audit",
                    "",
                ]
            ),
        )

        dry_run = core.command_start_work(
            f"--worktree {self.ws} malformed-secret --dry-run"
        )
        self.assertIn("BLOCKED", dry_run)
        self.assertNotIn(secret, dry_run)
        self.assertNotIn(secret_tail, dry_run)
        self.assertNotIn(secret_heading, dry_run)

        with self.assertRaises(ValueError) as caught:
            core.command_start_work(f"--worktree {self.ws} malformed-secret")
        self.assertNotIn(secret, str(caught.exception))
        self.assertNotIn(secret_tail, str(caught.exception))
        self.assertNotIn(secret_heading, str(caught.exception))
        self.assertIsNone(caught.exception.__cause__)
        self.assertIsNone(caught.exception.__context__)
        self.assertFalse(
            (Path(self.ws) / ".hermes" / "lithermes" / "runs").exists(),
            "secret-bearing malformed plans must block before run-state mutation",
        )

    def test_whitespace_only_row_titles_block_before_creating_run_state(self):
        malformed_rows = {
            "blank-implementation": ("- [ ] 1.    ", "- [ ] F1. Final audit"),
            "blank-final-verifier": ("- [ ] 1. Implement", "- [ ] F1.    "),
        }
        for name, (implementation, final_verifier) in malformed_rows.items():
            with self.subTest(name=name):
                self._write_plan(
                    name,
                    "\n".join(
                        [
                            f"# {name}",
                            "",
                            "## Todos",
                            implementation,
                            "",
                            "## Final verification gates",
                            final_verifier,
                            "",
                        ]
                    ),
                )
                with self.assertRaisesRegex(ValueError, r"BLOCKED: .*plan structure"):
                    core.command_start_work(f"--worktree {self.ws} {name}")

        self.assertFalse(
            (Path(self.ws) / ".hermes" / "lithermes" / "runs").exists(),
            "whitespace-only titles must be rejected before run-state mutation",
        )

    def test_open_execution_items_ignore_non_task_and_fenced_checkboxes(self):
        plan = self._write_plan(
            "section-aware",
            "\n".join(
                [
                    "# Section-aware",
                    "",
                    "## Success Criteria",
                    "- [ ] C001 | channel: cli | test: command | scenario: outcome",
                    "",
                    "## Scope",
                    "- [ ] Must-have checkbox",
                    "",
                    "## Todos",
                    "- [ ] 1. Implement the parser",
                    "  - [ ] Nested detail",
                    "```md",
                    "- [ ] 2. Fenced example",
                    "```",
                    "",
                    "## Notes",
                    "- [ ] Unrelated reminder",
                    "",
                    "## Final verification gates",
                    "- [ ] F1. Final audit",
                    "",
                ]
            ),
        )

        dry_run = core.command_start_work(
            f"--worktree {self.ws} section-aware --dry-run"
        )

        self.assertEqual(
            dry_run,
            f"LitHermes dry-run for {plan.resolve()}:\n- 1. Implement the parser",
        )

    def test_generated_plan_starts_without_manual_normalization(self):
        planned = core.command_lit_plan(f"--worktree {self.ws} build the widget")

        started = core.command_start_work(f"--worktree {self.ws} {Path(planned['plan']).stem}")

        self.assertIsInstance(started, dict)
        self.assertIn("Open items:\n- 1. <task title>", started["display"])
        self.assertNotIn("C001 |", started["display"])
        self.assertTrue(Path(started["display"].split(": ", 1)[1].split("\n", 1)[0]).is_dir())

    def test_natural_lit_plan_in_one_session_is_found_by_start_work_in_the_next(self):
        workspace = Path(self.ws)
        prev = os.getcwd()
        os.chdir(workspace)
        try:
            first = core.pre_llm_call(
                user_message="lit plan build the widget",
                session_id="session-a",
                platform="cli",
            )
        finally:
            os.chdir(prev)

        self.assertIsInstance(first, dict)
        plans = list((workspace / "plans").glob("*.md"))
        self.assertEqual(len(plans), 1)
        self.assertIn("# build the widget", plans[0].read_text(encoding="utf-8"))
        self.assertIn("Durable plan:", first["context"])
        self.assertIn(plans[0].name, first["context"])
        self.assertFalse((workspace / ".hermes" / "lithermes" / "runs").exists())

        started = core.command_start_work(f"--worktree {self.ws} {plans[0].stem}")
        self.assertIsInstance(started, dict)
        self.assertIn(str(plans[0].resolve()), started["display"])

    def test_start_work_conditionally_loads_uiux_contracts(self):
        plans = Path(self.ws) / "plans"
        plans.mkdir(parents=True)
        (plans / "ui-plan.md").write_text(
            "# Approved UI plan\n\n## Todos\n- [ ] 1. Build the responsive dashboard component and verify visual fidelity.\n\n## Final verification\n- [ ] F1. Verify the UI plan.\n",
            encoding="utf-8",
        )
        (plans / "backend-plan.md").write_text(
            "# Approved backend plan\n\n## Todos\n- [ ] 1. Parse a binary protocol fixture.\n\n## Final verification\n- [ ] F1. Verify the backend plan.\n",
            encoding="utf-8",
        )
        ui_result = core.command_start_work(f"--worktree {self.ws} ui-plan")
        backend_result = core.command_start_work(f"--worktree {self.ws} backend-plan")
        self.assertIn('<lithermes-skill-body name="frontend-ui-ux">', ui_result["agent_message"])
        self.assertIn("lithermes:visual-qa", ui_result["agent_message"])
        self.assertNotIn('<lithermes-skill-body name="frontend-ui-ux">', backend_result["agent_message"])
        self.assertNotIn("lithermes:visual-qa", backend_result["agent_message"])

    def test_start_work_redacts_plan_secrets_from_display_and_run_state(self):
        raw_bearer = "shh-secret-token-123"
        raw_token = "ghp_SECRET12345"
        raw_aws_secret = "AWSSECRETACCESSKEYVALUE123456"
        raw_access_token = "ACCESSTOKENVALUE123456"
        raw_private_key = "PRIVATEKEYVALUE123456"
        raw_json_aws_secret = "JSON_AWS_VALUE_123456"
        raw_json_access_token = "JSON_ACCESS_VALUE_123456"
        raw_json_private_key = "JSON_PRIVATE_VALUE_123456"
        plans = Path(self.ws) / "plans"
        plans.mkdir(parents=True)
        plan = plans / "approved.md"
        plan.write_text(
            "\n".join(
                [
                    "# Approved",
                    "",
                    "## Success Criteria",
                    f"- [ ] C001 | channel: cli | test: token={raw_token} | scenario: Authorization: Bearer {raw_bearer}",
                    f"- [ ] C002 | channel: cli | test: AWS_SECRET_ACCESS_KEY={raw_aws_secret} | scenario: access_token={raw_access_token}",
                    f"- [ ] C003 | channel: cli | test: {{\"AWS_SECRET_ACCESS_KEY\": \"{raw_json_aws_secret}\"}} | scenario: {{\"access_token\": \"{raw_json_access_token}\"}}",
                    "",
                    "## Todos",
                    f"- [ ] 1. deploy with password={raw_bearer}",
                    f"- [ ] 2. load private_key={raw_private_key}",
                    f"- [ ] 3. persist {{\"private_key\": \"{raw_json_private_key}\"}}",
                    "",
                    "## Final verification",
                    "- [ ] F1. Verify the completed work",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        dry = core.command_start_work(f"--worktree {self.ws} approved --dry-run")
        self.assertNotIn(raw_bearer, dry)
        self.assertNotIn(raw_aws_secret, dry)
        self.assertNotIn(raw_access_token, dry)
        self.assertNotIn(raw_private_key, dry)
        self.assertNotIn(raw_json_aws_secret, dry)
        self.assertNotIn(raw_json_access_token, dry)
        self.assertNotIn(raw_json_private_key, dry)
        self.assertIn("[REDACTED", dry)

        result = core.command_start_work(f"--worktree {self.ws} approved")
        run_dir = Path(result["display"].split("work run from approved plan: ", 1)[1].split("\n", 1)[0])
        combined = "\n".join(
            [
                result["display"],
                result["agent_message"],
                (run_dir / "state.json").read_text(encoding="utf-8"),
                (run_dir / "ledger.jsonl").read_text(encoding="utf-8"),
                (run_dir / "notepad.md").read_text(encoding="utf-8"),
            ]
        )
        self.assertNotIn(raw_bearer, combined)
        self.assertNotIn(raw_token, combined)
        self.assertNotIn(raw_aws_secret, combined)
        self.assertNotIn(raw_access_token, combined)
        self.assertNotIn(raw_private_key, combined)
        self.assertNotIn(raw_json_aws_secret, combined)
        self.assertNotIn(raw_json_access_token, combined)
        self.assertNotIn(raw_json_private_key, combined)
        self.assertIn("[REDACTED", combined)
        state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
        self.assertIn("[REDACTED", json.dumps(state["criteria"]))


if __name__ == "__main__":
    unittest.main()
