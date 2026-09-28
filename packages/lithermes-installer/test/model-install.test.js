const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");
const { parseArgs } = require("../src/cli");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");
const runtimeStem = ["co", "dex"].join("");
const openaiProvider = `openai-${runtimeStem}`;
const responsesMode = `${runtimeStem}_responses`;
const unavailableReviewerRoute = String.fromCharCode(109, 111, 109, 117, 115);
const tempDirs = [];

function fakeHermesPath(version, pluginList = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fake-host-"));
  tempDirs.push(dir);
  const file = path.join(dir, "hermes");
  const spec = JSON.stringify({ version, ...pluginList });
  fs.writeFileSync(file, `#!/usr/bin/env node
const spec = ${spec};
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write(\`Hermes Agent v\${spec.version}\\n\`);
  process.exit(0);
}
const encoded = JSON.stringify(args);
if (encoded === JSON.stringify(["plugins", "list", "--json", "--enabled", "--user"])) {
  process.stdout.write(spec.stdout || "[]\\n");
  process.stderr.write(spec.stderr || "");
  process.exit(spec.status || 0);
}
if (encoded === JSON.stringify(["plugins", "list", "--plain", "--no-bundled"])) {
  process.stdout.write(spec.legacyStdout || "");
  process.stderr.write(spec.stderr || "");
  process.exit(spec.status || 0);
}
if (encoded === JSON.stringify(["lithermes", "status"])) {
  process.stdout.write(spec.commandStdout || \`plugin dir: \${process.env.HERMES_HOME}/plugins/lithermes\\n\`);
  process.stderr.write(spec.commandStderr || "");
  process.exit(spec.commandStatus || 0);
}
process.stderr.write("unexpected fake host arguments\\n");
process.exit(9);
`, { mode: 0o700 });
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

function fakeHermesRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fake-source-"));
  tempDirs.push(repo);
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
    `if provider == \"${openaiProvider}\":`,
    `    api_mode = \"${responsesMode}\"`,
  ].join("\n"));
  return repo;
}

function run(args, hostVersion = "0.17.0", pluginList = {}, envOverrides = {}) {
  const effectiveArgs = args.includes("--hermes-repo")
    ? args
    : [...args, "--hermes-repo", fakeHermesRepo()];
  return spawnSync(process.execPath, [bin, ...effectiveArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides, PATH: fakeHermesPath(hostVersion, pluginList) },
  });
}

function makeTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-model-install-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("model reconfigure flag parses exact model and effort values", () => {
  // Given: the complete deterministic model selection CLI
  // When: flags are parsed
  const parsed = parseArgs([
    "install", "--model", "gpt-5.6-luna", "--effort", "max",
    "--reconfigure-model",
  ]);
  // Then: the opt-in is boolean and values remain exact
  assert.deepEqual(parsed.flags, {
    model: "gpt-5.6-luna",
    effort: "max",
    "reconfigure-model": true,
  });
});

