"""Read-only dashboard route: the newest litgoal in a workspace, as JSON.

Hermes mounts this module's ``router`` under ``/api/plugins/lithermes/`` once the
plugin is enabled. The single route, ``GET /goal?cwd=<workspace>``, reports the
goal, its criteria, the evidence on the current attempt, the quality-gate
verdict and a six-stage timeline (plan, runs, review, gate, handoff, resume) for
the Desktop pane. It never writes: it only reads the litgoal state files that the
plugin's own tools already keep under ``<cwd>/.hermes``. When the session left a
``gate.json`` beside its goal, the gate, runs and blockers shown are that file's,
labelled ``"source": "session"``: this process cannot re-verify a run another
process signed, so it reports what the session reported and says so.

Boundaries
- ``cwd`` must resolve (symlinks followed) to a path inside the user's home.
- A state file that resolves outside the workspace is ignored.
- Every free-text field is redacted and length-capped before it leaves.
- Missing, empty or unreadable state returns ``{"goal": null, ...}``, never an error.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types
from pathlib import Path
from typing import Any

try:  # FastAPI is the gateway's; plain imports of the plugin must not need it.
    from fastapi import APIRouter, HTTPException
except ImportError:  # pragma: no cover - exercised only without FastAPI installed
    APIRouter = None  # type: ignore[assignment]
    HTTPException = None  # type: ignore[assignment]

_PLUGIN_DIR = Path(__file__).resolve().parent.parent
_VIEW_PACKAGE = "_lithermes_dashboard_litgoal"
_MAX_SESSIONS = 500
_MAX_CRITERIA = 100
_MAX_EVIDENCE = 200
_MAX_REASONS = 20


class CwdRefused(ValueError):
    """The requested workspace is not an absolute path inside the user's home."""


def _home_root() -> Path:
    return Path.home()


def _load_redactor():
    spec = importlib.util.spec_from_file_location(
        "_lithermes_dashboard_redaction", _PLUGIN_DIR / "redaction.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module.redact_text


def _load_by_path(name: str, filename: str):
    """Load one stdlib-only plugin module by file path; the package is absent in the gateway."""
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _PLUGIN_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def _load_litgoal():
    """Import litgoal's model, store and runtime without executing the plugin.

    Hermes loads this file by path, so the plugin package is not importable from
    here. A stub package pointing at the sibling ``litgoal`` folder gives its
    relative imports a home and skips ``litgoal/__init__`` (tools, cli and hook
    pull in the whole plugin, which a read-only route has no use for).
    """
    if _VIEW_PACKAGE not in sys.modules:
        stub = types.ModuleType(_VIEW_PACKAGE)
        stub.__path__ = [str(_PLUGIN_DIR / "litgoal")]  # type: ignore[attr-defined]
        sys.modules[_VIEW_PACKAGE] = stub
    store = importlib.import_module(_VIEW_PACKAGE + ".store")
    runtime = importlib.import_module(_VIEW_PACKAGE + ".runtime")
    return store, runtime


def _resolve_workspace(cwd: str) -> Path:
    raw = str(cwd or "").strip()
    try:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            raise CwdRefused("cwd must be an absolute path")
        resolved = candidate.resolve()
        home = _home_root().resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        raise CwdRefused("cwd could not be resolved") from exc
    if resolved != home and home not in resolved.parents:
        raise CwdRefused("cwd must be inside the home directory")
    return resolved


def _empty(error: str = "") -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "goal": None,
        "criteria": [],
        "evidence": [],
        "gate": {"open": False, "reasons": []},
        "stages": [],
    }
    if error:
        snapshot["error"] = error
    return snapshot


def _newest_state(store, workspace: Path) -> str | None:
    """Session id (``""`` for the legacy path) whose goals.json is newest."""
    best: tuple[float, str] | None = None
    candidates = ["", *store.list_sessions(workspace)[:_MAX_SESSIONS]]
    for session_id in candidates:
        try:
            path = store.goals_path(workspace, session_id)
            if not path.is_file() or workspace not in path.resolve().parents:
                continue
            stamp = path.stat().st_mtime
        except (OSError, ValueError):
            continue
        if best is None or stamp > best[0]:
            best = (stamp, session_id)
    return best[1] if best else None


