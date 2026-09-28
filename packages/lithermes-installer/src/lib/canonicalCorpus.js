const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseDocument } = require("yaml");

const DEFAULT_MAX_CAPTURED_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_CAPTURED_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_CANONICAL_FILE_BYTES = DEFAULT_MAX_CAPTURED_FILE_BYTES;
const MAX_CANONICAL_AGGREGATE_BYTES = DEFAULT_MAX_CAPTURED_TOTAL_BYTES;

const EXPECTED = Object.freeze({
  schema: "lithermes.canonical-frontend-corpus/v1",
  commit: "8ec16c5129df7b9778959e8367657d0e79c2c3bb",
  tree: "9188410be0af35f2421ba300d91a0d7a7341caf0",
  fileCount: 167,
  totalBytes: 2596360,
  digest: "b0d1a085de8856e7edeba24127d26875fe5473b80c0d95f6578addfdc801e445",
  directories: ["design", "designpowers", "perfection", "ui-ux-db"],
  attributes: "corpus/** -text\nlegal/** -text\n",
  legal: [
    ["legal/ATTRIBUTION.md", "frontend-attribution", 12075, "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92"],
    ["legal/LICENSE", "source-root-license", 1068, "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1"],
    ["legal/LICENSE-Apache-2.0.txt", "frontend-apache-license", 11296, "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da"],
  ],
});

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseJsonRejectingDuplicateKeys(text) {
  const document = parseDocument(text, {
    maxAliasCount: 0,
    merge: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) throw document.errors[0];
  return JSON.parse(text);
}

function safeRelative(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.replaceAll("\\", "/")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    ctimeNs: stat.ctimeNs,
    mtimeNs: stat.mtimeNs,
  };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.mode === right?.mode
    && left?.size === right?.size
    && left?.ctimeNs === right?.ctimeNs
    && left?.mtimeNs === right?.mtimeNs;
}

function lstatBigInt(file) {
  return fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
}

function createDescriptorCapture() {
  return { files: new Map(), directories: new Map(), totalBytes: 0 };
}

function closeAll(opened) {
  for (const entry of [...opened].reverse()) {
    try {
      fs.closeSync(entry.descriptor);
    } catch {
      // The caller already fails closed if a descriptor cannot be verified.
    }
  }
}

function ancestorPaths(root, file) {
  const resolvedRoot = path.resolve(root);
  const directory = path.dirname(path.resolve(file));
  const relation = path.relative(resolvedRoot, directory);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) return null;
  const paths = [resolvedRoot];
  let current = resolvedRoot;
  for (const part of relation.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    paths.push(current);
  }
  return paths;
}

function openAncestors(root, file, capture) {
  if (typeof fs.constants.O_NOFOLLOW !== "number" || typeof fs.constants.O_DIRECTORY !== "number") {
    return { failure: "no-follow-unsupported", opened: [] };
  }
  const paths = ancestorPaths(root, file);
  if (!paths) return { failure: "ancestor-invalid", opened: [] };
  const opened = [];
  try {
    for (const ancestor of paths) {
      const before = lstatBigInt(ancestor);
      if (!before?.isDirectory() || before.isSymbolicLink()) throw new Error("ancestor-invalid");
      const descriptor = fs.openSync(
        ancestor,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
      );
      const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
      if (!descriptorStat.isDirectory()
        || before.dev !== descriptorStat.dev
        || before.ino !== descriptorStat.ino) {
        fs.closeSync(descriptor);
        throw new Error("ancestor-identity-changed");
      }
      const identity = statIdentity(descriptorStat);
      const expected = capture.directories.get(ancestor);
      if (expected && !sameIdentity(expected, identity)) {
        fs.closeSync(descriptor);
        throw new Error("ancestor-identity-changed");
      }
      capture.directories.set(ancestor, identity);
      opened.push({ absolute: ancestor, descriptor, identity });
    }
    return { opened };
  } catch (error) {
    closeAll(opened);
    return { failure: error instanceof Error ? error.message : "ancestor-unreadable", opened: [] };
  }
}