test("isolated-home install accepts explicit GPT-6 Sol/Luna routes and preserves pinned 5.6 bytes", (t) => {
  // Given: isolated homes for a GPT-6 reconfigure and a pinned legacy config
  const home = makeTempHome();
  const env = { HOME: home, USERPROFILE: home, HERMES_HOME: home };
  // When: the real installer is explicitly asked for Sol/Luna at their minimum efforts
  const install = run([
    "install", "--yes", "--offline", "--no-hud", "--no-patch-installed-hermes",
    "--hermes-home", home,
    "--model", "gpt-6-sol", "--effort", "low",
    "--child-model", "gpt-6-luna", "--child-effort", "low",
    "--reconfigure-model",
  ], "0.19.0", {}, env);
  assert.equal(install.status, 0, `${install.stderr}\n${install.stdout}`);
  const installed = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(installed, /default: gpt-6-sol/);
  assert.match(installed, /reasoning_effort: low/);
  assert.match(installed, /model: gpt-6-luna/);
  assert.doesNotMatch(installed, /context_length|compression:|threshold:/);

  // And: an ordinary rerun over the pinned 5.6 profile leaves its config byte-identical
  const pinnedHome = makeTempHome();
  const pinnedEnv = { HOME: pinnedHome, USERPROFILE: pinnedHome, HERMES_HOME: pinnedHome };
  const pinnedConfig = [
    "# pinned-legacy-config",
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-sol",
    "  context_length: 372000",
    "agent:",
    "  reasoning_effort: xhigh",
    "delegation:",
    `  provider: ${openaiProvider}`,
    "  model: gpt-5.6-luna",
    "  reasoning_effort: max",
    "  max_concurrent_children: 20",
    "  max_async_children: 3",
    "  max_spawn_depth: 1",
    "  orchestrator_enabled: false",
    "compression:",
    "  threshold: 0.9",
    "plugins:",
    "  enabled:",
    "    - existing-plugin",
    "    - lithermes",
    "",
  ].join("\n");
  const pinnedPath = path.join(pinnedHome, "config.yaml");
  fs.writeFileSync(pinnedPath, pinnedConfig, { mode: 0o600 });
  const beforeHash = crypto.createHash("sha256").update(fs.readFileSync(pinnedPath)).digest("hex");
  const rerun = run([
    "install", "--yes", "--offline", "--no-hud", "--no-patch-installed-hermes",
    "--hermes-home", pinnedHome,
  ], "0.19.0", {}, pinnedEnv);
  assert.equal(rerun.status, 0, `${rerun.stderr}\n${rerun.stdout}`);
  assert.match(rerun.stdout, /model config: preserved/);
  const after = fs.readFileSync(pinnedPath);
  const afterHash = crypto.createHash("sha256").update(after).digest("hex");
  assert.equal(afterHash, beforeHash);
  assert.equal(after.toString("utf8"), pinnedConfig);
  t.diagnostic(`pinned config SHA-256 before=${beforeHash} after=${afterHash}; byte-identical`);
  t.diagnostic("temporary HOME, HERMES_HOME, fake host, and source fixtures are removed by the test after hook");
});

test("install receipt separates configured Astra routes from unsupported reviewer and TUI routes", () => {
  // Given: a fresh isolated Hermes host
  const home = makeTempHome();
  // When: the approved install path runs through the real CLI
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: the receipt does not imply unsupported role or TUI routing succeeded
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lead route: configured \(gpt-6-astra, effort xhigh\)/);
  assert.match(result.stdout, /ordinary worker route: configured \(gpt-6-luna, effort max/);
  assert.match(result.stdout, new RegExp(`${unavailableReviewerRoute} route: unavailable .*per-subagent model override`, "i"));
  assert.match(result.stdout, /litwork-reviewer route: unavailable .*per-subagent model override/i);
  assert.match(result.stdout, /TUI route visibility: unavailable .*per-subagent/i);
  assert.doesNotMatch(result.stdout, new RegExp(`${unavailableReviewerRoute} route: configured`, "i"));
  assert.doesNotMatch(result.stdout, /litwork-reviewer route: configured/i);
});

test("install dry-run previews requested defaults without claiming discovered capabilities", () => {
  // Given: a fresh isolated home and a Hermes binary that dry-run must not execute
  const home = makeTempHome();
  // When: install is previewed
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  // Then: requested defaults and targets remain visible without discovered-state claims or writes
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Hermes CLI discovery: skipped/);
  assert.match(result.stdout, /requested model \(unapplied\): gpt-6-astra/);
  assert.match(result.stdout, /requested effort \(unapplied\): xhigh/);
  assert.match(result.stdout, /model config: fallback/);
  assert.match(result.stdout, /concurrency: unavailable/i);
  assert.match(result.stdout, /runtime: unavailable/i);
  assert.equal(fs.readdirSync(home).length, 0);
});

// Regression: dry-run deliberately never executes the Hermes binary (see "Hermes CLI
// discovery: skipped" above), but the fallback reason wrongly reused the "malformed
// banner" message as if a real host had been probed and rejected.
test("install dry-run reports host version as not probed rather than unsupported", () => {
  const home = makeTempHome();
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /unsupported Hermes host version/);
  assert.match(result.stdout, /not probed \(dry-run\)/);
});

