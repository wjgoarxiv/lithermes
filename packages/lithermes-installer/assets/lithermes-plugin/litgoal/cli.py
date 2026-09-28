"""`hermes lithermes goal ...` CLI surface for the litgoal durable runtime.

Registered via ctx.register_cli_command("goal", help, setup_fn, handler_fn).
setup_fn receives an argparse subparser; handler_fn(args) dispatches.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import model, runtime, store
from .tools import NATIVE_GOAL_CAPABILITY


def _ws(args) -> Path:
    val = getattr(args, "workspace", None)
    return Path(val).expanduser().resolve() if val else Path.cwd()


def _session(args) -> str:
    return str(getattr(args, "session_id", "") or "")


def _force(args) -> bool:
    return bool(getattr(args, "force", False))


def setup(parser) -> None:
    parser.add_argument("--workspace", help="workspace root (default: cwd)")
    parser.add_argument(
        "--session-id",
        dest="session_id",
        default="",
        help="scope state to .hermes/lithermes/litgoal/sessions/<id>/ so new work "
             "opens new state instead of writing into a finished aggregate",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="allow mutating a COMPLETED goal, overwriting finished evidence. "
             "Prefer --session-id <new-id> for new work.",
    )
    sub = parser.add_subparsers(dest="goal_cmd")

    p_set = sub.add_parser("set", help="create the active goal")
    p_set.add_argument("--objective", required=True)
    p_set.add_argument("--title", default="")
    p_set.add_argument("--criterion", action="append", default=[],
                       help="scenario|qa_channel|test_ref (repeatable)")

    sub.add_parser("status", help="show the active goal + quality gate")
    sub.add_parser("show", help="dump raw goals.json")

    p_crit = sub.add_parser("criterion", help="add a success criterion")
    p_crit.add_argument("--scenario", required=True)
    p_crit.add_argument("--qa-channel", default="")
    p_crit.add_argument("--test-ref", default="")

    p_ev = sub.add_parser("evidence", help="attach evidence to a criterion")
    p_ev.add_argument("criterion_id")
    p_ev.add_argument("--kind", required=True, choices=["red", "green", "scenario", "cleanup", "note"])
    p_ev.add_argument("--ref", required=True)
    p_ev.add_argument("--detail", default="")

    p_st = sub.add_parser("criterion-status", help="set a criterion status")
    p_st.add_argument("criterion_id")
    p_st.add_argument("status", choices=list(model.CRITERION_STATUSES))

    p_steer = sub.add_parser("steer", help="record a steering directive")
    p_steer.add_argument("directive")
    p_steer.add_argument("--kind", default="redirect", choices=list(model.STEERING_KINDS),
                         help="add_criterion is structural; every other kind is annotation-only")
    p_steer.add_argument("--evidence", required=True,
                         help="REQUIRED: what you observed that forced the change")
    p_steer.add_argument("--rationale", required=True,
                         help="REQUIRED: why that observation changes the plan")

    p_gs = sub.add_parser("goal-status", help="set the active goal status (not completion)")
    p_gs.add_argument("status", choices=[s for s in model.GOAL_STATUSES if s != "complete"])

    sub.add_parser("sessions", help="list session-scoped litgoal states")

    p_cp = sub.add_parser("checkpoint", help="record a checkpoint")
    p_cp.add_argument("summary")
    p_cp.add_argument("--active-criterion", default="")

    p_bl = sub.add_parser("blocker", help="add a review blocker")
    p_bl.add_argument("detail")
    p_rb = sub.add_parser("resolve-blocker", help="resolve a review blocker")
    p_rb.add_argument("blocker_id")

    sub.add_parser("complete", help="attempt to complete the goal (gated)")


def handle(args) -> int:
    ws = _ws(args)
    sid = _session(args)
    force = _force(args)
    cmd = getattr(args, "goal_cmd", None)
    if cmd == "set":
        criteria = []
        for raw in args.criterion:
            parts = (raw.split("|") + ["", "", ""])[:3]
            criteria.append({"scenario": parts[0], "qa_channel": parts[1], "test_ref": parts[2]})
        runtime.create_goal(ws, args.objective, title=args.title, criteria=criteria, session_id=sid)
        return _print_status(ws, sid)
    if cmd == "sessions":
        sessions = store.list_sessions(ws)
        print("\n".join(sessions) if sessions else "no session-scoped litgoal state")
        return 0
    if cmd in (None, "status"):
        return _print_status(ws, sid)
    if cmd == "show":
        path = store.goals_path(ws, sid)
        print(path.read_text(encoding="utf-8") if path.exists() else "{}")
        return 0
    if cmd == "criterion":
        crit = runtime.add_criterion(
            ws, args.scenario, qa_channel=args.qa_channel, test_ref=args.test_ref,
            session_id=sid, force=force,
        )
        print(f"added {crit.id}")
        return _print_status(ws, sid)
    if cmd == "evidence":
        runtime.add_evidence(
            ws, args.criterion_id, args.kind, args.ref, args.detail, session_id=sid, force=force
        )
        return _print_status(ws, sid)
    if cmd == "criterion-status":
        attempt = runtime.set_criterion_status(
            ws, args.criterion_id, args.status, session_id=sid, force=force
        )
        print(f"{args.criterion_id} attempt {attempt}")
        return _print_status(ws, sid)
    if cmd == "steer":
        try:
            runtime.record_steering(
                ws, args.directive, kind=args.kind, evidence=args.evidence,
                rationale=args.rationale, session_id=sid, force=force,
            )
        except ValueError as exc:
            runtime.record_steering_rejection(
                ws, args.directive, str(exc), kind=args.kind, session_id=sid
            )
            print(f"steering rejected: {exc}")
            return 1
        return _print_status(ws, sid)
    if cmd == "goal-status":
        runtime.set_goal_status(ws, args.status, session_id=sid, force=force)
        return _print_status(ws, sid)
    if cmd == "checkpoint":
        runtime.record_checkpoint(
            ws, args.summary, active_criterion=args.active_criterion, session_id=sid, force=force
        )
        return _print_status(ws, sid)
    if cmd == "blocker":
        b = runtime.add_review_blocker(ws, args.detail, session_id=sid, force=force)
        print(f"blocker {b.id}")
        return _print_status(ws, sid)
    if cmd == "resolve-blocker":
        runtime.resolve_review_blocker(ws, args.blocker_id, session_id=sid, force=force)
        return _print_status(ws, sid)
    if cmd == "complete":
        result = runtime.complete_goal(ws, session_id=sid, force=force)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("completed") else 1
    return _print_status(ws, sid)


def _print_status(ws: Path, session_id: str = "") -> int:
    capability = NATIVE_GOAL_CAPABILITY
    print(
        "native goal capability: "
        f"mode={capability['mode']} state={capability['state']}"
    )
    print(f"native goal reason: {capability['reason']}")
    if session_id:
        print(f"session: {session_id}")
    goal = runtime.get_active(ws, session_id)
    if goal is None:
        print("no active litgoal")
        return 0
    gate = runtime.quality_gate(ws, session_id=session_id)
    print(f"goal {goal.id} [{goal.status}]: {goal.objective}")
    for c in goal.criteria:
        kinds = ",".join(sorted({e.kind for e in c.evidence})) or "-"
        print(
            f"  {c.id} [{c.status}] {c.scenario}  channel={c.qa_channel or '-'} "
            f"attempt={c.attempt} evidence={kinds}"
        )
    for b in goal.review_blockers:
        flag = "resolved" if b.resolved else "OPEN"
        print(f"  blocker {b.id} [{flag}] {b.detail}")
    print(f"quality gate: {'PASS' if gate['passed'] else 'CLOSED'}")
    for r in gate["reasons"]:
        print(f"  - {r}")
    return 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="hermes lithermes goal")
    setup(parser)
    args = parser.parse_args(argv)
    return handle(args)
