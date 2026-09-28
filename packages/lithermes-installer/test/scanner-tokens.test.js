const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { gzipSync } = require("node:zlib");
const { capturePayloadManifest } = require("../src/lib/skillPayload");
const {
  scanFiles,
  scanPackArchive,
  scanPackArchiveDetailed,
  scanPackPaths,
  scanText,
  variants,
} = require("./scripts/scan-forbidden-tokens");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const canonicalRoot = path.join(
  packageRoot,
  "assets",
  "lithermes-plugin",
  "skills",
  "frontend-ui-ux",
  "references",
  "_canonical-corpus",
);

function copyManifestPayload(sourcePlugin, targetPlugin) {
  const manifestName = "payload-version.json";
  const manifest = JSON.parse(fs.readFileSync(path.join(sourcePlugin, manifestName), "utf8"));
  fs.mkdirSync(targetPlugin, { recursive: true });
  fs.copyFileSync(path.join(sourcePlugin, manifestName), path.join(targetPlugin, manifestName));
  for (const entry of manifest.files) {
    const relativeParts = entry.path.split("/");
    const target = path.join(targetPlugin, ...relativeParts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourcePlugin, ...relativeParts), target);
  }
}

function tarBytes(entries) {
  const blocks = [];
  const octal = (buffer, offset, length, value) => {
    buffer.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
    buffer[offset + length - 1] = 0;
  };
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body || "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    octal(header, 100, 8, entry.mode || 0o644);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, body.length);
    octal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(entry.type || "0", 156, 1, "ascii");
    if (entry.link) header.write(entry.link, 157, 100, "utf8");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header, body);
    if (body.length % 512) blocks.push(Buffer.alloc(512 - (body.length % 512)));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeTar(file, entries) {
  fs.writeFileSync(file, tarBytes(entries));
}

// Seeds are built from char codes so THIS test file carries no literal vendor
// token and stays clean under the "tracked files are clean" scan.
const seed = (...codes) => String.fromCharCode(...codes);

// The reference-origin token family the hardened scanner must block.
const VENDOR_TOKENS = {
  marketing: seed(108, 97, 122, 121, 99, 111, 100, 101, 120), // pre-existing marketing token
  vendor: seed(99, 111, 100, 101, 120), // vendor name
  product: seed(111, 109, 111), // short product word (identifier-bounded)
  personaA: seed(109, 111, 109, 117, 115), // plan-review persona
  personaB: seed(109, 101, 116, 105, 115), // gap-analysis persona
  rulePersona: seed(104, 101, 112, 104, 97, 101, 115, 116, 117, 115), // bundled-rule persona
  shell: seed(115, 112, 97, 114, 107, 115, 104, 101, 108, 108), // vendor shell helper
  otherHarness: seed(111, 112, 101, 110, 99, 111, 100, 101), // sibling harness name
  retiredOwnBrand: seed(108, 97, 122, 121, 104, 101, 114, 109, 101, 115), // retired own brand (post-rebrand)
  crossSibling: seed(108, 97, 122, 121, 99, 108, 97, 117, 100, 101), // cross-product sibling brand
  retiredWorkflow: seed(117, 108, 116, 114, 97, 119, 111, 114, 107), // retired workflow word
  retiredGoal: seed(117, 108, 116, 114, 97, 103, 111, 97, 108), // retired goal word
  retiredAlias: seed(117, 108, 119), // retired bounded alias
  retiredMirror: seed(115, 111, 117, 114, 99, 101, 45, 114, 101, 102, 101, 114, 101, 110, 99, 101), // retired mirror marker
};

test("hardened scanner blocks the full vendor token family", () => {
  for (const [label, token] of Object.entries(VENDOR_TOKENS)) {
    assert.ok(
      scanText(token).length >= 1,
      `expected scanner to flag vendor token "${label}"`,
    );
  }
});

test("vendor tokens are caught in realistic surrounding context", () => {
  const dot = VENDOR_TOKENS.product; // ".<product>/state", "call_<product>_agent"
  assert.ok(scanText(`.${dot}/state`).length >= 1, "dot-prefixed product path");
  assert.ok(scanText(`call_${dot}_agent`).length >= 1, "underscore-bounded product");
  assert.ok(
    scanText(`${VENDOR_TOKENS.retiredMirror}-${dot}/foo`).length >= 1,
    "hyphen-bounded product in a path",
  );
  const hook = VENDOR_TOKENS.vendor; // "<vendor>-hook.ts", ".<vendor>-plugin"
  assert.ok(scanText(`${hook}-hook.ts`).length >= 1, "vendor-hook filename");
  assert.ok(scanText(`.${hook}-plugin`).length >= 1, "vendor-plugin dir");
  const alias = VENDOR_TOKENS.retiredAlias;
  assert.ok(scanText(`${alias}-plan`).length >= 1, "retired alias command suffix");
  assert.ok(scanText(`/${alias}`).length >= 1, "retired alias slash command");
  assert.ok(scanText(`deep/${VENDOR_TOKENS.retiredMirror}/payload`).length >= 1, "retired mirror path");
  // The retired own brand is blocked in its hyphen/underscore-split forms too
  // (sep:true) — the split forms are assembled from the seed at runtime so this
  // file carries no literal token.
  const own = VENDOR_TOKENS.retiredOwnBrand;
  const left = own.slice(0, 4);
  const right = own.slice(4);
  assert.ok(scanText(`${left}-${right}`).length >= 1, "retired own brand, hyphen-split");
  assert.ok(scanText(`${left}_${right}`).length >= 1, "retired own brand, underscore-split");
});

test("benign English substrings are NOT flagged (no false positives)", () => {
  const benign = "promote homogeneous common chromosome metronome economics";
  assert.equal(
    scanText(benign).length,
    0,
    `benign text must not match: ${scanText(benign).join(", ")}`,
  );
});

test("scanner variant/needle set grows and the scanner source stays self-clean", () => {
  assert.ok(variants().length >= 20, "expected a wider blocked set");
  const source = fs.readFileSync(
    path.join(__dirname, "scripts", "scan-forbidden-tokens.js"),
    "utf8",
  );
  assert.equal(scanText(source).length, 0, "scanner source must carry no literal tokens");
});