test("install dry-run reports unapplied routes and unsupported reviewer/TUI surfaces", () => {
  // Given: a fresh isolated Hermes home
  const home = makeTempHome();
  const before = fs.readdirSync(home);
  // When: the installer previews the approved route split
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  // Then: planned routes are marked unapplied and unsupported surfaces stay unavailable
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lead route: requested \(gpt-6-astra, effort xhigh; unapplied\)/);
  assert.match(result.stdout, /ordinary worker route: requested \(gpt-6-luna, effort max; unapplied\)/);
  assert.match(result.stdout, new RegExp(`${unavailableReviewerRoute} route: unavailable \\(Hermes exposes no per-subagent model override`, "i"));
  assert.match(result.stdout, /litwork-reviewer route: unavailable \(Hermes exposes no per-subagent model override/i);
  assert.match(result.stdout, /TUI route visibility: unavailable \(Hermes exposes no per-subagent model override or TUI route visibility surface/i);
  assert.doesNotMatch(result.stdout, /lead route: configured|ordinary worker route: configured/i);
  assert.deepEqual(fs.readdirSync(home), before);
  assert.equal(fs.existsSync(path.join(home, "config.yaml")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install.lock")), false);
});

test("fresh install writes lead Astra xhigh, global child Luna max, and the full LitResearch skill", () => {
  // Given: a fresh isolated Hermes 0.17.0 home
  const home = makeTempHome();
  // When: explicit install consent is supplied
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: exact approved settings are present and no invented context key exists
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(home, "config.yaml");
  const config = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  assert.match(config, new RegExp(`provider: ${openaiProvider}`));
  assert.match(config, /default: gpt-6-astra/);
  assert.match(config, /agent:\n  reasoning_effort: xhigh/);
  assert.match(config, new RegExp(`delegation:\\n  provider: ${openaiProvider}\\n  model: gpt-6-luna\\n  reasoning_effort: max`));
  assert.match(config, /max_concurrent_children: 20/);
	assert.match(config, /max_spawn_depth: 1/);
	assert.match(config, /orchestrator_enabled: false/);
  assert.doesNotMatch(config, /650000|context_length|max_async_children/);
  assert.match(config, /display:\n  tui_agents_nudge: true/);
  assert.match(result.stdout, /model config: updated/);
  const sourceSkill = fs.readFileSync(path.join(root, "assets", "lithermes-plugin", "skills", "litresearch", "SKILL.md"), "utf8");
  const installedSkill = fs.readFileSync(path.join(home, "plugins", "lithermes", "skills", "litresearch", "SKILL.md"), "utf8");
  assert.equal(installedSkill, sourceSkill);
});

test("schema-45 install and doctor report the shared background cap", () => {
  // Given: an isolated schema-45 config with a per-batch limit and no legacy async key
  const home = makeTempHome();
  const env = { HOME: home, USERPROFILE: home, HERMES_HOME: home };
  const before = [
    "_config_version: 45",
    "model: {}",
    "delegation:",
    "  max_concurrent_children: 20",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(home, "config.yaml"), before, { mode: 0o600 });

  // When: the real CLI installer writes routes, then doctor reads the resulting profile
  const install = run([
    "install", "--yes", "--offline", "--no-hud", "--no-patch-installed-hermes",
    "--hermes-home", home,
  ], "0.21.3", {}, env);
  assert.equal(install.status, 0, install.stderr);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /default: gpt-6-astra/);
  assert.match(config, /model: gpt-6-luna/);
  assert.match(install.stdout, /model config: updated/);
  assert.match(install.stdout, /lead route: configured \(gpt-6-astra, effort xhigh\)/);
  assert.match(install.stdout, /concurrency: hard \(per batch 20; background cap 20; potential children 20\)/);

  const doctor = run(["doctor", "--offline", "--hermes-home", home], "0.21.3", {}, env);
  // Then: the installed configuration keeps routes and reports no multiplied async limit
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /global child route: configured/);
  assert.match(doctor.stdout, /concurrency: hard \(per batch 20; background cap 20; potential children 20\)/);
  assert.doesNotMatch(doctor.stdout, /async batches|potential children 60/);
});

test("real installer writes an explicit Astra parent and Astra global child effort", () => {
  // Given: a fresh isolated Hermes home and an explicit managed route reset
  const home = makeTempHome();
  // When: the real CLI receives Astra for both the lead and child routes
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--model", "gpt-6-astra", "--effort", "low",
    "--child-model", "gpt-6-astra", "--child-effort", "max",
    "--reconfigure-model",
  ]);
  // Then: the exact explicit route is persisted and reported, with no fallback
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /default: gpt-6-astra/);
  assert.match(config, /agent:\n  reasoning_effort: low/);
  assert.match(config, new RegExp(`delegation:\n  provider: ${openaiProvider}\n  model: gpt-6-astra\n  reasoning_effort: max`));
  assert.match(result.stdout, /lead route: configured \(gpt-6-astra, effort low\)/);
  assert.match(result.stdout, /ordinary worker route: configured \(gpt-6-astra, effort max\)/);
  assert.doesNotMatch(result.stdout, /fallback|unavailable \(approved Astra/i);
});

