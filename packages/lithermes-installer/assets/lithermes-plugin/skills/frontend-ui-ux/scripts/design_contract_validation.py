"""Executable rules for litfamily.design-contract/v1alpha1.

`schemas/design-contract-v1alpha1.schema.json` states the document shape and is
useful for editor tooling, but a JSON Schema pass alone accepts contracts that are
already unusable. It cannot resolve a `route_id` pointer, cannot notice that one id
was reused in two inventory groups, cannot couple `auth_required` routes to their
authenticated surfaces, cannot see a duplicated JSON key that the parser already
collapsed, and cannot decide whether a timestamp round-trips. Those rules live in
this module, and this module wins whenever the two disagree.

Every check appends to an issue list instead of raising, so one pass reports the
whole set of violations rather than the first one.
"""
from __future__ import annotations

import json
import re
import stat
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Final, Optional

from uiux_runtime_common import ContractError, JsonValue, parse_json_bytes

SCHEMA_ID: Final = "litfamily.design-contract/v1alpha1"
BETA_SCHEMA_ID: Final = "litfamily.design-contract/v1beta1"
BETA2_SCHEMA_ID: Final = "litfamily.design-contract/v1beta2"
UNTRUSTED: Final = "CONTRACT_INPUT_UNTRUSTED"
MAX_CONTRACT_BYTES: Final = 1024 * 1024
MAX_NESTING_DEPTH: Final = 64
MAX_BETA_TEXT_CHARACTERS: Final = 512
ACCESSIBILITY_TARGET: Final = "WCAG 2.2 AA"
UTC_INSTANT: Final = "%Y-%m-%dT%H:%M:%SZ"

# `fullmatch` rather than the `^...$` form, because Python's `$` also matches just
# before a trailing newline and would let "<64 hex>\n" through as a hash.
ID_GRAMMAR: Final = re.compile(r"[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*")
HASH_GRAMMAR: Final = re.compile(r"[0-9a-f]{64}")

TOP_KEYS: Final = (
    "schema_id", "contract_id", "source_hash", "intent", "direction", "inventory",
    "accessibility", "localization", "performance", "evidence_policy", "omissions",
    "accepted_exceptions",
)
BETA_TOP_FIELDS: Final = TOP_KEYS + (
    "lane", "tokens", "component_behaviors", "responsive_transformations", "motion",
    "acceptance_criteria",
)
# v1beta2 adds one optional root key. Optional is the whole point: a contract that
# says nothing about taste is complete, and a v1beta1 document keeps its meaning.
BETA2_OPTIONAL_FIELDS: Final = ("taste",)
# Direction expressed as numbers a reviewer can argue with, rather than adjectives
# they cannot.
TASTE_DIALS: Final = ("variance", "motion", "density")
TASTE_LOW: Final = 1
TASTE_HIGH: Final = 10

INTENT_KEYS: Final = ("audiences", "tasks", "qualities", "constraints", "non_goals")
DIRECTION_KEYS: Final = ("name", "principles", "token_strategy", "voice")
INVENTORY_KEYS: Final = (
    "routes", "regions", "components", "interactions", "states", "viewports",
    "references", "authenticated_surfaces",
)
ACCESSIBILITY_KEYS: Final = (
    "target", "keyboard", "screen_reader", "reduced_motion", "forced_colors", "zoom_percent",
)
LOCALIZATION_KEYS: Final = (
    "locales", "text_expansion_percent", "cjk_line_break_review", "font_fallback_review",
    "ime_review", "rtl_review",
)
PERFORMANCE_KEYS: Final = ("lcp_ms", "cls", "inp_ms", "initial_js_kb", "initial_css_kb")
EVIDENCE_POLICY_KEYS: Final = (
    "independent_review_required", "required_channels", "cleanup_required",
)
DISCLOSURE_KEYS: Final = ("id", "reason", "owner")
ROUTE_KEYS: Final = ("id", "path", "priority", "auth_required")
REGION_KEYS: Final = ("id", "route_id", "purpose")
COMPONENT_KEYS: Final = ("id", "region_id", "role")
INTERACTION_KEYS: Final = ("id", "route_id", "trigger", "outcome", "criticality", "input_modes")
STATE_KEYS: Final = ("id", "route_id", "kind")
VIEWPORT_KEYS: Final = ("id", "category", "width_px", "height_px")
REFERENCE_KEYS: Final = ("id", "kind", "sha256")
SURFACE_KEYS: Final = ("route_id", "safe_test_account")

