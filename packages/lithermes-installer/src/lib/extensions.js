"use strict";

// `lithermes extensions <verb>`: the five install lines of the stubs, done in code. One extension is
// one folder, skills/<id>/ of the Hermes profile, holding a receipt (.litfamily-extension.json). An
// old folder is moved whole into extension-backups/<date-time>-XXXXXX/ of the profile, outside every
// folder Hermes reads skills from, and nothing is ever deleted except backups under prune-backups --yes.
// Every write verb only prints its plan unless --yes is given. The verbs write only to skills/<id>/,
// extension-backups/ and this package's own source clone in the cache folder.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseDocument } = require("yaml");
const { readConfig, readExternalSkillDirsConfig } = require("./config");
const { writeFileAtomic } = require("./files");
const { describeSpawnFailure, spawnTool } = require("./hostExec");
const { LitHermesError, ensureHermesHome, expandHome } = require("./hermesDiscovery");
const { EXTENSION_CLI, EXTENSION_IDS, SHELF_URL, leftoverPaths } = require("./sessionNotices");

// The same families as core_contract.MOVED_SKILL_FAMILIES (a test keeps them in step).
const EXTENSION_FAMILIES = {
  "lit-pptx": "decks",
  "lit-docx": "documents",
  "lit-diagram-drawer": "figures",
  "lit-schematic": "figures",
  "lit-scientific-visualization": "figures",
  "frontend-ui-ux": "design",
  "visual-qa": "design",
  "lit-typographic-motion": "video-covers",
  "readme-studio": "video-covers",
};
const VERBS = ["list", "check", "install", "update", "remove", "prune-backups"];
const VERB_FLAGS = {
  list: ["json"],
  check: ["json"],
  install: ["from", "family", "all", "yes", "dry-run", "allow-shadow"],
  update: ["from", "all", "yes", "dry-run", "allow-shadow"],
  remove: ["yes", "dry-run"],
  "prune-backups": ["older-than", "yes", "dry-run"],
};
const RECEIPT = ".litfamily-extension.json";
const VARIANT = "lithermes";
const SHELF_GIT = `${SHELF_URL}.git`;
const SPARSE_PATH = `variants/${VARIANT}`;
// Folders Hermes never scans for skills (agent/skill_utils.py EXCLUDED_SKILL_DIRS), and the support
// folders inside a skill, which it never reads as skills of their own.
const EXCLUDED_DIRS = new Set([
  ".git", ".github", ".hub", ".archive", ".curator_backups", ".locks", ".hermes-dist",
  ".venv", "venv", "node_modules", "site-packages", "__pycache__",
  ".tox", ".nox", ".pytest_cache", ".mypy_cache", ".ruff_cache",
]);
const SUPPORT_DIRS = new Set(["references", "templates", "assets", "scripts"]);
const UNHASHED = (name) => name === "__pycache__" || /\.py[co]$/.test(name) || name === ".DS_Store";

function fail(message, code = 1) {
  return new LitHermesError(message, code);
}

function lstat(file) {
  return fs.lstatSync(file, { throwIfNoEntry: false });
}

function cacheDir(env = process.env) {
  const base = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(os.homedir(), ".cache");
  return path.join(base, "lithermes", "extensions-src");
}

function backupsRoot(home) {
  return path.join(home, "extension-backups");
}

// A fix line the user can paste as it is: it names the profile when the command was given one.
function cliLine(flags, rest) {
  const home = flags["hermes-home"];
  return `${EXTENSION_CLI} extensions ${rest}${typeof home === "string" && home ? ` --hermes-home ${path.resolve(home)}` : ""}`;
}

