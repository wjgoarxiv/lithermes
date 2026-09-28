const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, before, test } = require("node:test");
const { main, parseArgs } = require("../src/cli");
const {
  configHasLitHermes,
  enableLitHermesConfig,
  readDisplaySkinConfig,
  setDisplaySkinConfig,
} = require("../src/lib/config");
const {
  checkCliSource,
  checkGatewaySource,
  requiredSkills,
  scanPluginSkills,
} = require("../src/lib/check");
const { patchInstalledHermes } = require("../src/lib/patch");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");
const packageJson = path.join(root, "package.json");
const pluginRoot = path.join(root, "assets", "lithermes-plugin");
let fakeHermesDir;
let originalPath;

before(() => {
  fakeHermesDir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-cli-host-"));
  const runtimeRepo = path.join(fakeHermesDir, "runtime");
  const runtimeNode = path.join(runtimeRepo, "venv", "bin", "node");
  const runtimeStem = ["co", "dex"].join("");
  fs.mkdirSync(path.dirname(runtimeNode), { recursive: true });
  fs.mkdirSync(path.join(runtimeRepo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRepo, "hermes_cli"), { recursive: true });
  fs.symlinkSync(process.execPath, runtimeNode);
  fs.writeFileSync(path.join(runtimeRepo, "tools", "delegate_tool.py"), [
    "def _get_max_concurrent_children():",
    '    val = cfg.get("max_concurrent_children")',
    "    return max(1, int(val))",
    'configured_model = str(cfg.get("model") or "").strip() or None',
    'delegation_effort = str(delegation_cfg.get("reasoning_effort") or "").strip()',
    "effective_model = model or parent_agent.model",
  ].join("\n"));
  fs.writeFileSync(path.join(runtimeRepo, "hermes_cli", "runtime_provider.py"), [
    `if provider == "openai-${runtimeStem}":`,
    `    api_mode = "${runtimeStem}_responses"`,
  ].join("\n"));
  fs.writeFileSync(
    path.join(fakeHermesDir, "hermes"),
    `#!${runtimeNode}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("Hermes Agent v0.17.0\\n");
  process.exit(0);
}
process.exit(1);
`,
    { mode: 0o700 },
  );
  originalPath = process.env.PATH;
  process.env.PATH = `${fakeHermesDir}${path.delimiter}${originalPath || ""}`;
});

after(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  fs.rmSync(fakeHermesDir, { force: true, recursive: true });
});

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runPackageBin(packageRoot, args) {
  return spawnSync(process.execPath, [path.join(packageRoot, "bin", "lithermes.js"), ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: path.join(root, "node_modules"),
      NO_UPDATE_NOTIFIER: "1",
    },
  });
}

function makeTempPackage(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-test-package-"));
  const packageRoot = path.join(sandbox, "package");
  fs.mkdirSync(packageRoot);
  for (const entry of ["assets", "bin", "src"]) {
    fs.cpSync(path.join(root, entry), path.join(packageRoot, entry), { recursive: true });
  }
  fs.copyFileSync(packageJson, path.join(packageRoot, "package.json"));
  t.after(() => fs.rmSync(sandbox, { force: true, recursive: true }));
  return packageRoot;
}

function makePackedPackage(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-test-tarball-"));
  t.after(() => fs.rmSync(sandbox, { force: true, recursive: true }));
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", sandbox], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  const metadata = JSON.parse(packed.stdout);
  const archive = path.join(sandbox, metadata[0].filename);
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", sandbox], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  return path.join(sandbox, "package");
}

function mutateFileWithoutChangingSize(file) {
  const content = fs.readFileSync(file);
  assert.ok(content.length > 0);
  content[0] ^= 1;
  fs.writeFileSync(file, content);
}

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-test-home-"));
}

function makeTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-test-repo-"));
}

function runPluginPython(source, options = {}) {
  return spawnSync("python3", ["-c", source], {
    cwd: options.cwd || makeTempRepo(),
    encoding: "utf8",
    env: {
      ...process.env,
      HERMES_HOME: options.hermesHome || makeTempHome(),
      PYTHONPATH: pluginRoot,
      PYTHONDONTWRITEBYTECODE: "1",
      ...(options.env || {}),
    },
  });
}

async function runInteractiveInstall(home, { env = { CI: undefined, NO_COLOR: undefined, TERM: "xterm-256color" } } = {}) {
  const ttyRestorers = [
    [process.stdin, "isTTY"],
    [process.stdout, "isTTY"],
  ].map(([stream, property]) => {
    const hadOwnProperty = Object.prototype.hasOwnProperty.call(stream, property);
    const previous = stream[property];
    stream[property] = true;
    return () => {
      if (hadOwnProperty) stream[property] = previous;
      else delete stream[property];
    };
  });
  const envRestorers = Object.entries(env).map(([key, value]) => {
    const hadValue = Object.prototype.hasOwnProperty.call(process.env, key);
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    return () => {
      if (hadValue) process.env[key] = previous;
      else delete process.env[key];
    };
  });
  try {
    await main([
      "install",
      "--yes",
      "--offline",
      "--no-style",
      "--no-auto-update",
      "--hermes-home",
      home,
    ], {
      env: { ...process.env },
      isInteractive: true,
      scheduleUpdateCheck: () => {},
      shouldAutoUpdate: () => false,
    });
  } finally {
    for (const restore of envRestorers.reverse()) restore();
    for (const restore of ttyRestorers.reverse()) restore();
  }
}

test("package metadata exposes the lithermes binary", () => {
  const pkg = require(packageJson);
  assert.equal(pkg.name, "@litfamily/lithermes");
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["lithermes", "lithermes-ai"]);
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.bin.lithermes, "bin/lithermes.js");
  // Preserve both installed executable aliases across the npm identity migration.
  // Scoped execution selects the package and the lithermes binary explicitly.
  assert.equal(pkg.bin["lithermes-ai"], "bin/lithermes.js");
});

