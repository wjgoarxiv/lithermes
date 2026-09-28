# Performance and delivery

Set measurable targets in the performance contract before styling is finished. Treat the values below as web-route starting budgets; adapt them to the product's devices and service level, and record any deviation before measuring.

Record agreed thresholds in `performance.lcp_ms`, `performance.cls`, and `performance.inp_ms`.

## Starting budgets

- At p75 on the slowest supported device: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1.
- TTFB ≤800 ms; usable interaction ≤3.5 s at 4× CPU throttle and 1.6 Mbps.
- Route transfer ≤500 KB compressed: target ≤170 KB script, ≤60 KB styles, ≤200 KB above-fold imagery.
- Use at most two font families and four files, each ≤40 KB WOFF2; subset for supported locales.
- At 60 Hz, keep frame work within 16.7 ms; no task over 50 ms and blocking under 300 ms per route.

## Diagnose before optimizing

Measure cold and warm loads through largest paint and first input. Record the blocking resource and test likely causes: render-blocking scripts/styles, undiscoverable or lazy LCP imagery, delayed fonts, sequential fetches, layout read/write loops, full-list mount, non-async third-party tags, or unnecessary full-document hydration.

Ship correctly sized media: AVIF with WebP fallback where supported; cap raster width near 2× the largest rendered CSS box; set intrinsic dimensions or aspect ratio; lazy-load below-fold images only; prioritize the LCP image. Split code by route and interaction; load charts, editors, and animation only where needed. Prefer server-rendered static content with focused hydration when the route allows it.

Virtualize only after measurement (around 200 rows or 2,000 nodes is a starting point). Preserve find-in-page and anchors where possible; variable-height lists need a measurement strategy, and accessible virtual tables need row-count and row-index metadata.

## Perceived speed

Acknowledge an action within 100 ms even if completion takes longer. Keep progress near the affected control, preserve final geometry while loading, and never add artificial delay to hide slow work.

## Audit and decision

For each route, record revision, viewport, pixel ratio, theme, device, throttle, cold/warm run, core metrics, resource bytes, longest task, and element count. Compare each measured value with its contract budget. Fix the highest-impact cause, rerun, and choose:

- **SHIP:** all agreed budgets pass.
- **OPTIMIZE:** name the breached budget, cause, and owner.
- **RESCOPE:** the requested design cannot meet the budget as stated.
- **EXCEPTION:** record rationale, owner, expiry, and evidence internally.

Do not report warm-cache laptop numbers as field p75, call an unmeasured bundle optimized, virtualize a small list without evidence, or edit the target to match a failing build.
