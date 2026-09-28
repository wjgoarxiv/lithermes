"""Every schema identifier the frontend-ui-ux references teach must be real.

The failure this prevents: a reference document instructing the reader to write a
field the shipped validator rejects. A practitioner follows the documentation and
`design_contract_validation` answers `contract has unapproved keys [...]`, exit 1,
on their first attempt.

Three schemas ship, and the references legitimately draw on all of them: the design
contract (read from `design_contract_validation` itself), the visual-qa evidence
manifest, and the review receipt. All three are read from source, never restated
here, so widening a schema is the only way to widen what the docs may teach — and
widening a schema to match a doc would be gate-weakening, the wrong direction.

A backticked token that is a VALUE rather than a field (`unsupported`, `pass`) is
not a contract path. Those live in NON_FIELD_VOCABULARY below. Adding to that set
is a deliberate, reviewable act; the gate fails loudly otherwise.
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _ASSET_DIR
except ImportError:
    from plugin_register_test_support import _ASSET_DIR

_SKILLS = Path(_ASSET_DIR) / "skills"
_SKILL = _SKILLS / "frontend-ui-ux"
_REFERENCES = _SKILL / "references"

for _path in (str(Path(_ASSET_DIR)), str(_SKILL / "scripts")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import design_contract_validation as validator  # noqa: E402

# Where each list/object in the contract nests. Key tuples come from the
# validator; only the SHAPE lives here.
_NESTING = {
    "intent": validator.INTENT_KEYS,
    "direction": validator.DIRECTION_KEYS,
    "accessibility": validator.ACCESSIBILITY_KEYS,
    "localization": validator.LOCALIZATION_KEYS,
    "performance": validator.PERFORMANCE_KEYS,
    "evidence_policy": validator.EVIDENCE_POLICY_KEYS,
    "inventory": validator.INVENTORY_KEYS,
    "inventory.routes": validator.ROUTE_KEYS,
    "inventory.regions": validator.REGION_KEYS,
    "inventory.components": validator.COMPONENT_KEYS,
    "inventory.interactions": validator.INTERACTION_KEYS,
    "inventory.states": validator.STATE_KEYS,
    "inventory.viewports": validator.VIEWPORT_KEYS,
    "inventory.references": validator.REFERENCE_KEYS,
    "inventory.authenticated_surfaces": validator.SURFACE_KEYS,
    "omissions": validator.DISCLOSURE_KEYS,
    "accepted_exceptions": validator.DISCLOSURE_KEYS,
}

# Backticked words that are values, CSS/HTML/JS vocabulary, tool names, or plain
# English — not schema field paths. Adding to this set is a deliberate, reviewable
# act; it is the only escape hatch this gate has.
NON_FIELD_VOCABULARY = frozenset({
    # contract/manifest VALUES rather than field names
    "unsupported", "supported", "review", "reviewed", "none", "pass", "fail",
    "blocked", "ready", "true", "false", "null", "auto", "manual", "verified",
    "light", "dark", "ltr", "rtl", "mobile", "tablet", "desktop", "wide",
    "loading", "empty", "error", "success", "partial", "idle", "disabled",
    "pointer", "touch", "critical", "high", "medium", "low", "fine", "coarse",
    "hover", "reduce", "forced", "active", "focus", "visited",
    # QA channels and artifact kinds
    "http", "tmux", "browser", "computer", "cli", "png", "json", "md",
    # CSS units, properties, and at-rule vocabulary
    "vw", "vh", "rem", "em", "px", "ch", "fr", "dvh", "svh", "lvh",
    "order", "grid", "flex", "gap", "clamp", "minmax", "container",
    "ui", "enter", "exit", "transform", "opacity", "top", "left",
    # HTML elements and attributes
    "h1", "h2", "h3", "nav", "main", "footer", "header", "aside", "section",
    "article", "button", "dialog", "href", "src", "alt", "lang", "dir",
    # JS/host globals, DOM events, and tool names
    "window", "document", "javascript", "data", "delegate_task", "curl",
    "compositionend", "compositionstart", "tabindex", "preload", "async",
    "div", "a", "input", "table", "img", "span", "ul", "li", "form", "label",
    # prose nouns the docs backtick for emphasis, not schema fields
    "permissions", "platform", "stack",
    # host symbols, typed-ID shorthand, output fields, and literal examples in
    # the preserved complete contract (these are not accepted input fields)
    "core_contract.conditional_uiux_skill_blocks", "pre_llm_call", "plugin.yaml",
    "contract", "route", "region", "component", "interaction", "reference",
    "region.route_id", "interaction.route_id", "state.route_id",
    "authenticated_surface.route_id", "component.region_id",
    "z", "valid", "schema", "issues", "primary",
    # Taste-direction prose names motion policies, modes, and lanes rather than
    # fields in the design-contract schema; the reference is carried byte-for-byte.
    "motion.policy", "functional", "expressive", "redesign", "brownfield",
    "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8",
})

# Design TOKEN identifiers the reader invents — `surface.raised`, `button.primary.bg`.
# These are examples of a naming convention, not fields of any shipped schema, so
# they are listed rather than resolved. A new example must be added here
# deliberately, which is the point.
DESIGN_TOKEN_EXAMPLES = frozenset({
    "radius.md", "surface.raised", "text.secondary", "border.focus",
    "button.primary.bg", "table.row.gap",
})

_TOKEN = re.compile(r"`([^`\n]+)`")
# A schema-path-shaped token: snake_case, optionally dotted, with `[]` allowed on
# any segment so `inventory.references[].sha256` is checked rather than skipped.
_PATH_SHAPE = re.compile(r"^[a-z][a-z0-9_]*(?:\[\])?(?:\.[a-z][a-z0-9_]*(?:\[\])?)*$")


def _json_schema_properties(path):
    """Every `properties` name declared anywhere in a JSON Schema document."""
    names = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "properties" and isinstance(value, dict):
                    names.update(value)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(path.read_text(encoding="utf-8")))
    return names


def _legal_paths():
    """Every identifier any shipped schema accepts, as bare names and dotted paths."""
    paths = set(validator.TOP_KEYS)
    for prefix, keys in _NESTING.items():
        paths.add(prefix)
        for key in keys:
            paths.add(key)
            paths.add("{0}.{1}".format(prefix, key))
    # The references also teach the visual-qa evidence manifest and review receipt.
    # Those are real shipped schemas; their field names are not contract defects.
    for schema in sorted(_SKILLS.glob("*/schemas/*.json")):
        paths.update(_json_schema_properties(schema))
    return paths


def _referenced_paths():
    """(path, file, line) for every contract-path-shaped backticked token."""
    found = []
    for doc in sorted(_REFERENCES.glob("*.md")):
        for number, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), 1):
            for raw in _TOKEN.findall(line):
                token = raw.strip().rstrip(".,;:")
                if not _PATH_SHAPE.match(token):
                    continue
                bare = token.replace("[]", "")
                if bare in NON_FIELD_VOCABULARY or bare in DESIGN_TOKEN_EXAMPLES:
                    continue
                found.append((bare, doc.name, number))
    return found


class ReferenceContractTerms(unittest.TestCase):
    def test_every_taught_contract_identifier_resolves_against_the_validator(self):
        legal = _legal_paths()
        unresolved = [
            "{0}:{1}  `{2}`".format(doc, line, path)
            for path, doc, line in _referenced_paths()
            if path not in legal
        ]
        self.assertEqual(
            unresolved, [],
            "reference docs teach contract identifiers the validator rejects.\n"
            "Fix the DOC to match the schema — never widen the validator to match a doc.\n"
            "If the token is a value rather than a field, add it to "
            "NON_FIELD_VOCABULARY.\n" + "\n".join(unresolved),
        )

    def test_the_nesting_map_covers_every_key_tuple_the_validator_defines(self):
        """A new *_KEYS constant must be wired in here or this gate goes blind."""
        defined = {n for n in dir(validator) if n.endswith("_KEYS")}
        wired = {"TOP_KEYS"}
        for keys in _NESTING.values():
            for name in defined:
                if getattr(validator, name) is keys:
                    wired.add(name)
        self.assertEqual(
            sorted(defined - wired), [],
            "these validator key tuples are not reachable from _NESTING, so the "
            "gate cannot check identifiers under them",
        )

    def test_the_gate_actually_has_something_to_check(self):
        """A gate that inspects nothing cannot fail. Prove it sees real tokens."""
        referenced = _referenced_paths()
        self.assertGreater(len(referenced), 20, "too few tokens — the extractor is broken")
        self.assertGreaterEqual(
            len({doc for _, doc, _ in referenced}), 8,
            "tokens found in too few documents — the extractor is broken",
        )

    def test_motion_prose_matches_the_validator_boundary(self):
        text = (_REFERENCES / "complete-contract.md").read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"(?s)validator checks motion\.policy.*taste\.motion.*independent integer",
        )
        self.assertNotIn("both must\n hold", text)


if __name__ == "__main__":
    unittest.main()