function frontmatterName(skillFile) {
  try {
    const head = fs.readFileSync(skillFile, "utf8").slice(0, 8192);
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    const match = block && /^name:[ \t]*(.*)$/m.exec(block[1]);
    return match ? match[1].trim().replace(/^(["'])(.*)\1$/, "$2").trim() : null;
  } catch {
    return null;
  }
}

// Every SKILL.md Hermes would index under one root, walked the way its own scanner walks.
function skillFiles(root, limit = 20000) {
  const out = [];
  let seen = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasSkill = entries.some((entry) => entry.name === "SKILL.md" && !entry.isDirectory());
    if (hasSkill) out.push(path.join(dir, "SKILL.md"));
    for (const entry of entries) {
      seen += 1;
      if (seen > limit) return;
      if (EXCLUDED_DIRS.has(entry.name) || (hasSkill && SUPPORT_DIRS.has(entry.name))) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isSymbolicLink()) {
        // Hermes follows a linked folder; read its SKILL.md, but never walk through the link.
        try {
          if (fs.statSync(full).isDirectory() && fs.statSync(path.join(full, "SKILL.md")).isFile()) out.push(path.join(full, "SKILL.md"));
        } catch {
          // A dangling link indexes nothing.
        }
      }
    }
  };
  walk(root);
  return out;
}

function configList(text, keys) {
  try {
    const document = parseDocument(String(text || ""), { strict: true, uniqueKeys: true });
    if (document.errors.length) return [];
    const value = document.getIn(keys);
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : value?.toJSON?.() || [];
    return (Array.isArray(list) ? list : [list]).filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
  } catch {
    return [];
  }
}

// The nearest folder above cwd holding .git, never the home folder itself (Hermes' own rule).
function projectRoot(cwd) {
  let current = path.resolve(cwd);
  const home = path.resolve(os.homedir());
  for (let depth = 0; depth < 64; depth += 1) {
    if (fs.existsSync(path.join(current, ".git"))) return current === home ? null : current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

// Every folder Hermes reads skills from for this profile and this working directory, highest
// precedence first: a trusted project, the profile's skills/, skills.create_dir, skills.external_dirs.
function skillRoots(home, cwd) {
  const configText = readConfig(home);
  const roots = [];
  const project = projectRoot(cwd);
  if (project) {
    const trusted = configList(configText, ["skills", "trusted_project_dirs"]).map((dir) => path.resolve(expandHome(dir)));
    for (const sub of [[".hermes", "skills"], [".agents", "skills"]]) {
      roots.push({ where: "project", dir: path.join(project, ...sub), project, trusted: trusted.includes(project) });
    }
  }
  roots.push({ where: "profile", dir: path.join(home, "skills") });
  for (const dir of configList(configText, ["skills", "create_dir"])) roots.push({ where: "skills.create_dir", dir: path.resolve(expandHome(dir)) });
  for (const dir of readExternalSkillDirsConfig(configText)) roots.push({ where: "skills.external_dirs", dir: path.resolve(expandHome(dir)) });
  const seen = new Set();
  return roots.filter((root) => !seen.has(root.dir) && seen.add(root.dir));
}

function effectOf(root, id) {
  if (root.where === "profile") return `ties with skills/${id}/, and Hermes then loads neither`;
  if (root.where === "project") {
    return root.trusted
      ? `wins over the extension inside ${root.project}`
      : `wins over the extension inside ${root.project} once that folder is in skills.trusted_project_dirs`;
  }
  return "loses to the profile copy, but stays a second skill of that name";
}

// Same-name skills anywhere Hermes looks, other than skills/<id>/ itself. Hermes matches a skill by
// its declared name and by its folder name, so a backup such as skills/<id>.bak-<date>/ counts too.
function competingCopies(id, roots, dest) {
  const found = [];
  for (const root of roots) {
    for (const file of skillFiles(root.dir)) {
      const dir = path.dirname(file);
      if (dir === dest || dir.startsWith(`${dest}${path.sep}`)) continue;
      if (path.basename(dir) !== id && frontmatterName(file) !== id) continue;
      found.push({ path: dir, where: root.where, sameFolder: root.where === "profile", effect: effectOf(root, id) });
    }
  }
  return found;
}

function hashTree(dir) {
  const hash = crypto.createHash("sha256");
  const walk = (folder, rel) => {
    for (const name of fs.readdirSync(folder).sort()) {
      if (UNHASHED(name) || (rel === "" && name === RECEIPT)) continue;
      const full = path.join(folder, name);
      const key = rel ? `${rel}/${name}` : name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) hash.update(`link ${key}\0${fs.readlinkSync(full)}\n`);
      else if (stat.isDirectory()) walk(full, key);
      else if (stat.isFile()) hash.update(`file ${key}\0${crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")}\n`);
    }
  };
  walk(dir, "");
  return `sha256:${hash.digest("hex")}`;
}

function readReceipt(dest) {
  const file = path.join(dest, RECEIPT);
  const stat = lstat(file);
  if (!stat) return { receipt: null };
  if (!stat.isFile()) return { receipt: null, problem: `${file} is not a plain file` };
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { receipt: null, problem: `${file} is not a JSON object` };
    if (value.variant !== VARIANT) return { receipt: null, foreign: value, problem: `${file} was written for ${JSON.stringify(value.variant)}, not ${VARIANT}` };
    return { receipt: value, problem: value.id === path.basename(dest) ? null : `${file} names ${JSON.stringify(value.id)}` };
  } catch {
    return { receipt: null, problem: `${file} does not parse as JSON` };
  }
}

// What one extension looks like in this profile right now. Read only.
function inspectExtension(id, home, roots) {
  const dest = path.join(home, "skills", id);
  const stat = lstat(dest);
  const record = { id, family: EXTENSION_FAMILIES[id], dest, state: "absent", receipt: null, problem: null, modified: null, competing: competingCopies(id, roots, dest) };
  if (!stat) return record;
  if (stat.isSymbolicLink()) return { ...record, state: "linked" };
  if (!stat.isDirectory()) return { ...record, state: "not-a-folder" };
  const { receipt, problem } = readReceipt(dest);
  record.problem = problem || null;
  if (!receipt) return { ...record, state: "user-managed" };
  record.state = "installed";
  record.receipt = receipt;
  if (typeof receipt.hash === "string") {
    try {
      record.modified = hashTree(dest) !== receipt.hash;
    } catch {
      record.modified = true;
    }
  }
  record.sourceMissing = typeof receipt.source === "string" && receipt.source !== "" && !fs.existsSync(receipt.source);
  return record;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function treeSize(dir) {
  let total = 0;
  const walk = (folder) => {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += lstat(full)?.size || 0;
    }
  };
  walk(dir);
  return total;
}

function stampTime(name, fallback) {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(name);
  if (!match) return fallback;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

function listBackups(home) {
  const root = backupsRoot(home);
  const stat = lstat(root);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return { root, folders: [], unsafe: Boolean(stat) };
  const folders = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      folders.push({ name: entry.name, path: full, skipped: "not a plain folder", bytes: 0, ids: [], time: 0 });
      continue;
    }
    const ids = fs.readdirSync(full).sort();
    folders.push({ name: entry.name, path: full, bytes: treeSize(full), ids, time: stampTime(entry.name, fs.statSync(full).mtimeMs) });
  }
  return { root, folders, unsafe: false };
}