TOKEN_STRATEGIES: Final = ("reuse", "extend", "create")
ROUTE_PRIORITIES: Final = ("primary", "secondary")
INTERACTION_CRITICALITY: Final = ("critical", "supporting")
INPUT_MODES: Final = ("keyboard", "pointer", "touch", "voice", "switch")
STATE_KINDS: Final = (
    "loading", "empty", "error", "success", "disabled", "permission", "offline", "ready",
)
VIEWPORT_CATEGORIES: Final = ("compact", "medium", "expanded")
REFERENCE_KINDS: Final = ("user-provided", "repo-local", "generated", "measured")
EVIDENCE_CHANNELS: Final = (
    "tests", "browser", "keyboard", "accessibility-tree", "screen-reader", "performance",
    "localization",
)
LANES: Final = ("new-build", "brownfield", "redesign", "reference-fidelity", "design-system")
TOKEN_CATEGORIES: Final = ("color", "typography", "spacing", "radius", "shadow", "motion", "other")
MOTION_POLICIES: Final = ("none", "functional", "expressive")
VERIFICATION_METHODS: Final = EVIDENCE_CHANNELS + ("manual",)

_WHITESPACE: Final = " \t\n\r"
_STRING_ESCAPES: Final = {
    '"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t",
}
_HEX_DIGITS: Final = "0123456789abcdefABCDEF"
_SCALAR_STOP: Final = ",}]" + _WHITESPACE


# ---------------------------------------------------------------------------
# Bounded, pre-parse input screening
# ---------------------------------------------------------------------------


def _untrusted(detail: str) -> None:
    raise ContractError(UNTRUSTED, detail)


def _skip_whitespace(text: str, index: int) -> int:
    while index < len(text) and text[index] in _WHITESPACE:
        index += 1
    return index


def _scan_string(text: str, index: int) -> tuple:
    """Read one JSON string literal starting at the opening quote.

    Returns the decoded text and the index just past the closing quote. Raw control
    characters are rejected here so a smuggled newline or escape byte inside a key or
    value never reaches the parser.
    """
    index += 1
    pieces = []
    while True:
        if index >= len(text):
            _untrusted("unterminated string literal")
        character = text[index]
        if character == '"':
            return "".join(pieces), index + 1
        if character == "\\":
            if index + 1 >= len(text):
                _untrusted("truncated escape sequence")
            escape = text[index + 1]
            if escape == "u":
                digits = text[index + 2:index + 6]
                if len(digits) != 4 or any(digit not in _HEX_DIGITS for digit in digits):
                    _untrusted("malformed \\u escape sequence")
                pieces.append(chr(int(digits, 16)))
                index += 6
                continue
            if escape not in _STRING_ESCAPES:
                _untrusted("unknown escape sequence: \\" + escape)
            pieces.append(_STRING_ESCAPES[escape])
            index += 2
            continue
        if ord(character) < 0x20:
            _untrusted("raw control character inside a string literal")
        pieces.append(character)
        index += 1


def _scan_object(text: str, index: int, depth: int) -> int:
    # A fresh key set per object per depth: repeating a key inside one object fails,
    # while the same key name at another depth or in a sibling object stays legal.
    keys = set()
    index = _skip_whitespace(text, index + 1)
    if index < len(text) and text[index] == "}":
        return index + 1
    while True:
        index = _skip_whitespace(text, index)
        if index >= len(text) or text[index] != '"':
            _untrusted("object member name must be a string literal")
        key, index = _scan_string(text, index)
        if key in keys:
            _untrusted("duplicate object key: " + key)
        keys.add(key)
        index = _skip_whitespace(text, index)
        if index >= len(text) or text[index] != ":":
            _untrusted("object member is missing its name separator")
        index = _scan_value(text, index + 1, depth + 1)
        index = _skip_whitespace(text, index)
        if index >= len(text):
            _untrusted("unterminated object")
        if text[index] == ",":
            index += 1
            continue
        if text[index] == "}":
            return index + 1
        _untrusted("malformed object member separator")


def _scan_array(text: str, index: int, depth: int) -> int:
    index = _skip_whitespace(text, index + 1)
    if index < len(text) and text[index] == "]":
        return index + 1
    while True:
        index = _scan_value(text, index, depth + 1)
        index = _skip_whitespace(text, index)
        if index >= len(text):
            _untrusted("unterminated array")
        if text[index] == ",":
            index += 1
            continue
        if text[index] == "]":
            return index + 1
        _untrusted("malformed array element separator")


def _scan_value(text: str, index: int, depth: int) -> int:
    if depth > MAX_NESTING_DEPTH:
        _untrusted("nesting deeper than {0} levels".format(MAX_NESTING_DEPTH))
    index = _skip_whitespace(text, index)
    if index >= len(text):
        _untrusted("truncated JSON value")
    character = text[index]
    if character == "{":
        return _scan_object(text, index, depth)
    if character == "[":
        return _scan_array(text, index, depth)
    if character == '"':
        return _scan_string(text, index)[1]
    # Numbers and the bare literals cannot contain a structural character, so walking
    # to the next one is enough; json.loads decides whether the token is well formed.
    start = index
    while index < len(text) and text[index] not in _SCALAR_STOP:
        index += 1
    if index == start:
        _untrusted("unexpected character: " + character)
    return index


def scan_contract_text(text: str) -> None:
    """Walk the raw document before it is parsed.

    The load-bearing reason is duplicate keys: json.loads keeps the last value for a
    repeated key and reports nothing, so a contract can silently disagree with the text
    that was reviewed and hashed. Control-character, framing, and depth checks fall out
    of the same walk, which means an untrustworthy payload is rejected before any value
    is materialised.
    """
    if "\x00" in text:
        _untrusted("payload contains a NUL byte")
    end = _scan_value(text, 0, 0)
    if text[_skip_whitespace(text, end):]:
        _untrusted("trailing data after the JSON document")


