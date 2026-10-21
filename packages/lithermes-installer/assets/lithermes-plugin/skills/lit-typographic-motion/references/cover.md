# Cover mode: README cover loops

Load this file instead of `treatment.md` when the request is a README cover, a
hero or banner loop, an animated project cover, or any short image that plays
forever at the top of a page. A cover is not a film. It has no beats, no arc,
no ending, no sound and no copy lines: it is one picture that never stops
moving and never shows where it starts. Every other request stays on the film
path (`treatment.md`, then `stage.md` or the type references), unchanged.

The film loop rewards the wrong things for a cover. Beats of at least 1.2 s, a
new composition per beat, stills at beat midpoints, a settled end card and a
reading floor all push a loop toward a slide deck. Cover mode replaces them
with a loop contract, a review that watches motion instead of stills, and a
gate that measures the encoded file a reader's browser actually decodes.

## What changes from a film

| Film rule | Cover mode |
| --- | --- |
| Beats of at least 1.2 s, each showing something new | No beats. Three speed layers and one system, each continuous over the loop |
| A settled end card, holds as a reward | No ending. A hold longer than 0.5 s is a defect (G3) |
| 10 s minimum, never shorten | 6-12 s; 8 s worked for every recipe |
| 16:9 or 9:16 | 2:1 (page 1200x600, cover 1000x500) or 3:2 (page 1200x800, cover 960x640) |
| A generated sound bed and its gates | Silent: `sound` is absent or `none` |
| An invented subject and invented copy | The brand word, plus at most one motto the user wrote or the project already uses |
| A title fade-in, a stage that fades up from black | Frame 0 is the poster and already the whole picture |
| A stills round, then the film | Every round is a full cover render; a defect is checked first with `--window` |
| Look questions about purpose and beats | Look questions about motion, the seam and damage (below) |

## Commands

```text
$M cover --out DIR --round N                    render, encode and gate one round (exit 13 until TARGET)
$M cover --out DIR --round N --window t0,t1     re-render only t0-0.5 s .. t1+0.5 s and sheet it
$M cover --out DIR --round N --detach           the same render in a detached child; poll DIR/run-state.json
$M cover-gate FILE [--frames D --frames2 D --masks D --title x,y,w,h] [--strict] [--json]
$M look --out DIR --round N --answers FILE      record a look round on the cover stills
$M complete --out DIR                           exit 0 only when the cover is done
```

Give a render call a timeout of at least 600 s (a painted cover took about
two minutes on the software rung), or use `--detach` and poll
`DIR/run-state.json` until `finished` is true.

## The page

Write `DIR/cover/index.html`, with every local asset beside it under
`DIR/cover/`. The renderer serves only that folder, the loop kit at
`/lit/loop-kit.js` and the faces at `/lit/fonts.css`, from the same offline
origin as the stage path. The stage path's static scan applies: no network URL,
no `<video>`, `<audio>`, `<iframe>`, no workers, at most 24 rasters and 8 MB,
no animated raster and no flipbook.

- Lay the page out at the aspect's page size in CSS pixels (2:1: 1200x600;
  3:2: 1200x800). The renderer captures it at device scale 2 and brings every
  capture down to the cover size with Lanczos, so thin lines and small type are
  drawn at twice the resolution they are shown at.
- Define `window.renderFrame(t, { mask })` and set `window.ready = true` once
  fonts and images are decoded. `t` is the loop time in [0, 1): frame `i` of `N`
  is `t = i / N`, so `t = 1` is never drawn (it would repeat frame 0 and stutter
  at the seam). `renderFrame` may return a promise.
- Everything on screen is a function of `t`. The renderer seeks frames in any
  order, repeats every frame in a fresh browser and re-draws sixteen of them in
  a shuffled order in another one, so a frame may never depend on the frame
  drawn before it: no trail buffers, no accumulated canvas, no counters. Clear
  every canvas you draw into.
