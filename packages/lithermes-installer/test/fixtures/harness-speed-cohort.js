const fs = require("node:fs");
const path = require("node:path");

const scenarioPath = path.resolve(
  __dirname,
  "../../qa/fixtures/litfamily-harness-speed-v1.json",
);
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const permutations = [
  ["baseline", "candidate", "control"],
  ["baseline", "control", "candidate"],
  ["candidate", "baseline", "control"],
  ["candidate", "control", "baseline"],
  ["control", "baseline", "candidate"],
  ["control", "candidate", "baseline"],
];

function latencyFor(arm, phase) {
  if (phase === "B0") return 40;
  if (arm === "baseline") return 100;
  if (arm === "candidate") return 80;
  return 90;
}

function makeCohort() {
  const records = [];
  for (let blockIndex = 0; blockIndex < permutations.length; blockIndex += 1) {
    const block = blockIndex + 1;
    for (let armIndex = 0; armIndex < permutations[blockIndex].length; armIndex += 1) {
      const arm = permutations[blockIndex][armIndex];
      const order = armIndex + 1;
      for (let phaseIndex = 0; phaseIndex < scenario.records.length; phaseIndex += 1) {
        const phase = scenario.records[phaseIndex];
        const latency = latencyFor(arm, phase.id);
        const inputTokens = arm === "candidate" ? 90 : 100;
        records.push({
          schema: "litfamily.harness-speed/v1",
          scenario_id: scenario.scenario_id,
          product: "lithermes",
          arm,
          block,
          order,
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
          first_content_offset_ms: latency / 2,
          final_receipt_offset_ms: latency - 1,
          exit_offset_ms: latency,
          input_tokens: inputTokens,
          cache_read_tokens: 20,
          cache_write_tokens: 0,
          output_tokens: 5,
        });
      }
    }
  }
  return {
    schema: "litfamily.harness-speed/v1",
    scenario_id: scenario.scenario_id,
    product: "lithermes",
    records,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { clone, makeCohort, scenario, scenarioPath };
