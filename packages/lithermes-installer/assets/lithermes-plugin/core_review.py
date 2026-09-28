from __future__ import annotations

import json
from pathlib import Path

try:
    from .core_contract import (
        _skill_body_block,
        conditional_uiux_skill_blocks,
        contract_route_block,
        reader_facing_contract_block,
    )
    from .core_reader_args import parse_reader_facing_command_args
    from .core_runtime import parse_args, record_delegate_batch_intent, workspace_from_option
except (ImportError, ModuleNotFoundError):
    from core_contract import (
        _skill_body_block,
        conditional_uiux_skill_blocks,
        contract_route_block,
        reader_facing_contract_block,
    )
    from core_reader_args import parse_reader_facing_command_args
    from core_runtime import parse_args, record_delegate_batch_intent, workspace_from_option

def _run_git(workspace: Path, args: list[str]) -> str:
    import subprocess

    try:
        out = subprocess.run(
            ["git", *args],
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=20,
        )
        return out.stdout if out.returncode == 0 else ""
    except Exception:
        return ""


def _run_git_bytes(workspace: Path, args: list[str]) -> bytes:
    import subprocess

    try:
        out = subprocess.run(
            ["git", *args],
            cwd=str(workspace),
            capture_output=True,
            timeout=20,
        )
        return out.stdout if out.returncode == 0 else b""
    except Exception:
        return b""


def _decode_git_path(value: bytes) -> str:
    return value.decode("utf-8", errors="surrogateescape")


def _changed_paths(workspace: Path, base: str) -> list[str]:
    paths = {
        _decode_git_path(value)
        for value in _run_git_bytes(workspace, ["diff", "--name-only", "-z", base]).split(b"\0")
        if value
    }
    records = _run_git_bytes(
        workspace,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ).split(b"\0")
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if len(record) < 4 or record[2:3] != b" ":
            continue
        status = record[:2]
        paths.add(_decode_git_path(record[3:]))
        if b"R" in status or b"C" in status:
            index += 1
    return sorted(paths)


def detect_run_command(workspace: Path) -> str:
    pkg = workspace / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            scripts = data.get("scripts", {}) if isinstance(data, dict) else {}
            for key in ("dev", "start", "serve"):
                if key in scripts:
                    return f"npm run {key}"
        except Exception:
            pass
    if (workspace / "Makefile").exists():
        return "make (see Makefile targets)"
    if (workspace / "docker-compose.yml").exists() or (workspace / "compose.yaml").exists():
        return "docker compose up"
    return "(detect manually — no dev/start script found)"


REVIEW_LANES = [
    ("goal", "Goal & constraint verification — does the diff achieve the stated goal within every constraint; flag missed requirements, over-engineering, edge cases. Verdict PASS/FAIL + confidence."),
    ("qa", "QA by execution — brainstorm 15+ scenarios (happy/boundary/error/regression), then actually run the app/surface and capture evidence; tests alone are insufficient. Verdict PASS/FAIL with per-scenario results."),
    ("code-quality", "Code quality — staff-engineer review across correctness, patterns, naming, error handling, types, perf, tests, API design. Severity CRITICAL/MAJOR/MINOR/NITPICK. Verdict PASS/FAIL."),
    ("security", "Security/safety (supplementary) — input validation, authz, secrets, data exposure, deps/CVEs, path/file ops, destructive actions. Severity CRITICAL/HIGH/MEDIUM/LOW. Verdict PASS/FAIL."),
    ("context", "Context/docs/package readiness — git history, issues/PRs, docs, changelog/release checklist, package dry-run/payload guard, cleanup receipts, TODO/warnings the diff may have missed. Verdict PASS/FAIL + discovered context."),
]


def command_review_work(raw_args: str) -> dict[str, str]:
    reader_args = parse_reader_facing_command_args(raw_args)
    args = parse_args(reader_args.command_args)
    workspace = workspace_from_option(args.options.get("worktree"))
    base = str(args.options.get("base") or "HEAD~1")
    changed_paths = _changed_paths(workspace, base)
    diff = _run_git(workspace, ["diff", base])
    if len(diff) > 60000:
        diff = diff[:60000] + "\n... [diff truncated at 60k chars — lanes should read full files as needed]"
    run_cmd = detect_run_command(workspace)
    files_block = (
        "\n".join(f"- {json.dumps(file, ensure_ascii=False)}" for file in changed_paths)
        or "(no changed files detected vs " + base + ")"
    )
    batch_event = record_delegate_batch_intent(
        workspace=workspace,
        mode="review-work",
        lanes=[key for key, _ in REVIEW_LANES],
        context={
            "base": base,
            "changed_file_count": len(changed_paths),
            "run_command": run_cmd,
        },
    )

    lane_lines = []
    for key, brief in REVIEW_LANES:
        lane_lines.append(f"- lane[{key}]: {brief}")
    conditional_uiux = conditional_uiux_skill_blocks(
        "\n".join(f"{file}/" for file in changed_paths) + "\n" + diff
    )
    child_return_contract = reader_facing_contract_block(
        "audit",
        authority="explicit_parent_to_child_return_mode",
        boundary="subagent_to_parent_return",
    )
    parent_synthesis_contract = reader_facing_contract_block(
        reader_args.requested_mode,
        authority=reader_args.authority,
        boundary="parent_synthesis"
    )

    agent_lines = [
        "Run the LitHermes 5-lane review orchestrator on the current changes.",
        "",
        "<lithermes-review-work>",
        contract_route_block("review-work", surface="slash-command"),
        f"workspace: {workspace}",
        f"base: {base}",
        f"run command (for QA lane): {run_cmd}",
        f"delegate batch evidence: {batch_event.get('artifact_dir', '')}",
        "",
        "Changed files:",
        files_block,
        "",
        "Dispatch ALL FIVE lanes IN ONE delegate_task call — pass a `tasks` array of 5 entries,",
        "each {goal: <lane brief>, context: <diff + changed files>}; top-level dispatch returns",
        "immediately; per-child re-entry receipts then arrive as separate messages:",
        *lane_lines,
        "",
        "Each lane returns: verdict (PASS|FAIL), confidence, and findings with file:line.",
        "Do not synthesize in the dispatching turn. The parent tracks and merges each receipt; there is no combined wait.",
        "Decide batch completion only after all five lanes are returned, failed, timed out, or unavailable; then dedupe findings. Gate is ALL-OR-NOTHING:",
        "ANY lane FAIL => REVIEW FAILED (list blocking issues, prioritised by severity);",
        "all five PASS => REVIEW PASSED (non-blocking suggestions only).",
        "Load the lithermes:review-work skill for the full lane prompts and output contract.",
        _skill_body_block("review-work"),
        conditional_uiux,
        "",
        "Diff under review:",
        "```diff",
        diff.strip() or "(empty diff)",
        "```",
        "The audit child-return packet stays detailed for review; it cannot elevate the parent response:",
        child_return_contract,
        "Project the completed review through the parent synthesis contract:",
        parent_synthesis_contract,
        "</lithermes-review-work>",
    ]
    return {
        "display": (
            f"LitHermes review-work: 5 lanes over {base} "
            f"({len(changed_paths)} changed files). "
            "Dispatching parallel review now."
        ),
        "agent_message": "\n".join(agent_lines),
    }
