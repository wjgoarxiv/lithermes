const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");
const sandboxes = [];

after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { force: true, recursive: true });
});

// Every run is confined to one scratch tree: HOME, HERMES_HOME, the XDG cache, the cwd, a fake
// `hermes` on PATH, an explicit --hermes-repo, and an npm stand-in that only leaves a marker.
// Even a parser that ignored every flag could not reach a real profile or the network.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-strict-args-"));
  sandboxes.push(dir);
  const layout = {
    dir,
    home: path.join(dir, "home"),
    hermesHome: path.join(dir, "hermes-home"),
    repo: path.join(dir, "hermes-repo"),
    work: path.join(dir, "work"),
    tools: path.join(dir, "tools"),
  };
  for (const key of ["home", "hermesHome", "repo", "work", "tools"]) fs.mkdirSync(layout[key], { recursive: true });
  fs.writeFileSync(path.join(layout.tools, "hermes"), "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo 'Hermes Agent v0.17.0' && exit 0\nexit 1\n", { mode: 0o700 });
  fs.writeFileSync(path.join(layout.tools, "npm-stub"), `#!/bin/sh\ntouch "${path.join(dir, "npm-was-called")}"\nexit 1\n`, { mode: 0o700 });
  return layout;
}

function run(box, args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: box.work,
    encoding: "utf8",
    env: {
      PATH: `${box.tools}${path.delimiter}${process.env.PATH || ""}`,
      HOME: box.home,
      USERPROFILE: box.home,
      HERMES_HOME: box.hermesHome,
      XDG_CACHE_HOME: path.join(box.home, ".cache"),
      XDG_CONFIG_HOME: path.join(box.home, ".config"),
      TMPDIR: os.tmpdir(),
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      LITHERMES_NO_AUTO_UPDATE: "1",
      LITHERMES_MOTION_NPM: path.join(box.tools, "npm-stub"),
      LITHERMES_MOTION_FONT_MIRROR: path.join(box.dir, "no-font-mirror"),
    },
    timeout: 120000,
  });
}

// File and directory fingerprint of the whole scratch tree, so any write, delete or mkdir shows.
function snapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) { out[rel] = "dir"; walk(full); }
      else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

const SAFE = (box) => ["--hermes-home", box.hermesHome, "--hermes-repo", box.repo];
const INSTALL = (box) => ["install", "--yes", "--offline", "--no-hud", "--no-style", "--no-patch-installed-hermes", "--no-auto-update", ...SAFE(box)];

function installed() {
  const box = sandbox();
  const result = run(box, INSTALL(box));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(path.join(box.hermesHome, "plugins", "lithermes")), "fixture install must land in the scratch home");
  return box;
}

function assertUnchanged(box, args, { refused }) {
  const beforeTree = snapshot(box.dir);
  const result = run(box, args);
  const label = `lithermes ${args.join(" ")}`;
  assert.deepEqual(snapshot(box.dir), beforeTree, `${label} must not change any file`);
  if (refused) {
    assert.notEqual(result.status, 0, `${label} must exit non-zero`);
    assert.match(result.stderr, /unknown option|unexpected argument|needs a value|expects true or false|unknown command/i, `${label} must say what it refused: ${result.stderr}`);
    assert.match(result.stderr, /lithermes help/, `${label} must point at the help`);
  } else {
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.match(result.stdout, /DRY RUN/, `${label} must say it is a dry run`);
  }
  return result;
}

test("install refuses an unknown option, a short option or a stray word before writing anything", () => {
  for (const extra of [["-n"], ["--bogus"], ["--dry-run=maybe"], ["now"]]) {
    const box = sandbox();
    assertUnchanged(box, [...INSTALL(box), ...extra], { refused: true });
  }
});

test("install --dry-run=true previews and --dry-run=false installs", () => {
  const box = sandbox();
  assertUnchanged(box, [...INSTALL(box), "--dry-run=true"], { refused: false });
  const real = run(box, [...INSTALL(box), "--dry-run=false"]);
  assert.equal(real.status, 0, real.stderr);
  assert.ok(fs.existsSync(path.join(box.hermesHome, "plugins", "lithermes")), "--dry-run=false is a normal install");
});

