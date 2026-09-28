from __future__ import annotations

try:
    from .core_commands import _join_positional
    from .core_contract import (
        _skill_body_block, conditional_uiux_skill_blocks, contract_route_block,
        reader_facing_contract_block,
    )
    from .core_plans import plan_structure_issues, unchecked_items
    from .core_reader_args import parse_reader_facing_command_args
    from .core_routing import bind_goal_marker
    from .core_runs import build_run_agent_message, find_plan, latest_start_work_run, load_run_state, write_run_state
    from .core_runtime import _clamp_task, lithermes_dir, parse_args, plan_dir, slugify, workspace_from_option
except (ImportError, ModuleNotFoundError):
    from core_commands import _join_positional
    from core_contract import (
        _skill_body_block, conditional_uiux_skill_blocks, contract_route_block,
        reader_facing_contract_block,
    )
    from core_plans import plan_structure_issues, unchecked_items
    from core_reader_args import parse_reader_facing_command_args
    from core_routing import bind_goal_marker
    from core_runs import build_run_agent_message, find_plan, latest_start_work_run, load_run_state, write_run_state
    from core_runtime import _clamp_task, lithermes_dir, parse_args, plan_dir, slugify, workspace_from_option

def command_litgoal(raw_args: str) -> dict[str, str]:
    reader_args = parse_reader_facing_command_args(raw_args)
    args = parse_args(reader_args.command_args)
    workspace = workspace_from_option(args.options.get("worktree"))
    objective = _clamp_task(_join_positional(args.positional))
    intro = (
        "Opened the LitHermes litgoal durable runtime."
        if objective
        else "LitHermes litgoal runtime."
    )
    agent_lines = [
        objective or "Inspect and drive the active LitHermes litgoal.",
        "",
        "<lithermes-litgoal-command>",
        contract_route_block("litgoal", surface="slash-command"),
        f"workspace: {workspace}",
        "Durable goal state lives under .hermes/lithermes/litgoal/ (goals.json + ledger.jsonl + evidence/).",
        "Drive it through the model-facing goal tools, not prose:",
        "- goal_status to read the active objective, criteria, evidence, and quality gate;",
        "- goal_set to declare the objective and upfront success criteria (happy/edge/regression);",
        "- goal_add_criterion / goal_evidence (red|green|scenario|cleanup) / goal_criterion_status as you work;",
        "- goal_steer to redirect, goal_checkpoint to snapshot for resume;",
        "- goal_complete only succeeds once the quality gate passes (every criterion has green + scenario",
        "  evidence and no unresolved review blocker). Inspect anytime with: hermes lithermes goal status.",
        "Load the lithermes:litgoal skill for the full discipline.",
        _skill_body_block("litgoal"),
        "</lithermes-litgoal-command>",
        reader_facing_contract_block(
            reader_args.requested_mode,
            authority=reader_args.authority,
            compact=True,
        ),
    ]
    # Keep the legacy objective marker as a bounded route envelope. pre_llm_call
    # recognizes it without observing or mutating user-managed native /goal state.
    # Inspect-only /litgoal (no objective) emits no marker.
    marker = bind_goal_marker(objective)
    if marker:
        agent_lines.append(marker)
    return {
        "display": f"{intro}\nState dir: {lithermes_dir(workspace) / 'litgoal'}",
        "agent_message": "\n".join(agent_lines),
    }