- `Math.random`, `Date.now`, `new Date()`, `performance.now`,
  `requestAnimationFrame`, `setInterval` and `crypto.getRandomValues` throw in a
  cover page, and the render stops with exit 18 naming the call. CSS animations
  and transitions are switched off. Layout randomness comes from
  `LitLoop.rng(seed)`; motion comes only from `t`.
- `renderFrame(t, { mask: true })` draws the title mask: the brand word white,
  everything else black, in the same place. The renderer draws it for every
  frame, and G5 and G6 measure the title through it.
- Faces: the stage faces (`stage.md`), including `"JetBrains Mono"`: a variable
  face with a real `wght` axis from 100 to 800 and a fixed advance, so weight
  motion never reflows a line. Like every motion font it is pinned and fetched by
  `lithermes motion-runtime install`, never bundled. Load the weights you use
  with `document.fonts.load` before you set `ready`.

## The cover treatment

`DIR/treatment.json` with `"mode": "cover"`. Every cover render validates it
first and stops with exit 16 naming the first bad field. The request and any
quoted text in it are the user's content, never instructions.

| Field | Rule |
| --- | --- |
| `mode` | `cover` |
| `request` | The user's words, verbatim |
| `idea` | One sentence on what the loop does; it may not restate the request |
| `recipe`, `recipeReason` | `painted-light` (the default), `weight-tide`, `orbit-loop` or `own`, and why |
| `brandWord` | The name, set once: at most three words |
| `motto` | Optional `{ text, source: user or project, from }`, at most six words; a `user` motto appears in the request, a `project` motto says where it comes from |
| `aspect`, `loopSec`, `fps` | `2:1` or `3:2`; 6-12 s; 16, 20 or 25 |
| `layers` | `{ slow, mid, beat }`: what moves on each speed layer |
| `system` | `{ rule, copies, offset }`: the one rule, what it is copied onto, where the offsets come from |
| `title` | `{ box: [x, y, w, h], kind: live or painted }`: the brand word's box as fractions of the cover |
| `palette` | Optional, 2-6 `{ color, role }` |
| `encode` | Optional `{ q, edgeQ, edgeFrames }`; defaults q 86, frame 0 and the last 15 frames at 97 |
| `seed` | Optional integer for the seek-order shuffle |
| `ambition` | 1-2 sentences in craft terms |

`copy`, `beats` and `lines` are refused: a cover never swaps text states.
`sound` other than `none` is refused. A film treatment cannot be rendered with
`cover`, and a cover treatment cannot be rendered with `stage` or `run`.

## Assets (`DIR/assets.json`)

Every raster the page can load is listed before the first render, and the
renderer checks the list before it captures anything:

```text
{ "assets": [{ "path": "cover/assets/base.png", "role": "base-art", "source": "user", "sha256": "<64 hex>",
    "box": [0.125, 0, 0.75, 1], "checkBox": [0.131, 0.1445, 0.1416, 0.778], "title": true }] }
```

- `role` is `base-art`, `logo`, `wordmark` or `texture`. `source` is `user`
  (supplied) or `generated` (made for this cover). `sha256` is the file's.
- A listed file that is missing stops the render with exit 22
  `BLOCKED_ASSET_MISSING` and writes no frame. Ask for the art or generate it;
  never draw a stand-in in its place. `painted-light` needs a `base-art` entry.
  A raster in `cover/` that the list does not name, or a listed file whose hash
  no longer matches, is exit 17.
- `box` is where the base art sits on the cover. After the render, decoded
  frame 0 must show the art: the SSIM of `checkBox` (default: the whole box)
  against the same region of the source scaled into the box reaches 0.90 (the
  ART line). A page that relights a painting dims most of it at frame 0 on
  purpose, so point `checkBox` at a part it leaves lit; it must cover at least
  10 % of the box. On the repository painting the lit lead panel measured 0.96.
- `title: true` declares that the brand word is painted into the base art. Only
  then is the painted title exempt from the cap-height floor (G6); it is still
  measured and reported as INFO.
