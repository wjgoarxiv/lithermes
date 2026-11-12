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
// One extension goes into the profile in five pasted lines (bash or zsh): name it, check for other
// copies (read only), move an existing skills/<id>/ whole into extension-backups/<stamp>/ (outside
// every folder Hermes reads skills from), copy into the emptied folder, write the receipt. A bare
// `cp -R` into skills/ would merge into an old copy. `${ID:?}` stops a line when ID is empty, so an
// unedited paste never moves skills/ itself. The plugin's own copy is core_contract.EXTENSION_STEP_LINES;
// test/extension-install-lines.test.js holds both to the stubs.
const EXTENSION_STEP_LINES = [
  '[ -e "$H/skills/${ID:?}" ] && echo "taken: $H/skills/$ID" || echo "free: $H/skills/$ID"; grep -rlE --include=SKILL.md "^name: *[\\"\']?${ID}[\\"\']? *\\$" "$H/skills" .hermes/skills .agents/skills 2>/dev/null; grep -A3 -E \'^ *(external_dirs|create_dir):\' "$H/config.yaml" 2>/dev/null',
  'if [ -e "$H/skills/${ID:?}" ]; then mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"; fi',
  'if [ -e "$H/skills/${ID:?}" ]; then echo "stopped: $H/skills/$ID is still there"; else mkdir -p "$H/skills" && cp -R "$SRC" "$H/skills/$ID" && echo "copied: $H/skills/$ID"; fi',
  'printf \'{"id":"%s","source":"%s","variant":"lithermes","installed_at":"%s"}\\n\' "${ID:?}" "$SRC" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$H/skills/$ID/.litfamily-extension.json"',
];
const EXTENSION_REMOVE_LINE = '[ -e "$H/skills/${ID:?}" ] && mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"';

function extensionSetupLine(id, source) {
  return `H="\${HERMES_HOME:-$HOME/.hermes}"; ID=${id}; SRC="${source}"`;
}

const INSTALL_LINES = [
  `git clone ${SHELF_URL}.git`,
  extensionSetupLine("lit-pptx", "$PWD/wjgoarxiv-skills/variants/lithermes/$ID"),
  ...EXTENSION_STEP_LINES,
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
    "  the full LitFamily experience. One skill at a time (set ID; any old copy moves to extension-backups/),",
    "  then start a new Hermes session:",
    ...INSTALL_LINES.map((line) => `    ${line}`),
    `  ID: ${EXTENSION_IDS.slice(0, 5).join(", ")},`,
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
  EXTENSION_REMOVE_LINE,
  EXTENSION_STEP_LINES,
  INSTALL_LINES,
  SHELF_URL,
  extensionSetupLine,
  extensionsNoticeLines,
  leftoverPaths,
  noticePath,
  readNotice,
  removeNotice,
  writeNotice,
};
