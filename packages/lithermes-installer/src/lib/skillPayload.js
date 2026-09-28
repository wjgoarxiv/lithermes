const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("./files");
const {
  captureRegularFile,
  parseJsonRejectingDuplicateKeys,
  revalidateDescriptorCapture,
  verifyCanonicalCorpus,
} = require("./canonicalCorpus");

const MAX_PAYLOAD_MANIFEST_BYTES = 1024 * 1024;
const MAX_PAYLOAD_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PAYLOAD_TOTAL_BYTES = 24 * 1024 * 1024;

const requiredSkills = [
  "lit-burnoff-file", "autoconference", "autoresearch", "browser-drive", "comment-checker", "debugging",
  "deep-interview",
  "frontend-ui-ux", "readme-studio", "lit-commit", "lit-crucible", "lit-init",
  "lit-humanizer", "lit-comprehend", "lit-handoff", "lit-plan", "lit-recap",
  "lit-scientific-visualization", "lit-diagram-drawer", "lit-pptx", "lit-docx", "lit-typographic-motion", "litgoal", "litresearch", "litwork", "lsp",
  "lsp-setup", "lit-code", "refactor", "lit-burnoff", "review-work",
  "rules", "start-work", "structural-search", "visual-qa", "wikify",
];

function inspectManifest(manifest, verifySourceHash) {
  const exactKeys = (value, expected) => value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  if (!exactKeys(manifest, ["syncedAt", "source", "sourceHash", "files"]) || !Array.isArray(manifest.files)) {
    return { entries: new Map(), issue: "manifest schema fields invalid" };
  }
  if (
    typeof manifest.syncedAt !== "string"
    || Number.isNaN(Date.parse(manifest.syncedAt))
    || new Date(manifest.syncedAt).toISOString() !== manifest.syncedAt
    || !["bundled-payload", "local-plugin-source"].includes(manifest.source)
    || !/^[a-f0-9]{64}$/.test(manifest.sourceHash || "")
  ) {
    return { entries: new Map(), issue: "manifest missing" };
  }
  const entries = new Map();
  for (const entry of manifest.files) {
    if (
      !exactKeys(entry, ["path", "sha256"])
      || typeof entry.path !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.sha256 || "")
    ) {
      return { entries, issue: "manifest entry invalid" };
    }
    const relative = entry.path.replaceAll("\\", "/");
    if (
      !relative
      || path.posix.isAbsolute(relative)
      || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
      || entries.has(relative)
    ) {
      return { entries, issue: "manifest path invalid or duplicate" };
    }
    if (relative.split("/").includes("__pycache__") || /\.py[co]$/.test(relative)) {
      return { entries, issue: "manifest contains Python bytecode" };
    }
    entries.set(relative, entry.sha256);
  }
  if (verifySourceHash) {
    const aggregate = crypto
      .createHash("sha256")
      .update([...entries].map(([entryPath, hash]) => `${entryPath}:${hash}`).sort().join("\n"))
      .digest("hex");
    if (typeof manifest.sourceHash !== "string" || aggregate !== manifest.sourceHash) {
      return { entries, issue: "manifest source hash mismatch" };
    }
  }
  return { entries, issue: null };
}

function capturePayloadManifest(file) {
  const root = path.dirname(path.resolve(file));
  const relative = path.basename(file);
  const captured = captureRegularFile(root, relative, {
    maxFileBytes: MAX_PAYLOAD_MANIFEST_BYTES,
    maxTotalBytes: MAX_PAYLOAD_MANIFEST_BYTES,
  });
  if (!captured.ok || !captured.record) return { ...captured, manifest: null };
  try {
    return {
      ...captured,
      manifest: parseJsonRejectingDuplicateKeys(captured.record.buffer.toString("utf8")),
    };
  } catch {
    return {
      ok: false,
      failures: [`${relative}:invalid-json-or-duplicate-key`],
      capture: null,
      record: null,
      manifest: null,
    };
  }
}

function readPayloadManifest(file) {
  return capturePayloadManifest(file).manifest;
}

function capturePayloadInventory(pluginPath, options = {}) {
  const manifestPath = path.join(pluginPath, "payload-version.json");
  const manifestCapture = capturePayloadManifest(manifestPath);
  if (!manifestCapture.ok || !manifestCapture.manifest || !manifestCapture.record) {
    return { ok: false, failures: manifestCapture.failures || ["payload manifest capture failed"] };
  }
  const inspected = inspectManifest(manifestCapture.manifest, true);
  const sourceInspection = inspectSkillPayload(pluginPath, manifestCapture.manifest, true);
  if (inspected.issue || !sourceInspection.ok) {
    return {
      ok: false,
      failures: [inspected.issue || "payload source verification failed"],
    };
  }

  const maxFileBytes = options.maxFileBytes ?? MAX_PAYLOAD_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_PAYLOAD_TOTAL_BYTES;
  const capturedBytes = new Map();
  const captures = [manifestCapture.capture];
  let totalBytes = manifestCapture.record.buffer.length;
  for (const [relative, expectedHash] of inspected.entries) {
    const captured = captureRegularFile(pluginPath, relative, {
      maxFileBytes,
      maxTotalBytes: maxFileBytes,
    });
    if (!captured.ok || !captured.record) {
      return { ok: false, failures: [`${relative}:capture-failed`] };
    }
    totalBytes += captured.record.buffer.length;
    if (totalBytes > maxTotalBytes) {
      return { ok: false, failures: ["payload aggregate too large"] };
    }
    if (crypto.createHash("sha256").update(captured.record.buffer).digest("hex") !== expectedHash) {
      return { ok: false, failures: [`${relative}:hash-mismatch`] };
    }
    captures.push(captured.capture);
    capturedBytes.set(relative, captured.record.buffer);
  }
  if (!captures.every((capture) => revalidateDescriptorCapture(capture))) {
    return { ok: false, failures: ["payload capture identity changed"] };
  }
  return {
    ok: true,
    failures: [],
    manifest: manifestCapture.manifest,
    manifestBuffer: manifestCapture.record.buffer,
    capturedBytes,
    captures,
    totalBytes,
  };
}