test("external-term scanner reports opaque ids without raw terms, context, or path leaks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  try {
    fs.mkdirSync(path.join(root, `${rawTerm}-path`));
    fs.writeFileSync(path.join(root, `${rawTerm}-path`, "probe.txt"), `do not leak ${rawTerm}\n`);
    fs.writeFileSync(termsPath, JSON.stringify({
      version: 1,
      terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
    }));

    const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
    const text = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath], {
      encoding: "utf8",
    });
    assert.equal(text.status, 1);
    assert.match(text.stderr, /\[term-a\]/);
    assert.equal(text.stderr.includes(rawTerm), false);
    assert.equal(text.stderr.includes("probe.txt"), false);

    const json = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath, "--json"], {
      encoding: "utf8",
    });
    assert.equal(json.status, 1);
    assert.equal(json.stdout.includes(rawTerm), false);
    const report = JSON.parse(json.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.hits[0].termId, "term-a");
    assert.match(report.hits[0].fileId, /^file:\d+$/);
    assert.equal("path" in report.hits[0], false);
    assert.equal("where" in report.hits[0], false);
    assert.equal("token" in report.hits[0], false);
    assert.equal(json.stdout.includes("probe.txt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  }
});

test("external-term scanner rejects non-opaque ids and missing CLI values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  try {
    fs.writeFileSync(termsPath, JSON.stringify({
      version: 1,
      terms: [{ id: rawTerm, value: rawTerm, matchMode: "substring" }],
    }));
    const rawId = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath], {
      encoding: "utf8",
    });
    assert.equal(rawId.status, 2);
    assert.match(rawId.stderr, /external-term scanner error/i);
    assert.equal(rawId.stderr.includes(rawTerm), false);

    for (const args of [["--external-terms"], ["--root", "--external-terms", termsPath], ["--pack-json"], ["--pack-tar"], ["--text"]]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
      assert.equal(result.status, 2, `expected fail-closed parse for ${args.join(" ")}`);
      assert.match(result.stderr, /scanner argument error/i);
    }
    for (const args of [
      ["--pack-tarr", "fixture.tgz"],
      ["--root", root, "--external-terms", termsPath, "--unknown-external"],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
      assert.equal(result.status, 2, `unknown flag must fail: ${args.join(" ")}`);
      assert.match(result.stderr, /scanner argument error/i);
      assert.equal(result.stderr.includes(rawTerm), false);
      assert.equal(result.stderr.includes(root), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  }
});

test("external-term scanner redacts read errors from caller-supplied pack paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  const missingPackPath = path.join(termRoot, `${rawTerm}.json`);
  try {
    fs.writeFileSync(termsPath, JSON.stringify({
      version: 1,
      terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
    }));
    const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
    const result = spawnSync(process.execPath, [
      script,
      "--root", root,
      "--external-terms", termsPath,
      "--pack-json", missingPackPath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /external-term scanner error/i);
    assert.equal(result.stderr.includes(rawTerm), false);
    assert.equal(result.stderr.includes(missingPackPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  }
});

test("external-term scanner fails closed when a requested file is unreadable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  const unreadable = path.join(root, "unreadable.txt");
  t.after(() => {
    try { fs.chmodSync(unreadable, 0o600); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
  }));
  fs.writeFileSync(unreadable, "safe\n", { mode: 0o600 });
  fs.chmodSync(unreadable, 0o000);

  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const result = spawnSync(process.execPath, [
    script,
    "--root", root,
    "--external-terms", termsPath,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /external-term scanner error/i);
  assert.equal(result.stderr.includes(unreadable), false);
});

test("external-term scanner fails closed when a requested regular file exceeds the byte bound", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-oversized-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-oversized-terms-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
  }));
  fs.writeFileSync(path.join(root, "oversized.bin"), Buffer.alloc((4 * 1024 * 1024) + 1, 0x61));

  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const result = spawnSync(process.execPath, [
    script, "--root", root, "--external-terms", termsPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /external-term scanner error/i);
  assert.equal(result.stderr.includes(rawTerm), false);
  assert.equal(result.stderr.includes(root), false);
});

test("external-term scanner inspects safe regular-file bytes in a requested tarball", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  const archive = path.join(termRoot, "fixture.tgz");
  const packageDir = path.join(termRoot, "source", "package");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "README.md"), `packed ${rawTerm}\n`);
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
  }));
  const packed = spawnSync("tar", ["-czf", archive, "-C", path.dirname(packageDir), "package"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);

  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const result = spawnSync(process.execPath, [
    script,
    "--root", root,
    "--external-terms", termsPath,
    "--pack-tar", archive,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout.includes(rawTerm), false);
  const report = JSON.parse(result.stdout);
  assert.equal(report.hits.some((hit) => hit.termId === "term-a" && /^pack-tar:\d+$/.test(hit.fileId)), true);
});

test("ordinary tar scanning catches a built-in token after a NUL byte", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-nul-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const archive = path.join(temp, "fixture.tgz");
  writeTar(archive, [{
    name: "package/README.md",
    body: Buffer.concat([Buffer.from("prefix\0", "latin1"), Buffer.from(VENDOR_TOKENS.otherHarness, "ascii")]),
  }]);
  const hits = scanPackArchive(archive, path.resolve(packageRoot, "..", ".."));
  assert.ok(hits.some((hit) => hit.where.startsWith("pack-content:")), JSON.stringify(hits));
});

