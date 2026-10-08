# Title treatments

A treatment fixes a title's frame, type step, colour and companion (rule, band, rail, numeral,
panel). There are eight; each frame is identical on every slide that uses it, and a deck mixes three
to five by slide job.

## Labels, not sentences

Titles and the cover subtitle are noun phrases naming subject, measure and period: "지역별 정수 처리
단가 비교", "Membrane flux by cleaning cycle, 2026". A claim goes in the body (boxed line, data panel
or first takeaway); `statement` stays for pull quotes and decks asked to be display-led. OF-114 reads
shapes named `title@…` and `subtitle@cover` and fails a declarative one:

- Korean: a last word ending in a sentence ending (-다 outside short nouns such as 바다 or 어젠다,
  -니다, -어요/-아요/-해요/-세요/-에요/-예요/-네요/-지요/-죠) or a nominalised claim (-었음,
  -았음, -였음, -했음, -겠음, -함, -됨; 포함, 있음, 없음 pass).
- English: a final period, or a finite verb (is, are, was, has, will; grew, rose, fell, doubled,
  leads, beats …).
- A trailing parenthesis is read without its contents. Questions are not declarative.

HIGH under a tonality, MEDIUM on a legacy template. No eyebrow word above any title; a numeral
beside one is a real step, part or figure, no larger than the title step.

## How each slide gets one

Roles by family: text `content`; tables and KPI rows `data`; charts and big numbers
`data-takeaway`; processes and timelines `sequence`; pictures `image`; statements and quotes
`statement`; methods `definition`; references `reference`. The pack's `role-defaults` map roles to
treatments. The engine keeps the default while the body fills to the density band, else takes the
allowed treatment with the smallest empty band (a repeat of the previous slide penalised, fill-chosen
treatments capped near a third of the deck, distinct treatments capped by variance) and prints a
`note:`. A pack's `structure` names a family's own title (Chalk draws a comparison on its board rail,
Paper under a top rule): it comes before the role default and holds past the deck's share of it, so
two tonalities of one source differ in structure. A table cannot take a bottom title; the next
treatment stands in.

Pin with `title:` on the line after `layout:`; a disallowed id stops the compile with the allowed
set. Covers, sections and closings reject the key.

```markdown
---
layout: full-chart
title: bottom-anchor

## 세척 주기별 투과 유량 변화 (예시)
…
---
```

## The eight

Frames are the standard grid (16:9 margin 48, pitch 74; 4:3 margin 42, pitch 54); other grids keep
column spans and y values. Budgets are Korean glyphs; Latin takes about double.

| Treatment | Frame 16:9 (x, y, w) | Frame 4:3 (x, y, w) | Companion | Body | Budget | Typical use |
|---|---|---|---|---|---|---|
| `top-rule` | cols 1-12: 48, 36, 864 | 42, 36, 636 | accent rule one column wide or a 0.75 pt hairline across | y 120-486 | 1 line, ≤27 (4:3 ≤20) | read content and data pages |
| `top-plain-large` | cols 1-10: 48, 36, 716 | 42, 36, 528 | none; display step | 24 pt under the title | 2 lines × ≤16 (4:3 ≤12) | comparison, image-split |
| `side-rail` | cols 1-4: 48, 36, 272 | 42, 36, 204 | optional tinted rail or hairline at column 4 | cols 5-12 from y 36 | 4 lines × ≤8 | chart or table with takeaway, method, definitions |
| `band` | cols 1-11: 48, 36, 790 on a 108 pt band | 42, 36, 582 | full-width band in the field colour | y 132-486 | 1 line, ≤25 (≤27 without a band tag) | Korean briefing pages, data on a dark deck |
| `statement` | cols 1-10, centred in y 120-486 | cols 1-10 | optional support line 24 pt under | none | 3 lines × ≤16 | pull quotes, display-led decks on request |
| `overlay` | cols 1-7: 48, 348, 494 | 42, 348, 366 | field panel at 88 % opacity over a full-bleed picture | none | 2 lines × ≤15 (4:3 ≤11) | full-picture slides |
| `kicker-numeral` | numeral cols 1-2; title cols 3-12: 196, 48, 716 | 150, 48, 528 | real numeral in the accent, never an agenda's count (OF-119) | y 132-486 | 1 line, ≤23 | steps, numbered recommendations |
| `bottom-anchor` | cols 1-9, last line on the floor (486) | same | optional hairline 12 pt above the title | visual from y 36 to 24 pt above the title | 2 lines × ≤20 | chart-, figure- and picture-led slides |

Nothing stands beside a bottom title. The rail under a side title holds the slide's supporting content: a
comparison's criteria labels level with their rows, a visual's takeaways (with a chart's values under them) and
the source at its foot; a slide whose rail would stay more than 40 % empty takes another title unless
`title: side-rail` pins it.

### On the compact grid (density 10, every pack's default)

16:9 margin 24, column 54, gutter 24, pitch 78 (x = 24 + 78(a − 1), w = 78n − 24); 4:3 margin 24,
column 45, gutter 12, pitch 57. A 16:9 side rail is 288 wide, its body from 336 (4:3: 216, 252).

- `top-rule`: frame = lines + 2 pt, rule 6 pt below, body 18 pt below the rule (one line: y 92).
- `band`: the band stays 108 pt tall (the classifier needs 96-120); body from y 120.
- `kicker-numeral`: body from y 120.
- `top-plain-large`: body 18 pt under the display title.
- Other treatments: unchanged.

### Over budget

An over-budget title moves the slide to another allowed treatment (with a `note:`); a pinned
`title:` that cannot hold it stops the compile. Wrapped titles break into near-equal lines, two words
on the last line where possible, a number kept with the next word.

Never reposition a title with a free box; that is a ninth, broken treatment.

## What the gate checks

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs qa deck.pptx
```

QA classifies titles by geometry, first match wins: `overlay`, `band`, `statement`, `bottom-anchor`, `side-rail`, `kicker-numeral`,
`top-plain-large`, `top-rule`; anything else is unclassified. The engine names the shape
`title@<id>`; the gate compares name and measurement and never trusts the name alone.

- OF-110: on decks of eight or more slides, fewer than three treatments (covers and sections
  excluded) or more than the variance dial allows fails; on any deck, an unclassified title or a
  name/geometry mismatch fails.
- OF-113: two slides with the same treatment whose title frames differ by more than 1 pt fail
  (statement titles compare x and w; bottom titles x, w and the bottom edge).
- OF-115: a bottom title whose text ends more than 12 pt above the floor, or a side rail more than 40 %
  empty under its title, fails. Rail text neither changes the side-rail reading nor counts as a body column.
- OF-119: an agenda drawn under `kicker-numeral` fails.
- OF-114: declarative titles and cover subtitles, as above.

OF-110 and OF-113 are advisories on a legacy template.
