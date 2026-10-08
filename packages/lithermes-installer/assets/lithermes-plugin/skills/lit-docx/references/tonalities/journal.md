# Journal tonality

Journal is the publisher-profile tonality: manuscript conventions of the publisher path (masthead,
abstract, two columns, decimal numbers, Times New Roman Latin body, no accent) for long reading that
is not being submitted.

## Use cases

Pick Journal for 칼럼, 뉴스레터, 백서, 연구 요약, long explainers and English essays of three pages or
more with few tables.

Otherwise:

- a submission or named journal: `--publisher elsevier`, `acs`, `ieee` or `nature`;
- a run of wide tables: Report; a briefing, memo or procedure: not two columns.

## Structure

- **Page 1, masthead.** Optional label and date line, title, muted standfirst, authors and
  organisation, numbered affiliations and corresponding address if given, one ink rule, `notice:`
  once, then 초록 / 주요어 or Abstract / Keywords. Columns start below on the same page.
- **Summary.** The abstract is the summary: no summary section, no key-figure strip. The first body
  paragraph says what the piece argues and for whom.
- **Numbering.** h1 `1`, h2 `1.1`, plain ink. References or further reading close the piece as a
  numbered list under an unnumbered heading.
- **Components:** `callout` only (definition, caveat, method note), a 1 pt ink rule on the left, no
  fill; other directives print as text.
- **Wide material.** A table of four or more columns spans both columns with its caption; up to three
  columns stays in the column. Figures take the column width.
- **Running head.** From page 2: short title top left, folio top right.
- **Contents.** None.

## Tokens

Pack defaults, density 9 and variance 6, from `journal.yaml`; `accent_on` is empty. Fill and spacing follow the page-composition reference.

| Token | Value |
|---|---|
| Page | A4; margins 25 / 27 / 25 / 25 mm; two columns, 6 mm gutter |
| Body | Times New Roman (Latin) and Pretendard (Hangul), 10.5 pt, ragged right |
| Pitch | Latin 133 % (multiple about 1.16 in Times New Roman), Hangul 175 % (1.14 in Pretendard) |
| Ramp | h1 1.3×, h2 1.15×, h3 body size bold, in Pretendard; title 2.5× |
| Ink | `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | none |
| Tables | booktabs, 9.5 pt, bold header, numbers right-aligned |
| Figures | at most 0.40 of the frame height, column width |

Density 7 for a printed white paper (check three-column tables still fit); 10 for a fixed page count.

## Do and avoid

| Do | Avoid |
|---|---|
| plan one callout kind on the direction card | a sidebar, strip or quotation box |
| move a run of wide tables to an appendix part | five page-spanning tables in a row |
| write short lists as a sentence | single-word bullets that leave half a column empty |
| headings as labels: Membership growth by district | Membership doubled in two years |

## Source excerpt

```markdown
---
title: Community Solar Cooperatives after Five Years
subtitle: Membership, output and governance in four districts
authors: [A. Rivera, J. Okafor]
organization: Example Energy Lab
date: 2026-09-21
abstract: We compare four cooperatives on membership, delivered output and board turnover. (sample)
keywords: [community energy, cooperatives, governance]
tonality: journal
---

# Data and scope

Board minutes and metered output were collected for 2021-2025 (sample). Section 2.2 explains how
shared rooftops were counted.

::: callout kind=note title="Metering caveat"
Two districts replaced their meters in 2023, so output before that year is estimated.
:::
```
