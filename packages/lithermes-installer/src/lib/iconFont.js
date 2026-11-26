const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { sha256, writeFileAtomic } = require("./files");

// `install --round`: the symbols-only Nerd Font, for the round ends of pills and gauges, in the user's
// own font folder. It is added only where no icon font is found, it never replaces or follows anything
// that stands at its place, and <home>/lithermes/icon-font.json names what an uninstall may take away.
const PINS = Object.freeze({
  family: "Symbols Nerd Font Mono",
  url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip",
  archiveSha256: "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc",
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 60_000,
  files: Object.freeze([
    { entry: "SymbolsNerdFontMono-Regular.ttf", name: "SymbolsNerdFontMono-Regular.ttf", sha256: "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749" },
    { entry: "LICENSE", name: "SymbolsNerdFontMono-LICENSE.txt", sha256: "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847" },
  ]),
});
const SOURCE_ENV = "LITHERMES_ICON_FONT_SOURCE";
const OWN_NAMES = new Set(PINS.files.map(({ name }) => name));
const FILE_LIMIT = 4 * PINS.maxBytes; // one unpacked file; the archive's own cap bounds the download
const PRESENT = "icon font: one is already here, so nothing was added";
const WINDOWS = "icon font: not added on Windows; Windows Terminal and VS Code draw the ends themselves";

const lstat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const manifestFile = (home) => path.join(home, "lithermes", "icon-font.json");
const plural = (count) => `${count} file${count === 1 ? "" : "s"}`;

function fontFolder(env = process.env, platform = process.platform) {
  if (platform === "win32") return null;
  const user = env.HOME || os.homedir();
  return platform === "darwin"
    ? path.join(user, "Library", "Fonts")
    : path.join(path.isAbsolute(env.XDG_DATA_HOME || "") ? env.XDG_DATA_HOME : path.join(user, ".local", "share"), "fonts");
}

// The named entries of a zip, read through its central directory.
function unzip(archive, wanted) {
  const refuse = () => { throw new Error("the archive is not a readable zip"); };
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) refuse();
  const found = new Map();
  try {
    let at = archive.readUInt32LE(end + 16);
    for (let left = archive.readUInt16LE(end + 10); left > 0; left -= 1) {
      if (archive.readUInt32LE(at) !== 0x02014b50) refuse();
      const nameLength = archive.readUInt16LE(at + 28);
      const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
      if (wanted.includes(name) && !found.has(name)) {
        const method = archive.readUInt16LE(at + 10);
        const size = archive.readUInt32LE(at + 20);
        const local = archive.readUInt32LE(at + 42);
        const from = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
        if (archive.readUInt32LE(local) !== 0x04034b50 || from + size > archive.length) refuse();
        const body = archive.subarray(from, from + size);
        if (method !== 0 && method !== 8) refuse();
        found.set(name, method === 0 ? body : zlib.inflateRawSync(body, { maxOutputLength: FILE_LIMIT }));
      }
      at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    }
  } catch {
    refuse();
  }
  for (const name of wanted) if (!found.has(name)) throw new Error(`the archive holds no ${name}`);
  return found;
}

const tooLarge = (pins) => new Error(`the archive is larger than ${pins.maxBytes} bytes`);

