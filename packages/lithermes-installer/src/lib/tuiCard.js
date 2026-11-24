const fs = require("node:fs");
const path = require("node:path");
const { sha256, writeFileAtomic } = require("./files");

// The goal card of the Hermes Ink TUI. Hermes loads every .mjs file in <home>/tui-widgets/, so the
// installer copies the packaged widget there and records its hash beside the setting, in
// <home>/lithermes/tui-card.json. A file whose bytes are not the recorded ones is the user's: it is
// never replaced and never removed. Nothing is written through a symlink.
const MODES = Object.freeze(["on", "still", "off"]);
const FILE = "lit-card.mjs";
const widgetSource = path.resolve(__dirname, "../../assets/lithermes-plugin/tui-widgets", FILE);

const widgetDir = (home) => path.join(home, "tui-widgets");
const widgetPath = (home) => path.join(widgetDir(home), FILE);
const settingsPath = (home) => path.join(home, "lithermes", "tui-card.json");
const recordsDir = (home) => path.join(home, "lithermes", "tui-card");
const lstat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });

function readSettings(home) {
  const file = settingsPath(home);
  const stat = lstat(file);
  if (!stat || !stat.isFile() || stat.size > 4096) return { mode: "on", sha256: null };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      mode: MODES.includes(saved?.mode) ? saved.mode : "on",
      sha256: /^[0-9a-f]{64}$/.test(saved?.sha256) ? saved.sha256 : null,
    };
  } catch {
    return { mode: "on", sha256: null };
  }
}

function writeSettings(home, settings) {
  const file = settingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!lstat(path.dirname(file)).isDirectory()) throw new Error(`${path.dirname(file)} is not a regular folder`);
  const text = `${JSON.stringify({ mode: settings.mode, ...(settings.sha256 ? { sha256: settings.sha256 } : {}) })}\n`;
  const stat = lstat(file);
  if (stat && !stat.isFile()) throw new Error(`${file} is not a regular file`);
  if (stat && fs.readFileSync(file, "utf8") === text) return;
  writeFileAtomic(file, text, "utf8");
}

// What stands at the widget's place: "absent", "ours" (the recorded or the packaged bytes) or "foreign".
function ownership(home, settings = readSettings(home)) {
  const dir = lstat(widgetDir(home));
  if (!dir) return "absent";
  if (!dir.isDirectory()) return "foreign";
  const stat = lstat(widgetPath(home));
  if (!stat) return "absent";
  if (!stat.isFile()) return "foreign";
  const digest = sha256(widgetPath(home));
  return digest === settings.sha256 || digest === sha256(widgetSource) ? "ours" : "foreign";
}

function removeWidget(home, settings) {
  if (ownership(home, settings) !== "ours") return false;
  fs.unlinkSync(widgetPath(home));
  if (fs.readdirSync(widgetDir(home)).length === 0) fs.rmdirSync(widgetDir(home));
  return true;
}

// Brings the widget file in line with the saved mode (or `mode`, which is then saved).
function syncTuiCard(home, mode = null) {
  const settings = readSettings(home);
  const wanted = { mode: mode || settings.mode, sha256: null };
  const owner = ownership(home, settings);
  if (wanted.mode === "off") {
    removeWidget(home, settings);
    writeSettings(home, wanted);
    return { mode: "off", state: owner === "foreign" ? "foreign" : "removed" };
  }
  if (owner === "foreign") {
    if (mode) writeSettings(home, { ...settings, mode });
    return { mode: wanted.mode, state: "foreign" };
  }
  const source = fs.readFileSync(widgetSource, "utf8");
  wanted.sha256 = sha256(widgetSource);
  fs.mkdirSync(widgetDir(home), { recursive: true });
  if (owner === "absent" || fs.readFileSync(widgetPath(home), "utf8") !== source) writeFileAtomic(widgetPath(home), source, "utf8");
  writeSettings(home, wanted);
  return { mode: wanted.mode, state: "installed" };
}

// Uninstall: the widget if its bytes are ours, the records the plugin wrote, and the settings unless
// they hold a choice of the user's, which a later install must still honour.
function removeTuiCard(home) {
  const settings = readSettings(home);
  removeWidget(home, settings);
  const records = recordsDir(home);
  if (lstat(records)?.isDirectory()) {
    for (const name of fs.readdirSync(records)) {
      if (/^\.?[0-9a-f]{32}\.json(\..*\.tmp)?$/.test(name)) fs.unlinkSync(path.join(records, name));
    }
    if (fs.readdirSync(records).length === 0) fs.rmdirSync(records);
  }
  if (!lstat(settingsPath(home))?.isFile()) return;
  if (settings.mode === "on") fs.unlinkSync(settingsPath(home));
  else writeSettings(home, { mode: settings.mode, sha256: null });
}

const FOREIGN = (home) => `${widgetPath(home)} is not the file LitHermes installed, so it was left alone`;

function applyTuiCard(mode, home) {
  const result = syncTuiCard(home, mode);
  if (result.state === "foreign") return `TUI card: ${mode} saved, but ${FOREIGN(home)}.`;
  if (mode === "off") return "TUI card off: the widget file is removed. `lithermes hud card on` brings it back.";
  return [
    mode === "still"
      ? "TUI card still: the card shows while the session has a lit goal, and its picture does not move."
      : "TUI card on: `hermes --tui` shows the card while the session has a lit goal; it moves only while a turn runs.",
    `widget: ${widgetPath(home)}`,
    "A running TUI picks the change up within a second; /lit-card puts the card away for that TUI.",
  ].join("\n");
}

function tuiCardStatus(home) {
  const settings = readSettings(home);
  const owner = ownership(home, settings);
  if (owner === "foreign") return `TUI card: FOREIGN (${FOREIGN(home)})`;
  if (settings.mode === "off") return owner === "ours" ? "TUI card: OFF (the widget file is still there; run `lithermes hud card off`)" : "TUI card: OFF (saved setting)";
  if (owner === "absent") return "TUI card: MISSING (run `lithermes hud card on`)";
  return sha256(widgetPath(home)) === sha256(widgetSource)
    ? `TUI card: PASS (${settings.mode})`
    : "TUI card: OUTDATED (the next install refreshes it)";
}

module.exports = {
  MODES,
  applyTuiCard,
  readSettings,
  removeTuiCard,
  settingsPath,
  syncTuiCard,
  tuiCardStatus,
  widgetPath,
  widgetSource,
};