function verifyAncestors(opened) {
  try {
    return opened.every((entry) => {
      const descriptorStat = fs.fstatSync(entry.descriptor, { bigint: true });
      const namedStat = lstatBigInt(entry.absolute);
      return descriptorStat.isDirectory()
        && namedStat?.isDirectory()
        && !namedStat.isSymbolicLink()
        && sameIdentity(statIdentity(descriptorStat), entry.identity)
        && sameIdentity(statIdentity(namedStat), entry.identity);
    });
  } catch {
    return false;
  }
}

function readDescriptorBounded(descriptor, size) {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = fs.readSync(descriptor, buffer, offset, size - offset, null);
    if (count === 0) break;
    offset += count;
  }
  const probe = Buffer.allocUnsafe(1);
  const grew = fs.readSync(descriptor, probe, 0, 1, null) !== 0;
  return { buffer: offset === size ? buffer : buffer.subarray(0, offset), grew };
}

function readRegular(
  root,
  relative,
  failures,
  capture,
  expectedMax = DEFAULT_MAX_CAPTURED_FILE_BYTES,
  aggregateMax = DEFAULT_MAX_CAPTURED_TOTAL_BYTES,
) {
  const file = path.join(root, ...relative.split("/"));
  const ancestors = openAncestors(root, file, capture);
  if (ancestors.failure) {
    failures.push(`${relative}:${ancestors.failure}`);
    return null;
  }
  let descriptor;
  try {
    const before = lstatBigInt(file);
    if (!before) throw new Error("missing");
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("not-regular");
    if ((before.mode & 0o444n) === 0n) throw new Error("unreadable");
    if (before.size > BigInt(expectedMax)) throw new Error("file-too-large");
    if (capture.totalBytes + Number(before.size) > aggregateMax) {
      throw new Error("aggregate-too-large");
    }
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(statIdentity(before), statIdentity(opened))) {
      throw new Error("file-identity-changed");
    }
    const bounded = readDescriptorBounded(descriptor, Number(opened.size));
    const afterDescriptor = fs.fstatSync(descriptor, { bigint: true });
    const afterNamed = lstatBigInt(file);
    if (bounded.grew
      || bounded.buffer.length !== Number(opened.size)
      || !sameIdentity(statIdentity(opened), statIdentity(afterDescriptor))
      || !afterNamed?.isFile()
      || afterNamed.isSymbolicLink()
      || !sameIdentity(statIdentity(opened), statIdentity(afterNamed))) {
      throw new Error("file-identity-changed");
    }
    if (!verifyAncestors(ancestors.opened)) throw new Error("ancestor-identity-changed");
    const record = {
      absolute: path.resolve(file),
      buffer: Buffer.from(bounded.buffer),
      identity: statIdentity(opened),
    };
    capture.files.set(record.absolute, record);
    capture.totalBytes += record.buffer.length;
    return { stat: { size: record.buffer.length }, buffer: record.buffer };
  } catch (error) {
    failures.push(`${relative}:${error instanceof Error ? error.message : "unreadable"}`);
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        failures.push(`${relative}:unreadable`);
      }
    }
    closeAll(ancestors.opened);
  }
}

