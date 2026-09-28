const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const yaml = require("yaml");
const { HUD_ACCENTS, findAccent, renderSkinYaml, installSkins } = require("../src/lib/skins");
const { micro, skinLogo } = require("../src/lib/litMark");
const { listHud, applyHud, clearHud } = require("../src/lib/hud");
const { readDisplaySkinConfig } = require("../src/lib/config");

const TOKYONIGHT_CASES = [
  {
    token: "lithermes-tokyonight-day",
    accent: "tokyonight-day",
    background: "#E1E2E7",
    foreground: "#3760BF",
    primary: "#2E7DE9",
    dim: "#3760BF",
    selection: "#FFFFFF",
  },
  {
    token: "lithermes-tokyonight",
    accent: "tokyonight",
    background: "#1A1B26",
    foreground: "#C0CAF5",
    primary: "#7AA2F7",
    dim: "#C0CAF5",
    selection: "#292E42",
  },
];

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [a, b] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("Ignition is a named native skin without renumbering the ten accents", () => {
  const ignition = findAccent("ignition");
  assert.ok(ignition, "explicit Ignition skin must be selectable");
  assert.equal(findAccent("lithermes-ignition"), ignition);
  assert.equal(HUD_ACCENTS.length, 10);
  for (let index = 0; index < 10; index++) {
    assert.equal(findAccent(String(index + 1)), HUD_ACCENTS[index]);
  }
  const skin = yaml.parse(renderSkinYaml(ignition));
  assert.equal(skin.name, "lithermes-ignition");
  for (const colors of [skin.colors, skin.dark_colors]) {
    assert.equal(colors.banner_title, "#FF6337");
    assert.equal(colors.ui_accent, "#D7F75B");
    assert.equal(colors.banner_text, "#F2EFDF");
    assert.equal(colors.status_bar_bg, "#080D14");
  }
  assert.equal(skin.light_colors.banner_text, "#080D14");
  assert.equal(skin.light_colors.status_bar_bg, "#F2EFDF");
  assert.match(listHud({ color: false }), /ignition/);
});

test("Ignition compact welcome carries the canonical MICRO mark and ready suffix", () => {
  const skin = yaml.parse(renderSkinYaml(findAccent("ignition")));
  const welcome = skin.branding.welcome;
  assert.equal(typeof welcome, "string");
  const plain = welcome.replace(/\[[^\]]*\]/g, "");
  assert.equal(micro.length, 5);
  assert.deepEqual(micro.map((row) => row.length), [16, 16, 16, 16, 16]);
  assert.deepEqual(plain.split("\n").slice(0, micro.length), micro);
  assert.match(plain.trimEnd(), /LitHermes\nLIT ready$/);
  for (const color of ["#FF6337", "#D7F75B", "#F2EFDF"]) {
    assert.match(welcome, new RegExp(`\\[${color}\\]`));
  }
});

test("Ignition declares readable dim and status ink for dark and light polarity", () => {
  const skin = yaml.parse(renderSkinYaml(findAccent("ignition")));
  for (const block of [skin.colors, skin.dark_colors]) {
    assert.equal(block.banner_dim, "#F2EFDF");
    assert.equal(block.status_bar_dim, "#F2EFDF");
    assert.equal(block.status_bar_text, "#F2EFDF");
  }
  for (const key of ["banner_dim", "status_bar_dim", "status_bar_text"]) {
    assert.equal(skin.light_colors[key], "#080D14");
  }
});

