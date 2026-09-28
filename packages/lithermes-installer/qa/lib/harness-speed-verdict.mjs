import { harnessSpeedConstants } from "./harness-speed-schema.mjs";

const UNAVAILABLE = "UNAVAILABLE";

function nearestRank(values, percentile) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function numericSum(values) {
  return values.every((value) => typeof value === "number")
    ? values.reduce((total, value) => total + value, 0)
    : UNAVAILABLE;
}

function measuredFor(records, arm) {
  return records.filter((record) => record.arm === arm && record.phase !== "B0");
}

function e2e(record) {
  return record.exit_offset_ms - record.start_offset_ms;
}

function summarizeArm(records, arm) {
  const all = records.filter((record) => record.arm === arm);
  const measured = measuredFor(records, arm);
  const latencies = measured.map(e2e);
  const inputTotal = numericSum(measured.map((record) => record.input_tokens));
  const cacheReadTotal = numericSum(measured.map((record) => record.cache_read_tokens));
  const cacheWriteTotal = numericSum(measured.map((record) => record.cache_write_tokens));
  const outputTotal = numericSum(measured.map((record) => record.output_tokens));
  const cacheReadShare = typeof inputTotal === "number" && inputTotal > 0 && typeof cacheReadTotal === "number"
    ? cacheReadTotal / inputTotal
    : UNAVAILABLE;
  const uncached = typeof inputTotal === "number" && typeof cacheReadTotal === "number" &&
    inputTotal >= cacheReadTotal
    ? (inputTotal - cacheReadTotal) / measured.length
    : UNAVAILABLE;
  return {
    sessions: 6,
    warmups_correct: all.filter((record) => record.phase === "B0" && record.correct).length,
    measured_correct: measured.filter((record) => record.correct).length,
    e2e_ms: { p50: nearestRank(latencies, 0.5), p95: nearestRank(latencies, 0.95) },
    input_tokens_sum: inputTotal,
    cache_read_tokens_sum: cacheReadTotal,
    cache_write_tokens_sum: cacheWriteTotal,
    output_tokens_sum: outputTotal,
    cache_read_share: cacheReadShare,
    uncached_input_per_correct_turn: uncached,
  };
}

function controlDrift(records) {
  const control = measuredFor(records, "control").sort((left, right) => left.sequence - right.sequence);
  const early = nearestRank(control.slice(0, 6).map(e2e), 0.95);
  const late = nearestRank(control.slice(6).map(e2e), 0.95);
  const movement = early === 0 ? (late === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(late - early) / early;
  return { early_p95_ms: early, late_p95_ms: late, movement };
}

function pairedRatioMedian(records) {
  const baseline = new Map(measuredFor(records, "baseline").map((record) => [`${record.block}:${record.phase}`, e2e(record)]));
  const ratios = measuredFor(records, "candidate").map((record) => e2e(record) / baseline.get(`${record.block}:${record.phase}`));
  return nearestRank(ratios, 0.5);
}

function latencySavedDiagnostic(records) {
  const baseline = measuredFor(records, "baseline");
  const candidate = measuredFor(records, "candidate");
  const cacheReads = numericSum(candidate.map((record) => record.cache_read_tokens));
  if (typeof cacheReads !== "number" || cacheReads <= 0) return UNAVAILABLE;
  const saved = baseline.map(e2e).reduce((sum, value) => sum + value, 0) -
    candidate.map(e2e).reduce((sum, value) => sum + value, 0);
  return saved / (cacheReads / 1000);
}

export function computeVerdict(records) {
  const arms = Object.fromEntries(harnessSpeedConstants.arms.map((arm) => [arm, summarizeArm(records, arm)]));
  const pairedRatio = pairedRatioMedian(records);
  const drift = controlDrift(records);
  const antiPadding = typeof arms.baseline.input_tokens_sum === "number" &&
    typeof arms.candidate.input_tokens_sum === "number"
    ? arms.candidate.input_tokens_sum <= arms.baseline.input_tokens_sum
    : UNAVAILABLE;
  const gates = {
    correctness: harnessSpeedConstants.arms.every((arm) => arms[arm].warmups_correct === 6 && arms[arm].measured_correct === 12),
    candidate_p95: arms.candidate.e2e_ms.p95 <= arms.baseline.e2e_ms.p95 * 0.85,
    candidate_p50: arms.candidate.e2e_ms.p50 <= arms.baseline.e2e_ms.p50,
    paired_ratio: pairedRatio <= 0.85,
    control_drift: drift.movement <= 0.20,
    anti_padding: antiPadding,
  };
  const reasonCodes = [];
  for (const [name, value] of Object.entries(gates)) {
    if (value === false) reasonCodes.push(`${name.toUpperCase()}_FAILED`);
    if (value === UNAVAILABLE) reasonCodes.push(name === "anti_padding" ? "INPUT_TOKENS_UNAVAILABLE" : `${name.toUpperCase()}_UNAVAILABLE`);
  }
  const verdict = Object.values(gates).includes(false)
    ? "FAIL"
    : Object.values(gates).includes(UNAVAILABLE) ? UNAVAILABLE : "PASS";
  return {
    schema: harnessSpeedConstants.cohortSchema,
    scenario_id: harnessSpeedConstants.scenarioId,
    product: harnessSpeedConstants.product,
    cohort: { records: records.length, sessions: 18, warmups: 18, measured_turns: 36 },
    arms,
    paired_ratio_median: pairedRatio,
    control_drift: drift,
    latency_saved_ms_per_1k_cache_read_tokens: latencySavedDiagnostic(records),
    gates,
    verdict,
    reason_codes: reasonCodes,
    privacy: { forbidden_fields_retained: 0, aggregate_only: true },
  };
}
