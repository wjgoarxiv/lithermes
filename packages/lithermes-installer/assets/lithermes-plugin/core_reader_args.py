from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

_MODE_PREFIX: Final[re.Pattern[str]] = re.compile(
    r"^\s*(reader|technical|audit)\s+mode\s*:\s*",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class ReaderFacingCommandArgs:
    """A request-scoped disclosure mode plus the command arguments it governed."""

    command_args: str
    requested_mode: str | None

    @property
    def authority(self) -> str | None:
        """Name the trusted authority only when the current request selected a mode."""
        return "current_user_request" if self.requested_mode is not None else None


def parse_reader_facing_command_args(raw_args: str) -> ReaderFacingCommandArgs:
    """Consume only an explicit mode prefix at the native command-argument root."""
    match = _MODE_PREFIX.match(raw_args)
    if match is None:
        return ReaderFacingCommandArgs(command_args=raw_args, requested_mode=None)
    return ReaderFacingCommandArgs(
        command_args=raw_args[match.end() :],
        requested_mode=match.group(1).lower(),
    )
