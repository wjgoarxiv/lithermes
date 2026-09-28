# Design-system foundations

Treat a design system as shared boundaries and a consumer inventory, not a folder of components. Record its token strategy and every delivered primitive in the Design Contract.

Record the reuse, extension, or creation choice in `direction.token_strategy`.

## Audit, then add

Before creating a primitive, locate existing components with the same rendered role, inspect their APIs and consumers, count current tokens, and list state/variant gaps. Extend the existing primitive when it fits; avoid parallel components without a specific reason.

Organize tokens in one direction:

1. **Foundation:** neutral raw values, such as space, radius, and palette steps.
2. **Semantic:** roles that refer to foundations, such as surface-raised or text-secondary.
3. **Component:** a named component property that refers to semantic roles.

A component should not reach into foundation values or embed raw color/spacing. Lint these boundaries where possible; record an owned exception with reason when a real constraint requires one.

## Specify the component contract

For each component, name anatomy, API/defaults, token dependencies, variants, and supported states: default, hover where available, focus-visible, active, disabled, loading, empty, error, and success. Stress short and longest real strings, CJK, zero items, and representative large collections. Unsupported combinations should be explicit.

A showcase route is useful when the deliverable is a reusable system or many variants need coordinated review. Include theme, density, text scale, and reduced-motion controls; do not make it a prerequisite for an unrelated feature.

## Themes and existing APIs

Themes should change semantic roles, not component internals. Dark mode needs its own contrast measurements. Forced-colors mode should retain visible boundaries and state without relying on background color alone.

In brownfield work, preserve token names, props, defaults, and consumer rendering. Put new variants behind existing APIs; enumerate consumers before a rename. For a shipped plugin asset, follow the payload sync and isolated-install/doctor procedure after editing.

## Reject

- A token with no consumer or an unnamed component token.
- A component using raw values instead of semantic roles.
- A second primitive that duplicates an existing job without a migration reason.
- A delivered control missing focus, disabled, loading, or failure states.
- A theme that forks component internals rather than semantic roles.
