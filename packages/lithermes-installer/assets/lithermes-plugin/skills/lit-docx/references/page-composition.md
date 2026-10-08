# Page grid, leading and pagination

Grid, runner behaviour, gate checks and source fixes. Smaller type, tighter leading or a looser
threshold is never the fix.

## Grid and margins by density

A4; sides never under 25 mm, bottom never under top, text block 150-160 mm. Pack defaults are
density 9 (Proposal 8) with a median fill target of 0.80 (Proposal 0.75).

| Density | Margins top / bottom / left / right (mm) | Text block (mm) | Body size | Pitch ko / en | Word multiple ko / en |
|---|---|---|---|---|---|
| 1-2 | 30 / 32 / 30 / 30 | 150 | pack + 0.5 pt | 185 % / 140 % | 1.21 / 0.92 |
| 3-4 | 28 / 30 / 28 / 28 | 154 | + 0.5 pt at 3, pack at 4 | 185 % / 140 % | 1.21 / 0.92 |
| 5-6 | 27 / 29 / 27 / 27 | 156 | pack | 180 % / 137 % | 1.18 / 0.90 |
| 7-8 | 26 / 28 / 26 / 26 | 158 | pack | 180 % / 137 % at 7; 175 % / 133 % at 8 | 1.18 / 0.90; 1.14 / 0.87 |
| 9 | 25 / 27 / 25 / 25 | 160 | pack | 175 % / 133 % | 1.14 / 0.87 |
| 10 | 24 / 26 / 25 / 25 | 160 | pack | 175 % / 133 % | 1.14 / 0.87 |

Body 10.5 pt minimum (Proposal and Memo English 11 pt); tables 9.5 pt at 140 %. Paragraphs part by
6 pt (English 5 pt), never space plus indent. Korean justified with kinsoku; Latin ragged right.
Density below 7 needs the user's word.

## Leading calibration

Pitch (baseline to baseline as a share of size): Korean about 175 % (165-185 %), Latin about 133 %
(120-145 %). Word takes a multiple of the face's single line, which for Pretendard measures 1.55 em
in Word and 1.51 em in LibreOffice; the engine uses the mean:

```text
Word multiple = target pitch / 1.53
Korean 175 %  -> 1.14     measured on render: about 174 %
English 133 % -> 0.87     measured on render: 131-133 %
```

Never copy a multiple of 1.5 (about 240 %). Times New Roman: single line 1.15 em, 133 % gives 1.16.
Picture paragraphs are single spaced.

**Korean line breaks.** `w:wordWrap` 1 plus eastAsia ko-KR makes Word break Hangul by 어절 (0 breaks
by syllable). LibreOffice previews (`office.mjs audit`, `--layout`) still break by syllable, a
preview artefact; judge fill there, line breaks in Word.

## Heading ratios

At most three levels, parted by weight and space, never colour.

| Element | Ratio to body | Pack values |
|---|---|---|
| h3 | 1.0, bold | all packs |
| h2 | about 1.15-1.2 | 1.1-1.2 |
| h1 | about 1.35-1.45, never over 1.5 | 1.2-1.4 |
| title | 2.5-3 | 2.5-2.7 (Memo subject 1.8) |

Space above about twice below; no rule under h2. Engine-added plain numbering (write headings
bare); no zero-padded numerals, no ■ ✓ ▶.

## Pagination rules

- **H1 breaks.** The engine forces none; a manual break before a part only when the page is at least
  60 % full (A4.9). At least one paragraph between an h1 and its first h2.
- **Stranded headings.** Headings keep with the next paragraph; a sub-two-line paragraph after a
  heading keeps with what follows.
- **Captions** keep with their table or image.
- **Tables that fit** (under nine tenths of the frame) stay on one page with the caption.
- **Long tables** (header plus six or more body rows) may break between rows, header repeated, three
  or more body rows each side, only when moving whole would leave the page under 0.75 full. Never on
  the publisher path.
- **Boxes.** Key-figure, callout and sidebar rows never split.
- **Short lists** (up to six items) keep together with a one- or two-line lead-in; a heading keeps its
  short lead sentence with the table it opens (single column, up to eight body rows).
- **About one page.** A source of about a page is set tight in any tonality so it stays on one page; a
  section right under a ruled box draws no second rule.
