# Newsroom (`newsroom`)

Data journalism for a general reader: a black masthead band or a heavy rule at the title, charts
in greys with one orange series, direct labels and the source under every figure. For explainers,
public briefings, newsletters and data stories told to people who do not read tables.

## Pick it when

- Explainers, public briefings, newsletters, data stories for a general audience.
- One story per chart, a finding (what changed, by how much, since when) up front, sources
  under every figure.

## Pass on it when

- An internal dense review (Ledger), a pitch (Signal) or a lecture (Chalk).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FBFAF7, #EEEDEA |
| ink, ink-muted, line | #111111, #55534D, #CCCAC5 |
| accent, accent-deep, accent-tint | #C2410C, #7C2A08, #FBE3D3 |
| field, on-field | #111111, #FFFFFF (masthead band) |
| positive, negative | #1F6B3A, #111111 (losses in ink with ▼) |
| series | #C2410C, #77746C, #2F5D8A, #111111 |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label); `faces: a2z` swaps to A2Z Bold display, titles and numerals |
| ramp | compact at density 10 (body 13, title 26, display 36, cover 44 pt); hero step on fitting cover and statement titles |
| density, variance | 10, 6 |
| radius, edge | 0 / fill |
| decoration | hairline-rule, column-hairlines, numeral (the masthead band is the `band` title) |

The orange holds 5.2:1 on the paper, so it can set a kicker word or a figure. The second series
is a warm grey, the third a quiet blue for the one line a story compares against. Rules and
surfaces are neutral greys: a warm-tinted rule reads as a second hue family beside the orange.
No `qa:` allowance beyond the default craft floor; the source line under every figure is the
house rule, and the gate's source checks already ask for it.

## Title treatments by role

Allowed: `band`, `bottom-anchor`, `top-rule`, `kicker-numeral`, `statement`. Defaults: data →
band (title in white on the black masthead band); data-takeaway, image → bottom-anchor (title
over a heavy black rule); content, reference, definition → top-rule; sequence → kicker-numeral;
statement → statement. Every treatment draws in the slide grid's one title zone, so a band, a
bottom-anchor and a top-rule title sit at the same place.

## Families and display slides

Families: `full-chart`, `chart-insight`, `kpi-over-chart`, `big-number`, `kpi-row`,
`table-insight`, `comparison`, `timeline`, `image-split`, `figure-pair`, `text-two-column`,
`sidebar-note`, `references-appendix`, `quote`, `statement`.

- Covers `cover-typographic`, `cover-figures`, `cover-index`; sections `section-rule`,
  `section-numeral`; closings `closing-summary-list`, `closing-statement`, `closing-ask`.
- Display devices: cover `band` (deck title in white on the black masthead band, parts on the
  paper under it), statement `rules` (sentence between two rules), number `tint`, closing
  `rules`; a deck index runs along the top of the display slides.
- Table: open, no header fill, rule under the header, bold totals. Chart: horizontal gridlines,
  direct labels, accent on the story's series over greys. Image: no frame.
- Fill order: anchor-visual, change-family, distribute, step-up.

## Do

- Name the topic and its period in the title; put the finding (what changed, by how much, since
  when) in the first body line.
- Colour one series orange and leave the rest grey.
- Put the source and the period under every chart and table.
- Label lines and bars directly; a legend is for a chart that cannot take labels.

## Avoid

- More than one highlighted series on a chart.
- A chart without its source and period.
- 3D, gradients or pictograms standing in for numbers.
- This direction for a pitch, a lecture or an internal dense review.

## Worked slide

A full chart names its topic, keeps one orange line and states the finding under it.

```markdown
---
layout: full-chart

## 매매가 대비 전셋값 비율, 2023-2026년

::: chart type=line unit="%"
| 연도 | 우리 구 (%) | 시 평균 (%) |
|---|---|---|
| 2023년 | 55.2 | 56.0 |
| 2024년 | 57.1 | 56.8 |
| 2025년 | 59.4 | 57.9 |
| 2026년 | 61.3 | 58.6 |
> 매매가 대비 전셋값 비율, 해마다 6월 (예시 자료)
:::

- 우리 구의 전셋값이 처음으로 매매가의 60%를 넘었다
- 출처: 예시 구청 주택 통계, 2026년 (예시)
---
```

## Example in this skill

```text
references/examples/17-public-data-briefing-newsroom-ko.md
```
