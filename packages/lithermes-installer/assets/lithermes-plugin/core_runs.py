from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from .core_contract import (
        _skill_body_block,
        contract_route_block,
        reader_facing_contract_block,
    )
    from .core_plans import build_goal_instruction, extract_success_criteria
    from .core_runtime import _clamp_task, append_jsonl, lithermes_dir, plan_dir, record_event, run_id, slugify, utc_now
    from .redaction import redact_obj
except (ImportError, ModuleNotFoundError):
    from core_contract import (
        _skill_body_block,
        contract_route_block,
        reader_facing_contract_block,
    )
    from core_plans import build_goal_instruction, extract_success_criteria
    from core_runtime import _clamp_task, append_jsonl, lithermes_dir, plan_dir, record_event, run_id, slugify, utc_now
    from redaction import redact_obj

def build_notepad(task: str, criteria: list[dict[str, str]]) -> str:
    crit_lines = [
        f"- {c['id']} [{_clamp_task(c.get('qa_channel') or '?')}] {_clamp_task(c.get('scenario') or '')} (test: {_clamp_task(c.get('test_ref') or '?')})"
        for c in criteria
    ] or ["- (define success criteria before claiming progress)"]
    return "\n".join(
        [
            f"# Litwork Notepad — {task}",
            f"Started: {utc_now().isoformat()}",
            "",
            "## Plan (exhaustively detailed)",
            "<every atomic step, in order>",
            "",
            "## Success criteria + QA scenarios",
            *crit_lines,
            "",
            "## Now",
            "<the single step in progress>",
            "",
            "## Todo",
            "<every remaining step, ordered>",
            "",
            "## Findings",
            "<non-obvious facts with file:line refs>",
            "",
            "## Learnings",
            "<patterns / pitfalls to remember next turn>",
            "",
        ]
    )


# The run ledger (.hermes/lithermes/runs/<id>/ledger.jsonl) is its OWN file with
# its OWN vocabulary, keyed on `event`. It is not the litgoal ledger
# (.hermes/lithermes/litgoal/**/ledger.jsonl), which is keyed on `kind` — see
# litgoal.store.LEDGER_SCHEMA. Every entry written here is stamped with the id
# below so a reader never has to guess which vocabulary a line belongs to.
RUN_LEDGER_SCHEMA = "lithermes.run.ledger/v1"
RUN_LEDGER_EVENTS = (
    "run_started",
    "criterion_started",
    "test_red_captured",
    "test_green_captured",
    "scenario_executed",
    "cleanup_receipt",
    "criterion_complete",
    "reviewer_verdict",
)


def record_criterion_event(run_dir: Path, criterion_id: str, event: str, **fields: Any) -> None:
    """Append a TDD/QA criterion event to the run ledger.

    `event` must be one of RUN_LEDGER_EVENTS. That tuple used to live only in
    this docstring, where nothing enforced it and nothing read it; it is now the
    single enforced definition of this file's vocabulary.

    NOTE: no production code path calls this yet — the loop records its evidence
    through the litgoal runtime instead. It is a real, tested API kept for the
    run-ledger surface, not a dead docstring.
    """
    if event not in RUN_LEDGER_EVENTS:
        raise ValueError(
            "invalid run ledger event '{0}' (valid: {1})".format(event, RUN_LEDGER_EVENTS)
        )
    append_jsonl(
        run_dir / "ledger.jsonl",
        {
            "schema": RUN_LEDGER_SCHEMA,
            "event": event,
            "at": utc_now().isoformat(),
            "criterion_id": criterion_id,
            **fields,
        },
    )