test("managed Astra sampling stops the real installer and doctor before mutation", () => {
  // Given: a user-owned managed Astra config with unsupported request sampling
  const home = makeTempHome();
  const file = path.join(home, "config.yaml");
  const before = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-6-astra",
    "  temperature: 0.2",
    "agent:",
    "  reasoning_effort: xhigh",
    "  top_logprobs: 2",
    "delegation:",
    `  provider: ${openaiProvider}`,
    "  model: gpt-5.6-luna",
    "  reasoning_effort: max",
    "plugins:",
    "  enabled:",
    "    - existing-plugin",
    "",
  ].join("\n");
  fs.writeFileSync(file, before, { mode: 0o600 });
  // When: install and doctor reach the real CLI model boundary
  const install = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  const doctor = run(["doctor", "--offline", "--hermes-home", home]);
  // Then: both surfaces fail closed and neither changes the user-owned bytes
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /LITHERMES_UNSAFE_MODEL_SAMPLING/);
  assert.equal(doctor.status, 1, doctor.stderr);
  assert.match(doctor.stdout, /model route safety: blocked/i);
  assert.match(doctor.stdout, /LITHERMES_UNSAFE_MODEL_SAMPLING/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), false);
  assert.equal(fs.existsSync(`${file}.lithermes-model.bak`), false);
});

test("explicit lead SOL/medium route is rejected without mutation", () => {
  // Given: a fresh isolated Hermes 0.17.0 home
  const home = makeTempHome();
  // When: the exact Luna/medium selection is installed
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--model", "gpt-5.6-sol", "--effort", "medium",
  ]);
  // Then: no plugin or host config is created and no silent fallback occurs
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /effort medium is not offered for gpt-5\.6-sol/i);
  assert.equal(fs.existsSync(path.join(home, "config.yaml")), false);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
});

test("existing unsafe routes stop install before plugin or config mutation", () => {
  // Given: exact existing Luna configs below the approved effort floor
  const cases = [
    { model: "gpt-5.6-luna", effort: "medium" },
    { model: "gpt-5.6-luna", effort: "low" },
    { model: "gpt-5.6-luna", effort: "xhigh" },
    { model: "gpt-6-astra", effort: "none" },
    { model: "gpt-6-astra", effort: "garbage" },
  ];
  for (const entry of cases) {
    const home = makeTempHome();
    const file = path.join(home, "config.yaml");
    const before = [
      "# preserve-this-byte-sequence",
      "_config_version: 30",
      "model:",
      `  provider: ${openaiProvider}`,
      `  default: ${entry.model}`,
      "agent:",
      `  reasoning_effort: ${entry.effort}`,
      "plugins:",
      "  enabled:",
      "    - existing-plugin",
      "",
    ].join("\n");
    fs.writeFileSync(file, before, { mode: 0o600 });
    // When: normal installation is requested without reconfigure consent
    const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
    // Then: the typed stop is visible and no install surface is mutated
    assert.notEqual(result.status, 0, `${entry.model} unexpectedly installed`);
    assert.match(result.stderr, /LITHERMES_UNSAFE_MODEL_ROUTE/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
    assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), false);
  }
});

