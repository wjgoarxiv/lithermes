# Redesign and behavior parity

A redesign changes appearance while preserving a working product's behavior. Capture the baseline before editing so every change can be judged against the same source revision.

## Freeze the baseline

For each affected route, capture relevant screens, states, viewports, themes, controls, validation, empty/error copy, keyboard order, and current performance. Keep originals immutable in the project's internal evidence area and identify them by source revision and capture hash.

## Inventory the change

Classify existing issues by user impact: token debt, structural semantics, missing states, inconsistent patterns, accessibility, or measured performance. Give each affected surface one verdict:

- **Preserve:** correct; leave it untouched and guard it.
- **Change:** keep structure/behavior while updating tokens or presentation.
- **Replace:** new internals, same external behavior and URL.
- **Remove:** name an owner, evidence of use, and redirect or replacement.

## Migrate in working slices

When tokens or primitives change, introduce compatibility values first, convert one low-risk route end to end, then migrate the remaining routes in priority order. Remove old aliases only when consumers are migrated. Keep each intermediate revision usable and send the complete affected surface to independent review.

## Verify parity

Compare before and after item by item:

- URLs, query parameters, and deep links.
- Fields, defaults, validation rules, and error meaning.
- Data exposure for each permission.
- Keyboard order, focus restoration, and shortcuts.
- Meaning of user-facing copy.

A clearer sentence may change wording; it may not change a product claim.

## Resolve disagreement and guard the result

Bound unresolved choices to two options and a short review round (two exchanges or 15 minutes). Record the selected option and why the other lost. If still tied, prefer the option that preserves more behavior.

Mechanically protect preserved surfaces. Capture-diff them at declared viewports; check contrast, focus, performance budgets, and CJK breaking where applicable. Close only when removals are resolved or have an owner/date and before/after captures are paired against the current contract hash.