function revalidateDescriptorCapture(capture) {
  if (!capture || !(capture.files instanceof Map) || !(capture.directories instanceof Map)) return false;
  try {
    for (const [absolute, expected] of capture.directories) {
      const current = lstatBigInt(absolute);
      if (!current?.isDirectory() || current.isSymbolicLink() || !sameIdentity(statIdentity(current), expected)) return false;
    }
    for (const [absolute, record] of capture.files) {
      const current = lstatBigInt(absolute);
      if (!current?.isFile() || current.isSymbolicLink() || !sameIdentity(statIdentity(current), record.identity)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function captureRegularFile(root, relative, options = {}) {
  const failures = [];
  if (!safeRelative(relative)) {
    return { ok: false, failures: [`${relative}:invalid-relative-path`], capture: null, record: null };
  }
  const capture = createDescriptorCapture();
  const read = readRegular(
    path.resolve(root),
    relative,
    failures,
    capture,
    options.maxFileBytes ?? DEFAULT_MAX_CAPTURED_FILE_BYTES,
    options.maxTotalBytes ?? DEFAULT_MAX_CAPTURED_TOTAL_BYTES,
  );
  if (!read || failures.length || !revalidateDescriptorCapture(capture)) {
    if (read && !failures.length) failures.push(`${relative}:capture-identity-changed`);
    return { ok: false, failures, capture: null, record: null };
  }
  return {
    ok: true,
    failures: [],
    capture,
    record: capture.files.get(path.resolve(root, ...relative.split("/"))),
  };
}

function revalidateCanonicalCapture(capture) {
  return revalidateDescriptorCapture(capture);
}

function inventory(root, failures) {
  const entries = [];
  function visit(directory, prefix = "") {
    let children;
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      failures.push(`${prefix || "."}:unreadable-directory`);
      return;
    }
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      entries.push({ relative, type: child.isDirectory() ? "directory" : child.isFile() ? "file" : "special" });
      if (child.isDirectory()) visit(path.join(directory, child.name), relative);
    }
  }
  visit(root);
  return entries;
}

function inspectCanonicalCorpus(root, includePaths) {
  const failures = [];
  const capture = createDescriptorCapture();
  const manifestRead = readRegular(root, "manifest.json", failures, capture);
  let manifest;
  if (manifestRead) {
    try {
      manifest = parseJsonRejectingDuplicateKeys(manifestRead.buffer.toString("utf8"));
    } catch {
      failures.push("manifest.json:invalid-json-or-duplicate-key");
    }
  }
  if (!manifest || typeof manifest !== "object") {
    const result = { ok: false, failures, protectedFiles: 0 };
    return includePaths ? { ...result, paths: new Set(), inventory: new Set(), capture: null } : result;
  }

  if (!hasExactKeys(manifest, ["schema", "source", "corpus", "files", "legal"])) failures.push("manifest:unknown-or-missing-fields");
  if (!hasExactKeys(manifest.source, ["commit", "tree", "directories"])) failures.push("manifest:source-fields-invalid");
  if (!hasExactKeys(manifest.corpus, ["fileCount", "totalBytes", "digest", "digestFormat"])) failures.push("manifest:corpus-fields-invalid");

  if (manifest.schema !== EXPECTED.schema) failures.push("manifest:schema-mismatch");
  if (manifest.source?.commit !== EXPECTED.commit) failures.push("manifest:commit-mismatch");
  if (manifest.source?.tree !== EXPECTED.tree) failures.push("manifest:tree-mismatch");
  if (Object.hasOwn(manifest.source || {}, "root")) failures.push("manifest:unexpected-source-carrier");
  if (JSON.stringify(manifest.source?.directories) !== JSON.stringify(EXPECTED.directories)) failures.push("manifest:directories-mismatch");
  if (manifest.corpus?.fileCount !== EXPECTED.fileCount) failures.push("manifest:file-count-mismatch");
  if (manifest.corpus?.totalBytes !== EXPECTED.totalBytes) failures.push("manifest:byte-count-mismatch");
  if (manifest.corpus?.digest !== EXPECTED.digest) failures.push("manifest:digest-mismatch");
  if (manifest.corpus?.digestFormat !== "sorted sha256 two-spaces path newline") failures.push("manifest:digest-format-mismatch");
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED.fileCount) failures.push("manifest:files-invalid");
  if (!Array.isArray(manifest.legal) || manifest.legal.length !== EXPECTED.legal.length) failures.push("manifest:legal-invalid");

  const expectedFiles = new Set(["manifest.json", ".gitattributes"]);
  const protectedFiles = new Set();
  const seen = new Set();
  let totalBytes = 0;
  let previous = "";
  let digestStream = "";
  for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
    if (!hasExactKeys(entry, ["path", "size", "sha256"])) failures.push("manifest:file-fields-invalid");
    if (!entry || !safeRelative(entry.path) || seen.has(entry.path)) {
      failures.push("manifest:invalid-or-duplicate-file-path");
      continue;
    }
    if (previous && entry.path <= previous) failures.push("manifest:files-not-sorted");
    previous = entry.path;
    seen.add(entry.path);
    if (!EXPECTED.directories.includes(entry.path.split("/")[0])) failures.push(`${entry.path}:outside-corpus-directories`);
    const relative = `corpus/${entry.path}`;
    expectedFiles.add(relative);
    const actual = readRegular(root, relative, failures, capture);
    if (!actual) continue;
    totalBytes += actual.stat.size;
    const actualHash = hashBuffer(actual.buffer);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || actual.stat.size !== entry.size) failures.push(`${relative}:size-mismatch`);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || "") || actualHash !== entry.sha256) failures.push(`${relative}:hash-mismatch`);
    digestStream += `${entry.sha256}  ${entry.path}\n`;
    protectedFiles.add(path.resolve(root, relative));
  }
  if (totalBytes !== EXPECTED.totalBytes) failures.push("corpus:byte-count-mismatch");
  if (hashBuffer(Buffer.from(digestStream)) !== EXPECTED.digest) failures.push("corpus:aggregate-digest-mismatch");

  const legalByPath = new Map((Array.isArray(manifest.legal) ? manifest.legal : []).map((entry) => [entry?.path, entry]));
  for (const entry of Array.isArray(manifest.legal) ? manifest.legal : []) {
    if (!hasExactKeys(entry, ["path", "role", "size", "sha256"])) failures.push("manifest:legal-fields-invalid");
  }
  for (const [relative, role, size, hash] of EXPECTED.legal) {
    expectedFiles.add(relative);
    const entry = legalByPath.get(relative);
    if (!entry || entry.role !== role || entry.size !== size || entry.sha256 !== hash) failures.push(`${relative}:manifest-mismatch`);
    const actual = readRegular(root, relative, failures, capture);
    if (!actual) continue;
    if (actual.stat.size !== size) failures.push(`${relative}:size-mismatch`);
    if (hashBuffer(actual.buffer) !== hash) failures.push(`${relative}:hash-mismatch`);
    protectedFiles.add(path.resolve(root, relative));
  }

  const attributes = readRegular(root, ".gitattributes", failures, capture);
  if (attributes && attributes.buffer.toString("utf8") !== EXPECTED.attributes) failures.push(".gitattributes:content-mismatch");
  protectedFiles.add(path.resolve(root, "manifest.json"));

  const listed = inventory(root, failures);
  const expectedDirectories = new Set();
  for (const relative of expectedFiles) {
    const parts = relative.split("/");
    for (let index = 1; index < parts.length; index += 1) expectedDirectories.add(parts.slice(0, index).join("/"));
  }
  for (const entry of listed) {
    if (entry.type === "directory" && !expectedDirectories.has(entry.relative)) failures.push(`${entry.relative}:unexpected-directory`);
    if (entry.type !== "directory" && !expectedFiles.has(entry.relative)) failures.push(`${entry.relative}:unexpected`);
    if (entry.type === "special") failures.push(`${entry.relative}:not-regular`);
  }
  for (const relative of expectedFiles) {
    if (!listed.some((entry) => entry.relative === relative && entry.type === "file")) failures.push(`${relative}:missing-or-not-regular`);
  }
  if (!revalidateCanonicalCapture(capture)) failures.push("canonical:capture-identity-changed");

  const result = failures.length
    ? { ok: false, failures: [...new Set(failures)].sort(), protectedFiles: 0 }
    : { ok: true, failures: [], protectedFiles: protectedFiles.size };
  return includePaths
    ? {
      ...result,
      paths: result.ok ? protectedFiles : new Set(),
      inventory: result.ok ? expectedFiles : new Set(),
      capture: result.ok ? capture : null,
    }
    : result;
}

function verifyCanonicalCorpus(root) {
  return inspectCanonicalCorpus(root, false);
}

function canonicalProtectedPaths(root) {
  return inspectCanonicalCorpus(root, true);
}

module.exports = {
  EXPECTED,
  MAX_CANONICAL_AGGREGATE_BYTES,
  MAX_CANONICAL_FILE_BYTES,
  captureRegularFile,
  canonicalProtectedPaths,
  parseJsonRejectingDuplicateKeys,
  revalidateCanonicalCapture,
  revalidateDescriptorCapture,
  verifyCanonicalCorpus,
};
