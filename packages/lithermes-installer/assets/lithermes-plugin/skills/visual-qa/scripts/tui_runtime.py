from __future__ import annotations

import re
import unicodedata
from typing import Final, Optional, Tuple

from uiux_runtime_common import ContractError, JsonValue

CSI: Final = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
CONTROL: Final = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
CONNECTIONS: Final = {
    "─": frozenset(("left", "right")), "━": frozenset(("left", "right")),
    "│": frozenset(("up", "down")), "┃": frozenset(("up", "down")),
    "┌": frozenset(("right", "down")), "┐": frozenset(("left", "down")),
    "└": frozenset(("right", "up")), "┘": frozenset(("left", "up")),
    "├": frozenset(("right", "up", "down")), "┤": frozenset(("left", "up", "down")),
    "┬": frozenset(("left", "right", "down")), "┴": frozenset(("left", "right", "up")),
    "┼": frozenset(("left", "right", "up", "down")),
    "╭": frozenset(("right", "down")), "╮": frozenset(("left", "down")),
    "╰": frozenset(("right", "up")), "╯": frozenset(("left", "up")),
    "═": frozenset(("left", "right")), "║": frozenset(("up", "down")),
    "╔": frozenset(("right", "down")), "╗": frozenset(("left", "down")),
    "╚": frozenset(("right", "up")), "╝": frozenset(("left", "up")),
    "╠": frozenset(("right", "up", "down")), "╣": frozenset(("left", "up", "down")),
    "╦": frozenset(("left", "right", "down")), "╩": frozenset(("left", "right", "up")),
    "╬": frozenset(("left", "right", "up", "down")),
}
DIRECTIONS: Final = {
    "left": (0, -1, "right"), "right": (0, 1, "left"),
    "up": (-1, 0, "down"), "down": (1, 0, "up"),
}
MAX_TUI_GRAPHEME_INVENTORY: Final = 4096
MAX_TUI_LINE_INVENTORY: Final = 4096
MAX_TUI_OVERFLOW_INVENTORY: Final = 256


def strip_controls(text: str) -> Tuple[str, bool, bool]:
    output: list[str] = []
    index = 0
    had_osc = False
    malformed = False
    while index < len(text):
        if text.startswith("\x1b]", index):
            had_osc = True
            bell = text.find("\x07", index + 2)
            terminator = text.find("\x1b\\", index + 2)
            ends = [value for value in (bell, terminator) if value >= 0]
            if not ends:
                malformed = True
                break
            end = min(ends)
            index = end + (2 if text.startswith("\x1b\\", end) else 1)
            continue
        if text.startswith("\x1b[", index):
            match = CSI.match(text, index)
            if match is None:
                malformed = True
                index += 2
            else:
                index = match.end()
            continue
        char = text[index]
        if char == "\x1b" or CONTROL.fullmatch(char):
            malformed = True
            index += 1
            continue
        output.append(char)
        index += 1
    return "".join(output), had_osc, malformed


def grapheme_clusters(text: str) -> list[str]:
    clusters: list[str] = []
    join_next = False
    for char in text:
        code = ord(char)
        combining = unicodedata.combining(char) != 0 or 0xFE00 <= code <= 0xFE0F
        modifier = 0x1F3FB <= code <= 0x1F3FF
        if clusters and (combining or modifier or char == "\u200d" or join_next):
            clusters[-1] += char
        else:
            clusters.append(char)
        join_next = char == "\u200d"
    return clusters


def cluster_width(cluster: str, *, ambiguous_width: int) -> int:
    if not cluster or all(unicodedata.combining(char) for char in cluster):
        return 0
    if cluster in CONNECTIONS:
        return 1
    if "\u200d" in cluster or any(ord(char) >= 0x1F000 for char in cluster):
        return 2
    width = 0
    for char in cluster:
        code = ord(char)
        if unicodedata.combining(char) or 0xFE00 <= code <= 0xFE0F:
            continue
        category = unicodedata.east_asian_width(char)
        width += 2 if category in {"W", "F"} else ambiguous_width if category == "A" else 1
    return width


def _grid(lines: list[str], ambiguous_width: int) -> Tuple[list[list[Optional[str]]], list[int], list[dict[str, JsonValue]]]:
    rows: list[list[Optional[str]]] = []
    widths: list[int] = []
    graphemes: list[dict[str, JsonValue]] = []
    for line in lines:
        row: list[Optional[str]] = []
        for cluster in grapheme_clusters(line):
            width = cluster_width(cluster, ambiguous_width=ambiguous_width)
            graphemes.append({"text": cluster, "width": width})
            if width == 0:
                continue
            row.append(cluster)
            row.extend([None] * (width - 1))
        rows.append(row)
        widths.append(len(row))
    return rows, widths, graphemes


def _topology(rows: list[list[Optional[str]]]) -> bool:
    border_count = 0
    for row_index, row in enumerate(rows):
        for column, cluster in enumerate(row):
            if cluster not in CONNECTIONS:
                continue
            border_count += 1
            for direction in CONNECTIONS[cluster]:
                row_delta, column_delta, reciprocal = DIRECTIONS[direction]
                other_row = row_index + row_delta
                other_column = column + column_delta
                if not 0 <= other_row < len(rows) or not 0 <= other_column < len(rows[other_row]):
                    return False
                neighbor = rows[other_row][other_column]
                if neighbor not in CONNECTIONS or reciprocal not in CONNECTIONS[neighbor]:
                    return False
    return border_count > 0


def inspect_tui(text: str, *, columns: int, ambiguous_width: int) -> dict[str, JsonValue]:
    if not 1 <= columns <= 16384:
        raise ContractError("TUI_DIMENSION_INVALID", "columns must be in 1..16384")
    stripped, had_osc, malformed = strip_controls(text)
    rows, line_widths, graphemes = _grid(stripped.splitlines(), ambiguous_width)
    topology_valid = _topology(rows)
    findings: list[JsonValue] = []
    if not topology_valid:
        findings.append({"code": "TUI_BORDER_TOPOLOGY_INVALID", "message": "border connectivity is broken"})
    overflow_all = [index + 1 for index, width in enumerate(line_widths) if width > columns]
    overflow = overflow_all[:MAX_TUI_OVERFLOW_INVENTORY]
    if overflow:
        findings.append({"code": "TUI_OVERFLOW", "lines": overflow})
    if malformed:
        findings.append({"code": "TUI_CONTROL_SEQUENCE_INVALID", "message": "control sequence was incomplete or unsafe"})
    return {
        "border_topology_valid": topology_valid,
        "contains_control_sequences": False,
        "findings": findings,
        "grapheme_count": len(graphemes),
        "graphemes": graphemes[:MAX_TUI_GRAPHEME_INVENTORY],
        "graphemes_truncated": len(graphemes) > MAX_TUI_GRAPHEME_INVENTORY,
        "line_count": len(line_widths),
        "line_widths": line_widths[:MAX_TUI_LINE_INVENTORY],
        "line_widths_truncated": len(line_widths) > MAX_TUI_LINE_INVENTORY,
        "osc_inert": had_osc,
        "overflow_line_count": len(overflow_all),
        "overflow_lines_truncated": len(overflow_all) > MAX_TUI_OVERFLOW_INVENTORY,
        "verdict": "PASS" if not findings else "FAIL",
    }
