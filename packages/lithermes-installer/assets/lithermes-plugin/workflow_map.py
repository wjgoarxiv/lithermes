"""One plain-text workflow map row for LIT replies, read from durable state.

The reply transform is the plugin's only user-visible channel, and Hermes
cannot colour it, so the row carries stage emoji and a block bar instead:

    🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·

The newest durable record in the workspace anchors the row: a plan file under
plans/, a run state, a bounded-work state, or the litgoal goal (the session's
own store first, then the legacy one). A stage with no durable signal is left
out, and no signal at all draws no row. The row never carries a command, a
path, a plan name, or any argument. Reads are bounded and never write.
"""
from __future__ import annotations

import json
from pathlib import Path

try:
    from .core_plans import FINAL_VERIFIER_ROW, IMPLEMENTATION_ROW, _outside_fence_lines
    from .litgoal import store as _litgoal_store
except (ImportError, ModuleNotFoundError):
    from core_plans import FINAL_VERIFIER_ROW, IMPLEMENTATION_ROW, _outside_fence_lines
    from litgoal import store as _litgoal_store

MAX_PLAN_BYTES = 1_000_000
MAX_STATE_BYTES = 2_000_000
BAR_CELLS = 7
EMOJI = {"plan": "📝", "work": "🔨", "review": "🔍", "done": "🏁"}
# Only the plan → work → review chain draws the map; a prose, office, motion or
# research reply would show an unrelated workflow.
WORKFLOW_ROUTES = frozenset({
    "litwork", "lit-loop", "lit-plan", "start-work", "litgoal", "review-work",
    "deep-interview", "lit-team", "lit-recap",
})


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return -1.0


def _newest(paths) -> Path | None:
    return max(paths, key=_mtime, default=None)


def _json(path: Path | None) -> dict | None:
    try:
        if path is None or not path.is_file() or path.stat().st_size > MAX_STATE_BYTES:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _resolved(raw: object) -> str:
    try:
        return str(Path(str(raw)).expanduser().resolve()) if raw else ""
    except (OSError, ValueError):
        return ""


def _plan_counts(raw: object) -> tuple[int, int, int, int] | None:
    """(tasks done, tasks, checks done, checks) from a plan's column-zero rows."""
    try:
        path = Path(str(raw or "")).expanduser()
        if not raw or path.suffix.lower() != ".md" or not path.is_file() or path.stat().st_size > MAX_PLAN_BYTES:
            return None
        text = path.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return None
    counts = [0, 0, 0, 0]
    for _, line in _outside_fence_lines(text):
        offset = 0 if IMPLEMENTATION_ROW.match(line) else 2 if FINAL_VERIFIER_ROW.match(line) else None
        if offset is not None:
            counts[offset + 1] += 1
            counts[offset] += line[3] in "xX"
    return tuple(counts)


def _goal(workspace: Path, session_id: str):
    """(goals.json path, active goal) from the session's store, else the legacy one."""
    try:
        scopes = [session_id] if _litgoal_store.normalize_session_id(session_id) else []
    except ValueError:
        scopes = []
    for scope in [*scopes, ""]:
        path = _litgoal_store.goals_path(workspace, scope)
        if not path.is_file():
            continue
        try:
            goal = _litgoal_store.load_or_create(workspace, scope).active_goal()
        except (OSError, ValueError):
            return None
        return (path, goal) if goal is not None else None
    return None


