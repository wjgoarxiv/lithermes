const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { PassThrough } = require("node:stream");
const { parseDocument } = require("yaml");
const {
  OPENAI_PROVIDER_ID,
  inspectEffectiveRouteSafety,
  managedRequest,
  ROUTE_CATALOG,
} = require("../src/lib/modelRoutePolicy");
const GPT = OPENAI_PROVIDER_ID;
const { planModelConfig } = require("../src/lib/modelConfig");
const {
  missingCredentialWarning,
  promptModelRoute,
  renderInstallBanner,
  renderModelRouteCard,
} = require("../src/lib/modelPrompt");

const HOST = {
  hostCapabilities: { concurrencyHard: true, delegationRouteHard: true, runtimeHard: true },
  hostVersion: "0.19.0",
};
const ASTRA_MODEL = "gpt-6-astra";
const GPT6_LEAD_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const GPT6_LUNA_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function keys(text) {
  const doc = parseDocument(text);
  return {
    childEffort: doc.getIn(["delegation", "reasoning_effort"]),
    childModel: doc.getIn(["delegation", "model"]),
    childProvider: doc.getIn(["delegation", "provider"]),
    effort: doc.getIn(["agent", "reasoning_effort"]),
    model: doc.getIn(["model", "default"]),
    provider: doc.getIn(["model", "provider"]),
  };
}

test("Astra is the fresh parent and supports every fact-sheet lead/child effort", () => {
  // Given: the approved Astra route contract
  const defaultRoute = managedRequest();
  // When: the default and every explicit Astra effort are resolved
  // Then: parent defaults to Astra/xhigh while ordinary workers remain Luna/max
  assert.equal(defaultRoute.model, ASTRA_MODEL);
  assert.equal(defaultRoute.effort, "xhigh");
  assert.equal(defaultRoute.childModel, "gpt-6-luna");
  assert.equal(defaultRoute.childEffort, "max");
  for (const effort of GPT6_LEAD_EFFORTS) {
    const route = managedRequest({
      model: ASTRA_MODEL,
      effort,
      childModel: ASTRA_MODEL,
      childEffort: effort,
    });
    assert.deepEqual(
      { model: route.model, effort: route.effort, childModel: route.childModel, childEffort: route.childEffort },
      { model: ASTRA_MODEL, effort, childModel: ASTRA_MODEL, childEffort: effort },
    );
  }
});

test("route selection follows GPT-6 effort sets and preserves legacy 5.6 bounds", () => {
  const expected = new Map([
    ["gpt-6-astra", GPT6_LEAD_EFFORTS],
    ["gpt-6-sol", GPT6_LEAD_EFFORTS],
    ["gpt-6-luna", GPT6_LUNA_EFFORTS],
    ["gpt-5.6-sol", ["high", "xhigh"]],
    ["gpt-5.6-terra", ["high", "xhigh", "max"]],
    ["gpt-5.6-luna", ["max", "high"]],
    ["gpt-5.6", ["high"]],
  ]);
  const rows = ROUTE_CATALOG[GPT].rows;

  for (const [model, efforts] of expected) {
    assert.deepEqual(rows.filter((row) => row.model === model).map((row) => row.effort), efforts, model);
    for (const effort of efforts) {
      const request = model === "gpt-6-luna" || model === "gpt-5.6-luna"
        ? managedRequest({ childModel: model, childEffort: effort })
        : managedRequest({ model, effort });
      assert.equal(model === "gpt-6-luna" || model === "gpt-5.6-luna" ? request.childEffort : request.effort, effort);
    }
  }

  for (const [model, effort] of [
    ["gpt-6-astra", "none"],
    ["gpt-6-sol", "none"],
    ["gpt-6-luna", "ultra"],
    ["gpt-5.6-sol", "low"],
    ["gpt-5.6-terra", "low"],
    ["gpt-5.6-luna", "low"],
    ["gpt-5.6-luna", "xhigh"],
  ]) {
    const request = model === "gpt-6-luna" || model === "gpt-5.6-luna"
      ? () => managedRequest({ childModel: model, childEffort: effort })
      : () => managedRequest({ model, effort });
    assert.throws(request, /not offered|forbidden/i, `${model}/${effort}`);
  }
});