test("TokyoNight named skins are selectable, discoverable, and fully mapped", () => {
  const classicKeys = [
    "banner_title", "banner_accent", "banner_border", "ui_accent", "ui_label",
    "input_rule", "response_border", "status_bar_strong", "session_label",
    "banner_dim", "status_bar_dim", "status_bar_text", "banner_text", "prompt",
    "status_bar_bg", "completion_menu_bg", "completion_menu_current_bg",
    "completion_menu_meta_bg", "completion_menu_meta_current_bg", "ui_warn", "ui_error", "ui_ok",
    "status_bar_good", "status_bar_warn", "status_bar_bad", "status_bar_critical",
  ];
  for (const expected of TOKYONIGHT_CASES) {
    const entry = findAccent(expected.token);
    assert.ok(entry, `${expected.token} must be selectable by its full name`);
    assert.equal(entry.accent, expected.accent);
    const skin = yaml.parse(renderSkinYaml(entry));
    assert.equal(skin.name, expected.token);
    for (const blockName of ["colors", "dark_colors", "light_colors"]) {
      const block = skin[blockName];
      assert.ok(block, `${expected.token}.${blockName} must be explicit`);
      for (const key of classicKeys) {
      assert.match(String(block[key]), /^#[0-9A-F]{6}$/i, `${expected.token}.${blockName}.${key}`);
      }
      assert.ok(contrastRatio(block.prompt, block.status_bar_bg) >= 4.5,
        `${expected.token}.${blockName}.prompt contrast`);
      assert.ok(contrastRatio(block.status_bar_text, block.status_bar_bg) >= 4.5,
        `${expected.token}.${blockName}.status_bar_text contrast`);
      assert.ok(contrastRatio(block.status_bar_dim, block.status_bar_bg) >= 4.5,
        `${expected.token}.${blockName}.status_bar_dim contrast`);
      assert.notEqual(block.completion_menu_current_bg, block.status_bar_bg);
      assert.equal(block.completion_menu_meta_bg, block.status_bar_bg);
      assert.equal(block.completion_menu_meta_current_bg, block.completion_menu_current_bg);
      for (const key of [
        "banner_title", "ui_label", "ui_warn", "ui_error", "ui_ok",
        "status_bar_good", "status_bar_warn", "status_bar_bad", "status_bar_critical",
      ]) {
        assert.ok(contrastRatio(block[key], block.status_bar_bg) >= 4.5,
          `${expected.token}.${blockName}.${key} contrast`);
      }
      assert.ok(contrastRatio(block.banner_title, block.completion_menu_current_bg) >= 4.5,
        `${expected.token}.${blockName}.completion title contrast`);
      assert.ok(contrastRatio(block.ui_label, block.completion_menu_current_bg) >= 4.5,
        `${expected.token}.${blockName}.completion label contrast`);
    }
    assert.equal(skin.colors.banner_accent, expected.primary);
    assert.equal(skin.colors.ui_accent, expected.primary);
    assert.equal(skin.colors.prompt, expected.foreground);
    assert.equal(skin.colors.status_bar_text, expected.foreground);
    assert.equal(skin.colors.status_bar_bg, expected.background);
    assert.equal(skin.colors.completion_menu_bg, expected.background);
    assert.equal(skin.colors.completion_menu_current_bg, expected.selection);
    assert.equal(skin.colors.completion_menu_meta_bg, expected.background);
    assert.equal(skin.colors.completion_menu_meta_current_bg, expected.selection);
    assert.equal(skin.colors.status_bar_dim, expected.dim);

    const strip = (value) => value.replace(/\[[^\]]*\]/g, "");
    const welcome = skin.branding.welcome;
    assert.deepEqual(strip(welcome).split("\n").slice(0, micro.length), micro);
    assert.match(strip(welcome).trimEnd(), /LitHermes\nLIT ready$/);
    const bannerRows = skin.banner_logo.replace(/\n$/, "").split("\n");
    assert.deepEqual(bannerRows.map(strip), skinLogo().map(strip));
    for (const artwork of [welcome, skin.banner_logo]) {
      assert.match(artwork, new RegExp(`\\[${expected.primary}\\]`));
      assert.match(artwork, new RegExp(`\\[${expected.foreground}\\]`));
      for (const old of ["#FF6337", "#D7F75B", "#F2EFDF"]) {
        assert.doesNotMatch(artwork, new RegExp(`\\[${old}\\]`));
      }
    }
  }
  const listing = listHud({ color: false });
  for (const expected of TOKYONIGHT_CASES) assert.match(listing, new RegExp(expected.token));
});

