const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { widgetSource } = require("../src/lib/tuiCard");
const { PINS, addIconFont, fontFolder, manifestFile, planIconFont, previewRemoval, removeIconFont } = require("../src/lib/iconFont");

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const TTF = "SymbolsNerdFontMono-Regular.ttf";
const LICENCE = "SymbolsNerdFontMono-LICENSE.txt";

// A small archive in the published one's shape: a deflated font and a stored licence.
function zip(entries) {
  const locals = [];
  const central = [];
  let at = 0;
  for (const { name, data, method = 8, size = data.length } of entries) {
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const label = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(label.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(label.length, 28);
    entry.writeUInt32LE(at, 42);
    locals.push(local, label, body);
    central.push(entry, label);
    at += 30 + label.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, directory, end]);
}
const FONT = Buffer.from("a small stand-in font ".repeat(40));
const TEXT = Buffer.from("the licence\n");
const ARCHIVE = zip([{ name: "README.md", data: Buffer.from("read me") }, { name: TTF, data: FONT }, { name: "LICENSE", data: TEXT, method: 0 }]);
const pinsFor = (archive) => ({
  ...PINS, archiveSha256: sha(archive),
  files: [{ entry: TTF, name: TTF, sha256: sha(FONT) }, { entry: "LICENSE", name: LICENCE, sha256: sha(TEXT) }],
});

function place(t, archive = ARCHIVE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-icon-font."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "hermes");
  fs.mkdirSync(home);
  const source = path.join(root, "font.zip");
  fs.writeFileSync(source, archive);
  const spawned = [];
  const env = { HOME: root, XDG_DATA_HOME: path.join(root, "data"), LITHERMES_ICON_FONT_SOURCE: source };
  const options = {
    home, env, platform: "linux", pins: pinsFor(archive), hasIconFont: () => false,
    spawn: (...args) => { spawned.push(args); return { status: 0 }; },
    fetchFn: () => { throw new Error("a test never downloads"); },
  };
  return { root, home, source, spawned, options, folder: path.join(root, "data", "fonts") };
}

test("the pins are the published symbols-only font", () => {
  assert.equal(PINS.url, "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip");
  assert.equal(PINS.archiveSha256, "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc");
  assert.deepEqual(PINS.files.map(({ name, sha256 }) => [name, sha256]), [
    [TTF, "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749"],
    [LICENCE, "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847"],
  ]);
  assert.equal(PINS.maxBytes, 8 * 1024 * 1024);
  assert.equal(PINS.timeoutMs, 60_000);
});

test("the folder is the user's own one per system, and Windows has none", () => {
  assert.equal(fontFolder({ HOME: "/h" }, "darwin"), path.join("/h", "Library", "Fonts"));
  assert.equal(fontFolder({ HOME: "/h" }, "linux"), path.join("/h", ".local", "share", "fonts"));
  assert.equal(fontFolder({ HOME: "/h", XDG_DATA_HOME: "/d" }, "linux"), path.join("/d", "fonts"));
  assert.equal(fontFolder({ HOME: "/h", XDG_DATA_HOME: "data" }, "linux"), path.join("/h", ".local", "share", "fonts"), "a relative XDG folder counts as unset");
  assert.equal(fontFolder({ HOME: "/h" }, "win32"), null);
});

test("the font and its licence arrive, the manifest owns them, and uninstall takes them away", async (t) => {
  const { home, folder, options, spawned } = place(t);
  const added = await addIconFont(options);
  assert.equal(added.why, null);
  assert.match(added.line, /icon font: added SymbolsNerdFontMono-Regular\.ttf .*fonts/);
  assert.deepEqual(fs.readdirSync(folder).sort(), [LICENCE, TTF]);
  assert.deepEqual(fs.readFileSync(path.join(folder, TTF)), FONT);
  assert.deepEqual(spawned.map(([tool]) => tool), ["fc-cache"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile(home), "utf8")).files.map(({ name }) => name), [TTF, LICENCE]);
  assert.match(previewRemoval(home), /would remove 2 files/);
  assert.equal(fs.readdirSync(folder).length, 2);
  const removed = removeIconFont(home, options);
  assert.match(removed, /removed 2 files .*other products .*square ends/);
  assert.deepEqual(fs.readdirSync(folder), []);
  assert.equal(fs.existsSync(manifestFile(home)), false);
  assert.equal(removeIconFont(home, options), null, "nothing owned, nothing said");
});

