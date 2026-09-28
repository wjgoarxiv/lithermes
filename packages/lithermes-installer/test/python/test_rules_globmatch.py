"""Hand-rolled glob matcher: supported grammar plus every pinned divergence.

Each `test_dN_*` below pins one entry of `rules.globmatch.DIVERGENCES`. If a test
here changes, the DIVERGENCES text must change with it — the list is what a
reviewer reads instead of the code, so drift between them is the failure mode
this suite exists to prevent.
"""

from __future__ import annotations

import unittest

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


class SupportedGrammar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = _load_plugin_package().core.rules.globmatch

    def assert_matches(self, pattern, path, expected):
        self.assertEqual(
            self.g.matches(pattern, path), expected,
            "{0!r} vs {1!r} should be {2}".format(pattern, path, expected),
        )

    def test_single_segment_star_never_crosses_a_separator(self):
        self.assert_matches("*.ts", "app.ts", True)
        self.assert_matches("*.ts", "src/app.ts", False)
        self.assert_matches("*.ts", "app.tsx", False)

    def test_leading_globstar_matches_zero_or_more_segments(self):
        for path, expected in [("app.ts", True), ("src/app.ts", True), ("a/b/c/app.ts", True)]:
            self.assert_matches("**/*.ts", path, expected)

    def test_interior_globstar_matches_zero_or_more_segments(self):
        for path, expected in [("a/b", True), ("a/x/b", True), ("a/x/y/b", True), ("a/x/c", False)]:
            self.assert_matches("a/**/b", path, expected)

    def test_rooted_globstar_does_not_leak_to_a_sibling_directory(self):
        self.assert_matches("src/**/*.ts", "src/app.ts", True)
        self.assert_matches("src/**/*.ts", "src/a/b/app.ts", True)
        self.assert_matches("src/**/*.ts", "lib/app.ts", False)

    def test_question_mark_and_character_classes(self):
        self.assert_matches("?.ts", "a.ts", True)
        self.assert_matches("?.ts", "ab.ts", False)
        self.assert_matches("[abc].ts", "a.ts", True)
        self.assert_matches("[abc].ts", "d.ts", False)
        self.assert_matches("[a-c].ts", "b.ts", True)
        self.assert_matches("[!a-c].ts", "d.ts", True)
        self.assert_matches("[!a-c].ts", "b.ts", False)
        self.assert_matches("[^a-c].ts", "d.ts", True)

    def test_character_class_never_matches_a_separator(self):
        self.assert_matches("a[b/]c", "a/c", False)

    def test_brace_alternation_including_nesting(self):
        self.assert_matches("*.{ts,tsx}", "a.tsx", True)
        self.assert_matches("*.{ts,tsx}", "a.js", False)
        self.assert_matches("{src,test}/**/*.ts", "src/a.ts", True)
        self.assert_matches("{src,test}/**/*.ts", "test/x/a.ts", True)
        self.assert_matches("{src,test}/**/*.ts", "lib/a.ts", False)
        self.assert_matches("a{b,c{d,e}}f", "abf", True)
        self.assert_matches("a{b,c{d,e}}f", "acdf", True)
        self.assert_matches("a{b,c{d,e}}f", "acef", True)
        self.assert_matches("a{b,c{d,e}}f", "axf", False)

    def test_dotfiles_match_like_the_reference_dot_option(self):
        self.assert_matches("*", ".env", True)
        self.assert_matches("**/*", "src/.env", True)

    def test_windows_separators_are_normalized_on_both_sides(self):
        self.assert_matches("src/*.ts", "src\\app.ts", True)

    def test_empty_and_oversized_patterns_never_match(self):
        self.assert_matches("", "a.ts", False)
        self.assert_matches("a" * 5000, "a.ts", False)


