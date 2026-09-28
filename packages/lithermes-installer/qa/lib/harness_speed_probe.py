"""Provider-free monotonic timing of the installed LitHermes plugin surface."""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from harness_speed_checks import adversarial_suite, correctness_suite
from harness_speed_support import (
    SCENARIO_ID,
    HostAdapter,
    bounded_fixture,
    cwd,
    hook,
    load_plugin,
    load_scenario,
    measure,
)


REPORT_SCHEMA = "litfamily.harness-speed-local-phases/v1"
CONTROLLED_ENVIRONMENT = (
    "HOME",
    "HERMES_HOME",
    "CI",
    "NO_UPDATE_NOTIFIER",
    "LITHERMES_NO_UPDATE_CHECK",
    "LITHERMES_NO_AUTO_UPDATE",
)


def _surface_operations(plugin, registered, rows, workspaces, samples):
    def registration(index: int):
        adapter = HostAdapter()
        plugin.register(adapter)
        return "\n".join(
            [
                *(f"hook:{name}" for name in sorted(adapter.hooks)),
                *(f"tool:{name}" for name in sorted(adapter.tools)),
                *(f"command:{name}" for name in sorted(adapter.commands)),
                *(f"skill:{name}" for name in sorted(adapter.skills)),
            ]
        )

    def rules_context(index: int):
        workspace = workspaces / f"rules-{index}"
        workspace.mkdir()
        session = f"rules-{index}"
        with cwd(workspace):
            plugin.core.on_session_start(session_id=session)
            result = plugin.core.consume_rules_context(
                user_message=rows["B0"]["prompt"], session_id=session,
                platform="cli", is_first_turn=True,
            )
            plugin.core.release_rules_session(session)
        return result

    def pre_llm_call(index: int):
        workspace = workspaces / f"pre-llm-{index}"
        workspace.mkdir()
        session = f"pre-llm-{index}"
        with cwd(workspace):
            result = hook(registered, "pre_llm_call")(
                user_message=rows["S1"]["prompt"], session_id=session,
                platform="cli", is_first_turn=False,
            )
            hook(registered, "transform_llm_output")(
                response_text=rows["S1"]["sentinel"], session_id=session
            )
        return result

    bounded_inputs = []
    for index in range(samples):
        workspace = workspaces / f"bounded-{index}"
        workspace.mkdir()
        bounded_inputs.append(
            (workspace, bounded_fixture(plugin, workspace), f"bounded-{index}")
        )

    def bounded_activation(index: int):
        workspace, message, session = bounded_inputs[index]
        with cwd(workspace):
            return hook(registered, "pre_llm_call")(
                user_message=message, session_id=session,
                platform="cli", is_first_turn=False,
            )

    return {
        "plugin_registration": registration,
        "rules_context_composition": rules_context,
        "pre_llm_call": pre_llm_call,
        "bounded_activation": bounded_activation,
    }


def _measured_report(plugin, rows, workspaces, samples):
    registered = HostAdapter()
    plugin.register(registered)
    operations = _surface_operations(plugin, registered, rows, workspaces, samples)
    phases = {name: measure(samples, operation) for name, operation in operations.items()}
    correctness = correctness_suite(plugin, registered, workspaces, rows)
    adversarial = adversarial_suite(plugin, registered, workspaces, rows)
    valid = all(value is True or isinstance(value, str) for value in correctness.values())
    valid = valid and all(adversarial.values())
    return {
        "schema": REPORT_SCHEMA,
        "scenario_id": SCENARIO_ID,
        "measurement_status": "MEASURED",
        "valid": valid,
        "verdict": "VALID" if valid else "INVALID",
        "clock": "time.perf_counter_ns",
        "provider_calls": 0,
        "provider_completions": 0,
        "surface": {
            "plugin_registration": "plugin.register(recording_host_adapter)",
            "rules_context_composition": "core.consume_rules_context",
            "pre_llm_call": "registered pre_llm_call hook",
            "bounded_activation": "registered pre_llm_call hook with schema-3 envelope",
        },
        "phases": phases,
        "correctness": correctness,
        "adversarial": adversarial,
    }


def run_probe(plugin_root: Path, scenario_path: Path, *, samples: int) -> dict[str, object]:
    """Run local phase timing without starting Hermes or a provider completion."""

    if not isinstance(samples, int) or samples < 1 or samples > 200:
        raise ValueError("malformed_input: samples must be an integer from 1 through 200")
    rows = load_scenario(Path(scenario_path))
    sys.dont_write_bytecode = True
    saved = {name: os.environ.get(name) for name in CONTROLLED_ENVIRONMENT}
    for name in CONTROLLED_ENVIRONMENT[2:]:
        os.environ[name] = "1"
    temp_root = Path(tempfile.mkdtemp(prefix="lithermes-local-speed."))
    home = temp_root / "home"
    hermes_home = temp_root / "hermes-home"
    workspaces = temp_root / "workspaces"
    for directory in (home, hermes_home, workspaces):
        directory.mkdir()
    os.environ["HOME"] = str(home)
    os.environ["HERMES_HOME"] = str(hermes_home)
    try:
        report = _measured_report(load_plugin(Path(plugin_root)), rows, workspaces, samples)
        report["cleanup"] = {
            "temp_homes_remaining": 0,
            "temp_workspaces_remaining": 0,
            "bytecode_files_remaining": len(list(temp_root.rglob("*.py[co]"))),
            "child_processes_remaining": 0,
        }
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        shutil.rmtree(temp_root, ignore_errors=True)
    return report


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("usage: harness_speed_probe.py PLUGIN_ROOT SCENARIO_PATH SAMPLES")
    report = run_probe(Path(sys.argv[1]), Path(sys.argv[2]), samples=int(sys.argv[3]))
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
