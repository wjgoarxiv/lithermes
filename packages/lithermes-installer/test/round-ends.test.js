const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { settingsPath, widgetSource } = require("../src/lib/tuiCard");
const { roundEndsLine } = require("../src/lib/roundEnds");

const bin = path.join(__dirname, "..", "bin", "lithermes.js");

function home(t, { glyphs, enabled = true, fonts = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-round-ends."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hermes = path.join(root, "hermes");
  fs.mkdirSync(path.join(hermes, "plugins", "lithermes"), { recursive: true });
  fs.mkdirSync(path.join(hermes, "lithermes"));
  fs.writeFileSync(path.join(hermes, "config.yaml"), enabled ? "plugins:\n  enabled:\n    - lithermes\n" : "{}\n");
  fs.writeFileSync(settingsPath(hermes), JSON.stringify({ mode: "on", ...(glyphs ? { glyphs } : {}) }));
  for (const dir of [path.join(root, "Library", "Fonts"), path.join(root, "data", "fonts")]) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fonts) fs.writeFileSync(path.join(dir, name), "");
  }
  return { hermes, env: { HOME: root, XDG_DATA_HOME: path.join(root, "data"), LANG: "en_US.UTF-8" } };
}
const RICH = { TERM: "xterm-256color", COLORTERM: "truecolor" };
const line = (box, { env = {}, tty = false, ...rest } = {}) => roundEndsLine({
  home: box.hermes, env: { ...box.env, ...env }, stream: { isTTY: tty }, hasIconFont: () => false, ...rest,
});

test("shown: the saved choice is round, also over SSH", async (t) => {
  const box = home(t, { glyphs: "round" });
  assert.equal(await line(box), "ROUND_ENDS: shown");
  assert.equal(await line(box, { env: { SSH_CONNECTION: "a 1 b 2" } }), "ROUND_ENDS: shown");
  assert.equal(await line(box, { tty: true, env: RICH }), "ROUND_ENDS: shown");
});

test("ready: auto, and the terminal says it draws the ends itself", async (t) => {
  const box = home(t);
  for (const env of [{ TERM_PROGRAM: "ghostty" }, { TERM_PROGRAM: "vscode" }, { WT_SESSION: "x" }, { TERM: "xterm-kitty" }]) {
    assert.equal(await line(box, { env }), "ROUND_ENDS: ready in a dark full-colour terminal");
  }
  assert.equal(await line(box, { tty: true, env: { ...RICH, TERM_PROGRAM: "WezTerm" } }), "ROUND_ENDS: ready");
});

test("check: an installed icon font alone is no proof", async (t) => {
  const box = home(t);
  const said = await line(box, { hasIconFont: () => true });
  assert.match(said, /^ROUND_ENDS: check \(an icon font is here.*; show your user " LIT ".*--glyphs round.*--glyphs square.*\)$/u);
  assert.doesNotMatch(said, /\n/);
});

test("square: one reason and one fix", async (t) => {
  const box = home(t);
  const square = async (options, reason) => assert.match(await line(options.box || box, options), new RegExp(`^ROUND_ENDS: square \\(${reason.source}; [^;]+\\)$`));
  await square({ box: home(t, { enabled: false }) }, /no surface enabled/);
  await square({ box: home(t, { glyphs: "square" }), hasIconFont: () => true }, /the choice is square/);
  await square({ env: { LITHERMES_HUD_GLYPHS: "basic" } }, /LITHERMES_HUD_GLYPHS is basic/);
  await square({ env: { SSH_CONNECTION: "a 1 b 2" }, hasIconFont: () => true }, /SSH[^;]*/);
  await square({}, /no icon font/);
  assert.match(await line(box), /--round/);
  await square({ fontWhy: "no network" }, /font not installed: no network/);
  await square({ platform: "win32" }, /Windows console/);
});

test("colour and ground count only when stdout is a terminal", async (t) => {
  const box = home(t, { glyphs: "round" });
  for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }, { COLORTERM: "" }, { COLORFGBG: "0;15" }]) {
    assert.equal(await line(box, { env: { ...RICH, ...env } }), "ROUND_ENDS: shown", JSON.stringify(env));
    assert.match(await line(box, { tty: true, env: { ...RICH, ...env } }), /^ROUND_ENDS: square \([^;]+; [^;]+\)$/, JSON.stringify(env));
  }
});

