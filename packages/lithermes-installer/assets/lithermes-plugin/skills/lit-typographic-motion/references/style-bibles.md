# Style bibles

On the type path the treatment (`treatment.md`) already fixes the idea, the
audience, the arc, the palette and the sound. The style bible adds the look
decisions the type engine will not make by itself. Write it in your own words
for this film. Under bare `lit` do not ask the user; choose, then label each
choice as a default in the final reply.

## The style-bible template

Fill every field. A field left open is decided by the engine's preset default.
The right-hand column says what a useful answer contains; it is not an answer
to copy.

| Field | What to write | A useful answer names |
|---|---|---|
| Idea | The treatment's `idea`, unchanged | <the treatment's one sentence> |
| Preset | `swiss-signal`, `terminalcore` or `tidal`, and why | <the preset> because <what in this film calls for it> |
| Palette | The preset palette, or one stated swap inside its rules | <the swap and the brief key that sets it> |
| Voices | Which text is display, body, machine | <which line takes which voice> |
| Motion tone | The preset's named tokens you rely on | <entrance, hold and cut tokens> |
| Shot list | One line per shot: scene id, text, what moves | <scene id>: <line>, <what moves> |
| Accent | The one moment that gets the accent, or none | <the line index and why> |
| Anti-slop | Two or three things this film must not do | <habits this film avoids> |
| Originality | The visual idea that belongs to this film only | <a device drawn from the subject's specifics> |

The shot list maps directly to the brief JSON: `text` is the list of lines in
order and `scenes` is the optional list of scene ids in the same order.

## Auto-pick (MO-B-00)

The engine reads the brief's `text`, `mood` and `topic` and takes the first row
that matches. Latin keywords match as whole words only; Korean keywords match
only at the start of a token, so a keyword never fires inside a longer word it
merely ends. An explicit `"style"` in the brief always wins over this table.
The report labels a style you chose as `agent default`; it says
`user-specified` only when the user's own request named that style.

| Brief mentions | Preset |
|---|---|
| 터미널, 해커 / terminal, hacker, CRT | `terminalcore` |
| 물결, 파도, 잔잔한, 흐름 / gradient, wave, tide, calm | `tidal` |
| anything else | `swiss-signal` |

`system`, `status` and a bare `flow` are deliberately not keywords: they appear
in payment-system, design-system and workflow briefs that have nothing to do
with a terminal or a tide. The manifest records the pick and the reason, and the
gate report prints them on its `preset:` line.

## swiss-signal (MO-B-01)

Print precision on paper. The ground is bone `#E9EBE4`; type is ink `#0C0E13`
(16:1 either way round). One signal hue, teal `#0F7A82`, is for large type (32 px
and up, or 25 px bold), rules and bars, never small body copy: it measures about
4.2:1 on bone. One accent, `#D9A441`, belongs to a single moment and never to
text; the engine shows it as a small square at the title's rule for at most two
beats and never on more than 10% of the film's frames. Graphite `#4B5058` is
reserved for non-text marks.

Voices: Archivo for display type (fetched width instances 75/100/125 at weights
500/700/900; 500 stands in for 400 because that is what the pinned set ships),
Pretendard Regular or Bold for any Hangul, MesloLGS NF for annotations.
Motion tokens: `slam` (180 ms on the proven deceleration curve, entrance scale
0.96 to 1, never from zero), `hold` for the reading time, `snap-cut` at the beat.
The title slam steps Latin width from 125 to 100 halfway through its landing;
Hangul never takes that step. Passes: `swiss-grid` hairline rules as the layout
backbone, then `dither` at low strength as a printed grain. Grid: 12 columns,
24 px gutter, 96 px margin, 8 px baseline, compositions left-anchored rather than
centred.

Anti-slop: centred fade-in words as the only move; one ease for every beat;
glitch without a reason; any rainbow or second signal hue; bloom on anything but
the signal; a hold so long it reads as a stall.

## terminalcore (MO-B-02)

A terminal interface, not a code-rain poster. Background navy `#05070A`, window
panel `#0C1116`, one signal hue per film: phosphor green `#39FF6A` by default or
electric blue `#2FB6FF` (`"signalHue": "blue"`), never both. Both clear 4.5:1 on
navy and panel, so body-size readouts are safe; grey `#7C8B93` (5.7:1) is for
chrome labels.

Voices: Galmuri9 for Hangul (always at a multiple of its 9 px grid, 45 px or
more on screen), VT323 for Latin display, MesloLGS NF for status readouts,
Silkscreen for window-chrome labels only. Galmuri and VT323 never share one line
cell for cell. Motion tokens: `type-in` at 22 characters per second with no ease
(Hangul appears a whole 어절 at a time), `boot-flicker` for the first 250 ms of the
film, bounded by the CRT flicker cap, and `hard-cut` on the beat. Passes, in
order: `terminal-ui` (window chrome, meters, caret drawn as a Canvas2D layer),
`crt` (scanlines, curvature, seeded triad grain, capped flicker, phosphor
persistence over the two previous frames of the same shot), `dither` (Bayer4,
2 px cells), `glitch` (at most one scheduled hit per shot of 1.8 s or longer).

Anti-slop: falling code rain; neon purple-cyan haze; continuous glitch; both
signal hues in one film; pixel type too small for its grid.

## tidal (MO-B-03)

Slow water. Background indigo `#0E1420` under a moving two-stop gradient of deep
teal `#124559` and violet `#4C3B6E`; type off-white `#E8ECEF` (15:1 on indigo,
8:1 or better on either stop, so no scrim is needed). Coral `#E07856` is a rare
accent for one moment only.

Voices: Archivo at a calmer weight (700) for display, Pretendard for Hangul,
Meslo for small notes. Motion tokens: `drift` (opacity over up to 1.2 s and a
24 px rise over up to 2.4 s, both on the in-out sine token, matched to the
gradient's flow speed) and `surge-punch`, a gradient brightening with attack
0.15 s and decay 0.25 s that lands on each shot's opening. Passes: `tidal-gradient`
(domain-warped flow seeded per shot), `swiss-grid` for layout rules with guides
off, and `glitch` as rare punctuation: at most one hit in the whole film, on the
longest middle shot, at 0.5 hits per second or less.

Anti-slop: a hue-cycling rainbow; bloom on the gradient; glitch as texture; type
riding a flow so fast it blurs under motion sampling.

## Originality

The pattern transfers, never the values of the film this engine came from: one
small named palette, one signal, one rare accent, three voices. Invent this
brief's own visual idea per shot. Do not reuse scene names, motifs or copy from
any source film. Keep example subjects neutral and fictional unless the user
supplied them.
