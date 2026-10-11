const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseDocument } = require("yaml");
const {
  clearDisplaySkinConfig,
  disableLitHermesConfig,
  enableLitHermesConfig,
  setDisplaySkinConfig,
  setTuiAgentsNudgeConfig,
} = require("../src/lib/config");

// Parse the edited text the way the installer's own check does: strict, unique keys.
function load(text) {
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  assert.deepEqual(document.errors.map((error) => error.message), [], text);
  return document.toJS();
}

test("enable keeps a Hermes indentless plugins.enabled list valid", () => {
  const before = "plugins:\n  enabled:\n  - disk-cleanup\nagent:\n  max_turns: 90\n";
  const after = enableLitHermesConfig(before);
  assert.deepEqual(load(after).plugins.enabled.sort(), ["disk-cleanup", "lithermes"]);
  assert.match(after, /\n {2}- lithermes\n/);
  assert.equal(disableLitHermesConfig(after), before);
});

test("enable fills an empty flow map or a commented plugins key in place", () => {
  for (const before of ["plugins: {}\n", "plugins:  # note\n  disabled: []\n", "model: x\nplugins: {}  # note\n"]) {
    const after = enableLitHermesConfig(before);
    assert.deepEqual(load(after).plugins.enabled, ["lithermes"], after);
    assert.equal((after.match(/^plugins:/gm) || []).length, 1, after);
  }
});

test("display editors keep user keys under a commented or empty display key", () => {
  const commented = "display:  # c\n  compact: true\n";
  assert.deepEqual(load(setDisplaySkinConfig(commented, "lithermes-rose")).display, { compact: true, skin: "lithermes-rose" });
  assert.deepEqual(load(setTuiAgentsNudgeConfig(commented)).display, { compact: true, tui_agents_nudge: true });
  assert.deepEqual(load(setDisplaySkinConfig("display: {}\n", "lithermes-rose")).display, { skin: "lithermes-rose" });
  assert.deepEqual(load(setTuiAgentsNudgeConfig("display: {}\n")).display, { tui_agents_nudge: true });
});

test("enable and disable are byte-idempotent with no blank-line growth", () => {
  const base = "model: x\nplugins:\n  enabled:\n    - disk-cleanup\n";
  const enabled = enableLitHermesConfig(base);
  assert.doesNotMatch(enabled, /\n\n$/);
  assert.equal(enableLitHermesConfig(enabled), enabled);
  assert.equal(disableLitHermesConfig(enabled), base);
  assert.equal(disableLitHermesConfig(disableLitHermesConfig(enabled)), base);
  assert.equal(enableLitHermesConfig(disableLitHermesConfig(enabled)), enabled);
  const fresh = enableLitHermesConfig("plugins:\n  disabled: []\n");
  assert.equal(fresh, "plugins:\n  enabled:\n    - lithermes\n  disabled: []\n");
  const off = disableLitHermesConfig(fresh);
  assert.equal(disableLitHermesConfig(off), off);
  assert.equal(enableLitHermesConfig(off), fresh);
});

test("disable removes lithermes only from plugins.enabled, never from disabled", () => {
  const before = "plugins:\n  disabled:\n  - lithermes\n";
  const enabled = enableLitHermesConfig(before);
  assert.deepEqual(load(enabled).plugins, { enabled: ["lithermes"], disabled: ["lithermes"] });
  assert.deepEqual(load(disableLitHermesConfig(enabled)).plugins.disabled, ["lithermes"]);
  const indentless = "plugins:\n  enabled:\n  - lithermes\n  - a\n  disabled:\n  - lithermes\n";
  assert.equal(disableLitHermesConfig(indentless), "plugins:\n  enabled:\n  - a\n  disabled:\n  - lithermes\n");
});

test("enable and disable keep CRLF line endings", () => {
  const before = "model: x\r\nplugins:\r\n  enabled:\r\n  - a\r\n";
  const enabled = enableLitHermesConfig(before);
  assert.equal(enabled, "model: x\r\nplugins:\r\n  enabled:\r\n  - lithermes\r\n  - a\r\n");
  assert.equal(disableLitHermesConfig(enabled), before);
  assert.equal(enableLitHermesConfig("model: x\r\n"), "model: x\r\nplugins:\r\n  enabled:\r\n    - lithermes\r\n");
});

test("display editors keep CRLF line endings", () => {
  const block = "model: x\r\ndisplay:\r\n  compact: true\r\n";
  assert.equal(setTuiAgentsNudgeConfig(block), "model: x\r\ndisplay:\r\n  tui_agents_nudge: true\r\n  compact: true\r\n");
  assert.equal(setTuiAgentsNudgeConfig("model: x\r\n"), "model: x\r\ndisplay:\r\n  tui_agents_nudge: true\r\n");
  const skinned = setDisplaySkinConfig(block, "lithermes-rose");
  assert.equal(skinned, "model: x\r\ndisplay:\r\n  skin: lithermes-rose\r\n  compact: true\r\n");
  assert.equal(setDisplaySkinConfig(skinned, "lithermes-teal"), skinned.replace("rose", "teal"));
  assert.equal(setDisplaySkinConfig("model: x\r\n", "lithermes-rose"), "model: x\r\ndisplay:\r\n  skin: lithermes-rose\r\n");
  assert.equal(clearDisplaySkinConfig(skinned), block);
});