test("the environment setting comes before the saved choice, and nerd and basic are words for it", async (t) => {
  const box = home(t, { glyphs: "square" });
  for (const word of ["round", "nerd", " Round "]) {
    for (const env of [{}, { SSH_CONNECTION: "a 1 b 2" }, { TERM_PROGRAM: "ghostty" }]) {
      for (const at of [box, home(t)]) {
        const said = await line(at, { env: { ...env, LITHERMES_HUD_GLYPHS: word } });
        assert.match(said, /^ROUND_ENDS: check \(LITHERMES_HUD_GLYPHS is (?:round|nerd)[^;]*; show your user "\ue0b6 LIT \ue0b4".*--glyphs round.*--glyphs square.*\)$/u, word);
      }
    }
  }
  assert.equal(await line(home(t, { glyphs: "round" }), { env: { LITHERMES_HUD_GLYPHS: "nerd" } }), "ROUND_ENDS: shown", "the saved round is the user's word");
  assert.match(await line(box, { env: { LITHERMES_HUD_GLYPHS: "auto" }, hasIconFont: () => true }), /^ROUND_ENDS: check/);
  assert.match(await line(box, { env: { LITHERMES_HUD_GLYPHS: "oval" } }), /the choice is square/, "an unknown word is no setting");
});

// --- through the installer ---------------------------------------------------------------------

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-round-cli."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin", "hermes"), "#!/bin/sh\necho 'Hermes Agent v0.19.0'\n", { mode: 0o700 });
  return root;
}
function run(root, args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args, "--hermes-home", path.join(root, ".hermes")], {
    cwd: root, encoding: "utf8",
    env: {
      PATH: `${path.join(root, "bin")}${path.delimiter}/usr/bin${path.delimiter}/bin`, HOME: root, XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, ".cache"), LANG: "en_US.UTF-8", NO_UPDATE_NOTIFIER: "1", LITHERMES_NO_AUTO_UPDATE: "1",
      LITHERMES_ICON_FONT_SOURCE: path.join(root, "no-archive.zip"), ...env,
    },
  });
}
const INSTALL = ["install", "--yes", "--offline", "--no-patch-installed-hermes"];
const last = (result) => result.stdout.trim().split("\n").at(-1);
const saved = (root) => JSON.parse(fs.readFileSync(settingsPath(path.join(root, ".hermes")), "utf8")).glyphs;

test("install and doctor end with the line, and --glyphs saves what hud caps saves", (t) => {
  const root = sandbox(t);
  const first = run(root, [...INSTALL, "--glyphs", "round"]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(last(first), "ROUND_ENDS: shown");
  assert.equal(saved(root), "round");
  assert.match(run(root, ["hud", "caps"]).stdout, /Round caps: round/);
  assert.equal(last(run(root, INSTALL)), "ROUND_ENDS: shown", "a plain install keeps the choice");
  assert.equal(last(run(root, ["doctor", "--offline"])), "ROUND_ENDS: shown");
  assert.match(last(run(root, [...INSTALL, "--glyphs", "square"])), /the choice is square/);
  run(root, [...INSTALL, "--glyphs", "auto"]);
  assert.equal(saved(root), undefined);
});

test("--glyphs takes three words and refuses another before anything is written", (t) => {
  const root = sandbox(t);
  const bad = run(root, [...INSTALL, "--glyphs", "oval"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--glyphs.*auto, round or square/);
  assert.equal(fs.existsSync(path.join(root, ".hermes")), false);
});

// A machine-wide icon font would answer before the test's own folders do.
async function systemIconFont() {
  const { hasIconFont } = await import(pathToFileURL(widgetSource).href);
  return hasIconFont({ HOME: "/nonexistent", XDG_DATA_HOME: "/nonexistent" });
}

test("--round that cannot add the font still installs and says why", async (t) => {
  if (await systemIconFont()) return t.skip("this machine has a system-wide icon font");
  const root = sandbox(t);
  const result = run(root, [...INSTALL, "--round"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /icon font: not added \(.*ENOENT/);
  assert.match(last(result), /^ROUND_ENDS: square \(font not installed: .*; .*\)$/);
  assert.ok(fs.existsSync(path.join(root, ".hermes", "plugins", "lithermes", "plugin.yaml")));
});

test("a dry run names the choice, the file and the folder, and writes nothing", async (t) => {
  if (await systemIconFont()) return t.skip("this machine has a system-wide icon font");
  const root = sandbox(t);
  const result = run(root, ["install", "--dry-run", "--round", "--glyphs", "round"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /round ends: would save round/);
  assert.match(result.stdout, /icon font: would add SymbolsNerdFontMono-Regular\.ttf and its licence to \S+/);
  assert.equal(fs.existsSync(path.join(root, ".hermes")), false);
  assert.equal(fs.existsSync(path.join(root, "data")), false);
});

test("the receipt says to restart the CLI and the gateway", (t) => {
  assert.match(run(sandbox(t), INSTALL).stdout, /^Restart any running Hermes gateway and every open Hermes CLI/m);
});
