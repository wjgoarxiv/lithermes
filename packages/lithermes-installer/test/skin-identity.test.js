const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const yaml = require("yaml");
const skins = require("../src/lib/skins");
const { micro } = require("../src/lib/litMark");

const { HUD_ACCENTS, IGNITION, NAMED_THEMES, SHIPPED_SPINNERS, renderSkinYaml, installSkins, skinName } = skins;
const ALL = [...HUD_ACCENTS, IGNITION, ...NAMED_THEMES];
const pluginYaml = yaml.parse(
  fs.readFileSync(path.join(__dirname, "..", "assets", "lithermes-plugin", "plugin.yaml"), "utf8"),
);
const strip = (value) => value.replace(/\[[^\]]*\]/g, "");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const IDENTITY_KEYS = ["tool_prefix", "tool_emojis", "banner_hero"];

function legacy(entry, options = {}) {
  return renderSkinYaml(entry, { ...options, identity: false });
}

test("every shipped skin carries the LIT identity keys Hermes reads", () => {
  for (const entry of ALL) {
    const skin = yaml.parse(renderSkinYaml(entry));
    assert.equal(skin.tool_prefix, "▌", entry.accent);
    assert.deepEqual(Object.keys(skin.tool_emojis).sort(), [...pluginYaml.provides_tools].sort(), entry.accent);
    for (const glyph of Object.values(skin.tool_emojis)) assert.ok(glyph && glyph.length <= 4, `${entry.accent}: ${glyph}`);
    assert.match(skin.branding.help_header, /^\(🔥 lit\) /, entry.accent);
    assert.ok(skin.branding.help_header.length <= 60);
  }
});

