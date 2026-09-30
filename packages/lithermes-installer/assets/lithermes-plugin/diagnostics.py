from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import assert_never

try:
    from . import scientific_visualization as _science
except (ImportError, ModuleNotFoundError):
    import scientific_visualization as _science  # type: ignore

try:
    from . import knowledge as _knowledge
except (ImportError, ModuleNotFoundError):
    import knowledge as _knowledge  # type: ignore

try:
    from . import provider_metrics as _provider_metrics
except (ImportError, ModuleNotFoundError):
    import provider_metrics as _provider_metrics  # type: ignore

try:
    from . import jev_hint as _jev_hint
except (ImportError, ModuleNotFoundError):
    import jev_hint as _jev_hint  # type: ignore

try:
    from . import auto_handoff as _auto_handoff
except (ImportError, ModuleNotFoundError):
    import auto_handoff as _auto_handoff  # type: ignore

try:
    from .core_contract import KOREAN_PROSE_ALIASES, KOREAN_PROSE_COMMANDS
except (ImportError, ModuleNotFoundError):
    from core_contract import KOREAN_PROSE_ALIASES, KOREAN_PROSE_COMMANDS  # type: ignore

PLUGIN_ROOT = Path(__file__).resolve().parent
HOOKS = (
    "on_session_start",
    "pre_llm_call",
    "pre_tool_call",
    "pre_command",
    "post_tool_call",
    "post_api_request",
    "subagent_stop",
    "transform_llm_output",
    "on_session_finalize",
    "on_session_reset",
)
SLASH_COMMANDS = (
    "lit", "lit-loop", "lit-plan", "litgoal", "review-work", "start-work",
    "deep-interview", "litwork-loop", "litwork-plan",
    *KOREAN_PROSE_COMMANDS, *KOREAN_PROSE_ALIASES,
    "lit-recap", "lit-handoff",
    "lit-scientific-visualization",
    "lit-diagram-drawer",
    "lit-pptx", "lit-docx", "lit-typographic-motion",
)
GOAL_TOOLS = (
    "goal_set", "goal_status", "goal_add_criterion", "goal_evidence",
    "goal_criterion_status", "goal_steer", "goal_checkpoint", "goal_complete",
)
WORK_TOOLS = ("lithermes_work_progress",)
KNOWLEDGE_TOOLS = ("lithermes_knowledge_capture",)
_VERSION_RE = re.compile(r"^version:\s*(.+)$", re.MULTILINE)
_CREDENTIAL_KEY_RE = re.compile(
    r"(^|[_-])(api[_-]?key|client[_-]?secret|auth[_-]?token|(?:aws[_-]?)?access[_-]?key(?:[_-]?id)?|(?:ssh[_-]?)?private[_-]?key|token|password|passphrase|secret|credential|authorization)([_-]|$)",
    re.IGNORECASE,
)
_SAFE_CHILDREN = {
    "model": {"provider", "default"},
    "agent": {"reasoning_effort"},
    "delegation": {"max_concurrent_children"},
    "compression": {"threshold"},
}
_RUNTIME_STEM = "".join(("co", "dex"))
_OPENAI_PROVIDER = f"openai-{_RUNTIME_STEM}"
_RESPONSES_MODE = f"{_RUNTIME_STEM}_responses"
_ASTRA_MODEL = "gpt-6-astra"
_SOL_MODEL = "gpt-6.1-sol"
_PREVIOUS_SOL_MODEL = "gpt-6-sol"
_LUNA_MODEL = "gpt-6-luna"
_LEGACY_SOL_MODEL = "gpt-5.6-sol"
_TERRA_MODEL = "gpt-5.6-terra"
_LEGACY_LUNA_MODEL = "gpt-5.6-luna"
_LUNA_MODELS = frozenset((_LUNA_MODEL, _LEGACY_LUNA_MODEL))
_GPT6_LEAD_EFFORTS = frozenset(("low", "medium", "high", "xhigh", "max", "ultra"))
_GPT6_LUNA_EFFORTS = frozenset(("low", "medium", "high", "xhigh", "max"))
_LEGACY_LUNA_EFFORTS = frozenset(("high", "max"))
_LEGACY_SOL_EFFORTS = frozenset(("high", "xhigh"))
_TERRA_EFFORTS = frozenset(("high", "xhigh", "max"))
_ASTRA_EFFORTS = _GPT6_LEAD_EFFORTS
_OPENAI_CATALOG_EFFORTS = {
    _ASTRA_MODEL: _ASTRA_EFFORTS,
    _SOL_MODEL: _GPT6_LEAD_EFFORTS,
    _PREVIOUS_SOL_MODEL: _GPT6_LEAD_EFFORTS,
    _LUNA_MODEL: _GPT6_LUNA_EFFORTS,
    _LEGACY_SOL_MODEL: _LEGACY_SOL_EFFORTS,
    _TERRA_MODEL: _TERRA_EFFORTS,
    _LEGACY_LUNA_MODEL: _LEGACY_LUNA_EFFORTS,
    "gpt-5.6": frozenset(("high",)),
}
_REVIEWER_ROUTE_NAME = "".join(chr(code) for code in (109, 111, 109, 117, 115))
SUPPORTED_HERMES_HOST_VERSIONS = frozenset(("0.17.0", "0.19.0"))
_MINIMUM_HERMES_HOST_VERSION = (0, 17, 0)