test("route safety accepts every GPT-6 effort and keeps legacy Luna limits", () => {
  const safetyFor = ({ model, effort, childModel, childEffort }) => inspectEffectiveRouteSafety(
    parseDocument([
      "model:",
      `  provider: ${GPT}`,
      `  default: ${model}`,
      "agent:",
      `  reasoning_effort: ${effort}`,
      "delegation:",
      `  model: ${childModel}`,
      `  reasoning_effort: ${childEffort}`,
      "",
    ].join("\n")),
    GPT,
  );

  for (const model of ["gpt-6-astra", "gpt-6-sol"]) {
    for (const effort of GPT6_LEAD_EFFORTS) {
      const request = managedRequest({ model, effort, childModel: "gpt-6-luna", childEffort: "max" });
      assert.equal(safetyFor(request).status, "safe", `${model}/${effort}`);
    }
  }
  for (const effort of GPT6_LUNA_EFFORTS) {
    const request = managedRequest({ model: ASTRA_MODEL, effort: "xhigh", childModel: "gpt-6-luna", childEffort: effort });
    assert.equal(safetyFor(request).status, "safe", `gpt-6-luna/${effort}`);
  }
  for (const [model, effort, childModel, childEffort] of [
    ["gpt-5.6-sol", "high", "gpt-5.6-luna", "high"],
    ["gpt-5.6-sol", "xhigh", "gpt-5.6-luna", "high"],
    ["gpt-5.6-sol", "xhigh", "gpt-5.6-luna", "max"],
    ["gpt-5.6-terra", "high", "gpt-6-luna", "max"],
    ["gpt-5.6-terra", "xhigh", "gpt-6-luna", "max"],
    ["gpt-5.6-terra", "max", "gpt-6-luna", "max"],
  ]) {
    const request = managedRequest({ model, effort, childModel, childEffort });
    assert.equal(safetyFor(request).status, "safe", `${model}/${effort}; ${childModel}/${childEffort}`);
  }
  assert.equal(safetyFor({ model: "gpt-5.6-sol", effort: "low", childModel: "gpt-5.6-luna", childEffort: "max" }).status, "blocked");
  assert.equal(safetyFor({ model: ASTRA_MODEL, effort: "xhigh", childModel: "gpt-5.6-luna", childEffort: "low" }).status, "blocked");
  assert.equal(safetyFor({ model: ASTRA_MODEL, effort: "xhigh", childModel: "gpt-5.6-luna", childEffort: "xhigh" }).status, "blocked");
});

test("managedRequest defaults to today's shipped route: OpenAI Astra xhigh lead, Luna max child", () => {
  assert.deepEqual(managedRequest(), {
    childEffort: "max",
    childModel: "gpt-6-luna",
    childProvider: GPT,
    effort: "xhigh",
    model: ASTRA_MODEL,
    provider: GPT,
  });
});

test("managedRequest --provider xai picks the xai lead and helper defaults, child provider follows the lead", () => {
  const route = managedRequest({ provider: "xai" });
  assert.equal(route.provider, "xai");
  assert.equal(route.childProvider, "xai");
  assert.equal(route.model, ROUTE_CATALOG.xai.lead.model);
  assert.equal(route.effort, ROUTE_CATALOG.xai.lead.effort);
  assert.equal(route.childModel, ROUTE_CATALOG.xai.helper.model);
  assert.equal(route.childEffort, ROUTE_CATALOG.xai.helper.effort);
  assert.ok(/^grok-/.test(route.model));
});

