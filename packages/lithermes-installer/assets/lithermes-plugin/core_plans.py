from __future__ import annotations

import re
from pathlib import Path

try:
    from .core_contract import _skill_body_block, contract_route_block
    from .core_runtime import _clamp_task, lithermes_dir, plan_dir, record_event, slugify, utc_now
except (ImportError, ModuleNotFoundError):
    from core_contract import _skill_body_block, contract_route_block
    from core_runtime import _clamp_task, lithermes_dir, plan_dir, record_event, slugify, utc_now

def build_goal_instruction(
    objective: str,
    *,
    plan: Path | None = None,
    workspace: Path | None = None,
) -> str:
    objective = _clamp_task(objective) or "Complete the requested LitHermes task with evidence."
    plan_line = f"Plan: {plan}" if plan else "Plan: none"
    workspace_line = f"Workspace: {workspace}" if workspace else "Workspace: current"
    return "\n".join(
        [
            "<lithermes-goal-instruction>",
            contract_route_block("goal-instruction", surface="goal-bootstrap"),
            "Hermes goal handoff.",
            workspace_line,
            plan_line,
            "",
            "Native /goal capability:",
            "- Hermes has NO model-facing goal tools. Do not invoke get_goal, create_goal, or",
            "  update_goal — they do not exist in Hermes and the request will fail.",
            "- Native /goal is user-managed and its state is unobserved by LitHermes.",
            f"- The user may manage it directly if desired: /goal {objective}",
            "- LitHermes performs no automatic native-goal update, clear, or resume.",
            "",
            "Authoritative durable litgoal layer (criteria + evidence + gate) — drive via the lithermes goal tools:",
            "- goal_set to declare the objective and 3+ upfront success criteria (happy/edge/regression);",
            "- goal_add_criterion / goal_evidence(kind=red|green|scenario|cleanup) / goal_criterion_status as you work;",
            "- goal_steer to redirect, goal_checkpoint to snapshot; inspect via `hermes lithermes goal status`;",
            "- goal_complete is REFUSED until every criterion has green + scenario evidence and no blocker is open.",
            "",
            "Isolation: for risky/parallel edits use a git worktree or Hermes-native workspace isolation if available.",
            "",
            "Delegation model (you conduct, workers play):",
            "- Use delegate_task(tasks:[{goal, context}]) to fan out INDEPENDENT work in parallel;",
            "  top-level dispatch returns immediately; per-child re-entry receipts arrive as separate messages.",
            "  The parent tracks and merges them, decides batch completion after every lane is accounted for, and has no combined wait. Serialize only on a NAMED",
            "  dependency (a child consumes another's output or edits the same file).",
            "- Do NOT trust a child's self-report: re-read its diff, re-run its tests, and run LSP",
            "  diagnostics yourself before accepting 'done'. Forward learnings to the next worker.",
            "- Each child message is self-contained: goal + exact files in scope + constraints + the",
            "  verify commands + the ONE manual-QA channel + the exact evidence artifact path.",
            "- Read-only codebase-search child: 'where is X / which files do Y' — fan out parallel",
            "  rg/LSP/AST/glob and return absolute paths plus the answer to the actual need.",
            "- Read-only external-research child: an unfamiliar dependency/API — consult docs/gh/web",
            "  and cite SHA-pinned permalinks to primary sources; never mutate the worktree.",
            "</lithermes-goal-instruction>",
        ]
    )