test("version command prints package name and semver", () => {
  const result = run(["version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lithermes \d+\.\d+\.\d+/);
});

test("install spinner flags parse without values", () => {
  assert.deepEqual(parseArgs(["install", "--spinner", "--no-spinner", "--hermes-home", "/tmp/h"]).flags, {
    spinner: true,
    "no-spinner": true,
    "hermes-home": "/tmp/h",
  });
});

test("update-notifier exclusion flags parse as booleans without consuming positionals", () => {
  assert.deepEqual(parseArgs(["check", "--json", "--offline", "next"]).flags, {
    json: true,
    offline: true,
  });
});

test("a notifier scheduling failure cannot change management stdout or exit status", async () => {
  const home = makeTempHome();
  const installed = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(installed.status, 0, installed.stderr);
  const output = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  let scheduled = false;
  console.log = (message) => output.push(String(message));
  process.exitCode = undefined;
  try {
    await main(["check", "--hermes-home", home], {
      scheduleUpdateCheck: () => {
        scheduled = true;
        throw new Error("injected notifier failure");
      },
    });
    assert.equal(scheduled, true);
    assert.match(output.join("\n"), /LitHermes check PASS/);
    assert.equal(process.exitCode, undefined);
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
});

test("a failed doctor never invokes the notifier or mutates its cache", async () => {
  const home = makeTempHome();
  const provider = `openai-${["co", "dex"].join("")}`;
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(home, "config.yaml"), [
    "_config_version: 30",
    "model:",
    `  provider: ${provider}`,
    "  default: gpt-5.6-sol",
    "agent:",
    "  reasoning_effort: high",
    "delegation:",
    "  max_concurrent_children: 20",
    "  max_spawn_depth: 2",
    "  orchestrator_enabled: true",
    "plugins:",
    "  enabled:",
    "    - lithermes",
    "",
  ].join("\n"));
  const sentinel = '{"sentinel":"unchanged"}\n';
  fs.writeFileSync(cachePath, sentinel);
  const output = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  let scheduled = false;
  console.log = (message) => output.push(String(message));
  process.exitCode = undefined;
  try {
    await main(["doctor", "--offline", "--hermes-home", home], {
      scheduleUpdateCheck: () => {
        scheduled = true;
        fs.writeFileSync(cachePath, "mutated\n");
      },
    });
    assert.equal(process.exitCode, 1);
    assert.match(output.join("\n"), /nested delegation is enabled/);
    assert.equal(scheduled, false);
    assert.equal(fs.readFileSync(cachePath, "utf8"), sentinel);
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
});

test("eligible interactive CLI management commands cross the automatic-update barrier before checking", async () => {
  const home = makeTempHome();
  const installed = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(installed.status, 0, installed.stderr);
  const events = [];
  const output = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (message) => output.push(String(message));
  process.exitCode = undefined;
  try {
    await main(["check", "--hermes-home", home], {
      isInteractive: true,
      env: {},
      runAutomaticUpdate: async (options) => {
        events.push({ phase: "barrier", hermesHome: options.hermesHome });
        return { status: "current", latestVersion: "0.8.41" };
      },
      scheduleUpdateCheck: () => events.push({ phase: "advisory" }),
    });
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
  assert.deepEqual(events, [
    { phase: "barrier", hermesHome: path.resolve(home) },
    { phase: "advisory" },
  ]);
  assert.match(output.join("\n"), /LitHermes check PASS/);
});

test("--no-auto-update leaves the cache-only advisory lane available", async () => {
  const home = makeTempHome();
  const installed = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(installed.status, 0, installed.stderr);
  let barrier = 0;
  let advisory = 0;
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = () => {};
  process.exitCode = undefined;
  try {
    await main(["check", "--no-auto-update", "--hermes-home", home], {
      isInteractive: true,
      runAutomaticUpdate: async () => { barrier += 1; return { status: "updated" }; },
      scheduleUpdateCheck: () => { advisory += 1; },
    });
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
  assert.equal(barrier, 0);
  assert.equal(advisory, 1);
});

test("help mentions spinner flags", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--spinner/);
  assert.match(result.stdout, /--no-spinner/);
});

test("install --hud <accent> sets the chosen accent non-interactively", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home, "--hud", "rose"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-rose.yaml")), true);
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(cfg, /skin: lithermes-rose/);
});

test("install --no-hud installs skins but sets no accent", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home, "--no-hud"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-cyan.yaml")), true, "presets still installed");
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(cfg, /skin: lithermes-/);
});

test("install on a non-interactive stream does not prompt or set an accent", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(cfg, /skin: lithermes-/);
});

test("fresh interactive install activates the Ignition default skin", async (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));

  await runInteractiveInstall(home);

  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.equal(readDisplaySkinConfig(cfg), "lithermes-ignition");
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-ignition.yaml")), true);
});

test("fresh interactive install preserves an existing empty display.skin key", async (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const configPath = path.join(home, "config.yaml");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configPath, "display:\n  skin:\n");

  await runInteractiveInstall(home);

  const cfg = fs.readFileSync(configPath, "utf8");
  assert.equal(readDisplaySkinConfig(cfg), null);
  assert.match(cfg, /^  skin:\s*$/m);
});

