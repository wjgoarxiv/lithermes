# Bauhaus (`bauhaus`)

The direction for a talk about making things: design, architecture, craft, art history, culture.
Display slides carry an elementary composition — a yellow square, a red circle, a black bar, a
blue triangle set on the grid — beside a heavy title on off-white. Content slides stay quiet:
black type, a short red rule under each title, open tables, one red accent. The geometry is the
voice: it appears where the deck speaks (cover, statements) and stays out of pages where the
audience reads.

## Pick it when

- Design or architecture lectures, museum or exhibition openers, workshops on brand or product
  design, culture programmes, design-school portfolio reviews, talks on the history of a style.
- Images and few numbers, sequences of ideas or periods, quotations from makers, words such as
  디자인, 건축, 전시, 워크숍, 바우하우스, Bauhaus, modernism, "primary colours". First candidate
  for a design or culture lecture; second for a creative workshop.

## Pass on it when

- Data-heavy business reviews, finance, public-sector reports, decks where tables make up a
  third of the slides. Grief, safety or financial-loss topics (primaries read as careless).
- Mostly pictures (Atlas, Studio frame them better); pitches (Signal, Neo-Brutalism).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #F4F1EA, #E8E3D6 |
| ink, ink-muted, line | #141414, #4A4740, #141414 |
| accent, accent-deep, accent-tint | #C8261C, #7A140E, #F2C230 (geometry yellow) |
| field, on-field | #1F3C99, #FFFFFF |
| positive, negative | #1E6B3A, #141414 (losses in ink with ▼) |
| series | #C8261C, #1F3C99, #141414, #9E7700 |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label); `faces: a2z` swaps to A2Z Black display, titles and numerals |
| ramp | compact at density 10 (body 13, title 26, display 36, cover 44 pt); hero step on fitting cover and statement titles |
| density, variance | 10, 7 |
| radius, edge | 0 / fill |
| decoration | accent-rule, numeral, colour-field |

Density 10 sets the lecture on the compact grid (24 pt side margins), body 13 pt and no step-up.
The fourth series colour is the geometry yellow darkened to an ochre so a bar holds 3:1 on the
ground; bright yellow stays in fills (the square, the notice tag, a highlighted table row), never
in text. Red, blue and yellow share a display slide inside the default OF-101 limit, so this pack
needs no `qa:` allowance.

## Title treatments by role

Allowed: `top-rule`, `side-rail`, `kicker-numeral`, `statement`, `bottom-anchor`. Defaults: content,
data, reference → top-rule (title over a short red rule); data-takeaway, definition → side-rail;
sequence → kicker-numeral; image → bottom-anchor; statement → statement.

## Families and display slides

Families: `asymmetric-feature`, `big-number`, `image-split`, `text-two-column`, `comparison`,
`process`, `step-diagram`, `timeline`, `chart-insight`, `table-insight`, `kpi-row`, `quote`,
`statement`, `agenda`.

- Covers `cover-typographic`, `cover-split-field`, `cover-numeral`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-summary-list`, `closing-statement`.
- Display devices: cover `geometry` (topic at display size on the left half, composition of
  square, circle, bar and triangle on the right), statement `geometry` (sentence on the left, a
  narrower composition from column 10 when the title leaves room), number `field`, closing
  `rules`.
- Table: open, no header fill, rule under the header, bold totals. Chart: no gridlines, direct
  labels, accent on the highlighted series. Image: no frame.
- Fill order: change-family, step-up, anchor-visual, distribute.

## Do

- Keep the geometry on the cover and the statements.
- Use one statement per section at most, so the composition stays an event.
- Caption every work with maker, year and source.
- Let red mark one word or one figure on a content slide.

## Avoid

- Circles, squares or triangles as bullets, icons or frames on content slides.
- Yellow text on the off-white ground.
- A fifth hue family beside the three primaries and the ink.
- This direction for a ledger, a finance review or a sensitive topic.

## Worked slide

A lecture slide pairs a building with what to see in it; the caption carries the source.

```markdown
---
layout: image-split

## 데사우 교사(校舍)의 세 가지 설계 원칙

![도 1. 데사우 교사 전경 | 출처: 예시 이미지](assets/example-a.png)

- **기능별 동** 공방, 교실, 기숙사를 각각의 동으로 나눠 다리로 잇는다
- **유리 커튼월** 공방 동의 외벽 전체가 유리라 작업이 밖에서 보인다
- **비대칭 배치** 정면이 없어, 걸으며 돌아봐야 전체가 읽힌다
- 출처: 예시 건축사 강의 자료, 2026년 (예시)
---
```

## Example in this skill

```text
references/examples/15-design-lecture-bauhaus-ko.md
```