def command_deep_interview(raw_args: str) -> dict[str, str]:
    reader_args = parse_reader_facing_command_args(raw_args)
    args = parse_args(reader_args.command_args)
    workspace = workspace_from_option(args.options.get("worktree"))
    # `--quick|--standard|--deep` are bare profile flags, but parse_args greedily
    # binds the next bare word as a flag value — so `--quick build a widget` would
    # consume "build". Recover any such word back into the idea text.
    profile = "standard"
    for flag in ("deep", "quick", "standard"):
        value = args.options.get(flag)
        if value:
            profile = flag
            if isinstance(value, str):
                args.positional.insert(0, value)
            break
    idea = _join_positional(args.positional)
    agent_lines = [
        idea or "Run a deep-interview clarification pass before planning.",
        "",
        "<lithermes-deep-interview-command>",
        contract_route_block("deep-interview", surface="slash-command"),
        f"workspace: {workspace}",
        f"profile: {profile}",
        "Run the LitHermes deep-interview clarity gate — load the lithermes:deep-interview skill",
        "and follow it. This is a requirements mode, NOT implementation:",
        "- one Socratic question per round, intent before detail; re-score ambiguity each round;",
        "- gather repo facts with read-only search / delegate_task before asking the user;",
        "- keep Non-goals + Decision Boundaries explicit and run one pressure pass before crystallizing;",
        "- persist state under .hermes/lithermes/deep-interview/<slug>-state.json so it can resume.",
        "When the spec is ready, do NOT build here — hand off: /lit-plan to plan it, or /lit-loop to",
        "execute it, carrying the non-goals, decision boundaries, and acceptance criteria forward.",
        "</lithermes-deep-interview-command>",
        reader_facing_contract_block(
            reader_args.requested_mode,
            authority=reader_args.authority,
            compact=True,
        ),
    ]
    return {
        "display": (
            f"Opened the LitHermes deep-interview clarity gate ({profile} profile).\n"
            "Requirements mode — clarifies, then hands off to /lit-plan or /lit-loop."
        ),
        "agent_message": "\n".join(agent_lines),
    }


def command_start_work(raw_args: str) -> str | dict[str, str]:
    reader_args = parse_reader_facing_command_args(raw_args)
    args = parse_args(reader_args.command_args)
    workspace = workspace_from_option(args.options.get("worktree"))
    plan_name = _join_positional(args.positional)
    dry_run = bool(args.options.get("dry-run"))
    resume = bool(args.options.get("resume"))
    plan = find_plan(plan_name, workspace)

    if plan is None:
        target = plan_name or "(latest plan)"
        msg = (
            f"BLOCKED: /start-work is execution-only for approved plans. No plan named "
            f"'{target}' was found in {plan_dir(workspace)}. Run /lit-plan first, approve "
            "the plan, then invoke /start-work <plan-name>."
        )
        if dry_run:
            return msg
        raise ValueError(msg)

    text = plan.read_text(encoding="utf-8")
    if plan_structure_issues(text):
        msg = f"BLOCKED: /start-work plan structure is invalid for {plan}."
        if dry_run:
            return msg
        raise ValueError(msg)
    conditional_uiux = conditional_uiux_skill_blocks(text)
    open_items = unchecked_items(text)
    if dry_run:
        preview = "\n".join(f"- {item}" for item in open_items[:8]) or "- no unchecked items found"
        if resume:
            run_dir = latest_start_work_run(workspace, plan)
            if not run_dir:
                return f"BLOCKED: /start-work --resume found no prior run for {plan}."
            return f"LitHermes resume dry-run for {plan}: would resume {run_dir}\n{preview}"
        return f"LitHermes dry-run for {plan}:\n{preview}"

    if resume:
        run_dir = latest_start_work_run(workspace, plan)
        if not run_dir:
            raise ValueError(f"BLOCKED: /start-work --resume found no prior run for {plan}.")
        first_items = "\n".join(f"- {item}" for item in open_items[:5]) or "- no unchecked items found"
        display = (
            f"Resumed LitHermes work run from approved plan: {run_dir}\n"
            f"Plan: {plan}\n"
            f"Open items:\n{first_items}"
        )
        return {
            "display": display,
            "agent_message": "\n\n".join(
                part
                for part in (
                    build_run_agent_message(
                        load_run_state(run_dir),
                        return_mode=reader_args.requested_mode,
                        return_mode_authority=reader_args.authority,
                    ),
                    conditional_uiux,
                )
                if part
            ),
        }

    run_dir = write_run_state(
        workspace,
        task=f"Start work from {plan.name}",
        command="start-work",
        plan=plan,
    )
    first_items = "\n".join(f"- {item}" for item in open_items[:5]) or "- no unchecked items found"
    display = (
        f"Started LitHermes work run from approved plan: {run_dir}\n"
        f"Plan: {plan}\n"
        f"Open items:\n{first_items}"
    )
    return {
        "display": display,
        "agent_message": "\n\n".join(
            part
            for part in (
                build_run_agent_message(
                    load_run_state(run_dir),
                    return_mode=reader_args.requested_mode,
                    return_mode_authority=reader_args.authority,
                ),
                conditional_uiux,
            )
            if part
        ),
    }
