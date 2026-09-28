"""Focused contract tests for the provider-free local speed probe."""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
SCENARIO = PACKAGE_ROOT / "qa" / "fixtures" / "litfamily-harness-speed-v1.json"
PROBE = PACKAGE_ROOT / "qa" / "lib" / "harness_speed_probe.py"


def _load_probe():
    spec = importlib.util.spec_from_file_location("lithermes_local_speed_probe", PROBE)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local speed probe")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LocalSpeedProbeContract(unittest.TestCase):
    def setUp(self) -> None:
        for name in (
            "CI",
            "NO_UPDATE_NOTIFIER",
            "LITHERMES_NO_UPDATE_CHECK",
            "LITHERMES_NO_AUTO_UPDATE",
        ):
            os.environ[name] = "1"

    def test_real_registered_surface_is_timed_without_provider_calls(self) -> None:
        report = _load_probe().run_probe(PLUGIN_ROOT, SCENARIO, samples=3)

        self.assertEqual(report["schema"], "litfamily.harness-speed-local-phases/v1")
        self.assertEqual(report["scenario_id"], "litfamily-speed-lit-activation-v1")
        self.assertEqual(report["measurement_status"], "MEASURED")
        self.assertTrue(report["valid"])
        self.assertEqual(report["verdict"], "VALID")
        self.assertEqual(report["clock"], "time.perf_counter_ns")
        self.assertEqual(report["provider_calls"], 0)
        self.assertEqual(report["provider_completions"], 0)
        self.assertEqual(
            report["surface"],
            {
                "plugin_registration": "plugin.register(recording_host_adapter)",
                "rules_context_composition": "core.consume_rules_context",
                "pre_llm_call": "registered pre_llm_call hook",
                "bounded_activation": "registered pre_llm_call hook with schema-3 envelope",
            },
        )
        self.assertEqual(
            set(report["phases"]),
            {
                "plugin_registration",
                "rules_context_composition",
                "pre_llm_call",
                "bounded_activation",
            },
        )
        for phase in report["phases"].values():
            self.assertEqual(phase["samples"], 3)
            self.assertGreaterEqual(phase["p50_ms"], 0)
            self.assertGreaterEqual(phase["p95_ms"], phase["p50_ms"])
            self.assertGreaterEqual(phase["output_bytes_p50"], 0)
            self.assertGreaterEqual(phase["output_bytes_p95"], phase["output_bytes_p50"])
        self.assertGreater(report["phases"]["plugin_registration"]["output_bytes_p50"], 0)

        correctness = report["correctness"]
        self.assertEqual(correctness["exact_banner"], "🔥 **LIT IGNITED · litwork** 🔥")
        self.assertTrue(correctness["registered_surface"])
        self.assertTrue(correctness["b0_no_route"])
        self.assertTrue(correctness["b0_sentinel_exact"])
        self.assertTrue(correctness["s1_route"])
        self.assertTrue(correctness["s1_banner_exact"])
        self.assertTrue(correctness["s1_sentinel_exact"])
        self.assertTrue(correctness["s2_no_route"])
        self.assertTrue(correctness["s2_sentinel_exact"])
        self.assertTrue(correctness["bounded_activation"])

    def test_adversarial_and_cleanup_gates_are_machine_readable(self) -> None:
        report = _load_probe().run_probe(PLUGIN_ROOT, SCENARIO, samples=2)

        self.assertEqual(
            report["adversarial"],
            {"malformed_input": True, "stale_state": True, "dirty_worktree": True},
        )
        self.assertEqual(
            report["cleanup"],
            {
                "temp_homes_remaining": 0,
                "temp_workspaces_remaining": 0,
                "bytecode_files_remaining": 0,
                "child_processes_remaining": 0,
            },
        )


if __name__ == "__main__":
    unittest.main()
