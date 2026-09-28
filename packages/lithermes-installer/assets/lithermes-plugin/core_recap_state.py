from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

try:
    from .core_runtime import _clamp_task, lithermes_dir
except (ImportError, ModuleNotFoundError):
    from core_runtime import _clamp_task, lithermes_dir

# ---------------------------------------------------------------------------
# /lit-recap — read-only recap of durable LitHermes state. Mirrors the
# korean-prose-cleanup contract: {display, agent_message} only, no run state,
# no goal binding, and every ledger/goal byte enters the message escaped.
# ---------------------------------------------------------------------------

RECAP_TITLE_KO = "# 작업 리캡 (lit-recap)"
RECAP_TITLE_EN = "# Work Recap (lit-recap)"
RECAP_HEADERS_KO = (
    "## ✅ 완료된 작업",
    "## 🔄 진행 중",
    "## ⛔ 블로커",
    "## 📁 증거 경로",
    "## ➡️ 다음 단계",
)
RECAP_HEADERS_EN = (
    "## ✅ Completed",
    "## 🔄 In Progress",
    "## ⛔ Blockers",
    "## 📁 Evidence Paths",
    "## ➡️ Next Steps",
)
RECAP_BRIEF_HEADER_KO = "## ⚡ 요약"
RECAP_BRIEF_HEADER_EN = "## ⚡ Summary"
RECAP_BRIEF_WORDS = frozenset({"짧게"})
RECAP_ENGLISH_WORDS = frozenset({"english", "영어"})
_RECAP_OPTION_TOKENS = frozenset({"--brief", "--en", "--english"}) | RECAP_BRIEF_WORDS | RECAP_ENGLISH_WORDS
_RECAP_UNSAFE_VALUE_CHARS = frozenset("\"'\\")
_RECAP_MAX_ITEMS = 8
_RECAP_MAX_LEDGER_LINES = 200
# Standalone-only recognizer: `recap`/`litrecap`/`lit-recap`/`리캡` (optionally after a bare
# `lit`) at message start, followed by nothing but known recap option tokens.
_LIT_RECAP_LEAD_RE = re.compile(
    r"^\s*(?:lit\s+)?(?:lit-recap|litrecap|recap|리캡)(?![\w/-])(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
_RECAP_TECH_KINDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("[test]", ("test_", ".test.", "/test/", "scenario")),
    ("[Python]", (".py", "python", "pytest", "unittest")),
    ("[npm]", ("package.json", "npm", ".js", ".ts", "node")),
    ("[docs]", (".md", "readme", "docs", "changelog")),
)


@dataclass(frozen=True)
class RecapDigest:
    objective: str
    completed: tuple[str, ...]
    in_progress: tuple[str, ...]
    blockers: tuple[str, ...]
    evidence: tuple[str, ...]
    next_steps: tuple[str, ...]


def _recap_tech_kind(text: str) -> str:
    """Deterministically tag a digest item from its refs/paths."""
    lowered = str(text or "").lower()
    for tag, needles in _RECAP_TECH_KINDS:
        if any(needle in lowered for needle in needles):
            return tag
    return "[work]"


def _recap_item(text: str) -> str:
    """One digest line: redacted, whitespace-flattened, length-bounded."""
    return _clamp_task(re.sub(r"\s+", " ", str(text or "")))


def _recap_run_completions(ledger: Path) -> list[str]:
    """criterion_complete events from a run ledger (bounded pure read)."""
    try:
        lines = ledger.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[str] = []
    for line in lines[-_RECAP_MAX_LEDGER_LINES:]:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("event") == "criterion_complete":
            tag = _recap_tech_kind(" ".join(str(v) for v in event.values()))
            out.append(_recap_item(f"{event.get('criterion_id') or '?'} {tag} criterion_complete"))
    return out


def read_recap_digest(workspace: Path) -> RecapDigest:
    """Pure read of the durable litgoal state + the latest run. Never writes:
    litgoal reads go through store.load_or_create (in-memory default when the
    file is absent) and run discovery is glob+read only."""
    try:
        from .litgoal import runtime as litgoal_runtime
        from .litgoal import store as litgoal_store
    except (ImportError, ModuleNotFoundError):  # standalone test import via PYTHONPATH
        from litgoal import runtime as litgoal_runtime  # type: ignore
        from litgoal import store as litgoal_store  # type: ignore

    objective = ""
    completed: list[str] = []
    in_progress: list[str] = []
    blockers: list[str] = []
    evidence: list[str] = []
    next_steps: list[str] = []

    try:
        goal = litgoal_runtime.get_active(workspace)
    except (ValueError, OSError):  # malformed/unreadable durable state stays inert
        goal = None
    if goal is not None:
        objective = _recap_item(goal.objective)
        for crit in goal.criteria:
            tag = _recap_tech_kind(" ".join([crit.test_ref, *(e.ref for e in crit.evidence)]))
            item = _recap_item(f"{crit.id} {tag} {crit.scenario}")
            match crit.status:
                case "pass":
                    completed.append(item)
                case "in_progress":
                    in_progress.append(item)
                case "blocked":
                    blockers.append(item)
                case _:  # pending / fail / unknown-from-disk stay open work
                    next_steps.append(item)
            evidence.extend(_recap_item(e.ref) for e in crit.evidence if e.ref)
        for blocker in goal.review_blockers:
            if not blocker.resolved:
                blockers.append(_recap_item(f"{blocker.id} {blocker.detail}"))
        evidence.append(str(litgoal_store.evidence_dir(workspace)))
        try:
            gate = litgoal_runtime.quality_gate(workspace)
        except (ValueError, OSError):
            gate = {"reasons": []}
        next_steps.extend(_recap_item(reason) for reason in gate.get("reasons", []))

    runs_root = lithermes_dir(workspace) / "runs"
    state_files = (
        sorted(runs_root.glob("*/state.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if runs_root.is_dir()
        else []
    )
    if state_files:
        latest = state_files[0]
        try:
            state = json.loads(latest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            state = None
        if isinstance(state, dict):
            rid = state.get("run_id") or latest.parent.name
            in_progress.append(_recap_item(f"{rid} [{state.get('command') or '?'}] {state.get('task') or ''}"))
            if state.get("evidence_dir"):
                evidence.append(_recap_item(str(state.get("evidence_dir"))))
            completed.extend(_recap_run_completions(latest.parent / "ledger.jsonl"))

    def cap(items: list[str]) -> tuple[str, ...]:
        return tuple(items[:_RECAP_MAX_ITEMS])

    return RecapDigest(
        objective=objective,
        completed=cap(completed),
        in_progress=cap(in_progress),
        blockers=cap(blockers),
        evidence=cap(evidence),
        next_steps=cap(next_steps),
    )
