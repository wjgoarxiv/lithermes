"""The Jev skill hint is gone and must not come back.

A plain prompt that once earned a hint now goes through the hooks with the old
switches set and reaches no network and gains no extra line. Doctor names old
hint files only as something the user may delete, and never deletes them.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import socket
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

try:
    from .plugin_register_test_support import _ASSET_DIR, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


PLUGIN = Path(_ASSET_DIR)
PROMPT = "Please make this Korean report draft read naturally without the machine-written tone."
RETIRED = re.compile(r"LITHERMES_JEV|TYPESAFE_API_KEY|typesafe\.ai|jev_hint|skill hint ON", re.IGNORECASE)


class _NoNetwork(Exception):
    pass


def _refuse(*_args, **_kwargs):
    raise _NoNetwork("network call attempted")


class JevStaysRemoved(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self._env = patch.dict(os.environ, {
            "HERMES_HOME": str(self.home),
            "LITHERMES_JEV": "1",
            "TYPESAFE_API_KEY": "test-key-not-real-0000",
            "LITHERMES_NO_AUTO_UPDATE": "1",
            "LITHERMES_NO_UPDATE_CHECK": "1",
        })
        self._env.start()
        self._cwd = os.getcwd()
        os.chdir(self.home)

    def tearDown(self):
        os.chdir(self._cwd)
        self._env.stop()
        self._tmp.cleanup()

    def test_payload_carries_no_hint_module_switch_or_endpoint(self):
        self.assertFalse((PLUGIN / "jev_hint.py").exists())
        self.assertFalse(hasattr(self.pkg, "jev_hint"))
        manifest = json.loads((PLUGIN / "payload-version.json").read_text(encoding="utf-8"))
        self.assertNotIn("jev", json.dumps(manifest).lower())
        offenders = []
        for path in PLUGIN.rglob("*"):
            if not path.is_file() or path.suffix not in {".py", ".md", ".json", ".yaml", ".js", ".mjs"}:
                continue
            if RETIRED.search(path.read_text(encoding="utf-8", errors="ignore")):
                offenders.append(str(path.relative_to(PLUGIN)))
        self.assertEqual(offenders, [])

    def test_plain_prompt_with_old_switches_makes_no_call_and_gets_no_hint(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(urllib.request, "urlopen", _refuse), \
                patch.object(socket, "create_connection", _refuse), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = self.pkg._pre_llm_call(session_id="jev-gone", user_message=PROMPT, platform="cli")
            reply = self.pkg._transform_llm_output(session_id="jev-gone", response_text="model reply")
        context = str((result or {}).get("context") or "") if isinstance(result, dict) else str(result or "")
        for text in (context, str(reply or ""), out.getvalue(), err.getvalue()):
            self.assertNotRegex(text, r"(?i)jev|skill hint|lithermes:lit-humanizer")
        self.assertIn(reply, (None, "model reply"))
        self.assertFalse((self.home / "lithermes").exists() and any((self.home / "lithermes").glob("jev-*")))

    def test_status_and_doctor_say_nothing_without_old_files(self):
        diagnostics = __import__(self.pkg.__name__ + ".diagnostics", fromlist=["x"])
        lines, _ = diagnostics.doctor_report("0.21.3")
        self.assertFalse([line for line in lines if re.search(r"(?i)jev|skill hint", line)])
        self.assertNotRegex(diagnostics.status_report("0.21.3"), r"(?i)jev|skill hint")

    def test_doctor_points_at_old_files_and_keeps_them(self):
        state = self.home / "lithermes"
        state.mkdir()
        old = [state / "jev-trace.jsonl", state / "jev-last-0123abcd.json"]
        for path in old:
            path.write_text("{}\n", encoding="utf-8")
        diagnostics = __import__(self.pkg.__name__ + ".diagnostics", fromlist=["x"])
        lines, _ = diagnostics.doctor_report("0.21.3")
        notes = [line for line in lines if "Jev" in line]
        self.assertEqual(notes, [f"[NOTE] old Jev data can be deleted at {state}/jev-*"])
        self.assertTrue(all(path.exists() for path in old))


if __name__ == "__main__":
    unittest.main()
