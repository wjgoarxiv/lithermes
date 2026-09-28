# Inclusive interface

Check accessibility in the real task and supported modes. A scan helps find defects but cannot replace keyboard, assistive-technology, and rendered review.

Map tested operation to `accessibility.keyboard`.

## Semantics, focus, and controls

- Use one main landmark, labelled navigation regions, semantic header/footer, and a single route-level h1 with correctly ranked headings.
- Prefer native buttons, links, inputs, dialogs, and tables to generic elements with ARIA. Add ARIA only when native semantics do not express the needed name, state, or relationship.
- Keep focus visible and in reading order. Dialogs receive focus on open and return it on close; route changes move it to the new main heading/region.
- Color never carries status alone. Give errors, success, and selection text, icon, or structural cues.

## Visual access

Measure the rendered result in each supported theme:

- Body text contrast at least 4.5:1; large text at least 3:1.
- Controls, boundaries, icons, and chart marks at least 3:1 against adjacent colors.
- Focus indication at least 3:1 against both the control and surrounding surface; use a visible outline at least 2 px thick with 2 px offset.
- Prevent clipped text at 200% text scale and 400% zoom. Touch-target dimensions belong in adaptive-layout.md.

## Forms and feedback

Put each error beside its field, connect it programmatically, and announce it. Name what failed and the accepted correction. Preserve entered values after failure and focus the first invalid field. Empty states explain what belongs there and offer the next action. A loading or success result must be visible and announced; do not rely on color or motion alone.

## Localization and composition input

Externalize strings instead of joining translatable fragments. Test the longest supported locale; account for label and prose expansion, locale-aware dates/numbers/plurals, logical properties for RTL, and the correct language tags.

For Korean and other CJK text, use an appropriate font fallback, readable line-height, and punctuation-aware breaks. Test full-width characters, digits, and spaces. Do not validate, submit, autocomplete, or rerender during IME composition; wait for compositionend.

## Preferences and review

Honor forced colors with system colors and visible boundaries. Honor reduced motion while preserving the state change; see motion-guide.md for motion behavior. Review keyboard completion, a representative screen-reader pairing, contrast, rendered narrow/zoomed states, and supported CJK input. Record which modes were exercised and any limitation in internal evidence.

Triage by impact: critical blocks the task; high requires a workaround; medium adds effort; low is cosmetic. Critical and high findings block an independent PASS. Record any accepted medium exception with rationale and owner.
