const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { maybeOfferBell } = require("../src/cli");
const { readBellOnCompleteConfig, setBellOnCompleteConfig } = require("../src/lib/config");

const bin = path.join(__dirname, "..", "bin", "lithermes.js");

function home(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-bell-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (config !== undefined) fs.writeFileSync(path.join(dir, "config.yaml"), config);
  return dir;
}

function install(dir, ...flags) {
  return spawnSync(process.execPath, [bin, "install", "--yes", "--offline", "--no-hud", "--no-style",
    "--no-auto-update", "--hermes-home", dir, ...flags], { encoding: "utf8", env: { ...process.env, NO_UPDATE_NOTIFIER: "1" } });
}

const config = (dir) => fs.readFileSync(path.join(dir, "config.yaml"), "utf8");

// Answers the prompt; `beforeAnswer` runs first so a test can edit config.yaml mid-prompt.
async function offer(dir, answer, beforeAnswer = () => {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let shown = "";
  stdout.on("data", (chunk) => { shown += chunk; });
  const logs = [];
  const originals = [console.log, console.error];
  console.log = console.error = (message) => logs.push(String(message));
  try {
    const pending = maybeOfferBell({ "hermes-home": dir }, { isInteractive: true, env: {}, streams: { stdin, stdout } }, { prompt: true });
    setImmediate(() => { beforeAnswer(); stdin.write(`${answer}\n`); });
    await pending;
  } finally {
    [console.log, console.error] = originals;
  }
  return { shown, logs: logs.join("\n") };
}

test("bell config reader tells absent, explicit and unreadable apart", () => {
  assert.equal(readBellOnCompleteConfig(""), null);
  assert.equal(readBellOnCompleteConfig("display:\n  skin: x\n"), null);
  assert.equal(readBellOnCompleteConfig("display:\n  bell_on_complete: false\n"), false);
  assert.equal(readBellOnCompleteConfig("display:\n  bell_on_complete: true\n"), true);
  assert.equal(readBellOnCompleteConfig("display: [unclosed\n"), undefined);
});

test("bell edit adds one key, keeps everything else, and refuses shapes it cannot edit cleanly", () => {
  assert.equal(setBellOnCompleteConfig(""), "display:\n  bell_on_complete: true\n");
  const before = "# mine\nmodel:\n  default: m\ndisplay:  # look\n  skin: lithermes-ignition\ncustom: keep\n";
  assert.equal(setBellOnCompleteConfig(before),
    "# mine\nmodel:\n  default: m\ndisplay:  # look\n  bell_on_complete: true\n  skin: lithermes-ignition\ncustom: keep\n");
  assert.equal(setBellOnCompleteConfig("display:\r\n  skin: x\r\n"), "display:\r\n  bell_on_complete: true\r\n  skin: x\r\n");
  assert.equal(setBellOnCompleteConfig("display:\n    skin: x\n"), null, "four-space display block");
  assert.equal(setBellOnCompleteConfig("display: {skin: x}\n"), null, "flow-map display");
  assert.equal(setBellOnCompleteConfig("display: [unclosed\n"), null, "malformed YAML");
});

test("install leaves the bell off unless --bell asks for it", (t) => {
  const quiet = home(t);
  assert.equal(install(quiet).status, 0);
  assert.equal(readBellOnCompleteConfig(config(quiet)), null);

  const loud = home(t);
  const result = install(loud, "--bell");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readBellOnCompleteConfig(config(loud)), true);
  assert.match(result.stdout, /Finish bell on/);
});

test("--bell keeps a value the user already chose and never edits an unreadable config", (t) => {
  const chosen = home(t, "display:\n  bell_on_complete: false\n");
  const kept = install(chosen, "--bell");
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(readBellOnCompleteConfig(config(chosen)), false);
  assert.match(kept.stdout, /kept your display\.bell_on_complete: false/);

  const odd = home(t, "display:\n    skin: x\nplugins:\n  enabled: [lithermes]\n");
  const refused = install(odd, "--bell");
  assert.equal(refused.status, 0, refused.stderr);
  assert.equal(readBellOnCompleteConfig(config(odd)), null);
  assert.match(refused.stderr, /set display\.bell_on_complete: true by hand/);
});

test("interactive install asks once, defaults to no, and writes only on yes", async (t) => {
  const declined = home(t, "display:\n  skin: x\n");
  const no = await offer(declined, "");
  assert.match(no.shown, /\[y\/N\]/);
  assert.equal(config(declined), "display:\n  skin: x\n");

  const accepted = home(t, "display:\n  skin: x\n");
  await offer(accepted, "y");
  assert.equal(readBellOnCompleteConfig(config(accepted)), true);

  const set = home(t, "display:\n  bell_on_complete: true\n");
  const silent = await offer(set, "y");
  assert.equal(silent.shown, "", "a chosen value is never asked about again");
});

test("a config edited while the question is open is left alone", async (t) => {
  const dir = home(t, "display:\n  skin: x\n");
  const { logs } = await offer(dir, "y", () => fs.appendFileSync(path.join(dir, "config.yaml"), "other: edit\n"));
  assert.equal(config(dir), "display:\n  skin: x\nother: edit\n");
  assert.match(logs, /changed while asking/);
});
