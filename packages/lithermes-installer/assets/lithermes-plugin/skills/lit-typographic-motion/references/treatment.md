# Treatment

Every film starts here. Write `treatment.json` in the run's output directory
before any render. The validator runs before every `stage` and `run` call,
stills-only included, and exits 16 (`BLOCKED_TREATMENT_INVALID`) naming the
first field that breaks a rule. Nothing renders until it passes.

The treatment is a director's plan: what the film is about, who watches it and
where, how it is shaped over time, what is drawn on screen, how it sounds, and
what would make it excellent. Write it from the request, not from the example
below.

## Load order

1. This file, always first.
2. Set `path`. Then load only that path's references:
   - `stage`: `stage.md` (authoring contract, kit, capture, QA), then
     `craft-loop.md` (look rounds and done).
   - `type`: `engine-contract.md`, `style-bibles.md`, `type-craft.md`, then
     `craft-loop.md`.
3. `runtime.md` only when a command exits 10, 11, 12, 14 or 15.

The stage path never needs a type-path reference.

## Path rule

- `type` when the words themselves are the film: the user asked for kinetic
  type, a lyric or quote video, a title sequence or typographic motion, or
  supplied words with no other subject. Type films are 16:9.
- `stage` for every other film, including any film that needs shapes, drawn
  objects, diagrams or imagery beyond type. Supplied words on the stage path
  become stage copy.
- A 9:16 film always takes the stage path.

The router may add a line "Type-led cue found: ...". It is a hint that the
request contains a type compound, an explicit lyric or kinetic-type ask, or a
quoted phrase. It never decides the path; you do, from the whole request.

## Fields

Normalization, used by several rules: NFC, lowercase, then remove whitespace,
punctuation and symbols. Before any comparison against `request`, every quoted
span is removed from it.

| Field | Rule |
|---|---|
| `request` | The user's words, verbatim. |
| `genre` | `announcement`, `brand-mood`, `event`, `explainer`, `motion-graphics`, `type-led` or `other`. |
| `path`, `pathReason` | `type` or `stage`, per the path rule. `type` needs `copy.source: user` or a type-led cue in `request`, and `format: 16:9`. |
| `idea` | One sentence: the film's own idea. It must not share a normalized run of min(10, half the normalized request length) characters with the request. |
| `audience`, `channel` | Who watches, and where it plays. |
| `format`, `formatReason` | `16:9` (1920×1080) or `9:16` (1080×1920), with a reason tied to `channel`. |
| `durationSec` | 4 to 90. Unless the user asked for a length, `announcement`, `event`, `explainer` and `motion-graphics` run at least 10 s. |
| `beats[]` | `{t0, t1, purpose, onScreen, motion, sound}` each. They cover 0 to `durationSec` with no gap over 0.25 s, every beat lasts at least 1.2 s, and there are at least as many beats as the genre's arc has stages. |
| `subject` | `{name, source: user or invented, specifics[]}`. When the request names no specific subject, invent one: a name plus at least 2 concrete specifics (what it is or does, for whom, one distinctive detail). |
| `visualDevices[]` | `{kind, role: subject, support or texture, beats[]}`, where `beats` lists beat indexes from 0. Kinds: `illustration`, `diagram`, `chart`, `icon`, `shape`, `path`, `mask`, `depth3d`, `particles`, `grid`, `gradient`, `photo-texture`. |
| `typePlan` | `{faces[], hierarchy, maxWordsOnScreen}`. Faces come from this product's verified set: Pretendard, Archivo, Galmuri9, VT323, Silkscreen, MesloLGS NF. |
| `palette[]` | 3 to 6 `{color: "#rrggbb", role}` entries. |
| `sound` | `{mode, plan, palette}`; `file` for `supplied` and `authored`. |
| `copy` | `{source: user or invented, lines[]}`. |
| `inventions[]` | Every invented part. Required when the subject or the copy is invented, and it must contain `subject.name` when the subject is invented. |
| `ambition` | One or two sentences, in craft terms, on what would make this film excellent for this request. |

### Stage-path device rules

- At least one `role: subject` device. It is a drawn depiction of what the film
  is about, not a background, and its beats cover at least half of
  `durationSec`.
- At least 2 distinct counting kinds. `grid`, `gradient`, `particles` and
  `photo-texture` are always `texture` and never count.

### Copy rules

- `copy.source: user` when the user supplied the words. Every normalized line
  must be a substring of the normalized request, quoted spans included. Keep
  the user's words exactly; line breaks are yours.
