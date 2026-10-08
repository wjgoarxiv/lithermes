# Manual tonality

Manual is read with the other hand on the machine: numbered parts, ordered steps, one warning style,
the only sidebar and the only header title among the packs.

## Use cases

Pick Manual for 설치 안내서, 정비 절차서, 운영 매뉴얼, onboarding guides and reference documents of
settings, codes and limits.

Otherwise:

- results rather than instructions: Report; a one-page procedure notice: Memo;
- approval needed before anyone acts: Brief first, the manual afterwards.

## Structure

- **Page 1, title over a document-control block.** Optional label line (`kicker=`, such as 정비
  절차서), title, subtitle in muted ink, then a two-column block between two ink hairlines: 문서 /
  작성 부서 / 기관 / 시행일 (English: Document / Owner / Organisation / Issued), filled from
  frontmatter `short_title` (or `title`), `author`, `organization` and `date` in the form
  `2026. 10. 5.`. The notice follows once. No cover page.
- **Contents** from about five pages, under the control block.
- **Summary.** `# 개요` / `# Overview`: scope, audience, prerequisites (permissions, tools, time).
- **Numbering.** h1 `1`, h2 `1.1`, plain ink at heading size. Procedures are ordered lists, one action
  per item, the expected result in the next sentence.
- **Components:** `callout` (one warning style, right before the step it protects), optional
  `sidebar` (terms or a method note), `columns` (two symptom-and-action groups). No key figures.
- **Reference tables** in booktabs with units; a long table may break between rows with its header
  repeated.
- **Running head.** From page 2: short title top left, folio foot right.

## Tokens

Pack defaults, density 9 and variance 6, from `manual.yaml`. Pitch, paragraph spacing and fill follow the page-composition reference.

| Token | Value |
|---|---|
| Page | A4; margins 25 / 27 / 25 / 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt, ragged right in both languages (steps and codes read better unjustified) |
| Ramp | h1 1.35× (about 14 pt), h2 1.15× (12 pt), h3 10.5 pt bold, title 2.5× |
| Ink | `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | slate `2E4A66` on the callout rule and the sidebar rule only |
| Control block | 9.5 pt, bold labels, between two 0.5 pt ink hairlines |
| Tables | booktabs, 9.5 pt, bold header, numbers right-aligned |
| Figures | at most 0.45 of the frame height |

Density 7 for a guide read at a bench; 10 for a reference held to a page count.

## Do and avoid

| Do | Avoid |
|---|---|
| one action per numbered step, result in the next sentence | three actions in one step |
| the warning right before the step it guards | a warnings section at the end |
| sidebar for definitions shorter than the text beside it | steps inside a sidebar |
| headings as labels: 회전자 분리 절차 | 회전자를 먼저 분리한다 |

## Source excerpt

```markdown
# 회전자 분리 절차

정기 점검 때마다 회전자를 분리해 균열을 확인한다. 작업 시간은 약 20분이다(예시).

::: callout kind=warning title="회전부 정지 확인"
덮개는 회전이 완전히 멈춘 뒤에 연다.
:::

1. 전원 스위치를 끄고 전원 플러그를 뽑는다.
2. 덮개 잠금을 풀고 덮개를 끝까지 연다. 덮개가 열린 상태로 고정된다.
3. 회전자 고정 나사를 시계 반대 방향으로 두 바퀴 푼다.

::: sidebar title="용어"
회전자: 시료관을 끼워 돌리는 원형 부품.
:::
```
