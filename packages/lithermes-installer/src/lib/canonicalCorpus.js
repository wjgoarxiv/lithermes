const fs = require("node:fs");
const path = require("node:path");
const { parseDocument } = require("yaml");

const DEFAULT_MAX_CAPTURED_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_CAPTURED_TOTAL_BYTES = 4 * 1024 * 1024;

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

module.exports = {
  captureRegularFile,
  parseJsonRejectingDuplicateKeys,
  revalidateDescriptorCapture,
};