test("known packed binary requires exact identity and unknown binary fails closed", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-binary-policy-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const cover = fs.readFileSync(path.join(__dirname, "fixtures", "legacy-cover.png"));

  const exactArchive = path.join(temp, "exact.tgz");
  writeTar(exactArchive, [{ name: "package/cover.png", body: cover }]);
  assert.deepEqual(scanPackArchive(exactArchive, repoRoot, { requirePackageIdentity: false }), []);

  const motionStill = fs.readFileSync(path.join(packageRoot, "readme-assets", "cover-motion-still.webp"));
  const exactMotionArchive = path.join(temp, "exact-motion-still.tgz");
  writeTar(exactMotionArchive, [{ name: "package/readme-assets/cover-motion-still.webp", body: motionStill }]);
  assert.deepEqual(scanPackArchive(exactMotionArchive, repoRoot, { requirePackageIdentity: false }), []);

  const tamperedMotionStill = Buffer.from(motionStill);
  tamperedMotionStill[100] ^= 1;
  const tamperedMotionArchive = path.join(temp, "tampered-motion-still.tgz");
  writeTar(tamperedMotionArchive, [{ name: "package/readme-assets/cover-motion-still.webp", body: tamperedMotionStill }]);
  const tamperedMotionHits = scanPackArchive(tamperedMotionArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(tamperedMotionHits.some((hit) => hit.where === "pack-binary-byte-mismatch"), JSON.stringify(tamperedMotionHits));

  const ignitionFilm = fs.readFileSync(path.join(packageRoot, "readme-assets", "ignition-film.mp4"));
  const exactFilmArchive = path.join(temp, "exact-ignition-film.tgz");
  writeTar(exactFilmArchive, [{ name: "package/readme-assets/ignition-film.mp4", body: ignitionFilm }]);
  assert.deepEqual(scanPackArchive(exactFilmArchive, repoRoot, { requirePackageIdentity: false }), []);
  const tamperedFilm = Buffer.from(ignitionFilm);
  tamperedFilm[100] ^= 1;
  const tamperedFilmArchive = path.join(temp, "tampered-ignition-film.tgz");
  writeTar(tamperedFilmArchive, [{ name: "package/readme-assets/ignition-film.mp4", body: tamperedFilm }]);
  const tamperedFilmHits = scanPackArchive(tamperedFilmArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(tamperedFilmHits.some((hit) => hit.where === "pack-binary-byte-mismatch"), JSON.stringify(tamperedFilmHits));

  const tampered = Buffer.from(cover);
  tampered[100] ^= 1;
  const tamperedArchive = path.join(temp, "tampered.tgz");
  writeTar(tamperedArchive, [{ name: "package/cover.png", body: tampered }]);
  const tamperedHits = scanPackArchive(tamperedArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(tamperedHits.some((hit) => hit.where === "pack-binary-byte-mismatch"), JSON.stringify(tamperedHits));

  const unknownArchive = path.join(temp, "unknown.tgz");
  writeTar(unknownArchive, [{ name: "package/unknown.bin", body: Buffer.from([1, 0, 2, 3]) }]);
  const unknownHits = scanPackArchive(unknownArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(unknownHits.some((hit) => hit.where === "pack-binary-unrecognized"), JSON.stringify(unknownHits));

  for (const [archive, hits] of [[tamperedArchive, tamperedHits], [unknownArchive, unknownHits]]) {
    assert.equal(JSON.stringify(hits).includes(archive), false);
  }
});

test("ordinary packed members reject non-NUL controls but accept and scan credible UTF-8 text", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-text-policy-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const controlArchive = path.join(temp, "control.tgz");
  writeTar(controlArchive, [{
    name: "package/unknown.bin",
    body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
  }]);
  const controlHits = scanPackArchive(controlArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(controlHits.some((hit) => hit.where === "pack-binary-unrecognized"), JSON.stringify(controlHits));

  const textArchive = path.join(temp, "text.tgz");
  writeTar(textArchive, [{
    name: "package/notes.txt",
    body: Buffer.from("일반 UTF-8 텍스트\t허용\r\n", "utf8"),
  }]);
  assert.deepEqual(scanPackArchive(textArchive, repoRoot, { requirePackageIdentity: false }), []);

  const scannedArchive = path.join(temp, "scanned-text.tgz");
  writeTar(scannedArchive, [{
    name: "package/notes.txt",
    body: Buffer.from(`일반 UTF-8 ${VENDOR_TOKENS.otherHarness}\n`, "utf8"),
  }]);
  const scannedHits = scanPackArchive(scannedArchive, path.resolve(packageRoot, "..", ".."));
  assert.ok(scannedHits.some((hit) => hit.where.startsWith("pack-content:")), JSON.stringify(scannedHits));
});

test("external file scanning catches ASCII and UTF-8 terms after NUL and UTF-8 text", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-byte-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-byte-terms-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  const asciiTerm = ["fixture", "secret"].join("-");
  const utf8Term = "검증용어";
  const termsPath = path.join(termRoot, "terms.json");
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [
      { id: "term-ascii", value: asciiTerm, matchMode: "substring" },
      { id: "term-utf8", value: utf8Term, matchMode: "substring" },
    ],
  }));
  fs.writeFileSync(path.join(root, "nul-ascii.bin"), Buffer.concat([Buffer.from([0]), Buffer.from(asciiTerm)]));
  fs.writeFileSync(path.join(root, "nul-utf8.bin"), Buffer.concat([Buffer.from([0]), Buffer.from(utf8Term, "utf8")]));
  fs.writeFileSync(path.join(root, "utf8.txt"), `plain ${utf8Term}\n`);

  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const result = spawnSync(process.execPath, [
    script, "--root", root, "--external-terms", termsPath, "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.hits.some((hit) => hit.termId === "term-ascii"), true);
  assert.equal(report.hits.filter((hit) => hit.termId === "term-utf8").length >= 2, true);
  assert.equal(result.stdout.includes(asciiTerm), false);
  assert.equal(result.stdout.includes(utf8Term), false);
  assert.equal(result.stdout.includes(root), false);
});

test("external tar scanning catches ASCII and UTF-8 terms after NUL", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-tar-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-tar-terms-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  const asciiTerm = ["fixture", "secret"].join("-");
  const utf8Term = "검증용어";
  const termsPath = path.join(termRoot, "terms.json");
  const archive = path.join(termRoot, "fixture.tgz");
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [
      { id: "term-ascii", value: asciiTerm, matchMode: "substring" },
      { id: "term-utf8", value: utf8Term, matchMode: "substring" },
    ],
  }));
  writeTar(archive, [
    { name: "package/ascii.bin", body: Buffer.concat([Buffer.from([0]), Buffer.from(asciiTerm)]) },
    { name: "package/utf8.bin", body: Buffer.concat([Buffer.from([0]), Buffer.from(utf8Term, "utf8")]) },
  ]);

  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const result = spawnSync(process.execPath, [
    script, "--root", root, "--external-terms", termsPath, "--pack-tar", archive, "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.hits.some((hit) => hit.termId === "term-ascii"), true);
  assert.equal(report.hits.some((hit) => hit.termId === "term-utf8"), true);
  assert.equal(result.stdout.includes(asciiTerm), false);
  assert.equal(result.stdout.includes(utf8Term), false);
  assert.equal(result.stdout.includes(archive), false);
});

test("unsafe, special, duplicate, and oversized tar members fail closed with redacted external diagnostics", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-archive-safety-root-"));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-archive-safety-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(temp, "terms.json");
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
  }));
  const cases = [
    ["unsafe", [{ name: "package/../escape.txt", body: "safe" }], "pack-tar-unsafe-member"],
    ["special", [{ name: "package/link", type: "2", link: "README.md" }], "pack-tar-unsafe-member"],
    ["duplicate", [
      { name: "package/README.md", body: "first" },
      { name: "package/README.md", body: "second" },
    ], "pack-tar-duplicate-path"],
    ["oversized", [{ name: "package/large.bin", body: Buffer.alloc((4 * 1024 * 1024) + 1, 0x61) }], "pack-tar-member-unreadable"],
  ];
  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  for (const [label, entries, expected] of cases) {
    const archive = path.join(temp, `${label}.tgz`);
    writeTar(archive, entries);
    const hits = scanPackArchive(archive, path.resolve(packageRoot, "..", ".."));
    assert.ok(hits.some((hit) => hit.where === expected), `${label}: ${JSON.stringify(hits)}`);
    assert.equal(JSON.stringify(hits).includes(archive), false);

    const external = spawnSync(process.execPath, [
      script, "--root", root, "--external-terms", termsPath, "--pack-tar", archive,
    ], { encoding: "utf8" });
    assert.equal(external.status, 2, `${label}: ${external.stdout}${external.stderr}`);
    assert.match(external.stderr, /external-term scanner error/i);
    assert.equal(external.stderr.includes(rawTerm), false);
    assert.equal(external.stderr.includes(archive), false);
  }
});

