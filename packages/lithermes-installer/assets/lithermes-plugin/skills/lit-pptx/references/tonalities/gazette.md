# Gazette (`gazette`)

The Korean 보고서 page on a slide: a slate band heads each content page, a boxed one- or two-line
conclusion opens the argument, 개조식 evidence fills two columns, tables are gridded under a dark
header, and deep red marks only the key line. It is read at a desk, not presented.

## Pick it when

- The brief says sent ahead, circulated for 결재 or filed ("보고서", "사전 배포"): Gazette first in
  Korean, density 7 or more.
- Korean with long bodies (150 Hangul glyphs or more per slide); tables at 30 % or more.
- First candidate for Korean briefings, second for Korean reviews and status updates read before
  the meeting.

## Pass on it when

- A live talk (Signal, Night); an English desk read (Ledger); an image-led deck (Atlas).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F1F4F8 |
| ink, ink-muted, line | #1A2230, #4A5568, #C8D0DA |
| accent (key line), accent-deep, accent-tint | #A61B1B, #233A4F, #E8EEF4 |
| field, on-field | #233A4F, #FFFFFF |
| positive, negative | #1E7A3F, #1A2230 |
| series | #A61B1B, #233A4F, #4A5568, #7A6A2A |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label) |
| ramp | compact (body 13, label 11, source 9, title 26 pt); up to 22 lines a column |
| density, variance | 10, 4 (three treatments at most; variety from body families) |
| radius, edge | 0, fill and border |
| decoration | header-band (108 pt, body from 120 pt), box-outline, hairline-rule, numeral |

## Title treatments by role

Allowed: `band`, `top-rule`, `kicker-numeral`, `side-rail`. Defaults: content, statement → band;
data, reference → top-rule; data-takeaway, image, definition → side-rail; sequence →
kicker-numeral.

## Families and display slides

Families: `summary-box-list`, `text-two-column`, `text-column`, `ledger-table`, `table-insight`,
`comparison`, `timeline`, `matrix-2x2`, `agenda`, `references-appendix`.

- `summary-box-list`: a `::: key-message` box, then bold-headed groups of numbered sub-points.
  `matrix-2x2`: cells `항목 · 세부 · 세부`, takeaways beside the quadrants.
- Covers `cover-band`, `cover-typographic`, `cover-index`; sections `section-band` (part index in
  the band), `section-rule`; closings `closing-decision-box` (건의 사항 as deadline rows),
  `closing-ask`.
- Display devices: cover `band`, number `outline`, closing `box`, deck index on.
- Table: field header with white labels, 0.75 pt grid on every cell, first column on the surface
  tint, numbers right-aligned, bold totals. Chart: hairline grid, direct labels, key series in
  accent. Image: hairline frame.
- Fill order: step-up, distribute, change-family, anchor-visual.

## Do

- Conclusion in the summary box; the title stays a label ("검토 결과 요약과 건의안").
- 개조식: level one the claim, level two the evidence, at most five items, consistent endings.
- Caption tables with period, unit and source; `출처:` on data pages, `주:` for definitions.
- Timelines with owner and output; close with what, who, by when; end with a 붙임 page.

## Avoid

- English section kickers or labels on a Korean page.
- Red for anything other than the key line.
- A summary box longer than three lines.
- More than three text families in a row.
- The `statement` family; a single claim belongs in the summary box.

## Worked slide

The summary page.

```markdown
---
layout: summary-box-list

## 공용차량 운영 방식 검토 요약

::: key-message
공용차량 34대 중 12대를 줄이고 카셰어링 법인 계약으로 대체하는 안을 건의
:::

- **현황**
  (1) 차량 34대 평균 가동률 41%, 10대는 20% 미만 (예시)
  (2) 연간 유지비 3억 1천만 원, 대당 912만 원
- **대안 비교**
  (1) 감차 후 법인 카셰어링 연 1억 2천만 원 예상
  (2) 출장 수요의 88%가 4시간 이하 단거리
- **시행 조건**
  (1) 감차 대상은 가동률 하위 12대, 2027년 1월 매각
  (2) 현장 부서 3곳은 전용 차량 유지
---
```

## Examples in this skill

```text
references/examples/07-briefing-gazette-ko.md
references/examples/12-status-update-gazette-ko.md
```