test("banner_hero teaches lit in one look: the MICRO mark, the five steps and the one word to type", () => {
  for (const entry of ALL) {
    const hero = yaml.parse(renderSkinYaml(entry)).banner_hero.replace(/\n$/, "");
    const rows = strip(hero).split("\n");
    assert.deepEqual(rows.slice(0, micro.length).map((row) => row.trimEnd()), micro.map((row) => `  ${row}`.trimEnd()));
    const text = rows.join("\n");
    for (const step of ["plan", "run", "review", "gate", "handoff"]) assert.match(text, new RegExp(`◆ ${step}\\b`), entry.accent);
    assert.match(text, /type lit <your task>/);
    assert.ok(Math.max(...rows.map((row) => [...row].length)) <= 30, `${entry.accent}: hero wider than the caduceus column`);
    assert.ok(rows.length <= 16, `${entry.accent}: hero taller than the caduceus`);
    assert.doesNotMatch(hero, /\x1b/);
    if (entry.palette) {
      for (const lit of ["#FF6337", "#D7F75B", "#F2EFDF"]) assert.doesNotMatch(hero, new RegExp(`\\[${lit}\\]`), entry.accent);
      assert.match(hero, new RegExp(`\\[${entry.palette.primary}\\]`));
    } else {
      assert.match(hero, /\[#FF6337\]◆/);
      assert.match(hero, /\[#D7F75B\]◆/);
      assert.match(hero, new RegExp(`\\[${entry.hex}\\]`));
    }
  }
});

test("banner_hero has one colour span per row, so the Ink TUI keeps each row on one line", () => {
  // ui-tui banner.ts parseRichMarkup emits every span and every unmarked run as its own line.
  for (const entry of ALL) {
    const hero = yaml.parse(renderSkinYaml(entry)).banner_hero.replace(/\n$/, "");
    for (const row of hero.split("\n")) {
      if (row.trim()) assert.match(row, /^\[#[0-9A-Fa-f]{6}\][^[]*\[\/\]$/, `${entry.accent}: ${row}`);
    }
  }
});

test("the identity keys and the one-span logo are the only changes from the 1.0.38 file", () => {
  for (const entry of ALL) {
    const full = yaml.parse(renderSkinYaml(entry));
    const old = yaml.parse(legacy(entry));
    for (const key of IDENTITY_KEYS) delete full[key];
    delete full.branding.help_header;
    assert.equal(strip(full.banner_logo), strip(old.banner_logo), `${entry.accent}: same mark, new spans`);
    delete full.banner_logo;
    delete old.banner_logo;
    assert.deepEqual(full, old, entry.accent);
    assert.ok(skins.SHIPPED_SKIN_SHA256[entry.accent].includes(sha(legacy(entry))), `${entry.accent}: 1.0.38 render not pinned`);
    assert.equal(skins.addIdentityKeys(legacy(entry), entry), renderSkinYaml(entry), entry.accent);
  }
});

test("every pinned digest belongs to one shipped skin, three releases each", () => {
  assert.deepEqual(Object.keys(skins.SHIPPED_SKIN_SHA256).sort(), ALL.map((entry) => entry.accent).sort());
  for (const [accent, digests] of Object.entries(skins.SHIPPED_SKIN_SHA256)) {
    assert.equal(new Set(digests).size, digests.length, accent);
    for (const digest of digests) assert.match(digest, /^[0-9a-f]{64}$/);
  }
});

function skinHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skin-identity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "skins"));
  return home;
}

test("install merges the identity keys into a skin byte-identical to a shipped release, and nothing else", (t) => {
  const home = skinHome(t);
  const file = (entry) => path.join(home, "skins", `${skinName(entry.accent)}.yaml`);
  const [cyan, blue, teal, green] = HUD_ACCENTS;
  fs.writeFileSync(file(cyan), legacy(cyan), { mode: 0o644 });
  const edited = legacy(blue).replace("goodbye: stay lit", "goodbye: bye");
  fs.writeFileSync(file(blue), edited);
  const appended = `${legacy(teal)}# mine\n`;
  fs.writeFileSync(file(teal), appended);
  const [previous] = SHIPPED_SPINNERS;
  fs.writeFileSync(file(green), legacy(green, { spinner: previous }));
  fs.writeFileSync(file(IGNITION), renderSkinYaml(IGNITION));

  const written = installSkins(home);
  assert.equal(fs.readFileSync(file(cyan), "utf8"), renderSkinYaml(cyan));
  assert.equal(fs.statSync(file(cyan)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file(blue), "utf8"), edited, "an edited skin is never touched");
  assert.equal(fs.readFileSync(file(teal), "utf8"), appended, "a skin with a user line is never touched");
  assert.equal(fs.readFileSync(file(green), "utf8"), renderSkinYaml(green), "a shipped spinner plus a shipped body upgrades both");
  assert.ok(written.includes(file(cyan)) && written.includes(file(green)));
  assert.equal(written.includes(file(blue)) || written.includes(file(teal)) || written.includes(file(IGNITION)), false);

  const again = installSkins(home);
  assert.equal(again.includes(file(cyan)), false, "a merged skin is not rewritten on the next install");
});

test("install merges into skins from older releases without rewriting their other lines", (t) => {
  const home = skinHome(t);
  const oldest = path.join(__dirname, "fixtures", "skins-1.0.9-cyan.yaml");
  const text = fs.readFileSync(oldest, "utf8");
  assert.ok(skins.SHIPPED_SKIN_SHA256.cyan.includes(sha(text)), "fixture is the 1.0.9 bytes");
  const target = path.join(home, "skins", "lithermes-cyan.yaml");
  fs.writeFileSync(target, text);
  installSkins(home);
  const merged = fs.readFileSync(target, "utf8");
  const parsed = yaml.parse(merged);
  assert.equal(parsed.tool_prefix, "▌");
  assert.match(parsed.branding.help_header, /lit/);
  assert.ok(parsed.banner_hero.includes("◆"));
  assert.equal(parsed.banner_logo, yaml.parse(renderSkinYaml(HUD_ACCENTS[0])).banner_logo, "logo redrawn one span per row");
  // The shipped spinner block moves to the flame faces as before and the logo rows
  // are redrawn; every other line stays.
  const added = new Set(merged.split("\n"));
  const spinnerLines = new Set(SHIPPED_SPINNERS.flat());
  const lines = text.split("\n");
  const logoAt = lines.indexOf("banner_logo: |2");
  lines.forEach((line, i) => {
    const inLogo = logoAt !== -1 && i > logoAt && (line === "" || /^\s/.test(line));
    if (!spinnerLines.has(line) && !inLogo) assert.ok(added.has(line), `lost line: ${line}`);
  });
});

test("install leaves a symlinked shipped skin alone", (t) => {
  const home = skinHome(t);
  const outside = path.join(home, "outside.yaml");
  fs.writeFileSync(outside, legacy(HUD_ACCENTS[0]));
  const link = path.join(home, "skins", "lithermes-cyan.yaml");
  fs.symlinkSync(outside, link);
  installSkins(home);
  assert.equal(fs.readFileSync(outside, "utf8"), legacy(HUD_ACCENTS[0]));
  assert.equal(fs.readlinkSync(link), outside);
});
