"""Provider-cache receipt measurements stay numeric, local, and honest."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


class ProviderMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.metrics = cls.pkg.core._provider_metrics

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = self._tmp.name

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._old_home
        self._tmp.cleanup()

    def _event(self):
        path = Path(self._tmp.name) / "lithermes" / "events.jsonl"
        self.assertTrue(path.is_file())
        return json.loads(path.read_text(encoding="utf-8").splitlines()[-1])

    def test_positive_cache_receipt_is_measured_without_raw_payloads(self):
        self.pkg.core.post_api_request(
            provider="provider-name",
            model="model-name",
            api_mode="responses",
            api_request_id="opaque-id-with-secret-looking-text",
            user_message="do not persist this prompt secret=never-store",
            conversation_history=[{"content": "do not persist this transcript"}],
            request={"body": {"messages": ["do not persist"]}},
            response={"assistant_message": {"content": "do not persist"}},
            base_url="https://secret.example.invalid/endpoint",
            usage={
                "input_tokens": 50,
                "output_tokens": 7,
                "prompt_tokens": 150,
                "total_tokens": 157,
                "reasoning_tokens": 2,
                "cache_read_tokens": 100,
                "cache_write_tokens": 0,
            },
        )

        event = self._event()
        self.assertEqual(event["event"], "provider_cache_measurement")
        self.assertEqual(event["schema"], "lithermes.provider-cache/v1")
        self.assertEqual(event["measurement_status"], "MEASURED")
        self.assertEqual(event["cache_state"], "hit")
        self.assertEqual(event["cache_read_tokens"], 100)
        self.assertEqual(event["cache_write_tokens"], 0)
        self.assertAlmostEqual(event["cache_hit_ratio"], 100 / 150)
        self.assertRegex(event["provider_sha256_16"], r"^[0-9a-f]{16}$")
        self.assertRegex(event["model_sha256_16"], r"^[0-9a-f]{16}$")
        self.assertRegex(event["api_mode_sha256_16"], r"^[0-9a-f]{16}$")
        self.assertNotIn("do not persist", json.dumps(event))
        self.assertNotIn("secret.example.invalid", json.dumps(event))
        self.assertNotIn("provider-name", json.dumps(event))
        self.assertNotIn("model-name", json.dumps(event))

    def test_zero_counters_are_unproven_not_a_latency_or_cache_miss_claim(self):
        self.pkg.core.post_api_request(
            provider="provider-name",
            model="model-name",
            api_mode="responses",
            usage={"input_tokens": 100, "cache_read_tokens": 0, "cache_write_tokens": 0},
            api_duration=0.001,
        )

        event = self._event()
        self.assertEqual(event["measurement_status"], "UNPROVEN")
        self.assertEqual(event["cache_state"], "unknown")
        self.assertIsNone(event["cache_hit_ratio"])
        self.assertIn("not treated as a provider cache miss", event["reason"])
        self.assertNotIn("api_duration", event)

    def test_missing_usage_is_an_explicit_unproven_capability_fixture(self):
        self.pkg.core.post_api_request(
            provider="provider-name",
            model="model-name",
            api_mode="responses",
            usage=None,
        )

        event = self._event()
        self.assertEqual(self.metrics.capability_report()["live_measurement"], "UNPROVEN")
        self.assertEqual(event["measurement_status"], "UNPROVEN")
        self.assertEqual(event["reason"], "provider usage receipt unavailable")
        for field in self.metrics.RECEIPT_FIELDS:
            self.assertNotIn(field, event)


if __name__ == "__main__":
    unittest.main()