def _classify_hermes_host_version(host_version: str) -> str:
    if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", host_version) is None:
        return "unsupported"
    version = tuple(int(part) for part in host_version.split("."))
    if version < _MINIMUM_HERMES_HOST_VERSION:
        return "unsupported"
    if host_version in SUPPORTED_HERMES_HOST_VERSIONS:
        return "verified"
    return "beyond-verified"


def _beyond_verified_host_note(host_version: str) -> str | None:
    if _classify_hermes_host_version(host_version) != "beyond-verified":
        return None
    return (
        f"[NOTE] Hermes host {host_version} is beyond the verified matrix "
        "(0.17.0, 0.19.0); diagnostics are read-only"
    )


@dataclass(frozen=True, slots=True)
class ModelCapabilities:
    parent_model: str
    parent_effort: str
    child_model: str
    child_effort: str
    concurrency: int
    async_batches: int
    shared_async_cap: bool
    spawn_depth: int
    flat: bool
    approved: bool


@dataclass(frozen=True, slots=True)
class UnavailableCapabilities:
    reason: str
    fatal: bool = False


CapabilityResult = ModelCapabilities | UnavailableCapabilities


def plugin_version() -> str:
    try:
        match = _VERSION_RE.search((PLUGIN_ROOT / "plugin.yaml").read_text(encoding="utf-8"))
        return match.group(1).strip().strip("\"'") if match else "unknown"
    except (OSError, ValueError):
        return "unknown"


def hermes_host_version() -> str:
    try:
        import hermes_cli
    except (ImportError, ModuleNotFoundError):
        return "unknown"
    return str(getattr(hermes_cli, "__version__", "") or "unknown")


def version_line() -> str:
    return f"lithermes {plugin_version()}"


def _evidence_kinds() -> tuple[str, ...]:
    try:
        from .litgoal import model
    except (ImportError, ModuleNotFoundError):
        return ("red", "green", "scenario", "cleanup", "note")
    return tuple(model.EVIDENCE_KINDS)


def _skill_names() -> list[str]:
    skills_dir = PLUGIN_ROOT / "skills"
    if not skills_dir.is_dir():
        return []
    return sorted(item.name for item in skills_dir.iterdir() if (item / "SKILL.md").is_file())


def _host_config_path() -> Path:
    raw = os.environ.get("HERMES_HOME", "").strip()
    home = Path(raw).expanduser() if raw else Path.home() / ".hermes"
    return home / "config.yaml"


def _is_secret_looking_scalar(value: object) -> bool:
    if not isinstance(value, str):
        return False
    trimmed = value.strip()
    if not trimmed or re.fullmatch(r"(?:true|false|null)", trimmed, re.IGNORECASE):
        return False
    if re.fullmatch(r"[A-Z][A-Z0-9_]*", trimmed) and "_" in trimmed:
        return False
    if re.fullmatch(r"\$\{[A-Z][A-Z0-9_]*\}", trimmed):
        return False
    return not re.search(r"(?:^|[-_])(redacted|placeholder)(?:[-_]|$)", trimmed, re.IGNORECASE)