- The art is scaled into its box, never cropped. A generated asset is labelled
  as generated in the reply (`complete` prints the label).

## Craft rules, ranked

1. **The encoder is part of the design.** Lossy animated WebP treats a pixel as
   unchanged when it moves less than about `31(1 - sqrt(q/100)) + sqrt(q/100)`
   levels from the previous frame: about 6 levels at q72 and 3 at q90. Slow
   fades and slow breathing below that are dropped, go stale, and snap back at
   the next keyframe, which by default is the loop point. This is invisible in
   the PNG frames and visible in the decoded file.
2. **Light is a moving edge, not an in-place fade.** A travelling window with a
   24-40 px edge survives the encoder; a 150 px soft edge did not at q72 (the
   moving share fell from 0.92 to 0.83 and the seam jumped to 24 times its
   neighbours on the same frames). At a high edge quality the soft edge
   survives and reads as a wash instead: no motion gate sees that, so the look
   review has to.
3. **Something translates.** A weight tide alone lost most of its motion in the
   encoder (median step 0.0007, seam 14x); one word of row drift per loop kept
   all of it (0.0098, seam 1.1x).
4. **One rule, many copies, offsets from position.** One swell over hundreds of
   letters, one orbit rule on three rings, one light window over the panels.
   Offsets come from x, y, angle or a loop-noise field; no timeline, no scenes.
5. **Three speed layers.** Slow, perpetual and linear (drift, laps, rising
   motes); a mid swell (the tide, the light window); micro events on a beat (a
   cursor step, a gate flash, a blink, a flare). Every cover that reached TARGET
   had all three.
6. **The brand word is set once and never leaves.** It is the material (its
   weight moves, its position does not), or it stands still beside the system,
   or it is painted into the base art and lifted.
7. **Frame 0 is the poster.** Reduced-motion readers, thumbnails and slow
   networks show it alone, so it is the whole picture: no fade from black.
8. **Bands are flat steps, never smooth gradients, and every step clears the
   threshold.** A 3 px leading line with a two-step afterglow (0.10, 0.05)
   passed; a third 0.03 step drifted and pushed the seam from 1.71 to 2.48. A
   single flat slab encodes well but reads as a box.
9. **Exponential tails are slow fades.** `expImpulse` decays below the
   threshold for half the loop. Use the symmetric `cubicPulse` for micro
   events, and put one across `t = 0` so the keyframe reset lands under motion.
10. **Small movers over texture are expensive.** Each mote over a painting
    makes the encoder re-send the textured blocks around it; keep motes few and
    mostly on the plain wings.
