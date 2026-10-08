# Proposal tonality

Proposal asks someone to fund or approve a plan. It is the one pack with a cover page, always
typographic, and its body turns on one decision box and a budget table.

## Use cases

Pick Proposal for 사업 제안서, 기획서, 추진 계획서, grant and funding requests and internal investment
cases.

Otherwise:

- mostly evidence about the past, or long enough for contents: Report;
- a two-page decision read to the conclusion: Brief.

## Structure

- **Page 1, typographic cover.** The label (`kicker=`, such as 사업 제안서), the title left-aligned
  about a fifth of the way down, a short accent rule, the subtitle, the lead paragraph written inside
  `::: cover`; byline, date (`2026. 10. 5.`) and `notice:` at the foot. Body from page 2, numbered 1.
- **Summary.** `# 제안 요약` / `# Summary` in prose: the request in one sentence, then why now. The key
  figure strip (cost, time, result) follows the first paragraph; figures written inside the cover are
  moved there.
- **Numbering.** None; levels part by weight and space.
- **Components:** `keyfigures` (the numbers to accept), `callout` (one decision box: ask and date),
  `columns` (e.g. measurable and non-measurable effects).
- **Budget and schedule.** `# 소요 예산` and `# 추진 일정` as booktabs tables, the total row bold under a
  thin rule, the unit hoisted to `(단위: 백만 원)` when every amount column shares it.
- **Running head.** Folio centred at the foot; nothing on the cover, no header.
- **Contents.** None.

## Tokens

Pack defaults, density 8 and variance 6, from `proposal.yaml`. Pitch, paragraph spacing and fill follow the page-composition reference.

| Token | Value |
|---|---|
| Page | A4; margins 26 / 28 / 26 / 26 mm; text block 158 mm |
| Body | Pretendard 10.5 pt Korean, 11 pt English; Korean justified |
| Ramp | h1 1.4×, h2 1.2×, h3 body size bold; cover title 2.7× |
| Ink | `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | wine `6E2639` on the cover title rule and the callout rule only |
| Key figures | h2 size, bold ink over an ink hairline, three per row |
| Tables | booktabs, 9.5 pt Korean / 10 pt English, bold header, numbers right-aligned |
| Figures | at most 0.60 of the frame height |

Density 6-7 for a printed hand-over; 10 under a page limit. Body stays 10.5 pt.

## Do and avoid

| Do | Avoid |
|---|---|
| one decision box with the amount and the date | a box in every section |
| key figures the reader is asked to approve, each with a basis | a non-metric such as "역량 강화" in the strip |
| savings computed from the same baseline as the cost | an effect inflated by mixing periods |
| headings as labels: 소요 예산과 회수 기간 | 2년 안에 투자금을 회수함 |

## Source excerpt

```markdown
::: cover kicker="사업 제안서"
:::

# 제안 요약

현재 자체 교육 서버를 2027년 1월부터 구독형 플랫폼으로 교체하는 데 1억 2천만 원을 요청한다(예시).

::: callout kind=key title="승인 요청"
교체 예산 1억 2천만 원을 12월 예산 심의에서 승인해 주시기 바랍니다.
:::

# 소요 예산

표 1. 항목별 소요 예산 (예시)

| 항목 | 2027년 (백만 원) | 2028년 (백만 원) |
|---|---|---|
| 구독료 | 54 | 54 |
| 이관 용역 | 12 | 0 |
| 합계 | 66 | 54 |

자료: 구매팀 견적 (예시)
```
