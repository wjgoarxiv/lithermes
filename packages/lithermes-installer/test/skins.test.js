const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  HUD_ACCENTS,
  skinName,
  renderSkinYaml,
  findAccent,
  installSkins,
  skinsDir,
} = require("../src/lib/skins");
const {
  setDisplaySkinConfig,
  clearDisplaySkinConfig,
  readDisplaySkinConfig,
} = require("../src/lib/config");

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-hud-"));
}

test("HUD accents match the canonical palette (name + ANSI-256 code + order)", () => {
  // Frozen palette contract: name + ANSI-256 code + order are load-bearing.
  const expected = [
    ["cyan", 81], ["blue", 39], ["teal", 49], ["green", 118], ["lavender", 177],
    ["rose", 198], ["gold", 220], ["orange", 208], ["slate", 75], ["gray", 231],
  ];
  assert.deepEqual(HUD_ACCENTS.map((a) => [a.accent, a.code]), expected);
});

test("HUD exposes 10 distinct accents with valid hex", () => {
  assert.equal(HUD_ACCENTS.length, 10);
  const names = new Set();
  const hexes = new Set();
  for (const a of HUD_ACCENTS) {
    assert.match(a.accent, /^[a-z]+$/, `accent name: ${a.accent}`);
    assert.match(a.hex, /^#[0-9A-Fa-f]{6}$/, `hex: ${a.hex}`);
    assert.equal(typeof a.label, "string");
    names.add(a.accent);
    hexes.add(a.hex.toLowerCase());
  }
  assert.equal(names.size, 10, "accent names must be unique");
  assert.equal(hexes.size, 10, "hex values must be unique");
});

test("skinName namespaces under lithermes-", () => {
  assert.equal(skinName("rose"), "lithermes-rose");
});

test("renderSkinYaml produces a valid-looking Hermes skin", () => {
  const entry = HUD_ACCENTS[0];
  const yaml = renderSkinYaml(entry);
  assert.match(yaml, new RegExp(`^name: lithermes-${entry.accent}`, "m"));
  assert.match(yaml, /^description: /m);
  assert.match(yaml, /^colors:/m);
  // The accent hex must drive at least the primary accent keys.
  assert.ok(yaml.includes(entry.hex), "accent hex present");
  assert.match(yaml, /banner_accent:/);
  assert.match(yaml, /ui_accent:/);
});

test("findAccent resolves by name and 1-based number, rejects unknown", () => {
  assert.equal(findAccent("rose")?.accent, "rose");
  assert.equal(findAccent("ROSE")?.accent, "rose");
  assert.equal(findAccent("1")?.accent, HUD_ACCENTS[0].accent);
  assert.equal(findAccent("lithermes-rose")?.accent, "rose");
  assert.equal(findAccent("nope"), null);
  assert.equal(findAccent("99"), null);
});

test("installSkins writes numeric accents and named skins to <home>/skins", () => {
  const home = tmpHome();
  const written = installSkins(home);
  assert.equal(written.length, 13);
  const dir = skinsDir(home);
  for (const a of HUD_ACCENTS) {
    const f = path.join(dir, `lithermes-${a.accent}.yaml`);
    assert.ok(fs.existsSync(f), `missing ${f}`);
    assert.match(fs.readFileSync(f, "utf8"), new RegExp(`name: lithermes-${a.accent}`));
  }
  for (const name of ["lithermes-ignition", "lithermes-tokyonight-day", "lithermes-tokyonight"]) {
    assert.ok(fs.existsSync(path.join(dir, `${name}.yaml`)), `missing ${name}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test("setDisplaySkinConfig sets nested display.skin on empty config", () => {
  const out = setDisplaySkinConfig("", "lithermes-rose");
  assert.match(out, /^display:\s*$/m);
  assert.match(out, /^\s{2}skin: lithermes-rose\s*$/m);
  assert.equal(readDisplaySkinConfig(out), "lithermes-rose");
});

test("setDisplaySkinConfig replaces an existing skin and preserves other keys", () => {
  const base = "plugins:\n  enabled:\n    - lithermes\ndisplay:\n  skin: lithermes-amber\n  runtime_footer:\n    enabled: true\n";
  const out = setDisplaySkinConfig(base, "lithermes-teal");
  assert.equal(readDisplaySkinConfig(out), "lithermes-teal");
  assert.match(out, /enabled:\s*\n\s*- lithermes/, "plugins block preserved");
  assert.match(out, /runtime_footer:/, "sibling display key preserved");
  assert.doesNotMatch(out, /lithermes-amber/);
});

test("clearDisplaySkinConfig removes the skin line only", () => {
  const base = "display:\n  skin: lithermes-rose\n  runtime_footer:\n    enabled: true\n";
  const out = clearDisplaySkinConfig(base);
  assert.equal(readDisplaySkinConfig(out), null);
  assert.match(out, /runtime_footer:/);
});
