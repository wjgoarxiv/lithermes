const assert = require("node:assert/strict");
const { test } = require("node:test");
const { inspectHermesCapabilities, planModelConfig } = require("../src/lib/config");

const RUNTIME_STEM = ["co", "dex"].join("");
const OPENAI_PROVIDER = `openai-${RUNTIME_STEM}`;
const ASTRA_MODEL = "gpt-6-astra";
const VERIFIED = {
  hostCapabilities: { concurrencyHard: true, delegationRouteHard: true, runtimeHard: true },
  hostVersion: "0.17.0",
};

function configuredModel(model = "gpt-5.6-sol", includeLimits = true) {
  return [
    "_config_version: 30",
    "model:",
    `  provider: ${OPENAI_PROVIDER}`,
    `  default: ${model}`,
    ...(includeLimits ? ["  context_length: 200000"] : []),
    "delegation:",
    "  max_concurrent_children: 7",
    "  max_async_children: 4",
    ...(includeLimits ? ["compression:", "  threshold: 0.73"] : []),
    "",
  ].join("\n");
}

function configuredLegacySolPair(includeLimits = true) {
  return configuredModel("gpt-5.6-sol", includeLimits).replace(
    "delegation:\n",
    `agent:\n  reasoning_effort: xhigh\ndelegation:\n  model: gpt-5.6-luna\n  reasoning_effort: max\n`,
  );
}

test("explicit reconfiguration aligns the verified Hermes context and compression target", () => {
  // Given: a verified credential-free Hermes 0.17.0 config with the existing Sol route
  const plan = planModelConfig(configuredLegacySolPair(), {
    ...VERIFIED,
    model: "gpt-5.6-sol",
    effort: "xhigh",
    reconfigure: true,
  });
  // When: the user explicitly reconfigures the model
  const capabilities = inspectHermesCapabilities(plan.text, VERIFIED);
  // Then: the safe 372K/90% target is exact and async delegation is preserved
  assert.match(plan.text, /context_length: 372000/);
  assert.match(plan.text, /threshold: 0\.9/);
  assert.match(plan.text, /max_async_children: 4/);
  assert.equal(capabilities.autoCompaction.status, "hard");
  assert.equal(capabilities.autoCompaction.limit, 334800);
});

test("Astra reconfiguration does not invent missing context or compression limits", () => {
  // Given: a managed Astra route with no host-published context/compression limits
  const before = configuredModel(ASTRA_MODEL, false).replace(
    "delegation:\n",
    `agent:\n  reasoning_effort: xhigh\ndelegation:\n  provider: ${OPENAI_PROVIDER}\n  model: gpt-5.6-luna\n  reasoning_effort: max\n`,
  );
  // When: the user explicitly resets the Astra route
  const plan = planModelConfig(before, {
    ...VERIFIED,
    model: ASTRA_MODEL,
    effort: "xhigh",
    reconfigure: true,
  });
  // Then: the managed route is written without guessing a legacy host limit
  assert.equal(plan.action, "write");
  assert.match(plan.text, /default: gpt-6-astra/);
  assert.doesNotMatch(plan.text, /context_length|compression:|threshold:/);
});

test("GPT-6 Sol/Luna reconfiguration leaves absent legacy context limits absent", () => {
  // Given: a configured legacy model pair with no explicit context/compression values
  const before = configuredLegacySolPair(false);
  // When: the user explicitly selects the GPT-6 Sol/Luna pair
  const plan = planModelConfig(before, {
    ...VERIFIED,
    model: "gpt-6.1-sol",
    effort: "xhigh",
    childModel: "gpt-6-luna",
    childEffort: "max",
    reconfigure: true,
  });
  // Then: only the selected model/effort routes change; legacy-only limits are not invented
  assert.equal(plan.action, "write");
  assert.match(plan.text, /default: gpt-6\.1-sol/);
  assert.match(plan.text, /model: gpt-6-luna/);
  assert.doesNotMatch(plan.text, /context_length|compression:|threshold:/);
});

test("fresh onboarding does not add the context alignment without explicit reconfiguration", () => {
  // Given: an empty verified Hermes 0.17.0 config
  const plan = planModelConfig("", VERIFIED);
  // When: normal onboarding selects the default model
  // Then: the provider metadata remains authoritative until explicit reconfiguration
  assert.doesNotMatch(plan.text, /context_length|threshold/);
});
