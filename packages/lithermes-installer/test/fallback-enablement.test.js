const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");
const runtimeStem = ["co", "dex"].join("");
const openaiProvider = `openai-${runtimeStem}`;
const tempDirs = [];

function fakeHermesPath(version, pluginList = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fallback-host-"));
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
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fallback-source-"));
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
    `if provider == "${openaiProvider}":`,
    `    api_mode = "${runtimeStem}_responses"`,
  ].join("\n"));
  return repo;
}

// A host below the minimum supported version. These tests are the regression guard for
// the July 2026 defect where the enablement record was written only inside the
// model-config write path, so a fallback left the plugin inert. The fixture must be a
// host that genuinely falls back; 0.20.0 no longer does, because an unseen release at
// or above the floor is now accepted rather than silently degraded.
function run(args, hostVersion = "0.16.0", pluginList = {}) {
  const effectiveArgs = args.includes("--hermes-repo")
    ? args
    : [...args, "--hermes-repo", fakeHermesRepo()];
  return spawnSync(process.execPath, [bin, ...effectiveArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: fakeHermesPath(hostVersion, pluginList) },
  });
}

function makeTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-fallback-install-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("a host below the supported floor enables the plugin without writing model keys", () => {
  // Given: a fresh isolated home and a Hermes host older than the supported floor
  const home = makeTempHome();
  // When: install is run with --yes on the below-floor host
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: exit 0, config.yaml has plugins.enabled with lithermes but no model keys
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(home, "config.yaml");
  assert.equal(fs.existsSync(file), true, "config.yaml must exist after install");
  const config = fs.readFileSync(file, "utf8");
  assert.match(config, /lithermes/, "config must contain lithermes in plugins.enabled");
  assert.doesNotMatch(config, /gpt-5\.6-luna|reasoning_effort|max_concurrent_children/,
    "no model keys should be written on fallback path");
});

test("manifest records enablement and fallback model action on a below-floor host", () => {
  // Given: a fresh isolated home and a Hermes host older than the supported floor
  const home = makeTempHome();
  // When: install succeeds on the below-floor host
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  // Then: manifest configAddedLitHermes is true and modelConfigAction is "fallback"
  const manifest = JSON.parse(fs.readFileSync(
    path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  assert.equal(manifest.configAddedLitHermes, true,
    "manifest must reflect that enablement was written");
  assert.equal(manifest.modelConfigAction, "fallback",
    "modelConfigAction must stay 'fallback' (describes MODEL plan, not enablement)");
});

test("uninstall removes enablement written by fallback install", () => {
  // Given: a fallback install on a below-floor host that wrote enablement-only config
  const home = makeTempHome();
  const install = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(install.status, 0, install.stderr);
  assert.match(fs.readFileSync(path.join(home, "config.yaml"), "utf8"), /lithermes/);
  // When: uninstall is run
  const result = run(["uninstall", "--yes", "--hermes-home", home]);
  // Then: lithermes is removed from config
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(config, /lithermes/,
    "lithermes must be removed from config after uninstall");
});

test("fallback install on existing config with plugins preserves existing entries", () => {
  // Given: an existing config with another plugin enabled (below-floor host)
  const home = makeTempHome();
  const file = path.join(home, "config.yaml");
  const before = [
    "plugins:",
    "  enabled:",
    "    - existing-plugin",
    "",
  ].join("\n");
  fs.writeFileSync(file, before);
  // When: install runs on the unknown future host
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  // Then: lithermes is added alongside existing plugin
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(file, "utf8");
  assert.match(config, /existing-plugin/, "existing plugins must be preserved");
  assert.match(config, /lithermes/, "lithermes must be added");
});

test("offline doctor reports enabled config PASS after fallback install", () => {
  // Given: a successful fallback install on an unknown future host
  const home = makeTempHome();
  const install = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(install.status, 0, install.stderr);
  // When: offline doctor runs
  const doctor = run(["doctor", "--offline", "--hermes-home", home]);
  // Then: enabled config is PASS
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /enabled config: PASS/);
});

test("a newer host beyond the verified matrix gets enablement AND managed model config", () => {
  // The complement of the tests above: forward compatibility means an unseen release is
  // configured rather than degraded, so both the enablement record and the model keys land.
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home], "0.20.0");
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /lithermes/, "config must still contain lithermes in plugins.enabled");
  const manifest = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
  assert.equal(manifest.configAddedLitHermes, true);
  assert.equal(manifest.modelConfigAction, "write", "an unseen release at or above the floor is configured");
});
