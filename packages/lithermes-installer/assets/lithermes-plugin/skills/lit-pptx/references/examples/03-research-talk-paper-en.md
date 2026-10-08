---
tonality: paper
title: Battery health from partial charging curves
date: 2026-10-05
notice: Example data — replace with real figures
deck-type: research talk
direction: paper · alternatives night, chalk
reason: peer talk with citations and a results table
wrong-if: dark keynote hall: night
---

---
layout: cover-index

# State-of-health estimation from 15-minute partial charges
---

---
layout: statement

## Can a 15-minute partial charge reveal battery health?

A full capacity test takes nine hours per cell.
---

---
layout: figure-academic

## Capacity fade across 1,200 cycles

::: chart type=line unit="% of rated"
| Cycle | Group A (%) | Group B (%) |
|---|---|---|
| 0 | 100 | 100 |
| 400 | 95.6 | 93.5 |
| 800 | 91.0 | 87.1 |
| 1200 | 86.1 | 80.7 |
> Figure 1. Mean capacity, 24 cells per group, 25 °C (example data)
:::

- **Observation** Group B fades 19.3 points after 1,200 cycles
- **Basis** NMC pouch cells, 1C charge, 2C discharge
- Source: Example Energy Systems Lab cycling rig (example)
---

---
layout: method

## Features from the 3.6-3.9 V window

SOH = f(ΔQ/ΔV peak height, peak position, window duration)

- **SOH** measured over rated capacity, %
- **ΔQ/ΔV** charge added per 5 mV step
- **Peak** height (Ah/V) and position (V) in the window
- **Duration** minutes from 3.6 to 3.9 V at 0.5C
- **f** gradient-boosted trees, 300 estimators
- **Split** 48 training cells, 24 held out by group
- **Sampling** voltage and current logged at 1 Hz by the charger
- **Smoothing** 25 mV moving window before differentiation
- **Seeds** five random seeds, mean and spread reported
- **Range** SOH 80-100 %, the warranty band of the fleet
- **Runtime** 0.9 ms per estimate on the charger's controller
- Source: Example Energy Systems Lab method notes, version 2 (example)
---

---
layout: table-insight

## Estimation error by model, held-out cells

| Model | MAE (pt) | Max (pt) | Test time |
|---|---|---|---|
| Full-curve regression | 0.62 | 2.4 | 9 h |
| Voltage-only baseline | 2.14 | 6.8 | 15 min |
| Gaussian process | 1.05 | 3.9 | 15 min |
| Proposed, three features | 0.88 | 3.1 | 15 min |
| Proposed, two features | 1.21 | 4.4 | 15 min |

- Within 0.26 points of the nine-hour test
- Source: Example lab evaluation runs, August 2026 (example)
---

---
layout: comparison

## Contributions and limits

:::: columns 1fr 1fr
::: col
- **Contributions**
  (1) Time: 15 minutes, not nine hours
  (2) Accuracy: 0.88 points MAE on unseen cells
  (3) Cost: charger voltage log only
  (4) Speed: 0.9 ms per estimate on the charger
:::
::: col
- **Limits**
  (1) Time: needs a 0.5C charge window
  (2) Accuracy: one chemistry, one temperature
  (3) Cost: untested below 80 % SOH
  (4) Speed: needs 15 minutes of steady current
:::
::::

- Source: results above (example)
---

---
layout: closing-summary-list

## Findings and next step

- A 15-minute charge estimates SOH within 0.88 points
- No extra hardware, only the charger log
- Three incremental-capacity features carry most of the signal
- Dropping window duration costs 0.33 points of MAE
- Open question: cells below 80 % SOH and 0-40 °C
- Ask: 40 fleet vans for a six-month field trial
- Next step: field protocol draft by 30 November 2026
---

---
layout: references-appendix

## References

- [1] Example, A. (2022). Incremental capacity analysis. *J. Example Power*, 18, 211-226.
- [2] Sample, B. (2023). Partial-charge features. *Example Battery Letters*, 7, 55-63.
- [3] Specimen, D. (2021). Boosting for diagnostics. *Example Energy Review*, 12, 90-104.
- [4] Demo, E. (2024). Fade in NMC cells. *Example Electrochemistry*, 31, 1-15.
- [5] MAE: mean absolute error in SOH percentage points
---
