"""Private helpers for provider-free LitHermes phase timing."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator


SCENARIO_SCHEMA = "litfamily.harness-speed-scenario/v1"
SCENARIO_ID = "litfamily-speed-lit-activation-v1"
EXACT_BANNER = "🔥 **LIT IGNITED · litwork** 🔥"


class HostAdapter:
    """Minimal Hermes-shaped adapter that records shipped callbacks verbatim."""

    def __init__(self) -> None:
        self.hooks: dict[str, Callable[..., object]] = {}
        self.tools: list[str] = []
        self.cli_commands: list[str] = []
        self.commands: list[str] = []
        self.skills: list[str] = []

    def register_hook(self, name, callback) -> None:
        self.hooks[name] = callback

    def register_tool(self, name, toolset, schema, handler, description="", **kwargs) -> None:
        self.tools.append(name)

    def register_cli_command(
        self, name, help, setup_fn, handler_fn=None, description=""
    ) -> None:
        self.cli_commands.append(name)

    def register_command(self, name, handler, description="", args_hint="") -> None:
        self.commands.append(name)

    def register_skill(self, name, path, description="") -> None:
        self.skills.append(name)


def utf8_bytes(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, dict):
        value = value.get("context", "")
    return len(str(value).encode("utf-8"))


def load_scenario(path: Path) -> dict[str, dict[str, object]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("malformed_input: scenario is not readable JSON") from error
    if (
        not isinstance(payload, dict)
        or payload.get("schema") != SCENARIO_SCHEMA
        or payload.get("scenario_id") != SCENARIO_ID
        or payload.get("encoding") != "UTF-8"
        or payload.get("prompt_trailing_newline") is not False
    ):
        raise ValueError("malformed_input: scenario identity mismatch")
    records = payload.get("records")
    if not isinstance(records, list) or [row.get("id") for row in records] != ["B0", "S1", "S2"]:
        raise ValueError("malformed_input: scenario records mismatch")
    validated: dict[str, dict[str, object]] = {}
    for row in records:
        if not isinstance(row, dict):
            raise ValueError("malformed_input: scenario record is not an object")
        prompt = row.get("prompt")
        sentinel = row.get("sentinel")
        if not isinstance(prompt, str) or not isinstance(sentinel, str):
            raise ValueError("malformed_input: prompt or sentinel is not text")
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        sentinel_hash = hashlib.sha256(sentinel.encode("utf-8")).hexdigest()
        if (
            row.get("prompt_bytes") != utf8_bytes(prompt)
            or row.get("prompt_sha256") != prompt_hash
            or row.get("sentinel_bytes") != utf8_bytes(sentinel)
            or row.get("sentinel_sha256") != sentinel_hash
        ):
            raise ValueError("malformed_input: scenario digest mismatch")
        validated[str(row["id"])] = row
    return validated


def load_plugin(plugin_root: Path):
    root = plugin_root.resolve()
    if not (root / "__init__.py").is_file():
        raise ValueError("malformed_input: plugin root has no package entrypoint")
    root_text = str(root)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    name = f"lithermes_speed_payload_{os.getpid()}_{time.perf_counter_ns()}"
    spec = importlib.util.spec_from_file_location(
        name, root / "__init__.py", submodule_search_locations=[root_text]
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load installed plugin payload")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@contextmanager
def cwd(path: Path) -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


def measure(samples: int, operation: Callable[[int], object]) -> dict[str, object]:
    durations: list[int] = []
    sizes: list[int] = []
    for index in range(samples):
        started = time.perf_counter_ns()
        result = operation(index)
        durations.append(time.perf_counter_ns() - started)
        sizes.append(utf8_bytes(result))
    duration_ms = [value / 1_000_000 for value in durations]
    byte_values = [float(value) for value in sizes]
    return {
        "samples": samples,
        "p50_ms": round(percentile(duration_ms, 0.50), 6),
        "p95_ms": round(percentile(duration_ms, 0.95), 6),
        "output_bytes_p50": int(percentile(byte_values, 0.50)),
        "output_bytes_p95": int(percentile(byte_values, 0.95)),
    }


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def hook(adapter: HostAdapter, name: str) -> Callable[..., object]:
    callback = adapter.hooks.get(name)
    if callback is None:
        raise RuntimeError(f"registered surface is missing hook {name}")
    return callback


def bounded_fixture(plugin, workspace: Path) -> str:
    plan = workspace / "plans" / "approved.md"
    plan.parent.mkdir(parents=True, exist_ok=True)
    plan.write_text(
        "# Approved local timing fixture\n\n## Success Criteria\n"
        "- [x] C001 | channel: cli | scenario: provider-free local timing\n\n"
        "## Todos\n- [ ] T001 | exercise the bounded activation seam\n",
        encoding="utf-8",
    )
    created = plugin.core.init_bounded_work(
        workspace, plan, grants=[{"action": "write", "root": str(workspace)}]
    )
    return plugin.bounded_work.activation_envelope(
        workspace, created["state"]["work_id"], created["activation_token"]
    )
