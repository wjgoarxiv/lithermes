const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("yaml");
const { HUD_ACCENTS, IGNITION, NAMED_THEMES, renderSkinYaml, skinName } = require("../src/lib/skins");
const { RECOMMENDED_STATUS_BAR_FIELDS, suggestStatusBarFields } = require("../src/lib/config");

const SEVERITY_KEYS = ["status_bar_good", "status_bar_warn", "status_bar_bad", "status_bar_critical"];
// Surface for a block with no status_bar_bg: Hermes 0.21.3 merges `colors` over its default
// skin (#1A1A2E); the paired blocks are not merged, so a light terminal is assumed near #F5F5F5.
const HOST_DEFAULT_BG = { colors: "#1A1A2E", dark_colors: "#1A1A2E", light_colors: "#F5F5F5" };
// Every id Hermes 0.21.3 accepts in display.status_bar.fields.
const HOST_STATUS_BAR_FIELDS = new Set([
  "model", "context_detail", "context_pct", "cache_hit", "latency", "tps", "compressions",
  "bg_tasks", "bg_processes", "bg_subagents", "goal", "git_branch", "duration",
  "prompt_elapsed", "idle_since", "focus", "yolo", "stash", "battery", "title", "total_tokens",
]);

const allSkins = () => [...HUD_ACCENTS, IGNITION, ...NAMED_THEMES]
  .map((entry) => ({ name: skinName(entry.accent), skin: yaml.parse(renderSkinYaml(entry)) }));

function rgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function contrast(first, second) {
  const lum = (hex) => {
    const [r, g, b] = rgb(hex).map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(first), lum(second)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("every LIT skin keeps good, warn, bad and critical apart and readable", () => {
  for (const { name, skin } of allSkins()) {
    for (const block of ["colors", "dark_colors", "light_colors"]) {
      const colors = skin[block];
      const severity = SEVERITY_KEYS.map((key) => {
        assert.match(String(colors[key]), /^#[0-9A-F]{6}$/i, `${name}.${block}.${key} must be explicit`);
        return colors[key].toUpperCase();
      });
      for (let i = 0; i < severity.length; i += 1) {
        for (let j = i + 1; j < severity.length; j += 1) {
          const distance = Math.hypot(...rgb(severity[i]).map((value, k) => value - rgb(severity[j])[k]));
          assert.ok(distance >= 32,
            `${name}.${block}: ${SEVERITY_KEYS[i]} ${severity[i]} and ${SEVERITY_KEYS[j]} ${severity[j]} look alike`);
        }
      }
      const bg = colors.status_bar_bg || HOST_DEFAULT_BG[block];
      for (const [index, hex] of severity.entries()) {
        assert.ok(contrast(hex, bg) >= 4.5, `${name}.${block}.${SEVERITY_KEYS[index]} ${hex} on ${bg}`);
      }
    }
  }
});

test("every LIT skin ships the LIT spinner: short work verbs and flame faces", () => {
  for (const { name, skin } of allSkins()) {
    const { spinner } = skin;
    for (const verb of ["lit-looping", "planning", "verifying"]) {
      assert.ok(spinner.thinking_verbs.includes(verb), `${name}: missing verb ${verb}`);
    }
    for (const verb of spinner.thinking_verbs) assert.ok(verb.length <= 20, `${name}: verb too long: ${verb}`);
    for (const key of ["waiting_faces", "thinking_faces"]) {
      assert.ok(Array.isArray(spinner[key]) && spinner[key].length >= 3, `${name}.${key}`);
      for (const face of spinner[key]) {
        // One flame plus plain text: Hermes measures the face by code points, so
        // other emoji or wide glyphs would misalign the spinner line.
        assert.match(face, /^\([ lit]*🔥[ lit]*\)$/u, `${name}.${key}: ${face} is not a flame face`);
        assert.ok([...face.replace("🔥", "")].every((ch) => ch.codePointAt(0) < 0x2800), `${name}.${key}: ${face}`);
      }
    }
    assert.ok(spinner.waiting_faces.includes("(🔥 lit)") && spinner.thinking_faces.includes("(🔥 lit)"));
    assert.ok(spinner.thinking_verbs.includes("igniting"));
    for (const pair of spinner.wings) assert.equal(pair.length, 2);
  }
});

test("status bar fields: a suggestion only when the config leaves them unset", () => {
  for (const field of RECOMMENDED_STATUS_BAR_FIELDS) assert.ok(HOST_STATUS_BAR_FIELDS.has(field), field);
  assert.ok(RECOMMENDED_STATUS_BAR_FIELDS.includes("git_branch"), "git_branch is opt-in only on the host");
  assert.deepEqual(suggestStatusBarFields(""), RECOMMENDED_STATUS_BAR_FIELDS);
  assert.deepEqual(suggestStatusBarFields("display:\n  skin: lithermes-ignition\n"), RECOMMENDED_STATUS_BAR_FIELDS);
  assert.deepEqual(suggestStatusBarFields("display:\n  status_bar:\n    fields: []\n"), RECOMMENDED_STATUS_BAR_FIELDS);
  assert.equal(suggestStatusBarFields("display:\n  status_bar:\n    fields: [model]\n"), null);
  assert.equal(suggestStatusBarFields("display: [unclosed\n"), null, "malformed YAML gets no guess");
});

test("doctor suggests status bar fields without writing config.yaml", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-statusbar-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const configFile = path.join(home, "config.yaml");
  const before = "display:\n  skin: lithermes-ignition\n";
  fs.writeFileSync(configFile, before);
  const bin = path.join(__dirname, "..", "bin", "lithermes.js");
  const env = { ...process.env, LITHERMES_NO_UPDATE_CHECK: "1", LITHERMES_NO_AUTO_UPDATE: "1" };
  const result = spawnSync(process.execPath, [bin, "doctor", "--offline", "--hermes-home", home],
    { encoding: "utf8", env });
  assert.match(result.stdout,
    /status bar fields: DEFAULT \(suggest display\.status_bar\.fields: \[model, context_pct, goal, bg_subagents, git_branch, prompt_elapsed, yolo\]; LitHermes does not write it\)/);
  assert.equal(fs.readFileSync(configFile, "utf8"), before);

  fs.writeFileSync(configFile, "display:\n  status_bar:\n    fields: [model, goal]\n");
  const custom = spawnSync(process.execPath, [bin, "doctor", "--offline", "--hermes-home", home],
    { encoding: "utf8", env });
  assert.match(custom.stdout, /status bar fields: CUSTOM \(2 fields, left as configured\)/);
});
