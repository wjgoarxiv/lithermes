const fs = require("node:fs");
const path = require("node:path");
const { colorMode, skinLogo, microLogo } = require("./litMark");

// LitHermes HUD accents — 10 presets that drive Hermes' native skin engine.
// Each becomes ~/.hermes/skins/lithermes-<accent>.yaml; activated via
// `display.skin` in config.yaml or `/skin lithermes-<accent>` inside Hermes.
//
// A curated 10-accent palette (name + ANSI-256 code + order); `hex` is a
// neon-vivid color of the same hue (Hermes skins use hex, not ANSI codes).
// ⚠️  accent, code, and order are frozen by tests — do NOT reorder.
const HUD_ACCENTS = [
  { accent: "cyan",     code: 81,  hex: "#00F5FF", label: "Cyan",     mood: "neon ice" },
  { accent: "blue",     code: 39,  hex: "#00B4FF", label: "Blue",     mood: "arc flash" },
  { accent: "teal",     code: 49,  hex: "#00FFB2", label: "Teal",     mood: "plasma teal" },
  { accent: "green",    code: 118, hex: "#39FF14", label: "Green",    mood: "laser green" },
  { accent: "lavender", code: 177, hex: "#E040FB", label: "Lavender", mood: "neon violet" },
  { accent: "rose",     code: 198, hex: "#FF0066", label: "Rose",     mood: "hot magenta" },
  { accent: "gold",     code: 220, hex: "#FFE600", label: "Gold",     mood: "volt gold" },
  { accent: "orange",   code: 208, hex: "#FF6200", label: "Orange",   mood: "ember glow" },
  { accent: "slate",    code: 75,  hex: "#33AAFF", label: "Slate",    mood: "cold steel" },
  { accent: "gray",     code: 231, hex: "#F0F0F0", label: "Gray",     mood: "soft white" },
];

// A named theme, separate from the frozen numeric accent choices above.
const IGNITION = { accent: "ignition", code: 209, hex: "#FF6337", label: "Ignition", mood: "keep the work lit" };

const TOKYONIGHT_DAY_PALETTE = Object.freeze({
  background: "#E1E2E7",
  foreground: "#3760BF",
  primary: "#2E7DE9",
  secondary: "#9854F1",
  selection: "#FFFFFF",
});
const TOKYONIGHT_NIGHT_PALETTE = Object.freeze({
  background: "#1A1B26",
  foreground: "#C0CAF5",
  primary: "#7AA2F7",
  secondary: "#BB9AF7",
  selection: "#292E42",
});
const TOKYONIGHT_DAY = Object.freeze({
  accent: "tokyonight-day",
  code: null,
  hex: TOKYONIGHT_DAY_PALETTE.primary,
  label: "TokyoNight Day",
  mood: "paper daylight",
  palette: TOKYONIGHT_DAY_PALETTE,
});
const TOKYONIGHT = Object.freeze({
  accent: "tokyonight",
  code: null,
  hex: TOKYONIGHT_NIGHT_PALETTE.primary,
  label: "TokyoNight",
  mood: "midnight blue",
  palette: TOKYONIGHT_NIGHT_PALETTE,
});
const NAMED_THEMES = Object.freeze([TOKYONIGHT_DAY, TOKYONIGHT]);

function ignitionColorBlock(name, light = false) {
  const ink = light ? "#080D14" : "#F2EFDF";
  const accent = light ? "#080D14" : "#FF6337";
  const colors = Object.fromEntries(ACCENT_COLOR_KEYS.map((key) => [key, accent]));
  Object.assign(colors, {
    ui_accent: light ? "#080D14" : "#D7F75B",
    ui_label: ink,
    banner_dim: ink,
    status_bar_strong: ink,
    status_bar_dim: ink,
    status_bar_text: ink,
    banner_text: ink,
    prompt: ink,
    status_bar_bg: light ? "#F2EFDF" : "#080D14",
    completion_menu_bg: light ? "#F2EFDF" : "#080D14",
  });
  return [name + ":", ...Object.entries(colors).map(([key, value]) => `  ${key}: "${value}"`)];
}

function skinName(accent) {
  return `lithermes-${accent}`;
}

function skinsDir(hermesHome) {
  return path.join(hermesHome, "skins");
}

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

// The light-terminal pair needs a darker ink of the same hue; a fixed scale of
// the accent keeps the derivation deterministic (brief: derived variant).
function darkenHex(hex, factor = 0.55) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const channel = (value) => Math.round(value * factor).toString(16).padStart(2, "0").toUpperCase();
  return `#${rgb.map(channel).join("")}`;
}

function colorBlock(name, hex) {
  return [`${name}:`, ...ACCENT_COLOR_KEYS.map((key) => `  ${key}: "${hex}"`)];
}

function paletteColorBlock(name, palette) {
  const colors = Object.fromEntries(ACCENT_COLOR_KEYS.map((key) => [key, palette.primary]));
  Object.assign(colors, {
    banner_title: palette.foreground,
    banner_accent: palette.primary,
    banner_border: palette.primary,
    ui_accent: palette.primary,
    ui_label: palette.foreground,
    input_rule: palette.primary,
    response_border: palette.primary,
    status_bar_strong: palette.foreground,
    session_label: palette.foreground,
    banner_dim: palette.foreground,
    status_bar_dim: palette.foreground,
    status_bar_text: palette.foreground,
    banner_text: palette.foreground,
    prompt: palette.foreground,
    status_bar_bg: palette.background,
    completion_menu_bg: palette.background,
    completion_menu_meta_bg: palette.background,
    completion_menu_current_bg: palette.selection,
    completion_menu_meta_current_bg: palette.selection,
    ui_warn: palette.foreground,
    ui_error: palette.foreground,
    ui_ok: palette.foreground,
    status_bar_good: palette.foreground,
    status_bar_warn: palette.foreground,
    status_bar_bad: palette.foreground,
    status_bar_critical: palette.foreground,
  });
  return [name + ":", ...Object.entries(colors).map(([key, value]) => `  ${key}: "${value}"`)];
}