test("interactive reinstall preserves an existing display.skin", async (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const initial = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(initial.status, 0, initial.stderr);
  const configPath = path.join(home, "config.yaml");
  const existingSkinPath = path.join(home, "skins", "lithermes-rose.yaml");
  assert.equal(fs.existsSync(existingSkinPath), true);
  fs.writeFileSync(configPath, setDisplaySkinConfig(fs.readFileSync(configPath, "utf8"), "lithermes-rose"));

  await runInteractiveInstall(home);

  const cfg = fs.readFileSync(configPath, "utf8");
  assert.equal(readDisplaySkinConfig(cfg), "lithermes-rose");
});

test("interactive NO_COLOR install does not activate or mutate display.skin", async (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const initial = run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]);
  assert.equal(initial.status, 0, initial.stderr);
  const configPath = path.join(home, "config.yaml");
  fs.writeFileSync(configPath, setDisplaySkinConfig(fs.readFileSync(configPath, "utf8"), "lithermes-rose"));

  await runInteractiveInstall(home, { env: { NO_COLOR: "1" } });

  const cfg = fs.readFileSync(configPath, "utf8");
  assert.equal(readDisplaySkinConfig(cfg), "lithermes-rose");
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-cyan.yaml")), true);
});

test("CI install does not activate a skin", async (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));

  await runInteractiveInstall(home, { env: { CI: "1" } });

  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.equal(readDisplaySkinConfig(cfg), null);
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-cyan.yaml")), true);
});

test("install dry-run does not activate or mutate an existing display.skin", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  fs.mkdirSync(home, { recursive: true });
  const configPath = path.join(home, "config.yaml");
  const before = "display:\n  skin: lithermes-rose\n";
  fs.writeFileSync(configPath, before);

  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
  assert.equal(fs.existsSync(path.join(home, "skins")), false);
});

test("install --hud with an unknown accent warns and does not set a skin", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home, "--hud", "chartreuse"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr + result.stdout, /unknown accent/i);
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(cfg, /skin: lithermes-/);
});

test("hud --list shows the 10 accents and apply hint", () => {
  const result = run(["hud", "--list"], { env: { NO_COLOR: "1" } });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["cyan", "blue", "teal", "green", "lavender", "rose", "gold", "orange", "slate", "gray"]) {
    assert.match(result.stdout, new RegExp(name), `missing accent ${name}`);
  }
  assert.match(result.stdout, /lithermes hud <accent>/);
});

test("hud <accent> installs skins and sets display.skin", () => {
  const home = makeTempHome();
  const result = run(["hud", "rose", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-rose.yaml")), true);
  assert.equal(fs.existsSync(path.join(home, "skins", "lithermes-teal.yaml")), true, "all presets installed");
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(cfg, /^display:/m);
  assert.match(cfg, /skin: lithermes-rose/);
  assert.match(result.stdout, /\/skin/);
});

test("hud off clears the active skin", () => {
  const home = makeTempHome();
  run(["hud", "rose", "--hermes-home", home]);
  const result = run(["hud", "off", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  const cfg = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.doesNotMatch(cfg, /skin: lithermes-rose/);
});

test("uninstall preserves selected Ignition and custom native skin state", (t) => {
  for (const skin of ["lithermes-ignition", "my-skin"]) {
    const home = makeTempHome();
    t.after(() => fs.rmSync(home, { force: true, recursive: true }));
    fs.mkdirSync(path.join(home, "skins"), { recursive: true });
    const custom = path.join(home, "skins", "my-skin.yaml");
    fs.writeFileSync(custom, "# user-owned native skin\n");
    const installed = run(["install", "--yes", "--offline", "--no-hud", "--no-auto-update", "--no-patch-installed-hermes", "--hermes-home", home]);
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const config = path.join(home, "config.yaml");
    fs.writeFileSync(config, setDisplaySkinConfig(fs.readFileSync(config, "utf8"), skin));
    const ignition = path.join(home, "skins", "lithermes-ignition.yaml");
    const before = fs.readFileSync(ignition);
    const removed = run(["uninstall", "--yes", "--offline", "--no-auto-update", "--hermes-home", home]);
    assert.equal(removed.status, 0, removed.stdout + removed.stderr);
    assert.equal(readDisplaySkinConfig(fs.readFileSync(config, "utf8")), skin);
    assert.deepEqual(fs.readFileSync(ignition), before);
    assert.equal(fs.readFileSync(custom, "utf8"), "# user-owned native skin\n");
  }
});

test("hud rejects an unknown accent", () => {
  const home = makeTempHome();
  const result = run(["hud", "chartreuse", "--hermes-home", home]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /unknown accent/i);
});

test("help mentions hud", () => {
  const result = run(["help"]);
  assert.match(result.stdout, /hud/);
});

test("check reports missing Hermes home with actionable exit code", () => {
  const missing = path.join(os.tmpdir(), `lithermes-missing-${Date.now()}`);
  const result = run(["check", "--offline", "--hermes-home", missing]);
  assert.equal(result.status, 2);
  assert.match(result.stderr + result.stdout, /Hermes installation not found/);
  assert.match(result.stderr + result.stdout, /--hermes-home/);
});

test("install dry-run reports writes but does not create files", () => {
  const home = makeTempHome();
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN/);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
});

test("install dry-run does not create a missing Hermes home", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-dry-parent-"));
  const home = path.join(parent, "missing-home");
  assert.equal(fs.existsSync(home), false);
  const result = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN/);
  assert.equal(fs.existsSync(home), false, "dry-run must not create the Hermes home directory");
});

test("install dry-run never invokes Hermes CLI discovery", (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-dry-cli-"));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, "hermes-home");
  const fakeBin = path.join(sandbox, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "hermes"), `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const target = path.join(process.env.HERMES_HOME, ".update_check");
fs.mkdirSync(target, { recursive: true });
fs.appendFileSync(path.join(target, "log"), process.argv.slice(2).join(" ") + "\\n");
process.stdout.write("Hermes Agent v0.17.0\\n");
`, { mode: 0o700 });

  const result = run(["install", "--dry-run", "--offline"], {
    env: {
      HERMES_HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN/);
  assert.deepEqual(fs.readdirSync(home), [], "dry-run must not execute a Hermes binary that can mutate its profile");
});

test("install is idempotent and check sees lithermes commands", () => {
  const home = makeTempHome();
  const first = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(first.status, 0, first.stderr);
  const second = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already up to date/);

  const config = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
  assert.match(config, /lithermes/);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), true);

  const check = run(["check", "--offline", "--hermes-home", home]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /LitHermes check PASS/);
  assert.match(check.stdout, /lit-loop/);
  assert.match(check.stdout, /lit-plan/);
});

