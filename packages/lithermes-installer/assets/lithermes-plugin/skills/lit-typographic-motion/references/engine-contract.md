# Scene author and engine contract

The engine is a deterministic, code-driven renderer. Node builds the timeline,
lays out type from real font outlines and composes a display list for any time
`t`; a headless Chrome page rasterises it with WebGL2 passes and hands back the
exact RGBA bytes; ffmpeg encodes them last. You author the brief. You do not
write frames, pick frame numbers or call ffmpeg yourself.

## The brief

The type path starts from `treatment.json` like every film. `run --out DIR`
validates it first (exit 16 names the field) and refuses a treatment whose
`path` is `stage`. Without `--brief`, the engine brief is `DIR/brief.json`,
written from the treatment's `copy.lines` and `durationSec` on the first run and
then yours to refine. Its shape (placeholders; the engine refuses any `<...>`
value, so write this film's own):

```text
{
  "text": ["<line in film order>", "<line>", "<line>"],
  "scenes": ["<scene id per line>"],
  "style": "<preset id>",
  "durationSec": <4-90>,
  "bpm": <40-220>,
  "seed": <integer>,
  "accent": <line index or false>,
  "index": <true only when the treatment asks for a shot index>,
  "windowTitle": "<the film's own name, terminalcore only>",
  "signalHue": "<green or blue>",
  "audio": "<a file next to the brief>"
}
```

Only `text` is required: the display lines in film order. Every other key is
optional:

- `scenes`: one scene id per line (below). Missing entries use the default
  mapping: first line `title-slam`, last line `end-card`, a line with digits
  `number-counter`, a line with three or more items split by `·`, `,`, `/`, `|`
  or `;` `kinetic-list`, anything else `karaoke-line`.
- `style`: a preset; it wins over the auto-pick table. The report labels it
  `agent default` unless the user's request named that style.
- `durationSec`: the film's length (the treatment's value when the brief has
  none). Holds scale up until the film reaches it; they never drop below the
  reading floor. When the floors force a longer film, the manifest warns and
  the reply says so.
- `bpm`: 40 to 220; default 100 (a 0.6 s beat).
- `seed`: an integer; it drives every seeded effect.
- `accent`: the line index that owns the one accent moment, or `false`.
- `index`: `true` prints a shot index ("01 — 05", or "01/05" in a terminal
  window). It is off unless the treatment asks for it.
- `windowTitle`: the terminal window's title. Leave it out unless it is the
  film's own name; no stock label, file name or preset id ever prints.
- `signalHue`: `green` or `blue`, terminalcore only.
- `mood`, `topic`: extra words the auto-pick reads.
- `audio`: a file next to the brief. It is always muxed into the film. With a
  pre-warmed `--audio` venv its beats also replace the fixed grid (Tier 2);
  without one the cuts use text timing and the manifest carries the warning.
- `wordTiming: true`: Tier 3 word alignment. It is opt-in, never implied by bare
  `lit`, and fails closed (exit 14) until its models are pinned and installed.

Each line is read in one glance only when it fits the type sizes below; a long
line wraps to two lines on `karaoke-line`. The number of lines comes from the
treatment's arc: one breath per supplied line.

## Scenes

Each scene is a pure function of the shot-local time and progress, the beat
length and the timeline's own reveal units. Internal beats are anchored to the
shot window and to reveal starts, never to a literal frame or second.

| Scene id | What it does | Notes |
|---|---|---|
| `title-slam` | One large display line lands with the preset's entrance; a hairline rule draws under it | swiss steps Latin width 125 to 100 mid-landing; Hangul never |
| `karaoke-line` | The line is laid out once, each 어절 or word appears on its reveal step; the newest word takes the signal colour | pieces are placed by glyph position inside the whole line, so kerning pairs survive the split |
| `kinetic-list` | Items stack with index numbers in the machine voice; each enters on its reveal step | the block uses line height 1.6 |
| `number-counter` | Counts to the first number in the line (commas, decimals and a trailing `%` kept) with a critically damped spring; the rest of the line is the label | the only stateful scene; it integrates on a fixed 1/60 s grid from the shot start and snaps to the exact value |
| `stroke-signature` | Writes a Latin line with a single-stroke EMS font as a moving pen, timed from the shot's own window | Latin only; a Hangul line falls back to `title-slam` with a warning |
| `end-card` | The last line settles and holds; the reduced-motion still adds the title line above it | no motion after the entrance |

Terminalcore draws every scene inside a terminal window with a status bar,
meters and a caret; text types in instead of slamming.

## Timeline

The timeline is built before any frame (Tier 1 by default):

