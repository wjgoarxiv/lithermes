#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TextDecoder } = require("node:util");
const {
  captureRegularFile,
  canonicalProtectedPaths,
  parseJsonRejectingDuplicateKeys,
  revalidateCanonicalCapture,
  revalidateDescriptorCapture,
} = require("../../src/lib/canonicalCorpus");
const {
  capturePayloadInventory,
  capturePayloadManifest,
  inspectSkillPayload,
} = require("../../src/lib/skillPayload");

const LEGACY_ALLOWLISTS = Object.freeze([]);
const CANONICAL_RELATIVE = path.join(
  "assets",
  "lithermes-plugin",
  "skills",
  "frontend-ui-ux",
  "references",
  "_canonical-corpus",
);
const PAYLOAD_MANIFEST_RELATIVE = "assets/lithermes-plugin/payload-version.json";
const FAMILY_PARITY_RELATIVE = path.join("tools", "payload-substance-parity.json");
const FAMILY_PARITY_SCHEMA = "litfamily.payload-parity/v1";
const FAMILY_PARITY_PRODUCTS = "p27,p28,p31,p32,p33";
const MAX_PACK_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_PACK_LIMITS = Object.freeze({
  deadlineMs: 120000,
  maxArchiveBytes: 12 * 1024 * 1024,
  maxFileBytes: MAX_PACK_FILE_BYTES,
  maxMembers: 2048,
  maxTotalBytes: 24 * 1024 * 1024,
});
const ESSENTIAL_PACK_PATHS = Object.freeze([
  "package.json",
  "bin/lithermes.js",
  "src/cli.js",
  PAYLOAD_MANIFEST_RELATIVE,
]);
const KNOWN_PACK_BINARY_SHA256 = Object.freeze({
  "cover.png": "245c14ebc4fd93a088928bc8d8effe8a45c6c0de47dad60b749722746fef5bfe",
  // The published landing set is binary by design. Each exact path is pinned
  // to its reviewed bytes; no wildcard or extension-wide exemption is allowed.
  "readme-assets/cover-motion.webp": "83f0361043b21e5aba1fdbc34737efc55f329eb36f76db6cddc6d40ad87301c7",
  "readme-assets/cover-motion-still.webp": "8f9165e78ae6789242b4f49f47dc741ffaad23195d528260536e04ad14fe981b",
  "readme-assets/ignition-film.mp4": "b1579c89a677ab453765f77ae6361bd9730fabc4291a85071de7f373fc5ebfad",
  "readme-assets/lithermes-clay-icon.png": "8e665c88d29b597fd317cb8c8ec77d6f2205601f473a0d5f50374df224b3e98d",
  // A/B captures (simple, UI and office rounds) are exact, reviewed package bytes.
  "readme-assets/ab-simple/s11-ui-baseline-desktop.webp": "d8613071b2a870b64a56479489c14bf293b828e67604b8dc91dd584b32bfa139",
  "readme-assets/ab-simple/s11-ui-lithermes-desktop.webp": "82fb428b48191b4131e75688d67f8033d4579edcdaf971e05f8584766813314e",
  "readme-assets/ab-simple/s3-ui-baseline-desktop.webp": "32415e925e7b1a2861422464ca117a5016ff5e5943f58253f15d91f9688a945c",
  "readme-assets/ab-simple/s3-ui-lithermes-desktop.webp": "3bf129535dcc461f75bd1e74841cab4e8fcac763c99ea1598b8765f7456eb713",
  "readme-assets/ab-simple/s4-ui-baseline-desktop.webp": "bcccb69a117d341f3ef516b0b0598c7f787a4d46229e638cffbe1aa7ab57c972",
  "readme-assets/ab-simple/s4-ui-lithermes-desktop.webp": "af95aadceb13f49c0527680aa2c2872ed89d54ea37db4a1159aabe6a16f5161d",
  "readme-assets/ab-simple/s5-office-baseline-slides.webp": "d8bed4db8b3af6a9b6f006a154f07fc968a8e8aff2e5cd5f818de6ebaa756d58",
  "readme-assets/ab-simple/s5-office-lithermes-slides.webp": "d9b93054fad20603ba81b06d7c8985cbecc684dc1104ea5d3a77bced7ae7393f",
  "readme-assets/ab-simple/s7-lithermes-diagram.webp": "d4a296c2e1109b099db355ee002c2cd727bed87365482d8866f8c99fbb1eff29",
  "readme-assets/ab-simple/s8-office-baseline-slides.webp": "767604c2b5943721ce4728aafc2205308e3296406ff7489e2df9264464601f72",
  "readme-assets/ab-simple/s8-office-lithermes-slides.webp": "ae60c127887f762cf98c4a27e2707ac13ed84fc5a2de70104647785a6a297d7c",
  "readme-assets/ab-simple/s9-office-lithermes-pages.webp": "16effc23896fbf107e27564e1cdc68d5f81df51f990523856133aaa3b839b224",
  // Skill-table snapshots are exact, reviewed package bytes.
  "readme-assets/skills/autoconference.webp": "714fd359e5e64d8a8537f51ce30fef3f0fb265a8b8e0d659f1471a01552bd327",
  "readme-assets/skills/autoresearch.webp": "beff5b0b60c39480e70fa61bccb1d97815a9bd1a8519dab8baccec54259c1b4d",
  "readme-assets/skills/browser-drive.webp": "55c6c1ff8df575bc8afda1672e76fbe08901121e44dd7db38614954d3afd3c77",
  "readme-assets/skills/comment-checker.webp": "179b6271df17bc6cbc921d10670e8ce5a5e4aee337fb81942aa54f4e24699ded",
  "readme-assets/skills/debugging.webp": "d5ae5c3fe37aaec927fb2742b02ba1a361c3d017d4205a5d5de797af5d8abe0b",
  "readme-assets/skills/deep-interview.webp": "d0b111a1ff0eb38abcf3f8ef75158987c3523e435a1554a9bfb700ef4d1a518f",
  "readme-assets/skills/frontend-ui-ux.webp": "fcbb795d1fb7f28e9c51eb9928bfd1cc7cdfebf93078fd47c08bc2f458c82705",
  "readme-assets/skills/lit-burnoff-file.webp": "6dc28fff3bc52191d2547da9ad8d0b19308f1a131c59247bad982a8b469c4c77",
  "readme-assets/skills/lit-burnoff.webp": "58ba0531705c81a04f66ce8518738b06a8678362c971cdf4bf81c9699e42b8df",
  "readme-assets/skills/lit-code.webp": "8f9293c1ddb28a4629c00f8b6ffe00af397b30eb56a98b73e99a40835c04fd1e",
  "readme-assets/skills/lit-commit.webp": "adff4431f4828146bc7d65350c14574c4af8bea65cbad78e548f5a3f45a7f783",
  "readme-assets/skills/lit-comprehend.webp": "5e30d6582da5c65682c8ccc2fccc3ed4d54738883a97ca6ddb8dc6cc653fa60a",
  "readme-assets/skills/lit-crucible.webp": "8a48b341eb5b72832ee00077410ceea4b124cef941744bb7828233b64fce544d",
  "readme-assets/skills/lit-diagram-drawer.webp": "5b42cc03d3de9eaa4f9fd39a0330a6237f442ed016f34ac4716556348f3f7b81",
  "readme-assets/skills/lit-docx.webp": "0bdc2c76ef73fb38837111bd5799d765cc01be0b466109ae18afbc55b652d0f5",
  "readme-assets/skills/lit-handoff.webp": "1c678486f68e6b7c218bccee43d10dae4dcadfac473908056d76b68c68227177",
  "readme-assets/skills/lit-humanizer.webp": "6814957815cf9c3b9d35780f936bdaa8730e6d911f1d33c14545489555d07ffe",
  "readme-assets/skills/lit-init.webp": "609aac152676687db6c06c83a91fa91d89148c7db4a8bfef816a2a9cea8bc04b",
  "readme-assets/skills/lit-plan.webp": "1819a93de45974358982bd5c03333e55cc77295033838c810b093b9632d3f162",
  "readme-assets/skills/lit-pptx.webp": "1521e8f86fd09e7d5f4a44bc11c56a41331eaa4ee2c77576dd2adb5602a43905",
  "readme-assets/skills/lit-recap.webp": "8fba68016247eabe23d5bbefcfabce2b1c4649910b8e65aaa7d1877d46409a10",
  "readme-assets/skills/lit-scientific-visualization.webp": "218d3af1e52c4c821619f11ed3cbff2075178e1de4cf358d86a2334b2ea86c54",
  "readme-assets/skills/lit-typographic-motion.webp": "5d3b7ec895faf1fbc05599839688da61c61a0219dedb13f865c7c46c4c57edf5",
  "readme-assets/skills/litgoal.webp": "816da75756800b42827bef8f4ffea653c741b16e1c0ad654ee1d4c11736bd256",
  "readme-assets/skills/litresearch.webp": "bb7695dacf353cc893b9d247967862c8ec93c9f4c98b050a96101e461ad62c9e",
  "readme-assets/skills/litwork.webp": "f1af74dad6e74bfd46483e739ad21021bd8ed529baca344cb427a26438ee701b",
  "readme-assets/skills/lsp-setup.webp": "6a64fde878ac623dab57f9cef369a040f5f4c42237df368b994039d8429f539e",
  "readme-assets/skills/lsp.webp": "3dc382f8175c45bfa90f635fe1de9ea8416855ff42c3c29f1941da2365239e32",
  "readme-assets/skills/readme-studio.webp": "bc4af441f0bfa904efef474c3b050207863a06c4e72b1e9808e5e0cc2b190f3d",
  "readme-assets/skills/refactor.webp": "8a68f73e52e981a0908e0688400e2087f4607ddcd61b97c22857d51a6dcdd470",
  "readme-assets/skills/review-work.webp": "9cb6795e4d43454a9d99abdaf42892ccc18495f06a5e48c54c69192f344141df",
  "readme-assets/skills/rules.webp": "7840ac6ac733d02af4bdb5ab39b4e6d07d545049bfc5c95762666a06f3a7d5e5",
  "readme-assets/skills/start-work.webp": "e6f38f748cc2a81b8985863bb593df3327cb5b14e86b35d92d473174f6b342ce",
  "readme-assets/skills/structural-search.webp": "35270d9c15b0fcc8ac074624b3f773dcd45315e36be460333941fd1f5c5b8d94",
  "readme-assets/skills/visual-qa.webp": "fc9d8fc735115ca6f1001d93071e6403d4002088b1176f699bf32da997f374c4",
  "readme-assets/skills/wikify.webp": "e5b138168de2a4b52bcbb3929b09e80381102348461f146a4bf02a36744e463e",
});
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

