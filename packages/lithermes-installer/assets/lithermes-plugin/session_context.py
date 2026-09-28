"""Hermes session-kind predicates shared by LitHermes hook layers."""

from __future__ import annotations


def is_delegate_child_platform(platform: str) -> bool:
    """Return whether Hermes identified this turn as a delegate_task child."""
    return platform.strip().lower() == "subagent"