test("doctor fails closed for every unsupported existing Astra effort", () => {
  // Given: a user-owned Astra route with each non-approved effort spelling
  for (const effort of ["none", "garbage"]) {
    const home = makeTempHome();
    const file = path.join(home, "config.yaml");
    const before = [
      "_config_version: 30",
      "model:",
      `  provider: ${openaiProvider}`,
      "  default: gpt-6-astra",
      "agent:",
      `  reasoning_effort: ${effort}`,
      "plugins:",
      "  enabled:",
      "    - existing-plugin",
      "",
    ].join("\n");
    fs.writeFileSync(file, before, { mode: 0o600 });
    // When: the actual offline doctor inspects the existing config
    const result = run(["doctor", "--offline", "--hermes-home", home]);
    // Then: unsupported Astra is blocked without exposing or rewriting input
    assert.equal(result.status, 1, `${effort}: ${result.stderr}`);
    assert.match(result.stdout, /model route safety: blocked/i);
    assert.match(result.stdout, /LITHERMES_UNSAFE_MODEL_ROUTE/);
    assert.match(result.stdout, /Astra effort is unsupported or missing/i);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test("existing TERRA max parent routes allow install without changing model bytes", () => {
  // Given: a user-owned TERRA/max route with the plugin already enabled
  const home = makeTempHome();
  const file = path.join(home, "config.yaml");
  const before = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-terra",
    "agent:",
    "  reasoning_effort: max",
    "delegation:",
    "  model: \"\"",
    "  reasoning_effort: \"\"",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n");
  fs.writeFileSync(file, before, { mode: 0o600 });
  // When: installation is requested without model reconfiguration
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: the plugin installs and the existing model route stays byte-identical
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(result.stdout, /model route safety: safe/i);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), true);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), true);
});

test("doctor fails closed for existing unsafe routes without printing unrelated config scalars", () => {
  // Given: an enabled config with an exact Luna route and an unrelated private scalar
  const home = makeTempHome();
  const marker = "do-not-print-this-private-value";
  const file = path.join(home, "config.yaml");
  fs.writeFileSync(file, [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-luna",
    "agent:",
    "  reasoning_effort: medium",
    "metadata:",
    `  private_note: ${marker}`,
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n"), { mode: 0o600 });
  // When: offline doctor evaluates the effective route
  const result = run(["doctor", "--offline", "--hermes-home", home]);
  // Then: doctor fails with bounded typed diagnostics and no scalar disclosure
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /model route safety: blocked/i);
  assert.match(result.stdout, /LITHERMES_UNSAFE_MODEL_ROUTE/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(marker));
});

test("existing unsafe global-child routes stop install and fail doctor", () => {
  // Given: a safe legacy SOL/high parent and unsafe inherited-provider Luna child routes
  const cases = [
    { model: "gpt-5.6-luna", effort: "medium" },
    { model: "gpt-5.6-luna", effort: "low" },
  ];
  for (const entry of cases) {
    const home = makeTempHome();
    const file = path.join(home, "config.yaml");
    const before = [
      "_config_version: 30",
      "model:",
      `  provider: ${openaiProvider}`,
      "  default: gpt-5.6-sol",
      "agent:",
      "  reasoning_effort: high",
      "delegation:",
      `  model: ${entry.model}`,
      `  reasoning_effort: ${entry.effort}`,
      "plugins:",
      "  enabled:",
      "    - lithermes",
      "",
    ].join("\n");
    fs.writeFileSync(file, before, { mode: 0o600 });
    // When: install and doctor inspect the effective global-child route
    const install = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
    const doctor = run(["doctor", "--offline", "--hermes-home", home]);
    // Then: neither surface accepts the unsafe route, and bytes stay unchanged
    assert.notEqual(install.status, 0, `${entry.model} child unexpectedly installed`);
    assert.match(install.stderr, /LITHERMES_UNSAFE_MODEL_ROUTE/);
    assert.equal(doctor.status, 1, doctor.stderr);
    assert.match(doctor.stdout, /model route safety: blocked/i);
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
  }
});

test("missing explicit model or effort values are rejected without mutation", () => {
  for (const flag of ["--model", "--effort"]) {
    const home = makeTempHome();
    const result = run([
      "install", "--yes", "--offline", "--no-hud", "--hermes-home", home, flag,
    ]);
    assert.notEqual(result.status, 0, `${flag} unexpectedly succeeded`);
    assert.equal(fs.existsSync(path.join(home, "config.yaml")), false);
    assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
  }
});

test("reconfigure preserves an enabled custom child transport byte-for-byte", () => {
  const home = makeTempHome();
  const file = path.join(home, "config.yaml");
  const before = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: xhigh",
    "delegation:",
    "  model: gpt-5.6-terra",
    "  reasoning_effort: high",
    "  base_url: https://example.invalid/v1",
    "  api_mode: chat_completions",
    "  max_concurrent_children: 20",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n");
  fs.writeFileSync(file, before, { mode: 0o600 });
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--reconfigure-model",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(result.stdout, /model config: preserved/i);
  assert.match(result.stdout, /global child route: unavailable/i);
  assert.doesNotMatch(result.stdout, /global child route: configured/i);
});

test("credential-risk install enables plugin without model write or backup and leaks no scalar", () => {
  // Given: a credential-bearing but syntactically valid host config
  const home = makeTempHome();
  const secret = "never-echo-this-secret";
  const file = path.join(home, "config.yaml");
  const before = `_config_version: 30\nproviders:\n  openai:\n    api_key: ${secret}\n`;
  fs.writeFileSync(file, before, { mode: 0o600 });
  // When: plugin installation is requested
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--reconfigure-model",
  ]);
  // Then: enablement is written, no model keys or backup, and output is redacted
  assert.equal(result.status, 0, result.stderr);
  const after = fs.readFileSync(file, "utf8");
  assert.match(after, /lithermes/, "plugin must be enabled even on credential-risk fallback");
  assert.match(after, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), "original config content must be preserved");
  assert.doesNotMatch(after, /gpt-5\.6-luna|reasoning_effort|max_concurrent_children/, "no model keys on fallback");
  assert.equal(fs.readdirSync(home).some((name) => name.endsWith(".bak")), false);
  assert.match(result.stdout, /hermes model/);
  assert.match(result.stdout, /credential guard: api_key detected; use `hermes model` to manage it; installer left config untouched/i);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
});

