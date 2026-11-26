const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { COMMAND_SPECS, STYLE_MENU, helpText } = require("../src/cli");
const { COMMANDS, POINTER, QUESTIONS, agentGuide } = require("../src/lib/agentGuide");
const { PINS } = require("../src/lib/iconFont");
const { PROVIDER_IDS } = require("../src/lib/modelRoutePolicy");

const bin = path.join(__dirname, "..", "bin", "lithermes.js");
const docs = path.resolve(__dirname, "../../../docs");
const python = process.platform !== "win32" && spawnSync("python3", ["-c", "import pty"]).status === 0;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-agent-guide."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const run = (root, args, env = {}) => spawnSync(process.execPath, [bin, ...args], {
  cwd: root, encoding: "utf8", env: { PATH: path.join(root, "nothing"), HOME: root, LANG: "en_US.UTF-8", TERM: "xterm-256color", ...env },
});

test("install --agent and --agent print the same guide everywhere and write no file", (t) => {
  const root = sandbox(t);
  const expected = `${agentGuide()}\n`;
  for (const env of [{}, { NO_COLOR: "1" }, { CI: "1" }, { TERM: "dumb" }, { COLUMNS: "40" }, { LITHERMES_FORCE_SPINNER: "1" }]) {
    for (const args of [["install", "--agent"], ["--agent"], ["--agent", "install", "--yes", "--round"], ["install", "--agent", "--bogus", "now"],
      ["install", "--glyphs", "--agent"], ["install", "--agent", "--help"], ["--help", "--agent"], ["install", "--agent=true", "--json"]]) {
      const result = run(root, args, env);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.equal(result.stdout, expected, args.join(" "));
      assert.equal(result.stderr, "");
    }
  }
  assert.deepEqual(fs.readdirSync(root), []);
  assert.doesNotMatch(expected, /\x1b/);
  assert.equal(run(root, ["hud", "--agent"]).status, 2, "the guide belongs to install");
});

test("a terminal gets the same bytes", { skip: !python && "needs python3 pty" }, (t) => {
  const root = sandbox(t);
  const result = spawnSync("python3", [path.join(__dirname, "fixtures", "installer-pty.py"), process.execPath, bin, "install", "--agent"], {
    input: JSON.stringify({ rows: 24, cols: 60, steps: [] }), encoding: "utf8",
    env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`, HOME: root, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).output.replace(/\r\n/g, "\n"), `${agentGuide()}\n`);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name !== "Library"), [], "macOS keeps Python's own cache in Library");
});

test("the guide walks the steps in order", () => {
  const guide = agentGuide();
  const steps = [
    /^LitHermes install guide for coding agents\n\nIf you are a coding agent and your user asked you to install LitHermes, follow these steps\. They are written for your user to read too\.\n/,
    /install --dry-run[^]*Show your user what it would change\./, /keep every default/, /SymbolsNerdFontMono-Regular\.ttf/, /hermes --tui/,
    /Wait for your user's yes\. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user\./,
    /install --yes --round/, /Update later/, /doctor --offline[^]*ROUND_ENDS:[^]*If a step fails, show your user the lines and stop\./,
    /Show your user this and ask if both ends are round:  LIT /u, /--glyphs round/, /--glyphs auto/, /Only your user can/, /restart/i,
  ];
  let at = 0;
  for (const step of steps) {
    const found = guide.slice(at).search(step);
    assert.ok(found >= 0, `${step} after ${guide.slice(0, at).split("\n").length} lines`);
    at += found;
  }
  for (const word of [/\bstar\b/i, /do not ask/i, /sponsor/i, /finds the (?:symbols )?font by itself/i]) assert.doesNotMatch(guide, word);
  assert.match(guide, /Terminal\.app/);
});

test("help and a run without a person point at the guide", (t) => {
  assert.match(helpText(), /^Are you an agent\? .*install --agent/m);
  assert.match(run(sandbox(t), ["--help"]).stdout, /^Are you an agent\? /m);
  const root = sandbox(t);
  const dry = ["install", "--dry-run", "--offline", "--hermes-home", path.join(root, "h")];
  assert.equal(run(root, dry).stdout.split("\n")[1], POINTER);
  assert.equal(POINTER, "Agent? See npx --yes @litfamily/lithermes@latest install --agent.");
  assert.doesNotMatch(run(root, [...dry, "--json"]).stdout, /Agent\?/);
  assert.doesNotMatch(run(root, ["version"]).stdout, /Agent\?/);
});

test("guide, parser flags, style list, providers and both prompts stay one text", () => {
  const guide = agentGuide();
  const flags = new Set(Object.keys(COMMAND_SPECS.install.flags));
  const doctorFlags = new Set(Object.keys(COMMAND_SPECS.doctor.flags));
  const prompts = ["install.md", "install.ko.md"].map((name) => /```text\n([^]*?)```/.exec(fs.readFileSync(path.join(docs, name), "utf8"))[1]);
  for (const [i, text] of [guide, ...prompts].entries()) {
    for (const [, flag] of text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
      assert.ok(flags.has(flag) || doctorFlags.has(flag) || ["package", "version", "tui"].includes(flag), `text ${i}: --${flag} is no flag`);
    }
    for (const command of Object.values(COMMANDS)) assert.ok(text.includes(command), `text ${i} lacks: ${command}`);
    for (const word of [PINS.files[0].name, "~/Library/Fonts", "fonts", "ROUND_ENDS:", " LIT ", "full Nerd Font", PINS.family, "Non-ASCII Font", "fontFamily", "symbol_map", "Terminal.app", "--glyphs round", "--glyphs auto", "hermes --tui", "gateway"]) {
      assert.ok(text.includes(word), `text ${i} lacks: ${word}`);
    }
    for (const { flags: own, later } of QUESTIONS) {
      for (const flag of own) assert.ok(text.includes(`--${flag}`), `text ${i} lacks --${flag}`);
      if (later) assert.ok(text.includes(later), `text ${i} lacks ${later}`);
    }
  }
  for (const { title, flags: own, later } of QUESTIONS) {
    assert.ok(guide.includes(`- ${title}: `), title);
    assert.ok(own.length || later, `${title} has a flag or a later command`);
    for (const flag of own) assert.ok(flags.has(flag), flag);
  }
  for (const id of [...PROVIDER_IDS, ...STYLE_MENU.map((style) => style.id)]) assert.ok(guide.includes(id), id);
  for (const flag of ["agent", "round", "glyphs"]) assert.ok(flags.has(flag), flag);
});