def create_plan(brief: str, workspace: Path | None = None) -> Path:
    brief = _clamp_task(brief)
    if not brief:
        raise ValueError('usage: /lit-plan "what to build"')

    root = (workspace or Path.cwd()).resolve()
    out_dir = plan_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{slugify(brief)}.md"
    if path.exists():
        path = out_dir / f"{slugify(brief)}-{utc_now().strftime('%H%M%S')}.md"

    now = utc_now().isoformat()
    content = "\n".join(
        [
            f"# {brief}",
            "",
            f"Created: {now}",
            "Source: lithermes",
            "",
            "## TL;DR",
            "> Summary:      <1-2 sentences>",
            "> Deliverables: <bullet list>",
            "> Effort:       <Quick | Short | Medium | Large | XL>",
            "> Risk:         <Low | Medium | High> - <one-line driver>",
            "",
            "## Success Criteria",
            "Declare only the falsifiable criteria needed to prove the bounded objective.",
            "Keep the runtime-parsed `C0NN | channel: | test: | scenario:` shape, but do not",
            "invent happy/edge/regression rows merely to reach a fixed count. Use `n/a` only",
            "with a written reason when an automated test or real-surface scenario cannot apply.",
            "",
            "- [ ] C001 | channel: <cli|tmux|http|browser|computer|n/a> | test: <command/assertion|n/a + reason> | scenario: <observable outcome|n/a + reason>",
            "",
            "## Scope",
            "### Must have",
            "- [ ] <deliverable>",
            "### Must NOT have (guardrails / anti-slop)",
            "- [ ] <explicit exclusion>",
            "",
            "## Verification strategy",
            "- Test decision: <TDD | tests-after> + framework",
            "- QA policy: every todo has exact verification; add a channel scenario only for a real user-facing surface or meaningful failure branch",
            "- Evidence: `.hermes/lithermes/runs/<run>/evidence/`",
            "",
            "## Execution strategy",
            "### Parallel execution waves (only when dependencies justify them)",
            "- Wave 1 (no deps): ...",
            "- Wave 2 (after Wave 1): ...",
            "",
            "### Dependency matrix",
            "| Task | Depends on | Blocks | Parallel with |",
            "|------|------------|--------|---------------|",
            "| 1    | none       | 2      | -             |",
            "",
            "## Todos",
            "> Each retained todo carries Action + Output + Verification. Add References, QA, and Commit only when they materially support execution.",
            "",
            "- [ ] 1. <task title>",
            "  - Action: <concrete mutation or decision steps>",
            "  - Output: <exact artifact, state change, or verdict>",
            "  - Must NOT do: <exclusions>",
            "  - References: `<file:line>` - <pattern/contract to follow>",
            "  - Verification: [ ] <exact command or assertion and binary expected result>",
            "  - QA scenario (if applicable): tool=<tmux|curl|...> steps=<...> expected=<binary pass/fail> evidence=<path>",
            "  - Commit (if approved/in scope): `<type>(<scope>): <imperative>`",
            "",
            "## Final verification gates (retain only applicable gates)",
            "- [ ] F1. Objective and scope audit — bounded objective met; non-goals untouched",
            "- [ ] F2. Required automated checks and exact assertions pass",
            "- [ ] F3. Applicable real-surface scenarios pass with evidence and cleanup receipts",
            "- [ ] F4. Package/payload/release checks pass when those surfaces are in scope",
            "",
            "## Commit strategy",
            "- Atomic Conventional Commits; each builds + tests green on its own.",
            f"- Final footer: `Plan: plans/{path.name}`",
            "",
            "## Verification Evidence",
            "- [ ] Record commands, outputs, transcripts, screenshots, and cleanup receipts that justify trust.",
            "",
            "## Final DoneClaim",
            "<One falsifiable sentence naming the objective, required artifacts, commands, verdicts, and cleanup receipts>",
            "",
        ]
    )
    path.write_text(content, encoding="utf-8")
    record_event("plan_created", workspace=str(root), plan=str(path), brief=brief)
    return path


_CRITERION_PATTERN = re.compile(r"^- \[[ xX]\]\s*(C\d+)\s*\|(.*)$")


def extract_success_criteria(markdown: str) -> list[dict[str, str]]:
    """Parse the plan's Success Criteria block.

    Lines look like:
      - [ ] C001 | channel: tmux | test: path::id | scenario: Happy path — ...
    """
    out: list[dict[str, str]] = []
    for line in markdown.splitlines():
        m = _CRITERION_PATTERN.match(line.strip())
        if not m:
            continue
        crit: dict[str, str] = {"id": m.group(1), "qa_channel": "", "test_ref": "", "scenario": ""}
        for field in m.group(2).split("|"):
            if ":" not in field:
                continue
            key, _, value = field.partition(":")
            key = key.strip().lower()
            value = _clamp_task(value)
            if key == "channel":
                crit["qa_channel"] = value
            elif key == "test":
                crit["test_ref"] = value
            elif key == "scenario":
                crit["scenario"] = value
        out.append(crit)
    return out


