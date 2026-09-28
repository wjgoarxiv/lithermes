"""Shared package-loading fixtures for LitHermes registration tests."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

    sys.path.insert(0, _ASSET_DIR)


def _skill_body(name: str) -> str:
    return (Path(_ASSET_DIR) / "skills" / name / "SKILL.md").read_text(encoding="utf-8").strip()


def _load_plugin_package():
    spec = importlib.util.spec_from_file_location(
        "lithermes_plugin_pkg",
        os.path.join(_ASSET_DIR, "__init__.py"),
        submodule_search_locations=[_ASSET_DIR],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lithermes_plugin_pkg"] = mod
    spec.loader.exec_module(mod)
    return mod


class _FakeCtx:
    def __init__(self):
        self.hooks = []
        self.tools = []
        self.cli_commands = []
        self.commands = []
        self.command_handlers = {}
        self.command_specs = {}
        self.skills = []

    def register_hook(self, name, cb):
        self.hooks.append(name)

    def register_tool(self, name, toolset, schema, handler, description="", **kw):
        self.tools.append({"name": name, "toolset": toolset})

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        self.cli_commands.append(name)

    def register_command(self, name, handler, description="", args_hint=""):
        self.commands.append(name)
        self.command_handlers[name] = handler
        self.command_specs[name] = {
            "description": description,
            "args_hint": args_hint,
        }

    def register_skill(self, name, path, description=""):
        self.skills.append((name, str(path)))