test("packed payload manifest bytes must equal the verified source capture", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-payload-pack-mismatch-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const archive = path.join(temp, "payload-mismatch.tgz");
  const source = fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "payload-version.json"));
  writeTar(archive, [{
    name: "package/assets/lithermes-plugin/payload-version.json",
    body: Buffer.concat([source, Buffer.from("\n")]),
  }]);
  const hits = scanPackArchive(archive, path.resolve(packageRoot, "..", ".."));
  assert.ok(hits.some((hit) => hit.where === "payload-pack-byte-mismatch"), JSON.stringify(hits));
  assert.equal(JSON.stringify(hits).includes(archive), false);
});

test("packed payload inventory rejects harmless core.py substitution and removal", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-payload-inventory-pack-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
  const manifest = fs.readFileSync(path.join(pluginRoot, "payload-version.json"));

  const substituted = path.join(temp, "substituted.tgz");
  writeTar(substituted, [
    { name: "package/assets/lithermes-plugin/payload-version.json", body: manifest },
    { name: "package/assets/lithermes-plugin/core.py", body: "# harmless replacement\n" },
  ]);
  const substitutedHits = scanPackArchive(substituted, repoRoot, { requirePackageIdentity: false });
  assert.ok(
    substitutedHits.some((hit) => hit.path.endsWith("core.py") && hit.where === "payload-pack-byte-mismatch"),
    JSON.stringify(substitutedHits),
  );

  const removed = path.join(temp, "removed.tgz");
  writeTar(removed, [
    { name: "package/assets/lithermes-plugin/payload-version.json", body: manifest },
  ]);
  const removedHits = scanPackArchive(removed, repoRoot, { requirePackageIdentity: false });
  assert.ok(
    removedHits.some((hit) => hit.path.endsWith("core.py") && hit.where === "payload-pack-missing"),
    JSON.stringify(removedHits),
  );
});

test("package archives require essential files and reject portable topology collisions", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-topology-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  for (const [label, entries] of [
    ["empty", []],
    ["safe-only", [{ name: "package/README.md", body: "safe\n" }]],
  ]) {
    const archive = path.join(temp, `${label}.tgz`);
    writeTar(archive, entries);
    const hits = scanPackArchive(archive, repoRoot);
    assert.ok(hits.some((hit) => hit.where === "pack-tar-essential-missing"), `${label}: ${JSON.stringify(hits)}`);
  }

  const cases = [
    ["case", [
      { name: "package/Foo", body: "one" },
      { name: "package/foo", body: "two" },
    ], "pack-tar-portable-collision"],
    ["implicit-directory-case", [
      { name: "package/Foo/a.txt", body: "one" },
      { name: "package/foo/b.txt", body: "two" },
    ], "pack-tar-portable-collision"],
    ["unicode", [
      { name: "package/caf\u00e9", body: "one" },
      { name: "package/cafe\u0301", body: "two" },
    ], "pack-tar-non-ascii-path"],
    ["file-directory", [
      { name: "package/node/", type: "5" },
      { name: "package/node", body: "file" },
    ], "pack-tar-file-directory-collision"],
    ["known-binary-case", [
      { name: "package/cover.png", body: fs.readFileSync(path.join(__dirname, "fixtures", "legacy-cover.png")) },
      { name: "package/Cover.png", body: "other" },
    ], "pack-tar-portable-collision"],
  ];
  for (const [label, entries, expected] of cases) {
    const archive = path.join(temp, `${label}.tgz`);
    writeTar(archive, entries);
    const hits = scanPackArchive(archive, repoRoot, { requirePackageIdentity: false });
    assert.ok(hits.some((hit) => hit.where === expected), `${label}: ${JSON.stringify(hits)}`);
  }
});

test("package archives reject every non-ASCII member path", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-non-ascii-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const [label, entries] of [
    ["sigma", [
      { name: "package/\u03c3.txt", body: "one" },
      { name: "package/\u03c2.txt", body: "two" },
    ]],
    ["sharp-s", [
      { name: "package/stra\u00dfe.txt", body: "one" },
      { name: "package/strasse.txt", body: "two" },
    ]],
  ]) {
    const archive = path.join(temp, `${label}.tgz`);
    writeTar(archive, entries);
    const hits = scanPackArchive(archive, repoRoot, { requirePackageIdentity: false });
    assert.ok(hits.some((hit) => hit.where === "pack-tar-non-ascii-path"), `${label}: ${JSON.stringify(hits)}`);
  }
});