class PinnedDivergences(unittest.TestCase):
    """One test per DIVERGENCES entry. Ids must stay in sync with the tuple."""

    @classmethod
    def setUpClass(cls):
        cls.g = _load_plugin_package().core.rules.globmatch

    def test_divergence_ids_are_exactly_the_documented_set(self):
        ids = [entry[0] for entry in self.g.DIVERGENCES]
        self.assertEqual(ids, [
            "D1-extglob",
            "D2-trailing-globstar-directory",
            "D3-partial-segment-globstar",
            "D4-posix-classes",
            "D5-comma-separated-globs",
            "D6-case-sensitivity",
            "D7-no-negated-globstar-anchoring",
            "D8-brace-expansion-limit",
            "D9-no-backslash-escape",
        ])
        for entry_id, text in self.g.DIVERGENCES:
            self.assertTrue(text.strip(), "{0} has no explanation".format(entry_id))

    def test_d1_extglob_is_not_implemented(self):
        # picomatch with bash:true would match `a.ts` here. This matcher does not.
        self.assertFalse(self.g.matches("@(a|b).ts", "a.ts"))
        self.assertFalse(self.g.matches("+(a|b).ts", "b.ts"))
        self.assertFalse(self.g.matches("!(a).ts", "b.ts"))
        # The parentheses are literal instead.
        self.assertTrue(self.g.matches("@(a|b).ts", "@(a|b).ts"))

    def test_d2_trailing_globstar_excludes_the_bare_directory(self):
        self.assertTrue(self.g.matches("src/**", "src/a.ts"))
        self.assertTrue(self.g.matches("src/**", "src/a/b.ts"))
        self.assertFalse(self.g.matches("src/**", "src"))

    def test_d3_partial_segment_globstar_degrades_to_a_single_star(self):
        self.assertTrue(self.g.matches("a**b", "axxb"))
        self.assertFalse(self.g.matches("a**b", "ax/xb"))

    def test_d4_posix_bracket_expressions_are_not_understood(self):
        # POSIX would match any alphabetic char. Here the inner `[:alpha:` becomes
        # the class and the second `]` stays literal, so nothing sensible matches:
        # a rule written this way is silently inert, not merely approximate.
        self.assertEqual(
            [r.pattern for r in self.g.compile_pattern("[[:alpha:]].ts")],
            [r"^[\[:alpha:]\]\.ts$"],
        )
        self.assertFalse(self.g.matches("[[:alpha:]].ts", "a.ts"))
        self.assertFalse(self.g.matches("[[:alpha:]].ts", "z.ts"))
        self.assertTrue(self.g.matches("[[:alpha:]].ts", "a].ts"))  # literal `]`
        # The documented rewrite works as expected.
        self.assertTrue(self.g.matches("[a-zA-Z].ts", "z.ts"))

    def test_d5_comma_separated_scalar_is_split(self):
        self.assertEqual(
            self.g.split_pattern_scalar("src/**/*.ts,src/**/*.tsx"),
            ["src/**/*.ts", "src/**/*.tsx"],
        )
        # A comma inside braces is preserved, because it belongs to the pattern.
        self.assertEqual(self.g.split_pattern_scalar("src/**/*.{ts,tsx}"), ["src/**/*.{ts,tsx}"])

    def test_d6_matching_is_always_case_sensitive(self):
        self.assertFalse(self.g.matches("*.ts", "A.TS"))
        self.assertFalse(self.g.matches("SRC/**", "src/a.ts"))

    def test_d7_negation_vetoes_without_reinclusion(self):
        from_rules = _load_plugin_package().core.rules
        parsed = from_rules.parse_rule(
            "---\nglobs:\n  - src/**/*.ts\n  - '!src/generated/**'\n---\nbody\n"
        )
        self.assertEqual(list(parsed.globs), ["src/**/*.ts", "!src/generated/**"])

    def test_d8_brace_expansion_over_the_cap_falls_back_to_literals(self):
        explosive = "{a,b}" * 40  # 2**40 expansions if attempted
        self.assertIsNone(self.g.expand_braces(explosive))
        # Compilation still succeeds and simply does not match the expanded form.
        self.assertFalse(self.g.matches(explosive, "a" * 40))

    def test_d9_backslash_is_a_separator_not_an_escape(self):
        # `a\*b` normalizes to the two-segment pattern `a/*b`, matching the
        # reference, so it cannot express a literal `*` in a filename.
        self.assertFalse(self.g.matches("a\\*b", "a*b"))
        self.assertTrue(self.g.matches("a\\*b", "a/xb"))


if __name__ == "__main__":
    unittest.main()