// Reference-origin and retired-lineage tokens, char-code encoded so this file
// itself carries no literal token (verified by the self-clean scanner test).
// mode "ident" matches only on non-letter boundaries, so the short product
// word is caught in dot-prefixed paths and underscored identifiers, but never
// inside benign English like "promote" or "homogeneous".
// `sep: true` also generates hyphen/underscore-split forms of the base word.
const TOKEN_CODES = [
  { codes: [108, 97, 122, 121, 99, 111, 100, 101, 120], mode: "substr", sep: true },
  { codes: [99, 111, 100, 101, 120], mode: "substr" },
  { codes: [111, 112, 101, 110, 99, 111, 100, 101], mode: "substr" },
  { codes: [104, 101, 112, 104, 97, 101, 115, 116, 117, 115], mode: "substr" },
  { codes: [115, 112, 97, 114, 107, 115, 104, 101, 108, 108], mode: "substr" },
  { codes: [111, 109, 111], mode: "ident" },
  { codes: [109, 111, 109, 117, 115], mode: "ident" },
  { codes: [109, 101, 116, 105, 115], mode: "ident" },
  { codes: [115, 105, 115, 121, 112, 104, 117, 115], mode: "ident" },
  // The retired own brand (substr + hyphen/underscore-split forms) — blocked
  // post-rebrand so it cannot regress into the new identity's packed surfaces.
  { codes: [108, 97, 122, 121, 104, 101, 114, 109, 101, 115], mode: "substr", sep: true },
  // The cross-product sibling brand (substr).
  { codes: [108, 97, 122, 121, 99, 108, 97, 117, 100, 101], mode: "substr" },
  // Retired workflow vocabulary and bounded short alias.
  { codes: [117, 108, 116, 114, 97, 119, 111, 114, 107], mode: "substr" },
  { codes: [117, 108, 116, 114, 97, 103, 111, 97, 108], mode: "substr" },
  { codes: [117, 108, 119], mode: "ident" },
  // Retired mirror marker.
  { codes: [115, 111, 117, 114, 99, 101, 45, 114, 101, 102, 101, 114, 101, 110, 99, 101], mode: "substr" },
];
const separators = ["", "-", "_"];
const splitIndex = 4;