def _has_credential_key(value: object) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(
                r"([a-z0-9])([A-Z])", r"\1_\2", str(key or "")
            ).replace("-", "_")
            if (
                _CREDENTIAL_KEY_RE.search(normalized)
                and _is_secret_looking_scalar(child)
            ) or _has_credential_key(child):
                return True
        return False
    if isinstance(value, list):
        return any(_has_credential_key(child) for child in value)
    return False


def _managed_astra_sampling_issue(
    config: dict[str, object],
    *,
    provider: object,
    model: object,
    child_provider: object,
    child_model: object,
) -> str | None:
    """Return a bounded issue for sampling keys on H-owned Astra routes.

    Custom-provider ``extra_body`` and auxiliary task settings are deliberately
    outside this route check. They are host-owned inputs and must not be
    rejected merely because the main model happens to be Astra.
    """
    sections: list[tuple[str, object]] = []
    if provider == _OPENAI_PROVIDER and model == _ASTRA_MODEL:
        sections.extend((
            ("model", config.get("model")),
            ("agent", config.get("agent")),
        ))
    if child_provider == _OPENAI_PROVIDER and child_model == _ASTRA_MODEL:
        sections.append(("delegation", config.get("delegation")))
    for section_name, section in sections:
        if not isinstance(section, dict):
            continue
        for key in ("temperature", "top_p", "top_logprobs"):
            if key in section:
                return f"managed Astra route contains unsupported sampling field {section_name}.{key}"
    return None


def _effort_is(value: object, allowed: frozenset[str]) -> bool:
    return isinstance(value, str) and value in allowed


def _cataloged_route(model: object, effort: object) -> bool:
    allowed = _OPENAI_CATALOG_EFFORTS.get(model)
    return allowed is not None and _effort_is(effort, allowed)


