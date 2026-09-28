const PERMUTATIONS = [
  ["baseline", "candidate", "control"],
  ["baseline", "control", "candidate"],
  ["candidate", "baseline", "control"],
  ["candidate", "control", "baseline"],
  ["control", "baseline", "candidate"],
  ["control", "candidate", "baseline"],
];

function latency(arm, phase) {
  if (phase === "B0") return 40;
  if (arm === "baseline") return 100;
  if (arm === "candidate") return 80;
  return 90;
}

export function makeProviderFreeSurfaceCohort(scenario) {
  const records = [];
  PERMUTATIONS.forEach((permutation, blockIndex) => {
    permutation.forEach((arm, armIndex) => {
      scenario.records.forEach((phase, phaseIndex) => {
        const e2e = latency(arm, phase.id);
        records.push({
          schema: "litfamily.harness-speed/v1",
          scenario_id: scenario.scenario_id,
          product: "lithermes",
          arm,
          block: blockIndex + 1,
          order: armIndex + 1,
          sequence: blockIndex * 9 + armIndex * 3 + phaseIndex + 1,
          phase: phase.id,
          prompt_bytes: phase.prompt_bytes,
          prompt_sha256: phase.prompt_sha256,
          response_bytes: phase.sentinel_bytes,
          response_sha256: phase.sentinel_sha256,
          sentinel_match: true,
          route_observed: true,
          output_policy_match: true,
          correct: true,
          failure_code: null,
          timed_out: false,
          start_offset_ms: 0,
          first_content_offset_ms: e2e / 2,
          final_receipt_offset_ms: e2e - 1,
          exit_offset_ms: e2e,
          input_tokens: arm === "candidate" ? 90 : 100,
          cache_read_tokens: "UNAVAILABLE",
          cache_write_tokens: "UNAVAILABLE",
          output_tokens: "UNAVAILABLE",
        });
      });
    });
  });
  return {
    schema: "litfamily.harness-speed/v1",
    scenario_id: scenario.scenario_id,
    product: "lithermes",
    records,
  };
}
