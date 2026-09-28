const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("yaml");
const { HUD_ACCENTS, renderSkinYaml, skinName } = require("../src/lib/skins");
const {
  readTuiAgentsNudgeConfig,
  setTuiAgentsNudgeConfig,
} = require("../src/lib/config");

// Full LitHermes skins per plans/references/lithermes-skin-brief.md, with every
// key verified against Hermes 0.19 hermes_cli/skin_engine.py.

const ENGINE_TOP_LEVEL_KEYS = new Set([
  "name",
  "description",
  "colors",
  "light_colors",
  "dark_colors",
  "spinner",
  "branding",
  "banner_logo",
]);

const ACCENT_COLOR_KEYS = [
  "banner_title",
  "banner_accent",
  "banner_border",
  "ui_accent",
  "ui_label",
  "input_rule",
  "response_border",
  "status_bar_strong",
  "session_label",
];

function parsedSkin(entry) {
  return yaml.parse(renderSkinYaml(entry));
}

test("every accent renders a parseable skin with only engine-read top-level keys", () => {
  for (const entry of HUD_ACCENTS) {
    const skin = parsedSkin(entry);
    assert.equal(skin.name, skinName(entry.accent));
    for (const key of Object.keys(skin)) {
      assert.ok(ENGINE_TOP_LEVEL_KEYS.has(key), `${entry.accent}: unexpected key ${key}`);
    }
  }
});

test("branding follows the skin brief for every accent", () => {
  for (const entry of HUD_ACCENTS) {
    const { branding } = parsedSkin(entry);
    assert.deepEqual(branding, {
      agent_name: "LitHermes",
      response_label: "lit",
      prompt_symbol: "🔥 ›",
      welcome: "LIT ready",
      goodbye: "stay lit",
    });
  }
});

test("banner_logo is the canonical standard mark in native Rich markup", () => {
  const { standard, skinLogo } = require("../src/lib/litMark");
  for (const accent of HUD_ACCENTS) {
    const logo = parsedSkin(accent).banner_logo.replace(/\n$/, "");
    assert.equal(logo, skinLogo().join("\n"));
    assert.deepEqual(logo.replace(/\[[^\]]*\]/g, "").split("\n"), standard);
    for (const color of ["#FF6337", "#D7F75B", "#F2EFDF"]) assert.ok(logo.includes(`[${color}]`));
    assert.doesNotMatch(logo, /▓|\x1b|#601616/);
    assert.equal(logo.split("\n").length, 10);
  }
});

test("spinner ships flame faces, ignition verbs, and wings as [left, right] pairs", () => {
  const { spinner } = parsedSkin(HUD_ACCENTS[3]);
  assert.deepEqual(spinner.waiting_faces, ["🔥", "🔥", "🔥", "🔥"]);
  assert.deepEqual(spinner.thinking_verbs, ["igniting", "forging", "burning", "tempering"]);
  assert.ok(Array.isArray(spinner.wings) && spinner.wings.length >= 1);
  for (const pair of spinner.wings) {
    assert.ok(Array.isArray(pair) && pair.length === 2, "skin_engine.get_spinner_wings drops non-pair entries");
  }
});

test("colors, dark_colors, and light_colors carry the nine accent keys per accent", () => {
  for (const entry of HUD_ACCENTS) {
    const skin = parsedSkin(entry);
    for (const block of ["colors", "dark_colors", "light_colors"]) {
      assert.deepEqual(Object.keys(skin[block]), ACCENT_COLOR_KEYS, `${entry.accent}.${block}`);
    }
    for (const key of ACCENT_COLOR_KEYS) {
      assert.equal(skin.colors[key], entry.hex, `${entry.accent}.colors.${key}`);
      assert.equal(skin.dark_colors[key], entry.hex, `${entry.accent}.dark_colors.${key}`);
      assert.match(skin.light_colors[key], /^#[0-9A-F]{6}$/i);
      assert.notEqual(skin.light_colors[key].toLowerCase(), entry.hex.toLowerCase(),
        `${entry.accent}: light variant must be darker than the accent`);
    }
  }
});

test("existing skin names and frozen accent order stay unchanged", () => {
  assert.deepEqual(HUD_ACCENTS.map((entry) => skinName(entry.accent)), [
    "lithermes-cyan", "lithermes-blue", "lithermes-teal", "lithermes-green",
    "lithermes-lavender", "lithermes-rose", "lithermes-gold", "lithermes-orange",
    "lithermes-slate", "lithermes-gray",
  ]);
});

// ── display.tui_agents_nudge managed key ────────────────────────────────────

test("setTuiAgentsNudgeConfig adds the key to an existing display block", () => {
  const before = "display:\n  skin: lithermes-blue\n";
  const after = setTuiAgentsNudgeConfig(before);
  assert.equal(readTuiAgentsNudgeConfig(after), "true");
  assert.match(after, /^display:\n {2}tui_agents_nudge: true\n {2}skin: lithermes-blue\n$/);
});

test("setTuiAgentsNudgeConfig creates the display block when absent", () => {
  const after = setTuiAgentsNudgeConfig("plugins:\n  enabled:\n    - lithermes\n");
  assert.match(after, /display:\n {2}tui_agents_nudge: true\n/);
});

test("setTuiAgentsNudgeConfig never overwrites an explicit user value", () => {
  const disabled = "display:\n  tui_agents_nudge: false\n";
  assert.equal(setTuiAgentsNudgeConfig(disabled), disabled);
  const enabled = "display:\n  tui_agents_nudge: true\n";
  assert.equal(setTuiAgentsNudgeConfig(enabled), enabled);
});