1. Each line's hold is `max(1.25 x reading floor, characters / 17 + 1 frame,
   2 beats)`; karaoke and list lines also cover every reveal step plus one beat.
2. The line's end is snapped forward to the next beat; the next line starts
   there. Cuts are frame-aligned and within one frame of their beat.
3. Reveal steps sit on a quarter-beat grid, at least three quarters long
   (0.45 s at 100 BPM), never splitting a 어절.
4. With a `durationSec` target, every hold is multiplied by one common factor
   (found by bisection) until the last cut lands on the first beat at or past
   the target; reveal steps and floors are never cut.
5. A film shorter than 3 s is extended to the next beat past 3 s.

The manifest's `timeline` array is the ground truth the gate checks: `id`,
`sceneId`, `shotIndex`, `start`, `end`, `holdSec`, `kind` (`line` or `reveal`),
`text` (after typographic punctuation), `script` and `beatSec`.

## Frame, sampling and post

- A frame is a pure function of `t` and the run's fixed parameters. No clock,
  `Math.random` or network state reaches pixels.
- The master renders 4 sub-samples per frame over half a frame of shutter:
  `t = max(0, n/60 + (0.5/60) x ((i + 0.5)/4 - 0.5))`; the average is taken in
  linear light before the post chain, and the post chain uses sample 2's
  overrides. Stills, sheets and perf use 1 sample. Every sample draws the frame's
  own shot: on a cut frame the two early samples fall before the cut and render
  the new shot at its first moment, so a hard cut never becomes a half dissolve.
- Stateful state (the counter spring, CRT phosphor persistence) is re-derived
  after any seek from the shot start or from the two previous frames, so a seeked
  frame equals the sequential one byte for byte.
- Post chain, fixed order: bloom and halation, chromatic aberration, tone
  shoulder, film grain, vignette, flash, shake and zoom, optional invert. Grain is
  keyed to the output frame. sRGB is applied once, in the final pass.
- Override fields and their ranges: exposure > 0 (neutral 1), bloom 0-1 (0),
  bloomThreshold 0-1 (0.85), bloomKnee 0-1 (0), bloomRadius 0-1 (0), halation
  0-1 (0), ca in px at 1080p (0), grain 0-1 (0), vignette 0-1 (0), fade 0-1 (1),
  flash 0-1 (0), shake px pair ([0, 0]), zoom > 0 (1), invert boolean (false,
  changes only on a cut and holds 2 beats). The starter scenes never use flash or
  invert.

## Passes

Every frame must be covered by at least one look pass that actually drew. The
render log records, per frame and pass, the draw count and the uniforms set.

| Pass | Seed | Hard limits |
|---|---|---|
| `swiss-grid` | none | guides always off in an export |
| `dither` | once per shot (blue-noise mode only) | never reseeded inside a shot |
| `crt` | triad grain, once per shot | flicker peak-to-peak <= 0.06; persistence only on stateful shots |
| `glitch` | hit schedule, once per shot | <= 2 hits/s, <= 20% of the frame per hit; one hit = displace, hold 2 frames, restore |
| `tidal-gradient` | flow origin, once per shot | <= 2 surges/s, attack and decay >= 0.1 s |
| `terminal-ui` | cosmetic jitter only | at most 2 layers |

Seeds are `fnv1a32("runSeed:sceneId:shotIndex:pass")` as an unsigned 32-bit
integer. Across all sources a shot carries at most 2 events (glitch hits,
surges, flash rises, invert changes, boot flicker) in any 1 s window, and no
pass may change 25% of the frame by 0.1 luminance in one frame pair.

On a software renderer (SwiftShader, llvmpipe, softpipe, lavapipe, Apple
software renderer, Microsoft Basic Render Driver) the engine applies one
downgrade: 1 sample, tidal octaves 3, CRT persistence off, every pass marked
`downgraded`, and the report says so.

## Type geometry

Each frame line in `render.jsonl` lists `textBoxes` measured from glyph
outlines after scene transforms and post zoom/shake: element id, text, voice,
font file, font size, cap height, weight, fill, ink bbox, lines, line height,
tracking, script runs and scale. The readback's alpha channel carries the glyph
coverage mask; the engine counts its ink pixels per frame and keeps the full
mask for the contrast-sample and cut frames under `.run/masks/`.

## Outputs and layout

`<out>/film.mp4`, `preview.webp` (or `.gif`), `poster.png`, `reduced-motion.png`,
`manifest.json`, `render.jsonl`, `gate-report.txt`, `run-state.json`, `stills/`,
`sheet/`, `.run/` (staging, masks, sampled frames, the Chrome profile while it
runs) and `withheld/` after a flash failure only. The poster is the first shot
settled; the reduced-motion still is the last shot settled with the title line
added; both render with grain and random noise at 0.