const MARK_PALETTE_KEYS = Object.freeze({
  "#FF6337": "primary",
  "#D7F75B": "secondary",
  "#F2EFDF": "foreground",
});

function recolorMarkup(rows, palette) {
  return rows.map((row) => row.replace(/\[#(?:FF6337|D7F75B|F2EFDF)\]/g, (tag) => {
    const oldHex = tag.slice(1, -1);
    return `[${palette[MARK_PALETTE_KEYS[oldHex]]}]`;
  }));
}

// Full per-accent skin per plans/references/lithermes-skin-brief.md. Every key
// is one Hermes 0.19 skin_engine.py reads: colors feeds the classic CLI
// get_color path, dark_colors/light_colors are the TUI polarity pair, and
// spinner wings must be [left, right] pairs (get_spinner_wings drops single
// glyphs, so the brief's flat wing list is shipped as two pairs).
function renderSkinYaml(entry) {
  const h = entry.hex;
  const theme = entry.palette;
  const colorBlocks = theme
    ? [
      ...paletteColorBlock("colors", theme),
      ...paletteColorBlock("dark_colors", TOKYONIGHT_NIGHT_PALETTE),
      ...paletteColorBlock("light_colors", TOKYONIGHT_DAY_PALETTE),
    ]
    : [
      ...(entry === IGNITION ? ignitionColorBlock("colors") : colorBlock("colors", h)),
      ...(entry === IGNITION ? ignitionColorBlock("dark_colors") : colorBlock("dark_colors", h)),
      ...(entry === IGNITION ? ignitionColorBlock("light_colors", true) : colorBlock("light_colors", darkenHex(h))),
    ];
  const welcomeRows = theme ? recolorMarkup(microLogo(), theme) : microLogo();
  const logoRows = theme ? recolorMarkup(skinLogo(), theme) : skinLogo();
  return [
    `name: ${skinName(entry.accent)}`,
    `description: LitHermes ${entry.label} accent HUD`,
    ...colorBlocks,
    "spinner:",
    '  waiting_faces: ["🔥", "🔥", "🔥", "🔥"]',
    "  thinking_verbs: [igniting, forging, burning, tempering]",
    "  wings:",
    '    - ["◜", "◝"]',
    '    - ["◞", "◟"]',
    "branding:",
    "  agent_name: LitHermes",
    "  response_label: lit",
    '  prompt_symbol: "🔥 ›"',
    ...(entry === IGNITION || theme
      ? ["  welcome: |", ...welcomeRows.map((row) => `    ${row}`), "    LitHermes", "    LIT ready"]
      : ["  welcome: LIT ready"]),
    "  goodbye: stay lit",
    "banner_logo: |2",
    ...logoRows.map((row) => `  ${row}`),
    "",
  ].join("\n");
}

function findAccent(token) {
  const raw = String(token == null ? "" : token).trim().toLowerCase();
  if (!raw) return null;
  const bare = raw.startsWith("lithermes-") ? raw.slice("lithermes-".length) : raw;
  if (bare === IGNITION.accent) return IGNITION;
  const named = NAMED_THEMES.find((entry) => entry.accent === bare);
  if (named) return named;
  const byName = HUD_ACCENTS.find((a) => a.accent === bare);
  if (byName) return byName;
  if (/^\d+$/.test(raw)) {
    const idx = Number(raw) - 1;
    if (idx >= 0 && idx < HUD_ACCENTS.length) return HUD_ACCENTS[idx];
  }
  return null;
}

function installSkins(hermesHome) {
  const dir = skinsDir(hermesHome);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const entry of [...HUD_ACCENTS, IGNITION, ...NAMED_THEMES]) {
    const file = path.join(dir, `${skinName(entry.accent)}.yaml`);
    // Existing names may belong to the user, including edited shipped presets.
    // Exclusive creation also preserves a file or symlink created concurrently.
    try {
      fs.writeFileSync(file, renderSkinYaml(entry), { encoding: "utf8", flag: "wx", mode: 0o600 });
      written.push(file);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return written;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function supportsColor({ stream = process.stdout, env = process.env } = {}) {
  return colorMode({ stream, env }) !== "none";
}

// Accent swatch (●●) used to preview an accent in the picker list. Prefers the
// exact ANSI-256 `code` in bold+bright for a neon-glow feel; falls back to
// 24-bit truecolor from hex. No-color path returns a plain asterisk.
function swatch(hex, { color = true, code = null } = {}) {
  if (!color) return "*";
  // Bold (\x1b[1m) + ANSI-256 fg + double dot for width/glow feel + reset
  if (code != null) return `\x1b[1m\x1b[38;5;${code}m●●\x1b[0m`;
  const rgb = hexToRgb(hex);
  if (!rgb) return "*";
  return `\x1b[1m\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m●●\x1b[0m`;
}

module.exports = {
  HUD_ACCENTS,
  IGNITION,
  TOKYONIGHT_DAY,
  TOKYONIGHT,
  NAMED_THEMES,
  darkenHex,
  skinName,
  skinsDir,
  renderSkinYaml,
  findAccent,
  installSkins,
  hexToRgb,
  supportsColor,
  swatch,
};
