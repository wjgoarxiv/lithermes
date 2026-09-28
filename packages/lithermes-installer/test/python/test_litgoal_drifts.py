"""Phase-7 runtime drifts: session scoping, status enum, ledger vocabulary,
structured steering, and attempt-scoped evidence.

Each class maps to one drift id so a reviewer can find the proof for a claim.
Everything runs against a throwaway workspace; the Python gate isolates HOME and
HERMES_HOME, and nothing here touches a live profile.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


def _ledger_lines(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class DriftTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pkg = _load_plugin_package()
        cls.core = pkg.core
        cls.litgoal = pkg.litgoal_cli.runtime.__package__  # noqa: F841 - import sanity
        from importlib import import_module
        cls.model = import_module("lithermes_plugin_pkg.litgoal.model")
        cls.runtime = import_module("lithermes_plugin_pkg.litgoal.runtime")
        cls.store = import_module("lithermes_plugin_pkg.litgoal.store")
        cls.tools = import_module("lithermes_plugin_pkg.litgoal.tools")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name).resolve()

    def tearDown(self):
        self._tmp.cleanup()

    def _complete(self, session_id=""):
        """Drive one goal all the way through the quality gate."""
        self.runtime.create_goal(self.ws, "ship it", criteria=[{"scenario": "it works"}],
                                 session_id=session_id)
        self.runtime.add_evidence(self.ws, "C001", "green", "t.py::x", session_id=session_id)
        self.runtime.add_evidence(self.ws, "C001", "scenario", "curl -i /health", session_id=session_id)
        self.runtime.set_criterion_status(self.ws, "C001", "pass", session_id=session_id)
        return self.runtime.complete_goal(self.ws, session_id=session_id)


class D6aSessionScoping(DriftTestCase):
    def test_session_id_opens_new_state_and_leaves_the_old_intact(self):
        self.assertTrue(self._complete()["completed"])
        legacy_before = self.store.goals_path(self.ws).read_text(encoding="utf-8")

        self.runtime.create_goal(self.ws, "next piece of work", session_id="s2")
        scoped = self.runtime.get_active(self.ws, "s2")
        self.assertEqual(scoped.objective, "next piece of work")
        self.assertEqual(scoped.status, "active")

        legacy_after = self.store.goals_path(self.ws).read_text(encoding="utf-8")
        self.assertEqual(legacy_before, legacy_after, "old state must be byte-identical")
        self.assertEqual(self.runtime.get_active(self.ws).status, "complete")
        self.assertNotEqual(
            self.store.goals_path(self.ws), self.store.goals_path(self.ws, "s2")
        )

    def test_two_sessions_do_not_see_each_other(self):
        self.runtime.create_goal(self.ws, "alpha", session_id="a")
        self.runtime.create_goal(self.ws, "beta", session_id="b")
        self.assertEqual(self.runtime.get_active(self.ws, "a").objective, "alpha")
        self.assertEqual(self.runtime.get_active(self.ws, "b").objective, "beta")
        self.assertIsNone(self.runtime.get_active(self.ws))

    def test_mutating_a_completed_goal_requires_force(self):
        self.assertTrue(self._complete()["completed"])
        for call in [
            lambda force: self.runtime.add_evidence(self.ws, "C001", "note", "n", force=force),
            lambda force: self.runtime.set_criterion_status(self.ws, "C001", "fail", force=force),
            lambda force: self.runtime.add_criterion(self.ws, "another", force=force),
            lambda force: self.runtime.add_review_blocker(self.ws, "late blocker", force=force),
            lambda force: self.runtime.record_checkpoint(self.ws, "late", force=force),
        ]:
            with self.subTest(call=call):
                with self.assertRaises(ValueError) as ctx:
                    call(False)
                self.assertIn("already complete", str(ctx.exception))
                self.assertIn("--session-id", str(ctx.exception))
        # --force is the deliberate escape hatch, and it works.
        self.runtime.add_evidence(self.ws, "C001", "note", "deliberate", force=True)
        notes = [e for e in self.runtime.get_active(self.ws).criteria[0].evidence if e.kind == "note"]
        self.assertEqual(len(notes), 1)

    def test_session_ids_that_could_escape_the_state_dir_are_refused(self):
        for bad in ["..", "a/b", "a\\b", ".hidden", "x" * 97, "sess id"]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    self.store.state_dir(self.ws, bad)

    def test_sessions_are_listable(self):
        self.runtime.create_goal(self.ws, "alpha", session_id="a")
        self.runtime.create_goal(self.ws, "beta", session_id="b")
        self.assertEqual(self.store.list_sessions(self.ws), ["a", "b"])

    def test_legacy_state_still_loads_without_a_session_id(self):
        self.runtime.create_goal(self.ws, "legacy work")
        self.assertTrue(self.store.goals_path(self.ws).exists())
        self.assertEqual(self.runtime.get_active(self.ws).objective, "legacy work")


class D6bStatusEnum(DriftTestCase):
    def test_review_blocked_is_reachable_and_distinguishes_a_stalled_goal(self):
        self.runtime.create_goal(self.ws, "obj")
        self.assertEqual(self.runtime.get_active(self.ws).status, "active")
        self.runtime.add_review_blocker(self.ws, "reviewer says the migration is unsafe")
        self.assertEqual(self.runtime.get_active(self.ws).status, "review_blocked")

    def test_resolving_the_last_blocker_returns_the_goal_to_active(self):
        self.runtime.create_goal(self.ws, "obj")
        b1 = self.runtime.add_review_blocker(self.ws, "first")
        b2 = self.runtime.add_review_blocker(self.ws, "second")
        self.runtime.resolve_review_blocker(self.ws, b1.id)
        self.assertEqual(self.runtime.get_active(self.ws).status, "review_blocked")
        self.runtime.resolve_review_blocker(self.ws, b2.id)
        self.assertEqual(self.runtime.get_active(self.ws).status, "active")

    def test_resolving_a_review_blocker_preserves_a_manually_blocked_goal(self):
        self.runtime.create_goal(self.ws, "obj")
        blocker = self.runtime.add_review_blocker(self.ws, "review finding")
        self.runtime.set_goal_status(self.ws, "blocked")

        self.runtime.resolve_review_blocker(self.ws, blocker.id)

        self.assertEqual(self.runtime.get_active(self.ws).status, "blocked")

    def test_unresolved_review_blocker_overrides_manual_active_status(self):
        self.runtime.create_goal(self.ws, "obj")
        self.runtime.add_review_blocker(self.ws, "review finding")

        actual = self.runtime.set_goal_status(self.ws, "active")

        self.assertEqual(actual, "review_blocked")
        self.assertEqual(self.runtime.get_active(self.ws).status, "review_blocked")

    def test_unresolved_review_blocker_overrides_needs_user_decision(self):
        self.runtime.create_goal(self.ws, "obj")
        self.runtime.set_goal_status(self.ws, "needs_user_decision")

        self.runtime.add_review_blocker(self.ws, "review finding")

        self.assertEqual(self.runtime.get_active(self.ws).status, "review_blocked")

    def test_manual_review_blocked_remains_settable_without_a_blocker_record(self):
        self.runtime.create_goal(self.ws, "obj")

        actual = self.runtime.set_goal_status(self.ws, "review_blocked")

        self.assertEqual(actual, "review_blocked")
        self.assertEqual(self.runtime.get_active(self.ws).status, "review_blocked")

    def test_needs_user_decision_is_representable_on_a_goal(self):
        self.runtime.create_goal(self.ws, "obj")
        self.runtime.set_goal_status(self.ws, "needs_user_decision")
        self.assertEqual(self.runtime.get_active(self.ws).status, "needs_user_decision")

    def test_needs_user_decision_is_representable_on_a_criterion(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.set_criterion_status(self.ws, "C001", "needs_user_decision")
        self.assertEqual(self.runtime.get_active(self.ws).criteria[0].status, "needs_user_decision")

    def test_a_stalled_goal_cannot_pass_the_quality_gate(self):
        self.assertTrue(self._complete(session_id="done")["completed"])
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}], session_id="x")
        self.runtime.add_evidence(self.ws, "C001", "green", "t", session_id="x")
        self.runtime.add_evidence(self.ws, "C001", "scenario", "s", session_id="x")
        self.runtime.set_criterion_status(self.ws, "C001", "pass", session_id="x")
        self.assertTrue(self.runtime.quality_gate(self.ws, session_id="x")["passed"])
        self.runtime.set_goal_status(self.ws, "needs_user_decision", session_id="x")
        gate = self.runtime.quality_gate(self.ws, session_id="x")
        self.assertFalse(gate["passed"])
        self.assertTrue(any("needs_user_decision" in r for r in gate["reasons"]))
        self.assertFalse(self.runtime.complete_goal(self.ws, session_id="x")["completed"])

    def test_complete_is_not_settable_by_hand(self):
        self.runtime.create_goal(self.ws, "obj")
        with self.assertRaises(ValueError) as ctx:
            self.runtime.set_goal_status(self.ws, "complete")
        self.assertIn("gated on evidence", str(ctx.exception))

    def test_status_enums_cover_the_documented_values(self):
        self.assertIn("review_blocked", self.model.GOAL_STATUSES)
        self.assertIn("needs_user_decision", self.model.GOAL_STATUSES)
        self.assertIn("needs_user_decision", self.model.CRITERION_STATUSES)


class D6cLedgerVocabulary(DriftTestCase):
    def test_litgoal_ledger_is_one_schema_with_one_event_key(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.add_evidence(self.ws, "C001", "green", "t")
        self.runtime.record_checkpoint(self.ws, "cp")
        lines = _ledger_lines(self.store.ledger_path(self.ws))
        self.assertTrue(lines)
        for entry in lines:
            self.assertEqual(entry["schema"], self.store.LEDGER_SCHEMA)
            self.assertIn("kind", entry)
            self.assertNotIn("event", entry, "the litgoal ledger must not carry a second event key")
            self.assertIn(entry["kind"], self.store.LEDGER_KINDS)

    def test_run_ledger_is_a_different_schema_with_its_own_event_key(self):
        run_dir = self.ws / "run"
        run_dir.mkdir()
        self.core.record_criterion_event(run_dir, "C001", "test_red_captured", ref="t.py::x")
        lines = _ledger_lines(run_dir / "ledger.jsonl")
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["schema"], self.core.RUN_LEDGER_SCHEMA)
        self.assertIn("event", lines[0])
        self.assertNotIn("kind", lines[0], "the run ledger must not carry a second event key")
        self.assertNotEqual(self.core.RUN_LEDGER_SCHEMA, self.store.LEDGER_SCHEMA)

    def test_the_third_vocabulary_is_now_enforced_not_just_documented(self):
        run_dir = self.ws / "run"
        run_dir.mkdir()
        for event in self.core.RUN_LEDGER_EVENTS:
            with self.subTest(event=event):
                self.core.record_criterion_event(run_dir, "C001", event)
        with self.assertRaises(ValueError) as ctx:
            self.core.record_criterion_event(run_dir, "C001", "invented_event")
        self.assertIn("invalid run ledger event", str(ctx.exception))

    def test_a_rejected_steering_attempt_appears_in_the_ledger(self):
        self.runtime.create_goal(self.ws, "obj")
        self.runtime.record_steering_rejection(
            self.ws, "skip the tests", "steering refused: weakening", kind="redirect"
        )
        kinds = [e["kind"] for e in _ledger_lines(self.store.ledger_path(self.ws))]
        self.assertIn("steering_rejected", kinds)

    def test_the_steer_tool_records_a_rejection_through_the_real_handler(self):
        import os
        prev = os.getcwd()
        os.chdir(self.ws)
        try:
            self.runtime.create_goal(self.ws, "obj")
            out = json.loads(self.tools.tool_goal_steer(
                {"directive": "bypass the quality gate", "evidence": "e", "rationale": "r"}
            ))
        finally:
            os.chdir(prev)
        self.assertTrue(out["rejected"])
        entries = [e for e in _ledger_lines(self.store.ledger_path(self.ws))
                   if e["kind"] == "steering_rejected"]
        self.assertEqual(len(entries), 1)
        self.assertIn("bypass the quality gate", entries[0]["directive"])
        self.assertIn("refused", entries[0]["reason"])
        # and it really was refused — nothing landed in the aggregate
        self.assertEqual(len(self.runtime.get_active(self.ws).steering), 0)


class D6dStructuredSteering(DriftTestCase):
    def test_steering_without_evidence_or_rationale_is_rejected(self):
        self.runtime.create_goal(self.ws, "obj")
        for kwargs in [{}, {"evidence": "saw it"}, {"rationale": "because"}]:
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValueError) as ctx:
                    self.runtime.record_steering(self.ws, "redirect", **kwargs)
                self.assertIn("required", str(ctx.exception))

    def test_add_criterion_steering_is_structural(self):
        self.runtime.create_goal(self.ws, "obj")
        before = len(self.runtime.get_active(self.ws).criteria)
        st = self.runtime.record_steering(
            self.ws, "cover the concurrent-write case", kind="add_criterion",
            evidence="QA run 2026-07-26 raced", rationale="the aggregate is shared",
        )
        after = self.runtime.get_active(self.ws)
        self.assertEqual(len(after.criteria), before + 1)
        self.assertEqual(st.applied, after.criteria[-1].id)
        self.assertEqual(after.criteria[-1].scenario, "cover the concurrent-write case")

    def test_annotation_only_kinds_never_mutate_the_aggregate(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        for kind in ("redirect", "narrow_scope", "reprioritize", "annotate"):
            with self.subTest(kind=kind):
                st = self.runtime.record_steering(
                    self.ws, "do it differently for {0}".format(kind), kind=kind,
                    evidence="observed", rationale="reasoned",
                )
                self.assertEqual(st.applied, "", "{0} must not mutate structure".format(kind))
        # narrow_scope in particular must not have removed the criterion
        self.assertEqual(len(self.runtime.get_active(self.ws).criteria), 1)

    def test_evidence_and_rationale_survive_a_round_trip(self):
        self.runtime.create_goal(self.ws, "obj")
        self.runtime.record_steering(
            self.ws, "redirect", evidence="log line 42", rationale="the parser is the bottleneck",
        )
        st = self.runtime.get_active(self.ws).steering[0]
        self.assertEqual(st.evidence, "log line 42")
        self.assertEqual(st.rationale, "the parser is the bottleneck")

    def test_cli_and_tool_schema_agree_with_the_runtime(self):
        """The SKILL.md table, the CLI, and the tool schema must not drift apart."""
        import argparse
        from importlib import import_module
        cli = import_module("lithermes_plugin_pkg.litgoal.cli")
        parser = argparse.ArgumentParser(prog="goal")
        cli.setup(parser)
        # CLI: --evidence and --rationale are required on `steer`
        with self.assertRaises(SystemExit):
            parser.parse_args(["steer", "do a thing"])
        args = parser.parse_args(["steer", "do a thing", "--evidence", "e", "--rationale", "r"])
        self.assertEqual(args.evidence, "e")
        self.assertEqual(args.rationale, "r")
        # Tool schema: same two fields required
        spec = next(s for s in self.tools.TOOL_SPECS if s["name"] == "goal_steer")
        self.assertEqual(
            sorted(spec["schema"]["required"]), ["directive", "evidence", "rationale"]
        )
        self.assertEqual(
            sorted(spec["schema"]["properties"]),
            ["directive", "evidence", "kind", "rationale"],
        )

    def test_skill_md_documents_the_same_required_fields_as_the_cli(self):
        skill = (Path(_ASSET_DIR) / "skills" / "litgoal" / "SKILL.md").read_text(encoding="utf-8")
        for needle in ("--evidence", "--rationale", "add_criterion", "annotation-only"):
            self.assertIn(needle, skill, "litgoal SKILL.md must document {0}".format(needle))

    def test_skill_md_steering_kinds_are_exactly_the_implemented_ones(self):
        """The doc used to list seven kinds the model never had. Pin the real set."""
        skill = (Path(_ASSET_DIR) / "skills" / "litgoal" / "SKILL.md").read_text(encoding="utf-8")
        for kind in self.model.STEERING_KINDS:
            self.assertIn("`{0}`".format(kind), skill, "SKILL.md omits real kind {0}".format(kind))
        for fictional in (
            "add_subgoal", "split_subgoal", "reorder_pending",
            "revise_pending_wording", "revise_criterion", "annotate_ledger",
            "mark_blocked_superseded",
        ):
            self.assertNotIn(fictional, skill, "SKILL.md still documents unimplemented {0}".format(fictional))

    def test_skill_md_ledger_kinds_match_the_store(self):
        skill = (Path(_ASSET_DIR) / "skills" / "litgoal" / "SKILL.md").read_text(encoding="utf-8")
        for kind in self.store.LEDGER_KINDS:
            self.assertIn("`{0}`".format(kind), skill, "SKILL.md omits ledger kind {0}".format(kind))
        self.assertIn(self.store.LEDGER_SCHEMA, skill)
        self.assertIn(self.core.RUN_LEDGER_SCHEMA, skill)


class D6eAttemptScopedEvidence(DriftTestCase):
    def test_retry_bumps_the_attempt_and_keeps_prior_evidence(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.add_evidence(self.ws, "C001", "red", "attempt-1 red")
        self.runtime.set_criterion_status(self.ws, "C001", "fail")
        attempt = self.runtime.set_criterion_status(self.ws, "C001", "in_progress")
        self.assertEqual(attempt, 2)
        self.runtime.add_evidence(self.ws, "C001", "green", "attempt-2 green")

        crit = self.runtime.get_active(self.ws).criteria[0]
        self.assertEqual(crit.attempt, 2)
        refs = [(e.ref, e.attempt) for e in crit.evidence]
        self.assertIn(("attempt-1 red", 1), refs)
        self.assertIn(("attempt-2 green", 2), refs)
        self.assertEqual(len(crit.evidence), 2, "a retry must not drop prior evidence")

    def test_evidence_paths_are_versioned_per_attempt(self):
        first = self.store.attempt_evidence_dir(self.ws, "C001", 1)
        second = self.store.attempt_evidence_dir(self.ws, "C001", 2)
        self.assertNotEqual(first, second)
        self.assertTrue(str(first).endswith("C001/attempt-001"))
        self.assertTrue(str(second).endswith("C001/attempt-002"))

    def test_a_retry_emits_a_ledger_entry_naming_the_new_evidence_dir(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.set_criterion_status(self.ws, "C001", "fail")
        self.runtime.set_criterion_status(self.ws, "C001", "in_progress")
        retries = [e for e in _ledger_lines(self.store.ledger_path(self.ws))
                   if e["kind"] == "criterion_retry"]
        self.assertEqual(len(retries), 1)
        self.assertEqual(retries[0]["attempt"], 2)
        self.assertTrue(retries[0]["evidence_dir"].endswith("C001/attempt-002"))

    def test_a_forward_status_change_is_not_a_retry(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        for status in ("in_progress", "pass"):
            self.runtime.set_criterion_status(self.ws, "C001", status)
        self.assertEqual(self.runtime.get_active(self.ws).criteria[0].attempt, 1)

    def test_blocked_then_resumed_also_counts_as_a_retry(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.set_criterion_status(self.ws, "C001", "blocked")
        self.assertEqual(self.runtime.set_criterion_status(self.ws, "C001", "in_progress"), 2)

    def test_quality_gate_requires_green_and_scenario_from_the_current_attempt(self):
        self.runtime.create_goal(self.ws, "obj", criteria=[{"scenario": "s"}])
        self.runtime.add_evidence(self.ws, "C001", "green", "attempt-1 green")
        self.runtime.add_evidence(self.ws, "C001", "scenario", "attempt-1 scenario")
        self.runtime.set_criterion_status(self.ws, "C001", "fail")
        self.runtime.set_criterion_status(self.ws, "C001", "in_progress")
        self.runtime.set_criterion_status(self.ws, "C001", "pass")

        stale = self.runtime.quality_gate(self.ws)
        self.assertFalse(stale["passed"])
        self.assertTrue(any("green evidence for attempt 2" in reason for reason in stale["reasons"]))
        self.assertTrue(any("scenario evidence for attempt 2" in reason for reason in stale["reasons"]))

        self.runtime.add_evidence(self.ws, "C001", "green", "attempt-2 green")
        green_only = self.runtime.quality_gate(self.ws)
        self.assertFalse(green_only["passed"])
        self.assertFalse(any("green evidence" in reason for reason in green_only["reasons"]))
        self.assertTrue(any("scenario evidence for attempt 2" in reason for reason in green_only["reasons"]))

        self.runtime.add_evidence(self.ws, "C001", "scenario", "attempt-2 scenario")
        self.assertTrue(self.runtime.quality_gate(self.ws)["passed"])


try:
    from .plugin_register_test_support import _ASSET_DIR
except ImportError:
    from plugin_register_test_support import _ASSET_DIR


if __name__ == "__main__":
    unittest.main()