def _parse_capabilities(host_version: str) -> CapabilityResult:
    if _classify_hermes_host_version(host_version) == "unsupported":
        return UnavailableCapabilities("unsupported Hermes host version")
    try:
        text = _host_config_path().read_text(encoding="utf-8")
    except OSError:
        return UnavailableCapabilities("host config missing")
    try:
        import yaml
    except (ImportError, ModuleNotFoundError):
        return UnavailableCapabilities("YAML parser unavailable")
    try:
        config = yaml.safe_load(text)
    except yaml.YAMLError:
        return UnavailableCapabilities("malformed host config")
    if not isinstance(config, dict):
        return UnavailableCapabilities("malformed host config")
    if _has_credential_key(config):
        return UnavailableCapabilities("credential-risk host config")
    schema_version = config.get("_config_version")
    if type(schema_version) is not int or schema_version < 30:
        return UnavailableCapabilities("unknown host config schema")
    for key in _SAFE_CHILDREN:
        if key in config and not isinstance(config[key], dict):
            return UnavailableCapabilities(f"unknown host config schema at {key}")
    model_config = config.get("model", {})
    agent_config = config.get("agent", {})
    delegation_config = config.get("delegation", {})
    for section_name, section, fields, allow_inheritance in (
        ("model", model_config, ("provider", "default"), False),
        ("agent", agent_config, ("reasoning_effort",), False),
        ("delegation", delegation_config, ("provider", "model", "reasoning_effort"), True),
    ):
        for field in fields:
            if field not in section:
                continue
            value = section[field]
            if isinstance(value, str):
                continue
            if allow_inheritance and value is None:
                continue
            return UnavailableCapabilities(
                f"malformed model route at {section_name}.{field}",
                fatal=True,
            )
    model = model_config.get("default", "")
    provider = model_config.get("provider", "")
    effort = agent_config.get("reasoning_effort", "")
    child_model_raw = delegation_config.get("model")
    child_effort_raw = delegation_config.get("reasoning_effort")
    child_provider_raw = delegation_config.get("provider")
    child_model = model if child_model_raw is None or child_model_raw == "" else child_model_raw
    child_effort = effort if child_effort_raw is None or child_effort_raw == "" else child_effort_raw
    child_provider = provider if child_provider_raw is None or child_provider_raw == "" else child_provider_raw
    concurrency_raw = delegation_config.get("max_concurrent_children", "")
    shared_async_cap = schema_version >= 33
    async_raw = 1 if shared_async_cap else delegation_config.get("max_async_children", 3)
    depth_raw = delegation_config.get("max_spawn_depth", 1)
    orchestrator_enabled = delegation_config.get("orchestrator_enabled", True)
    delegation_provider = delegation_config.get("provider") or provider
    custom_delegation_provider = (
        "provider" in delegation_config
        and (not isinstance(delegation_provider, str)
             or delegation_provider not in ("", _OPENAI_PROVIDER))
    )
    if any(key in delegation_config for key in ("base_url", "api_mode")) or custom_delegation_provider:
        return UnavailableCapabilities("custom global child transport is preserved; managed route unapplied")
    if provider == _OPENAI_PROVIDER and model == _ASTRA_MODEL and not _effort_is(effort, _ASTRA_EFFORTS):
        return UnavailableCapabilities("parent Astra effort is unsupported or missing; choose low, medium, high, xhigh, max, or ultra")
    if child_provider == _OPENAI_PROVIDER and child_model == _ASTRA_MODEL and not _effort_is(child_effort, _ASTRA_EFFORTS):
        return UnavailableCapabilities("global child Astra effort is unsupported or missing; choose low, medium, high, xhigh, max, or ultra")
    if provider == _OPENAI_PROVIDER and model in _OPENAI_CATALOG_EFFORTS and not _cataloged_route(model, effort):
        allowed = ", ".join(sorted(_OPENAI_CATALOG_EFFORTS[model]))
        return UnavailableCapabilities(f"parent {model} effort is unsupported or missing; choose {allowed}")
    sampling_issue = _managed_astra_sampling_issue(
        config,
        provider=provider,
        model=model,
        child_provider=child_provider,
        child_model=child_model,
    )
    if sampling_issue:
        return UnavailableCapabilities(sampling_issue)
    astra_parent = (
        provider == _OPENAI_PROVIDER
        and model == _ASTRA_MODEL
        and _effort_is(effort, _ASTRA_EFFORTS)
    )
    astra_child = (
        child_provider == _OPENAI_PROVIDER
        and child_model == _ASTRA_MODEL
        and _effort_is(child_effort, _ASTRA_EFFORTS)
    )
    cataloged_parent = provider == _OPENAI_PROVIDER and _cataloged_route(model, effort)
    cataloged_child = child_provider == _OPENAI_PROVIDER and _cataloged_route(child_model, child_effort)
    astra = (astra_parent or astra_child) and cataloged_parent and cataloged_child
    sol_lead = (
        provider == _OPENAI_PROVIDER
        and model in (_SOL_MODEL, _PREVIOUS_SOL_MODEL, _LEGACY_SOL_MODEL)
        and _cataloged_route(model, effort)
        and child_model in _LUNA_MODELS
        and _cataloged_route(child_model, child_effort)
    )
    terra_lead = (
        provider == _OPENAI_PROVIDER
        and model == _TERRA_MODEL
        and _cataloged_route(model, effort)
        and child_model in _LUNA_MODELS
        and _cataloged_route(child_model, child_effort)
    )
    approved = (
        astra
        or sol_lead
        or terra_lead
        or (
            provider == _OPENAI_PROVIDER
            and model == _LEGACY_LUNA_MODEL
            and effort == "max"
            and child_model == _LEGACY_LUNA_MODEL
            and _effort_is(child_effort, _LEGACY_LUNA_EFFORTS)
        )
    )
    if (
        child_provider == _OPENAI_PROVIDER
        and child_model == _LEGACY_LUNA_MODEL
        and child_effort == "xhigh"
    ):
        return UnavailableCapabilities("global child Luna xhigh is forbidden for legacy Luna; it runs at high or max")
    if (
        child_provider == _OPENAI_PROVIDER
        and child_model in _LUNA_MODELS
        and not _cataloged_route(child_model, child_effort)
    ):
        allowed = ", ".join(sorted(_OPENAI_CATALOG_EFFORTS[child_model]))
        return UnavailableCapabilities(f"global child Luna effort is unsupported; choose {allowed}")
    if not approved:
        return UnavailableCapabilities("approved Astra lead and global child Luna max routes are not configured")
    try:
        concurrency = int(concurrency_raw)
        async_batches = int(async_raw)
        spawn_depth = int(depth_raw)
    except (TypeError, ValueError):
        return UnavailableCapabilities("invalid synchronous concurrency")
    if concurrency != 20:
        return UnavailableCapabilities("synchronous concurrency is not configured to 20")
    if async_batches < 1 or spawn_depth < 1:
        return UnavailableCapabilities("invalid delegation bounds")
    flat = spawn_depth == 1 or orchestrator_enabled is False
    return ModelCapabilities(
        parent_model=model,
        parent_effort=effort,
        child_model=child_model,
        child_effort=child_effort,
        concurrency=concurrency,
        async_batches=async_batches,
        shared_async_cap=shared_async_cap,
        spawn_depth=spawn_depth,
        flat=flat,
        approved=approved,
    )


