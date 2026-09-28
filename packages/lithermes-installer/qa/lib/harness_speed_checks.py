"""Correctness and adversarial gates for the local LitHermes speed probe."""

from __future__ import annotations

from pathlib import Path

from harness_speed_support import EXACT_BANNER, HostAdapter, bounded_fixture, cwd, hook


def correctness_suite(plugin, adapter: HostAdapter, root: Path, rows) -> dict[str, object]:
    pre_llm = hook(adapter, "pre_llm_call")
    transform = hook(adapter, "transform_llm_output")
    session = "correctness-session"
    workspace = root / "correctness-workspace"
    workspace.mkdir()
    with cwd(workspace):
        hook(adapter, "on_session_start")(session_id=session)
        b0 = pre_llm(
            user_message=rows["B0"]["prompt"], session_id=session,
            platform="cli", is_first_turn=True,
        )
        b0_context = str(b0.get("context", "")) if isinstance(b0, dict) else ""
        transformed = transform(response_text=rows["B0"]["sentinel"], session_id=session)
        b0_output = transformed if isinstance(transformed, str) else rows["B0"]["sentinel"]
        s1 = pre_llm(
            user_message=rows["S1"]["prompt"], session_id=session,
            platform="cli", is_first_turn=False,
        )
        s1_context = str(s1.get("context", "")) if isinstance(s1, dict) else ""
        model_reply = f"{EXACT_BANNER}\n\n{rows['S1']['sentinel']}"
        transformed = transform(response_text=model_reply, session_id=session)
        s1_output = transformed if isinstance(transformed, str) else rows["S1"]["sentinel"]
        s2 = pre_llm(
            user_message=rows["S2"]["prompt"], session_id=session,
            platform="cli", is_first_turn=False,
        )
        s2_context = str(s2.get("context", "")) if isinstance(s2, dict) else ""
        transformed = transform(response_text=rows["S2"]["sentinel"], session_id=session)
        s2_output = transformed if isinstance(transformed, str) else rows["S2"]["sentinel"]
        hook(adapter, "on_session_finalize")(session_id=session)
    expected_s1 = plugin.core.acknowledge_reply("litwork", model_reply)
    return {
        "exact_banner": EXACT_BANNER,
        "registered_surface": all(
            name in adapter.hooks for name in (
                "on_session_start", "pre_llm_call",
                "transform_llm_output", "on_session_finalize",
            )
        ),
        "b0_no_route": plugin.core.LIT_CONTEXT not in b0_context,
        "b0_sentinel_exact": b0_output == rows["B0"]["sentinel"],
        "s1_route": plugin.core.LIT_CONTEXT in s1_context,
        "s1_banner_exact": s1_output == expected_s1,
        "s1_sentinel_exact": s1_output.startswith(model_reply),
        "s2_no_route": plugin.core.LIT_CONTEXT not in s2_context,
        "s2_sentinel_exact": s2_output == rows["S2"]["sentinel"],
        "bounded_activation": bounded_correctness(plugin, adapter, root),
    }


def bounded_correctness(plugin, adapter: HostAdapter, root: Path) -> bool:
    workspace = root / "bounded-correctness"
    workspace.mkdir()
    message = bounded_fixture(plugin, workspace)
    with cwd(workspace):
        result = hook(adapter, "pre_llm_call")(
            user_message=message, session_id="bounded-correctness-session",
            platform="cli", is_first_turn=False,
        )
        hook(adapter, "on_session_finalize")(session_id="bounded-correctness-session")
    context = str(result.get("context", "")) if isinstance(result, dict) else ""
    return '<lithermes-bounded-work schema="3">' in context


def adversarial_suite(plugin, adapter: HostAdapter, root: Path, rows) -> dict[str, bool]:
    pre_llm = hook(adapter, "pre_llm_call")
    malformed_workspace = root / "malformed-workspace"
    malformed_workspace.mkdir()
    malformed_message = (
        '<lithermes-work-activation schema="3">not-valid-base64'
        "</lithermes-work-activation>"
    )
    with cwd(malformed_workspace):
        malformed_result = pre_llm(
            user_message=malformed_message, session_id="malformed-session",
            platform="cli", is_first_turn=False,
        )
    malformed_ok = malformed_result is None and not (malformed_workspace / ".hermes").exists()

    stale_workspace = root / "stale-workspace"
    stale_workspace.mkdir()
    stale_message = bounded_fixture(plugin, stale_workspace)
    with cwd(stale_workspace):
        accepted = pre_llm(
            user_message=stale_message, session_id="stale-first-session",
            platform="cli", is_first_turn=False,
        )
        replay = pre_llm(
            user_message=stale_message, session_id="stale-replay-session",
            platform="cli", is_first_turn=False,
        )
        hook(adapter, "on_session_finalize")(session_id="stale-first-session")
    accepted_context = str(accepted.get("context", "")) if isinstance(accepted, dict) else ""
    stale_ok = '<lithermes-bounded-work schema="3">' in accepted_context and replay is None

    dirty_workspace = root / "dirty-workspace"
    dirty_workspace.mkdir()
    marker = dirty_workspace / "untracked-marker.txt"
    marker.write_text("preserve-this-byte\n", encoding="utf-8")
    with cwd(dirty_workspace):
        dirty_result = pre_llm(
            user_message=rows["S1"]["prompt"], session_id="dirty-session",
            platform="cli", is_first_turn=False,
        )
        hook(adapter, "transform_llm_output")(
            response_text=rows["S1"]["sentinel"], session_id="dirty-session"
        )
    dirty_context = str(dirty_result.get("context", "")) if isinstance(dirty_result, dict) else ""
    dirty_ok = (
        marker.read_bytes() == b"preserve-this-byte\n"
        and plugin.core.LIT_CONTEXT in dirty_context
    )
    return {
        "malformed_input": malformed_ok,
        "stale_state": stale_ok,
        "dirty_worktree": dirty_ok,
    }