test("pack capture scans a private safe snapshot and rejects equal-size in-capture mutation", (t) => {
  assert.equal(typeof scanPackArchiveDetailed, "function");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-capture-race-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const archive = path.join(temp, "source.tgz");
  const snapshot = path.join(temp, "validated.tgz");
  const safeBytes = tarBytes([{ name: "package/README.md", body: "safe bytes\n" }]);
  fs.writeFileSync(archive, safeBytes);
  const initial = fs.statSync(archive);
  fs.utimesSync(archive, new Date(Math.floor(initial.atimeMs)), new Date(Math.floor(initial.mtimeMs)));
  const before = fs.statSync(archive);
  const originalWrite = fs.writeFileSync;
  let replacedAfterCapture = false;
  fs.writeFileSync = function replaceOriginalWhenSnapshotIsWritten(file, data, ...args) {
    if (!replacedAfterCapture && path.resolve(file) === path.resolve(snapshot)) {
      replacedAfterCapture = true;
      originalWrite.call(this, archive, Buffer.alloc(safeBytes.length, 0x41));
      fs.utimesSync(archive, before.atime, before.mtime);
    }
    return originalWrite.call(this, file, data, ...args);
  };
  let result;
  try {
    result = scanPackArchiveDetailed(archive, repoRoot, {
      requirePackageIdentity: false,
      snapshotOut: snapshot,
    });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  const after = fs.statSync(archive);
  assert.equal(replacedAfterCapture, true);
  assert.equal(after.size, before.size, "replacement must retain size");
  assert.equal(after.mtimeMs, before.mtimeMs, "replacement must retain mtime");
  assert.deepEqual(result.hits, [], JSON.stringify(result));
  assert.equal(result.sha256, crypto.createHash("sha256").update(safeBytes).digest("hex"));
  assert.deepEqual(fs.readFileSync(snapshot), safeBytes, "validated output must be captured safe bytes");
  assert.equal(JSON.stringify(result).includes(temp), false, "receipt must not leak source or snapshot paths");

  fs.rmSync(snapshot);
  fs.writeFileSync(archive, safeBytes);
  const captureInitial = fs.statSync(archive);
  fs.utimesSync(archive, new Date(Math.floor(captureInitial.atimeMs)), new Date(Math.floor(captureInitial.mtimeMs)));
  const captureBefore = fs.statSync(archive);
  const originalRead = fs.readSync;
  let mutatedDuringCapture = false;
  fs.readSync = function mutateAfterFirstRead(descriptor, buffer, offset, length, position) {
    const count = originalRead.call(this, descriptor, buffer, offset, length, position);
    if (!mutatedDuringCapture && count > 0) {
      mutatedDuringCapture = true;
      originalWrite.call(fs, archive, Buffer.alloc(safeBytes.length, 0x42));
      fs.utimesSync(archive, captureBefore.atime, captureBefore.mtime);
    }
    return count;
  };
  let rejected;
  try {
    rejected = scanPackArchiveDetailed(archive, repoRoot, { requirePackageIdentity: false });
  } finally {
    fs.readSync = originalRead;
  }
  assert.equal(mutatedDuringCapture, true);
  assert.ok(rejected.hits.some((hit) => hit.where === "pack-tar-capture-failed"), JSON.stringify(rejected));
});

test("pack scanning enforces compressed, member, aggregate, and deadline limits with small fixtures", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-limits-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const archive = path.join(temp, "limits.tgz");
  writeTar(archive, [
    { name: "package/a.txt", body: "1234" },
    { name: "package/b.txt", body: "5678" },
  ]);
  const cases = [
    [{ maxArchiveBytes: 1 }, "pack-tar-compressed-too-large"],
    [{ maxMembers: 1 }, "pack-tar-member-limit"],
    [{ maxTotalBytes: 7 }, "pack-tar-aggregate-too-large"],
    [{ deadlineMs: 0 }, "pack-tar-deadline"],
  ];
  for (const [limits, expected] of cases) {
    const hits = scanPackArchive(archive, repoRoot, { requirePackageIdentity: false, limits });
    assert.ok(hits.some((hit) => hit.where === expected), `${expected}: ${JSON.stringify(hits)}`);
  }
});

