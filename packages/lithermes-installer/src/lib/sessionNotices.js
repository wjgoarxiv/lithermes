const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeFileAtomic } = require("./files");
const { assertStateParent } = require("./hermesDiscovery");

// The nine skills that left LitHermes for the extension shelf. The plugin's own list is
// core_contract.MOVED_SKILL_FAMILIES; a test keeps the two in step.
const EXTENSION_IDS = [
  "lit-pptx", "lit-docx", "lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization",
  "frontend-ui-ux", "visual-qa", "lit-typographic-motion", "readme-studio",
];
const SHELF_URL = "https://github.com/wjgoarxiv/wjgoarxiv-skills";
const INSTALL_LINES = [
  `git clone ${SHELF_URL}.git`,
  'mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"',
  'cp -R wjgoarxiv-skills/variants/lithermes/<id> "${HERMES_HOME:-$HOME/.hermes}/skills/"',
];

// Notices wait here for the plugin to show them once, at the end of the first reply
// after they were written (install_notices.py). The plugin renames a notice to
// `<name>.shown.json` when it shows it, so two sessions never both show it.
function noticeDir(hermesHome) {
  return path.join(hermesHome, "lithermes", "notices");
}

function noticePath(hermesHome, name, shown = false) {
  return path.join(noticeDir(hermesHome), `${name}${shown ? ".shown" : ""}.json`);
}

function writeNotice(hermesHome, name, record) {
  assertStateParent(hermesHome);
  const dir = noticeDir(hermesHome);
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) return false;
  if (!stat) fs.mkdirSync(dir, { mode: 0o700 });
  writeFileAtomic(noticePath(hermesHome, name), `${JSON.stringify({ schemaVersion: 1, kind: name, ...record }, null, 2)}\n`, "utf8");
  return true;
}

function readNotice(hermesHome, name, shown = false) {
  try {
    const file = noticePath(hermesHome, name, shown);
    if (!fs.lstatSync(file).isFile()) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function removeNotice(hermesHome, name) {
  for (const shown of [false, true]) {
    try {
      const file = noticePath(hermesHome, name, shown);
      if (fs.lstatSync(file).isFile()) fs.unlinkSync(file);
    } catch {
      // Nothing to remove.
    }
  }
}

// Folders that older LitHermes releases filled for the film, deck and Word skills, and
// the automatic-update backups that still hold the old skill bodies. Only paths that
// exist are named. The cache roots are the ones those skills read, first match first.
function leftoverPaths(hermesHome, env = process.env) {
  const roots = [];
  if (env.XDG_CACHE_HOME) roots.push(env.XDG_CACHE_HOME);
  roots.push(path.join(env.HERMES_HOME || hermesHome, ".cache"));
  if (hermesHome !== env.HERMES_HOME) roots.push(path.join(hermesHome, ".cache"));
  roots.push(path.join(env.HOME || os.homedir(), ".cache"));
  const found = [];
  for (const root of [...new Set(roots)]) {
    for (const name of ["motion", "office"]) found.push(path.join(root, "lithermes", name));
  }
  found.push(path.join(hermesHome, "lithermes", "auto-update"));
  return [...new Set(found)].filter((candidate) => fs.lstatSync(candidate, { throwIfNoEntry: false })?.isDirectory());
}

// What install and update print once, after the receipt. Plain text, no colour, and
// never part of a --json run.
function extensionsNoticeLines({ upgradedFrom = null, leftovers = [] } = {}) {
  const lines = [
    "",
    "LitFamily extensions",
    "  LitHermes's core is complete and works on its own. Nine skills that make files (decks, documents,",
    "  figures, design and video covers) are now LitFamily extensions, kept on the extension shelf at",
    `  ${SHELF_URL}. Install the ones you use alongside LitHermes to get`,
    "  the full LitFamily experience. One skill at a time, then start a new Hermes session:",
    ...INSTALL_LINES.map((line) => `    ${line}`),
    `  <id>: ${EXTENSION_IDS.slice(0, 5).join(", ")},`,
    `  ${EXTENSION_IDS.slice(5, -1).join(", ")} or ${EXTENSION_IDS[EXTENSION_IDS.length - 1]}.`,
  ];
  if (upgradedFrom && leftovers.length) {
    lines.push(
      "  The old version left these behind. If you do not install those extensions, you can delete them:",
      ...leftovers.map((leftover) => `    ${leftover}`),
    );
  }
  return lines;
}

module.exports = {
  EXTENSION_IDS,
  INSTALL_LINES,
  SHELF_URL,
  extensionsNoticeLines,
  leftoverPaths,
  noticePath,
  readNotice,
  removeNotice,
  writeNotice,
};
