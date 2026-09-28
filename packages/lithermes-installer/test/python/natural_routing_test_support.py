"""Shared fixtures for LitHermes natural-route tests."""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)


def _skill_body(name: str) -> str:
    return (Path(_ASSET_DIR) / "skills" / name / "SKILL.md").read_text(encoding="utf-8").strip()


def _load_plugin_package():
    spec = importlib.util.spec_from_file_location(
        "lithermes_natural_pkg",
        os.path.join(_ASSET_DIR, "__init__.py"),
        submodule_search_locations=[_ASSET_DIR],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lithermes_natural_pkg"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class _FakeCtx:
    def __init__(self):
        self.command_handlers = {}
        self.hooks = []
        self.tools = []
        self.cli_commands = []
        self.skills = []

    def register_hook(self, name, cb):
        self.hooks.append((name, cb))

    def register_tool(self, name, toolset, schema, handler, description="", **kw):
        self.tools.append(name)

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        self.cli_commands.append(name)

    def register_command(self, name, handler, description="", args_hint=""):
        self.command_handlers[name] = handler

    def register_skill(self, name, path, description=""):
        self.skills.append(name)

class NaturalRoutingCase(unittest.TestCase):
    def setUp(self):
        self.isolated_root = tempfile.TemporaryDirectory(
            prefix="lithermes-natural-routing-root-"
        )
        self.previous_tempdir = tempfile.tempdir
        tempfile.tempdir = self.isolated_root.name
        hermes_home = Path(self.isolated_root.name) / "home"
        hermes_home.mkdir()
        self.environment = patch.dict(
            os.environ,
            {
                "HOME": str(hermes_home),
                "HERMES_HOME": str(hermes_home),
                "LITHERMES_ISOLATED_ROOT": self.isolated_root.name,
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.isolated_root.cleanup)
        self.addCleanup(setattr, tempfile, "tempdir", self.previous_tempdir)
        self.addCleanup(self.environment.stop)
        self.pkg = _load_plugin_package()
        self.core = self.pkg.core
        self.core._PENDING_IGNITE.clear()
        if hasattr(self.core, "_PENDING_BLOCK"):
            self.core._PENDING_BLOCK.clear()

    def _hook(self, message: str, session: str = "nat", *, isolated: bool = True):
        if not isolated:
            return self.pkg._pre_llm_call(user_message=message, session_id=session, platform="cli")
        with tempfile.TemporaryDirectory() as tmp:
            prev = os.getcwd()
            os.chdir(tmp)
            try:
                return self.pkg._pre_llm_call(user_message=message, session_id=session, platform="cli")
            finally:
                os.chdir(prev)

    def _assert_contract_terms(self, context: str):
        for required in (
            "lithermes_llm_contract/v1",
            "#contract.activation",
            "#contract.inputs",
            "#contract.outputs",
            "#contract.evidence",
            "#contract.hard_stops",
        ):
            self.assertIn(required, context)
