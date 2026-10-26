# House styles

Four house styles ship as data in `styles/<id>.json` (schema
`litfamily.motion-style/v1`, validated by `engine/styles.mjs` and refused with
the bad field named). A film's treatment names exactly one; the validator checks
it against the pick rules below, the renderer serves it as `/lit/style.css`
and `/lit/style.js`, and the text QA judges copy against it. The style bibles in
`references/style-bibles.md` carry the look of each; this file carries the
rules. `node <skill>/bin/motion.mjs styles [--out DIR]` prints the table and,
with `--out`, writes the machine-readable `styles.json` catalog.

| Style | Type preset | Best for |
|---|---|---|
| `swiss-signal` | swiss-signal | the default: precise, hard cuts, teal signal |
| `tidal` | tidal | brand moods: slow flow, coral moment |
| `terminalcore` | terminalcore | terminal briefs: phosphor type, no ease |
| `paper` | none (stage only) | warm explainers; the type path refuses it |

## Picking

A style named in the request wins (`paper style`, `tidal`, `터미널코어`…).
Otherwise the project's house style (`motion-house.json` beside the output
folder, written by a render that passes its gate) holds while it exists.
Otherwise the keyword table in `style-bibles.md` auto-picks (`terminal` /
`hacker`, `gradient` / `wave`, `warm` / `paper`…). Otherwise an `explainer`
takes `paper` and a `brand-mood` takes `tidal`. Otherwise the default
`swiss-signal`. The manifest records `{ style, source, reason }`.

## Register

Rich is the default: every layer the treatment's world describes is drawn,
labelled, lit and moved. Minimal is only for a calm, quiet or minimal ask
(`minimal`, `calm`, `잔잔한`, `차분한`…): the core palette, two layers, one
camera move at most, no accents. A minimal film that reaches for a role
accent, or a rich film the request asked calm, fails validation.

## Palette, type, motion

Every colour on a stage page comes from the style's palette plus, on a rich
film, the style's role accents (`style.accents`, each with a role and a
`3:1`-on-ground colour). Copy uses the text roles (`style.textRoles`); display
and headline type uses ink. Ink on ground needs `7:1`, muted `4.5:1`. Type
uses the style's faces (Hangul falls back to Pretendard) on the style's
descending scale steps, with `keep-all` word breaking. Entrances, moves and
hand-offs use the style's ease curves and durations; an exit is never longer
than the hero move. Nothing eases on `terminalcore`. The banned list in each
style file is closed: the page never uses what its style bans.

## Layouts per shot

One grid per layout, named per shot, mapped per format (`LAYOUTS` in
`engine/styles.mjs`): `title`, `split`, `split-alt`, `stage`, `hero`, `full`
(a full shot is subject only and shows no copy). Every type zone sits inside
the central 90 % title-safe area. Adjacent shots never share a layout; a film
of four or more shots uses at least three. A hand-off (`cut`, `match`,
`wipe`, `push`, `iris`, `dissolve`, `morph`) comes from the style's list; the
last shot's transition is `end`. Every shot names its hero: the one move the
eye follows.

## The board

Round 1 ends with a board, not a preview: `stills/board.png`, one keyframe
per shot with number, time, layout and hand-off under it, the shot's type
zone dashed on the frame, the house style (name, palette, type) plus format,
length and sound in the header, and the layout check in the footer. The check
runs the text and style rules on the board frames (`stills/check.json`);
a FAIL ends the round with exit 13 (`BOARD_CHECK_FAIL`, the QA-fail exit with
the board named). Read the board with `read_file`, record the round with
`look`, make the change, then render.

## The gate rule names

Older notes name six text rules that have no runtime of their own. They are
contracts on the page, enforced by the QA checks and look rounds below; the
mapping is fixed and every row has a RED test:

| Doc name | Enforced by |
|---|---|
| `TEXT-OVERLAP` | no two settled copy lines overlap (`text-title-safe` overlap row at the settled frames) |
| `TEXT-ON-STYLE` | copy uses the style's faces, roles and scale steps (`fonts`, `text-title-safe` family row, type scale) |
| `TEXT-ZONE` | settled copy sits in the shot's type zone (`text-title-safe` zone row + board zone guide) |
| `FLAT-FRAME` | no empty dark run past twice the scene hold floor (`MO-D-03` in `gate.mjs`) |
| `DEAD-AIR` | every beat's midpoint shows a non-text image (`non-text-presence` in `stage-qa.mjs`, WARN at 1.5x) |
| `RICH-FILL` | rich films use the style's regions: copy roles plus at least one accent (`stage-qa` role coverage on rich treatments) |

`MO-D-03`'s floor is a calibration constant: it changes only with a new
calibration table, never to let a film pass.