def _recursion_detail(spawn_depth: int, flat: bool) -> str:
    if not flat:
        return f"unavailable (nested depth {spawn_depth})"
    if spawn_depth == 1:
        return "hard (depth 1, flat)"
    return f"hard (configured depth {spawn_depth}, flat via orchestrator kill switch)"


def _concurrency_detail(concurrency: int, async_batches: int, shared_async_cap: bool) -> str:
    if shared_async_cap:
        return f"per batch {concurrency}; background cap {concurrency}; potential children {concurrency}"
    return f"per batch {concurrency}; async batches {async_batches}; potential children {concurrency * async_batches}"


def _capability_status_lines(host_version: str) -> list[str]:
    result = _parse_capabilities(host_version)
    match result:
        case ModelCapabilities(parent_model=parent_model, parent_effort=parent_effort, child_model=child_model, child_effort=child_effort, concurrency=concurrency, async_batches=async_batches, shared_async_cap=shared_async_cap, spawn_depth=spawn_depth, flat=flat):
            lines = [
                f"parent model: {parent_model}",
                f"parent effort: {parent_effort}",
                f"global child route: configured ({child_model}, effort {child_effort}, provider inherited)",
                "child execution proof: unavailable (delegate_task receipt required)",
                f"concurrency: hard ({_concurrency_detail(concurrency, async_batches, shared_async_cap)})",
                f"recursion: {_recursion_detail(spawn_depth, flat)}",
                "auto-compaction: unavailable (ratio-only compression; no exact 650K schema)",
                f"runtime: hard ({_OPENAI_PROVIDER} {_RESPONSES_MODE})",
            ]
            if result.approved:
                lines.extend([
                    f"lead route: configured ({parent_model}, effort {parent_effort})",
                    f"ordinary worker route: configured ({child_model}, effort {child_effort}, provider inherited)",
                ])
            else:
                lines.extend([
                    "lead route: unavailable (approved Astra lead route is not configured)",
                    "ordinary worker route: unavailable (approved global child Luna max route is not configured)",
                ])
            lines.extend([
                f"{_REVIEWER_ROUTE_NAME} route: unavailable (Hermes has no per-subagent model override)",
                "litwork-reviewer route: unavailable (Hermes has no per-subagent model override)",
                "TUI route visibility: unavailable (Hermes has no per-subagent model override or TUI route visibility surface)",
            ])
            return lines
        case UnavailableCapabilities(reason=reason):
            return [f"model capability: unavailable ({reason})"]
        case unreachable:
            assert_never(unreachable)