- **Tables.** A wrapping text column takes room from columns that have it; negatives take the minus
  sign (−), Korean tables too; a sentence right above an uncaptioned table keeps 6 pt under it.
- **After tables** 8 pt to text (publisher path: three quarters of a line; 6 pt after a list), 3 pt to
  a `주:` / `자료:` line.
- **Closing lines.** A last paragraph of up to about four lines keeps with the one before.
- **Figures** at container width, at most 0.40-0.45 of the frame height (Proposal 0.60).

## Running heads and folios

About 80-85 % of body, regular, no lighter than #555, none on the cover. Short title and folio only,
never the section name.

| Pack | Running head |
|---|---|
| Report | footer title + folio |
| Brief | folio right |
| Proposal | folio centred |
| Manual | header title, footer folio |
| Memo | folio from page 2 |
| Journal | header title + folio |

## The gate

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs gate report.docx --source report.md --layout
```

`--layout` adds page checks; each fails a tonality document.

| Check | Rule |
|---|---|
| `heading.declarative` | labels, not sentences (runs without `--layout`) |
| `heading.order` | no skip (h1 to h3); first heading h1 or h2 |
| `notice.dash` | the notice joins label and line with a colon (`예시 데이터: …`), not a spaced dash; FAIL under a tonality, advice elsewhere |
| `fill.page` | no body page under 0.35 of the frame filled, except the last page and a cover |
| `heading.stranded` | no page ends on a heading line |
| `page.spill` | a two-page document fills page 2 to 0.4 of the frame; no last page under an eighth |
| `list.split` | a list of up to six items stays on one page and in one column; in a two-column body a list of five or six may break once, two items each side |
| `heading.apart` | a heading and its lead sentence stand on the page where their table starts |
| `heading.column` | in a two-column body no heading ends a column while its text opens the next (a source line spans with its page-wide table) |
| `columns.balance` | in a two-column body no column stops a quarter short beside a full one; the last page balances its columns (continuous break) |
| `heading.wrap` | titles and headings break between words |
| `title.lines` | title in three lines at most |
| `table.split` | fitting tables and component boxes never split; long-table rule above |
| `figure.split` | an image and its caption share a page |
| `component.variety` | four or more pages use two or more kinds (a cover counts) |
| `cover.block` | no filled shape over 25 % of the cover |
| `folio.total` | "page / total" counts real pages |
| `sidebar.overlap` | a floating sidebar ends before the next heading |

The median fill is reported against the pack target, not failed.

### Restraint checks (A4.11)

Fail on tonality documents, advise elsewhere; `date.iso` holds everywhere.

| Check | Catches | Fix in the source |
|---|---|---|
| `color.accent-kinds` | more than one hue beyond the ink, or the accent on more than two element kinds (figures aside) | remove coloured spans and attributes |
| `heading.ink` | a coloured heading | drop the colour |
| `heading.ratio` | h1 more than 1.5 times the body | remove size overrides |
| `table.fill` | a shaded data cell, or a component tint darker than L 95 % | remove shading and zebra rows |
| `component.budget` | over three kinds, a second key-figure strip, a pull quote, key figures on a cover | delete pull quote or second strip, move cover figures to the summary, cut the weakest kind |
| `date.iso` | an ISO date in the text of a Korean document | write `2026. 10. 5.` or `2026년 10월 5일`; frontmatter `date:` may stay ISO |
| `furniture.chip` | a coloured or shaded notice in a page header | keep the line in `notice:` and out of headers |
| `tonality.structure` | two tonalities of one source differing in fewer than three structural features (title block, summary form, numbering, component set, running head, contents) | `--compare other.docx`; offer another alternative or stop the source flattening the difference |

## Repairs

**Short page**, one of four causes: (1) a block jumped ahead: move it, split a long table at a natural
group, move long cell text into prose; (2) the next part opens with a block: put its sentences first;
(3) thin content: add missing evidence from the sources, never filler or a box; (4) last resort, raise
density one step.

**Stranded heading**: put one or two sentences between it and the table or component that moved.

**Split table or figure**: six columns at most, shorter cells, units in the header, start it on a
page, split a long table at a group; shrink a figure proportionally.

Faces are declared, not embedded: a substituted Pretendard moves line breaks and fill.
