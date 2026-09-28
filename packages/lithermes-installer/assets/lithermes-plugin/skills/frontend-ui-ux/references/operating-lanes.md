# Operating lanes

Select one lane from the product on disk before editing and record it in the Design Contract. These lanes describe change scope; they do not grant repository or host permission. See production.md for request mode and authorization.

The selected lane is the contract's `lane` value.

| Lane | Choose when | Inspect first | Preserve | Exit check |
| --- | --- | --- | --- | --- |
| New-build | No routes, tokens, or components exist | Tasks, audience, stack, platform, locales, inventory | Declared scope and stack | Contract states exist; every inventory item is rendered and reviewed |
| Brownfield | Add or repair a surface in a working product | Token file, neighboring components, spacing and import conventions | Existing APIs, untouched routes, names | Change fits the current system; untouched surfaces still render |
| Redesign | Change appearance or flow of a working surface | Baseline captures, controls, states, behavior, performance | URLs, fields, validation, permissions, focus order, meaning | Parity holds against the baseline |
| Reference-fidelity | A supplied target governs named visual regions | Source files, dimensions, hashes, classified regions | Semantics, live component tree, keyboard and screen-reader behavior | Same-size region review plus live implementation |
| Design-system | Deliver reusable primitives consumed elsewhere | Every consumer, variant, state, and current API | Existing props, tokens, and consumer output | Consumers pass or have an owned migration |

## Behavioral acceptance

For a new or changed UI, list each requested behavior separately and map it to a visible control or state before building. Keep functionality distinct from visual polish. Give every data graphic a meaningful accessible name. For tabular records with requested search, filtering, or pagination, use semantic, operable controls and verify that each changes the displayed results. In a rendered browser, exercise every requested interaction at the target viewports and inspect the resulting state; report only checks actually run.

A component set may contain multiple runtime lanes; record and apply each where it governs. For requests spanning change lanes, sequence them: design-system first, then brownfield/redesign, then reference-fidelity. Close one lane and update its contract baseline before starting the next. If the order materially changes the result, ask.

For a plugin-asset change, follow the product's payload sync and doctor procedure in an isolated Hermes home, never a real user home, before calling the lane complete.