function stalePluginBodies(home) {
  return EXTENSION_IDS.filter((id) => {
    try {
      const text = fs.readFileSync(path.join(home, "plugins", "lithermes", "skills", id, "SKILL.md"), "utf8");
      return !/^\s*stub: true$/m.test(text);
    } catch {
      return false;
    }
  });
}

function context(flags, { cwd = process.cwd(), env = process.env } = {}) {
  const { hermesHome } = ensureHermesHome(flags);
  return { home: hermesHome, cwd, env, roots: skillRoots(hermesHome, cwd) };
}

// `check`: everything that needs a hand, each with the line that fixes it. Read only.
function checkExtensions(flags = {}, runtime = {}) {
  const ctx = context(flags, runtime);
  const issues = [];
  const notes = [];
  const records = EXTENSION_IDS.map((id) => inspectExtension(id, ctx.home, ctx.roots));
  for (const record of records) {
    const { id } = record;
    for (const copy of record.competing) {
      issues.push({
        id,
        kind: copy.sameFolder ? "ambiguous" : "competing",
        path: copy.path,
        message: `${id}: another skill named ${id} is at ${copy.path} (${copy.where}); it ${copy.effect}.`,
        fix: copy.sameFolder
          ? `mkdir -p "${backupsRoot(ctx.home)}" && B=$(mktemp -d "${backupsRoot(ctx.home)}/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "${copy.path}" "$B/"`
          : `move ${copy.path} out of ${copy.where === "project" ? "the project's skills folder" : copy.where}, or keep it on purpose`,
      });
    }
    if (record.state === "linked" || record.state === "not-a-folder") {
      issues.push({ id, kind: record.state, path: record.dest, message: `${id}: ${record.dest} is ${record.state === "linked" ? "a symbolic link" : "not a folder"}; the extension verbs leave it alone.`, fix: `replace ${record.dest} by hand` });
    } else if (record.state === "user-managed") {
      issues.push({
        id,
        kind: "no-receipt",
        path: record.dest,
        message: `${id}: ${record.dest} has no LitHermes receipt${record.problem ? ` (${record.problem})` : ""}, so it is user-managed.`,
        fix: `${cliLine(flags, `install ${id} --yes`)}   (moves it into extension-backups/ and installs the extension with a receipt)`,
      });
    } else if (record.state === "installed") {
      if (record.problem) issues.push({ id, kind: "bad-receipt", path: record.dest, message: `${id}: ${record.problem}.`, fix: cliLine(flags, `install ${id} --yes`) });
      if (record.sourceMissing) {
        issues.push({ id, kind: "source-missing", path: record.receipt.source, message: `${id}: its receipt names ${record.receipt.source}, which no longer exists.`, fix: cliLine(flags, `update ${id} --yes`) });
      }
      if (record.modified) notes.push(`${id}: files in ${record.dest} changed since it was installed; update leaves it alone, install --yes replaces it and keeps this copy in extension-backups/.`);
    }
  }
  for (const id of stalePluginBodies(ctx.home)) {
    issues.push({ id, kind: "stale-plugin-body", path: path.join(ctx.home, "plugins", "lithermes", "skills", id), message: `${id}: the LitHermes plugin folder still holds the old full ${id} skill instead of its stub.`, fix: "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes" });
  }
  const backups = listBackups(ctx.home);
  if (backups.unsafe) issues.push({ id: null, kind: "backups-unsafe", path: backups.root, message: `${backups.root} is not a plain folder; the extension verbs will not write there.`, fix: `replace ${backups.root} by hand` });
  const backupBytes = backups.folders.reduce((sum, folder) => sum + folder.bytes, 0);
  if (backups.folders.length) {
    notes.push(`backups: ${backups.folders.length} ${backups.folders.length === 1 ? "folder" : "folders"} in ${backups.root}, ${formatBytes(backupBytes)}; ${cliLine(flags, "prune-backups")} lists them.`);
  }
  const leftovers = leftoverPaths(ctx.home, ctx.env);
  if (leftovers.length) notes.push(`older LitHermes releases left ${leftovers.join(", ")}; delete them if you do not use those extensions.`);
  return { home: ctx.home, ok: issues.length === 0, issues, notes, backups: { root: backups.root, count: backups.folders.length, bytes: backupBytes }, records };
}

