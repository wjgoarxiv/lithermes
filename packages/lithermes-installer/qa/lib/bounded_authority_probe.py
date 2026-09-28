"""Real-surface probe for the bounded-authority lifecycle.

Runs against an installed plugin tree, not the repository working copy: argv[1] is the
plugin directory produced by `lithermes install --hermes-home <isolated>`. The probe
drives the shipped `core` module directly, which is the same entry point the Hermes
tool loop calls, and reports one JSON object per case on stdout.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = os.path.abspath(sys.argv[1])
if PLUGIN_ROOT not in sys.path:
    sys.path.insert(0, PLUGIN_ROOT)

import core  # noqa: E402

CASES = []


def record(name, expected, observed, detail):
    CASES.append(
        {
            "name": name,
            "expected": expected,
            "observed": observed,
            "detail": detail,
        }
    )


def write_plan(workspace):
    plans = workspace / "plans"
    plans.mkdir(parents=True, exist_ok=True)
    path = plans / "approved.md"
    path.write_text(
        "\n".join(
            [
                "# Approved bounded work",
                "",
                "## Success Criteria",
                "- [x] C001 | channel: cli | test: real-surface-probe | scenario: lifecycle",
                "",
                "## Todos",
                "- [ ] T001 | implement the approved slice",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


def case_canonical_init(workspace, plan):
    created = core.init_bounded_work(
        workspace, plan, grants=[{"action": "write", "root": str(workspace)}]
    )
    state = created["state"]
    leaked = created["activation_token"] in json.dumps(state)
    ok = (
        state["schema"] == 3
        and state["revision"] == 1
        and state["status"] == "active"
        and state["worktree"] == str(workspace)
        and state["plan"] == str(plan.resolve())
        and not leaked
    )
    record(
        "schema-3 init is canonical and never persists the activation token",
        "PASS",
        "PASS" if ok else "FAIL",
        "schema={0} revision={1} status={2} worktree_matches={3} token_in_state={4}".format(
            state["schema"],
            state["revision"],
            state["status"],
            state["worktree"] == str(workspace),
            leaked,
        ),
    )
    return created


def case_plan_escape(workspace, plan):
    outside = Path(tempfile.mkdtemp(prefix="lithermes-qa-outside.")) / "outside-plan.md"
    outside.parent.mkdir(parents=True, exist_ok=True)
    outside.write_text("# outside the worktree\n", encoding="utf-8")
    try:
        core.init_bounded_work(
            workspace, outside, grants=[{"action": "write", "root": str(workspace)}]
        )
        record(
            "plan root cannot escape the worktree",
            "REJECTED",
            "ACCEPTED",
            "init_bounded_work accepted a plan outside the worktree at {0}".format(outside),
        )
    except ValueError as error:
        message = str(error)
        record(
            "plan root cannot escape the worktree",
            "REJECTED",
            "REJECTED" if "plan" in message else "REJECTED_WRONG_REASON",
            "ValueError: {0}".format(message),
        )
    finally:
        try:
            outside.unlink()
            outside.parent.rmdir()
        except OSError:
            pass


def case_authority_escape(workspace, plan):
    try:
        core.init_bounded_work(
            workspace, plan, grants=[{"action": "write", "root": str(workspace.parent)}]
        )
        record(
            "authority root cannot escape the worktree",
            "REJECTED",
            "ACCEPTED",
            "init_bounded_work accepted an authority root above the worktree",
        )
    except ValueError as error:
        message = str(error)
        record(
            "authority root cannot escape the worktree",
            "REJECTED",
            "REJECTED" if "authority" in message else "REJECTED_WRONG_REASON",
            "ValueError: {0}".format(message),
        )


def case_session_mismatch(workspace, plan):
    created = core.init_bounded_work(
        workspace, plan, grants=[{"action": "write", "root": str(workspace)}]
    )
    work_id = created["state"]["work_id"]
    core.bind_bounded_work(workspace, work_id, created["activation_token"], session_id="owner")
    before = core.load_bounded_work(workspace, work_id)["revision"]
    denied = core.record_bounded_progress(
        workspace,
        work_id,
        expected_revision=before,
        replay_id="foreign-session",
        session_id="intruder",
        progress=[{"id": "T001", "status": "pass"}],
    )
    after = core.load_bounded_work(workspace, work_id)["revision"]
    ok = denied["outcome"] == "silent" and after == before
    record(
        "session mismatch fails closed without mutation",
        "SILENT_NO_MUTATION",
        "SILENT_NO_MUTATION" if ok else "MUTATED",
        "outcome={0} revision_before={1} revision_after={2}".format(
            denied["outcome"], before, after
        ),
    )


def main():
    root = Path(tempfile.mkdtemp(prefix="lithermes-qa-bounded.")).resolve()
    try:
        for index, case in enumerate(
            (case_canonical_init, case_plan_escape, case_authority_escape, case_session_mismatch)
        ):
            workspace = root / "work-{0}".format(index)
            workspace.mkdir(parents=True, exist_ok=True)
            plan = write_plan(workspace)
            case(workspace, plan)
    finally:
        import shutil

        shutil.rmtree(root, ignore_errors=True)
    sys.stdout.write(json.dumps({"cases": CASES, "scratch_removed": not root.exists()}) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