# ---------------------------------------------------------------------------
# Three mechanics the pinned source has and the reference implementation dropped.
# Each is a DELIBERATE IMPROVEMENT BEYOND THE REFERENCE, not a copy of it:
#   1. the mandatory draft scaffolder (the pinned source plan skill, "RUN THE SCRIPT")
#   2. the column-zero plan-row grammar + pre-handoff structural self-check
#   3. the high-accuracy review gate, restored from optional back to REQUIRED
# ---------------------------------------------------------------------------

def draft_dir(workspace: Path) -> Path:
    """Drafts live in the product state dir; `plans/` holds the reviewed artifact."""
    return lithermes_dir(workspace) / "drafts"


def draft_path(workspace: Path, slug: str) -> Path:
    return draft_dir(workspace) / "{0}.md".format(slug)


# A review modifier is a GATE TRIGGER, not a style cue. It counts in ANY turn —
# appended to a follow-up question, or arriving after the plan already exists.
_REVIEW_MODIFIERS = (
    re.compile(r"\b(?:ultra[\s-]*)?high[\s-]*accuracy\b", re.IGNORECASE),
    re.compile(r"\bdeep\s+review\b", re.IGNORECASE),
    re.compile(r"\bhigh[\s-]*precision\b", re.IGNORECASE),
    re.compile(r"\brigorous(?:ly)?\s+review\b", re.IGNORECASE),
    re.compile(r"고정밀"),
    re.compile(r"정밀\s*검토"),
    re.compile(r"엄밀\s*검토"),
)


def detect_review_modifier(text: str) -> bool:
    """True when the turn requests high-accuracy review.

    Answering the current question more carefully does NOT satisfy this. It sets
    `review_required: true`, and dual review becomes required before handoff.
    """
    value = str(text or "")
    return any(pattern.search(value) for pattern in _REVIEW_MODIFIERS)


def scaffold_plan(
    slug: str,
    workspace: Path | None = None,
    *,
    intent: str = "unclear",
    review_required: bool = False,
    draft_only: bool = True,
    reset: bool = False,
) -> dict[str, Any]:
    """Create the compaction-safe draft resume point. Resume-safe by construction.

    Mirrors the source contract: run this as soon as slug and intent are known,
    BEFORE recording draft state, and never hand-build the artifact. Re-running is
    a no-op for an artifact that already exists, so a resumed session cannot clobber
    its own draft; `reset=True` is the explicit structural reset.
    """
    # Validate the RAW argument: slugify() substitutes a fallback for empty input,
    # so slugifying first would silently scaffold a draft named "lithermes-plan"
    # for a caller that never supplied a slug.
    if not str(slug or "").strip():
        raise ValueError("scaffold_plan requires a non-empty slug")
    slug = slugify(str(slug))
    if intent not in ("clear", "unclear"):
        raise ValueError("intent must be 'clear' or 'unclear'")

    root = (workspace or Path.cwd()).resolve()
    target = draft_path(root, slug)
    created = False
    if target.exists() and not reset:
        result = {"draft": str(target), "created": False, "slug": slug}
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(_draft_template(slug, intent, review_required), encoding="utf-8")
        created = True
        result = {"draft": str(target), "created": True, "slug": slug}
    result["intent"] = intent
    result["review_required"] = bool(review_required)

    if not draft_only:
        plan = create_plan(slug.replace("-", " "), root)
        result["plan"] = str(plan)
    record_event(
        "plan_scaffolded",
        workspace=str(root),
        slug=slug,
        intent=intent,
        review_required=bool(review_required),
        draft_only=bool(draft_only),
        created=created,
    )
    return result


def _draft_template(slug: str, intent: str, review_required: bool) -> str:
    return "\n".join(
        [
            "# Draft: {0}".format(slug),
            "",
            "Created: {0}".format(utc_now().isoformat()),
            "Source: lithermes scaffold_plan",
            "",
            "intent: {0}".format(intent),
            "review_required: {0}".format("true" if review_required else "false"),
            "",
            "> This draft is the resume point. On a later turn READ these fields and",
            "> resume from them instead of re-routing from memory. Do not hand-build",
            "> this file; re-running the scaffolder is a safe no-op.",
            "",
            "## Decisions",
            "- <decision> - <why> - <what it forecloses>",
            "",
            "## Approval gate",
            "- [ ] Plan presented to the user",
            "- [ ] Explicit approval recorded",
            "",
            "## Review ledger",
            (
                "- REQUIRED: dual high-accuracy review before handoff (a review modifier was given)."
                if review_required
                else "- Not required unless a review modifier appears in any later turn."
            ),
            "",
        ]
    ) + "\n"