function decode(codes) {
  return String.fromCharCode(...codes);
}

function title(value) {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseForms(token) {
  const base = decode(token.codes);
  if (!token.sep) return [base];
  const left = base.slice(0, splitIndex);
  const right = base.slice(splitIndex);
  return separators.map((separator) => `${left}${separator}${right}`);
}

// Example cased strings for every blocked form (used by --text path scanning,
// backward-compat consumers, and the variant-set test).
function variants() {
  const values = new Set();
  for (const token of TOKEN_CODES) {
    for (const form of baseForms(token)) {
      values.add(form.toLowerCase());
      values.add(form.toUpperCase());
      values.add(title(form));
    }
  }
  return [...values];
}

// The actual matchers: one case-insensitive regex per blocked form. "ident"
// tokens are bounded by non-letters to avoid false positives.
function needles() {
  const out = [];
  for (const token of TOKEN_CODES) {
    for (const form of baseForms(token)) {
      const escaped = escapeRe(form);
      const pattern =
        token.mode === "ident" ? `(?<![a-z])${escaped}(?![a-z])` : escaped;
      out.push({ label: form.toLowerCase(), re: new RegExp(pattern, "i") });
    }
  }
  return out;
}

function repoRoot(start = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function gitFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString("utf8") || result.stdout.toString("utf8")}`);
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => path.join(root, entry))
    .filter((entry) => fs.existsSync(entry));
}

function walkFiles(root, options = {}) {
  const out = [];
  const skipDirs = new Set([".git", "node_modules", "__pycache__", ".hermes"]);
  function visit(dir) {
    if (options.failOnSpecial) {
      const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error("non-regular filesystem root");
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
      else if (options.failOnSpecial) throw new Error("non-regular filesystem entry");
    }
  }
  if (fs.existsSync(root)) visit(root);
  return out;
}

function canonicalRootFor(root) {
  const candidates = [
    path.join(root, "packages", "lithermes-installer", CANONICAL_RELATIVE),
    path.join(root, CANONICAL_RELATIVE),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function canonicalProtection(files, root) {
  const canonicalRoot = canonicalRootFor(root);
  if (!canonicalRoot) return { paths: new Set(), capture: null, failure: null };
  const resolvedRoot = path.resolve(canonicalRoot);
  const touchesCanonical = files.some((file) => {
    const resolved = path.resolve(file);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
  });
  if (!touchesCanonical) return { paths: new Set(), capture: null, failure: null };
  const result = canonicalProtectedPaths(canonicalRoot);
  return result.ok
    ? { paths: result.paths, capture: result.capture, failure: null }
    : { paths: new Set(), capture: null, failure: { path: path.relative(root, canonicalRoot), where: "canonical-verification-failed" } };
}

function familyParityManifestPath(root) {
  const nested = path.join(root, "packages", "lithermes-installer", FAMILY_PARITY_RELATIVE);
  const direct = path.join(root, FAMILY_PARITY_RELATIVE);
  if (fs.existsSync(nested)) return nested;
  if (fs.existsSync(direct)) return direct;
  return null;
}

function inspectFamilyParityManifest(buffer) {
  const parsed = parseJsonRejectingDuplicateKeys(buffer.toString("utf8"));
  if (!parsed || parsed.schema !== FAMILY_PARITY_SCHEMA) throw new Error("schema");
  if (parsed.scope !== "parity-enrolled") throw new Error("scope");
  if (!parsed.products || typeof parsed.products !== "object" || Array.isArray(parsed.products)) {
    throw new Error("products");
  }
  if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    throw new Error("skills");
  }
  if (Object.keys(parsed.products).sort().join(",") !== FAMILY_PARITY_PRODUCTS) {
    throw new Error("products");
  }
  return parsed;
}

function familyParityProtection(files, root) {
  const manifestPath = familyParityManifestPath(root);
  if (!manifestPath) return { paths: new Set(), capture: null, failure: null };
  const resolved = path.resolve(manifestPath);
  if (!files.some((file) => path.resolve(file) === resolved)) {
    return { paths: new Set(), capture: null, failure: null };
  }
  try {
    const captured = captureRegularFile(path.dirname(manifestPath), path.basename(manifestPath), {
      maxFileBytes: MAX_PACK_FILE_BYTES,
      maxTotalBytes: MAX_PACK_FILE_BYTES,
    });
    if (!captured.ok || !captured.record) throw new Error("capture");
    inspectFamilyParityManifest(captured.record.buffer);
    return { paths: new Set([resolved]), capture: captured.capture, failure: null };
  } catch {
    return {
      paths: new Set(),
      capture: null,
      failure: { path: path.relative(root, manifestPath), where: "family-parity-verification-failed" },
    };
  }
}

function payloadManifestProtection(files, root) {
  const canonicalRoot = canonicalRootFor(root);
  if (!canonicalRoot) return { paths: new Set(), capture: null, failure: null };
  const pluginRoot = path.resolve(canonicalRoot, "..", "..", "..", "..");
  const manifestPath = path.join(pluginRoot, "payload-version.json");
  if (!files.some((file) => path.resolve(file) === manifestPath)) {
    return { paths: new Set(), capture: null, failure: null };
  }
  try {
    const captured = capturePayloadManifest(manifestPath);
    if (!captured.ok || !captured.manifest) throw new Error("payload JSON invalid");
    const inspection = inspectSkillPayload(pluginRoot, captured.manifest, true);
    if (!inspection.ok) throw new Error("payload invalid");
    return { paths: new Set([manifestPath]), capture: captured.capture, failure: null };
  } catch {
    return {
      paths: new Set(),
      capture: null,
      failure: { path: path.relative(root, manifestPath), where: "payload-manifest-verification-failed" },
    };
  }
}

function scanFiles(files, root = repoRoot()) {
  const ns = needles();
  const hits = [];
  const protection = canonicalProtection(files, root);
  if (protection.failure) hits.push(protection.failure);
  const payloadProtection = payloadManifestProtection(files, root);
  if (payloadProtection.failure) hits.push(payloadProtection.failure);
  const parityProtection = familyParityProtection(files, root);
  if (parityProtection.failure) hits.push(parityProtection.failure);
  for (const file of files) {
    const resolved = path.resolve(file);
    const canonicalRecord = protection.capture?.files.get(resolved);
    const payloadRecord = payloadProtection.capture?.files.get(resolved);
    const parityRecord = parityProtection.capture?.files.get(resolved);
    const protectedRecord = canonicalRecord || payloadRecord || parityRecord;
    const relative = path.relative(root, file) || file;
    if (!protectedRecord) {
      for (const needle of ns) {
        if (needle.re.test(relative)) {
          hits.push({ path: relative, where: `path:${needle.label}` });
        }
      }
    }
    let buffer;
    if (protectedRecord) {
      // Verified exemptions consume exact descriptor-captured bytes, never a
      // later path read. Matches in that immutable snapshot are scoped to the
      // verified carrier/corpus; all other buffers use the ordinary scanner.
      buffer = protectedRecord.buffer;
    } else {
      try {
        buffer = fs.readFileSync(file);
      } catch (error) {
        hits.push({ path: relative, where: `read-error:${error.message}` });
        continue;
      }
    }
    // Skip content scanning for binary files: a NUL byte in the first chunk is a
    // reliable binary marker. Short ident tokens (3 bytes) otherwise hit random
    // binary data (e.g. PNG assets). Binary files are still path-scanned above.
    if (buffer.subarray(0, 8000).includes(0)) continue;
    // latin1 preserves every byte 1:1, so ASCII tokens survive intact.
    const text = buffer.toString("latin1");
    for (const needle of ns) {
      if (needle.re.test(text) && !protectedRecord) {
        hits.push({ path: relative, where: `content:${needle.label}` });
      }
    }
  }
  if (protection.capture && !revalidateCanonicalCapture(protection.capture)) {
    hits.push({ path: path.relative(root, canonicalRootFor(root)), where: "canonical-verification-failed" });
  }
  if (payloadProtection.capture && !revalidateDescriptorCapture(payloadProtection.capture)) {
    hits.push({
      path: path.relative(root, [...payloadProtection.paths][0]),
      where: "payload-manifest-verification-failed",
    });
  }
  if (parityProtection.capture && !revalidateDescriptorCapture(parityProtection.capture)) {
    hits.push({
      path: path.relative(root, [...parityProtection.paths][0]),
      where: "family-parity-verification-failed",
    });
  }
  return hits;
}

function isContainedCanonicalRelative(root, relative) {
  if (typeof relative !== "string" || !relative || relative !== relative.replaceAll("\\", "/")) return false;
  if (path.posix.isAbsolute(relative)) return false;
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...parts);
  const relation = path.relative(resolvedRoot, candidate);
  return relation !== ""
    && !path.isAbsolute(relation)
    && relation !== ".."
    && !relation.startsWith(`..${path.sep}`);
}

function canonicalPackProjection(entries, root) {
  const prefix = `${CANONICAL_RELATIVE.split(path.sep).join("/")}/`;
  const projected = entries.filter((entry) => entry.startsWith(prefix));
  if (!projected.length) return { protectedPaths: new Set(), capturedBytes: new Map(), capture: null, hits: [] };
  const canonicalRoot = canonicalRootFor(root);
  if (!canonicalRoot) {
    return { protectedPaths: new Set(), capturedBytes: new Map(), capture: null, hits: [{ path: prefix, where: "canonical-source-missing" }] };
  }
  const protection = canonicalProtectedPaths(canonicalRoot);
  if (!protection.ok) {
    return { protectedPaths: new Set(), capturedBytes: new Map(), capture: null, hits: [{ path: prefix, where: "canonical-verification-failed" }] };
  }
  const expected = new Set();
  const capturedBytes = new Map();
  for (const relative of protection.inventory) {
    if (!isContainedCanonicalRelative(canonicalRoot, relative)) {
      return { protectedPaths: new Set(), capturedBytes: new Map(), capture: null, hits: [{ path: prefix, where: "canonical-inventory-outside-root" }] };
    }
    const packedPath = `${prefix}${relative}`;
    expected.add(packedPath);
    const record = protection.capture.files.get(path.resolve(canonicalRoot, ...relative.split("/")));
    if (record) capturedBytes.set(packedPath, record.buffer);
  }
  const actual = new Set(projected);
  const hits = [];
  for (const entry of actual) {
    if (!isContainedCanonicalRelative(canonicalRoot, entry.slice(prefix.length))) {
      hits.push({ path: prefix, where: "canonical-pack-outside-root" });
    }
  }
  for (const entry of expected) if (!actual.has(entry)) hits.push({ path: prefix, where: "canonical-pack-missing" });
  for (const entry of actual) if (!expected.has(entry)) hits.push({ path: prefix, where: "canonical-pack-extra" });
  if (capturedBytes.size !== expected.size) hits.push({ path: prefix, where: "canonical-capture-incomplete" });
  return { protectedPaths: expected, capturedBytes, capture: protection.capture, hits };
}

function scanPackPathsWithProjection(entries, projection) {
  const hits = [...projection.hits];
  const ns = needles();
  for (const entry of entries) {
    if (projection.protectedPaths.has(entry)) continue;
    for (const needle of ns) {
      if (needle.re.test(entry)) hits.push({ path: entry, where: `pack-path:${needle.label}` });
    }
  }
  return hits;
}

function scanPackPaths(entries, root) {
  const projection = canonicalPackProjection(entries, root);
  const hits = scanPackPathsWithProjection(entries, projection);
  if (projection.capture && !revalidateCanonicalCapture(projection.capture)) {
    hits.push({ path: CANONICAL_RELATIVE, where: "canonical-verification-failed" });
  }
  return hits;
}

function safePackMember(member, type) {
  if (typeof member !== "string" || !member.startsWith("package/") || member.includes("\\") || /[\0-\x1f\x7f]/.test(member)) return null;
  const relative = member.slice("package/".length);
  const directory = type === "d";
  if (directory && relative === "") return ".";
  const normalized = directory && relative.endsWith("/") ? relative.slice(0, -1) : relative;
  if (!normalized || path.posix.isAbsolute(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (directory !== member.endsWith("/")) return null;
  return normalized;
}

function packScanError(where) {
  const error = new Error(where);
  error.where = where;
  return error;
}

function portablePackKey(relative) {
  return relative.normalize("NFC").toLowerCase();
}

function readPackArchiveMembers(archive, requestedLimits = {}) {
  const limits = { ...DEFAULT_PACK_LIMITS, ...requestedLimits };
  const deadline = requestedLimits.deadlineAt ?? Date.now() + limits.deadlineMs;
  const remaining = () => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw packScanError("pack-tar-deadline");
    return timeout;
  };
  const runTar = (args, encoding, maxBuffer) => {
    const result = spawnSync("tar", args, {
      encoding,
      maxBuffer,
      timeout: remaining(),
    });
    if (result.error?.code === "ETIMEDOUT") throw packScanError("pack-tar-deadline");
    if (result.error || result.status !== 0) throw packScanError("pack-tar-unreadable");
    remaining();
    return result;
  };
  let archiveStat;
  try {
    remaining();
    archiveStat = fs.lstatSync(archive, { throwIfNoEntry: false });
  } catch (error) {
    if (error?.where) throw error;
    throw packScanError("pack-tar-unreadable");
  }
  if (!archiveStat?.isFile() || archiveStat.isSymbolicLink()) throw packScanError("pack-tar-unreadable");
  if (archiveStat.size > limits.maxArchiveBytes) throw packScanError("pack-tar-compressed-too-large");

  const listed = runTar(["-tzf", archive], "utf8", 2 * 1024 * 1024);
  const names = listed.stdout.split(/\r?\n/).filter(Boolean);
  if (names.length > limits.maxMembers) throw packScanError("pack-tar-member-limit");
  const verbose = runTar(["-tvzf", archive], "utf8", 2 * 1024 * 1024);
  const details = verbose.stdout.split(/\r?\n/).filter(Boolean);
  if (names.length !== details.length || names.some((name) => name.includes("\ufffd"))) {
    throw packScanError("pack-tar-unreadable");
  }

  const hits = [];
  const entries = [];
  const records = [];
  const counts = new Map();
  const portable = new Map();
  names.forEach((member, index) => {
    const type = details[index][0];
    if (/[^\x00-\x7f]/.test(member)) {
      hits.push({ path: "<pack-tar>", where: "pack-tar-non-ascii-path" });
      return;
    }
    const relative = safePackMember(member, type);
    if (!relative) {
      hits.push({ path: "<pack-tar>", where: "pack-tar-unsafe-member" });
      return;
    }
    const entryType = type === "d" ? "directory" : type === "-" ? "file" : "special";
    if (entryType === "special") {
      hits.push({ path: relative, where: "pack-tar-unsafe-member" });
      return;
    }
    const parts = relative === "." ? [relative] : relative.split("/");
    for (let partCount = 1; partCount <= parts.length; partCount += 1) {
      const nodePath = parts.slice(0, partCount).join("/");
      const nodeType = partCount === parts.length ? entryType : "directory";
      const key = portablePackKey(nodePath);
      const prior = portable.get(key);
      if (prior) {
        if (prior.type !== nodeType) {
          hits.push({ path: relative, where: "pack-tar-file-directory-collision" });
        } else if (prior.path !== nodePath) {
          hits.push({ path: relative, where: "pack-tar-portable-collision" });
        }
      } else {
        portable.set(key, { path: nodePath, type: nodeType });
      }
    }
    const exactKey = `${entryType}:${relative}`;
    counts.set(exactKey, (counts.get(exactKey) || 0) + 1);
    entries.push({ member, path: relative, type: entryType });
    if (entryType === "file") records.push({ member, path: relative });
  });
  for (const [entry, count] of counts) {
    if (count > 1) hits.push({ path: entry.slice(entry.indexOf(":") + 1), where: "pack-tar-duplicate-path" });
  }
  const regularKeys = new Set(entries.filter((entry) => entry.type === "file").map((entry) => portablePackKey(entry.path)));
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      if (regularKeys.has(portablePackKey(parts.slice(0, index).join("/")))) {
        hits.push({ path: entry.path, where: "pack-tar-file-directory-collision" });
        break;
      }
    }
  }

  const filePaths = [...new Set(records.map((record) => record.path))];
  if (hits.length) return { hits, filePaths, regularFiles: [] };
  const regularFiles = [];
  let totalBytes = 0;
  for (const record of records) {
    if (counts.get(`file:${record.path}`) !== 1) continue;
    let extracted;
    try {
      extracted = runTar(["-xOzf", archive, record.member], "buffer", limits.maxFileBytes + 1);
    } catch (error) {
      if (error?.where === "pack-tar-deadline") throw error;
      hits.push({ path: record.path, where: "pack-tar-member-unreadable" });
      continue;
    }
    const buffer = Buffer.from(extracted.stdout);
    if (buffer.length > limits.maxFileBytes) {
      hits.push({ path: record.path, where: "pack-tar-member-unreadable" });
      continue;
    }
    totalBytes += buffer.length;
    if (totalBytes > limits.maxTotalBytes) throw packScanError("pack-tar-aggregate-too-large");
    regularFiles.push({ ...record, buffer });
  }
  const afterArchive = fs.lstatSync(archive, { throwIfNoEntry: false });
  if (!afterArchive?.isFile()
    || afterArchive.isSymbolicLink()
    || afterArchive.dev !== archiveStat.dev
    || afterArchive.ino !== archiveStat.ino
    || afterArchive.size !== archiveStat.size
    || afterArchive.ctimeMs !== archiveStat.ctimeMs
    || afterArchive.mtimeMs !== archiveStat.mtimeMs) {
    throw packScanError("pack-tar-unreadable");
  }
  remaining();
  return { hits, filePaths, regularFiles };
}

function payloadPackProjection(entries, root) {
  if (!entries.includes(PAYLOAD_MANIFEST_RELATIVE)) {
    return { capture: null, capturedBytes: new Map(), hits: [] };
  }
  const canonicalRoot = canonicalRootFor(root);
  if (!canonicalRoot) {
    return {
      capture: null,
      capturedBytes: new Map(),
      hits: [{ path: PAYLOAD_MANIFEST_RELATIVE, where: "payload-pack-verification-failed" }],
    };
  }
  const pluginRoot = path.resolve(canonicalRoot, "..", "..", "..", "..");
  const protection = capturePayloadInventory(pluginRoot);
  if (!protection.ok) {
    return {
      captures: [],
      capturedBytes: new Map(),
      hits: [{ path: PAYLOAD_MANIFEST_RELATIVE, where: "payload-pack-verification-failed" }],
    };
  }
  const prefix = "assets/lithermes-plugin/";
  const expected = new Set([PAYLOAD_MANIFEST_RELATIVE]);
  const capturedBytes = new Map([[PAYLOAD_MANIFEST_RELATIVE, protection.manifestBuffer]]);
  for (const [relative, buffer] of protection.capturedBytes) {
    const packedPath = `${prefix}${relative}`;
    expected.add(packedPath);
    capturedBytes.set(packedPath, buffer);
  }
  const actual = new Set(entries.filter((entry) => entry.startsWith(prefix)));
  const hits = [];
  for (const entry of expected) {
    if (!actual.has(entry)) hits.push({ path: entry, where: "payload-pack-missing" });
  }
  for (const entry of actual) {
    if (!expected.has(entry)) hits.push({ path: entry, where: "payload-pack-extra" });
  }
  return {
    captures: protection.captures,
    capturedBytes,
    hits,
  };
}

function scanOrdinaryBuffer(buffer, ns, pathLabel, wherePrefix) {
  const text = buffer.toString("latin1");
  return ns
    .filter((needle) => needle.re.test(text))
    .map((needle) => ({ path: pathLabel, where: `${wherePrefix}:${needle.label}` }));
}

function isCredibleUtf8Text(buffer) {
  try {
    const text = UTF8_DECODER.decode(buffer);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text);
  } catch {
    return false;
  }
}

function writeCapturedPackSnapshot(buffer, requestedPath) {
  let directory;
  let snapshot;
  let removeDirectory = false;
  if (requestedPath) {
    snapshot = path.resolve(requestedPath);
    directory = path.dirname(snapshot);
    const parent = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!parent?.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) {
      throw packScanError("pack-tar-snapshot-output-unsafe");
    }
  } else {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-pack-snapshot."));
    snapshot = path.join(directory, "validated.tgz");
    removeDirectory = true;
  }
  try {
    fs.writeFileSync(snapshot, buffer, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (removeDirectory) fs.rmSync(directory, { recursive: true, force: true });
    if (error?.where) throw error;
    throw packScanError("pack-tar-snapshot-write-failed");
  }
  return {
    path: snapshot,
    remove() {
      if (removeDirectory) fs.rmSync(directory, { recursive: true, force: true });
      else fs.rmSync(snapshot, { force: true });
    },
  };
}

function capturePackArchiveSnapshot(archive, limits, snapshotOut) {
  const absolute = path.resolve(archive);
  const captured = captureRegularFile(path.dirname(absolute), path.basename(absolute), {
    maxFileBytes: limits.maxArchiveBytes,
    maxTotalBytes: limits.maxArchiveBytes,
  });
  if (!captured.ok || !captured.record) {
    const tooLarge = captured.failures?.some((failure) => /file-too-large|aggregate-too-large/.test(failure));
    throw packScanError(tooLarge ? "pack-tar-compressed-too-large" : "pack-tar-capture-failed");
  }
  const buffer = captured.record.buffer;
  return {
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    snapshot: writeCapturedPackSnapshot(buffer, snapshotOut),
  };
}

function scanPackSnapshot(archive, root, options = {}) {
  const limits = { ...DEFAULT_PACK_LIMITS, ...(options.limits || {}) };
  const deadlineAt = options.deadlineAt ?? Date.now() + limits.deadlineMs;
  const deadlineHit = () => Date.now() >= deadlineAt;
  let archiveRead;
  try {
    archiveRead = readPackArchiveMembers(archive, { ...limits, deadlineAt });
  } catch (error) {
    return [{ path: "<pack-tar>", where: error?.where || "pack-tar-unreadable" }];
  }
  if (deadlineHit()) return [{ path: "<pack-tar>", where: "pack-tar-deadline" }];
  const files = archiveRead.filePaths;
  const projection = canonicalPackProjection(files, root);
  if (deadlineHit()) return [{ path: "<pack-tar>", where: "pack-tar-deadline" }];
  const payloadProjection = payloadPackProjection(files, root);
  if (deadlineHit()) return [{ path: "<pack-tar>", where: "pack-tar-deadline" }];
  const hits = [
    ...archiveRead.hits,
    ...scanPackPathsWithProjection(files, projection),
    ...payloadProjection.hits,
  ];
  if (options.requirePackageIdentity !== false) {
    const actual = new Set(files);
    for (const essential of ESSENTIAL_PACK_PATHS) {
      if (!actual.has(essential)) hits.push({ path: essential, where: "pack-tar-essential-missing" });
    }
  }
  const ns = needles();
  for (const file of archiveRead.regularFiles) {
    const canonicalExpected = projection.capturedBytes.get(file.path);
    const payloadExpected = payloadProjection.capturedBytes.get(file.path);
    const expected = canonicalExpected || payloadExpected;
    if (expected) {
      if (!file.buffer.equals(expected)) {
        hits.push({
          path: file.path,
          where: canonicalExpected ? "canonical-pack-byte-mismatch" : "payload-pack-byte-mismatch",
        });
      }
    } else {
      const expectedBinaryHash = KNOWN_PACK_BINARY_SHA256[file.path];
      if (expectedBinaryHash) {
        const actualHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
        if (actualHash !== expectedBinaryHash) {
          hits.push({ path: file.path, where: "pack-binary-byte-mismatch" });
        }
      } else {
        hits.push(...scanOrdinaryBuffer(file.buffer, ns, file.path, "pack-content"));
        if (!isCredibleUtf8Text(file.buffer)) {
          hits.push({ path: file.path, where: "pack-binary-unrecognized" });
        }
      }
    }
  }
  if (projection.capture && !revalidateCanonicalCapture(projection.capture)) {
    hits.push({ path: CANONICAL_RELATIVE, where: "canonical-verification-failed" });
  }
  if (payloadProjection.captures?.some((capture) => !revalidateDescriptorCapture(capture))) {
    hits.push({ path: PAYLOAD_MANIFEST_RELATIVE, where: "payload-pack-verification-failed" });
  }
  if (deadlineHit()) hits.push({ path: "<pack-tar>", where: "pack-tar-deadline" });
  return hits;
}

function scanPackArchiveDetailed(archive, root, options = {}) {
  const limits = { ...DEFAULT_PACK_LIMITS, ...(options.limits || {}) };
  const deadlineAt = Date.now() + limits.deadlineMs;
  if (Date.now() >= deadlineAt) {
    return { bytes: null, hits: [{ path: "<pack-tar>", where: "pack-tar-deadline" }], sha256: null };
  }
  let captured;
  try {
    captured = capturePackArchiveSnapshot(archive, limits, options.snapshotOut);
  } catch (error) {
    return { bytes: null, hits: [{ path: "<pack-tar>", where: error?.where || "pack-tar-capture-failed" }], sha256: null };
  }
  let hits;
  try {
    if (Date.now() >= deadlineAt) {
      hits = [{ path: "<pack-tar>", where: "pack-tar-deadline" }];
    } else {
      hits = scanPackSnapshot(captured.snapshot.path, root, { ...options, deadlineAt, limits });
    }
  } catch {
    hits = [{ path: "<pack-tar>", where: "pack-tar-unreadable" }];
  }
  if (!options.snapshotOut || hits.length) captured.snapshot.remove();
  return { bytes: captured.bytes, hits, sha256: captured.sha256 };
}

function scanPackArchive(archive, root, options = {}) {
  return scanPackArchiveDetailed(archive, root, options).hits;
}

function scanText(text) {
  const found = new Set();
  for (const needle of needles()) {
    if (needle.re.test(text)) found.add(needle.label);
  }
  return [...found];
}

function readPackJson(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const files = Array.isArray(raw) ? raw.flatMap((entry) => entry.files || []) : raw.files || [];
  return files.map((entry) => entry.path || "").filter(Boolean);
}

function parseCliArgs(argv) {
  const out = { root: null, externalTerms: null, json: false, snapshotOut: null, rest: [] };
  const valueFor = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      out.root = valueFor(arg, i);
      i += 1;
    } else if (arg === "--external-terms") {
      out.externalTerms = valueFor(arg, i);
      i += 1;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--snapshot-out") {
      out.snapshotOut = valueFor(arg, i);
      i += 1;
    } else if (arg === "--pack-json" || arg === "--pack-tar" || arg === "--text") {
      out.rest.push(arg, valueFor(arg, i));
      i += 1;
    } else if (arg === "--tracked" || arg === "--package-root") {
      out.rest.push(arg);
    } else {
      throw new Error("unknown scanner argument");
    }
  }
  if (out.snapshotOut && !out.rest.includes("--pack-tar")) throw new Error("--snapshot-out requires --pack-tar");
  if (out.snapshotOut && out.externalTerms) throw new Error("--snapshot-out is unavailable in external mode");
  return out;
}

function normalizedOpaque(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function loadExternalTerms(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("external terms file must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.terms)) {
    throw new Error("external terms must be an object with version 1 and terms array");
  }
  const ids = new Set();
  return parsed.terms.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`terms[${index}] must be an object`);
    }
    for (const field of ["id", "value", "matchMode"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        throw new Error(`terms[${index}].${field} must be a non-empty string`);
      }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(entry.id)) {
      throw new Error(`terms[${index}].id must be an opaque identifier`);
    }
    const normalizedValue = normalizedOpaque(entry.value);
    if (normalizedValue && normalizedOpaque(entry.id).includes(normalizedValue)) {
      throw new Error(`terms[${index}].id must not contain the term value`);
    }
    if (ids.has(entry.id)) throw new Error(`terms[${index}].id must be unique`);
    ids.add(entry.id);
    if (!['substring', 'bounded'].includes(entry.matchMode)) {
      throw new Error(`terms[${index}].matchMode must be substring or bounded`);
    }
    return { id: entry.id, value: entry.value, matchMode: entry.matchMode };
  });
}

function externalNeedles(terms) {
  return terms.map((term) => ({
    id: term.id,
    value: term.value,
    re: new RegExp(
      term.matchMode === "bounded"
        ? `(?<![A-Za-z0-9_])${escapeRe(term.value)}(?![A-Za-z0-9_])`
        : escapeRe(term.value),
      "iu",
    ),
  }));
}

function externalHit(fileId, termId) {
  return { fileId, termId };
}

function scanExternalStrings(entries, terms, prefix) {
  const ns = externalNeedles(terms);
  const hits = [];
  entries.forEach((text, index) => {
    for (const needle of ns) {
      if (needle.re.test(text)) hits.push(externalHit(`${prefix}:${index + 1}`, needle.id));
    }
  });
  return hits;
}

function scanExternalFiles(files, root, terms) {
  const ns = externalNeedles(terms);
  const hits = [];
  files.forEach((file, index) => {
    const relative = path.relative(root, file) || file;
    const fileId = `file:${index + 1}`;
    for (const needle of ns) {
      if (needle.re.test(relative)) hits.push(externalHit(fileId, needle.id));
    }
    const normalizedRelative = relative.split(path.sep).join("/");
    const captured = captureRegularFile(root, normalizedRelative, {
      maxFileBytes: MAX_PACK_FILE_BYTES,
      maxTotalBytes: MAX_PACK_FILE_BYTES,
    });
    if (!captured.ok || !captured.record) {
      throw new Error(`external file ${fileId} unreadable`);
    }
    const buffer = captured.record.buffer;
    const latin1 = buffer.toString("latin1");
    const utf8 = buffer.toString("utf8");
    for (const needle of ns) {
      if (needle.re.test(latin1) || needle.re.test(utf8)) hits.push(externalHit(fileId, needle.id));
    }
    if (!revalidateDescriptorCapture(captured.capture)) {
      throw new Error(`external file ${fileId} changed`);
    }
  });
  return hits;
}

function scanExternalPackArchive(archive, terms) {
  const limits = { ...DEFAULT_PACK_LIMITS };
  const captured = capturePackArchiveSnapshot(archive, limits);
  try {
    const archiveRead = readPackArchiveMembers(captured.snapshot.path, limits);
    if (archiveRead.hits.length) throw new Error("external pack tar is unsafe or unreadable");
    const ns = externalNeedles(terms);
    const hits = [];
    archiveRead.regularFiles.forEach((file, index) => {
      const fileId = `pack-tar:${index + 1}`;
      for (const needle of ns) {
        if (needle.re.test(file.path)) hits.push(externalHit(fileId, needle.id));
      }
      const latin1 = file.buffer.toString("latin1");
      const utf8 = file.buffer.toString("utf8");
      for (const needle of ns) {
        if (needle.re.test(latin1) || needle.re.test(utf8)) hits.push(externalHit(fileId, needle.id));
      }
    });
    return hits;
  } finally {
    captured.snapshot.remove();
  }
}

function formatHits(hits) {
  return hits.map((hit) => `${hit.path} ${hit.where}`).join("\n");
}

function formatExternalHits(hits) {
  return hits.map((hit) => `${hit.fileId} [${hit.termId}]`).join("\n");
}

function externalScanHits(options, root, terms) {
  let hits = [];
  const hasSurface = options.rest.some((arg) => ["--tracked", "--package-root", "--pack-json", "--pack-tar", "--text"].includes(arg));
  if (options.rest.includes("--tracked")) {
    hits = hits.concat(scanExternalFiles(gitFiles(root), root, terms));
  }
  if (options.rest.includes("--package-root")) {
    hits = hits.concat(scanExternalFiles(walkFiles(path.join(root, "packages", "lithermes-installer"), { failOnSpecial: true }), root, terms));
  }
  const packIndex = options.rest.indexOf("--pack-json");
  if (packIndex !== -1) {
    if (!options.rest[packIndex + 1] || options.rest[packIndex + 1].startsWith("--")) {
      throw new Error("--pack-json requires a value");
    }
    hits = hits.concat(scanExternalStrings(readPackJson(options.rest[packIndex + 1]), terms, "pack"));
  }
  const packTarIndex = options.rest.indexOf("--pack-tar");
  if (packTarIndex !== -1) {
    hits = hits.concat(scanExternalPackArchive(options.rest[packTarIndex + 1], terms));
  }
  const textIndex = options.rest.indexOf("--text");
  if (textIndex !== -1) {
    if (!options.rest[textIndex + 1] || options.rest[textIndex + 1].startsWith("--")) {
      throw new Error("--text requires a value");
    }
    hits = hits.concat(scanExternalStrings([options.rest[textIndex + 1]], terms, "text"));
  }
  if (!hasSurface) {
    hits = hits.concat(scanExternalFiles(options.root ? walkFiles(root, { failOnSpecial: true }) : gitFiles(root), root, terms));
  }
  return hits;
}

function runCli(argv) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`scanner argument error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const root = options.root ? path.resolve(options.root) : repoRoot();
  if (options.externalTerms) {
    try {
      const terms = loadExternalTerms(path.resolve(options.externalTerms));
      const hits = externalScanHits(options, root, terms);
      if (options.json) process.stdout.write(`${JSON.stringify({ ok: hits.length === 0, hits })}\n`);
      else if (hits.length) process.stderr.write(`${formatExternalHits(hits)}\n`);
      return hits.length ? 1 : 0;
    } catch {
      process.stderr.write("external-term scanner error: external scan failed\n");
      return 2;
    }
  }
  let hits = [];
  let packResult = null;
  if (options.rest.includes("--tracked")) {
    hits = hits.concat(scanFiles(gitFiles(root), root));
  }
  if (options.rest.includes("--package-root")) {
    hits = hits.concat(scanFiles(walkFiles(path.join(root, "packages", "lithermes-installer")), root));
  }
  const packIndex = options.rest.indexOf("--pack-json");
  if (packIndex !== -1) {
    const entries = readPackJson(options.rest[packIndex + 1]);
    hits = hits.concat(scanPackPaths(entries, root));
  }
  const packTarIndex = options.rest.indexOf("--pack-tar");
  if (packTarIndex !== -1) {
    packResult = scanPackArchiveDetailed(options.rest[packTarIndex + 1], root, {
      snapshotOut: options.snapshotOut,
    });
    hits = hits.concat(packResult.hits);
  }
  const textIndex = options.rest.indexOf("--text");
  if (textIndex !== -1) {
    hits = hits.concat(scanText(options.rest[textIndex + 1] || "").map((value) => ({ path: "<text>", where: value })));
  }
  if (!options.rest.length) {
    hits = hits.concat(scanFiles(gitFiles(root), root));
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: hits.length === 0,
      hits,
      ...(packResult ? {
        validatedArchive: {
          bytes: packResult.bytes,
          sha256: packResult.sha256,
          source: "descriptor-captured-private-snapshot",
        },
      } : {}),
    })}\n`);
  } else if (hits.length) {
    process.stderr.write(`${formatHits(hits)}\n`);
  } else if (packResult) {
    process.stdout.write(`validated-pack sha256=${packResult.sha256} bytes=${packResult.bytes} source=descriptor-captured-private-snapshot\n`);
  }
  return hits.length ? 1 : 0;
}

module.exports = {
  LEGACY_ALLOWLISTS,
  formatHits,
  gitFiles,
  needles,
  repoRoot,
  scanFiles,
  scanPackArchive,
  scanPackArchiveDetailed,
  scanPackPaths,
  scanText,
  variants,
  walkFiles,
};

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
