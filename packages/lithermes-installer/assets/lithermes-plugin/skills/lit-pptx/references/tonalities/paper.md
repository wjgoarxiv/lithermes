# Paper (`paper`)

A journal page projected: ink on white, hairlines instead of fills, figures first with numbered
captions, booktabs tables, and one crimson that always means the proposed method.

## Pick it when

- Research talks, defences, lab meetings, technical reviews, written analyses shown as slides.
- Numbered citations, DOIs or a references section (Paper up one place); equations or a method
  sequence (Chalk or Paper up).

## Pass on it when

- Sales, launch or donor audiences (Signal, Studio); a dark keynote room (Night); beginners (Chalk).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F5F5F6 |
| ink, ink-muted, line | #111418, #50565E, #C9CDD2 |
| accent, accent-deep, accent-tint | #8C1C2B, #5E121C, #F6E6E8 |
| field, on-field | #111418, #FFFFFF |
| positive, negative | #1E6B3A, #50565E |
| series | #8C1C2B, #111418, #50565E, #2E5E8A |
| faces | Pretendard Bold (display, title), Regular (body, label, numeral) |
| ramp | compact (source 9, body 13, title 26 pt); references step to label size, then two columns |
| density, variance | 10, 5 |
| radius, edge | 0, border |
| decoration | hairline-rule, box-outline (no accent rule) |

## Title treatments by role

Allowed: `top-rule` (always on a full hairline), `bottom-anchor`, `side-rail`, `statement`.
Defaults: content, data, sequence, reference → top-rule; data-takeaway, image → bottom-anchor;
definition → side-rail; statement → statement (a research question may stand there). Structure: a
comparison stays under `top-rule` while it fills about as well there.

## Families and display slides

Families: `figure-academic`, `figure-pair`, `method`, `chart-insight`, `full-chart`,
`table-insight`, `comparison`, `quote`, `statement`, `text-column`, `references-appendix`.

- Covers `cover-index`, `cover-typographic`, `cover-split-image`; sections `section-rule`,
  `section-field`; closings `closing-summary-list`, `closing-ask`.
- Display devices: cover, statement and closing `rules`, number `outline`, deck index on.
- Table: booktabs, 1 pt top and bottom, 0.5 pt under the header, no verticals, fills or banding,
  numbers right-aligned, bold totals. Chart: hairline grid, direct labels, series order (method in
  accent, baselines in ink and muted ink). Image: no frame.
- Fill order: anchor-visual, distribute, step-up, change-family.

## Do

- Number every figure and table caption (`Figure 2.`, `표 1.`) with conditions and source.
- Report replicates, spread and limits beside results; contributions against limits as a comparison.
- Give the references slide eight to ten entries plus needed definitions.

## Avoid

- The short accent bar under a title.
- Coloured card fills.
- Figures without numbered captions.
- The accent on anything but the proposed method.

## Worked slide

A results table in booktabs with its reading.

```markdown
---
layout: table-insight

## Retrieval accuracy by index type, 1M documents

| Index | Recall@10 | Latency (ms) | Memory (GB) | Build (min) |
|---|---|---|---|---|
| Flat (exact) | 1.000 | 41.2 | 3.8 | 2 |
| IVF-1024 | 0.912 | 4.6 | 3.9 | 11 |
| HNSW-32 | 0.957 | 2.1 | 6.4 | 38 |
| Proposed tiered graph | 0.968 | 1.8 | 4.2 | 24 |
| Proposed, no reranker | 0.941 | 1.2 | 4.0 | 24 |

> Table 2. Mean of five runs, 768-dim embeddings, one 32-core node (sample data)

- The tiered graph matches HNSW recall at two thirds of its memory
- The reranker adds 0.6 ms and 2.7 points of recall
- Source: Example Retrieval Lab benchmark runs, August 2026 (sample)
---
```

## Example in this skill

```text
references/examples/03-research-talk-paper-en.md
```