const skillRenameAliases = {
  hyperplan: "lit-crucible",
  "init-deep": "lit-init",
  "git-master": "lit-commit",
  "remove-ai-slops": "lit-burnoff",
  "ai-slop-remover": "lit-burnoff-file",
  programming: "lit-code",
};

function seedOldSkillInstall(home, version) {
  const { listFiles, sha256 } = require("../src/lib/files");
  const plugin = path.join(home, "plugins", "lithermes");
  for (const [old, renamed] of Object.entries(skillRenameAliases)) {
    fs.renameSync(path.join(plugin, "skills", renamed), path.join(plugin, "skills", old));
    const entry = path.join(plugin, "skills", old, "SKILL.md");
    fs.writeFileSync(entry, fs.readFileSync(entry, "utf8").replace(`name: ${renamed}\n`, `name: ${old}\n`));
  }
  const payloadFile = path.join(plugin, "payload-version.json");
  const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
  payload.files = listFiles(plugin).filter((file) => file !== payloadFile)
    .map((file) => ({ path: path.relative(plugin, file), sha256: sha256(file) }));
  payload.sourceHash = require("node:crypto").createHash("sha256")
    .update(payload.files.map((entry) => `${entry.path}:${entry.sha256}`).sort().join("\n")).digest("hex");
  fs.writeFileSync(payloadFile, JSON.stringify(payload, null, 2));
  const receiptFile = path.join(home, "lithermes", "install-manifest.json");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  receipt.version = version;
  receipt.files = listFiles(plugin).map((file) => ({ path: path.relative(plugin, file), sha256: sha256(file) }));
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  return plugin;
}

for (const scenario of ["reinstall", "update"]) {
  test(`${scenario} migrates all six legacy skill directories and payload hashes`, (t) => {
    const { sha256 } = require("../src/lib/files");
    const home = makeTempHome();
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
    const plugin = seedOldSkillInstall(home, scenario === "update" ? "0.9.8" : require(packageJson).version);
    const userSkill = path.join(home, "skills", "git-master", "SKILL.md");
    fs.mkdirSync(path.dirname(userSkill), { recursive: true });
    fs.writeFileSync(userSkill, "Unmanaged user skill must survive.\n");
    const before = fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8");
    const preview = run(["install", "--dry-run", "--offline", "--hermes-home", home]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"), before);
    for (const old of Object.keys(skillRenameAliases)) assert.ok(fs.existsSync(path.join(plugin, "skills", old)));
    const result = run(["install", "--yes", "--offline", "--hermes-home", home]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(home, "lithermes", "install-manifest.json"), "utf8"));
    for (const [old, renamed] of Object.entries(skillRenameAliases)) {
      assert.equal(fs.existsSync(path.join(plugin, "skills", old)), false, old);
      assert.ok(fs.existsSync(path.join(plugin, "skills", renamed, "SKILL.md")), renamed);
      assert.equal(receipt.files.some((entry) => entry.path.startsWith(`skills/${old}/`)), false, old);
      assert.ok(receipt.files.some((entry) => entry.path === `skills/${renamed}/SKILL.md`), renamed);
    }
    for (const entry of receipt.files) assert.equal(sha256(path.join(plugin, entry.path)), entry.sha256, entry.path);
    assert.equal(fs.readFileSync(userSkill, "utf8"), "Unmanaged user skill must survive.\n");
    const checked = run(["check", "--offline", "--hermes-home", home]);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const payload = JSON.parse(fs.readFileSync(path.join(plugin, "payload-version.json"), "utf8"));
    const installedSkills = scanPluginSkills(plugin, payload, true);
    for (const [old, renamed] of Object.entries(skillRenameAliases)) {
      assert.ok(installedSkills.includes(renamed), renamed);
      assert.equal(installedSkills.includes(old), false, old);
    }
    const doctor = run(["doctor", "--offline", "--hermes-home", home]);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    assert.match(doctor.stdout, /installed skill payload: PASS/);
  });
}

test("skill rename migration refuses a modified old skill without deleting it", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
  const plugin = seedOldSkillInstall(home, "0.9.8");
  const file = path.join(plugin, "skills", "hyperplan", "SKILL.md");
  fs.appendFileSync(file, "\nUser change must survive.\n");
  const before = fs.readFileSync(file, "utf8");
  const result = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 5, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(path.join(plugin, "skills", "lit-crucible")), false);
});

test("forced install progress stays plain when output is captured", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home], {
    env: {
      LITHERMES_FORCE_SPINNER: "1",
      TERM: "xterm-256color",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed LitHermes/);
  assert.match(result.stderr, /Installing LitHermes/);
  assert.match(result.stderr, /Installing LitHermes complete/);
  assert.doesNotMatch(result.stdout + result.stderr, /\x1b/);
});