def _stage_inputs(store, runtime, workspace: Path, session_id: str, goal, state, clean) -> dict[str, Any]:
    """Gate, runs, blockers and handoff time: the session's ``gate.json`` first, today's live reading otherwise."""
    cards = _load_by_path("_lithermes_dashboard_handoff_card", "handoff_card.py")
    report = cards.read_gate_report(store.state_dir(workspace, session_id) / "gate.json", workspace)
    if report:
        gate: dict[str, Any] = {
            "open": report["open"],
            "reasons": [clean(reason, 300) for reason in report["reasons"][:_MAX_REASONS]],
            "source": "session",
            "evaluated_at": clean(report["evaluated_at"], 40),
        }
        runs = report["runs"]
        blockers = [{"text": clean(b["text"], 300), "resolved": b["resolved"]} for b in report["blockers"]]
    else:
        live = runtime.quality_gate(workspace, session_id=session_id)
        gate = {
            "open": bool(live.get("passed")),
            "reasons": [clean(reason, 300) for reason in live.get("reasons", [])[:_MAX_REASONS]],
        }
        observed = importlib.import_module(_VIEW_PACKAGE + ".runs").recent_runs(workspace, session_id, limit=3)
        runs = [
            {"id": clean(r.get("id"), 40), "exit": r.get("exit_code"), "stale": False} for r in observed
        ]
        blockers = [{"text": clean(b.detail, 300), "resolved": b.resolved} for b in goal.review_blockers]
    card = cards.read_card(workspace, session_id)
    stages = _load_by_path("_lithermes_dashboard_goal_stages", "goal_stages.py").build_stages(
        criteria=len(goal.criteria),
        runs=runs,
        blockers=blockers,
        gate_open=gate["open"],
        gate_reasons=gate["reasons"],
        handoff_time=cards.saved_time(card.get("written_at")) if card else "",
        adopted_from=clean(state.adopted_from, 96),
    )
    stale_runs = {"run:" + str(run.get("id")) for run in runs if run.get("stale")}
    return {"gate": gate, "stages": stages, "stale_runs": stale_runs}


def goal_snapshot(cwd: str) -> dict[str, Any]:
    """Build the JSON payload for the newest goal in ``cwd``; raise CwdRefused if unsafe."""
    if not str(cwd or "").strip():
        return _empty()
    workspace = _resolve_workspace(cwd)
    redact = _load_redactor()

    def clean(value: Any, limit: int) -> str:
        return redact(str(value or "")).strip()[:limit]

    try:
        store, runtime = _load_litgoal()
        session_id = _newest_state(store, workspace)
        if session_id is None:
            return _empty()
        goal = runtime.get_active(workspace, session_id)
        if goal is None:
            return _empty()
        shown = _stage_inputs(
            store, runtime, workspace, session_id, goal, store.load_or_create(workspace, session_id), clean
        )
    except (OSError, ValueError, ImportError):
        return _empty("litgoal state could not be read")

    criteria: list[dict[str, str]] = []
    evidence: list[dict[str, Any]] = []
    for criterion in goal.criteria[:_MAX_CRITERIA]:
        criteria.append(
            {
                "id": clean(criterion.id, 40),
                "text": clean(criterion.scenario, 400),
                "status": clean(criterion.status, 40),
            }
        )
        attempt = int(criterion.attempt or 1)
        for item in criterion.evidence:
            if int(item.attempt or 1) != attempt or len(evidence) >= _MAX_EVIDENCE:
                continue
            row: dict[str, Any] = {
                "criterion": clean(criterion.id, 40),
                "kind": clean(item.kind, 40),
                "ref": clean(item.ref, 300),
            }
            verified = getattr(item, "verified", None)
            if isinstance(verified, bool):
                row["verified"] = verified
            if item.ref in shown["stale_runs"]:
                row["stale"] = True
            evidence.append(row)
    return {
        "goal": {
            "id": clean(goal.id, 40),
            "title": clean(goal.title or goal.objective, 200),
            "objective": clean(goal.objective, 400),
            "status": clean(goal.status, 40),
        },
        "criteria": criteria,
        "evidence": evidence,
        "gate": shown["gate"],
        "stages": shown["stages"],
    }


def get_goal(cwd: str = "") -> dict[str, Any]:
    """Route handler: a refused cwd becomes HTTP 400."""
    try:
        return goal_snapshot(cwd)
    except CwdRefused as exc:
        if HTTPException is None:  # pragma: no cover - FastAPI absent
            raise
        raise HTTPException(status_code=400, detail=str(exc)) from exc


router = APIRouter() if APIRouter is not None else None
if router is not None:
    router.get("/goal")(get_goal)