test("uninstall refuses unknown options and has a real dry run in every spelling", () => {
  const box = installed();
  for (const extra of [["-n"], ["--bogus"], ["--dry-run=yes"], ["everything"]]) {
    assertUnchanged(box, ["uninstall", "--yes", ...SAFE(box), ...extra], { refused: true });
  }
  for (const args of [
    ["uninstall", "--yes", "--dry-run", ...SAFE(box)],
    ["--dry-run", "uninstall", "--yes", ...SAFE(box)],
    ["uninstall", "--yes", "--dry-run=true", ...SAFE(box)],
    ["uninstall", "--dry-run", ...SAFE(box)],
    ["uninstall", "--yes", "--rollback-patches", "--dry-run", ...SAFE(box)],
  ]) {
    const result = assertUnchanged(box, args, { refused: false });
    assert.match(result.stdout, /would remove \d+ plugin files?/, "the plan names what would be removed");
  }
  const real = run(box, ["uninstall", "--yes", "--dry-run=false", ...SAFE(box)]);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(fs.existsSync(path.join(box.hermesHome, "plugins", "lithermes")), false, "--dry-run=false is a normal uninstall");
});

test("hud set and hud off refuse unknown options and preview with --dry-run", () => {
  const box = sandbox();
  for (const args of [
    ["hud", "cyan", "-n"],
    ["hud", "cyan", "--bogus"],
    ["hud", "cyan", "extra"],
    ["hud", "off", "--bogus"],
    ["hud", "off", "-n"],
  ]) assertUnchanged(box, [...args, "--hermes-home", box.hermesHome], { refused: true });
  for (const args of [["hud", "cyan", "--dry-run"], ["--dry-run", "hud", "cyan"], ["hud", "cyan", "--dry-run=true"]]) {
    const result = assertUnchanged(box, [...args, "--hermes-home", box.hermesHome], { refused: false });
    assert.match(result.stdout, /would set display\.skin/);
  }
  const set = run(box, ["hud", "cyan", "--dry-run=false", "--hermes-home", box.hermesHome]);
  assert.equal(set.status, 0, set.stderr);
  assert.match(fs.readFileSync(path.join(box.hermesHome, "config.yaml"), "utf8"), /skin: lithermes-/);
  const result = assertUnchanged(box, ["hud", "off", "--dry-run", "--hermes-home", box.hermesHome], { refused: false });
  assert.match(result.stdout, /would remove display\.skin/);
});

test("motion-runtime install refuses unknown options and --dry-run downloads nothing", () => {
  const box = sandbox();
  for (const extra of [["--bogus"], ["-n"], ["--dry-run=1"], ["now"]]) {
    assertUnchanged(box, ["motion-runtime", "install", "--hermes-home", box.hermesHome, ...extra], { refused: true });
  }
  for (const args of [
    ["motion-runtime", "install", "--dry-run"],
    ["--dry-run", "motion-runtime", "install"],
    ["motion-runtime", "install", "--dry-run=true", "--audio"],
  ]) {
    const result = assertUnchanged(box, [...args, "--hermes-home", box.hermesHome], { refused: false });
    assert.match(result.stdout, /cache: /);
  }
  assert.equal(fs.existsSync(path.join(box.dir, "npm-was-called")), false, "a dry run never reaches npm");
});

test("read-only commands also refuse options they do not document, and an unknown command is an error", () => {
  const box = sandbox();
  for (const args of [
    ["check", "--offline", "--bogus"],
    ["doctor", "--offline", "-n"],
    ["check", "--offline", "next"],
    ["version", "--bogus"],
    ["instal", "--yes"],
  ]) assertUnchanged(box, [...args, "--hermes-home", box.hermesHome], { refused: true });
});

test("help lists the options of every command, and each one is accepted", () => {
  const result = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const { COMMAND_SPECS } = require("../src/cli");
  for (const [command, spec] of Object.entries(COMMAND_SPECS)) {
    if (spec.hidden) continue;
    const line = result.stdout.split("\n").findIndex((row) => row.startsWith(`  ${command} `) || row === `  ${command}`);
    assert.ok(line >= 0, `help must list ${command}`);
    const block = result.stdout.split("\n").slice(line).join("\n").split(/\n {2}(?=[a-z])/)[0];
    for (const flag of Object.keys(spec.flags)) assert.ok(block.includes(`--${flag}`), `help for ${command} must list --${flag}`);
  }
  for (const [command, flag] of [["uninstall", "--dry-run"], ["hud", "--dry-run"], ["motion-runtime", "--dry-run"], ["install", "--offline"], ["install", "--no-style"]]) {
    assert.ok(Object.hasOwn(COMMAND_SPECS[command].flags, flag.slice(2)), `${command} must accept ${flag}`);
  }
  for (const word of ["--help", "-h"]) {
    const asked = spawnSync(process.execPath, [bin, "install", "--yes", word], { encoding: "utf8", env: { ...process.env, CI: "1" } });
    assert.equal(asked.status, 0);
    assert.match(asked.stdout, /lithermes commands:/, `${word} anywhere prints help and runs nothing`);
  }
});