function formatCheck(result) {
  const lines = [`LitHermes extensions check: ${result.ok ? "clean" : `${result.issues.length} ${result.issues.length === 1 ? "thing needs" : "things need"} action`}`];
  for (const issue of result.issues) lines.push(`  ${issue.message}`, `    fix: ${issue.fix}`);
  for (const note of result.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}

// One line for doctor and for the notices.
function extensionsSummary(flags = {}, runtime = {}) {
  try {
    const result = checkExtensions(flags, runtime);
    const installed = result.records.filter((record) => record.state === "installed").length;
    const head = `extensions: ${installed} of ${EXTENSION_IDS.length} installed`;
    return {
      ok: result.ok,
      count: result.issues.length,
      line: result.ok
        ? `${head}, check clean`
        : `${head}; ${result.issues.length} ${result.issues.length === 1 ? "thing needs" : "things need"} action (run ${cliLine(flags, "check")})`,
    };
  } catch {
    return { ok: true, count: 0, line: "extensions: not checked (the Hermes home could not be read)" };
  }
}

function listExtensions(flags = {}, runtime = {}) {
  const ctx = context(flags, runtime);
  return { home: ctx.home, records: EXTENSION_IDS.map((id) => inspectExtension(id, ctx.home, ctx.roots)) };
}

function formatList({ home, records }) {
  const lines = [`LitFamily extensions in ${path.join(home, "skills")}:`];
  for (const record of records) {
    const label = `  ${record.id} (${record.family}):`;
    if (record.state === "installed") {
      const { receipt } = record;
      lines.push(`${label} installed ${receipt.installed_at || "(no time)"} from ${receipt.source || "(no source)"}${record.modified ? "; changed since" : ""}`);
    } else if (record.state === "user-managed") lines.push(`${label} user-managed (no receipt) at ${record.dest}`);
    else if (record.state === "linked") lines.push(`${label} a symbolic link at ${record.dest}, left alone`);
    else if (record.state === "not-a-folder") lines.push(`${label} ${record.dest} is not a folder, left alone`);
    else lines.push(`${label} not installed`);
    for (const copy of record.competing) lines.push(`      also named ${record.id}: ${copy.path} (${copy.where}; ${copy.effect})`);
  }
  return lines.join("\n");
}

function runGit(args, env) {
  return spawnTool("git", args, { encoding: "utf8", env: { ...env, GIT_TERMINAL_PROMPT: "0" }, timeout: 300000 });
}

function gitFailure(action, result) {
  const missing = result.error && result.error.code === "ENOENT";
  const why = missing ? "git is not installed or not on PATH" : describeSpawnFailure(`git ${action}`, result);
  return fail(
    `LitHermes extensions: could not ${action === "clone" ? "fetch" : "refresh"} the extension shelf (${why}). Nothing was installed.\n`
    + "Check the network, or clone it yourself and pass --from <path to your wjgoarxiv-skills clone>.",
    3,
  );
}

function variantsOf(root) {
  const variants = path.join(root, "variants", VARIANT);
  const stat = lstat(variants);
  return stat && stat.isDirectory() ? variants : null;
}

// Where the extensions come from: --from <clone>, or this package's own shallow, sparse clone of
// variants/lithermes/ in the cache folder. `refresh` pulls the cache first (update does).
function resolveSource(flags, ctx, { refresh = false, write = false } = {}) {
  if (typeof flags.from === "string") {
    const root = path.resolve(expandHome(flags.from));
    const variants = variantsOf(root);
    if (!variants) throw fail(`LitHermes extensions: ${root} has no variants/${VARIANT}/ folder; point --from at a wjgoarxiv-skills clone.`, 2);
    return { kind: "from", root, variants, label: `${variants} (from --from)` };
  }
  const root = cacheDir(ctx.env);
  const stat = lstat(root);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw fail(`LitHermes extensions: ${root} is not a plain folder; move it away, or pass --from <path>.`, 5);
  const present = Boolean(stat && variantsOf(root) && lstat(path.join(root, ".git")));
  if (stat && !present) throw fail(`LitHermes extensions: ${root} is not a clone this command made; move it away, or pass --from <path>.`, 5);
  if (!write) {
    if (!present) return { kind: "cache", root, variants: path.join(root, "variants", VARIANT), pending: true, label: `would fetch ${SHELF_GIT} (variants/${VARIANT}/ only) into ${root}` };
    return { kind: "cache", root, variants: variantsOf(root), label: `${variantsOf(root)} (cached clone)` };
  }
  if (!present) {
    fs.mkdirSync(path.dirname(root), { recursive: true });
    const temp = fs.mkdtempSync(`${root}.incoming-`);
    try {
      let result = runGit(["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--no-tags", SHELF_GIT, temp], ctx.env);
      if (result.status !== 0 || result.error) throw gitFailure("clone", result);
      result = runGit(["-C", temp, "sparse-checkout", "set", SPARSE_PATH], ctx.env);
      if (result.status !== 0 || result.error) throw gitFailure("clone", result);
      if (!variantsOf(temp)) throw fail(`LitHermes extensions: the shelf clone has no variants/${VARIANT}/ folder. Nothing was installed.`, 3);
      fs.renameSync(temp, root);
    } catch (error) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw error;
    }
    return { kind: "cache", root, variants: variantsOf(root), fetched: true, label: `${variantsOf(root)} (fetched from ${SHELF_GIT})` };
  }
  if (refresh) {
    let result = runGit(["-C", root, "fetch", "--depth", "1", "--no-tags", "origin"], ctx.env);
    if (result.status !== 0 || result.error) throw gitFailure("fetch", result);
    result = runGit(["-C", root, "reset", "--hard", "--quiet", "FETCH_HEAD"], ctx.env);
    if (result.status !== 0 || result.error) throw gitFailure("fetch", result);
    return { kind: "cache", root, variants: variantsOf(root), label: `${variantsOf(root)} (refreshed from ${SHELF_GIT})` };
  }
  return { kind: "cache", root, variants: variantsOf(root), label: `${variantsOf(root)} (cached clone)` };
}

