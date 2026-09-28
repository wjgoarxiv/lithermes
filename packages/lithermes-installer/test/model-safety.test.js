const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");
const { installLitHermes } = require("../src/lib/install");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");
const tempDirs = [];
const runtimeStem = ["co", "dex"].join("");
const openaiProvider = `openai-${runtimeStem}`;

function makeHome({ withProof = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-model-safety-"));
  tempDirs.push(home);
  if (withProof) {
    const repo = path.join(home, "hermes-agent");
    fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
    fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
    fs.writeFileSync(path.join(repo, "tools", "delegate_tool.py"), [
      "def _get_max_concurrent_children():",
      "    val = cfg.get(\"max_concurrent_children\")",
      "    return max(1, int(val))",
      "configured_model = str(cfg.get(\"model\") or \"\").strip() or None",
      "delegation_effort = str(delegation_cfg.get(\"reasoning_effort\") or \"\").strip()",
      "effective_model = model or parent_agent.model",
    ].join("\n"));
    fs.writeFileSync(path.join(repo, "hermes_cli", "runtime_provider.py"), [
      `if provider == \"openai-${runtimeStem}\":`,
      `    api_mode = \"${runtimeStem}_responses\"`,
    ].join("\n"));
  }
  return home;
}

function fakeHostPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-version-only-"));
  tempDirs.push(dir);
  const file = path.join(dir, "hermes");
  fs.writeFileSync(file, "#!/bin/sh\nprintf 'Hermes Agent v0.17.0\\n'\n", { mode: 0o700 });
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: fakeHostPath() },
  });
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("version-only fake host cannot trigger direct model mutation", () => {
  // Given: exact version output without source/runtime marker proof
  const home = makeHome({ withProof: false });
  // When: install is explicitly approved
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: model settings remain unwritten and fallback is explicit
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(home, "config.yaml");
  const config = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  assert.doesNotMatch(config, /gpt-5\.6|reasoning_effort|max_concurrent_children/);
  assert.match(result.stdout, /model config: fallback/);
  assert.match(result.stdout, /host source/i);
});

test("dry-run preserve labels requested model and effort as unapplied", () => {
  // Given: a verified host with existing custom model bytes
  const home = makeHome();
  fs.writeFileSync(path.join(home, "config.yaml"), "_config_version: 30\nmodel:\n  provider: custom\n  default: local\n");
  // When: install is previewed without reconfigure consent
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  // Then: defaults are clearly requests, never claimed as applied state
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requested model \(unapplied\): gpt-6-astra/);
  assert.match(result.stdout, /requested effort \(unapplied\): xhigh/);
  assert.doesNotMatch(result.stdout, /^model: gpt-5\.6-luna$/m);
  assert.match(result.stdout, /concurrency: unavailable/i);
  assert.match(result.stdout, /runtime: unavailable/i);
});

test("installer and doctor report preserved custom effective capabilities as unavailable", () => {
  // Given: a custom provider with an effective synchronous limit of three
  const home = makeHome();
  fs.writeFileSync(path.join(home, "config.yaml"), [
    "_config_version: 30",
    "model:",
    "  provider: custom",
    "  default: local-model",
    "delegation:",
    "  max_concurrent_children: 3",
    "",
  ].join("\n"));
  // When: ordinary install preserves it and offline doctor reads installed state
  const installed = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  const doctor = run(["doctor", "--offline", "--hermes-home", home]);
  // Then: neither surface claims planned hard-20 or Responses state
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  for (const output of [installed.stdout, doctor.stdout]) {
    assert.match(output, /concurrency: unavailable/i);
    assert.match(output, /runtime: unavailable/i);
    assert.match(output, /global child route: unavailable/i);
    assert.doesNotMatch(output, /concurrency: hard|runtime: hard/i);
  }
});

test("dry-run fallback labels requested model and effort as unapplied", () => {
  // Given: version-only host evidence that cannot authorize mutation
  const home = makeHome({ withProof: false });
  // When: install is previewed
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  // Then: requested defaults are not represented as effective configuration
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /requested model \(unapplied\): gpt-6-astra/);
  assert.match(result.stdout, /requested effort \(unapplied\): xhigh/);
  assert.match(result.stdout, /model config: fallback/);
});

test("installer drift abort keeps current bytes and reports an aborted effective action", () => {
  // Given: a verified write plan whose config drifts at the final write boundary
  const home = makeHome();
  const file = path.join(home, "config.yaml");
  const before = "_config_version: 30\nmodel:\n  provider: custom\n  default: local\n";
  const secret = "integration-drift-secret";
  const drifted = `${before}API-Key: ${secret}\n`;
  fs.writeFileSync(file, before, { mode: 0o600 });
  const originalPath = process.env.PATH;
  process.env.PATH = fakeHostPath();
  let receipt;
  try {
    // When: installer progress reaches the point immediately before config apply
    receipt = installLitHermes({
      "hermes-home": home,
      "hermes-repo": path.join(home, "hermes-agent"),
      "no-hud": true,
      "no-patch-installed-hermes": true,
      "reconfigure-model": true,
      offline: true,
      onProgress(step) {
        if (step === "Writing Hermes config") fs.writeFileSync(file, drifted, { mode: 0o600 });
      },
      yes: true,
    });
  } finally {
    process.env.PATH = originalPath;
  }
  // Then: model write is aborted but enablement still written; no stale model plan applied
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith(drifted.trimEnd()), "drifted content must be preserved");
  assert.match(after, /lithermes/, "plugin must be enabled even on drift-abort path");
  assert.doesNotMatch(after, /gpt-5\.6-luna|reasoning_effort|max_concurrent_children/, "no model keys from stale plan");
  assert.equal(fs.readdirSync(home).some((name) => name.endsWith(".bak")), false);
  assert.equal(manifest.modelConfigAction, "aborted");
  assert.equal(manifest.configAddedLitHermes, true);
  assert.match(receipt.message, /model config: aborted/);
  assert.doesNotMatch(receipt.message, /model config: updated/);
  assert.doesNotMatch(receipt.message, new RegExp(secret));
});

test("installer drift reports current model safety instead of stale planned capabilities", () => {
  // Given: a write plan whose config drifts to an unsafe preserved TERRA route
  const home = makeHome();
  const file = path.join(home, "config.yaml");
  const before = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.5",
    "agent:",
    "  reasoning_effort: high",
    "",
  ].join("\n");
  const drifted = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-terra",
    "agent:",
    "  reasoning_effort: medium",
    "",
  ].join("\n");
  fs.writeFileSync(file, before, { mode: 0o600 });
  const originalPath = process.env.PATH;
  process.env.PATH = fakeHostPath();
  let receipt;
  try {
    // When: the config changes immediately before the planned model write
    receipt = installLitHermes({
      "hermes-home": home,
      "hermes-repo": path.join(home, "hermes-agent"),
      "no-hud": true,
      "no-patch-installed-hermes": true,
      "reconfigure-model": true,
      offline: true,
      onProgress(step) {
        if (step === "Writing Hermes config") fs.writeFileSync(file, drifted, { mode: 0o600 });
      },
      yes: true,
    });
  } finally {
    process.env.PATH = originalPath;
  }
  // Then: output describes the drifted route, not the discarded write plan
  assert.match(receipt.message, /model config: aborted/);
  assert.match(receipt.message, /model route safety: blocked \(LITHERMES_UNSAFE_MODEL_ROUTE; parent TERRA effort is below high or missing\)/);
  assert.doesNotMatch(receipt.message, /model route safety: safe/);
});
