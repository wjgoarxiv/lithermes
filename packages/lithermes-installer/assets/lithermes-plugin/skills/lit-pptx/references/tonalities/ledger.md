# Ledger (`ledger`)

A statement of accounts made readable: small exact type, tabular figures, tables and figure rows
carrying the argument. The green-teal accent marks only the current period and the one figure that
matters.

## Pick it when

- Business reviews, result packs, status updates and data appendices read line by line.
- Table or chart share of 30 % or more (Ledger up one place); long bodies (150 Hangul glyphs or
  300 Latin characters per content slide).
- A non-Korean deck sent ahead and read alone (the role Gazette plays in Korean).

## Pass on it when

- A live pitch with little data (Signal); a Korean desk read (Gazette); a dark keynote room (Night).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F2F4F6 |
| ink, ink-muted, line | #16212C, #4B5866, #D0D6DC |
| accent, accent-deep, accent-tint | #0E6B5A, #0A4438, #E2F0EC |
| field, on-field | #0A4438, #FFFFFF |
| positive, negative | #1E7A3F, #B3261E |
| series | #0E6B5A, #4B5866, #9A6A12, #2F5F8A |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label) |
| ramp | compact: source 9, label 11, body 13, lead 18, title 26 pt; figures ≤ title size |
| density, variance | 10, 5 (density 8-9 for a room, noted on the card) |
| radius, edge | 0, fill |
| decoration | accent-rule, hairline-rule, rail-fill, numeral |

## Title treatments by role

Allowed: `top-rule`, `side-rail`, `kicker-numeral`, `bottom-anchor`. Defaults: content, data,
reference → top-rule; data-takeaway, statement, definition → side-rail; sequence →
kicker-numeral; image → bottom-anchor. No statement title: a claim becomes a labelled content
slide. Override with `title: <treatment>` on the line after `layout:`.

## Families and display slides

Families: `kpi-row`, `kpi-over-chart`, `dashboard-grid`, `ledger-table`, `table-insight`,
`chart-insight`, `full-chart`, `big-number`, `comparison`, `timeline`, `matrix-2x2`, `agenda`,
`text-two-column`, `references-appendix`.

- Covers `cover-figures`, `cover-typographic`, `cover-index`; sections `section-rule` (index page
  with an agenda), `section-numeral`; closings `closing-decision-box`, `closing-ask`.
- Display devices: cover `figures`, number `tint`, closing `box`, deck index on.
- Table: field header with white labels, hairline under the header and above totals, no banding,
  right-tabular numbers, bold totals. Chart: hairline grid, direct labels, this period in accent
  over muted ink, annotations on. Image: side bleed only, no crop, hairline frame.
- Fill order: step-up, distribute, anchor-visual, change-family.

## Do

- Give every KPI figure a basis row (계획 대비, prior period, target); four to six figures a row.
- Tables of five to eight rows with a `>` caption naming unit, period and source.
- End data slides with `출처:` / `Source:`; add `주:` / `Note:` where a definition matters.
- Mark direction with ▲ ▼ beside the sign; close with a decision table (item, amount, owner, date).

## Avoid

- KPI cards for counts that are not results.
- More than one accent on a chart.
- Tables stretched by padding.
- The side rail on two data slides in a row.

## Worked slide

A result row with its basis row and a short reading.

```markdown
---
layout: kpi-row

## 9월 물류센터 운영 지표

| 출고 건수 | 당일 출고율 | 오출고율 | 건당 처리 비용 | 인력 가동률 |
|---|---|---|---|---|
| 412,000건 | 96.4% | 0.21% | 1,180원 | 88% |
| 8월 387,000건 | 목표 95% | 8월 0.34% | 8월 1,240원 | 계획 85% |

> 2026년 9월 1-30일, 3개 센터 합산 (예시)

- 출고는 6.5% 늘었고 당일 출고율은 목표를 1.4%p 넘었다
- 오출고율은 바코드 재검수 도입 뒤 0.13%p 내려갔다
- 출처: 예시 물류 운영 시스템 일별 집계, 2026년 8-9월 (예시)
---
```

## Examples in this skill

```text
references/examples/02-business-review-ledger-ko.md
references/examples/08-status-update-ledger-en.md
```
