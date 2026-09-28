---
description: Minimum-first build decision gate applied before writing new code.
alwaysApply: true
---

# Build decision gate

Before writing a new abstraction, ask in order:

1. Does this work need to exist at all? Delete the requirement before building it.
2. Does the repository already do this? Reuse beats re-implementation.
3. Does the standard library or a native Hermes surface already do this? Prefer it
   over a hand-rolled version and over a new dependency.
4. Is one clear line enough? Prefer it to a configurable helper.

Minimum-first constrains how much code each item costs. It never licenses
delivering less of the request than was asked for: the smallest *complete*
solution still includes the shared helpers, validation, security, accessibility,
realistic error handling, and regression tests the criteria require.
