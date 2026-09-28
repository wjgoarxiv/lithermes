# Stage path

The stage path is for every film that shows things: a drawn subject, shapes,
diagrams, charts, illustration or interface, and every 9:16 film. You author a
page; this skill's renderer captures it frame by frame on a virtual clock,
encodes it with the pinned encode, muxes the sound and runs the gate. Every
frame passes through that renderer. A hand-encoded film (a PIL frame loop, a
raw ffmpeg filter graph, a screen recording, a raster flipbook) is not the
deliverable.

## What you write

- `DIR/treatment.json` (`treatment.md`) with `path: stage`.
- `DIR/stage/index.html` and its local assets: SVG, PNG, JPG, WebP, JS, CSS,
  JSON and WAV files inside `DIR/stage/`.

Never install, download or copy a third-party library into the stage dir. Use
the kit below and your own code. Rasters are textures and stills, never a frame
sequence: at most 24 raster images and 8 MB in total; 10 or more rasters of the
same size (a flipbook), or any animated GIF, APNG or WebP, is exit 17.

Put all on-screen copy in one `COPY` object at the top of `stage/index.html`,
so the copy is easy to find and edit:

```text
const COPY = { title: "<line>", steps: ["<line>", "<line>"], close: "<line>" };
```

## The page contract

The page loads the kit and the fonts from the renderer's own routes, and then
declares the film:

```text
<link rel="stylesheet" href="/lit/fonts.css">
<script src="/lit/stage-kit.js"></script>
<script>
  LitStage.define({ width: 1920, height: 1080, fps: 60, duration: <seconds>, render(t) { /* draw the frame at t */ } });
</script>
```

- `width` and `height` equal the treatment's format: 1920×1080 for 16:9,
  1080×1920 for 9:16. `duration` is the treatment's `durationSec`; the render
  must land within ±10 % of it.
- `fps` is 60. Use 30 only when the treatment says so.
- `render(t)` draws the frame at time `t` in seconds. It may be omitted when
  the page animates only with CSS or the Web Animations API.
- Setting `window.litStage` to the same object is equivalent to calling
  `LitStage.define`.

The page may also use CSS animations and transitions, the Web Animations API,
SVG SMIL and `requestAnimationFrame` with Canvas2D or WebGL. The renderer drives
all of them from one virtual clock.

Forbidden, each exit 17 naming the element or API: `<video>`, `<audio>`,
`<iframe>`, `<object>`, `<embed>`, `<frame>`; `new Audio()`, `AudioContext`,
`OfflineAudioContext`; `Worker`, `SharedWorker`, service workers. `WebSocket`,
`WebTransport` and `RTCPeerConnection` are network requests: exit 19. Sound
belongs in the treatment, not in the page.

Network: the page is served from a synthetic origin, `http://lit.stage/`,
without a listening socket. Any request outside it fails the run with exit 19,
and so does an absolute `http(s)://` or protocol-relative URL, or a preconnect
or prefetch link, anywhere in the stage files.

### Fonts

`/lit/fonts.css` declares this product's verified faces with
`font-display: block`, served from the pre-warmed cache and the reused lit-pptx
Pretendard pair: `Pretendard` (400, 700), `Archivo` (500, 700, 900 at
`font-stretch` 75 %, 100 %, 125 %), `Galmuri9`, `VT323`, `Silkscreen` (400,
700) and `MesloLGS NF`. Use Pretendard for Hangul. Any other family falls back
to a system face; the QA reports it and fails it on copy.

### Text the QA can read

- HTML and SVG text is found automatically. Mark text that is part of a drawn
  subject (a label on a drawn jar, a number on a drawn clock) as decor:
  `LitStage.text(el, { decor: true })`. Decor text is exempt from title-safe
  and reading-floor checks, may not carry a copy line, and may not exceed 25 %
  of the visible text area.
- Canvas and WebGL text is invisible to the QA unless you register it every
  frame you draw it: `LitStage.text({ content, x, y, w, h })`. Unregistered
  canvas text is reported as "canvas text not measured".

## The kit

`/lit/stage-kit.js` is this skill's own code: motion primitives only, no
scenes, no objects, no layouts, no copy. `window.LitStage` holds:

