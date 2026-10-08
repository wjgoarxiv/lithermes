# Night (`night`)

A screen in a dark room: blue-black ground, off-white type, amber accent with soft blue as second
series, large charts. Every slide in the deck stays dark.

## Pick it when

- Data reviews, platform and architecture talks, demo days, research keynotes on a big screen.
- A dark room in the brief (Night up); chart share of 30 % or more in a presented deck.
- Third candidate for stage business reviews and status updates.

## Pass on it when

- Printed or paper decks (Ledger, Paper); any slide that must be light; Korean desk reads (Gazette).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #0F1419, #1A222B |
| ink, ink-muted, line | #E8EDF2, #A3AEBA, #5A6672 |
| accent, accent-deep, accent-tint | #E3A857, #F2C98A, #2A2418 |
| field, on-field | #1E2A36, #F5F7FA |
| positive, negative | #6CC08B, #F08A7E |
| series | #E3A857, #7FB8E0, #A3AEBA, #C58FD0 |
| faces | Pretendard Bold (display, title), Regular (body, label, numeral) |
| ramp | compact (body 13, title 26 pt); figures ≤ title size |
| density, variance | 10, 6 (8-9 for a stage) |
| radius, edge | 6, fill |
| decoration | header-band, hairline-rule, numeral, rail-fill |

On the dark ground accent-deep is the lighter amber for emphasis text and accent-tint the dark wash
behind a highlighted row.

## Title treatments by role

Allowed: `top-plain-large`, `statement`, `side-rail`, `kicker-numeral`, `band`. Defaults: content,
image → top-plain-large; data, reference → band; data-takeaway, definition → side-rail; sequence
→ kicker-numeral; statement → statement.

## Families and display slides

Families: `full-chart`, `chart-insight`, `kpi-row`, `kpi-over-chart`, `dashboard-grid`,
`big-number`, `method`, `comparison`, `timeline`, `statement`.

- `dashboard-grid`: two charts side by side, takeaways under them. `kpi-over-chart`: a figure row
  with basis row over a trend chart.
- Covers `cover-numeral`, `cover-typographic`, `cover-figures`; sections `section-numeral`,
  `section-field`; closings `closing-statement`, `closing-decision-box`.
- Display devices: cover `numeral`, statement `open`, number `tint`, closing `band`.
- Table: surface header with ink labels, hairline rows in line colour, no banding, right-tabular,
  bold totals, highlighted row on accent-tint. Chart: hairline grid, direct labels, accent on the
  series that matters, annotations on. Image: side bleed, crop allowed, no frame.
- Fill order: anchor-visual, step-up, distribute, change-family.

## Do

- One chart per slide when the shape is the point (`full-chart`), takeaways under it.
- Units and windows in every caption; a basis row under each figure.
- Signed values with ▲ ▼, since green and coral blur on some projectors; definitions before the
  numbers are argued.

## Avoid

- Neon or saturated glows.
- A pure black ground.
- Light slides mixed into the deck.
- Thin light type below 18 pt.

## Worked slide

A figure row over its trend.

```markdown
---
layout: kpi-over-chart

## Build pipeline health, Q3 2026

| Median build | Failed builds | Flaky tests | Queue wait |
|---|---|---|---|
| 7.4 min | 3.1% | 41 | 52 s |
| Q2 9.8 min | Q2 4.6% | Q2 77 | Q2 2.3 min |

::: chart type=line unit="min"
| Month | Median build (min) |
|---|---|
| April | 10.2 |
| May | 9.9 |
| June | 9.3 |
| July | 8.1 |
| August | 7.6 |
| September | 7.4 |
> Median build time per month, main branch (sample data)
:::

- Remote caching cut the median by 2.4 minutes after July
- Source: Example CI metrics export, April-September 2026 (sample)
---
```

## Examples in this skill

```text
references/examples/05-data-review-night-en.md
references/examples/10-research-talk-night-ko.md
```
