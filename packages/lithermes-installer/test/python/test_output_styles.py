"""Tests for output_styles.py: config reader and block injection."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class OutputStylesConfigReaderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.output_styles = cls.pkg.core._output_styles

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.hermes_home = Path(self._tmp.name) / ".hermes"
        self.hermes_home.mkdir()
        self._env_patch = mock.patch.dict(
            os.environ, {"HERMES_HOME": str(self.hermes_home)}, clear=False
        )
        self._env_patch.start()

    def tearDown(self):
        self._env_patch.stop()
        self._tmp.cleanup()

    def _write_config(self, text: str) -> None:
        _write(self.hermes_home / "config.yaml", text)

    def test_returns_empty_for_missing_config(self):
        result = self.output_styles._read_style_id()
        self.assertEqual(result, "")

    def test_returns_empty_for_malformed_yaml(self):
        self._write_config("{ bad yaml: [\n")
        result = self.output_styles._read_style_id()
        self.assertEqual(result, "")

    def test_returns_empty_when_outputStyle_missing(self):
        self._write_config("plugins:\n  enabled:\n    - lithermes\n")
        result = self.output_styles._read_style_id()
        self.assertEqual(result, "")

    def test_returns_style_id_when_set(self):
        self._write_config("outputStyle: asd-ste100\n")
        result = self.output_styles._read_style_id()
        self.assertEqual(result, "asd-ste100")

    def test_returns_empty_for_off_style(self):
        self._write_config("outputStyle: off\n")
        result = self.output_styles.output_style_block()
        self.assertEqual(result, "")

    def test_returns_empty_for_missing_config_block(self):
        result = self.output_styles.output_style_block()
        self.assertEqual(result, "")

    def test_returns_empty_for_unknown_style_id(self):
        self._write_config("outputStyle: unknown-style\n")
        result = self.output_styles.output_style_block()
        self.assertEqual(result, "")

    def test_returns_nonempty_for_asd_ste100(self):
        self._write_config("outputStyle: asd-ste100\n")
        result = self.output_styles.output_style_block()
        self.assertIsInstance(result, str)
        self.assertGreater(len(result.strip()), 0)

    def test_returns_nonempty_for_eli5(self):
        self._write_config("outputStyle: eli5\n")
        result = self.output_styles.output_style_block()
        self.assertIsInstance(result, str)
        self.assertGreater(len(result.strip()), 0)

    def test_returns_nonempty_for_asd_ste100_ko(self):
        self._write_config("outputStyle: asd-ste100-ko\n")
        result = self.output_styles.output_style_block()
        self.assertIsInstance(result, str)
        self.assertGreater(len(result.strip()), 0)

    def test_returns_nonempty_for_eli5_ko(self):
        self._write_config("outputStyle: eli5-ko\n")
        result = self.output_styles.output_style_block()
        self.assertIsInstance(result, str)
        self.assertGreater(len(result.strip()), 0)


class ConsumeRulesContextOutputStyleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.hermes_home = Path(self._tmp.name) / ".hermes"
        self.hermes_home.mkdir()
        self._env_patch = mock.patch.dict(
            os.environ, {"HERMES_HOME": str(self.hermes_home)}, clear=False
        )
        self._env_patch.start()
        self.core._rules.engine._SESSION_STATE.clear()
        self.core._PENDING_POST_EDIT.clear()

    def tearDown(self):
        self._env_patch.stop()
        self._tmp.cleanup()

    def _write_config(self, text: str) -> None:
        _write(self.hermes_home / "config.yaml", text)

    def test_style_off_injects_nothing_extra(self):
        result = self.core.consume_rules_context(
            is_first_turn=True, session_id="s1", conversation_history=[]
        )
        self._write_config("outputStyle: off\n")
        result_off = self.core.consume_rules_context(
            is_first_turn=True, session_id="s2", conversation_history=[]
        )
        self.assertEqual(result, result_off)

    def test_set_style_appears_on_first_turn(self):
        self._write_config("outputStyle: asd-ste100\n")
        result = self.core.consume_rules_context(
            is_first_turn=True, session_id="s3", conversation_history=[]
        )
        style_text = self.core._output_styles.output_style_block()
        self.assertGreater(len(style_text.strip()), 0)
        self.assertIn(style_text.strip()[:40], result)

    def test_style_not_injected_on_non_first_turn(self):
        self._write_config("outputStyle: eli5\n")
        style_text = self.core._output_styles.output_style_block()
        result = self.core.consume_rules_context(
            is_first_turn=False, session_id="s4", conversation_history=[]
        )
        self.assertNotIn(style_text[:40], result)


if __name__ == "__main__":
    unittest.main()