def load_design_contract_bytes(raw: bytes) -> JsonValue:
    """Decode and screen a contract payload, or refuse it outright.

    Raises ContractError with code CONTRACT_INPUT_UNTRUSTED when the bytes cannot be
    trusted enough to check against the rules at all.
    """
    if len(raw) > MAX_CONTRACT_BYTES:
        _untrusted("{0} bytes exceeds the {1}-byte cap".format(len(raw), MAX_CONTRACT_BYTES))
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContractError(UNTRUSTED, "payload is not valid UTF-8: {0}".format(error)) from error
    scan_contract_text(text)
    try:
        return parse_json_bytes(raw, maximum_bytes=MAX_CONTRACT_BYTES)
    except ContractError as error:
        raise ContractError(UNTRUSTED, "{0}: {1}".format(error.code, error.detail)) from error


def load_design_contract_path(path: Path) -> JsonValue:
    """Read a contract from a path, refusing anything that is not a bounded regular file."""
    try:
        status = path.lstat()
    except OSError as error:
        raise ContractError(UNTRUSTED, "contract path is unreadable: {0}".format(error)) from error
    if path.is_symlink() or not stat.S_ISREG(status.st_mode):
        _untrusted("contract path is not a regular file: {0}".format(path))
    if status.st_size > MAX_CONTRACT_BYTES:
        _untrusted("{0} bytes exceeds the {1}-byte cap".format(status.st_size, MAX_CONTRACT_BYTES))
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ContractError(UNTRUSTED, "contract path is unreadable: {0}".format(error)) from error
    return load_design_contract_bytes(raw)


def load_design_contract_stdin() -> JsonValue:
    return load_design_contract_bytes(sys.stdin.buffer.read(MAX_CONTRACT_BYTES + 1))


def canonical_design_contract(value: JsonValue) -> str:
    """Canonical text for hashing.

    Object keys are sorted at every depth, array order is preserved, and the text ends
    with exactly one newline. That newline is part of the canonical form: every design
    contract digest in this plugin is taken over this exact text, so dropping it changes
    every hash the evidence trail pins.
    """
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


# ---------------------------------------------------------------------------
# Primitive rules
# ---------------------------------------------------------------------------


def _mapping(issues: list, value: JsonValue, keys: tuple, label: str, optional: tuple = ()):
    if not isinstance(value, dict):
        issues.append("{0} must be an object".format(label))
        return None
    missing = sorted(set(keys) - set(value))
    unknown = sorted(set(value) - set(keys) - set(optional))
    if missing:
        issues.append("{0} is missing {1}".format(label, missing))
    if unknown:
        issues.append("{0} has unapproved keys {1}".format(label, unknown))
    return value


def _text(issues: list, value: JsonValue, label: str, maximum: Optional[int] = None):
    if not isinstance(value, str) or not value.strip():
        issues.append("{0} must be a non-empty string".format(label))
        return None
    if maximum is not None and len(value) > maximum:
        issues.append("{0} must contain at most {1} characters".format(label, maximum))
        return None
    return value


def _enum(issues: list, value: JsonValue, allowed: tuple, label: str):
    if not isinstance(value, str) or value not in allowed:
        issues.append("{0} must be one of {1}".format(label, list(allowed)))
        return None
    return value


def _boolean(issues: list, value: JsonValue, label: str) -> None:
    if not isinstance(value, bool):
        issues.append("{0} must be a JSON boolean".format(label))


