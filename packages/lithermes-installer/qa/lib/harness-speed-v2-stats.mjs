function nearestRank(values, percentile) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function summary(values) {
  return { p50: nearestRank(values, 0.5), p95: nearestRank(values, 0.95) };
}

function valuesFor(records, arm, phase = null) {
  return records.filter((record) => record.arm === arm && (phase === null || record.phase === phase))
    .map((record) => record.duration_ms);
}

function paired(records) {
  const baseline = new Map(records.filter((record) => record.arm === "baseline")
    .map((record) => [`${record.block}:${record.sample}:${record.phase}`, record.duration_ms]));
  const ratios = [];
  const deltas = [];
  for (const record of records.filter((item) => item.arm === "candidate")) {
    const prior = baseline.get(`${record.block}:${record.sample}:${record.phase}`);
    ratios.push(record.duration_ms / prior);
    deltas.push(record.duration_ms - prior);
  }
  return { ratio: summary(ratios), delta_ms: summary(deltas) };
}

function drift(records) {
  const early = summary(records.filter((record) => record.arm === "baseline" && record.block <= 3)
    .map((record) => record.duration_ms)).p95;
  const late = summary(records.filter((record) => record.arm === "baseline" && record.block >= 4)
    .map((record) => record.duration_ms)).p95;
  return { early_p95_ms: early, late_p95_ms: late, movement: Math.abs(late - early) / early };
}

export function computeV2Stats(records, phases) {
  return {
    aggregate: {
      baseline: summary(valuesFor(records, "baseline")),
      candidate: summary(valuesFor(records, "candidate")),
    },
    phaseStats: Object.fromEntries(phases.map((phase) => [phase, {
      baseline: summary(valuesFor(records, "baseline", phase)),
      candidate: summary(valuesFor(records, "candidate", phase)),
    }])),
    pairedStats: paired(records),
    baselineDrift: drift(records),
  };
}