def _bar(done: int, total: int) -> str:
    filled = min(BAR_CELLS, done * BAR_CELLS // total)
    return "▰" * filled + "▱" * (BAR_CELLS - filled)


def _stage(name: str, state: str, done: int = 0, total: int = 0) -> str:
    emoji = EMOJI[name]
    if state == "done":
        return f"{emoji} {name} ✓"
    if state == "pending":
        return f"{emoji} ·"
    counter = f" {_bar(done, total)} {done}/{total}" if total else ""
    return f"{emoji} {name.upper()}{counter}"


def _progress_stages(plan: tuple | None, work: tuple[int, int] | None, finished: bool) -> list[str]:
    """Stages after a plan exists: work from `work` or plan tasks, review from plan checks."""
    tasks = work if work is not None else (plan[:2] if plan else None)
    checks = plan[2:] if plan else None
    stages: list[str] = []
    work_done = finished
    if tasks and tasks[1]:
        work_done = finished or tasks[0] >= tasks[1]
        stages.append(_stage("work", "done" if work_done else "current", *tasks))
    review_done = work_done
    if checks and checks[1]:
        review_done = finished or (work_done and checks[0] >= checks[1])
        state = "done" if review_done else "current" if work_done else "pending"
        stages.append(_stage("review", state, *checks))
    stages.append(_stage("done", "done" if finished or (work_done and review_done) else "pending"))
    return stages


def _goal_stages(goal) -> list[str]:
    total = len(goal.criteria)
    passed = sum(1 for criterion in goal.criteria if criterion.status == "pass")
    complete = goal.status == "complete"
    blocked = goal.status == "review_blocked" or any(not b.resolved for b in goal.review_blockers)
    stages = []
    work_done = complete or (total > 0 and passed >= total)
    if total:
        stages.append(_stage("work", "done" if work_done else "current", passed, total))
    review = "done" if complete else "current" if blocked or work_done else "pending"
    stages.append(_stage("review", review))
    stages.append(_stage("done", "done" if complete else "pending"))
    return stages


def workflow_stages(workspace: Path, session_id: str = "") -> list[str] | None:
    hermes = Path(workspace) / ".hermes" / "lithermes"
    run_file = _newest((hermes / "runs").glob("*/state.json"))
    work_file = _newest((hermes / "work").glob("*/state.json"))
    # Checking off rows rewrites the plan a run executes; only a plan no run or
    # work state points at can mean the user is planning again.
    executing = {_resolved((_json(path) or {}).get("plan")) for path in (run_file, work_file) if path}
    plan_file = _newest(path for path in (Path(workspace) / "plans").glob("*.md")
                        if path.is_file() and _resolved(path) not in executing)
    goal = _goal(Path(workspace), str(session_id or ""))
    candidates = [(path, kind) for path, kind in ((plan_file, "plan"), (run_file, "run"), (work_file, "work")) if path]
    if goal:
        candidates.append((goal[0], "goal"))
    if not candidates:
        return None
    anchor, kind = max(candidates, key=lambda item: _mtime(item[0]))

    if kind == "plan":
        counts = _plan_counts(anchor)
        stages = [_stage("plan", "current")]
        if counts and counts[1]:
            stages.append(_stage("work", "pending"))
        if counts and counts[3]:
            stages.append(_stage("review", "pending"))
        return stages + [_stage("done", "pending")]
    if kind == "goal":
        run = _json(run_file) or {}
        has_plan = _plan_counts(run.get("plan")) is not None
        return ([_stage("plan", "done")] if has_plan else []) + _goal_stages(goal[1])
    state = _json(anchor)
    if state is None:
        return None
    counts = _plan_counts(state.get("plan"))
    if kind == "run":
        if counts is None or not (counts[1] or counts[3]):
            return None
        return [_stage("plan", "done"), *_progress_stages(counts, None, False)]
    status = state.get("status")
    items = state.get("progress") if isinstance(state.get("progress"), list) else []
    if status not in ("active", "paused", "completed"):
        return None
    work = (sum(1 for item in items if isinstance(item, dict) and item.get("status") == "pass"), len(items)) if items else None
    plan_tasks = (counts[0], counts[1], 0, 0) if counts else None
    return [_stage("plan", "done"), *_progress_stages(plan_tasks, work, status == "completed")]


def workflow_row(route: str, workspace: Path, session_id: str = "") -> str | None:
    """The map row for this LIT reply, or None when no stage has a durable signal."""
    if route not in WORKFLOW_ROUTES:
        return None
    try:
        stages = workflow_stages(workspace, session_id)
    except (OSError, ValueError):
        return None
    if not stages:
        return None
    return f"🔥 LIT · {route} — " + " › ".join(stages)