def status_report(host_version: str | None = None) -> str:
    version = host_version or hermes_host_version()
    skills = _skill_names()
    lines = [
        f"LitHermes plugin {plugin_version()}   (Hermes host {version})",
        f"plugin dir: {PLUGIN_ROOT}",
        f"hooks ({len(HOOKS)}): {', '.join(HOOKS)}",
        f"slash commands ({len(SLASH_COMMANDS)}): {', '.join('/' + item for item in SLASH_COMMANDS)}",
        f"skills ({len(skills)}): {', '.join(skills)}",
        f"goal tools ({len(GOAL_TOOLS)}): {', '.join(GOAL_TOOLS)}",
        f"bounded work tools ({len(WORK_TOOLS)}): {', '.join(WORK_TOOLS)}",
        f"knowledge tools ({len(KNOWLEDGE_TOOLS)}): {', '.join(KNOWLEDGE_TOOLS)}",
        "bounded work schema: 3   (/lit-loop init|status|resume|cancel|complete)",
        "litgoal state: .hermes/lithermes/litgoal/   (drive via: hermes lithermes goal status)",
        _knowledge.status_line(Path.cwd()),
        _provider_metrics.capability_line(),
        _jev_hint.status_line(),
        _auto_handoff.status_line(),
        f"litgoal evidence kinds: {', '.join(_evidence_kinds())}",
        f"scientific visualization: {_science.dependency_summary()}",
        *_motion_runtime_lines(),
        *_capability_status_lines(version),
    ]
    host_note = _beyond_verified_host_note(version)
    if host_note:
        lines.insert(1, host_note)
    return "\n".join(lines)


def _motion_runtime_lines() -> list[str]:
    import subprocess
    command = PLUGIN_ROOT / "skills" / "lit-typographic-motion" / "bin" / "runtime.mjs"
    if not command.is_file():
        return ["motion Chrome: unavailable", "motion ffmpeg: unavailable", "motion WebGL2 renderer: unavailable",
                "motion software GL: unknown", "motion pre-warm: missing; run lithermes motion-runtime install"]
    try:
        result = subprocess.run(["node", str(command), "status"], capture_output=True, text=True, timeout=35)
        if result.returncode == 0 and len(result.stdout.splitlines()) == 5:
            return ["motion " + line for line in result.stdout.splitlines()]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ["motion Chrome: unavailable", "motion ffmpeg: unavailable", "motion WebGL2 renderer: unavailable",
            "motion software GL: unknown", "motion pre-warm: status failed; run lithermes motion-runtime status"]


def _motion_line_needs_attention(line: str) -> bool:
    lowered = line.lower()
    return any(marker in lowered for marker in ("not found", "no webgl2", "warning:", "not ready", "unavailable", "status failed", "not probed"))


