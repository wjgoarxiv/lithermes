# Motion guide

Use motion to explain hierarchy, state, or cause and effect. Name the page, components, implementation stack, and excluded areas before specifying choreography. Motion is optional; remove it when the surface communicates just as clearly without it.

## Motion brief

Record the following before implementation:

- **Stack and scope:** framework, styling system, animation package, icon set, tested version pins, and exact components in scope.
- **Tokens:** colors, spacing, font roles, numeric weights, and breakpoints. Give fluid display type a `clamp()` range, line-height, and system fallback.
- **Layers:** a short z-index map for page content, navigation, and overlays.
- **Responsive plan:** named content-driven breakpoints, including a separate mobile navigation when desktop navigation no longer fits.
- **Motion:** named curve, duration, trigger, moving elements, and reduced-motion result for each sequence.
- **Media and limits:** existing asset names, initial transfer budget, poster, fallback, lazy-loading point, and device conditions.

Use the page structure and dependency order, not scroll order, to organize the brief: stack and tokens; structure; media and fallbacks; navigation; content; interactions; dependencies and build configuration. Name files or components so implementation cannot invent unrelated sections.

## Curves, durations, and triggers

Use these named curves as defaults; keep values in tokens so the motion family can be adjusted without hunting through components.

| Token | Curve | Duration | Use |
| --- | --- | ---: | --- |
| `enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | 420 ms | Short composition or section entrance |
| `ui` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 180 ms | Hover, focus, and state feedback |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | 160 ms | Dismissal or removal |

Pair each duration with a named curve. Keep ordinary control feedback below 400 ms; use a longer duration only when progress remains apparent and the user can continue working.

For section reveals, trigger once when at least 15% of the section enters view, with a bottom root margin of 10%. If the observer is unavailable, show the content. A scroll-linked effect must declare its progress interval and output range; keep one dominant movement in the hero.

Stagger only a short, related group: `baseDelay + itemIndex × 60 ms`, capped at 300 ms. Do not stagger an article line by line or delay readable content.

## Per-section and frame budget

- One entrance sequence per section and no more than two simultaneously moving elements.
- One principal hero effect and at most one animated headline.
- Prefer `transform` and `opacity`; avoid per-frame `top`, `left`, `width`, and `height`.
- Keep animation work below 4 ms per frame when measured, leaving time for layout, paint, and input. Check a mid-range device; a desktop GPU is not a phone proxy.
- Keep controls usable while decoration runs. A 3D scene, cursor tracking, or carousel needs a separately named input path and frame/device budget.

## Media budgets and fallbacks

State the initial transfer budget. Defaults: no more than 1 MB compressed for initial motion media and 150 KB for a video poster. Lazy-load below-the-fold media, size images for their rendered box, and split optional motion code from the initial route.

Every background video has a real poster and a still-image fallback. On small screens, when data saving is enabled, or when playback is unavailable, do not download or autoplay the video; preserve the same message and contrast in the fallback. Group playback behavior together: muted, looping, inline, and autoplay only where allowed. Use an approved asset by its existing name; if none exists, request a real asset or specify a designed still. Never invent a media URL.

## Accessibility and input

Honor `prefers-reduced-motion`: show final content immediately, remove parallax and tilt, and shorten or remove nonessential transitions. Motion must not gate content, expose labels, indicate success by itself, or change keyboard reachability.

Restrict pointer tilt to fine-pointer devices, clamp rotation to ±4°, reset on pointer exit, and leave touch input alone. Compose tilt with other transforms instead of overwriting them. Do not request device orientation or require hover to reveal content.

Keep full headline text in the accessibility tree and readable before an animation package loads. Test with motion enabled, reduced motion, and media unavailable. Focus, keyboard operation, contrast, and reading order must remain complete in all three.

## Review checklist

- Are stack/version pins, scope, tokens, breakpoints, and layers explicit?
- Does each sequence have a named curve, duration, trigger, and reduced-motion behavior?
- Is section/hero motion within budget, with no hidden content on observer failure?
- Do media poster, mobile/data-saving fallback, lazy loading, and transfer limits work?
- Can a keyboard and screen-reader user complete the same task without motion?