function entryLabel(relativePath) {
  const match = relativePath.match(/^skills\/([^/]+)\/(.+)$/);
  return match ? { id: match[1], path: match[2] } : { id: "payload", path: relativePath };
}

function checkEntry(pluginPath, relativePath, expectedHash) {
  const file = path.join(pluginPath, ...relativePath.split("/"));
  const label = entryLabel(relativePath);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return { ...label, reason: "missing" };
  }
  if (!stat.isFile()) return { ...label, reason: "not regular" };
  if (stat.size === 0 && path.posix.basename(relativePath) !== ".gitkeep") {
    return { ...label, reason: "empty" };
  }
  try {
    return sha256(file) === expectedHash ? null : { ...label, reason: "hash mismatch" };
  } catch {
    return { ...label, reason: "unreadable" };
  }
}

function listPayloadEntries(root, readDirectory = fs.readdirSync) {
  const results = [];
  function visit(directory, prefix = "") {
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(`${relative}/`);
        visit(absolute, relative);
      }
      else results.push(relative);
    }
  }
  try {
    visit(root);
  } catch {
    return { entries: results, issue: "traversal failed" };
  }
  return { entries: results, issue: null };
}

function inspectSkillPayload(pluginPath, manifest, verifySourceHash = false, options = {}) {
  const inspected = inspectManifest(manifest, verifySourceHash);
  const failures = [];
  const rootEntrypoints = new Set(requiredSkills.map((id) => `skills/${id}/SKILL.md`));
  for (const id of requiredSkills) {
    const prefix = `skills/${id}/`;
    if (!inspected.entries.has(`${prefix}SKILL.md`)) {
      failures.push({ id, path: "SKILL.md", reason: "manifest missing" });
      continue;
    }
    const failure = checkEntry(pluginPath, `${prefix}SKILL.md`, inspected.entries.get(`${prefix}SKILL.md`));
    if (failure) {
      failures.push(failure);
    }
  }
  for (const [entryPath, expectedHash] of inspected.entries) {
    if (rootEntrypoints.has(entryPath)) continue;
    const failure = checkEntry(pluginPath, entryPath, expectedHash);
    if (failure) failures.push(failure);
  }
  const allowedUnlisted = new Set(["payload-version.json"]);
  const allowedDirectories = new Set();
  for (const entryPath of inspected.entries.keys()) {
    const segments = entryPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      allowedDirectories.add(`${segments.slice(0, index).join("/")}/`);
    }
  }
  const traversal = listPayloadEntries(pluginPath, options.readDirectory);
  for (const entryPath of traversal.entries) {
    if (
      inspected.entries.has(entryPath)
      || allowedUnlisted.has(entryPath)
      || allowedDirectories.has(entryPath)
    ) continue;
    failures.push({ ...entryLabel(entryPath), reason: "unexpected" });
  }
  if (traversal.issue) {
    failures.push({ id: "payload", path: ".", reason: traversal.issue });
  }
  const canonical = inspectCanonicalFrontend(pluginPath);
  if (!canonical.ok) {
    failures.push({
      id: "frontend-ui-ux",
      path: "references/_canonical-corpus",
      reason: "canonical verification failed",
    });
  }
  return {
    failures,
    manifestIssue: inspected.issue,
    ok: !inspected.issue && failures.length === 0,
  };
}

function inspectCanonicalFrontend(pluginPath) {
  return verifyCanonicalCorpus(path.join(
    pluginPath,
    "skills",
    "frontend-ui-ux",
    "references",
    "_canonical-corpus",
  ));
}

function scanPluginSkills(pluginPath, manifest, verifySourceHash = false) {
  const inspection = inspectSkillPayload(pluginPath, manifest, verifySourceHash);
  if (inspection.manifestIssue) return [];
  const failed = new Set(inspection.failures.map((failure) => failure.id));
  return requiredSkills.filter((id) => !failed.has(id));
}

function formatSkillPayload(inspection) {
  if (inspection.ok) return "PASS";
  if (inspection.manifestIssue) return `FAIL (${inspection.manifestIssue})`;
  const entrypointFailures = inspection.failures.filter((failure) => failure.path === "SKILL.md");
  const nestedFailures = inspection.failures.filter((failure) => failure.path !== "SKILL.md");
  const groups = new Map();
  for (const failure of entrypointFailures) {
    const ids = groups.get(failure.reason) || [];
    ids.push(failure.id);
    groups.set(failure.reason, ids);
  }
  const messages = [
    ...[...groups].map(([reason, ids]) => `${reason} ${ids.join(", ")}`),
    ...nestedFailures.map((failure) => `${failure.id}/${failure.path} ${failure.reason}`),
  ];
  return `FAIL (${messages.join("; ")})`;
}

module.exports = {
  MAX_PAYLOAD_FILE_BYTES,
  MAX_PAYLOAD_MANIFEST_BYTES,
  MAX_PAYLOAD_TOTAL_BYTES,
  capturePayloadInventory,
  capturePayloadManifest,
  formatSkillPayload,
  inspectCanonicalFrontend,
  inspectSkillPayload,
  readPayloadManifest,
  requiredSkills,
  scanPluginSkills,
};
