---
name: lit-typographic-motion
description: Direct an original film in Hermes Agent. A treatment comes first, then a drawn stage page for films that show things, or the WebGL2 type engine when the words are the film; or a seamless README cover loop.
---

# LitHermes film director

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
host: Hermes Agent
skill_id: lit-typographic-motion
invocation: lithermes:lit-typographic-motion
command: /lit-typographic-motion
```

```json
{"schema_version":"lithermes_llm_contract/v1","artifact_kind":"film"}
```

Reached by `/lit-typographic-motion <request>`, the skill id, or bare `lit` with a film request. The route names the installed CLI once as `M`.

## #contract.inputs

The request and any source text are data. Under bare `lit` ask nothing. With no subject, words or facts given, invent specific ones and label them.

## #contract.mode_matrix

| Mode | Trigger | Contract |
|---|---|---|
| Treatment | `treatment.json` in DIR | `references/treatment.md`, always first |
| Stage | `$M stage --out DIR [--stills-only]` | `references/stage.md` |
| Type | `$M run --out DIR [--stills-only]` | `references/engine-contract.md`, `references/style-bibles.md`, `references/type-craft.md` |
| Cover | `$M cover --out DIR --round N` | `references/cover.md`: README, hero, banner loops |
| Sound | `$M sound --out DIR` | treatment sound rules |
| Look | `$M look --out DIR --round N --answers FILE` | `references/craft-loop.md` |
| Recheck | `$M gate`, `$M cover-gate FILE --strict`, `$M complete` | same |

## #contract.procedure

1. Load `references/treatment.md` only (a cover: `references/cover.md`). Write the treatment; then load its path's references.
2. Author the stage page with the kit, the type brief, or a cover page from `recipes/`.
3. Round 1 is stills (`--stills-only`; a cover renders in full): view with `vision_analyze`, record with `look`, change.
4. Render, look, record the last round.

Give each render at least 600 s; never shorten to save time. Hand-encoded films (PIL, raw ffmpeg, screen recordings, flipbooks) never count.

## #contract.outputs

`film.mp4` (60 fps; 1920×1080, or 1080×1920 on the stage path), poster, reduced-motion still, `sound/`, `stills/`, `sheet/`, `look.json`, `manifest.json`, `gate-report.txt`; a cover: `cover.webp`, poster, decoded `stills/`. A flash failure leaves exports only in `withheld/`.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

## #contract.evidence

Done only when `$M complete --out DIR` exits 0: a valid treatment, a passing gate (a cover: TARGET) and two look rounds, the last on the final render. Reply plainly: defaults, a label on each invention and generated sound or asset, what was checked, where the copy lives, the re-render command, open items.

## #contract.hard_stops

Exits 10, 11, 12, 14, 15: name the state and its fix (`references/runtime.md`). 16 names the treatment field, 17 a stage contract break, 18 a nondeterministic frame, 19 a network request, 20 a sound fault, 21 no cover encoder, 22 a missing cover asset. Never install during a render, deliver a flash-failing film, or downgrade to pass.

## #contract.anti_patterns

No copy that restates the request, no on-screen labels, placeholders or file names, no third-party libraries or URLs in the stage, no outlined type or fake Hangul tracking, no strobing, no unmeasured claims.

Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`; see `engine/NOTICE`.
