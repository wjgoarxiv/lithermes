# Visual reconstruction

Rebuild the supplied visual target as a live, semantic interface. A screenshot is evidence of one viewport at one moment; it does not define behavior, permission, source structure, or an entire brand.

## Keep evidence and inference separate

For each relevant region, record internally what is:

- **Observed:** directly measurable, such as dimensions, color, spacing, and visible text.
- **Inferred:** a plausible system with its basis, such as a spacing scale suggested by repeated gaps.
- **Unknown:** not visible, such as focus, hover, error state, scroll behavior, or content outside the crop.

Preserve the source dimensions and hash. Do not turn uncertain observations into reader-facing labels or claims. Resolve only unknowns that affect the requested build.

## Measure, then build real structure

Measure at the source pixel ratio. Sample flat color areas, not edges or gradient transitions; compare several gaps before inferring a spacing scale. Implement with semantic elements, grid/flow, reusable components, and live text. Do not position an entire page by screenshot coordinates or use the target image as the interface background.

For assets, recreate simple shapes and icons when appropriate; request photography, logos, and brand illustrations, or use a clearly neutral placeholder. Never redraw third-party marks or invent unknown chart data. If the target font is unavailable, choose a metric-compatible fallback, tune its supported font metrics, and record the substitution.

## Derive responsive behavior

A single target width cannot prove responsive behavior. Classify regions as fixed, fluid, reflowed, or conditionally hidden and mark those choices as inferred. Set breakpoints where content fails. Check the reference width, narrow and wide supported widths, longest real string, and CJK behavior when in scope.

## Compare and report

Capture the build at the target dimensions and compare important regions: bounds, type, spacing, color, radius, content, and state. Fix the largest measured deltas, then recapture. After three iterations with no improvement, stop and report the remaining mismatch plainly.

Use “pixel perfect” only when same-size captures cover every declared reference, all measured regions match, no placeholder or undeclared font remains, no material unknown affects rendering, and an independent reviewer passes the same revision and contract hash. Otherwise describe the result as a match at the measured regions. Keep observed/inferred/unknown detail in the internal review record.