test("installing TokyoNight writes both named skins without changing numeric choices", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-tokyonight-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const written = installSkins(home);
  for (const expected of TOKYONIGHT_CASES) {
    assert.ok(written.includes(path.join(home, "skins", `${expected.token}.yaml`)), expected.token);
  }
  assert.equal(HUD_ACCENTS.length, 10);
});

test("installing native skins retains custom files including edited preset names", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skin-retain-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "skins"));
  const preserved = ["my-skin.yaml", "lithermes-cyan.yaml", "lithermes-ignition.yaml"];
  for (const name of preserved) fs.writeFileSync(path.join(home, "skins", name), `# user ${name}\n`);
  installSkins(home);
  for (const name of preserved) {
    assert.equal(fs.readFileSync(path.join(home, "skins", name), "utf8"), `# user ${name}\n`);
  }
});

test("installing native skins leaves an existing symlinked skin untouched", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skin-symlink-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "skins");
  fs.mkdirSync(dir);
  const target = path.join(home, "outside.yaml");
  const ignitionFile = path.join(dir, "lithermes-ignition.yaml");
  fs.writeFileSync(target, "# preserve this target\n");
  fs.chmodSync(target, 0o640);
  const targetMode = fs.statSync(target).mode & 0o777;
  fs.symlinkSync(target, ignitionFile);
  const written = installSkins(home);
  assert.equal(written.includes(ignitionFile), false);
  assert.equal(fs.readlinkSync(ignitionFile), target);
  assert.equal(fs.readFileSync(target, "utf8"), "# preserve this target\n");
  assert.equal(fs.statSync(target).mode & 0o777, targetMode);
});

test("explicit Ignition selection writes native display.skin and a usable YAML", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-ignition-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  applyHud("ignition", { "hermes-home": home });
  assert.equal(readDisplaySkinConfig(fs.readFileSync(path.join(home, "config.yaml"), "utf8")), "lithermes-ignition");
  assert.equal(yaml.parse(fs.readFileSync(path.join(home, "skins", "lithermes-ignition.yaml"), "utf8")).name, "lithermes-ignition");
});

test("clearing selected Ignition preserves skin files and unrelated settings", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-ignition-clear-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = path.join(home, "config.yaml");
  fs.writeFileSync(config, "display:\n  skin: my-skin\n  tui_agents_nudge: false\ncustom: keep\n");
  fs.mkdirSync(path.join(home, "skins"));
  const customFile = path.join(home, "skins", "my-skin.yaml");
  fs.writeFileSync(customFile, "# keep my custom skin\n");
  applyHud("ignition", { "hermes-home": home });
  const ignitionFile = path.join(home, "skins", "lithermes-ignition.yaml");
  const before = fs.readFileSync(ignitionFile);
  clearHud({ "hermes-home": home });
  const after = fs.readFileSync(config, "utf8");
  assert.equal(readDisplaySkinConfig(after), null);
  assert.match(after, /tui_agents_nudge: false/);
  assert.match(after, /custom: keep/);
  assert.deepEqual(fs.readFileSync(ignitionFile), before);
  assert.equal(fs.readFileSync(customFile, "utf8"), "# keep my custom skin\n");
});

test("new skin files retain private modes under permissive umask without changing existing files", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-skin-mode-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "skins");
  fs.mkdirSync(dir);
  const existing = path.join(dir, "lithermes-cyan.yaml");
  fs.writeFileSync(existing, "# custom cyan\n");
  fs.chmodSync(existing, 0o640);
  const priorMask = process.umask(0);
  let created;
  try {
    created = installSkins(home);
  } finally {
    process.umask(priorMask);
  }
  assert.ok(created.includes(path.join(dir, "lithermes-ignition.yaml")));
  for (const file of created) assert.equal(fs.statSync(file).mode & 0o777, 0o600, file);
  assert.equal(fs.statSync(existing).mode & 0o777, 0o640);
  assert.equal(fs.readFileSync(existing, "utf8"), "# custom cyan\n");
});
