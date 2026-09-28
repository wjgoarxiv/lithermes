# Adaptive layout

Responsive behavior is part of the contract. Freeze supported conditions in `inventory.viewports` before choosing breakpoints; do not wait until the final CSS pass.

Use `accessibility.zoom_percent` for the supported zoom target.

## Inventory the conditions

Record conditions that change content, interaction, or layout:

- Viewport width and height; container width for components embedded in grids or sidebars.
- Text at 200% scale and the 320 CSS px equivalent at 400% zoom.
- Fine/coarse pointer and hover availability.
- Longest supported locale, including CJK line breaks and glyph widths.
- Forced-colors, contrast preference, and each declared theme.

For each condition, say what changes and why. A desktop screenshot alone is not responsive evidence.

## Break where content fails

Use content pressure, not device names, to set breakpoints. Prefer fluid constraints (`clamp()`, `minmax()`, container queries) before media queries. Name roughly 3–5 transitions by their behavior, such as `sidebar-collapse` or `table-to-cards`.

For each transformation choose one verb and record it in `direction.principles`:

- **reflow** — same elements, new flow axis.
- **stack** — columns become one column; DOM order stays intact.
- **collapse** — a visible group becomes a disclosure or menu.
- **reveal** — content appears once there is room.
- **defer** — secondary content moves below the fold or loads on demand.
- **substitute** — the form changes, such as table to cards.
- **bound** — overflow is confined or a truncated value has a reachable full form.

Rank content before layout: P0 required to complete the task, P1 required to decide, P2 context, P3 ornament. Drop P3 first, collapse P2, defer P1; provide a route to every hidden control. Never truncate P0.

## Type, spacing, and touch

Use one fluid scale rather than accumulating breakpoint overrides. Body prose has a 16 px floor; 14 px is for dense tabular data only. Set `clamp()` endpoints from the narrow and wide targets, with one fluid term between. Keep body line-height around 1.5 (1.6–1.75 for CJK) and display line-height around 1.2–1.3. Derive gaps from the product's spacing scale.

Design for the coarsest supported input: touch targets at least 44×44 CSS px with 8 px between neighbors; pointer targets at least 24×24 px with hit padding where needed. Every hover behavior needs a tap or focus route.

## Capture matrix

Capture declared widths at 320, 375, 768, 1024, 1440, and 1920 CSS px where they are within product scope. Include narrow/short height (320×568 and 1024×600), 200% text scale, 400% zoom, coarse pointer without hover, the longest string, and a CJK locale when supported. Add any `inventory.viewports` entries not covered above.

Tie captures to the current `design_contract_sha256`. If layout changes afterward, update the contract hash and recapture affected conditions.

## Reject

- Device-named breakpoints or a new breakpoint added to rescue one component.
- A hidden control with no equivalent route.
- Page-level horizontal scrolling or clipped text at a declared condition.
- Hover-only actions on a coarse-pointer surface.
- A single desktop capture offered as responsive proof.