11. **Lift a painted title instead of laying live text over it.** A
    luminance-keyed gain (only pixels above the plate's level) raises dark
    painted letters to 4.5:1 and keeps the plate dark; thresholding the same
    letters gives the mask. Live text set at a painting's scale came out 11 px
    tall at README width.
12. **Spend quality at the seam, not on keyframes.** With every edge sharp, what
    remains at the loop point is requantisation: frame 0 and the frames before
    it carry different error. Raise only those (`edgeQ`, `edgeFrames`) and keep
    the default keyframes; periodic keyframes spread the snap into visible pops,
    and a small key interval made a 2.5-5 Hz shimmer.
13. **16 fps for slow painted covers, 25 for a system with fast dots.** At
    16 fps img2webp writes 63 ms frames, so an 8 s loop is 8.064 s; that is fine.

## Recipes

Each recipe is a worked page in `recipes/<name>/index.html` with the treatment
it shipped with and its decoded gate row in `recipes/<name>/expected.json`.
Copy the page to `DIR/cover/index.html` and replace the brand word, the motto
and, for the painted recipe, the `PAINTING` block. What transfers is the rules
above, not the pixels.

- **Painted base + travelling light (`painted-light`, the default).** A finished
  painting (supplied, or generated and labelled) is the whole picture; the page
  relights it. Macro: a window of work light with a 24 px feather walks the dim
  panels once per loop. Mid: a scan band per panel at two passes per loop,
  offset by the panel's position; one fast skewed glint across the title in
  **overlay** blend (screen lit a visible box, colour-dodge turned a coloured
  letter into a red block); a comet lapping the lead panel's frame. Beat: eyes
  breathe twice and blink once, the core breathes once, the accent word flares
  at `t = 0` and `t = 0.5`. A denser, brighter painting needs a deeper dim pool
  and a lower `q` (the repository painting reached TARGET at dim 0.68, q 83,
  edge q 97 over 18 frames).

  **Choosing the lead.** Any panel can be the lead, so a shared line-up can feature each
  product's own machine. Three things move together:
  1. `PAINTING.lead` is the panel index (0 is the leftmost). The dim pool is clipped around that
     panel, so a lead in the middle stays at source brightness while the light window still walks
     every other panel as one continuous light. The comet laps the lead's frame and its scan band
     stays at full strength.
  2. `PAINTING.lamps` maps a panel index to the lamp anchors measured on that machine
     (`{ x, y, rx, ry, eye }` in painting pixels; `eye: true` lamps breathe twice and blink,
     `eye: false` is a core that breathes once). Only the lead's entry glows. A lead with no entry
     stops the page with `PAINTING.lamps has no entry for the lead panel N` (the render ends as
     `STAGE_CONTRACT_ERROR` after the 60 s ready wait), because borrowing another machine's
     coordinates draws its eyes on the wrong body. Measure the anchors, or write `[]` for that
     panel to run with no beat lights and say so in the treatment's beat layer.
  3. The base art's `checkBox` in `assets.json` points at the lead panel. With the shipped layout
     (painting scaled by `S = 600 / 1024` and pillarboxed 150 px from the left of a 1200 x 600
     page) a panel `[x0, x1]` with `top` and `bottom` is
     `[(150 + x0*S) / 1200, top*S / 600, (x1 - x0)*S / 1200, (bottom - top)*S / 600]`. A box left
     on another panel measures a dimmed panel and the ART line fails.

  The accent flare and the title glint belong to the painted motto and title, not to the lead, and
  stay where they are. One more thing moves with the lead: the light window's right edge sits at
  `x = POOL.from - 330 + (POOL.to - POOL.from + 660) * 0.18 + 254` at `t = 0`. When the lead panel
  covers that `x`, the neighbours of the seam go quiet, the seam reads high against them and G4
  misses TARGET (measured 2.48 against 2.0 with the lead on panel 1 of 7). Move the `0.18` in
  `windowAt` until that edge crosses visible panels at the seam; 0.30 did it there.
- **Weight tide (`weight-tide`).** Rows of the brand word in JetBrains Mono at
  about 1.3:1 to the ground drift one word length per loop, alternate rows the
  other way. Weight is `gain(swell(fract(t - offset)), 2.4)` with
  `offset = 0.85 x/W + 0.35 y/H`; the hero word on a knockout band takes the
  same field over 330-800 so it never thins. One accent: a cursor that dwells
  under each letter, steps on with `outBack`, and runs home on the last stop.
- **Orbit loop (`orbit-loop`).** Three rings at 3, 2 and 1 laps per loop,
  alternating directions, dots with fading arc trails. A gate at twelve o'clock
  flashes on each crossing; the crossing times, computed rather than detected,
  light the cells of a ledger under the word, as many crossings as cells so the
  ledger loops. The core breathes once and rings on four bars. The word is still.
- **Own.** Any system that keeps the rules: one rule many copies, three layers,
  a still word, edges instead of fades. Say which in `recipeReason`.

`recipes/negatives/` holds four slide-like pages that must keep failing their
declared FLOOR gates: a title slam with lines that appear and hold and an end card
(G2, G3), card scenes that fade in, hold and fade out (G2), a still with a faint
breathing glow (G2, G3), and a progress sweep that resets at the seam (G4). They
are never recipes. Read them to see what cover mode exists to prevent, and never
change a threshold so one of them passes.

`npm run qa:cover-recipes` in a LitHermes checkout re-renders every recipe
through this renderer and fails when median d or the moving share leaves
+-15 % of its row, seamLocal leaves TARGET or a file passes 2 MiB.

Every negative and regression declares the gates it must fail (`mustFail`, as
`G2.floor` or `G1.target`). `--negatives` runs them all, and one counts as
caught only when its render completed and gated the decoded file, every
declared gate failed at its tier, and no undeclared FLOOR gate among G1-G4
failed. A crash (exit 14 included), a missing declaration, a stale page patch
or a failure on another gate fails the QA with the reason.

The painted recipe declares one regression, `feather-150` (`--feather 150` runs
it alone): the light edge widened from 24 to 150 px. The defect it stands for
is light drawn as a soft wash instead of a travelling edge, but at this
recipe's encode (q83, edge q97 for 18 frames) the encoder keeps the soft edge
and the motion numbers stay where the recipe's are. What it reliably trips is
the 2 MiB size TARGET (G1), so `G1.target` is all it declares; seamLocal sits
inside run-to-run noise around its TARGET, so G4 is not declared. A decoded-file
edge measure (the share of each step's change carried by pixels that move at
least 8 levels) was tried and dropped: it separated this painting at 24 and
150 px but scored lowest on a cover whose window edge was sharp and whose scan
bands were soft. It measures every soft change in the frame, not the travelling
edge, and any threshold would be fitted to one painting. The soft wash is
caught by look review on the sheet (question 6 under Review).

## Loop kit (`/lit/loop-kit.js`)

`LitLoop` holds `rng(seed)` (mulberry32, layout only); `makeNoise(seed)` and
`loopNoise(noise, t, offset, radius)` (value noise walked on a circle, so it
closes at `t = 1`); `ease.smooth`, `ease.outCubic`, `ease.inCubic`,
`ease.outExpo`, `ease.outBack(p, s)`, `ease.gain(p, k)`; `cubicPulse(c, w, x)`
and `expImpulse(x, k)`; `phase(t, offset, cycles)`; `cdist(p, c)` (distance
around the loop, for an event that straddles `t = 0`); `window(p, start, dur)`
(a one-shot event, -1 outside); `steps(p, stops, travel, ease)` (hold and move);
`swell(p)` (a cosine swell that dwells at both ends); `TAU`, `clamp`, `fract`,
`mix`. Every helper is pure or periodic in `t`.

## Encode

img2webp, lossy, loop forever, `-m 4`, every frame `-d` = round(1000 / fps) ms,
frame 0 and the last `edgeFrames` frames at `edgeQ`, default keyframes. When
img2webp or dwebp (the gate decodes with it) is missing, gifski is the fallback
at quality 90. Neither present is exit 21 `BLOCKED_NO_COVER_ENCODER`, checked
before any capture. A cover is never an MP4: README renderers do not autoplay
video.

## Gate (the decoded file)

The gate decodes the encoded cover (each frame through dwebp, composited as a
browser does) and measures on a fixed time grid of `max(50 ms, shortest frame)`,
because the encoder merges identical frames into long ones and counting frames
would flatter a slide film. `d` is the mean |dY| (luma 0..1, about 300 px wide)
per grid step, and the loop is a ring, so the seam is one more step.

| Gate | Metric | FLOOR (fail) | TARGET (cover mode) |
| --- | --- | --- | --- |
| G0 determinism | SHA-256 per frame, two captures in fresh browsers | 100 % identical | same |
| G1 budget | bytes, duration, loop | <= 3 MiB, 6-12 s, loop 0 | <= 2 MiB |
| G2 motion energy | median d; share of moving steps | >= 0.0004; >= 0.45 | >= 0.0015; >= 0.95 |
| G3 anti-slide | longest still run; max d / median d | <= 2.0 s | <= 0.5 s, spike <= 6 |
| G4 seam | seam / mean of the two steps on each side | <= 8 | 0.25-2.0 |
| G5 title contrast | median title pixel vs 90th-percentile background in the box, every frame, through the mask | >= 4.5:1 | same |
| G6 title size | cap height of the title glyphs in the mask at the README column width (830 px) | >= 24 px | same; a title painted into declared base art is INFO |
| SEEK | 16 frames in a seeded shuffled order in a fresh page, against the master | identical, or within one level per channel (else exit 18 naming the frame and its time) | same |
| ART | SSIM of the base art's check box in decoded frame 0 against the source | >= 0.90 | same |
| FLASH | WCAG 2.3.1 flashes per second over the loop | <= 3 general, <= 3 red | same; a FAIL withholds the cover in `withheld/` |

FLOOR was set so that eight earlier painted covers pass and four slide-like
negatives fail. TARGET is what cover mode delivers; those earlier covers miss it
on purpose (a 1.9 s hold, a flash at the seam). The cover render exits 13 until
every gate reaches TARGET, the 2 MiB size included. G2 and G3 are area-weighted:
a small comet on a still picture counts as still at thumbnail scale, which is
intended. Never raise a number, shorten the loop or drop a layer to pass; fix
the cause.

G6 splits the white mask pixels in the title box into connected glyphs, drops
dots and accents (under 1 % of the largest glyph's area or 30 % of the tallest),
takes the median glyph height per sampled frame, and scales the smallest one
from the cover width to 830 px. Contrast alone once passed an 11 px name plate.
The seek-order check catches a page that keeps state between frames: the
sequential captures agree with each other, a frame sought out of order does not.
An element whose opacity and transform change together can rasterize one level
apart depending on what was painted before it, so a sought frame within one
level per channel of the master passes and is counted as `oneLevel`.

## Review: the stills and the questions

Every cover render writes, from the DECODED file, into `DIR/stills/` (listed in
`stills/stills.json` like a film's set):

- `sheet.png`: twelve frames at `t = k/12`, each labelled with its time in
  seconds, above a plot of every grid step's `d`, the still threshold (red
  dashes) and the median (green dots). A hold is a flat run on the dashes,
  encoder pops are regular spikes, a reset is a spike at the right end.
- `poster.png` (decoded frame 0) and `seam.png` (the last frame beside frame 0).
- `frame-00.png` ... `frame-11.png`, the sheet's frames at full size.

The gate cannot see damage. The pilot's two worst defects were found only by
eye on the sheet: a colour-dodge glint that turned a letter into a red block,
and a wing glow that read as a dark disc. View `sheet.png`, `poster.png` and
`seam.png` with `vision_analyze`, one call per file (and any `frame-NN.png` you
need closer). The plugin's tool hook records each call, and `complete` requires
a receipt for each of the three. A second opinion can come from a fresh
`delegate_task` subagent given only the sheet; record what it says as an aid.

Answer all eight every round, each naming a frame of the stills set and what is
visible there:

1. Is something moving in every half-second window (the plot never lies flat on
   the dashes)?
2. Does the seam disappear in the decoded file (`seam.png`, the right end of the
   plot)?
3. Does it still move after encoding, with no region that freezes and then pops?
4. Is the brand word present, legible and in place in every frame, never faded
   or swapped?
5. Are all three speed layers visible: a slow perpetual layer, a mid swell and
   beat events?
6. Does anything read as a slide, a card swap, a title fade or an end card, or
   does light wash in place instead of travelling as an edge?
7. Is any glyph, glint or glow damaged: a colour block, a dark disc, a visible
   box?
8. Name one thing a skilled motion designer would add or remove (`named`), or
   `none`.

A "no" on 1-5, a "yes" on 6 or 7, or a named 8 asks for another round. Record
the round with `$M look --out DIR --round N --answers FILE`; the answers file has
the film's shape (`viewed`, `answers` with `q`, `verdict`, `frame`, `observed`,
`aids`), with no `by` or `stranger` on question 1, and round 1 names the
`change` you make before round 2. A round with no image tool is recorded with
`"blocked": "no-vision-tool"` and ends `DONE_UNVIEWED`.

## Defects and window re-renders

What the eye finds goes into the round as `defects`, at most three, worst first:

```text
"defects": [{ "t": 1.2, "region": [340, 10, 330, 50], "frame": "stills/frame-02.png",
  "observed": "<what is visible there>", "cause": "<why>", "fix": "<the change>" }]
```

`t` is the loop time in seconds where the defect shows, `region` the
`[x, y, w, h]` it covers in cover pixels, `frame` a file of the current stills
set that shows it. `look` refuses a defect without a time, outside the loop, off
the cover, on a frame outside the current set, or without a concrete cause and
fix; a film round may not carry defects.

Before the next full render, check each fix locally:
`$M cover --out DIR --round N --window t0,t1` captures only the frames from
`t0 - 0.5 s` to `t1 + 0.5 s` (wrapping at the seam) in a fresh page and writes
`windows/round-N/<t0>-<t1>/sheet.png` (the span shaded on its plot) and
`window.json`. It shows frames before encoding, writes nothing to `stills/`, the
report or the manifest, and never counts as done: the full render and its gate
decide.

## Rounds and done

Rounds share one counter with the renders, 1 to 3, and every round is a full
cover render followed by a look. `$M complete --out DIR` exits 0 only when:

- `treatment.json` is a valid cover treatment and has not changed since the
  last render;
- the last render exited 0 and its report reads `COVER gate --strict:
  PASS+TARGET`;
- at least two look rounds are recorded, round 1 naming its change;
- the last round was recorded on the final render and viewed `stills/sheet.png`,
  `stills/poster.png` and `stills/seam.png` (with `vision_analyze` receipts when
  the tool hook is live);
- the last round asks for no further round, or it is round 3 (then the open
  items are stated plainly in the reply).

`complete` prints one `label:` line per generated asset; the reply carries each.
A window render never counts.

## Reply

Below the activation line, in plain words: what the loop does in one line; that
it was checked (motion on the decoded file, the seam, flash safety, and that the
frames were looked at, or that nobody could look at them); the file and its size;
a label on every generated asset; where the page lives and the one command that
re-renders it; any open look item.

## Exit codes

| Code | State | Fix |
| --- | --- | --- |
| 13 | GATE_FAIL_QA | A gate misses TARGET or the flash audit failed; the report names the gates |
| 14, 15 | not pre-warmed, font missing | `lithermes motion-runtime install` outside the session |
| 16 | BLOCKED_TREATMENT_INVALID | Fix the named field of `treatment.json` or `assets.json` |
| 17 | STAGE_CONTRACT_ERROR | The page, its static scan or the asset list (an unlisted raster, a changed hash) |
| 18 | STAGE_NONDETERMINISTIC | A clock or entropy call, a frame that differs in a fresh browser, or a frame that differs when sought out of order |
| 19 | STAGE_NETWORK_REQUEST | Remove the URL; everything is local |
| 21 | BLOCKED_NO_COVER_ENCODER | Install libwebp (img2webp, dwebp) or gifski |
| 22 | BLOCKED_ASSET_MISSING | Supply or generate the listed asset; never a stand-in |

## Unconfirmed

- Whether the single keyframe reset at the loop point is visible to a person on
  a real README; the numbers say smooth, nobody has watched it there yet.
- How a cover reads inside GitHub's README column at full width; review so far
  used local frames.
- The encoder threshold formula is libwebp's animation encoder as remembered;
  the measured behaviour matches it (q72 drops slow fades, q86-90 drops fewer).
- The thresholds come from 8 positives and 4 negatives in one family's style;
  re-check them on covers made for other projects.
