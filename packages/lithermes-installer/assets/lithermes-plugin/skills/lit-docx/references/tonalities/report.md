# Report tonality

Report is the document an organisation files and returns to. In Korean it is institute prose, the
register of a public research institute's policy paper: argued paragraphs, citable numbered parts,
tables holding the numbers. The title rule and the callout rules are its only colour.

## Use cases

Pick Report for results reports (분기 실적, 사업 결과), evaluations and audits, analyses with tables and
figures, and any document of four to thirty pages read part by part.

Otherwise:

- read to the conclusion in three pages: Brief; a notice under two pages: Memo;
- steps and warnings: Manual; continuous reading: Journal; a submission: the publisher profile;
- government 개조식 (□ ○ -, ~함/~임): not a Report variant; use Brief, or write it on explicit request.

## Structure

- **Page 1, typographic title block, no cover page.** Kind label left (`kicker=`, such as 현안 분석)
  and date right (`2026. 10. 5.`) on one line; title, muted subtitle, author and organisation, one
  accent rule, `notice:` once. The summary begins on the same page.
- **Contents** from about five pages (h1, dotted leader, page), before the summary.
- **Summary.** `# 요약` / `# Summary` in prose, the result in its first two to four sentences. The one
  key-figure strip follows that first paragraph; the decision callout, if any, comes after it.
- **Numbering.** Korean Ⅰ. (h1), 1. (h2), 가. (h3); English 1 and 1.1. Plain ink at heading size,
  added by the engine.
- **Components:** `keyfigures` (scale before argument), `callout` (decision request first),
  `columns` (two near-equal options).
- **Evidence.** A typical part: a booktabs table, the sentence that reads it, a short analysis.
- **Running head.** Footer from page 2: short title left, folio right. Nothing in the header.
- **Close.** `# 향후 과제` / `# Next steps` with an owner, action and date table when follow-up is
  asked.

## Tokens

Pack defaults, density 9 and variance 5, from `report.yaml`. Pitch, paragraph spacing and fill follow the page-composition reference.

| Token | Value |
|---|---|
| Page | A4; margins 25 / 27 / 25 / 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt, Korean justified, English ragged right |
| Ramp | h1 1.4× (about 14.5 pt), h2 1.2× (12.5 pt), h3 10.5 pt bold, title 2.5× |
| Ink | `#1A1A1A` body and headings; muted `#555555`; rules `#8C8C8C` |
| Accent | navy `1F3A5F` on the title rule and the callout rule only |
| Tables | booktabs, 9.5 pt at 140 %, bold header, numbers right-aligned |
| Figures | at most 0.45 of the frame height |

Density 10 for a report one page over; density 7 for a looser printed copy. Body stays 10.5 pt.

## Do and avoid

| Do | Avoid |
|---|---|
| headings as labels: 진료과별 접수 대기 | 접수 대기가 30% 줄었다 |
| let each part carry its table and the sentence that reads it | a page holding one table and nothing else |
| one strip of three comparable metrics, each with a basis | a second strip lower down (it prints as a list) |
| one boxed decision request | callouts framing ordinary paragraphs |

## Source excerpt

```markdown
::: cover kicker="평가 보고"
:::

# 요약

두 외래 진료과의 무인 접수기 시범 운영 3개월 동안 평균 접수 대기는 4.2분으로 줄었다(예시).

::: callout kind=key title="연장 승인 요청"
시범 운영을 내과까지 넓히는 안을 11월 운영 위원회에서 결정해 주시기 바랍니다.
:::

# 진료과별 운영 결과

표 1. 진료과별 평균 접수 대기 (예시)

| 진료과 | 도입 전 (분) | 도입 후 (분) |
|---|---|---|
| 정형외과 | 7.9 | 4.4 |

자료: 병원 접수 기록 (예시)
```
