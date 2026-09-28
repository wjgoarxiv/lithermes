const phases = Object.freeze([
  "plugin_registration",
  "rules_composition",
  "B0_no_route",
  "S1_pre_llm_call",
  "bounded_activation",
  "S2_continuation",
  "direct_skill_invocation",
  "compaction_rules",
]);

const guards = Object.freeze([
  "correctness",
  "banner",
  "sentinel",
  "route",
  "body",
  "payload",
  "direct",
  "compaction",
]);

const hashes = Object.freeze({
  baselineArtifact: "a".repeat(64),
  sourceArtifact: "cb4758384c95cb06c18a729aea64912966366babb48d486287a13c39e5b8d7f8",
  head: "7024ab6823c33a60a6abcc57075ff48ec4874bf7",
  scenario: "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be",
  status: "556d8a3956b780bc399313194c4ab21fa2b81c7bc24528a33f74a5f00e166108",
});

function sample(block, order, arm, sampleIndex, phase) {
  const duration = arm === "baseline" ? 100 : 80;
  return {
    block,
    order,
    arm,
    sample: sampleIndex,
    phase,
    duration_ms: duration,
    guards: Object.fromEntries(guards.map((guard) => [guard, true])),
    provider_calls: 0,
    provider_completions: 0,
    provider_usage: {
      input_tokens: "UNAVAILABLE",
      cache_read_tokens: "UNAVAILABLE",
      cache_write_tokens: "UNAVAILABLE",
      output_tokens: "UNAVAILABLE",
    },
  };
}

function makeV2Cohort() {
  const records = [];
  for (let block = 1; block <= 6; block += 1) {
    const order = block % 2 === 1
      ? ["baseline", "candidate"]
      : ["candidate", "baseline"];
    for (let armIndex = 0; armIndex < order.length; armIndex += 1) {
      for (let sampleIndex = 1; sampleIndex <= 5; sampleIndex += 1) {
        for (const phase of phases) {
          records.push(sample(block, armIndex + 1, order[armIndex], sampleIndex, phase));
        }
      }
    }
  }
  return {
    schema: "litfamily.harness-speed-v2/lithermes/v1",
    product: "lithermes",
    phases: [...phases],
    baseline: {
      source: "T01_FROZEN_REPAIRED",
      head_commit: hashes.head,
      source_artifact_sha256: hashes.sourceArtifact,
      artifact_sha256: hashes.baselineArtifact,
      status_sha256: hashes.status,
      fixture_sha256: hashes.scenario,
    },
    candidate: {
      source: "V2_CANDIDATE",
      head_commit: hashes.head,
      base_source_artifact_sha256: hashes.sourceArtifact,
      source_artifact_sha256: "d".repeat(64),
      artifact_sha256: "b".repeat(64),
      status_sha256: "c".repeat(64),
      fixture_sha256: hashes.scenario,
    },
    lever: { kind: "latency", selected_phase: "S1_pre_llm_call" },
    records,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { clone, guards, hashes, makeV2Cohort, phases };
