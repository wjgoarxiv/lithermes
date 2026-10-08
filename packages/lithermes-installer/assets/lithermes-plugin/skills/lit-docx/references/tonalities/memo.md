# Memo tonality

Memo is the lightest pack, plain on purpose: no cover, components, numbering, contents or accent.
One or two pages.

## Use cases

Pick Memo for 공지, 안내문, internal memos, short requests and letters of one or two pages.

Otherwise:

- a decision with its reasons laid out: Brief;
- over two pages or several tables (or `component.variety` fires): Report.

## Structure

- **Page 1, the memo block.** A small bold label in muted ink (the `kicker=`, or 메모 / Memo), the
  subject as title at about 1.8 times the body, then recipient rows between two 0.5 pt ink hairlines.
  Write the rows inside `::: cover` as `Key: value` pairs joined by ` · `. Recognised keys: `To`,
  `From`, `Date`, `Subject`, `Cc`, `받는 사람`, `보내는 사람`, `날짜`, `제목`, `참조`. Without a date row
  the frontmatter date is inserted after the sender as `2026. 10. 5.`. English values start with a
  capital. Other lines become the opening paragraph; `notice:` prints once below.
- **Summary.** None as a section: the opening paragraph states the news or the request and its date
  in two sentences.
- **Numbering.** None. Many memos need no headings; two to four plain ones (`# 배경`, `# 요청 사항`,
  `# 일정`) are the most a memo carries.
- **Components.** Zero; a callout prints as a bold lead line, the memo's way to mark the request. The
  card lists "none".
- **Tables.** One booktabs table at most.
- **Running head.** Folio from page 2, foot right.

## Tokens

Pack defaults, density 9 and variance 2, from `memo.yaml`, with `spacing: tight`: the low end of the line pitch (Hangul 165 %, Latin 120 %), closer heading space and table cells, so a memo that can fit one page does; `memo.fit` fails a spill under a quarter page. Paragraph spacing and fill otherwise follow the page-composition reference. No accent: ink, muted ink and a grey rule.

| Token | Value |
|---|---|
| Page | A4; margins 25 / 27 / 25 / 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt Korean, 11 pt English; Korean justified |
| Ramp | h1 1.2×, h2 1.1×, h3 body size bold; subject title 1.8× |
| Ink | `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Memo block | 9.5 pt Korean / 10 pt English, bold labels, two 0.5 pt ink hairlines |
| Tables | booktabs, 9.5 / 10 pt, bold header, numbers right-aligned |

Density 7 for a signed letter; 10 for a memo three lines over (cutting is better).

## Do and avoid

| Do | Avoid |
|---|---|
| the request and its date in the first two sentences | background first, request on page 2 |
| a bold lead line for the one thing to act on | planning a callout or key figures |
| rows written as `Key: value · Key: value` | a hand-made table for To / From |
| subject as a label: 지하 주차장 보수 공사 안내 | 주차장 공사가 시작됩니다 |

## Source excerpt

```markdown
---
title: 지하 주차장 보수 공사 안내
date: 2026-10-05
tonality: memo
notice: 일정과 구역은 예시입니다.
---

::: cover kicker="공지"
받는 사람: 본관 입주 직원 · 보내는 사람: 시설관리팀 · 제목: 지하 2층 주차 제한
:::

10월 19일부터 31일까지 지하 2층 바닥 방수 공사로 해당 층 주차가 제한된다(예시). 이 기간에는 지하 3층과 별관 주차장을 이용해 주시기 바랍니다.

# 일정

공사는 평일 오후 8시부터 다음 날 오전 6시까지 진행한다.
```