async function readArchive({ env, pins, fetchFn }) {
  const source = env[SOURCE_ENV];
  if (source) {
    if (fs.statSync(source).size > pins.maxBytes) throw tooLarge(pins);
    return fs.readFileSync(source);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("the download ran out of time")), pins.timeoutMs);
  try {
    const response = await fetchFn(pins.url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`the download answered ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > pins.maxBytes) throw tooLarge(pins);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function assertFolder(folder) {
  if (lstat(folder) && !lstat(folder).isDirectory()) throw new Error(`${folder} is not a regular folder`);
}

// A hard link is the claim: it fails where anything, a link included, already has the name.
function claim(folder, name, bytes) {
  const target = path.join(folder, name);
  const staged = path.join(folder, `.${name}.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
  try {
    fs.writeFileSync(staged, bytes, { flag: "wx", mode: 0o644 });
    fs.linkSync(staged, target);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (lstat(target)?.isFile() && digest(fs.readFileSync(target)) === digest(bytes)) return false;
    throw new Error(`${target} is there already and is another file`);
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

function readManifest(home) {
  const stat = lstat(manifestFile(home));
  if (!stat?.isFile() || stat.size > 65_536) return null;
  try {
    const { files } = JSON.parse(fs.readFileSync(manifestFile(home), "utf8"));
    return files.filter((file) => typeof file?.folder === "string" && path.isAbsolute(file.folder)
      && OWN_NAMES.has(file.name) && /^[0-9a-f]{64}$/.test(file.sha256));
  } catch {
    return null;
  }
}

function writeManifest(home, manifest) {
  const dir = path.dirname(manifestFile(home));
  fs.mkdirSync(dir, { recursive: true });
  assertFolder(dir);
  if (lstat(manifestFile(home)) && !lstat(manifestFile(home)).isFile()) throw new Error(`${manifestFile(home)} is not a regular file`);
  writeFileAtomic(manifestFile(home), `${JSON.stringify(manifest)}\n`, "utf8");
}

function refreshFontCache(folder, platform, spawn) {
  if (platform === "darwin" || platform === "win32") return;
  try {
    spawn("fc-cache", ["-f", folder], { stdio: "ignore", timeout: 30_000 });
  } catch {
    // Without fontconfig's tool the next start of a program reads the folder anyway.
  }
}

/** Adds the font. Never throws: `line` is what to say, `why` the reason when a wanted font is missing. */
async function addIconFont({ home, env = process.env, platform = process.platform, pins = PINS, hasIconFont, fetchFn = globalThis.fetch, spawn = spawnSync }) {
  const folder = fontFolder(env, platform);
  if (!folder) return { line: WINDOWS, why: null };
  if (hasIconFont(env)) return { line: PRESENT, why: null };
  const claimed = [];
  try {
    assertFolder(folder);
    const archive = await readArchive({ env, pins, fetchFn });
    if (digest(archive) !== pins.archiveSha256) throw new Error("the archive does not have the pinned SHA-256");
    const entries = unzip(archive, pins.files.map(({ entry }) => entry));
    for (const file of pins.files) {
      if (digest(entries.get(file.entry)) !== file.sha256) throw new Error(`${file.entry} does not have the pinned SHA-256`);
    }
    fs.mkdirSync(folder, { recursive: true });
    assertFolder(folder);
    for (const file of pins.files) {
      if (claim(folder, file.name, entries.get(file.entry))) claimed.push(file);
    }
    // The folder can change between installs; what an earlier one placed stays owned while it is there.
    const kept = (readManifest(home) || []).filter((file) => lstat(path.join(file.folder, file.name))
      && !(file.folder === folder && claimed.some(({ name }) => name === file.name)));
    writeManifest(home, { files: [...claimed.map(({ name, sha256: sum }) => ({ folder, name, sha256: sum })), ...kept] });
  } catch (error) {
    for (const { name } of claimed) fs.rmSync(path.join(folder, name), { force: true });
    const why = String(error?.message || error).replace(/\s+/g, " ");
    return { line: `icon font: not added (${why})`, why };
  }
  refreshFontCache(folder, platform, spawn);
  return { line: `icon font: added ${pins.files[0].name} (${pins.family}) and its licence to ${folder}`, why: null };
}

/** What `--round` would do, for a dry run: the file and the folder, with nothing read from the network. */
function planIconFont({ env = process.env, platform = process.platform, pins = PINS, hasIconFont }) {
  const folder = fontFolder(env, platform);
  if (!folder) return WINDOWS;
  if (hasIconFont(env)) return "icon font: one is already here, so nothing would be added";
  return `icon font: would add ${pins.files[0].name} and its licence to ${folder} (from ${env[SOURCE_ENV] || pins.url})`;
}

const owned = (manifest) => manifest.map(({ folder, name, sha256: sum }) => {
  const file = path.join(folder, name);
  return { file, folder, state: !lstat(file)?.isFile() ? "gone" : sha256(file) === sum ? "ours" : "changed" };
});
const count = (files, state) => files.filter((file) => file.state === state).length;
const foldersOf = (files) => [...new Set(files.map(({ folder }) => folder))];
const from = (files) => (files.length ? ` from ${foldersOf(files).join(" and ")}` : "");
const keptText = (changed) => (changed ? ` and kept ${changed} changed file${changed === 1 ? "" : "s"}` : "");

/** Uninstall: the recorded files whose bytes are still the recorded ones. Returns a line, or null. */
function removeIconFont(home, { platform = process.platform, spawn = spawnSync } = {}) {
  const manifest = readManifest(home);
  if (!manifest) return null;
  const files = owned(manifest);
  for (const { file, state } of files) if (state === "ours") fs.unlinkSync(file);
  fs.unlinkSync(manifestFile(home));
  const removed = count(files, "ours");
  for (const folder of foldersOf(files.filter(({ state }) => state === "ours"))) refreshFontCache(folder, platform, spawn);
  return `icon font: removed ${plural(removed)}${from(files)}${keptText(count(files, "changed"))}; other products may then draw square ends`;
}

function previewRemoval(home) {
  const manifest = readManifest(home);
  if (!manifest) return null;
  const files = owned(manifest);
  return `icon font: would remove ${plural(count(files, "ours"))}${from(files)}${keptText(count(files, "changed"))}; other products may then draw square ends`;
}

module.exports = { PINS, SOURCE_ENV, addIconFont, fontFolder, manifestFile, planIconFont, previewRemoval, removeIconFont };