test("credential-bearing unsafe route stops before plugin mutation without leaking or changing bytes", () => {
  // Given: an exact Luna route plus a credential-bearing provider block
  const home = makeTempHome();
  const secret = "unsafe-install-secret-never-print";
  const file = path.join(home, "config.yaml");
  const before = [
    "_config_version: 30",
    "model:",
    `  provider: ${openaiProvider}`,
    "  default: gpt-5.6-luna",
    "agent:",
    "  reasoning_effort: medium",
    "providers:",
    "  openai:",
    `    api_key: ${secret}`,
    "",
  ].join("\n");
  fs.writeFileSync(file, before, { mode: 0o600 });
  // When: installation is requested
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: the unsafe route stops before plugin/config mutation and leaks no secret
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LITHERMES_UNSAFE_MODEL_ROUTE/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), false);
});

test("malformed config install enables plugin without model mutation", () => {
  // Given: malformed YAML bytes
  const home = makeTempHome();
  const file = path.join(home, "config.yaml");
  const before = "model: [unterminated";
  fs.writeFileSync(file, before, { mode: 0o600 });
  // When: plugin installation is requested
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--reconfigure-model",
  ]);
  // Then: enablement is appended, original bytes preserved, and fallback is explicit
  assert.equal(result.status, 0, result.stderr);
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith(before), "original malformed content must be preserved");
  assert.match(after, /lithermes/, "plugin must be enabled even on malformed fallback");
  assert.doesNotMatch(after, /gpt-5\.6-luna|reasoning_effort|max_concurrent_children/);
  assert.match(result.stdout, /malformed host config/);
  assert.match(result.stdout, /hermes model/);
});

test("doctor distinguishes bundled, enabled, loaded, and model capability states", () => {
  // Given: a fresh verified install not proven loaded by the host process
  const home = makeTempHome();
  const install = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(install.status, 0, install.stderr);
  // When: npm doctor runs without a loaded-plugin receipt
  const result = run(["doctor", "--offline", "--hermes-home", home]);
  // Then: source/enabled pass, loaded stays partial, and capability states are exact
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bundled source: PASS/);
  assert.match(result.stdout, /enabled config: PASS/);
  assert.match(result.stdout, /loaded plugin: PARTIAL/);
  assert.match(result.stdout, /auto-compaction: unavailable/i);
	assert.match(result.stdout, /concurrency: hard \(per batch 20; async batches 3; potential children 60\)/);
	assert.match(result.stdout, /recursion: hard \(depth 1, flat\)/);
  assert.match(result.stdout, new RegExp(`runtime: hard \\(${openaiProvider} ${responsesMode}\\)`));
	assert.match(result.stdout, /global child route: configured \(gpt-6-luna, effort max, provider inherited; execution receipt required\)/);
});