test("install renders a step TUI with per-step checkmarks", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home], {
    env: {
      LITHERMES_FORCE_SPINNER: "1",
      TERM: "xterm-256color",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  // Each completed install phase is finalized with its own check glyph, so the
  // step TUI leaves several ✓ marks (not just the single final line).
  const checks = result.stderr.match(/✓/gu) || [];
  assert.ok(checks.length >= 3, `expected >=3 step checkmarks, saw ${checks.length}`);
  assert.match(result.stderr, /Preparing Hermes config/);
  assert.match(result.stderr, /Copying LitHermes payload/);
});

test("install keeps non interactive output plain", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed LitHermes/);
  assert.doesNotMatch(result.stderr, /\x1b\[\?25l/);
  assert.doesNotMatch(result.stderr, /Installing LitHermes/);
});

for (const [name, extra] of [["empty CI", { CI: "" }], ["empty NO_COLOR", { NO_COLOR: "" }],
  ["dumb terminal", { TERM: "dumb" }], ["non-UTF-8 locale", { LC_ALL: "C" }]]) {
  test(`TTY install keeps the output-style prompt plain with ${name}`, (t) => {
    const home = makeTempHome();
    t.after(() => fs.rmSync(home, { force: true, recursive: true }));
    const result = spawnSync(process.execPath, ["-e",
      "process.stdin.isTTY = true; process.stdout.isTTY = true; require('./src/cli').main(process.argv.slice(1));",
      "install", "--yes", "--offline", "--no-auto-update", "--hermes-home", home], {
      cwd: root,
      encoding: "utf8",
      input: "\n",
      env: { ...process.env, CI: undefined, NO_COLOR: undefined, TERM: "xterm-256color",
        LC_ALL: "en_US.UTF-8", COLORTERM: "truecolor", ...extra },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed LitHermes/);
    assert.doesNotMatch(result.stdout + result.stderr, /\x1b/);
  });
}

test("install no-spinner flag suppresses forced spinner output", () => {
  const home = makeTempHome();
  const result = run(["install", "--yes", "--no-spinner", "--offline", "--hermes-home", home], {
    env: {
      LITHERMES_FORCE_SPINNER: "1",
      TERM: "xterm-256color",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Installed LitHermes/);
  assert.doesNotMatch(result.stderr, /\x1b\[\?25l/);
});

test("forced install failure preserves plain output and exit code", () => {
  const home = makeTempHome();
  const plugin = path.join(home, "plugins", "lithermes");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "name: user-owned\n");
  const result = run(["install", "--yes", "--offline", "--hermes-home", home], {
    env: {
      LITHERMES_FORCE_SPINNER: "1",
      TERM: "xterm-256color",
    },
  });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /LitHermes install failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /\x1b/);
  assert.match(result.stderr, /not manifest-owned/);
});

test("lit command forwards model-facing goal instructions", () => {
  const workspace = makeTempRepo();
  const result = runPluginPython(`
import json
import core
payload = core.command_lit("ship the goal integration")
print(json.dumps(payload, sort_keys=True))
`, { cwd: workspace });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.display, /Started LitHermes Litwork run/);
  assert.match(payload.display, /Forwarding task to Hermes agent now/);
  assert.doesNotMatch(payload.agent_message, /^\/goal /);
  assert.match(payload.agent_message, /ship the goal integration/);
  assert.match(payload.agent_message, /<lithermes-run-context>/);
  assert.match(payload.agent_message, /<lithermes-goal-instruction>/);
  assert.match(payload.agent_message, /Native \/goal capability/);
  assert.match(payload.agent_message, /user-managed/);
  assert.match(payload.agent_message, /unobserved/);
  assert.match(payload.agent_message, /no automatic native-goal update, clear, or resume/);
  assert.match(payload.agent_message, /Authoritative durable litgoal layer/);
  assert.match(payload.agent_message, /goal_set/);
  assert.match(payload.agent_message, /delegate_task\(tasks:\[\{goal, context\}\]\)/);
  assert.match(payload.agent_message, /Delegation model/);
  // Phantom Hermes goal tools must NOT be commanded (they do not exist in Hermes).
  assert.doesNotMatch(payload.agent_message, /First call get_goal/);
  assert.doesNotMatch(payload.agent_message, /create_goal payload/);
  assert.match(payload.agent_message, /completion_promise: Complete the requested task with evidence\./);
  assert.equal(fs.existsSync(path.join(payload.run_dir, "state.json")), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(payload.run_dir, "state.json"), "utf8")).command, "lit");
});



test("lit-plan forwards plan plus model-facing goal bootstrap", () => {
  const workspace = makeTempRepo();
  const result = runPluginPython(`
import json
import core
payload = core.command_lit_plan("ship the plan integration")
print(json.dumps(payload, sort_keys=True))
`, { cwd: workspace });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.display, /Created LitHermes plan/);
  assert.match(payload.display, /Forwarding goal bootstrap to Hermes agent now/);
  assert.match(payload.agent_message, /<lithermes-goal-instruction>/);
  assert.match(payload.agent_message, /Native \/goal capability/);
  assert.match(payload.agent_message, /user-managed/);
  assert.match(payload.agent_message, /unobserved/);
  assert.match(payload.agent_message, /no automatic native-goal update, clear, or resume/);
  assert.match(payload.agent_message, /Authoritative durable litgoal layer/);
  assert.match(payload.agent_message, /goal_set/);
  // delegation model (gap C): conduct/workers, self-verify, read-only patterns
  assert.match(payload.agent_message, /Delegation model/);
  assert.match(payload.agent_message, /codebase-search child/);
  assert.match(payload.agent_message, /external-research child/);
  assert.match(payload.agent_message, /Do NOT trust a child's self-report/);
  assert.doesNotMatch(payload.agent_message, /First call get_goal/);
  assert.doesNotMatch(payload.agent_message, /^\/goal /);
  assert.equal(fs.existsSync(payload.plan), true);
  const plan = fs.readFileSync(payload.plan, "utf8");
  assert.match(plan, /Declare only the falsifiable criteria needed/u);
  assert.match(plan, /Action: <concrete mutation or decision steps>/u);
  assert.match(plan, /Output: <exact artifact, state change, or verdict>/u);
  assert.match(plan, /Verification: \[ \] <exact command or assertion/u);
  assert.match(plan, /Final DoneClaim/u);
  assert.doesNotMatch(plan, /Declare 3\+|target 5-8 tasks|every criterion has an agent-executed/u);
});

