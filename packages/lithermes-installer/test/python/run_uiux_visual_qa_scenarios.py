#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

EXPECTED_IDS = (
    "public-service-form-ko",
    "fintech-dashboard",
    "healthcare-mobile",
    "saas-landing-responsive",
    "brownfield-design-system",
    "reference-fidelity",
    "cjk-terminal-dashboard",
    "missing-capture-auth-review",
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def finding_result(scenario_id: str, codes: list[str], **extra: Any) -> dict[str, Any]:
    return {"finding_codes": codes, "scenario_id": scenario_id, "verdict": "FAIL", **extra}


def evaluate(
    scenario: dict[str, Any],
    inspect_tui: Callable[..., dict[str, Any]],
    evaluate_capabilities: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    scenario_id = scenario["scenario_id"]
    signals = scenario["signals"]
    if scenario_id == "public-service-form-ko":
        codes = []
        if signals.get("keyboard_focus_visible") is not True:
            codes.append("A11Y_FOCUS_VISIBLE_MISSING")
        if float(signals.get("text_contrast_ratio", 0)) < 4.5:
            codes.append("WCAG_1_4_3_CONTRAST_INSUFFICIENT")
        return finding_result(scenario_id, codes)
    if scenario_id == "fintech-dashboard":
        codes = []
        if signals.get("chart_color_only") is True:
            codes.append("CHART_COLOR_ONLY")
        if signals.get("nonvisual_fallback_present") is not True:
            codes.append("CHART_NONVISUAL_FALLBACK_MISSING")
        return finding_result(scenario_id, codes)
    if scenario_id == "healthcare-mobile":
        if signals.get("production_mutations") != 0:
            raise ValueError("healthcare scenario attempted a production mutation")
        codes = []
        if signals.get("destructive_action_safe") is not True:
            codes.append("DESTRUCTIVE_ACTION_UNSAFE")
        if int(signals.get("minimum_touch_target", 0)) < 44:
            codes.append("TOUCH_TARGET_UNDERSIZED")
        return finding_result(scenario_id, codes, production_mutations=0)
    if scenario_id == "saas-landing-responsive":
        codes = []
        if int(signals.get("mobile_overflow_pixels", 0)) > 0:
            codes.append("RESPONSIVE_MOBILE_OVERFLOW")
        if signals.get("reduced_motion_respected") is not True:
            codes.append("REDUCED_MOTION_IGNORED")
        return finding_result(scenario_id, codes)
    if scenario_id == "brownfield-design-system":
        codes = []
        if signals.get("token_bypass") is True:
            codes.append("DESIGN_TOKEN_BYPASS")
        if signals.get("duplicated_primitive") is True:
            codes.append("COMPONENT_PRIMITIVE_DUPLICATED")
        pointer = signals.get("source_pointer")
        if not isinstance(pointer, str) or ":" not in pointer:
            raise ValueError("brownfield result requires a source pointer")
        return finding_result(scenario_id, codes, source_pointer=pointer)
    if scenario_id == "reference-fidelity":
        codes = []
        if signals.get("target_dimensions") != signals.get("reference_dimensions"):
            codes.append("REFERENCE_DIMENSION_MISMATCH")
        if signals.get("screenshot_substitution") is True:
            codes.append("SCREENSHOT_SUBSTITUTION")
        return finding_result(scenario_id, codes, similarity_advisory=True)
    if scenario_id == "cjk-terminal-dashboard":
        result = inspect_tui(
            str(signals.get("capture", "")),
            columns=int(signals.get("columns", 0)),
            ambiguous_width=int(signals.get("ambiguous_width", 1)),
        )
        return finding_result(
            scenario_id,
            [str(item["code"]) for item in result["findings"]],
            osc_inert=result["osc_inert"],
        )
    if scenario_id == "missing-capture-auth-review":
        blocked = evaluate_capabilities({"tier": "full", "capabilities": signals["capabilities"]})
        return {
            "blocked_codes": blocked["blocked_codes"],
            "finding_codes": [],
            "scenario_id": scenario_id,
            "verdict": blocked["verdict"],
        }
    raise ValueError(f"unknown scenario: {scenario_id}")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run deterministic LitHermes UI/UX and visual-QA fixtures")
    result.add_argument("--installed-root", required=True, type=Path)
    result.add_argument("--fixtures", required=True, type=Path)
    result.add_argument("--scenario", required=True, choices=("all",) + EXPECTED_IDS)
    result.add_argument("--json", action="store_true", required=True)
    return result


def run(arguments: list[str]) -> int:
    args = parser().parse_args(arguments)
    visual_scripts = args.installed_root / "skills" / "visual-qa" / "scripts"
    if not visual_scripts.is_dir():
        raise ValueError("installed visual-qa scripts are missing")
    sys.path.insert(0, str(args.installed_root))
    sys.path.insert(0, str(visual_scripts))
    from tui_runtime import inspect_tui
    from visual_contracts import evaluate_capabilities

    fixtures = load_json(args.fixtures / "scenarios.json")
    expected = load_json(args.fixtures / "expected-results.json")
    scenarios = fixtures.get("scenarios")
    if not isinstance(scenarios, list) or tuple(item.get("scenario_id") for item in scenarios) != EXPECTED_IDS:
        raise ValueError("exact ordered eight-scenario inventory required")
    selected = scenarios if args.scenario == "all" else [
        item for item in scenarios if item["scenario_id"] == args.scenario
    ]
    results = []
    for scenario in selected:
        scenario_id = scenario["scenario_id"]
        prompt = (args.fixtures / scenario_id / "prompt.md").read_text(encoding="utf-8")
        if "lithermes:frontend-ui-ux" not in prompt or "lithermes:visual-qa" not in prompt:
            raise ValueError(f"scenario prompt is not organically routed: {scenario_id}")
        result = evaluate(scenario, inspect_tui, evaluate_capabilities)
        contract = expected["results"][scenario_id]
        for key in ("verdict", "finding_codes", "blocked_codes"):
            if key in contract and result.get(key) != contract[key]:
                raise ValueError(f"false result for {scenario_id}: {key}")
        results.append(result)
    false_pass_count = sum(item["verdict"] == "PASS" for item in results)
    output = {
        "dataset_sha256": fixtures["dataset_sha256"],
        "false_pass_count": false_pass_count,
        "max_review_rounds": 2,
        "results": results,
        "schema_id": "litfamily.uiux-visual-qa-scenario-results/v1",
        "seeded_critical_high_detected": sum(item["verdict"] in {"FAIL", "BLOCKED"} for item in results),
    }
    print(json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0 if false_pass_count == 0 else 2


if __name__ == "__main__":
    try:
        raise SystemExit(run(sys.argv[1:]))
    except (OSError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"error": str(error), "verdict": "FAIL"}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(2)