test("with a relative XDG folder the font is found again and uninstall takes it away", async (t) => {
  const { hasIconFont } = await import(pathToFileURL(widgetSource).href);
  const { root, home, options } = place(t);
  const env = { ...options.env, XDG_DATA_HOME: "data" };
  const folder = path.join(root, ".local", "share", "fonts");
  assert.equal((await addIconFont({ ...options, env })).why, null);
  assert.deepEqual(fs.readdirSync(folder).sort(), [LICENCE, TTF]);
  assert.equal(hasIconFont(env, "linux"), true);
  assert.match(removeIconFont(home, options), /removed 2 files/);
  assert.deepEqual(fs.readdirSync(folder), []);
});

test("a changed font folder keeps the earlier files owned", async (t) => {
  const { root, home, folder, options } = place(t);
  await addIconFont(options);
  const other = path.join(root, "other", "fonts");
  const moved = { ...options, env: { ...options.env, XDG_DATA_HOME: path.join(root, "other") } };
  assert.equal((await addIconFont(moved)).why, null);
  assert.match(previewRemoval(home), /would remove 4 files/);
  fs.rmSync(other, { recursive: true });
  assert.equal((await addIconFont(moved)).why, null, "placed again");
  const removed = removeIconFont(home, options);
  assert.match(removed, /removed 4 files/);
  for (const dir of [folder, other]) {
    assert.ok(removed.includes(dir), dir);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});

test("an icon font that is already here means nothing is added", async (t) => {
  const { home, folder, options } = place(t);
  const result = await addIconFont({ ...options, hasIconFont: () => true });
  assert.match(result.line, /already here, so nothing was added/);
  assert.equal(fs.existsSync(folder), false);
  assert.equal(fs.existsSync(manifestFile(home)), false);
});

test("a file that stands there is never overwritten, and a half-placed font is taken back", async (t) => {
  const mine = place(t);
  fs.mkdirSync(mine.folder, { recursive: true });
  fs.writeFileSync(path.join(mine.folder, LICENCE), "mine");
  const kept = await addIconFont(mine.options);
  assert.match(kept.why, /SymbolsNerdFontMono-LICENSE\.txt/);
  assert.match(kept.line, /not added/);
  assert.deepEqual(fs.readdirSync(mine.folder), [LICENCE]);
  assert.equal(fs.readFileSync(path.join(mine.folder, LICENCE), "utf8"), "mine");
  assert.equal(fs.existsSync(manifestFile(mine.home)), false);

  const link = place(t);
  fs.mkdirSync(link.folder, { recursive: true });
  const target = path.join(link.root, "elsewhere.ttf");
  fs.symlinkSync(target, path.join(link.folder, TTF));
  assert.match((await addIconFont(link.options)).why, /SymbolsNerdFontMono-Regular\.ttf/);
  assert.equal(fs.existsSync(target), false, "nothing is written through a link");

  const folder = place(t);
  const outside = path.join(folder.root, "outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.dirname(folder.folder), { recursive: true });
  fs.symlinkSync(outside, folder.folder);
  assert.match((await addIconFont(folder.options)).why, /not a regular folder/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("the same licence bytes stay another owner's", async (t) => {
  const { folder, options, home } = place(t);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, LICENCE), TEXT);
  assert.equal((await addIconFont(options)).why, null);
  assert.match(removeIconFont(home, options), /removed 1 file /);
  assert.deepEqual(fs.readdirSync(folder), [LICENCE]);
});

test("uninstall keeps a file whose bytes are not the recorded ones", async (t) => {
  const { folder, options, home } = place(t);
  await addIconFont(options);
  fs.appendFileSync(path.join(folder, TTF), "edited");
  assert.match(removeIconFont(home, options), /removed 1 file .*kept 1 changed file/);
  assert.deepEqual(fs.readdirSync(folder), [TTF]);
});

test("a manifest that names other files owns nothing", (t) => {
  const { root, home, options } = place(t);
  const victim = path.join(root, "notes.txt");
  fs.writeFileSync(victim, "keep");
  fs.mkdirSync(path.dirname(manifestFile(home)), { recursive: true });
  fs.writeFileSync(manifestFile(home), JSON.stringify({ folder: root, files: [{ name: "notes.txt", sha256: sha(Buffer.from("keep")) }, { name: "../x", sha256: "0" }] }));
  removeIconFont(home, options);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("a wrong, broken, oversized or missing archive adds nothing and says why", async (t) => {
  const other = zip([{ name: "README.md", data: Buffer.from("x") }]);
  const cases = {
    "another archive": [place(t, ARCHIVE), (o) => ({ ...o, pins: PINS }), /SHA-256/],
    "no such entry": [place(t, other), (o) => o, /holds no/],
    "not an archive": [place(t, Buffer.from("plain text ".repeat(9))), (o) => o, /archive/],
    "other font bytes": [place(t, ARCHIVE), (o) => ({ ...o, pins: { ...o.pins, files: [{ ...o.pins.files[0], sha256: "0".repeat(64) }, o.pins.files[1]] } }), /SHA-256/],
    "too large": [place(t, ARCHIVE), (o) => ({ ...o, pins: { ...o.pins, maxBytes: 10 } }), /larger/],
    "no archive file": [place(t, ARCHIVE), (o) => ({ ...o, env: { ...o.env, LITHERMES_ICON_FONT_SOURCE: "/nonexistent/font.zip" } }), /ENOENT/],
  };
  for (const [name, [box, change, why]] of Object.entries(cases)) {
    const result = await addIconFont(change(box.options));
    assert.match(result.why, why, name);
    assert.match(result.line, /icon font: not added/, name);
    assert.equal(fs.existsSync(path.join(box.folder, TTF)), false, name);
    assert.deepEqual(fs.existsSync(box.folder) ? fs.readdirSync(box.folder) : [], [], `${name}: no staging file is left`);
  }
});

test("the download has a size cap and a time limit, and follows the pinned address only", async (t) => {
  const { options, folder } = place(t);
  const { LITHERMES_ICON_FONT_SOURCE: _, ...env } = options.env;
  const asked = [];
  const body = (chunks) => ({ ok: true, status: 200, headers: new Map(), body: (async function* () { yield* chunks; })() });
  const good = await addIconFont({ ...options, env, fetchFn: async (url, init) => { asked.push([url, init.signal instanceof AbortSignal]); return body([ARCHIVE.subarray(0, 50), ARCHIVE.subarray(50)]); } });
  assert.equal(good.why, null);
  assert.deepEqual(asked, [[PINS.url, true]]);
  assert.ok(fs.existsSync(path.join(folder, TTF)));
  let pulled = 0;
  const endless = { ok: true, status: 200, headers: new Map(), body: (async function* () { for (;;) { pulled += 1; yield Buffer.alloc(1024 * 1024); } })() };
  const big = place(t);
  assert.match((await addIconFont({ ...big.options, env, fetchFn: async () => endless })).why, /larger/);
  assert.ok(pulled <= 10, "the read stops at the cap");
  assert.match((await addIconFont({ ...big.options, env, fetchFn: async () => ({ ok: false, status: 503, headers: new Map() }) })).why, /503/);
  assert.match((await addIconFont({ ...big.options, env, fetchFn: async () => { throw new Error("offline here"); } })).why, /offline here/);
  const slow = { ...big.options, env, pins: { ...big.options.pins, timeoutMs: 20 }, fetchFn: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))) };
  assert.match((await addIconFont(slow)).why, /time/i);
});

test("a dry run names the file and the folder, and Windows gets no font", async (t) => {
  const { options, folder } = place(t);
  assert.match(planIconFont(options), new RegExp(`would add ${TTF.replace(/\./g, "\\.")} and its licence to ${folder}`));
  assert.match(planIconFont({ ...options, hasIconFont: () => true }), /already here/);
  assert.match(planIconFont({ ...options, platform: "win32" }), /Windows/);
  const windows = await addIconFont({ ...options, platform: "win32" });
  assert.match(windows.line, /Windows Terminal and VS Code draw the ends/);
  assert.equal(fs.existsSync(folder), false);
});