# Column-zero plan-row grammar. Prose headings, numbered paragraphs, and ordinary
# bullets are NOT task substitutes and must never be counted as tasks.
IMPLEMENTATION_ROW = re.compile(r"^- \[[ xX]\] (\d+)\. (\s*\S.*)$")
FINAL_VERIFIER_ROW = re.compile(r"^- \[[ xX]\] F(\d+)\. (\s*\S.*)$")
_TODOS_HEADING = "## Todos"
_FINAL_HEADING_PREFIX = "## Final verification"
# A row that looks like a task but breaks the grammar — indented, missing the dot,
# missing the title, or a lowercase f prefix.
_NEAR_MISS_ROW = re.compile(r"^\s*[-*]\s*\[[ xX]\]\s*[Ff]?\d")
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _outside_fence_lines(markdown: str):
    fence_char = ""
    fence_length = 0
    for number, raw in enumerate(str(markdown or "").splitlines(), 1):
        if fence_char:
            if re.match(
                r"^ {0,3}" + re.escape(fence_char) + "{" + str(fence_length) + r",}\s*$",
                raw,
            ):
                fence_char = ""
                fence_length = 0
            continue
        opening = _FENCE_OPEN.match(raw)
        if opening:
            marker = opening.group(1)
            fence_char = marker[0]
            fence_length = len(marker)
            continue
        yield number, raw


def unchecked_items(markdown: str) -> list[str]:
    """Return unchecked column-zero implementation rows from the Todos section."""
    items: list[str] = []
    section = ""
    for _, raw in _outside_fence_lines(markdown):
        if raw.startswith("## "):
            section = raw.strip()
            continue
        if section != _TODOS_HEADING or not raw.startswith("- [ ] "):
            continue
        match = IMPLEMENTATION_ROW.match(raw)
        if match:
            items.append(_clamp_task("{0}. {1}".format(match.group(1), match.group(2))))
    return items


def plan_structure_issues(markdown: str) -> list[str]:
    """Pre-handoff structural self-check. Empty list means the plan is well-formed.

    Checks that every implementation and final-verifier row is column-zero, matches
    its required grammar, and sits in its intended section.
    """
    issues: list[str] = []
    section = ""
    seen_impl: list[str] = []
    seen_final: list[str] = []
    for number, raw in _outside_fence_lines(markdown):
        if raw.startswith("## "):
            section = raw.strip()
            continue
        impl = IMPLEMENTATION_ROW.match(raw)
        final = FINAL_VERIFIER_ROW.match(raw)
        if impl:
            seen_impl.append(impl.group(1))
            if section != _TODOS_HEADING:
                issues.append(
                    "line {0}: implementation row is outside the required "
                    "'## Todos' section".format(number)
                )
            continue
        if final:
            seen_final.append(final.group(1))
            if not section.startswith(_FINAL_HEADING_PREFIX):
                issues.append(
                    "line {0}: final-verifier row is outside its required section; expected a "
                    "'## Final verification ...' section".format(number)
                )
            continue
        if _NEAR_MISS_ROW.match(raw) and not _CRITERION_PATTERN.match(raw.strip()):
            issues.append(
                "line {0}: task row is malformed (possible indentation, no dot, lowercase "
                "verifier prefix, or missing title); expected '- [ ] N. <title>' or "
                "'- [ ] F<number>. <title>' at column zero".format(number)
            )
    if not seen_impl:
        issues.append("no implementation rows found (expected '- [ ] N. <title>' under '## Todos')")
    if not seen_final:
        issues.append(
            "no final-verifier rows found (expected '- [ ] F<number>. <title>' under "
            "'## Final verification ...')"
        )
    for label, seen in (("implementation", seen_impl), ("final-verifier", seen_final)):
        duplicates = sorted({value for value in seen if seen.count(value) > 1})
        if duplicates:
            issues.append("duplicate {0} row numbers found".format(label))
    return issues


def assert_plan_structure(markdown: str) -> None:
    """Raise unless the plan satisfies the row grammar. Use before handoff."""
    issues = plan_structure_issues(markdown)
    if issues:
        raise ValueError(
            "plan structure self-check failed; repair the plan before handoff:\n- "
            + "\n- ".join(issues)
        )