- **Eases.** `LitStage.ease.outCubic(p)` and the rest of the named set
  (`linear`, `inSine`/`outSine`/`inOutSine`, `inQuad`…`inOutQuart`,
  `inExpo`/`outExpo`/`inOutExpo`, `inBack`/`outBack`/`inOutBack`), plus
  `LitStage.bezier(x1, y1, x2, y2)` for a CSS-style cubic-bezier.

  ```text
  const lift = LitStage.bezier(0.2, 0.8, 0.2, 1)(p);
  ```

- **Spring.** An analytic damped spring, a pure function of time:

  ```text
  const s = LitStage.spring({ from: 0, to: 1, stiffness: 180, damping: 18 });
  el.style.transform = `scale(${s(t - 1.5)})`;
  ```

- **Keyframes.** `LitStage.kf(t, keys)` interpolates numbers or number arrays,
  with an optional ease per segment:

  ```text
  const [x, y] = LitStage.kf(t, [{ t: 0, v: [0, 40] }, { t: 1.2, v: [320, 0], ease: "outCubic" }]);
  ```

- **Timing.** `LitStage.at(t, start, dur, ease)` returns the eased progress of
  a window, clamped to 0–1. `LitStage.stagger(i, { each, from })` returns the
  start offset of item `i`. `LitStage.seq(t, [d0, d1, ...])` returns
  `{ index, p }` for back-to-back segments.

  ```text
  items.forEach((el, i) => { el.style.opacity = LitStage.at(t, 2 + LitStage.stagger(i, { each: 0.08 }), 0.4, "outQuad"); });
  ```

- **Seeded randomness.** `LitStage.rand(seed)` returns a deterministic
  generator; `Math.random` is also seeded from the treatment by the renderer.

  ```text
  const r = LitStage.rand(7); const dots = Array.from({ length: 40 }, () => [r() * 1920, r() * 1080]);
  ```

- **Splitting text.** `LitStage.splitText(el, { by: "grapheme" | "word" })`
  wraps each grapheme, or each word (어절 for Hangul), in a span and returns
  them. It uses `Intl.Segmenter`, so a Hangul syllable is never split.

  ```text
  LitStage.splitText(title, { by: "word" }).forEach((w, i) => w.style.opacity = LitStage.at(t, i * 0.12, 0.3));
  ```

- **Path draw.** `LitStage.drawPath(pathEl, p)` reveals an SVG path from its
  start by stroke dash.

  ```text
  LitStage.drawPath(outline, LitStage.at(t, 0.5, 1.6, "inOutSine"));
  ```

- **Morph.** `LitStage.morph(fromD, toD)` returns `p => d` for two
  single-subpath shapes: both are normalized to cubics, resampled by arc length
  and aligned at the best rotation. Multi-subpath morphs are not supported;
  split them into single paths.

  ```text
  const m = LitStage.morph(bud.getAttribute("d"), bloom.getAttribute("d")); shape.setAttribute("d", m(p));
  ```

- **Masks and clips.** `LitStage.clipInset(el, p, "left" | "right" | "top" |
  "bottom")` wipes an element in; `LitStage.clipCircle(el, p, cx, cy)` opens
  an iris; `LitStage.maskWipe(el, p, angleDeg, softPx)` sweeps a soft gradient
  mask.

  ```text
  LitStage.clipCircle(scene2, LitStage.at(t, 6, 0.8, "inOutCubic"), "50%", "60%");
  ```

- **Colour.** `LitStage.mix("#0f3b4c", "#f2c14e", p)` returns an `rgb()`
  string.

- **Text registration.** `LitStage.text(el, { decor: true })` and
  `LitStage.text({ content, x, y, w, h })`, above.

## How the capture works

The renderer serves the page to a software-rendered Chrome (SwiftShader, CPU
raster, no GPU rung), so any difference between two captures is a page leak,
not a driver. An init script replaces `Date`, `performance.now`, `setTimeout`,
`setInterval`, `requestAnimationFrame`, `requestIdleCallback`,
`document.timeline.currentTime` and `Math.random` with a virtual clock and a
seeded generator.