test("pack deadline scales with member count while a hung tar call still fails closed", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX shell tar shim");
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-deadline-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const realTar = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
  assert.ok(realTar, "tar must be on PATH");
  const bin = path.join(temp, "bin");
  fs.mkdirSync(bin);
  // Every member read is slowed as on a loaded machine; reading package/hang.txt never finishes.
  fs.writeFileSync(path.join(bin, "tar"), [
    "#!/bin/sh",
    'case "$*" in',
    "  *package/hang.txt*) exec sleep 30 ;;",
    "  *-xOzf*) sleep 0.1 ;;",
    "esac",
    `exec "${realTar}" "$@"`,
    "",
  ].join("\n"), { mode: 0o755 });
  const members = Array.from({ length: 20 }, (_, index) => ({ name: `package/m${index}.txt`, body: `member ${index}\n` }));
  const slow = path.join(temp, "slow.tgz");
  const hung = path.join(temp, "hung.tgz");
  writeTar(slow, members);
  writeTar(hung, [...members.slice(0, 2), { name: "package/hang.txt", body: "never read\n" }]);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  try {
    // Twenty slowed reads need about two seconds: past the one-second base, inside the per-member allowance.
    const slowHits = scanPackArchive(slow, repoRoot, {
      requirePackageIdentity: false,
      limits: { deadlineMs: 1000, perMemberMs: 1000 },
    });
    assert.deepEqual(slowHits, []);

    const started = Date.now();
    const hungHits = scanPackArchive(hung, repoRoot, {
      requirePackageIdentity: false,
      limits: { deadlineMs: 600000, perMemberMs: 600000, spawnTimeoutMs: 500 },
    });
    assert.ok(hungHits.some((hit) => hit.where === "pack-tar-deadline"), JSON.stringify(hungHits));
    assert.ok(Date.now() - started < 20000, "a hung tar call must fail at its per-call cap, not the scaled deadline");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("external filesystem scans reject symlinks, special entries, replacement, and growth without leaks", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX no-follow and FIFO fixtures");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-fs-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-fs-terms-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  });
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  fs.writeFileSync(termsPath, JSON.stringify({
    version: 1,
    terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
  }));
  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");

  const target = path.join(termRoot, "target.txt");
  fs.writeFileSync(target, "safe\n");
  fs.symlinkSync(target, path.join(root, "linked.txt"));
  const fifo = path.join(root, "special.pipe");
  const madeFifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(madeFifo.status, 0, madeFifo.stderr);
  const special = spawnSync(process.execPath, [
    script, "--root", root, "--external-terms", termsPath,
  ], { encoding: "utf8" });
  assert.equal(special.status, 2, special.stdout + special.stderr);
  assert.match(special.stderr, /external-term scanner error/i);
  assert.equal(special.stderr.includes(rawTerm), false);
  assert.equal(special.stderr.includes(root), false);

  fs.rmSync(path.join(root, "linked.txt"));
  fs.rmSync(fifo);
  const probe = path.join(root, "probe.txt");
  fs.writeFileSync(probe, "safe original\n");
  const preload = path.join(termRoot, "replace-on-lstat.cjs");
  fs.writeFileSync(preload, `
const fs = require("node:fs");
const path = require("node:path");
const original = fs.lstatSync;
let changed = false;
fs.lstatSync = function (file, ...args) {
  const stat = original.call(this, file, ...args);
  if (!changed && path.resolve(file) === path.resolve(process.env.PROBE_TARGET)) {
    changed = true;
    if (process.env.PROBE_MODE === "replace") {
      fs.renameSync(file, file + ".old");
      fs.writeFileSync(file, "safe replacement\\n");
    } else {
      fs.appendFileSync(file, "safe growth\\n");
    }
  }
  return stat;
};
`);
  for (const mode of ["replace", "grow"]) {
    fs.rmSync(probe, { force: true });
    fs.rmSync(`${probe}.old`, { force: true });
    fs.writeFileSync(probe, "safe original\n");
    const result = spawnSync(process.execPath, [
      "--require", preload,
      script, "--root", root, "--external-terms", termsPath,
    ], {
      encoding: "utf8",
      env: { ...process.env, PROBE_TARGET: probe, PROBE_MODE: mode },
    });
    assert.equal(result.status, 2, `${mode}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /external-term scanner error/i);
    assert.equal(result.stderr.includes(rawTerm), false);
    assert.equal(result.stderr.includes(root), false);
  }
});

test("external-term scanner covers package-root, pack-json, and text surfaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const rawTerm = ["fixture", "secret"].join("-");
  const termsPath = path.join(termRoot, "terms.json");
  const packPath = path.join(termRoot, "pack.json");
  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  try {
    const packageDir = path.join(root, "packages", "lithermes-installer");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "probe.txt"), `content has ${rawTerm}\n`);
    fs.writeFileSync(termsPath, JSON.stringify({
      version: 1,
      terms: [{ id: "term-a", value: rawTerm, matchMode: "substring" }],
    }));
    fs.writeFileSync(packPath, JSON.stringify({ files: [{ path: `${rawTerm}/payload.txt` }] }));

    const packageRoot = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath, "--package-root", "--json"], {
      encoding: "utf8",
    });
    assert.equal(packageRoot.status, 1);
    assert.equal(packageRoot.stdout.includes(rawTerm), false);
    assert.equal(JSON.parse(packageRoot.stdout).hits[0].fileId.startsWith("file:"), true);

    const pack = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath, "--pack-json", packPath, "--json"], {
      encoding: "utf8",
    });
    assert.equal(pack.status, 1);
    assert.equal(pack.stdout.includes(rawTerm), false);
    assert.equal(JSON.parse(pack.stdout).hits[0].fileId.startsWith("pack:"), true);

    const text = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath, "--text", rawTerm, "--json"], {
      encoding: "utf8",
    });
    assert.equal(text.status, 1);
    assert.equal(text.stdout.includes(rawTerm), false);
    assert.equal(JSON.parse(text.stdout).hits[0].fileId, "text:1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  }
});

test("external-term scanner rejects malformed external terms with a controlled error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-scan-root-"));
  const termRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-external-terms-"));
  const termsPath = path.join(termRoot, "terms.json");
  try {
    fs.writeFileSync(path.join(root, "probe.txt"), "safe\n");
    fs.writeFileSync(termsPath, "{not json");
    const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
    const result = spawnSync(process.execPath, [script, "--root", root, "--external-terms", termsPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /external-term scanner error/i);
    assert.doesNotMatch(result.stderr, /SyntaxError|stack/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(termRoot, { recursive: true, force: true });
  }
});

test("exact verified canonical bytes are protected without creating a general scanner allowlist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "manifest.json"), "utf8"));
  const canonicalFiles = [
    ...manifest.files.map((entry) => path.join(canonicalRoot, "corpus", ...entry.path.split("/"))),
    ...manifest.legal.map((entry) => path.join(canonicalRoot, ...entry.path.split("/"))),
  ];
  assert.deepEqual(scanFiles(canonicalFiles, path.resolve(packageRoot, "..", "..")), []);

  const scanner = require("./scripts/scan-forbidden-tokens");
  assert.deepEqual(scanner.LEGACY_ALLOWLISTS, []);
  assert.equal("allowlistedPaths" in scanner, false);
});

test("family payload-parity inventory is protected at its exact verified path without a general allowlist", (t) => {
  const parity = path.join(packageRoot, "tools", "payload-substance-parity.json");
  assert.ok(fs.existsSync(parity), "family parity manifest must exist");
  assert.deepEqual(scanFiles([parity], repoRoot), []);

  const scanner = require("./scripts/scan-forbidden-tokens");
  assert.deepEqual(scanner.LEGACY_ALLOWLISTS, []);
  assert.equal("allowlistedPaths" in scanner, false);

  const copiedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-parity-copy."));
  t.after(() => fs.rmSync(copiedRoot, { recursive: true, force: true }));
  const copied = path.join(copiedRoot, "payload-substance-parity.json");
  fs.copyFileSync(parity, copied);
  assert.ok(
    scanFiles([copied], copiedRoot).length >= 1,
    "copied family parity bytes outside the exact path must fail",
  );
});

test("canonical protection does not follow copied, altered, or carrier-field token bytes", (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "manifest.json"), "utf8"));
  const blocked = VENDOR_TOKENS.otherHarness;
  const carrier = path.join(canonicalRoot, "manifest.json");
  const carrierManifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
  carrierManifest.note = blocked;
  const carrierTemp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-carrier-field."));
  t.after(() => fs.rmSync(carrierTemp, { recursive: true, force: true }));
  const carrierFile = path.join(carrierTemp, "manifest.json");
  fs.writeFileSync(carrierFile, JSON.stringify(carrierManifest));
  assert.ok(scanFiles([carrierFile], carrierTemp).length >= 1, "carrier field token must be scanned");

  const sourceEntry = manifest.files.find((entry) => {
    const bytes = fs.readFileSync(path.join(canonicalRoot, "corpus", ...entry.path.split("/")), "latin1");
    return bytes.toLowerCase().includes(blocked);
  });
  assert.ok(sourceEntry, "fixture corpus must include a blocked source token");
  const outside = path.join(carrierTemp, "copied.md");
  fs.copyFileSync(path.join(canonicalRoot, "corpus", ...sourceEntry.path.split("/")), outside);
  assert.ok(scanFiles([outside], carrierTemp).length >= 1, "copied canonical bytes outside the exact path must fail");
});

test("package-root and pack projections protect only a complete verified canonical inventory", (t) => {
  const script = path.join(__dirname, "scripts", "scan-forbidden-tokens.js");
  const packageScan = spawnSync(process.execPath, [script, "--root", path.resolve(packageRoot, "..", ".."), "--package-root"], {
    encoding: "utf8",
  });
  assert.equal(packageScan.status, 0, packageScan.stdout + packageScan.stderr);

  const manifest = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "manifest.json"), "utf8"));
  const prefix = "assets/lithermes-plugin/skills/frontend-ui-ux/references/_canonical-corpus/";
  const canonicalPackPaths = [
    `${prefix}.gitattributes`,
    `${prefix}manifest.json`,
    ...manifest.files.map((entry) => `${prefix}corpus/${entry.path}`),
    ...manifest.legal.map((entry) => `${prefix}${entry.path}`),
  ];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-pack."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const pack = path.join(temp, "pack.json");
  fs.writeFileSync(pack, JSON.stringify({ files: canonicalPackPaths.map((entry) => ({ path: entry })) }));
  const complete = spawnSync(process.execPath, [script, "--root", path.resolve(packageRoot, "..", ".."), "--pack-json", pack], { encoding: "utf8" });
  assert.equal(complete.status, 0, complete.stdout + complete.stderr);

  fs.writeFileSync(pack, JSON.stringify({ files: canonicalPackPaths.slice(1).map((entry) => ({ path: entry })) }));
  const missing = spawnSync(process.execPath, [script, "--root", path.resolve(packageRoot, "..", ".."), "--pack-json", pack], { encoding: "utf8" });
  assert.equal(missing.status, 1, "missing canonical pack projection must fail closed");

  fs.writeFileSync(pack, JSON.stringify({ files: [...canonicalPackPaths, `${prefix}extra.md`].map((entry) => ({ path: entry })) }));
  const extra = spawnSync(process.execPath, [script, "--root", path.resolve(packageRoot, "..", ".."), "--pack-json", pack], { encoding: "utf8" });
  assert.equal(extra.status, 1, "extra canonical pack projection must fail closed");
});

test("scanPackPaths rejects traversal without reopening the canonical carrier", () => {
  const root = path.resolve(packageRoot, "..", "..");
  const carrier = path.resolve(canonicalRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
  const prefix = "assets/lithermes-plugin/skills/frontend-ui-ux/references/_canonical-corpus/";
  const firstProjected = `${prefix}corpus/${manifest.files[0].path}`;
  const traversalProjected = `${prefix}corpus/../outside-canonical-root`;
  const entries = [
    `${prefix}.gitattributes`,
    `${prefix}manifest.json`,
    ...manifest.files.map((entry) => `${prefix}corpus/${entry.path}`),
    ...manifest.legal.map((entry) => `${prefix}${entry.path}`),
  ].map((entry) => entry === firstProjected ? traversalProjected : entry);
  const originalOpen = fs.openSync;
  let carrierOpens = 0;
  fs.openSync = function guardedOpen(file, ...args) {
    if (path.resolve(file) === carrier) {
      carrierOpens += 1;
    }
    return originalOpen.call(this, file, ...args);
  };
  let hits;
  try {
    hits = scanPackPaths(entries, root);
  } finally {
    fs.openSync = originalOpen;
  }

  assert.equal(carrierOpens, 1, "pack projection must open the verified carrier once");
  assert.ok(hits.some((hit) => hit.where === "canonical-pack-outside-root"), JSON.stringify(hits));
  assert.ok(hits.some((hit) => hit.where === "canonical-pack-missing"), JSON.stringify(hits));
  assert.ok(hits.some((hit) => hit.where === "canonical-pack-extra"), JSON.stringify(hits));
});

test("scanner rejects verifier-to-scan canonical substitution using captured bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-scan-swap."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetRoot = path.join(root, "assets", "lithermes-plugin", "skills", "frontend-ui-ux", "references", "_canonical-corpus");
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(canonicalRoot, targetRoot, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(targetRoot, "manifest.json"), "utf8"));
  const target = path.join(targetRoot, "corpus", ...manifest.files[0].path.split("/"));
  const trigger = path.join(root, "scan-trigger.txt");
  fs.writeFileSync(trigger, "safe trigger bytes\n");
  const originalRead = fs.readFileSync;
  let replaced = false;
  fs.readFileSync = function replaceBeforeCanonicalScan(file, ...args) {
    const bytes = originalRead.call(this, file, ...args);
    if (!replaced && path.resolve(file) === path.resolve(trigger)) {
      replaced = true;
      fs.appendFileSync(target, `\n${VENDOR_TOKENS.otherHarness}\n`);
    }
    return bytes;
  };
  let hits;
  try {
    hits = scanFiles([trigger, target], root);
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.equal(replaced, true, "fixture must substitute after canonical verification");
  assert.ok(hits.some((hit) => hit.where === "canonical-verification-failed"), JSON.stringify(hits));
});

test("scanner rejects verifier-to-scan payload manifest substitution using captured bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-payload-scan-swap."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePlugin = path.join(packageRoot, "assets", "lithermes-plugin");
  const targetPlugin = path.join(root, "assets", "lithermes-plugin");
  copyManifestPayload(sourcePlugin, targetPlugin);
  const manifest = path.join(targetPlugin, "payload-version.json");
  const displaced = path.join(root, "payload-version.displaced.json");
  const trigger = path.join(root, "scan-trigger.txt");
  fs.writeFileSync(trigger, "safe trigger bytes\n");
  const originalRead = fs.readFileSync;
  let replaced = false;
  fs.readFileSync = function replaceAfterPayloadVerification(file, ...args) {
    const bytes = originalRead.call(this, file, ...args);
    if (!replaced && path.resolve(file) === path.resolve(trigger)) {
      replaced = true;
      fs.renameSync(manifest, displaced);
      fs.writeFileSync(manifest, `${originalRead.call(this, displaced, "utf8")}\n${VENDOR_TOKENS.otherHarness}\n`);
    }
    return bytes;
  };
  let hits;
  try {
    hits = scanFiles([trigger, manifest], root);
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.equal(replaced, true, "fixture must replace the manifest after payload verification");
  assert.ok(hits.some((hit) => hit.where === "payload-manifest-verification-failed"), JSON.stringify(hits));
});

test("payload manifest capture rejects malformed JSON and final-file replacement", (t) => {
  assert.equal(typeof capturePayloadManifest, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-payload-capture."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(packageRoot, "assets", "lithermes-plugin", "payload-version.json");
  const manifest = path.join(root, "payload-version.json");
  fs.copyFileSync(source, manifest);

  fs.writeFileSync(manifest, '{"files":[');
  const malformed = capturePayloadManifest(manifest);
  assert.equal(malformed.ok, false);
  assert.ok(malformed.failures.some((failure) => /invalid-json/.test(failure)), JSON.stringify(malformed));

  fs.copyFileSync(source, manifest);
  const displaced = path.join(root, "payload-version.displaced.json");
  const originalOpen = fs.openSync;
  let replaced = false;
  fs.openSync = function replacePayloadAfterOpen(file, ...args) {
    const descriptor = originalOpen.call(this, file, ...args);
    if (!replaced && path.resolve(file) === path.resolve(manifest)) {
      replaced = true;
      fs.renameSync(manifest, displaced);
      fs.copyFileSync(displaced, manifest);
    }
    return descriptor;
  };
  let replacement;
  try {
    replacement = capturePayloadManifest(manifest);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(replaced, true, "fixture must replace the named manifest after descriptor open");
  assert.equal(replacement.ok, false);
  assert.ok(replacement.failures.some((failure) => /identity|changed/.test(failure)), JSON.stringify(replacement));
});

test("scanner feeds descriptor-captured protected buffers through its byte scanner", () => {
  const source = fs.readFileSync(path.join(__dirname, "scripts", "scan-forbidden-tokens.js"), "utf8");
  assert.match(source, /buffer\s*=\s*protectedRecord\.buffer/);
  assert.doesNotMatch(source, /if\s*\(canonicalRecord\)\s*\{[^}]*continue;/s);
  assert.doesNotMatch(source, /payloadProtection\.paths\.has\([^)]*\)\s*\)\s*continue/);
});

test("actual npm tar validation compares produced canonical bytes", (t) => {
  assert.equal(typeof scanPackArchive, "function");
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-canonical-tar."));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const archive = path.join(destination, JSON.parse(packed.stdout)[0].filename);
  assert.deepEqual(scanPackArchive(archive, path.resolve(packageRoot, "..", "..")), []);

  const extracted = path.join(destination, "extracted");
  fs.mkdirSync(extracted);
  const unpack = spawnSync("tar", ["-xzf", archive, "-C", extracted], { encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  const packedReadme = path.join(extracted, "package", "README.md");
  const originalReadme = fs.readFileSync(packedReadme);
  fs.appendFileSync(packedReadme, `\n${VENDOR_TOKENS.otherHarness}\n`);
  const ordinaryTamper = path.join(destination, "ordinary-tampered.tgz");
  const repackOrdinary = spawnSync("tar", ["-czf", ordinaryTamper, "-C", extracted, "package"], { encoding: "utf8" });
  assert.equal(repackOrdinary.status, 0, repackOrdinary.stderr);
  const ordinaryHits = scanPackArchive(ordinaryTamper, path.resolve(packageRoot, "..", ".."));
  assert.ok(ordinaryHits.some((hit) => hit.where.startsWith("pack-content:")), JSON.stringify(ordinaryHits));
  fs.writeFileSync(packedReadme, originalReadme);
  const manifest = JSON.parse(fs.readFileSync(path.join(canonicalRoot, "manifest.json"), "utf8"));
  const packedCanonical = path.join(
    extracted,
    "package",
    "assets",
    "lithermes-plugin",
    "skills",
    "frontend-ui-ux",
    "references",
    "_canonical-corpus",
    "corpus",
    ...manifest.files[0].path.split("/"),
  );
  fs.appendFileSync(packedCanonical, "\ntampered produced bytes\n");
  const tampered = path.join(destination, "tampered.tgz");
  const repack = spawnSync("tar", ["-czf", tampered, "-C", extracted, "package"], { encoding: "utf8" });
  assert.equal(repack.status, 0, repack.stderr);
  const hits = scanPackArchive(tampered, path.resolve(packageRoot, "..", ".."));
  assert.ok(hits.some((hit) => hit.where === "canonical-pack-byte-mismatch"), JSON.stringify(hits));
});

test("in-place canonical carrier fields cannot inherit scanner exemption", (t) => {
  const blocked = VENDOR_TOKENS.otherHarness;
  for (const [label, mutate] of [
    ["top", (manifest) => { manifest.note = blocked; }],
    ["file", (manifest) => { manifest.files[0].note = blocked; }],
    ["legal", (manifest) => { manifest.legal[0].note = blocked; }],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-canonical-carrier-${label}.`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, "assets", "lithermes-plugin", "skills", "frontend-ui-ux", "references", "_canonical-corpus");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(canonicalRoot, target, { recursive: true });
    const carrier = path.join(target, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
    mutate(manifest);
    fs.writeFileSync(carrier, JSON.stringify(manifest));
    assert.ok(scanFiles([carrier], root).length >= 1, `${label} carrier must be scanned in place`);
  }
});

test("in-place payload carrier fields cannot inherit scanner exemption after source hashes match", (t) => {
  const blocked = VENDOR_TOKENS.otherHarness;
  const sourcePlugin = path.join(packageRoot, "assets", "lithermes-plugin");
  for (const [label, mutate] of [
    ["top", (manifest) => { manifest.note = blocked; }],
    ["entry", (manifest) => { manifest.files[0].note = blocked; }],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-payload-carrier-${label}.`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, "assets", "lithermes-plugin");
    copyManifestPayload(sourcePlugin, target);
    const carrier = path.join(target, "payload-version.json");
    const manifest = JSON.parse(fs.readFileSync(carrier, "utf8"));
    mutate(manifest);
    fs.writeFileSync(carrier, JSON.stringify(manifest));
    assert.ok(scanFiles([carrier], root).length >= 1, `${label} payload carrier must be scanned in place`);
  }
});

test("duplicate raw canonical and payload carrier keys cannot bypass scanner protection", (t) => {
  const blocked = VENDOR_TOKENS.otherHarness;
  for (const [label, mutate] of [
    ["canonical-top", (raw) => raw.replace('"schema": "lithermes.canonical-frontend-corpus/v1"', `"schema": "${blocked}",\n  "schema": "lithermes.canonical-frontend-corpus/v1"`)],
    ["canonical-entry", (raw) => raw.replace('"path": "design/', `"path": "${blocked}",\n      "path": "design/`)],
    ["canonical-legal", (raw) => {
      const start = raw.indexOf('"legal": [');
      return `${raw.slice(0, start)}${raw.slice(start).replace('"path": "legal/', `"path": "${blocked}",\n      "path": "legal/`)}`;
    }],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-duplicate-${label}.`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, "assets", "lithermes-plugin", "skills", "frontend-ui-ux", "references", "_canonical-corpus");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(canonicalRoot, target, { recursive: true });
    const carrier = path.join(target, "manifest.json");
    fs.writeFileSync(carrier, mutate(fs.readFileSync(carrier, "utf8")));
    assert.ok(scanFiles([carrier], root).length >= 1, `${label} duplicate carrier must be scanned`);
  }

  const sourcePlugin = path.join(packageRoot, "assets", "lithermes-plugin");
  for (const [label, mutate] of [
    ["payload-top", (raw) => raw.replace('"source": "bundled-payload"', `"source": "${blocked}",\n  "source": "bundled-payload"`)],
    ["payload-entry", (raw) => raw.replace('"path": "NOTICE.md"', `"path": "${blocked}",\n      "path": "NOTICE.md"`)],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-duplicate-${label}.`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, "assets", "lithermes-plugin");
    copyManifestPayload(sourcePlugin, target);
    const carrier = path.join(target, "payload-version.json");
    fs.writeFileSync(carrier, mutate(fs.readFileSync(carrier, "utf8")));
    assert.ok(scanFiles([carrier], root).length >= 1, `${label} duplicate carrier must be scanned`);
  }
});