test("start-work --resume reuses the latest run for the approved plan", () => {
  const workspace = makeTempRepo();
  const plans = path.join(workspace, "plans");
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, "resume-check.md"), [
    "# Resume Check",
    "",
    "## Success Criteria",
    "- [ ] C001 | channel: cli | test: node --test | scenario: resume prior run",
    "",
    "## Todos",
    "- [ ] 1. Keep the same run",
    "",
    "## Final verification gates",
    "- [ ] F1. Verify the resumed run",
    "",
  ].join("\n"));

  const result = runPluginPython(`
import json
import shlex
from pathlib import Path
import core

workspace = Path(${JSON.stringify(workspace)})
args = "resume-check --worktree " + shlex.quote(str(workspace))
first = core.command_start_work(args)
runs_dir = workspace / ".hermes" / "lithermes" / "runs"
before = sorted(p.name for p in runs_dir.iterdir())
second = core.command_start_work("resume-check --resume --worktree " + shlex.quote(str(workspace)))
after = sorted(p.name for p in runs_dir.iterdir())
print(json.dumps({
    "before": before,
    "after": after,
    "first_display": first["display"],
    "second_display": second["display"],
    "second_agent_message": second["agent_message"],
}, sort_keys=True))
`, { cwd: workspace });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.before.length, 1);
  assert.deepEqual(payload.after, payload.before, "--resume must reuse the previous run instead of creating a new one");
  assert.match(payload.second_display, /Resumed LitHermes work run/);
  assert.doesNotMatch(payload.second_display, /Started LitHermes work run/);
  assert.match(payload.second_agent_message, new RegExp(payload.before[0]));
});

test("install refuses to overwrite a non manifest-owned lithermes plugin", () => {
  const home = makeTempHome();
  const plugin = path.join(home, "plugins", "lithermes");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "name: user-owned\n");
  const result = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 5);
  assert.match(result.stderr + result.stdout, /not manifest-owned/);
});

test("uninstall removes manifest-owned plugin files and preserves unrelated files", () => {
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
  const unrelated = path.join(home, "plugins", "unrelated.txt");
  fs.writeFileSync(unrelated, "keep me");

  const result = run(["uninstall", "--yes", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, "plugins", "lithermes")), false);
  assert.equal(fs.readFileSync(unrelated, "utf8"), "keep me");
  assert.doesNotMatch(fs.readFileSync(path.join(home, "config.yaml"), "utf8"), /lithermes/);
});

test("doctor reports current patched Hermes capabilities when repo is provided", () => {
  const repo = process.env.LITHERMES_TEST_HERMES_REPO;
  if (!repo) return;
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
  const result = run(["doctor", "--offline", "--hermes-home", home, "--hermes-repo", repo]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /plugin discovery: PASS/);
  assert.match(result.stdout, /cli payload dispatch: PASS/);
  assert.match(result.stdout, /tui payload dispatch: PASS/);
  assert.match(result.stdout, /gateway underscore dispatch: PASS/);
});

test("requiredSkills tracks every bundled skill directory under the shared skills catalog", () => {
  const bundledSkillIds = fs
    .readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const payloadManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "payload-version.json"), "utf8"));
  assert.deepEqual([...requiredSkills].sort(), bundledSkillIds);
  assert.deepEqual(scanPluginSkills(pluginRoot, payloadManifest, true).sort(), bundledSkillIds);
});

test("doctor reports skill payload completeness for the full bundled skill catalog", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bundled skill payload: PASS/);
  assert.match(result.stdout, /installed skill payload: PASS/);
});

test("doctor fails when a required bundled skill entrypoint is missing", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  const packageRoot = makeTempPackage(t);
  fs.rmSync(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "comment-checker", "SKILL.md"));

  const result = runPackageBin(packageRoot, ["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: FAIL \(missing comment-checker\)/);
  assert.match(result.stdout, /installed skill payload: PASS/);
});

