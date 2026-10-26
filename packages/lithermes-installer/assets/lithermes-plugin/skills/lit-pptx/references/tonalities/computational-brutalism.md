# Computational Brutalism (`computational-brutalism`)

A deck about a system, told to the people who build or run it: terminals, plotter paper and
engineering drawings. The twelve-column grid is marked in the top margin with numbered ticks,
every content slide carries its index as `[03/08]`, titles, labels and figures are set in a
monospaced face, tables are ruled on every edge, and one electric-blue signal marks the figure
that matters. Body text stays in Pretendard and every mark sits on the grid it shows.

## Pick it when

- Architecture reviews, infrastructure or reliability reports, developer-tool or AI-system launches
  for engineers, benchmark write-ups, incident retrospectives, hackathon demos.
- Metrics with units (p99 latency, throughput, error budget, GPU hours), version numbers and
  identifiers, code or command names in the text, before-and-after measurements.
- An audience that reads a table faster than a sentence; a deck read again after the meeting.

## Pass on it when

- A board, investor committee, finance or public-sector report (grid marks read as unfinished work).
- Long Korean reading (mono sets Latin and figures only; Hangul titles lose the look but keep the width cost).
- Consumer marketing, grief, safety or HR topics; a deck under a corporate brand guide.
- A quiet data review (Ledger, Night); an investor pitch (Signal, Neo-Brutalism).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #EEEDE7, #E2E1D9 |
| ink, ink-muted, line | #111111, #4D4C47, #9A988F |
| accent, accent-deep, accent-tint | #1F43E0, #14267A, #D9DEF2 |
| field, on-field | #111111, #8CF5A6 (phosphor green on the terminal field) |
| positive, negative | #1C6B35, #B3261E |
| series | #1F43E0, #111111, #7A786F |
| faces | JetBrains Mono Bold (display, title, numeral), JetBrains Mono Regular (label), Pretendard Regular (body); Hangul inside a mono run is set in Pretendard; no A2Z map |
| ramp | compact at density 10 (body 13, title 26, display 36, cover 44 pt); hero step on fitting cover and statement titles |
| density, variance | 10, 7 |
| radius, edge | 0, border 1 pt in ink |
| decoration | hairline-rule, column-hairlines, box-outline, grid-marks, numeral |

Density 10 sets the deck on the compact grid (24 pt side margins), body 13 pt and no step-up.
The mono face is wider than Pretendard, so the engine measures every mono title at its own width
before it chooses a treatment; a long Latin title moves to a wider frame rather than shrinking.
The fonts ship with the skill under the SIL Open Font License 1.1 (no Reserved Font Name); the
official Regular and Bold files embed unmodified with `--embed-fonts`.

## Title treatments by role

Allowed: `top-rule`, `top-plain-large`, `side-rail`, `bottom-anchor`, `statement`. Defaults: content,
data, sequence, reference → top-rule; data-takeaway, image → bottom-anchor; definition → side-rail;
statement → statement. Pinned: `chart-insight` → top-rule, `table-insight` → bottom-anchor,
`comparison` → side-rail (spec sheet), `step-diagram` → top-plain-large (large mono headline).

## Families and display slides

Families: `dashboard-grid`, `kpi-row`, `chart-insight`, `full-chart`, `table-insight`, `ledger-table`,
`method`, `step-diagram`, `matrix-2x2`, `comparison`, `text-two-column`, `references-appendix`,
`quote`, `statement`.

- Covers `cover-typographic`, `cover-index`, `cover-figures`; sections `section-numeral`,
  `section-rule`; closings `closing-decision-box`, `closing-ask`, `closing-summary-list`.
- Display devices: cover `drench` (the terminal field edge to edge, topic in phosphor green
  anchored low), statement `drench` (sentence in phosphor on black), number `outline`,
  closing `box`. Grid marks and the slide index run on content slides only.
- Table: ruled grid on every cell, label-face header, bold totals, protagonist row on accent-tint.
  Chart: hairline gridlines, direct labels, accent on the highlighted series. Image: hairline frame.
- Fill order: change-family, distribute, anchor-visual, step-up.

## Do

- Give every figure its unit and its basis: `p99 182 ms`, `2026년 9월 기준`.
- Keep identifiers, versions and commands as written; the mono face is for them.
- Put one blue figure on a slide; everything else stays ink.
- Rule tables on every edge and right-align numbers.
- End on a decision box or an ask with owner and date.

## Avoid

- Body paragraphs in the mono face (the pack refuses a mono body).
- Fake code, fake terminal prompts or decorative binary strings.
- Grid marks or the slide index in the accent colour.
- A second accent; phosphor green belongs to the black field only.
- This direction for a board pack, a finance report or a sensitive topic.

## Worked slide

A latency review with the measured result, its basis and the detail in the table.

```markdown
---
layout: kpi-row

## API 게이트웨이 v3 전환 결과, 2026년 9월

| p99 지연 | 처리량 | 오류율 | 노드 수 |
|---|---|---|---|
| 182 ms | 41k rps | 0.07% | 24 |
| v2 410 ms | v2 18k rps | v2 0.31% | v2 40 |

> 운영 클러스터 4주 평균, 2026년 9월 (예시)

- 지연은 절반 아래로 줄었고, 노드는 40대에서 24대로 줄었다
- 오류율 0.07%는 SLO 0.1% 안쪽이다
- 출처: 예시 관측 대시보드, 2026년 9월 (예시)
---
```

## Example in this skill

```text
references/examples/13-engineering-review-computational-brutalism-ko.md
```