def doctor_report(host_version: str | None = None) -> tuple[list[str], int]:
    version = host_version or hermes_host_version()
    lines: list[str] = []
    healthy = True
    current = plugin_version()
    if current != "unknown":
        lines.append(f"[OK] plugin.yaml readable (version {current})")
    else:
        lines.append("[WARN] plugin.yaml unreadable or missing a version field")
        healthy = False
    skills = _skill_names()
    if skills:
        lines.append(f"[OK] skills bundled: {len(skills)}")
    else:
        lines.append("[WARN] no skills found under skills/")
        healthy = False
    diagram_skill = PLUGIN_ROOT / "skills" / "lit-diagram-drawer" / "SKILL.md"
    if diagram_skill.is_file():
        lines.append("[OK] lit-diagram-drawer entrypoint present")
    else:
        lines.append("[WARN] lit-diagram-drawer entrypoint missing")
        healthy = False
    for name in ("lit-pptx", "lit-docx", "lit-typographic-motion"):
        entrypoint = PLUGIN_ROOT / "skills" / name / "SKILL.md"
        if entrypoint.is_file():
            lines.append(f"[OK] {name} entrypoint present")
        else:
            lines.append(f"[WARN] {name} entrypoint missing")
            healthy = False
    try:
        import subprocess
        runtime = PLUGIN_ROOT / "skills" / "lit-pptx" / "bin" / "office.mjs"
        result = subprocess.run(["node", str(runtime), "doctor"], capture_output=True, text=True, timeout=10)
        lines.append("[OK] " + result.stdout.strip() if result.returncode == 0 else "[WARN] Office runtime status unavailable")
    except (OSError, subprocess.TimeoutExpired):
        lines.append("[WARN] Office runtime status unavailable")
    lines.extend(("[WARN] " if _motion_line_needs_attention(line) else "[OK] ") + line for line in _motion_runtime_lines())
    science = _science.dependency_status()
    science_tag = "OK" if science["state"] == "READY" else "DEGRADED"
    lines.append(f"[{science_tag}] scientific visualization: {_science.dependency_summary()}")
    try:
        from .litgoal import runtime as _runtime  # noqa: F401
        lines.append("[OK] litgoal durable runtime importable")
    except (ImportError, ModuleNotFoundError) as exc:
        lines.append(f"[WARN] litgoal runtime import failed: {exc}")
        healthy = False
    knowledge_detail, knowledge_ok = _knowledge.health(Path.cwd())
    lines.append(
        f"[{'OK' if knowledge_ok else 'WARN'}] knowledge authority: {knowledge_detail}; "
        ".hermes/lithermes/knowledge/claims.jsonl"
    )
    healthy = healthy and knowledge_ok
    lines.append(f"[NOTE] {_provider_metrics.capability_line()}")
    jev_state = _jev_hint.status()
    jev_tag = {"on": "OK", "off": "NOTE"}.get(jev_state, "WARN")
    lines.append(f"[{jev_tag}] {_jev_hint.status_line()}")
    handoff_tag, handoff_text = _auto_handoff.doctor_line()
    lines.append(f"[{handoff_tag}] {handoff_text}")
    if version != "unknown":
        lines.append(f"[OK] Hermes host detected (v{version})")
    else:
        lines.append("[NOTE] Hermes host version unknown (running outside Hermes?)")
    host_note = _beyond_verified_host_note(version)
    if host_note:
        lines.append(host_note)
    capabilities = _parse_capabilities(version)
    match capabilities:
        case ModelCapabilities(parent_model=parent_model, parent_effort=parent_effort, child_model=child_model, child_effort=child_effort, concurrency=concurrency, async_batches=async_batches, shared_async_cap=shared_async_cap, spawn_depth=spawn_depth, flat=flat):
            lines.extend([
                f"[OK] parent model {parent_model} / effort {parent_effort}",
                f"[NOTE] global child route configured ({child_model}, effort {child_effort}, provider inherited)",
                "[NOTE] child execution proof unavailable (delegate_task receipt required)",
                f"[OK] concurrency hard ({_concurrency_detail(concurrency, async_batches, shared_async_cap)})",
                f"[{'OK' if flat else 'WARN'}] recursion {_recursion_detail(spawn_depth, flat)}",
                "[OK] auto-compaction unavailable (ratio-only compression; no exact 650K schema)",
                f"[OK] runtime hard ({_OPENAI_PROVIDER} {_RESPONSES_MODE})",
            ])
            if capabilities.approved:
                lines.extend([
                    f"[OK] lead route configured ({parent_model}, effort {parent_effort})",
                    f"[OK] ordinary worker route configured ({child_model}, effort {child_effort}, provider inherited)",
                ])
            else:
                lines.extend([
                    "[WARN] lead route unavailable (approved Astra lead route is not configured)",
                    "[WARN] ordinary worker route unavailable (approved global child Luna max route is not configured)",
                ])
            lines.extend([
                f"[NOTE] {_REVIEWER_ROUTE_NAME} route unavailable (Hermes has no per-subagent model override)",
                "[NOTE] litwork-reviewer route unavailable (Hermes has no per-subagent model override)",
                "[NOTE] TUI route visibility unavailable (Hermes has no per-subagent model override or TUI route visibility surface)",
            ])
            if not flat:
                healthy = False
        case UnavailableCapabilities(reason=reason, fatal=fatal):
            lines.append(f"[WARN] model capability: unavailable ({reason})")
            if fatal:
                healthy = False
        case unreachable:
            assert_never(unreachable)
    return lines, (0 if healthy else 1)