test("doctor fails when a required installed skill entrypoint is missing", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(run(["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  fs.rmSync(path.join(home, "plugins", "lithermes", "skills", "lit-burnoff-file", "SKILL.md"));

  const result = run(["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: PASS/);
  assert.match(result.stdout, /installed skill payload: FAIL \(missing lit-burnoff-file\)/);
});

test("packed doctor rejects a zero-byte bundled skill entrypoint", (t) => {
  const packageRoot = makePackedPackage(t);
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(runPackageBin(packageRoot, ["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  fs.writeFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "comment-checker", "SKILL.md"), "");

  const result = runPackageBin(packageRoot, ["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: FAIL \(empty comment-checker\)/);
  assert.match(result.stdout, /installed skill payload: PASS/);
});

test("packed doctor rejects a same-size mutation of a bundled skill entrypoint", (t) => {
  const packageRoot = makePackedPackage(t);
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(runPackageBin(packageRoot, ["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  mutateFileWithoutChangingSize(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "comment-checker", "SKILL.md"));

  const result = runPackageBin(packageRoot, ["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: FAIL \(hash mismatch comment-checker\)/);
  assert.match(result.stdout, /installed skill payload: PASS/);
});

test("packed doctor rejects a zero-byte installed skill entrypoint", (t) => {
  const packageRoot = makePackedPackage(t);
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(runPackageBin(packageRoot, ["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  fs.writeFileSync(path.join(home, "plugins", "lithermes", "skills", "lit-burnoff-file", "SKILL.md"), "");

  const result = runPackageBin(packageRoot, ["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: PASS/);
  assert.match(result.stdout, /installed skill payload: FAIL \(empty lit-burnoff-file\)/);
});

test("packed doctor rejects a same-size mutation of an installed skill entrypoint", (t) => {
  const packageRoot = makePackedPackage(t);
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  assert.equal(runPackageBin(packageRoot, ["install", "--yes", "--offline", "--no-hud", "--hermes-home", home]).status, 0);
  mutateFileWithoutChangingSize(path.join(home, "plugins", "lithermes", "skills", "lit-burnoff-file", "SKILL.md"));

  const result = runPackageBin(packageRoot, ["doctor", "--offline", "--hermes-home", home]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bundled skill payload: PASS/);
  assert.match(result.stdout, /installed skill payload: FAIL \(hash mismatch lit-burnoff-file\)/);
});

test("config helpers only treat plugins.enabled as LitHermes activation", () => {
  const existing = [
    "model:",
    "  enabled:",
    "    - lithermes",
    "plugins:",
    "  disabled: []",
    "",
  ].join("\n");
  assert.equal(configHasLitHermes(existing), false);

  const updated = enableLitHermesConfig([
    "agent:",
    "  features:",
    "    enabled:",
    "      - terminal",
    "plugins:",
    "  disabled: []",
    "",
  ].join("\n"));

  assert.match(updated, /plugins:\n  enabled:\n    - lithermes\n  disabled: \[\]/);
  assert.doesNotMatch(updated, /features:\n    enabled:\n      - lithermes/);
});

test("config helpers recognize Hermes indentless plugins.enabled sequences", () => {
  // Given: Hermes writes a valid indentless YAML sequence for a blank enabled key.
  const config = [
    "plugins:",
    "  enabled:",
    "  - lithermes",
    "agent:",
    "  max_turns: 90",
    "",
  ].join("\n");

  // When: LitHermes inspects the plugin enrollment.
  const enabled = configHasLitHermes(config);

  // Then: doctor treats the official Hermes representation as enabled.
  assert.equal(enabled, true);
});

test("doctor does not pass plugin discovery from bundled package assets alone", (t) => {
  const home = makeTempHome();
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  fs.writeFileSync(path.join(home, "config.yaml"), "plugins:\n  enabled:\n    - lithermes\n");
  const result = run(["doctor", "--offline", "--hermes-home", home]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /plugin discovery: PATCH_AVAILABLE/);
  assert.match(result.stdout, /installed skill payload: FAIL/);
  assert.match(result.stdout, /cli payload dispatch: SKIPPED/);
  assert.match(result.stdout, /gateway underscore dispatch: SKIPPED/);
  assert.doesNotMatch(result.stdout, /gateway underscore dispatch: PASS/);
});

test("doctor reports missing CLI structured payload dispatch from Hermes source", () => {
  const home = makeTempHome();
  const repo = makeTempRepo();
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "cli.py"), "print('old cli')\n");
  fs.mkdirSync(path.join(repo, "tui_gateway"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tui_gateway", "server.py"), "print('old tui')\n");
  fs.mkdirSync(path.join(repo, "gateway"), { recursive: true });
  fs.writeFileSync(path.join(repo, "gateway", "run.py"), "print('old gateway')\n");
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home, "--no-patch-installed-hermes"]).status, 0);

  const result = run(["doctor", "--offline", "--hermes-home", home, "--hermes-repo", repo]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cli payload dispatch: PATCH_AVAILABLE/);
  assert.match(result.stdout, /tui payload dispatch: PATCH_AVAILABLE/);
});

test("unsupported patch fallback refuses unknown Hermes preimages", () => {
  const home = makeTempHome();
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo, "gateway"), { recursive: true });
  fs.writeFileSync(path.join(repo, "gateway", "run.py"), "print('unsupported')\n");
  const result = run(["install", "--yes", "--patch-installed-hermes", "--offline", "--hermes-home", home, "--hermes-repo", repo]);
  assert.equal(result.status, 8);
  assert.match(result.stderr + result.stdout, /Unsupported Hermes preimage/);
});

test("Hermes 0.21 native inject_message dispatch needs no source patch", () => {
  const home = makeTempHome();
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo, "hermes_cli"), { recursive: true });
  fs.mkdirSync(path.join(repo, "gateway"), { recursive: true });
  fs.writeFileSync(path.join(repo, "cli.py"), [
    "    def _run_plugin_slash_command(self, command, raw_args):",
    "        result = resolve_plugin_command_result(plugin_handler(raw_args))",
    "        if result:",
    "            _cprint(str(result))",
       ].join("\n"));
  fs.writeFileSync(path.join(repo, "hermes_cli", "plugins.py"), [
    "class PluginContext:",
    "    def inject_message(self, content, *, role='user', session_key=None):",
    "        return self._gateway_injection_allowed(session_key)",
    "    def _gateway_injection_allowed(self, session_key):",
    "        return bool(session_key) and self.config.get('allow_gateway_injection')",
    "# plugins.entries.<plugin_id>.allow_gateway_injection",
    ].join("\n"));
  fs.writeFileSync(path.join(repo, "gateway", "run.py"), [
    "    command = command.replace(\"_\", \"-\")",
    "    result = plugin_handler(event.get_command_args().strip())",
    "    return True, str(result) if result else None, command",
    ].join("\n"));

  const result = patchInstalledHermes({ hermesHome: home, hermesRepo: repo });

  assert.equal(result.native, true);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.records, []);
  assert.equal(fs.existsSync(path.join(repo, "cli.py.lithermes.bak")), false);
  assert.equal(checkCliSource(repo).native, true);
  assert.equal(checkGatewaySource(repo).native, true);
});

test("patch fallback writes backups and rollback restores matching fixture files", () => {
  const home = makeTempHome();
  const repo = makeTempRepo();
  const cli = path.join(repo, "cli.py");
  const gateway = path.join(repo, "gateway", "run.py");
  const plugins = path.join(repo, "hermes_cli", "plugins.py");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(path.dirname(gateway), { recursive: true });
  fs.mkdirSync(path.dirname(plugins), { recursive: true });
  fs.writeFileSync(cli, [
    "import ast",
    "                        result = resolve_plugin_command_result(",
    "                            plugin_handler(user_args)",
    "                        )",
    "                        if result:",
    "                            _cprint(str(result))",
    "",
  ].join("\n"));
  fs.writeFileSync(gateway, "# lithermes-patch-target:gateway\ncommand = text\n");
  fs.writeFileSync(plugins, "# lithermes-patch-target:plugins\n");

  const install = run(["install", "--yes", "--patch-installed-hermes", "--offline", "--hermes-home", home, "--hermes-repo", repo]);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(fs.existsSync(`${cli}.lithermes.bak`), true);
  assert.equal(fs.existsSync(`${gateway}.lithermes.bak`), true);
  assert.equal(fs.existsSync(`${plugins}.lithermes.bak`), true);
  assert.match(fs.readFileSync(cli, "utf8"), /_pending_input\.put/);
  assert.match(fs.readFileSync(gateway, "utf8"), /command\.replace/);
  assert.match(fs.readFileSync(plugins, "utf8"), /auto_load/);

  const uninstall = run(["uninstall", "--yes", "--rollback-patches", "--hermes-home", home]);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.match(fs.readFileSync(cli, "utf8"), /if result:\n                            _cprint\(str\(result\)\)/);
  assert.equal(fs.readFileSync(gateway, "utf8"), "# lithermes-patch-target:gateway\ncommand = text\n");
  assert.equal(fs.readFileSync(plugins, "utf8"), "# lithermes-patch-target:plugins\n");
});

test("gateway offline check marks repo-dependent probes skipped when no Hermes repo is available", () => {
  const home = makeTempHome();
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
  const result = run(["check", "--gateway-offline", "--hermes-home", home]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gateway \/lit_loop SKIPPED/);
  assert.match(result.stdout, /gateway \/lit_plan SKIPPED/);
  assert.doesNotMatch(result.stdout, /gateway \/lit_loop PASS/);
  assert.doesNotMatch(result.stdout, /gateway \/lit_plan PASS/);
});

test("gateway offline check passes underscore dispatch paths when Hermes repo source is provided", () => {
  const home = makeTempHome();
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo, "gateway"), { recursive: true });
  fs.writeFileSync(path.join(repo, "gateway", "run.py"), [
    "command.replace(\"_\", \"-\")",
    "_plugin_agent_dispatch_payload = object()",
    "",
  ].join("\n"));
  assert.equal(run(["install", "--yes", "--offline", "--hermes-home", home]).status, 0);
  const result = run(["check", "--gateway-offline", "--hermes-home", home, "--hermes-repo", repo]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gateway \/lit_loop PASS/);
  assert.match(result.stdout, /gateway \/lit_plan PASS/);
});

const { installStatusLine } = require("../src/lib/install");

test("install status line distinguishes fresh / up-to-date / upgrade by version", () => {
  assert.match(installStatusLine(null, "0.8.2"), /^Installed LitHermes 0\.8\.2$/);
  assert.match(installStatusLine("0.8.2", "0.8.2"), /already up to date \(0\.8\.2\)/);
  assert.match(installStatusLine("0.6.0", "0.8.2"), /^Upgraded LitHermes 0\.6\.0 → 0\.8\.2$/);
});

test("re-install after a version change reports an upgrade, not 'up to date'", () => {
  const home = makeTempHome();
  const first = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Installed LitHermes/);
  assert.doesNotMatch(first.stdout, /already up to date/);
  // HUD hint must use the published package name, not `npx lithermes` (a
  // different/unpublished package).
  assert.match(first.stdout, /npx --package @litfamily\/lithermes -- lithermes hud/);
  assert.doesNotMatch(first.stdout, /npx lithermes hud/);
  // Simulate a stale older install by rewriting only the manifest version
  // (the on-disk files still match the real hashes, so the install proceeds).
  const mpath = path.join(home, "lithermes", "install-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(mpath, "utf8"));
  manifest.version = "0.0.1";
  fs.writeFileSync(mpath, JSON.stringify(manifest));
  const second = run(["install", "--yes", "--offline", "--hermes-home", home]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Upgraded LitHermes 0\.0\.1 → /);
  assert.doesNotMatch(second.stdout, /already up to date/);
});

test("CLI stops instead of continuing when automatic rollback leaves unknown state", async () => {
  const home = makeTempHome();
  const errors = [];
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.error = (message) => errors.push(String(message));
  process.exitCode = undefined;
  try {
    await main(["install", "--yes", "--hermes-home", home], {
      shouldAutoUpdate: () => true,
      runAutomaticUpdate: async () => ({
        status: "failed",
        reason: "automatic update rollback failed; installed profile state is unknown",
        state: "unknown",
        rollback: { status: "failed" },
      }),
    });
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /unknown state/i);
    assert.equal(fs.existsSync(path.join(home, "lithermes", "install-manifest.json")), false);
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});