- `copy.source: invented` when the request supplies no film words. Write the
  copy from `subject.specifics`, never from the request's wording: no invented
  line may share the idea's substring limit with the request. List the copy in
  `inventions[]`.
- A line that could be pasted unchanged into a film about a different subject
  is not copy yet. Name the specific thing.

### Sound rules

- `generated` is the default under bare `lit`, on both paths. The `sound`
  subcommand builds a deterministic bed from the treatment: tempo, pulse and a
  pad chord progression, plus accents only where a beat's `sound` field asks
  (a hit on a cut, a rise into a change, a closing cadence). `sound.palette` is
  one of `soft-mallet`, `warm-keys`, `glass-pulse` or `low-strings`; key and
  tempo follow from the treatment, so two films rarely share a bed. The reply
  labels the bed as generated.
- `supplied`: the user's WAV, named in `sound.file`, relative to the output dir.
- `authored`: a WAV you wrote into the stage dir (`stage/*.wav`).
- `none` only when the user asked for silence, or when the channel plays muted
  by design (say so in `channel`).

Any supplied, authored or generated track is muxed on either path. It is
padded or trimmed to the film with a 50 ms fade; it never shortens the film.

## Genre arcs

The arc sets the minimum number of beats. Length comes from the arc, never
from a wish to be short.

- **announcement:** hook → context → key moment → details → close.
- **brand-mood:** motif → variation → peak → resolve.
- **event:** hook → what, when, where → highlight → close.
- **explainer:** question → steps → result → recap.
- **motion-graphics:** opening motif → set piece → set piece → peak → resolve.
- **type-led:** one breath per line, with emphasis and pause.
- **other:** at least 3 beats with a clear opening, middle and close.

## Craft rules

- Show the subject; do not only name it. With the sound muted and every word hidden, the drawn subject alone should still suggest what the film is about.
- Aim for professional motion-design craft in every film: varied transitions (match cuts, masks, morphs), rhythm locked to the sound, layered depth, clear hierarchy, deliberate easing. Every beat shows something new. Length comes from the arc; never shorten the film or merge beats to pass a check.

## Placeholder example

This shows the shape of every field. Its values are placeholders: the validator
rejects any `<...>` value, and it rejects a treatment whose free-text values
mostly equal this example's (`copiedExample`). Do not copy it; write your own.

```json
{
  "request": "<the user's words, verbatim>",
  "genre": "<one genre id>",
  "path": "<type or stage>",
  "pathReason": "<why this path fits>",
  "idea": "<one sentence: the film's own idea>",
  "audience": "<who watches>",
  "channel": "<where it plays>",
  "format": "<16:9 or 9:16>",
  "formatReason": "<why this format suits the channel>",
  "durationSec": "<4–90>",
  "beats": [
    { "t0": "<start s>", "t1": "<end s>", "purpose": "<arc stage>", "onScreen": "<what is drawn>", "motion": "<how it moves>", "sound": "<what the sound does here>" }
  ],
  "subject": { "name": "<a specific name>", "source": "<user or invented>", "specifics": ["<what it is or does>", "<for whom>", "<one distinctive detail>"] },
  "visualDevices": [
    { "kind": "<device kind>", "role": "<subject, support or texture>", "beats": ["<beat index>"] }
  ],
  "typePlan": { "faces": ["<verified face>"], "hierarchy": "<levels of type>", "maxWordsOnScreen": "<n>" },
  "palette": [
    { "color": "<#rrggbb>", "role": "<what this colour does>" }
  ],
  "sound": { "mode": "<generated, supplied, authored or none>", "plan": "<how the sound follows the arc>", "palette": "<timbre palette>" },
  "copy": { "source": "<user or invented>", "lines": ["<line>"] },
  "inventions": ["<every invented part>"],
  "ambition": "<one or two sentences in craft terms>"
}
```

## Never downgrade to pass

Do not answer a gate failure by shortening the film, removing a beat, removing
the subject device, switching `sound.mode` to `none`, switching `path` to
`type`, or deleting effects. Fix the cause instead: a scrim behind type, a
larger size, a new placement, different timing, seeded randomness. Or deliver
with the failure stated. The done-check compares the final treatment with the
first valid one and records `downgraded` when the duration dropped by more than
20 %, there are fewer subject beats, sound became `none` without a user
request, or the path went from stage to type. The reply must then say so.