def find_plan(name: str, workspace: Path) -> Path | None:
    plans = plan_dir(workspace)
    if not plans.exists():
        return None

    raw = name.strip()
    if not raw:
        candidates = sorted(plans.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        return candidates[0] if candidates else None

    direct = Path(raw).expanduser()
    if direct.exists():
        return direct.resolve()

    slug = slugify(raw, fallback=raw)
    candidates = [
        plans / raw,
        plans / f"{raw}.md",
        plans / slug,
        plans / f"{slug}.md",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return None


def write_run_state(
    workspace: Path,
    *,
    task: str,
    command: str,
    plan: Path | None = None,
    completion_promise: str = "",
    strategy: str = "continue",
) -> Path:
    task = _clamp_task(task)
    completion_promise = _clamp_task(completion_promise)
    rid = run_id("lithermes")
    run_dir = lithermes_dir(workspace) / "runs" / rid
    evidence_dir = run_dir / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    criteria: list[dict[str, str]] = []
    if plan and plan.exists():
        try:
            criteria = redact_obj(extract_success_criteria(plan.read_text(encoding="utf-8")))
        except OSError:
            criteria = []

    notepad = run_dir / "notepad.md"
    notepad.write_text(build_notepad(task, criteria), encoding="utf-8")

    state = {
        "run_id": rid,
        "created_at": utc_now().isoformat(),
        "workspace": str(workspace),
        "command": command,
        "task": task,
        "completion_promise": completion_promise,
        "strategy": strategy,
        "plan": str(plan) if plan else "",
        "evidence_dir": str(evidence_dir),
        "notepad_path": str(notepad),
        "criteria": criteria,
        "active_criterion": criteria[0]["id"] if criteria else "",
    }
    (run_dir / "state.json").write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    append_jsonl(
        run_dir / "ledger.jsonl",
        {"schema": RUN_LEDGER_SCHEMA, "event": "run_started", **state},
    )
    record_event("run_started", workspace=str(workspace), command=command, run_id=rid)
    return run_dir


def load_run_state(run_dir: Path) -> dict[str, Any]:
    return json.loads((run_dir / "state.json").read_text(encoding="utf-8"))


def _same_plan_path(recorded: str, plan: Path) -> bool:
    if not recorded:
        return False
    try:
        return Path(recorded).expanduser().resolve() == plan.resolve()
    except OSError:
        return str(Path(recorded).expanduser()) == str(plan)


def latest_start_work_run(workspace: Path, plan: Path) -> Path | None:
    runs_dir = lithermes_dir(workspace) / "runs"
    if not runs_dir.exists():
        return None

    matches: list[tuple[str, float, Path]] = []
    for state_file in runs_dir.glob("*/state.json"):
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if state.get("command") != "start-work":
            continue
        if not _same_plan_path(str(state.get("plan") or ""), plan):
            continue
        try:
            modified = state_file.stat().st_mtime
        except OSError:
            modified = 0.0
        matches.append((str(state.get("created_at") or ""), modified, state_file.parent))

    if not matches:
        return None
    matches.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return matches[0][2]


def build_run_agent_message(
    state: dict[str, Any],
    *,
    include_reader_contract: bool = True,
    return_mode: str | None = None,
    return_mode_authority: str | None = None,
) -> str:
    plan_line = f"\nPlan: {state['plan']}" if state.get("plan") else ""
    promise = state.get("completion_promise") or "Complete the requested task with evidence."
    plan_path = Path(state["plan"]) if state.get("plan") else None
    workspace = Path(state["workspace"]) if state.get("workspace") else None
    reader_contract = reader_facing_contract_block(
        return_mode,
        authority=return_mode_authority,
        boundary="parent_synthesis",
    )
    return "\n".join(
        [
            state["task"],
            "",
            build_goal_instruction(state["task"], plan=plan_path, workspace=workspace),
            "",
            "<lithermes-run-context>",
            contract_route_block(str(state.get("command") or "run"), surface="run-context"),
            f"run_id: {state['run_id']}",
            f"workspace: {state['workspace']}",
            f"evidence_dir: {state['evidence_dir']}",
            f"ledger: {Path(state['evidence_dir']).parent / 'ledger.jsonl'}",
            f"strategy: {state['strategy']}",
            f"completion_promise: {promise}",
            f"task: {state['task']}{plan_line}",
            "",
            "Execute this LitHermes request now. Inspect the workspace as needed,",
            "keep useful evidence under evidence_dir, append meaningful progress to the ledger,",
            "and answer the user with the result instead of stopping after run creation.",
            "Loop each criterion RED->GREEN->manual-QA->cleanup-receipt; when the work is risky, spans 3+",
            "files, or the user demanded rigour, run the reviewer gate (delegate_task a strict reviewer)",
            "and loop until UNCONDITIONAL approval before declaring done.",
            _skill_body_block("start-work" if state.get("command") == "start-work" else "litwork"),
            *([reader_contract] if include_reader_contract else []),
            "</lithermes-run-context>",
        ]
    )


def build_dispatch_result(
    run_dir: Path,
    *,
    display: str,
    return_mode: str | None = None,
    return_mode_authority: str | None = None,
) -> dict[str, str]:
    state = load_run_state(run_dir)
    return {
        "display": display,
        "agent_message": build_run_agent_message(
            state,
            return_mode=return_mode,
            return_mode_authority=return_mode_authority,
        ),
        "run_dir": str(run_dir),
    }
