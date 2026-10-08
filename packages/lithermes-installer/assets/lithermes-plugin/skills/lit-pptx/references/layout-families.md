# Layout families

Named on the `layout:` line, drawn by the tonality; no pack carries all 28, so list first:

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs pptx --list-tonalities
node <installed-plugin>/skills/lit-pptx/bin/office.mjs pptx --list-layouts gazette
```

Pick by job, not by the previous slide. Blocks are named `family@<id>`.

## Content families

| Family: job — source | Packs |
|---|---|
| `text-column`: prose or short list — bullets or 개조식 groups; an image makes a split | atlas, chalk, paper, gazette |
| `text-two-column`: long list, two parallel halves — bullets (cut at the middle group) or `:::: columns` | ledger, gazette, studio |
| `summary-box-list`: framed finding over two support columns — `::: key-message` (else first line), groups | gazette |
| `sidebar-note`: point plus aside (definition, common mistake) — body, then `::: main-box`; a note too short for its column stands across the top over two columns of points, in the rail under a side title | chalk |
| `agenda`: numbered parts — `- **Part** scope` lines | ledger, chalk, gazette |
| `statement`: pull quote, display-led deck on request — `##` text as sentence, one support line | all but ledger, gazette |
| `quote`: quotation — quote line, then a `—` attribution line | signal, chalk, paper |
| `kpi-row`: two to six figures — value row, basis row, evidence bullets | ledger, signal, atlas, studio, night |
| `kpi-over-chart`: figures over their trend — one-row KPI table, then `::: chart` | ledger, night |
| `dashboard-grid`: two to four small charts — `::: chart` blocks, one takeaway line | ledger, night |
| `table-insight`: table beside its reading — pipe table, `>` caption, bullets | ledger, signal, chalk, paper, gazette |
| `ledger-table`: full-width evidence table — table, caption, takeaways under it | ledger, gazette |
| `matrix-2x2`: options on two axes — 3 × 3 table, corner `효과 \ 비용`, cells `item · detail · detail`, takeaways after the caption | ledger, gazette |
| `comparison`: two sides point by point — `:::: columns`, `**head**` and `(1)` `(2)` items; shared `비용: …` labels form a criteria column (rail under a side title); a label over three words is not a label, so that slide keeps its points whole and nothing goes to the rail | all eight |
| `chart-insight`: chart plus 2-3 points — `::: chart` or data table, bullets | ledger, signal, paper, studio, night |
| `full-chart`: one full-width chart — `::: chart`, optional note | ledger, signal, paper, night |
| `big-number`: a few real figures — KPI table with basis row, 2-3 evidence bullets | ledger, signal, studio, night |
| `process`: three to five steps — `- **1. 단계** what happens` | signal, chalk |
| `step-diagram`: steps taught one by one — as `process` | chalk |
| `timeline`: dated events — `시점 \| 할 일 \| 담당` table (or `- **date** event`), takeaways | ledger, atlas, gazette, studio, night |
| `method`: formula or figure with terms — image or formula, `- **term** meaning` | chalk, paper, night |
| `image-full`: the picture is the slide — caption `도 1. … \| 출처: …` | atlas, studio |
| `image-split`: picture beside explanation — image, bullets | signal, atlas, chalk, studio |
| `photo-grid`: two or three pictures — image lines, one text line | atlas, studio |
| `figure-pair`: before/after — two images, one text line | atlas, paper |
| `figure-academic`: numbered figure — sourced caption; observation, limitation, implication | paper |
| `asymmetric-feature`: large element, narrow text — image or one-cell figure, bullets | signal, atlas, studio |
| `references-appendix`: sources and glossary — `- [1] …` entries with real links | ledger, paper, gazette |

Old names compile: `content`/`main` → `text-column`, `summary` → `comparison`; plain `cover`,
`section`, `closing` take the pack's first variant.

## Covers, sections, closings

Undrawable variants fall back to the pack's first drawable one.

