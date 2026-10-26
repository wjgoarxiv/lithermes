# Depth and story

Motion films read like stories because shots have protagonists, turns and
pay-offs, and depth answers how far the eye travels. This reference condenses
the story file format and the depth rules; the renderer and QA enforce them.

## Story and protagonist

The treatment carries the narrative contract: a **story** (`expect` what the
viewer expects, `turn` what happens instead, `beat` the shot where the turn
lands, `payoff` what the ending gives) and, on the stage path, a
**protagonist** (one character or hero object the eye follows: a name, a
look, and one act per shot, the acts covering at least half the film
including the turn shot). The board's per-shot captions carry the turns so
the read of the board is the read of the story.

## The four depths

Each shot is staged at one of four depths, declared in the treatment:

| Depth | Eye travel | Camera | Layers |
|---|---|---|---|
| `flat` | none: the page is a poster | locked | type + ground only |
| `near` | small parallax on the hero | dolly ≤ 6 % | hero lifts off ground |
| `deep` | the hero travels through the world | dolly + focus pull | foreground, hero, ground |
| `fold` | the world turns its page | one rotation, one axis | double-sided panel |

A film uses at most two depths, and the pay-off shot is never `flat`. Depth
changes only on a `match` or `morph` hand-off, so the eye never teleports.

## GPU ladder

A film declares the cheapest rung that can stage it honestly: a 2D film takes
the software rung (SwiftShader, CPU raster); a `depth: 3d` film takes the
platform's GPU rung first (ANGLE/Metal/GL/D3D11), and falls back to software
only with a warning, rendering the same frames. Only when neither rung has
WebGL is it exit 11. The rung is chosen from the treatment (`depth`), never
by the page. `paper` stays 2D: hand-drawn calm never reaches for a GPU.
`terminalcore` stays 2D too: phosphor has no third dimension.

## The Blender rung

A `depth: 3d` film whose treatment says `render3d: "blender"` renders its
world offline in Blender and shows the path-traced plate under its HTML type.
The scene is `stage/scene.py`, written against the `lit` helpers the runner
puts in scope; `motion.mjs blender --out DIR` renders one still at every beat
midpoint into `stage/plate-preview/`, `--final` renders the plate sequence
into `stage/plate/` plus `plate.json`, and the stage refuses to render without
a plate that matches its frames (exit 17). Preview first, open the stills,
compare them with any reference frames the user gave and with what the GPU
rung built, then render the final plate. A film that shows its plate shares
its run with a 3-D-of-any-kind page: the same scene, receipt and frames
render exactly the same plate again. Without Blender installed the command
falls back to the GPU rung instead of rendering; without `scene.py` it is
exit 17.

## Painted light and replay identity

Light is painted, never computed live: the scaffold bakes one key light, one
hemisphere light in the style's colours and one shadow-only floor into the
page, with the shadow bias that keeps a turning object's self-shadow from
flickering (`-0.0004` / `0.03`; without them the acne reads as flashes and
fails the gate). A Blender plate shows path-traced light under the same type;
the GPU rung renders the same baked page, so both agree to the eye.

For WebGL the page creates its context with `preserveDrawingBuffer: true`; a
page that asks for WebGL and gets none on any rung exits 11. A replay is
frame-identical: the same treatment on the same rung in a fresh browser must
reproduce the sampled frames pixel for pixel, or the render stops with exit
18. Chrome rasterizes every tile in full on the CPU, so blurs, shadows and
shaders replay pixel for pixel; one quirk remains, and the replay paints and
captures every frame exactly like the master because of it. Seeds are never
time-based. The rung is chosen from the treatment (`depth`) or the cover
recipe, never by the page.