test("managedRequest lets the child use a different provider than the lead", () => {
  const route = managedRequest({ childProvider: "xai" });
  assert.equal(route.provider, GPT);
  assert.equal(route.model, ASTRA_MODEL);
  assert.equal(route.childProvider, "xai");
  assert.ok(/^grok-/.test(route.childModel));
});

test("managedRequest fills the row effort when only a model is given", () => {
  assert.equal(managedRequest({ model: "gpt-5.6-luna" }).effort, "max");
  assert.equal(managedRequest({ model: ASTRA_MODEL }).effort, "xhigh");
  assert.equal(managedRequest({ childModel: "gpt-5.6" }).childEffort, "high");
});

test("managedRequest allows GPT-6 Luna xhigh and rejects legacy Luna xhigh and unknown routes", () => {
  assert.equal(managedRequest({ childModel: "gpt-6-luna", childEffort: "xhigh" }).childEffort, "xhigh");
  assert.throws(() => managedRequest({ model: "gpt-5.6-luna", effort: "xhigh" }), /luna.*xhigh/i);
  assert.throws(() => managedRequest({ childModel: "gpt-5.6-luna", childEffort: "xhigh" }), /luna.*xhigh/i);
  assert.throws(() => managedRequest({ model: "gpt-4o" }), /unknown model/i);
  assert.throws(() => managedRequest({ provider: "anthropic" }), /unknown provider/i);
  assert.throws(() => managedRequest({ provider: "xai", model: "gpt-5.6-sol" }), /not offered for provider xai/i);
});

test("ROUTE_CATALOG lists xai reasoning models newest first with the Hermes effort vocabulary", () => {
  const rows = ROUTE_CATALOG.xai.rows;
  assert.ok(rows.length >= 3);
  assert.equal(rows[0].model, "grok-build-0.1");
  for (const row of rows) {
    assert.ok(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(row.effort));
  }
  assert.ok(ROUTE_CATALOG[GPT].rows.every((row) => !(row.model === "gpt-5.6-luna" && row.effort === "xhigh")));
});

test("OpenAI menu names the Responses catalog and ranks Astra ultra deepest", () => {
  assert.equal(ROUTE_CATALOG[GPT].label, "OpenAI OAuth Responses (Astra + Sol + Luna)");
  const xhigh = ROUTE_CATALOG[GPT].rows.find((row) => row.model === ASTRA_MODEL && row.effort === "xhigh");
  const max = ROUTE_CATALOG[GPT].rows.find((row) => row.model === ASTRA_MODEL && row.effort === "max");
  const ultra = ROUTE_CATALOG[GPT].rows.find((row) => row.model === ASTRA_MODEL && row.effort === "ultra");
  assert.match(xhigh.note, /recommended lead/);
  assert.doesNotMatch(xhigh.note, /deepest/);
  assert.doesNotMatch(max.note, /deepest/);
  assert.match(ultra.note, /deepest/);
});

test("planModelConfig on a fresh config writes the six route keys for an xai lead and xai child", () => {
  const plan = planModelConfig("", { ...HOST, provider: "xai" });
  assert.equal(plan.action, "write", plan.reason);
  assert.deepEqual(keys(plan.text), {
    childEffort: ROUTE_CATALOG.xai.helper.effort,
    childModel: ROUTE_CATALOG.xai.helper.model,
    childProvider: "xai",
    effort: ROUTE_CATALOG.xai.lead.effort,
    model: ROUTE_CATALOG.xai.lead.model,
    provider: "xai",
  });
  assert.equal(plan.request.provider, "xai");
  assert.equal(plan.request.childProvider, "xai");
});

test("planModelConfig default write keeps Astra xhigh + Luna max and now records the child provider", () => {
  const plan = planModelConfig("", HOST);
  assert.equal(plan.action, "write", plan.reason);
  assert.deepEqual(keys(plan.text), {
    childEffort: "max",
    childModel: "gpt-6-luna",
    childProvider: GPT,
    effort: "xhigh",
    model: ASTRA_MODEL,
    provider: GPT,
  });
  assert.equal(plan.capabilities.leadRoute.status, "configured");
  assert.equal(plan.capabilities.ordinaryWorkerRoute.status, "configured");
  assert.equal(plan.capabilities.delegationRoute.status, "configured");
});

