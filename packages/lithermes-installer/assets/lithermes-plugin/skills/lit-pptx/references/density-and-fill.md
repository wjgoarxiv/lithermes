# Density and fill

Density sets how much a page holds; variance sets how many treatments and families a deck mixes.
Both run 1-10 from the pack's values; the agent may move either by up to 2 and records it on the
direction card. Fill starts with authoring (last section).

## Density steps

| Density | Grid, 16:9 side margin | Ramp | Body pt | Gaps item / group / block | Padding | Min table row | Empty band allowed |
|---|---|---|---|---|---|---|---|
| 1-2 | airy, 60 | presented | 24 for ≤ 4 items, else 18 | 18 / 36 / 48 | 24 | 36 | 0.28 |
| 3-4 | standard, 48 | presented | 18, may step to 24 | 12 / 24 / 36 | 24 | 32 | 0.24 |
| 5-6 | standard, 48 | reading | 14, may step to 18 | 6 / 18 / 24 | 18 | 24 | 0.18 |
| 7-8 | dense, 36 | reading | 14, may step to 18 | 6 / 12 / 24 | 12 | 22 | 0.14 |
| 9 | dense, 36 | reading | 14 | 6 / 12 / 24 | 12 | 20 | 0.12 |
| 10 | compact, 24 | compact | 13 | 6 / 12 / 18 | 12 | 18 | 0.12 |

Compact ramp: source 9, label 11, body 13, lead 18, title 26, display 36, cover 44 pt; 22 lines per
column. Every pack starts at 10, where nothing is enlarged to fill. Readable floor: body ≥ 12 pt,
table cells ≥ 11 pt, captions and sources ≥ 9 pt. For a large room, drop to 8 (body 14 pt).

## Variance steps

| Variance | Treatments per deck | Same family in a row |
|---|---|---|
| 1-3 (user request only) | 1-2; the gate records "variety lowered by the user" | no limit |
| 4 | 3 | ≤ 3 |
| 5-6 | 3-4 | ≤ 3 |
| 7-8 | 4-5 | ≤ 2 |
| 9-10 | 5 | ≤ 2, and ≤ 2 of one family per deck |

Capped also by the pack's treatment count.

## Fill policies

Over its band, a slide walks the pack's `fill-order`, keeping a step only without overflow:

- `step-up`: body one ramp step (presented 18 → 24, reading 14 → 18), table data label → body, KPI
  values one step; once only, titles never shrink, off at density 10.
- `distribute`: item, group, block gaps up one step, body top fixed, peer rows equal, never centred.
- `anchor-visual`: the visual takes the rest of the body; table rows up to 1.25× the minimum.
- `change-family`: the author's step; the log says "choose a fuller family".

Each attempt goes into the build log:

```text
fill: slide 6 band 0.37 -> 0.11 (distribute, anchor-visual)
fill: slide 11 band 0.44 -> 0.44 (none: nothing here can grow; choose a fuller family)
```

Fill also steers title choice (`title-treatments.md`). No decoration or card padding covers space.

## Readouts

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs qa deck.pptx
```

- Bottom band: the fraction of the body (under the title, or the top margin for a low title, to
  486 pt) below the last content block; decoration, footer and notices excluded; covers, sections,
  statements, quotes and closing statements exempt.
- OF-112: a slide over its cap is an advisory; the deck fails when the median band exceeds 0.20
  (advisory on a legacy template).
- OF-109: any single slide or card leaving more than 35 % of its area as one empty band fails.
- OF-111: one composition on more than 40 % of content slides, or too few compositions, fails.
- `fill.coverage` (render audit): mean ink-edge share of the safe area, no threshold; compare builds.

A column can stand empty beside a full one while the body's last block reaches the floor: two short
takeaways beside a chart, a source line at the foot, nothing between. The engine fills a column whose
largest empty band passes 40 % of the body, by layout only: the visual takes columns (down to a
three-column takeaway); the takeaways step up to lead size; the room left is shared between points
(at most a sixth of the body a gap); two short points run under the chart, side by side; a short
sidebar note stands across the top over two columns of main points. OF-115 measures the same band
(a chart's values table under the takeaways counts with them; beside figure rows, down to the floor).

A slide that cannot honestly fill may stay over its cap while the median holds. Shrinking text,
inflating cards or adding shapes to pass is a defect.

## Authoring for density

- Every content slide: basis, comparison (prior period, plan, peer), period, source, implication or
  next action.
- Every data slide ends with `출처: …` / `Source: …` (origin, date), optionally `주: …` / `Note: …`;
  the engine sets them as a source-size strip at the body's foot.

  ```markdown
  - 3분기 누수율은 계획보다 0.6%p 낮음 (예시)
  출처: 시설관리팀 월간 계량 집계, 2026. 9. 30. 기준 (예시)
  주: 누수율 = (공급량 − 유수수량) ÷ 공급량
  ```

- `kpi-row`: four to six figures, second row each basis ("전년 동기 18.2%", "목표 15%"), at most title
  size. `big-number`: two to four figures with basis row, caption with period and source, 2-3
  evidence lines.
- Where the source allows: tables 5-8 rows × 4-6 columns, charts 5-8 categories, comparisons 3-4
  criteria a side with matching labels ("비용: …", "공기: …").
- Chart data tables carry exact values, units in headers.
- Every table and chart: 2-3 takeaways; charts a caption marking sample data. Tables of ≤ 3 rows
  usually become `kpi-row` or `comparison`.
- Processes and timelines say what happens at each step; a timeline takes 2-3 takeaways.
  References: 8-10 dated entries.
- Closing: label names the request; items with amount, date, owner; next step. "감사합니다" alone is
  not a closing.
- Merge before padding; filler bullets restating the label are a defect. Title labels:
  `title-treatments.md`.