function sourceCommit(root, env) {
  const result = runGit(["-C", root, "rev-parse", "--short", "HEAD"], env);
  const commit = String(result.stdout || "").trim();
  return result.status === 0 && /^[0-9a-f]{4,40}$/.test(commit) ? commit : null;
}

// A source folder with a link in it could copy files from outside the clone; refuse it.
function assertPlainTree(dir) {
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw fail(`LitHermes extensions: ${full} is a symbolic link; the source must be plain files. Nothing was changed.`, 5);
      if (entry.isDirectory()) walk(full);
      else if (!entry.isFile()) throw fail(`LitHermes extensions: ${full} is not a plain file. Nothing was changed.`, 5);
    }
  };
  walk(dir);
}

function copyPlainTree(src, dest) {
  fs.mkdirSync(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (UNHASHED(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyPlainTree(from, to);
    else {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    }
  }
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureBackupsRoot(home) {
  const root = backupsRoot(home);
  const stat = lstat(root);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw fail(`LitHermes extensions: ${root} is not a plain folder; nothing was changed.`, 5);
  if (!stat) fs.mkdirSync(root, { mode: 0o700 });
  return root;
}

function assertSkillsParent(home) {
  const skills = path.join(home, "skills");
  const stat = lstat(skills);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw fail(`LitHermes extensions: ${skills} is a symbolic link or not a folder; the extension verbs will not write through it. Nothing was changed.`, 5);
  return skills;
}

// Move skills/<id>/ whole into a new, unique extension-backups/<date-time>-XXXXXX/ folder.
function moveAside(home, dest) {
  const folder = fs.mkdtempSync(path.join(ensureBackupsRoot(home), `${stamp()}-`));
  const target = path.join(folder, path.basename(dest));
  fs.renameSync(dest, target);
  return target;
}

function resolveIds(flags, positionals, verb) {
  const ids = [];
  if (flags.all) ids.push(...EXTENSION_IDS);
  if (typeof flags.family === "string") {
    const members = EXTENSION_IDS.filter((id) => EXTENSION_FAMILIES[id] === flags.family);
    if (!members.length) throw fail(`lithermes extensions ${verb}: unknown family '${flags.family}' (families: ${[...new Set(Object.values(EXTENSION_FAMILIES))].join(", ")}).`, 2);
    ids.push(...members);
  }
  for (const id of positionals) {
    if (!EXTENSION_IDS.includes(id)) throw fail(`lithermes extensions ${verb}: unknown extension '${id}' (extensions: ${EXTENSION_IDS.join(", ")}).`, 2);
    ids.push(id);
  }
  return [...new Set(ids)];
}

function blockers(record, flags) {
  const out = [];
  if (record.state === "linked") out.push(`${record.dest} is a symbolic link; move it away by hand`);
  if (record.state === "not-a-folder") out.push(`${record.dest} is not a folder; move it away by hand`);
  for (const copy of record.competing) {
    if (copy.sameFolder) out.push(`another skill named ${record.id} is at ${copy.path}; it ${copy.effect}. Move it out of skills/ first (into extension-backups/, for example)`);
    else if (!flags["allow-shadow"]) out.push(`another skill named ${record.id} is at ${copy.path} (${copy.where}); it ${copy.effect}. Move it out, or add --allow-shadow to install anyway`);
  }
  return out;
}

function shadowWarnings(record, flags) {
  return flags["allow-shadow"]
    ? record.competing.filter((copy) => !copy.sameFolder).map((copy) => `${record.id}: warning: ${copy.path} (${copy.where}) ${copy.effect}`)
    : [];
}

function receiptFor(id, sourceDir, hash, commit) {
  return {
    id,
    source: sourceDir,
    variant: VARIANT,
    installed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    family: EXTENSION_FAMILIES[id],
    hash,
    ...(commit ? { commit } : {}),
    installed_by: "lithermes extensions",
  };
}

// Stage the new copy outside skills/, then move the old folder aside, then move the copy in: a
// failure at any step leaves either the old folder or the new one in place, never half of one.
function placeExtension(ctx, id, sourceDir, commit) {
  const dest = path.join(assertSkillsParent(ctx.home), id);
  const staging = fs.mkdtempSync(path.join(ensureBackupsRoot(ctx.home), ".incoming-"));
  const staged = path.join(staging, id);
  let movedTo = null;
  try {
    copyPlainTree(sourceDir, staged);
    const hash = hashTree(staged);
    fs.writeFileSync(path.join(staged, RECEIPT), `${JSON.stringify(receiptFor(id, sourceDir, hash, commit))}\n`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (lstat(dest)) movedTo = moveAside(ctx.home, dest);
    if (lstat(dest)) throw fail(`LitHermes extensions: ${dest} is still there after the move; stopped.`, 5);
    fs.renameSync(staged, dest);
    return { dest, movedTo, hash };
  } catch (error) {
    if (movedTo && !lstat(dest)) {
      try {
        fs.renameSync(movedTo, dest);
        movedTo = null;
      } catch {
        // The old copy stays in its backup; the message below names it.
      }
    }
    if (movedTo) error.message += `\nThe old copy is in ${movedTo}.`;
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function dryRunHead(verb, flags) {
  return flags.yes && !flags["dry-run"] ? null : `lithermes extensions ${verb}: dry run, nothing changes. Add --yes to do it.`;
}

function installOrUpdate(verb, flags, positionals, runtime) {
  const ctx = context(flags, runtime);
  const write = Boolean(flags.yes && !flags["dry-run"]);
  let ids = resolveIds(flags, positionals, verb);
  if (verb === "install" && !ids.length) throw fail("lithermes extensions install: name one or more extensions, --family <name> or --all.", 2);
  const records = new Map((verb === "update" && !ids.length ? EXTENSION_IDS : ids).map((id) => [id, inspectExtension(id, ctx.home, ctx.roots)]));
  if (verb === "update" && !ids.length) ids = [...records.values()].filter((record) => record.state === "installed").map((record) => record.id);
  const lines = [dryRunHead(verb, flags)].filter(Boolean);
  const refused = [];
  const work = [];
  for (const id of ids) {
    const record = records.get(id);
    if (verb === "update") {
      if (record.state === "absent") {
        lines.push(`${id}: not installed (${cliLine(flags, `install ${id} --yes`)} installs it)`);
        continue;
      }
      if (record.state !== "installed") {
        refused.push(`${id}: refused: ${record.dest} has no LitHermes receipt, so update leaves it alone. ${cliLine(flags, `install ${id} --yes`)} replaces it and keeps it in extension-backups/.`);
        continue;
      }
      if (record.modified) {
        refused.push(`${id}: refused: files in ${record.dest} changed since it was installed. ${cliLine(flags, `install ${id} --yes`)} replaces it and keeps your copy in extension-backups/.`);
        continue;
      }
    }
    const blocked = blockers(record, flags);
    if (blocked.length) refused.push(...blocked.map((reason) => `${id}: stopped: ${reason}.`));
    else work.push(record);
  }
  if (!ids.length) lines.push("No extension carries a LitHermes receipt yet; nothing to update.");
  if (refused.length) {
    lines.push(...refused, "Nothing was changed.");
    return { ok: false, message: lines.join("\n") };
  }
  if (!work.length) return { ok: true, message: lines.join("\n") };
  const source = resolveSource(flags, ctx, { refresh: verb === "update", write });
  lines.push(`source: ${source.label}`);
  // A dry run never fetches, so an update can only compare with the copy already in the cache.
  if (verb === "update" && !write && source.kind === "cache") {
    if (source.pending) {
      lines.push(`no cached copy yet; --yes fetches it first and compares ${work.map((record) => record.id).join(", ")} after the fetch.`);
      return { ok: true, message: lines.join("\n") };
    }
    lines.push("compared with the cached copy; --yes fetches first, so the result may differ.");
  }
  const plans = [];
  let skipped = 0;
  for (const record of work) {
    const sourceDir = path.join(source.variants, record.id);
    if (!source.pending) {
      const stat = lstat(sourceDir);
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || !lstat(path.join(sourceDir, "SKILL.md"))?.isFile()) {
        // An install names what it wants, so a missing folder stops it; an update keeps the copy it has.
        if (verb === "install") throw fail(`LitHermes extensions: ${sourceDir} is missing or holds no SKILL.md. Nothing was changed.`, 3);
        lines.push(`${record.id}: kept as it is: ${sourceDir} is missing or holds no SKILL.md`);
        skipped += 1;
        continue;
      }
      assertPlainTree(sourceDir);
      if (verb === "update" && hashTree(sourceDir) === (record.receipt.hash || hashTree(record.dest))) {
        // Same files from another place: only the receipt's source changes.
        if (record.receipt.source === sourceDir) lines.push(`${record.id}: current`);
        else if (!write) lines.push(`${record.id}: current (would record ${sourceDir} as its source)`);
        else {
          writeFileAtomic(path.join(record.dest, RECEIPT), `${JSON.stringify({ ...record.receipt, source: sourceDir })}\n`);
          lines.push(`${record.id}: current (source now ${sourceDir})`);
        }
        continue;
      }
    }
    plans.push({ record, sourceDir });
  }
  const commit = write && plans.length ? sourceCommit(source.root, ctx.env) : null;
  for (const { record, sourceDir } of plans) {
    lines.push(...shadowWarnings(record, flags));
    const exists = record.state !== "absent";
    if (!write) {
      lines.push(`${record.id}: would ${exists ? `move ${record.dest} aside into ${backupsRoot(ctx.home)}/<date-time>-XXXXXX/, then ` : ""}copy ${sourceDir} to ${record.dest} and write ${RECEIPT}`);
      continue;
    }
    const placed = placeExtension(ctx, record.id, sourceDir, commit);
    if (placed.movedTo) lines.push(`${record.id}: moved aside: ${placed.movedTo}`);
    lines.push(`${record.id}: ${verb === "update" ? "updated" : "copied"}: ${placed.dest} (receipt ${RECEIPT})`);
  }
  if (write && plans.length) lines.push("Start a new Hermes session (or restart the gateway) to load the change.");
  return { ok: skipped === 0, message: lines.join("\n") };
}

function removeExtensions(flags, positionals, runtime) {
  const ctx = context(flags, runtime);
  const write = Boolean(flags.yes && !flags["dry-run"]);
  const ids = resolveIds(flags, positionals, "remove");
  if (!ids.length) throw fail("lithermes extensions remove: name one or more extensions.", 2);
  const lines = [dryRunHead("remove", flags)].filter(Boolean);
  const records = ids.map((id) => inspectExtension(id, ctx.home, ctx.roots));
  const refused = records.filter((record) => record.state !== "installed" && record.state !== "absent");
  if (refused.length) {
    for (const record of refused) lines.push(`${record.id}: refused: ${record.dest} has no LitHermes receipt (${record.state}); remove only takes folders this command installed. Move it yourself if you mean to.`);
    lines.push("Nothing was changed.");
    return { ok: false, message: lines.join("\n") };
  }
  let moved = 0;
  for (const record of records) {
    if (record.state === "absent") {
      lines.push(`${record.id}: not installed`);
      continue;
    }
    if (!write) {
      lines.push(`${record.id}: would move ${record.dest} into ${backupsRoot(ctx.home)}/<date-time>-XXXXXX/ (nothing is deleted)`);
      continue;
    }
    assertSkillsParent(ctx.home);
    lines.push(`${record.id}: moved aside: ${moveAside(ctx.home, record.dest)}`);
    moved += 1;
  }
  if (moved) lines.push("Start a new Hermes session (or restart the gateway) to drop it from the skill list.");
  return { ok: true, message: lines.join("\n") };
}

function pruneBackups(flags, runtime) {
  const ctx = context(flags, runtime);
  const write = Boolean(flags.yes && !flags["dry-run"]);
  let days = null;
  if (flags["older-than"] !== undefined) {
    days = Number(flags["older-than"]);
    if (!Number.isFinite(days) || days < 0) throw fail(`lithermes extensions prune-backups: --older-than takes a number of days, not '${flags["older-than"]}'.`, 2);
  }
  const { root, folders, unsafe } = listBackups(ctx.home);
  if (unsafe) throw fail(`LitHermes extensions: ${root} is not a plain folder; nothing was changed.`, 5);
  const lines = [dryRunHead("prune-backups", flags)].filter(Boolean);
  if (!folders.length) return { ok: true, message: [...lines, `No backups in ${root}.`].join("\n") };
  const now = Date.now();
  const cutoff = days === null ? Infinity : now - days * 86400000;
  lines.push(`backups in ${root}:`);
  const chosen = [];
  for (const folder of folders) {
    const ageDays = Math.max(0, Math.floor((now - folder.time) / 86400000));
    const pick = !folder.skipped && folder.time <= cutoff;
    if (pick) chosen.push(folder);
    lines.push(`  ${folder.name}  ${folder.ids.join(", ") || "(empty)"}  ${formatBytes(folder.bytes)}  ${ageDays} ${ageDays === 1 ? "day" : "days"} old${folder.skipped ? `  (left alone: ${folder.skipped})` : pick ? "" : "  (kept: newer)"}`);
  }
  const total = chosen.reduce((sum, folder) => sum + folder.bytes, 0);
  if (!chosen.length) return { ok: true, message: [...lines, "Nothing matches; nothing to delete."].join("\n") };
  if (!write) return { ok: true, message: [...lines, `would delete ${chosen.length} ${chosen.length === 1 ? "folder" : "folders"}, ${formatBytes(total)}.`].join("\n") };
  const realRoot = fs.realpathSync(root);
  for (const folder of chosen) {
    // Only a plain folder directly inside this profile's extension-backups/ is ever deleted.
    const stat = lstat(folder.path);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || path.dirname(fs.realpathSync(folder.path)) !== realRoot) continue;
    fs.rmSync(folder.path, { recursive: true, force: true });
  }
  lines.push(`deleted ${chosen.length} ${chosen.length === 1 ? "folder" : "folders"}, ${formatBytes(total)}.`);
  return { ok: true, message: lines.join("\n") };
}

function validateVerbFlags(verb, flags) {
  const allowed = new Set([...VERB_FLAGS[verb], "hermes-home"]);
  const extra = Object.keys(flags).filter((key) => !allowed.has(key));
  if (extra.length) {
    throw fail(`lithermes extensions ${verb}: ${extra.map((key) => `--${key}`).join(", ")} ${extra.length === 1 ? "does" : "do"} not apply here (it takes ${[...allowed].map((key) => `--${key}`).join(", ")}).`, 2);
  }
}

function runExtensions(verb, ids, flags = {}, runtime = {}) {
  validateVerbFlags(verb, flags);
  if ((verb === "list" || verb === "check" || verb === "prune-backups") && ids.length) {
    throw fail(`lithermes extensions ${verb}: takes no extension names.`, 2);
  }
  if (verb === "list") {
    const result = listExtensions(flags, runtime);
    return { ok: true, message: flags.json ? JSON.stringify(result, null, 2) : formatList(result) };
  }
  if (verb === "check") {
    const result = checkExtensions(flags, runtime);
    return { ok: result.ok, message: flags.json ? JSON.stringify(result, null, 2) : formatCheck(result) };
  }
  if (verb === "install" || verb === "update") return installOrUpdate(verb, flags, ids, runtime);
  if (verb === "remove") return removeExtensions(flags, ids, runtime);
  return pruneBackups(flags, runtime);
}

module.exports = {
  EXTENSION_FAMILIES,
  RECEIPT,
  VERBS,
  VERB_FLAGS,
  cacheDir,
  checkExtensions,
  extensionsSummary,
  hashTree,
  inspectExtension,
  readReceipt,
  runExtensions,
  skillRoots,
};