def _integer(issues: list, value: JsonValue, label: str, low: int, high: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        issues.append("{0} must be an integer in {1}..{2}".format(label, low, high))


def _number(issues: list, value: JsonValue, label: str, low: float, high: float) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        issues.append("{0} must be a number in {1}..{2}".format(label, low, high))


def _hash(issues: list, value: JsonValue, label: str) -> None:
    text = _text(issues, value, label)
    if text is not None and HASH_GRAMMAR.fullmatch(text) is None:
        issues.append("{0} must be a lowercase 64-character sha256".format(label))


def _identifier(issues: list, value: JsonValue, label: str):
    text = _text(issues, value, label)
    if text is None:
        return None
    if ID_GRAMMAR.fullmatch(text) is None:
        issues.append("{0} must match the id grammar <kind>:<slug>, lowercase only".format(label))
        return None
    return text


def _typed_identifier(issues: list, value: JsonValue, prefix: str, label: str):
    text = _identifier(issues, value, label)
    if text is None:
        return None
    if text.split(":", 1)[0] != prefix:
        issues.append("{0} must carry the '{1}:' type prefix".format(label, prefix))
        return None
    return text


def _resolve(issues: list, value: JsonValue, prefix: str, declared, label: str) -> None:
    """Check a cross-reference: right type prefix, and the target is actually declared."""
    identity = _typed_identifier(issues, value, prefix, label)
    if identity is not None and identity not in declared:
        issues.append(
            "{0} does not resolve to a declared {1}: {2}".format(label, prefix, identity)
        )


def _utc_instant(issues: list, value: JsonValue, label: str) -> None:
    text = _text(issues, value, label)
    if text is None:
        return
    try:
        parsed = datetime.strptime(text, UTC_INSTANT)
    except ValueError:
        issues.append("{0} must be an ISO-8601 UTC instant like 2026-08-24T00:00:00Z".format(label))
        return
    # strptime matches literal characters case-insensitively and accepts single-digit
    # fields, so only the round trip proves the text was already canonical. This is what
    # rejects a lowercase z, a "+00:00" offset that slipped past, and 2026-8-4.
    if parsed.strftime(UTC_INSTANT) != text:
        issues.append(
            "{0} must round-trip exactly as 2026-08-24T00:00:00Z: no offset, no fractional"
            " seconds, uppercase T and Z".format(label)
        )


def _strings(issues: list, value: JsonValue, label: str, minimum: int = 1, maximum=None) -> list:
    if not isinstance(value, list):
        issues.append("{0} must be an array".format(label))
        return []
    items = []
    for position, candidate in enumerate(value):
        text = _text(issues, candidate, "{0}[{1}]".format(label, position))
        if text is not None:
            items.append(text)
    if len(value) < minimum:
        issues.append("{0} must list at least {1} entries".format(label, minimum))
    if maximum is not None and len(value) > maximum:
        issues.append("{0} must list at most {1} entries".format(label, maximum))
    if len(set(items)) != len(items):
        issues.append("{0} entries must be unique".format(label))
    return items


def _objects(issues: list, value: JsonValue, label: str, minimum: int = 0) -> list:
    if not isinstance(value, list):
        issues.append("{0} must be an array".format(label))
        return []
    if len(value) < minimum:
        issues.append("{0} must list at least {1} entries".format(label, minimum))
    return list(enumerate(value))


# ---------------------------------------------------------------------------
# Group rules
# ---------------------------------------------------------------------------


def _intent(issues: list, value: JsonValue) -> None:
    intent = _mapping(issues, value, INTENT_KEYS, "intent")
    if intent is None:
        return
    for key in ("audiences", "tasks", "qualities"):
        _strings(issues, intent.get(key), "intent.{0}".format(key))
    for key in ("constraints", "non_goals"):
        _strings(issues, intent.get(key), "intent.{0}".format(key), minimum=0)


def _direction(issues: list, value: JsonValue) -> None:
    direction = _mapping(issues, value, DIRECTION_KEYS, "direction")
    if direction is None:
        return
    _text(issues, direction.get("name"), "direction.name")
    _strings(issues, direction.get("principles"), "direction.principles", minimum=3, maximum=7)
    _enum(issues, direction.get("token_strategy"), TOKEN_STRATEGIES, "direction.token_strategy")
    _text(issues, direction.get("voice"), "direction.voice")


def _accessibility(issues: list, value: JsonValue) -> None:
    accessibility = _mapping(issues, value, ACCESSIBILITY_KEYS, "accessibility")
    if accessibility is None:
        return
    # Strict equality, not a pattern and not an enum: this plugin ships one target.
    if accessibility.get("target") != ACCESSIBILITY_TARGET:
        issues.append("accessibility.target must equal '{0}'".format(ACCESSIBILITY_TARGET))
    for key in ("keyboard", "screen_reader", "reduced_motion", "forced_colors"):
        _boolean(issues, accessibility.get(key), "accessibility.{0}".format(key))
    _integer(issues, accessibility.get("zoom_percent"), "accessibility.zoom_percent", 200, 400)


def _localization(issues: list, value: JsonValue) -> None:
    localization = _mapping(issues, value, LOCALIZATION_KEYS, "localization")
    if localization is None:
        return
    _strings(issues, localization.get("locales"), "localization.locales")
    _integer(
        issues,
        localization.get("text_expansion_percent"),
        "localization.text_expansion_percent",
        0,
        300,
    )
    for key in ("cjk_line_break_review", "font_fallback_review", "ime_review", "rtl_review"):
        _boolean(issues, localization.get(key), "localization.{0}".format(key))


def _performance(issues: list, value: JsonValue) -> None:
    performance = _mapping(issues, value, PERFORMANCE_KEYS, "performance")
    if performance is None:
        return
    # Every dimension is bounded on both sides; an open-ended budget is not a budget.
    _integer(issues, performance.get("lcp_ms"), "performance.lcp_ms", 1, 60000)
    _number(issues, performance.get("cls"), "performance.cls", 0, 1)
    _integer(issues, performance.get("inp_ms"), "performance.inp_ms", 1, 60000)
    _integer(issues, performance.get("initial_js_kb"), "performance.initial_js_kb", 0, 1048576)
    _integer(issues, performance.get("initial_css_kb"), "performance.initial_css_kb", 0, 1048576)


def _evidence_policy(issues: list, value: JsonValue) -> None:
    policy = _mapping(issues, value, EVIDENCE_POLICY_KEYS, "evidence_policy")
    if policy is None:
        return
    _boolean(
        issues,
        policy.get("independent_review_required"),
        "evidence_policy.independent_review_required",
    )
    channels = _strings(
        issues, policy.get("required_channels"), "evidence_policy.required_channels"
    )
    unknown = sorted(set(channels) - set(EVIDENCE_CHANNELS))
    if unknown:
        issues.append(
            "evidence_policy.required_channels has unapproved channels {0}; allowed: {1}".format(
                unknown, list(EVIDENCE_CHANNELS)
            )
        )
    _boolean(issues, policy.get("cleanup_required"), "evidence_policy.cleanup_required")


def _disclosures(issues: list, value: JsonValue, field: str) -> list:
    collected = []
    for position, candidate in _objects(issues, value, field):
        label = "{0}[{1}]".format(field, position)
        entry = _mapping(issues, candidate, DISCLOSURE_KEYS, label, optional=("expires_at",))
        if entry is None:
            continue
        identity = _identifier(issues, entry.get("id"), "{0}.id".format(label))
        if identity is not None:
            collected.append(identity)
        _text(issues, entry.get("reason"), "{0}.reason".format(label))
        _text(issues, entry.get("owner"), "{0}.owner".format(label))
        if "expires_at" in entry:
            _utc_instant(issues, entry.get("expires_at"), "{0}.expires_at".format(label))
    return collected


def _routes(issues: list, value: JsonValue, ids: list) -> dict:
    routes = {}
    priorities = []
    for position, candidate in _objects(issues, value, "inventory.routes", minimum=1):
        label = "inventory.routes[{0}]".format(position)
        route = _mapping(issues, candidate, ROUTE_KEYS, label)
        if route is None:
            continue
        identity = _typed_identifier(issues, route.get("id"), "route", "{0}.id".format(label))
        _text(issues, route.get("path"), "{0}.path".format(label))
        priority = _enum(
            issues, route.get("priority"), ROUTE_PRIORITIES, "{0}.priority".format(label)
        )
        _boolean(issues, route.get("auth_required"), "{0}.auth_required".format(label))
        if priority is not None:
            priorities.append(priority)
        if identity is not None:
            ids.append(identity)
            routes[identity] = route.get("auth_required") is True
    if "primary" not in priorities:
        issues.append("inventory.routes must mark at least one route as 'primary'")
    return routes


def _regions(issues: list, value: JsonValue, routes: dict, ids: list) -> set:
    regions = set()
    for position, candidate in _objects(issues, value, "inventory.regions", minimum=1):
        label = "inventory.regions[{0}]".format(position)
        region = _mapping(issues, candidate, REGION_KEYS, label)
        if region is None:
            continue
        identity = _typed_identifier(issues, region.get("id"), "region", "{0}.id".format(label))
        _resolve(issues, region.get("route_id"), "route", routes, "{0}.route_id".format(label))
        _text(issues, region.get("purpose"), "{0}.purpose".format(label))
        if identity is not None:
            ids.append(identity)
            regions.add(identity)
    return regions


def _components(issues: list, value: JsonValue, regions: set, ids: list) -> None:
    for position, candidate in _objects(issues, value, "inventory.components", minimum=1):
        label = "inventory.components[{0}]".format(position)
        component = _mapping(issues, candidate, COMPONENT_KEYS, label)
        if component is None:
            continue
        identity = _typed_identifier(
            issues, component.get("id"), "component", "{0}.id".format(label)
        )
        _resolve(
            issues, component.get("region_id"), "region", regions, "{0}.region_id".format(label)
        )
        _text(issues, component.get("role"), "{0}.role".format(label))
        if identity is not None:
            ids.append(identity)


def _interactions(issues: list, value: JsonValue, routes: dict, ids: list) -> None:
    criticality = []
    for position, candidate in _objects(issues, value, "inventory.interactions", minimum=1):
        label = "inventory.interactions[{0}]".format(position)
        interaction = _mapping(issues, candidate, INTERACTION_KEYS, label)
        if interaction is None:
            continue
        identity = _typed_identifier(
            issues, interaction.get("id"), "interaction", "{0}.id".format(label)
        )
        _resolve(
            issues, interaction.get("route_id"), "route", routes, "{0}.route_id".format(label)
        )
        _text(issues, interaction.get("trigger"), "{0}.trigger".format(label))
        _text(issues, interaction.get("outcome"), "{0}.outcome".format(label))
        weight = _enum(
            issues,
            interaction.get("criticality"),
            INTERACTION_CRITICALITY,
            "{0}.criticality".format(label),
        )
        modes = _strings(
            issues, interaction.get("input_modes"), "{0}.input_modes".format(label)
        )
        unknown = sorted(set(modes) - set(INPUT_MODES))
        if unknown:
            issues.append(
                "{0}.input_modes has unapproved modes {1}; allowed: {2}".format(
                    label, unknown, list(INPUT_MODES)
                )
            )
        if weight is not None:
            criticality.append(weight)
        if identity is not None:
            ids.append(identity)
    if "critical" not in criticality:
        issues.append("inventory.interactions must mark at least one interaction as 'critical'")


def _states(issues: list, value: JsonValue, routes: dict, ids: list) -> None:
    for position, candidate in _objects(issues, value, "inventory.states"):
        label = "inventory.states[{0}]".format(position)
        state = _mapping(issues, candidate, STATE_KEYS, label)
        if state is None:
            continue
        identity = _typed_identifier(issues, state.get("id"), "state", "{0}.id".format(label))
        _resolve(issues, state.get("route_id"), "route", routes, "{0}.route_id".format(label))
        _enum(issues, state.get("kind"), STATE_KINDS, "{0}.kind".format(label))
        if identity is not None:
            ids.append(identity)


def _viewports(issues: list, value: JsonValue, ids: list) -> None:
    for position, candidate in _objects(issues, value, "inventory.viewports"):
        label = "inventory.viewports[{0}]".format(position)
        viewport = _mapping(issues, candidate, VIEWPORT_KEYS, label)
        if viewport is None:
            continue
        identity = _typed_identifier(
            issues, viewport.get("id"), "viewport", "{0}.id".format(label)
        )
        _enum(
            issues, viewport.get("category"), VIEWPORT_CATEGORIES, "{0}.category".format(label)
        )
        _integer(issues, viewport.get("width_px"), "{0}.width_px".format(label), 1, 16384)
        _integer(issues, viewport.get("height_px"), "{0}.height_px".format(label), 1, 16384)
        if identity is not None:
            ids.append(identity)


def _references(issues: list, value: JsonValue, ids: list) -> None:
    for position, candidate in _objects(issues, value, "inventory.references"):
        label = "inventory.references[{0}]".format(position)
        reference = _mapping(issues, candidate, REFERENCE_KEYS, label)
        if reference is None:
            continue
        identity = _typed_identifier(
            issues, reference.get("id"), "reference", "{0}.id".format(label)
        )
        _enum(issues, reference.get("kind"), REFERENCE_KINDS, "{0}.kind".format(label))
        _hash(issues, reference.get("sha256"), "{0}.sha256".format(label))
        if identity is not None:
            ids.append(identity)


def _authenticated_surfaces(issues: list, value: JsonValue, routes: dict) -> set:
    covered = []
    for position, candidate in _objects(issues, value, "inventory.authenticated_surfaces"):
        label = "inventory.authenticated_surfaces[{0}]".format(position)
        surface = _mapping(issues, candidate, SURFACE_KEYS, label)
        if surface is None:
            continue
        route_id = _typed_identifier(
            issues, surface.get("route_id"), "route", "{0}.route_id".format(label)
        )
        if route_id is not None:
            if route_id in covered:
                issues.append(
                    "{0}.route_id repeats a surface already declared: {1}".format(label, route_id)
                )
            else:
                covered.append(route_id)
            if route_id not in routes:
                issues.append(
                    "{0}.route_id does not resolve to a declared route: {1}".format(
                        label, route_id
                    )
                )
        # Anything other than a literal true means the reviewer would be pointed at a
        # real account, so it fails closed rather than warning.
        if surface.get("safe_test_account") is not True:
            issues.append("{0}.safe_test_account must be exactly true".format(label))
    return set(covered)


def _inventory(issues: list, value: JsonValue, ids: list) -> None:
    inventory = _mapping(issues, value, INVENTORY_KEYS, "inventory")
    if inventory is None:
        return
    routes = _routes(issues, inventory.get("routes"), ids)
    regions = _regions(issues, inventory.get("regions"), routes, ids)
    _components(issues, inventory.get("components"), regions, ids)
    _interactions(issues, inventory.get("interactions"), routes, ids)
    _states(issues, inventory.get("states"), routes, ids)
    _viewports(issues, inventory.get("viewports"), ids)
    _references(issues, inventory.get("references"), ids)
    covered = _authenticated_surfaces(issues, inventory.get("authenticated_surfaces"), routes)
    for identity in sorted(routes):
        if routes[identity] and identity not in covered:
            issues.append(
                "route {0} sets auth_required but no authenticated surface covers it".format(
                    identity
                )
            )
        if not routes[identity] and identity in covered:
            issues.append(
                "route {0} is public but an authenticated surface claims it".format(identity)
            )


def _declared_ids(contract: dict, category: str) -> set:
    inventory = contract.get("inventory")
    if not isinstance(inventory, dict) or not isinstance(inventory.get(category), list):
        return set()
    return {
        item.get("id") for item in inventory[category]
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def _beta_references(issues: list, value: JsonValue, label: str, prefix: str, declared: set) -> None:
    for position, candidate in _objects(issues, value, label, minimum=1):
        identity = _typed_identifier(
            issues, candidate, prefix, "{0}[{1}]".format(label, position)
        )
        if identity is not None and identity not in declared:
            issues.append("{0} is not a declared {1}".format(identity, prefix))
    if isinstance(value, list) and len(set(item for item in value if isinstance(item, str))) != len(value):
        issues.append("{0} entries must be unique".format(label))


def _beta_extension(issues: list, contract: dict, ids: list) -> None:
    _enum(issues, contract.get("lane"), LANES, "lane")
    routes = _declared_ids(contract, "routes")
    components = _declared_ids(contract, "components")
    interactions = _declared_ids(contract, "interactions")
    states = _declared_ids(contract, "states")
    viewports = _declared_ids(contract, "viewports")
    inventory_ids = set().union(*(
        _declared_ids(contract, category) for category in INVENTORY_KEYS
    ))

    for position, candidate in _objects(issues, contract.get("tokens"), "tokens", minimum=1):
        label = "tokens[{0}]".format(position)
        token = _mapping(issues, candidate, ("id", "category", "value", "usage"), label)
        if token is None:
            continue
        identity = _typed_identifier(issues, token.get("id"), "token", "{0}.id".format(label))
        if identity is not None:
            ids.append(identity)
        _enum(issues, token.get("category"), TOKEN_CATEGORIES, "{0}.category".format(label))
        _text(
            issues, token.get("value"), "{0}.value".format(label), MAX_BETA_TEXT_CHARACTERS
        )
        _text(
            issues, token.get("usage"), "{0}.usage".format(label), MAX_BETA_TEXT_CHARACTERS
        )

    behavior_fields = ("component_id", "state_ids", "interaction_ids", "keyboard_behavior")
    for position, candidate in _objects(
        issues, contract.get("component_behaviors"), "component_behaviors", minimum=1
    ):
        label = "component_behaviors[{0}]".format(position)
        behavior = _mapping(issues, candidate, behavior_fields, label)
        if behavior is None:
            continue
        component_id = _typed_identifier(
            issues, behavior.get("component_id"), "component", "{0}.component_id".format(label)
        )
        if component_id is not None and component_id not in components:
            issues.append("{0} is not a declared component".format(component_id))
        _beta_references(
            issues, behavior.get("state_ids"), "{0}.state_ids".format(label), "state", states
        )
        _beta_references(
            issues, behavior.get("interaction_ids"), "{0}.interaction_ids".format(label),
            "interaction", interactions,
        )
        _text(
            issues,
            behavior.get("keyboard_behavior"),
            "{0}.keyboard_behavior".format(label),
            MAX_BETA_TEXT_CHARACTERS,
        )

    transformation_fields = ("route_id", "viewport_id", "behavior")
    for position, candidate in _objects(
        issues, contract.get("responsive_transformations"), "responsive_transformations", minimum=1
    ):
        label = "responsive_transformations[{0}]".format(position)
        transformation = _mapping(issues, candidate, transformation_fields, label)
        if transformation is None:
            continue
        route_id = _typed_identifier(
            issues, transformation.get("route_id"), "route", "{0}.route_id".format(label)
        )
        if route_id is not None and route_id not in routes:
            issues.append("{0} is not a declared route".format(route_id))
        viewport_id = _typed_identifier(
            issues, transformation.get("viewport_id"), "viewport", "{0}.viewport_id".format(label)
        )
        if viewport_id is not None and viewport_id not in viewports:
            issues.append("{0} is not a declared viewport".format(viewport_id))
        _text(
            issues,
            transformation.get("behavior"),
            "{0}.behavior".format(label),
            MAX_BETA_TEXT_CHARACTERS,
        )

    motion = _mapping(
        issues, contract.get("motion"), ("policy", "reduced_motion_behavior", "transitions"),
        "motion",
    )
    if motion is not None:
        policy = _enum(issues, motion.get("policy"), MOTION_POLICIES, "motion.policy")
        _text(
            issues,
            motion.get("reduced_motion_behavior"),
            "motion.reduced_motion_behavior",
            MAX_BETA_TEXT_CHARACTERS,
        )
        transitions = _objects(issues, motion.get("transitions"), "motion.transitions")
        if policy != "none" and len(transitions) == 0:
            issues.append("motion.transitions must not be empty for an active policy")
        if policy == "none" and len(transitions) > 0:
            issues.append("motion.transitions must be empty when policy is none")
        for position, candidate in transitions:
            label = "motion.transitions[{0}]".format(position)
            transition = _mapping(
                issues, candidate, ("id", "interaction_id", "duration_ms", "easing"), label
            )
            if transition is None:
                continue
            identity = _typed_identifier(
                issues, transition.get("id"), "transition", "{0}.id".format(label)
            )
            if identity is not None:
                ids.append(identity)
            interaction_id = _typed_identifier(
                issues, transition.get("interaction_id"), "interaction",
                "{0}.interaction_id".format(label),
            )
            if interaction_id is not None and interaction_id not in interactions:
                issues.append("{0} is not a declared interaction".format(interaction_id))
            _integer(issues, transition.get("duration_ms"), "{0}.duration_ms".format(label), 0, 10000)
            _text(
                issues,
                transition.get("easing"),
                "{0}.easing".format(label),
                MAX_BETA_TEXT_CHARACTERS,
            )

    criterion_fields = ("id", "observable", "verification", "required", "inventory_ids")
    for position, candidate in _objects(
        issues, contract.get("acceptance_criteria"), "acceptance_criteria", minimum=1
    ):
        label = "acceptance_criteria[{0}]".format(position)
        criterion = _mapping(issues, candidate, criterion_fields, label)
        if criterion is None:
            continue
        identity = _typed_identifier(
            issues, criterion.get("id"), "criterion", "{0}.id".format(label)
        )
        if identity is not None:
            ids.append(identity)
        _text(
            issues,
            criterion.get("observable"),
            "{0}.observable".format(label),
            MAX_BETA_TEXT_CHARACTERS,
        )
        _enum(
            issues, criterion.get("verification"), VERIFICATION_METHODS,
            "{0}.verification".format(label),
        )
        if criterion.get("required") is not True:
            issues.append("{0}.required must be exactly true".format(label))
        for covered in _strings(
            issues, criterion.get("inventory_ids"), "{0}.inventory_ids".format(label)
        ):
            if covered not in inventory_ids:
                issues.append("{0} is not declared in contract inventory".format(covered))


# One defect, one issue. A reviewer fixing a dial wants the dial named, not a list
# of every consequence of the same mistake. bool is rejected explicitly because it
# is a subclass of int in Python, so True would otherwise pass as the integer 1.
def _taste(issues: list, value: JsonValue) -> None:
    if not isinstance(value, dict):
        issues.append("taste must be an object declaring {0}".format(list(TASTE_DIALS)))
        return
    unknown = sorted(set(value) - set(TASTE_DIALS))
    if unknown:
        issues.append("taste has unapproved dials {0}".format(unknown))
        return
    for dial in TASTE_DIALS:
        label = "taste.{0}".format(dial)
        if dial not in value:
            issues.append("{0} is required whenever taste is declared".format(label))
            return
        reading = value[dial]
        if isinstance(reading, bool) or not isinstance(reading, int) \
                or reading < TASTE_LOW or reading > TASTE_HIGH:
            issues.append(
                "{0} must be an integer from {1} through {2}".format(label, TASTE_LOW, TASTE_HIGH)
            )
            return


def validate_design_contract(value: JsonValue) -> list:
    """Return every rule violation found. An empty list means the contract is valid."""
    issues = []
    beta2 = isinstance(value, dict) and value.get("schema_id") == BETA2_SCHEMA_ID
    beta = beta2 or (isinstance(value, dict) and value.get("schema_id") == BETA_SCHEMA_ID)
    contract = _mapping(
        issues,
        value,
        BETA_TOP_FIELDS if beta else TOP_KEYS,
        "contract",
        optional=BETA2_OPTIONAL_FIELDS if beta2 else (),
    )
    if contract is None:
        return issues
    if contract.get("schema_id") not in (SCHEMA_ID, BETA_SCHEMA_ID, BETA2_SCHEMA_ID):
        issues.append(
            "schema_id must equal '{0}', '{1}' or '{2}'".format(
                SCHEMA_ID, BETA_SCHEMA_ID, BETA2_SCHEMA_ID
            )
        )
    ids = []
    identity = _typed_identifier(issues, contract.get("contract_id"), "contract", "contract_id")
    if identity is not None:
        ids.append(identity)
    _hash(issues, contract.get("source_hash"), "source_hash")
    _intent(issues, contract.get("intent"))
    _direction(issues, contract.get("direction"))
    _inventory(issues, contract.get("inventory"), ids)
    _accessibility(issues, contract.get("accessibility"))
    _localization(issues, contract.get("localization"))
    _performance(issues, contract.get("performance"))
    _evidence_policy(issues, contract.get("evidence_policy"))
    ids.extend(_disclosures(issues, contract.get("omissions"), "omissions"))
    ids.extend(_disclosures(issues, contract.get("accepted_exceptions"), "accepted_exceptions"))
    if beta:
        if "taste" in contract:
            _taste(issues, contract.get("taste"))
        _beta_extension(issues, contract, ids)
    repeated = sorted(name for name, count in Counter(ids).items() if count > 1)
    if repeated:
        issues.append("ids must be unique across the whole contract; repeated {0}".format(repeated))
    return issues


def design_contract_report(value: JsonValue) -> dict:
    issues = validate_design_contract(value)
    beta2 = isinstance(value, dict) and value.get("schema_id") == BETA2_SCHEMA_ID
    beta = beta2 or (isinstance(value, dict) and value.get("schema_id") == BETA_SCHEMA_ID)
    alpha = isinstance(value, dict) and value.get("schema_id") == SCHEMA_ID
    valid = not issues
    if beta2:
        schema = BETA2_SCHEMA_ID
    elif beta:
        schema = BETA_SCHEMA_ID
    else:
        schema = SCHEMA_ID
    return {
        "diagnostics": ["LEGACY_SCHEMA_V1ALPHA1"] if alpha else [],
        "evidence_eligible": beta and valid,
        "issues": issues,
        "schema": schema,
        "valid": valid,
    }