Before frame 0 it loads every face in `fonts.css` and decodes every image.
For each frame `f` it sets `t = f / fps` (computed, never accumulated), seeks
every running animation to its own time, runs due timers and animation-frame
callbacks, calls `render(t)`, pauses and records any animation that appeared,
waits for fonts and images, lets Chrome paint twice, and captures exactly
`width × height` pixels. The pixels go straight into the pinned H.264 encode.

What this means for you:

- Drive motion from `t`, CSS or WAAPI. Never from wall-clock time.
- `performance.timeOrigin` and `crypto.getRandomValues` are not virtualized.
  A frame that depends on them differs between two captures: exit 18.
- A CSS transition started at `t` runs on the virtual clock like any other
  animation; a `finished.then(...)` chain continues on it.

A full render records per-frame timing (p50, p95, total) in the manifest.
Long films take minutes: give the command a timeout of at least 600 s, or run
it with `--detach` and poll `DIR/.run/progress.json` and `DIR/run-state.json`.
Never shorten the film to save render time.

## Determinism

After the film, the renderer re-captures 8 to 16 sample frames (frame 0, the
last frame, the first frame of every beat, then beat midpoints) in a fresh
Chrome that replays the clock from 0, and compares the SHA-256 of the decoded
pixels. A mismatch is exit 18, naming the frame and the first differing region.

## Text QA

A separate replay reads every visible text run (the nearest `LitStage.text`
element, otherwise the nearest block; `::before` and `::after` content; and
registered canvas text). At every beat midpoint, plus two settled frames per
beat, it captures the frame, hides only the text fill, captures again, and
takes the difference as the ink. Contrast uses the worst pairing of median ink
against the dark and light ends of the ground in the text box grown by a quarter
of the cap height, so a scrim behind type must reach past that margin. Only
settled text is judged: its box moved less than 2 px since the previous probe
and its opacity is at least 0.95. The samples sit at every beat's midpoint and
at 35 % and 80 % of it; runs are also read every 1/10 s for the reading floor
and the copy-found check. A run counts as visible at opacity 0.6 or more, on
screen after clipping, with at least 12 ink pixels at a sample. Registered
canvas text cannot be hidden, so its ink is the pixels in its box that stand
apart from the box's edge.

| Check | Copy text | Decor text |
|---|---|---|
| Contrast (3.0 large, 4.5 body; large is at least 3 % of the short side) | FAIL | WARN |
| Title-safe (inside the central 90 % of the frame) | FAIL | exempt |
| Reading floor (on screen at least as long as the line takes to read) | FAIL | exempt |

Also checked:

- Every `copy.lines` entry must appear on screen: exit 17 quoting the line.
- WARN, and the look must answer it: text that equals or contains the request,
  the idea, a file name or an internal term; canvas text not measured; a
  sample where something other than text moved; less than half of the beat
  midpoints showing any non-text image.
- Fonts outside the verified set: WARN, FAIL on copy.

## Stage gate

`$M gate --out DIR` re-measures the exports and the sound and rewrites the
report without touching `manifest.json`, so a recorded look round stays valid
and the viewed count carries over.

| Rule | What fails |
|---|---|
| MO-C-03 | more than 3 general or 3 red flashes in any 1 s window (the grid turns for 9:16) |
| MO-C-09 | a sample frame that differs in a fresh replay (exit 18) |
| MO-C-10 | a film that is not exactly 1920×1080 or 1080×1920 as the format says |
| MO-C-11 | tags other than yuv420p, bt709, tv, or under 30 fps |
| MO-C-12 | a length more than 10 % from `durationSec` |
| MO-C-13 | a preview over 3 MB or a poster over 1 MB |
| MO-C-14 | a reduced-motion still (the final beat's midpoint) with no ink |
| MO-D-03 | an empty, near-black run longer than 2.4 s (1 s more at either end of the film) |
| text rules | the Text QA table above |
| sound | a missing stream, a length more than 0.1 s off, a peak over −0.5 dBFS, or (generated beds) a silence over 1.5 s in the first 3 s |

## Effects and determinism

`filter: blur()`, `backdrop-filter`, `mix-blend-mode`, `box-shadow`, SVG
`feGaussianBlur`, Canvas2D `shadowBlur` and WebGL shaders all capture the same
way twice on the software renderer. A WebGL context needs the software GL;
without it the stage exits 11.