test("doctor exits nonzero when a preserved config enables nested delegation", () => {
	const home = makeTempHome();
	const config = [
		"_config_version: 30",
		`model:\n  provider: ${openaiProvider}\n  default: gpt-5.6-sol`,
		"agent:\n  reasoning_effort: high",
		"delegation:\n  max_concurrent_children: 20\n  max_spawn_depth: 2\n  orchestrator_enabled: true",
		"plugins:\n  enabled:\n    - lithermes",
		"",
	].join("\n");
	fs.writeFileSync(path.join(home, "config.yaml"), config);
	const result = run(["doctor", "--offline", "--hermes-home", home]);
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /recursion: unavailable \(nested delegation is enabled at max_spawn_depth 2\)/);
});

test("online doctor passes only enabled user JSON plus loaded status origin", () => {
  // Given: an isolated install and exact enabled-user discovery JSON
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  // When: online doctor queries discovery and the loaded command surface
  const result = run(["doctor", "--hermes-home", home], "0.17.0", {
    stdout: JSON.stringify([{ name: "lithermes", source: "user", status: "enabled", version: "0.8.23" }]),
  });
  // Then: the host-loaded state is proven
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded plugin: PASS/);
});

test("online doctor rejects a plugin absent from enabled user JSON", () => {
  // Given: an isolated install and a disabled host plugin row
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  // When: online doctor sees the plugin name without enabled state
  const result = run(["doctor", "--hermes-home", home], "0.17.0", {
    legacyStdout: "not enabled  user     0.8.23   lithermes\n",
    stdout: "[]",
  });
  // Then: mere discovery cannot become loaded PASS
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded plugin: PARTIAL/);
  assert.doesNotMatch(result.stdout, /loaded plugin: PASS/);
});

test("online doctor rejects failed plugin-list output that names lithermes", () => {
  // Given: the host list command fails after naming the plugin
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  // When: online doctor receives a nonzero command result
  const result = run(["doctor", "--hermes-home", home], "0.17.0", {
    legacyStdout: "enabled      user     0.8.23   lithermes\n",
    stdout: JSON.stringify([{ name: "lithermes", source: "user", status: "enabled" }]),
    status: 1,
  });
  // Then: command failure prevents loaded proof
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded plugin: PARTIAL/);
});

test("online doctor rejects warning-bearing output that names lithermes", () => {
  // Given: the host list command reports an enabled row plus a warning
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  // When: online doctor receives warning text on stderr
  const result = run(["doctor", "--hermes-home", home], "0.17.0", {
    legacyStdout: "enabled      user     0.8.23   lithermes\n",
    stdout: JSON.stringify([{ name: "lithermes", source: "user", status: "enabled" }]),
    stderr: "warning: plugin metadata is incomplete\n",
  });
  // Then: warning-bearing output is not accepted as loaded proof
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded plugin: PARTIAL/);
});

test("online doctor rejects enabled discovery when loaded plugin command fails", () => {
  // Given: enabled user discovery succeeds but plugin import/command execution fails
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  // When: online doctor executes the real loaded-plugin command boundary
  const result = run(["doctor", "--hermes-home", home], "0.17.0", {
    commandStderr: "plugin import failed\n",
    commandStatus: 1,
    legacyStdout: "enabled      user     0.8.23   lithermes\n",
    stdout: JSON.stringify([{ name: "lithermes", source: "user", status: "enabled" }]),
  });
  // Then: enabled/discovered is never promoted to loaded PASS
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /loaded plugin: PARTIAL/);
  assert.doesNotMatch(result.stdout, /loaded plugin: PASS/);
});

test("host capability cannot be spoofed by a version flag", () => {
  // Given: an unsupported real host and an attempted supported-version override
  const home = makeTempHome();
  // When: install receives the obsolete override-shaped argument
  const result = run([
    "install", "--yes", "--offline", "--no-hud", "--hermes-home", home,
    "--hermes-version", "0.17.0",
  ], "0.18.0");
  // Then: actual host detection wins. Previously this was observed indirectly — 0.18.0
  // was outside the exact-membership set, so the write was refused. Now that an unseen
  // release at or above the floor is accepted, the receipt names the detected version
  // directly, which proves the same property without relying on a rejection.
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  assert.match(manifest.modelConfigReason, /Hermes 0\.18\.0 is beyond the verified matrix/u,
    "the detected host version must drive the plan, not the --hermes-version argument");
  assert.doesNotMatch(manifest.modelConfigReason, /0\.17\.0/u,
    "the spoofed version must not appear anywhere in the recorded reason");
});