| Variant: shows (needs) | Packs |
|---|---|
| `cover-typographic`: title on the pack's cover device | all but studio |
| `cover-figures`: title over headline figures (a KPI row) | ledger, night |
| `cover-index`: title beside the parts (agenda or ≥ 2 sections) | ledger, paper, gazette |
| `cover-numeral`: real year or count above the title, at most its size (a year in title or date) | signal, chalk, studio, night |
| `cover-split-field`: half the page in the accent field | signal |
| `cover-split-image`: title beside the first picture (an image) | atlas, paper, studio |
| `cover-full-image`: first picture full-bleed, title on a panel (an image) | atlas |
| `cover-band`: title under a heavy band, parts (else figures) beneath | gazette |
| `cover-rail`: title in a tinted left rail | chalk, studio |
| `section-field`: part title on a colour field | signal, atlas, paper, night |
| `section-numeral`: part number, title, part count; with an agenda, the index page | ledger, signal, chalk, studio, night |
| `section-rule`: with an agenda, numeral over title in cols 1-6, agenda in cols 8-12, this part under an accent rule; else title over a hairline and the part's first slide titles | ledger, paper, gazette |
| `section-rail`: part title in the rail | chalk, studio |
| `section-band`: index in the band; title as a statement over the part's first slide titles | gazette |
| `section-image`: part title on its picture (an image on that slide) | atlas |
| `closing-ask`: request as label, table as action rows, next step at the foot (table or bullets) | all but studio, night |
| `closing-decision-box`: decision boxed, action rows beneath (line or bullets, optional table) | ledger, gazette, night |
| `closing-statement`: one closing line (no table or image) | signal, night |
| `closing-summary-list`: numbered points (bullets) | chalk, paper, studio |
| `closing-contact-split`: action rows beside a field of amounts or dates with share bars; next step or contact as a floor band meeting the field in an L | atlas, studio |

What a closing must say: `density-and-fill.md`.

## Display devices

From the pack's `display:` key; devices add no content.

| Key: device — drawing | Packs |
|---|---|
| `cover`: `drench` (full-page field, title ≤ 3 balanced lines, low) / `plate` (sub-half plate, title ≤ 2 lines, date above) | signal / atlas |
| `cover`: `rail` / `band` / `figures` / `numeral` — that pack's variant (`figures` only with a KPI row) | chalk / gazette / ledger / night |
| `cover`: `rules` — heavy rule, title, hairline, presenter, place and date | paper |
| `statement`: `open` (alone, display step) / `drench` (slide in the field) / `plate` (low on a sub-half plate, open if too tall) / `rules` (hairlines above sentence, below support) / `offset` (cols 5-12 beside a rail ending a column short) | signal, night / chalk, atlas / none / paper, studio / none |
| `number`: `field` / `tint` / `outline` — panel behind a big number | signal / ledger, studio, atlas, chalk, night / gazette, paper |
| `closing`: `band` / `box` / `rules` — next step at the foot | signal, studio, atlas, night / ledger, gazette, chalk / paper |
| `index`: `true` — sections show the parts, this one marked | ledger, gazette, paper |

Engine rules:

- Big number: data panel of one to four figures (value, label, basis), at most title size, seven of
  twelve columns (five of eight beside a rail), evidence beside it.
- A partial dark plate, rail or panel stays under half the canvas.
- Sections number from the agenda ("02 / 05") when the title matches an entry or its description,
  else count sections; one section without agenda gets no numeral, its title a statement at the
  cover step over the titles of the slides it opens.
- Closing tables become action rows keyed on a single-unit amount column (share bars), else a date
  column, else the last. Totals rows (`합계`, `Total`) never become action rows; dash-only cells drop;
  rows that still do not fit fall back to the table.
- Body and cell text breaks at spaces, numbers kept on their unit ("51점", "4 분기"), a lone last
  word pulled up. Titles: `title-treatments.md`.

## How families fill (source only)

- Process (≤ 4 steps): rows; on the compact step numeral, name, what happens, sub-points joined.
- Two to five bold-headed points: rows, head left; bold heads with sub-points: two columns.
- Table takeaways sit midway below; a timeline's under the axis (at 38 % of the body).
- Compact step: chart values as a small table (≤ 8 rows, ≤ 4 columns) under the takeaways, or under
  the chart if it keeps 150 pt; a card row over its cap becomes figure rows down seven columns.
- Method: formula on top, terms in two columns. 2x2: takeaways beside or below, each cell an item
  over its details. References: label size, then two columns.

Beside a visual the source and note lines close the takeaway column; takeaways that leave a column or the
rail more than 40 % empty step up to lead size when they fit. Compact process rows step up the same way
when their measure leaves a quarter of the body empty. Under `side-rail` KPI values stack, processes run
vertically and a chart fills cols 5-12; under
`bottom-anchor` the visual sits on top; under `band` content runs from the band to the floor; a
`quote` under `statement` becomes the sentence with its attribution as support.

## Variety and the compile log

Content slides (no closings) read as title zone × column partition. With too few layouts or one over
40 %, a data slide moves to a title adding one (no overflow, within band), else a table or chart slide
stacks takeaways under the visual.

```text
variety: slide 7 drawn under side-rail so the deck carries 6 layouts
```

Copy each `note:` into the build log and fix it. OF-111: `density-and-fill.md`.