test("planModelConfig accepts an openai lead with a non-Luna openai child", () => {
  const plan = planModelConfig("", { ...HOST, childModel: "gpt-5.6", childEffort: "high" });
  assert.equal(plan.action, "write", plan.reason);
  assert.equal(keys(plan.text).childModel, "gpt-5.6");
  assert.equal(plan.capabilities.ordinaryWorkerRoute.status, "configured");
  assert.equal(plan.capabilities.ordinaryWorkerRoute.model, "gpt-5.6");
});

test("planModelConfig preserves an existing xai route and rewrites it only with --reconfigure-model", () => {
  const written = planModelConfig("", { ...HOST, provider: "xai" }).text;
  const preserved = planModelConfig(written, HOST);
  assert.equal(preserved.action, "preserve");
  assert.match(preserved.reason, /reconfigure-model/);
  const rewritten = planModelConfig(written, { ...HOST, reconfigure: true });
  assert.equal(rewritten.action, "write", rewritten.reason);
  assert.equal(keys(rewritten.text).provider, GPT);
  assert.equal(keys(rewritten.text).model, ASTRA_MODEL);
});

test("planModelConfig still stops on a luna xhigh child route in an existing config", () => {
  const text = [
    "_config_version: 30",
    "model:",
    `  provider: ${GPT}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: xhigh",
    "delegation:",
    `  provider: ${GPT}`,
    "  model: gpt-5.6-luna",
    "  reasoning_effort: xhigh",
    "",
  ].join("\n");
  const plan = planModelConfig(text, HOST);
  assert.equal(plan.action, "stop");
  assert.equal(plan.stop.code, "LITHERMES_UNSAFE_MODEL_ROUTE");
});

test("missingCredentialWarning names XAI_API_KEY when a Grok route has no key in the environment", () => {
  const route = managedRequest({ provider: "xai" });
  assert.match(missingCredentialWarning(route, {}), /XAI_API_KEY/);
  assert.equal(missingCredentialWarning(route, { XAI_API_KEY: "x" }), null);
  assert.equal(missingCredentialWarning(managedRequest(), {}), null);
  assert.match(missingCredentialWarning(managedRequest({ childProvider: "xai" }), {}), /XAI_API_KEY/);
});

test("renderModelRouteCard prints the contract summary card with a warning row when a key is missing", () => {
  const card = renderModelRouteCard(managedRequest({ provider: "xai" }), {
    configPath: "/tmp/h/config.yaml",
    env: {},
  });
  assert.match(card, /^╭─ MODEL ROUTE$/m);
  assert.match(card, /^│ Provider   xai$/m);
  assert.match(card, /^│ Lead       grok-build-0\.1 · high$/m);
  assert.match(card, /^│ Helpers    grok-4\.3 · high$/m);
  assert.match(card, /^│ Writes     \/tmp\/h\/config\.yaml  \(managed keys only\)$/m);
  assert.match(card, /^│ Warning    XAI_API_KEY is not set/m);
  assert.match(card, /^╰─ Enter to continue · Ctrl-C to abort \(nothing written yet\)$/m);
});

test("renderModelRouteCard names the helper provider when it differs from the lead", () => {
  const card = renderModelRouteCard(managedRequest({ childProvider: "xai" }), {
    configPath: "/tmp/h/config.yaml",
    env: { XAI_API_KEY: "k" },
  });
  assert.match(card, /^│ Helpers    xai \/ grok-4\.3 · high$/m);
  assert.doesNotMatch(card, /Warning/);
});

test("renderModelRouteCard prints one helper row without the provider when it matches the lead", () => {
  const card = renderModelRouteCard(managedRequest(), { configPath: "/tmp/h/config.yaml", env: {} });
  assert.match(card, new RegExp(`^│ Provider   ${GPT}$`, "m"));
  assert.match(card, /^│ Lead       gpt-6-astra · xhigh$/m);
  assert.match(card, /^│ Helpers    gpt-6-luna · max$/m);
  assert.doesNotMatch(card, /Warning/);
});

test("renderInstallBanner uses the canonical banner and product lockup", () => {
  const mark = require("../src/lib/litMark");
  const banner = renderInstallBanner({ version: "1.0.9", color: false, env: { LANG: "en_US.UTF-8" } });
  assert.deepEqual(banner.split("\n"), mark.lockup("lithermes v1.0.9", mark.banner));
  assert.equal(banner.split("\n").length, 20);
  assert.doesNotMatch(banner, /\x1b/);
});

async function answer(answers, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => { text += String(chunk); });
  const pending = promptModelRoute({ input, output, color: false, ...options });
  for (const line of answers) input.write(`${line}\n`);
  input.end();
  const route = await pending;
  return { route, text };
}

test("promptModelRoute walks provider → lead → child provider → child and defaults on Enter", async () => {
  const { route, text } = await answer(["", "", "", ""]);
  assert.deepEqual(route, managedRequest());
  assert.match(text, /Choose the provider for LitHermes agents\./);
  assert.match(text, new RegExp(`0\\. OpenAI OAuth Responses \\(Astra \\+ Sol \\+ Luna\\)\\s+\\(${GPT}\\)`));
  assert.match(text, /1\. xAI Grok\s+\(xai\)/);
  assert.match(text, /Choose the LEAD model \(plans and reviews\)\./);
  assert.match(text, /gpt-6-astra\s+· xhigh\s+— .*recommended lead/);
  assert.match(text, /Choose the HELPER model \(delegated workers\)\./);
  assert.match(text, /Select 0-1 \[0\]:/);
});

test("promptModelRoute selects xai lead and xai child by number", async () => {
  const { route, text } = await answer(["1", "0", "", "0"]);
  assert.equal(route.provider, "xai");
  assert.equal(route.model, "grok-build-0.1");
  assert.equal(route.childProvider, "xai");
  assert.equal(route.childModel, "grok-build-0.1");
  assert.match(text, /Select 0-1 \[1\]:/);
});

test("promptModelRoute re-asks on an out-of-range answer", async () => {
  const { route, text } = await answer(["9", "0", "1", "", ""]);
  assert.equal(route.provider, GPT);
  assert.equal(route.model, ASTRA_MODEL);
  assert.equal(route.effort, "medium");
  assert.equal(route.childModel, "gpt-6-luna");
  assert.match(text, /Please answer 0-1\./);
});

test("promptModelRoute resolves to the defaults when input closes early", async () => {
  const { route } = await answer([]);
  assert.deepEqual(route, managedRequest());
});

// ── CLI consent flow (interactive install without --yes) ────────────────────

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main } = require("../src/cli");

const consentTempDirs = [];
test.after(() => {
  for (const dir of consentTempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

function consentTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  consentTempDirs.push(dir);
  return dir;
}

function fakeHermesHostPath(version) {
  const dir = consentTempDir("lithermes-consent-host-");
  fs.writeFileSync(path.join(dir, "hermes"), [
    "#!/usr/bin/env node",
    `process.stdout.write("Hermes Agent v${version}\\n");`,
  ].join("\n"), { mode: 0o700 });
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

function fakeHermesSourceRepo() {
  const repo = consentTempDir("lithermes-consent-repo-");
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), [
    "def _get_max_concurrent_children():",
    '    val = cfg.get("max_concurrent_children")',
    "    return max(1, int(val))",
    'configured_model = str(cfg.get("model") or "").strip() or None',
    'delegation_effort = str(delegation_cfg.get("reasoning_effort") or "").strip()',
    "effective_model = model or parent_agent.model",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
    `if provider == "${GPT}":`,
    `    api_mode = "${GPT.replace("openai-", "")}_responses":`,
  ].join("\n"));
  return repo;
}

async function runInteractiveMain(argv, lines) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let text = "";
  stdout.on("data", (chunk) => { text += String(chunk); });
  const previousPath = process.env.PATH;
  process.env.PATH = fakeHermesHostPath("0.19.0");
  // This helper simulates a real interactive terminal, so it must also drop CI:
  // src/cli.js gates the model prompt and the summary card on `!env.CI`, which
  // otherwise short-circuits both when the suite itself runs under CI.
  const interactiveEnv = { ...process.env };
  delete interactiveEnv.CI;
  const pending = main(argv, {
    env: interactiveEnv,
    isInteractive: true,
    scheduleUpdateCheck: () => {},
    shouldAutoUpdate: () => false,
    streams: { stdin, stdout },
  });
  for (const line of lines) stdin.write(`${line}\n`);
  try {
    await pending;
    return { text, threw: null };
  } catch (error) {
    return { text, threw: error };
  } finally {
    process.env.PATH = previousPath;
  }
}

test("interactive install on an already-routed home shows the picker and preserves config on Enter", async () => {
  const home = consentTempDir("lithermes-consent-home-");
  const repo = fakeHermesSourceRepo();
  const seeded = [
    "_config_version: 30",
    "model:",
    `  provider: ${GPT}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: xhigh",
    "delegation:",
    "  model: gpt-5.6-luna",
    "  reasoning_effort: max",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.yaml"), seeded);
  const beforeHash = crypto.createHash("sha256").update(seeded).digest("hex");
  const { text, threw } = await runInteractiveMain([
    "install", "--offline", "--no-hud", "--no-style", "--no-auto-update", "--no-spinner",
    "--hermes-home", home, "--hermes-repo", repo,
  ], ["", "", "", "", ""]);
  assert.equal(threw, null, String(threw));
  assert.match(text, /Model route: currently gpt-5\.6-sol · xhigh/);
  assert.match(text, /MODEL ROUTE/);
  assert.match(text, /Select 0-24 \[18\]:/);
  const after = fs.readFileSync(path.join(home, "config.yaml"));
  assert.equal(crypto.createHash("sha256").update(after).digest("hex"), beforeHash);
  assert.equal(after.toString(), seeded);
});

test("interactive existing-route selection still writes the chosen managed route", async () => {
  const home = consentTempDir("lithermes-consent-home-");
  const repo = fakeHermesSourceRepo();
  fs.writeFileSync(path.join(home, "config.yaml"), [
    "_config_version: 30",
    "model:",
    `  provider: ${GPT}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: xhigh",
    "delegation:",
    `  provider: ${GPT}`,
    "  model: gpt-5.6-luna",
    "  reasoning_effort: max",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n"));
  const { text, threw } = await runInteractiveMain([
    "install", "--offline", "--no-hud", "--no-style", "--no-auto-update", "--no-spinner",
    "--hermes-home", home, "--hermes-repo", repo,
  ], ["1", "", "", "", ""]);
  assert.equal(threw, null, String(threw));
  assert.match(text, /Model route: currently gpt-5\.6-sol · xhigh/);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /provider: xai/);
  assert.match(config, /default: grok-build-0\.1/);
  assert.match(config, /model: grok-4\.3/);
});

test("interactive fresh install writes only after the summary-card Enter", async () => {
  const home = consentTempDir("lithermes-consent-home-");
  const repo = fakeHermesSourceRepo();
  const { text, threw } = await runInteractiveMain([
    "install", "--offline", "--no-hud", "--no-style", "--no-auto-update", "--no-spinner",
    "--hermes-home", home, "--hermes-repo", repo,
  ], ["1", "", "", "", ""]);
  assert.equal(threw, null, String(threw));
  assert.match(text, /╭─ MODEL ROUTE/);
  assert.match(text, /│ Provider   xai/);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /provider: xai/);
  assert.match(config, /default: grok-build-0\.1/);
});
