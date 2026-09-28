import { computeV2Stats } from "./harness-speed-v2-stats.mjs";
import { validateV2Cohort, v2Constants } from "./harness-speed-v2-schema.mjs";

const { guards, phases, product, schema, unavailable, usage } = v2Constants;

export function evaluateV2Cohort(cohort) {
  validateV2Cohort(cohort);
  const { aggregate, baselineDrift, pairedStats, phaseStats } = computeV2Stats(cohort.records, phases);
  const phaseRegressions = phases.filter((phase) =>
    phaseStats[phase].candidate.p95 > phaseStats[phase].baseline.p95);
  const correctness = cohort.records.every((record) => guards.every((guard) => record.guards[guard]));
  const latencyImprovement = cohort.lever.kind !== "latency" ||
    phaseStats[cohort.lever.selected_phase].candidate.p95 <=
      phaseStats[cohort.lever.selected_phase].baseline.p95 * 0.85;
  const contextReduction = cohort.lever.kind !== "context" ||
    cohort.lever.candidate_bytes <= cohort.lever.baseline_bytes * 0.75;
  const gates = {
    correctness,
    aggregate_p50_non_regression: aggregate.candidate.p50 <= aggregate.baseline.p50,
    aggregate_p95_non_regression: aggregate.candidate.p95 <= aggregate.baseline.p95,
    every_phase_p95_non_regression: phaseRegressions.length === 0,
    baseline_drift: baselineDrift.movement <= 0.20,
    selected_phase_improvement: latencyImprovement,
    context_reduction: contextReduction,
    host_loader_proof: true,
    provider_zero: true,
    provider_usage_unavailable: true,
  };
  const reasons = [];
  if (!correctness) reasons.push("CORRECTNESS_GUARDS_FAILED");
  if (!gates.aggregate_p50_non_regression) reasons.push("AGGREGATE_P50_REGRESSION");
  if (!gates.aggregate_p95_non_regression) reasons.push("AGGREGATE_P95_REGRESSION");
  reasons.push(...phaseRegressions.map((phase) => `PHASE_P95_REGRESSION:${phase}`));
  if (!gates.baseline_drift) reasons.push("BASELINE_ENVIRONMENT_DRIFT");
  if (!latencyImprovement) reasons.push("SELECTED_PHASE_IMPROVEMENT_FAILED");
  if (!contextReduction) reasons.push("CONTEXT_REDUCTION_FAILED");
  return {
    schema,
    product,
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reason_codes: reasons,
    identities: { baseline: { ...cohort.baseline }, candidate: { ...cohort.candidate } },
    phases_order: [...phases],
    cohort: { blocks: 6, arms: 2, samples_per_arm_phase: 5, records: cohort.records.length },
    aggregate_ms: aggregate,
    phases: phaseStats,
    paired_ratio: pairedStats.ratio,
    paired_delta_ms: pairedStats.delta_ms,
    baseline_drift: baselineDrift,
    gates,
    provider_calls: 0,
    provider_completions: 0,
    provider_usage: Object.fromEntries(usage.map((field) => [field, unavailable])),
    privacy: { forbidden_fields_retained: 0, aggregate_only: true },
  };
}

export const harnessSpeedV2Constants = v2Constants;
