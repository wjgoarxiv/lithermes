"""The emitter must not write outside a declared isolation root.

Why this exists: the event ledger resolves its own path from HERMES_HOME/HOME
(`core_runtime.get_hermes_home`, which the Hermes host owns in production), not
from whatever workspace a caller passed. A probe can isolate the workspace
perfectly — the plan artifact lands in a temp dir — while the ledger write still
goes to the operator's real profile. That happened twice in this repo from two
different call sites, each time fixed per-probe. This is the shared fix.

The guard is opt-in via LITHERMES_ISOLATED_ROOT and inert without it, so
production behaviour is unchanged. `test_the_guard_is_inert_in_production` pins
that, because a guard that changes shipped behaviour would be a worse trade.
"""

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


class EmitterIsolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core
        from importlib import import_module
        cls.rt = import_module("lithermes_plugin_pkg.core_runtime")

    def setUp(self):
        self._saved = os.environ.get("LITHERMES_ISOLATED_ROOT")
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("LITHERMES_ISOLATED_ROOT", None)
        else:
            os.environ["LITHERMES_ISOLATED_ROOT"] = self._saved
        self._tmp.cleanup()

    # -- inert by default ---------------------------------------------------

    def test_the_guard_is_inert_in_production(self):
        """Unset means no behaviour change. The shipped plugin must be unaffected."""
        os.environ.pop("LITHERMES_ISOLATED_ROOT", None)
        self.assertIsNone(self.rt.isolated_root())
        # any path is acceptable when no root is declared
        self.rt.assert_within_isolation(Path("/anywhere/at/all.jsonl"))

    def test_an_empty_or_blank_value_is_treated_as_unset(self):
        for value in ("", "   "):
            with self.subTest(value=repr(value)):
                os.environ["LITHERMES_ISOLATED_ROOT"] = value
                self.assertIsNone(self.rt.isolated_root())
                self.rt.assert_within_isolation(Path("/anywhere/at/all.jsonl"))

    # -- enforcing ----------------------------------------------------------

    def test_a_write_inside_the_root_is_allowed(self):
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        target = self.root / "nested" / "events.jsonl"
        self.rt.append_jsonl(target, {"event": "ok"})
        self.assertTrue(target.is_file())
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["event"], "ok")

    def test_a_write_outside_the_root_raises_and_creates_nothing(self):
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        with tempfile.TemporaryDirectory() as elsewhere:
            target = Path(elsewhere).resolve() / "lithermes" / "events.jsonl"
            with self.assertRaises(self.rt.IsolationViolation) as ctx:
                self.rt.append_jsonl(target, {"event": "leak"})
            message = str(ctx.exception)
            self.assertIn("refusing to write outside", message)
            self.assertIn(str(target), message)
            self.assertIn("HERMES_HOME/HOME", message)
            self.assertFalse(target.exists(), "nothing may be created on the refused path")
            self.assertFalse(target.parent.exists(), "not even the parent directory")

    def test_a_traversal_path_cannot_escape_the_root(self):
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        with self.assertRaises(self.rt.IsolationViolation):
            self.rt.append_jsonl(self.root / ".." / "escaped.jsonl", {"event": "leak"})

    # -- the real regression ------------------------------------------------

    def test_record_event_is_covered_because_it_goes_through_append_jsonl(self):
        """record_event resolves its own path; the guard is what catches it."""
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        saved_home = os.environ.get("HERMES_HOME")
        with tempfile.TemporaryDirectory() as elsewhere:
            os.environ["HERMES_HOME"] = elsewhere
            try:
                # record_event swallows OSError but must NOT swallow this.
                with self.assertRaises(self.rt.IsolationViolation):
                    self.rt.append_jsonl(self.rt.event_log_path(), {"event": "leak"})
                self.assertFalse(
                    (Path(elsewhere) / "lithermes" / "events.jsonl").exists(),
                    "the out-of-root ledger must not exist",
                )
            finally:
                if saved_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = saved_home

    def test_the_phase4_defect_shape_is_now_caught(self):
        """Workspace isolated, ledger not — exactly what wrote 9 lines to the profile."""
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        saved_home = os.environ.get("HERMES_HOME")
        with tempfile.TemporaryDirectory() as elsewhere:
            os.environ["HERMES_HOME"] = elsewhere
            try:
                workspace = self.root / "ws"
                workspace.mkdir()
                # scaffold_plan writes its draft into the (isolated) workspace and
                # its event into the (non-isolated) ledger. The draft is fine; the
                # event is the leak, and it must now raise.
                with self.assertRaises(self.rt.IsolationViolation):
                    self.core.scaffold_plan("probe-slug", workspace)
                self.assertFalse((Path(elsewhere) / "lithermes" / "events.jsonl").exists())
            finally:
                if saved_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = saved_home

    def test_every_append_primitive_in_the_payload_is_guarded(self):
        """A new unguarded emitter is exactly how this defect returns."""
        asset_root = Path(self.rt.__file__).resolve().parent
        append_re = __import__("re").compile(r"""\.open\(\s*["']a["']""")
        unguarded = []
        for source in sorted(asset_root.rglob("*.py")):
            if "__pycache__" in source.parts:
                continue
            # Bundled reference scripts a user runs in their own project are not
            # LitHermes emitters; only plugin runtime modules are in scope.
            if "skills" in source.parts:
                continue
            text = source.read_text(encoding="utf-8")
            if not append_re.search(text):
                continue
            if "assert_within_isolation" not in text:
                unguarded.append(str(source.relative_to(asset_root)))
        self.assertEqual(
            unguarded, [],
            "these payload modules append to a file without the isolation guard; "
            "route them through core_runtime.append_jsonl or call "
            "assert_within_isolation first:\n  " + "\n  ".join(unguarded),
        )

    def test_the_litgoal_ledger_is_guarded_too(self):
        os.environ["LITHERMES_ISOLATED_ROOT"] = str(self.root)
        from importlib import import_module
        store = import_module("lithermes_plugin_pkg.litgoal.store")
        with tempfile.TemporaryDirectory() as elsewhere:
            with self.assertRaises(self.rt.IsolationViolation):
                store.append_ledger(Path(elsewhere).resolve(), {"kind": "leak"})


if __name__ == "__main__":
    unittest.main()
