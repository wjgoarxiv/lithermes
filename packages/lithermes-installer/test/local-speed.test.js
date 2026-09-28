const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");

test("candidate local-speed runner exercises the installed plugin seam provider-free", async () => {
  const { runLocalArm } = await import("../qa/lithermes-local-speed.mjs");
  const report = runLocalArm({ arm: "candidate", samples: 2 });

  assert.equal(report.schema, "litfamily.harness-speed-local/v1");
  assert.equal(report.scenario_id, "litfamily-speed-lit-activation-v1");
  assert.equal(report.product, "lithermes");
  assert.equal(report.arm, "candidate");
  assert.equal(report.measurement_status, "MEASURED");
  assert.equal(report.valid, true);
  assert.equal(report.verdict, "VALID");
  assert.equal(report.provider_calls, 0);
  assert.equal(report.provider_completions, 0);
  assert.match(report.identity.head_commit, /^[a-f0-9]{40}$/);
  assert.match(report.identity.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.match(report.identity.scenario_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.identity.artifact_sha256, report.artifact_sha256);
  assert.equal(report.surface.pre_llm_call, "registered pre_llm_call hook");
  assert.equal(report.surface.runner_seam, "qa/lib/surface.js::runPython");
  assert.equal(
    report.surface.bounded_activation,
    "registered pre_llm_call hook with schema-3 envelope",
  );
  assert.deepEqual(Object.keys(report.phases).sort(), [
    "bounded_activation",
    "plugin_registration",
    "pre_llm_call",
    "rules_context_composition",
  ]);
  assert.ok(Object.values(report.correctness).every((value) => value === true || typeof value === "string"));
  assert.deepEqual(report.adversarial, {
    malformed_input: true,
    stale_state: true,
    dirty_worktree: true,
  });
  assert.deepEqual(report.cleanup, {
    temp_copies_remaining: 0,
    temp_homes_remaining: 0,
    temp_workspaces_remaining: 0,
    bytecode_files_remaining: 0,
    child_processes_remaining: 0,
  });
  assert.match(report.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.numeric_usage.input_tokens, "UNAVAILABLE");
  assert.equal(report.numeric_usage.cache_read_tokens, "UNAVAILABLE");
  assert.equal(report.numeric_usage.cache_write_tokens, "UNAVAILABLE");
  assert.equal(report.numeric_usage.output_tokens, "UNAVAILABLE");
});

test("local-speed runner rejects malformed arm and sample inputs", async () => {
  const { runLocalArm } = await import("../qa/lithermes-local-speed.mjs");
  assert.throws(() => runLocalArm({ arm: "control", samples: 2 }), /arm/);
  assert.throws(() => runLocalArm({ arm: "candidate", samples: 0 }), /samples/);
});
