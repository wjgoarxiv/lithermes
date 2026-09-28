const crypto = require("node:crypto");
const { isMap, isScalar, parseDocument, visit } = require("yaml");

// Host versions whose source and runtime markers were checked against this schema by
// hand. Being outside this set is not a rejection: an exact-membership gate turns every
// future Hermes release into a silent capability outage, which is precisely how the
// July 2026 campaign's headline defect happened (the set held 0.17.0 while the host had
// moved to 0.19.0, and the plugin went inert). The real gate is the source/runtime
// marker check below, which is probed from the host that is actually running.
const VERIFIED_HOST_VERSIONS = new Set(["0.17.0", "0.19.0"]);
const VERIFIED_HOST_VERSION_TEXT = [...VERIFIED_HOST_VERSIONS].join(", ");
// Below this the managed schema did not exist, so forward compatibility must not become
// backward acceptance.
const MINIMUM_HOST_VERSION = "0.17.0";
// Sentinel `hostVersion` for a dry-run, which deliberately never executes the Hermes
// binary. Distinguishes "never probed" from a real host whose banner came back empty or
// malformed, which must still be reported as unsupported.
const NOT_PROBED_HOST_VERSION = "__lithermes_dry_run_not_probed__";
const CONFIG_VERSION = 30;
const VERIFIED_CONFIG_VERSION = 45;
const CREDENTIAL_KEY = /(^|[_-])(api[_-]?key|client[_-]?secret|auth[_-]?token|(?:aws[_-]?)?access[_-]?key(?:[_-]?id)?|(?:ssh[_-]?)?private[_-]?key|token|password|passphrase|secret|credential|authorization)([_-]|$)/i;
const MAP_PATHS = ["model", "agent", "delegation", "compression"];
const SCALAR_PATHS = [
  ["model", "provider"],
  ["model", "default"],
  ["model", "context_length"],
  ["agent", "reasoning_effort"],
  ["delegation", "model"],
  ["delegation", "reasoning_effort"],
  ["delegation", "provider"],
  ["delegation", "base_url"],
  ["delegation", "api_mode"],
  ["delegation", "max_concurrent_children"],
  ["delegation", "max_async_children"],
  ["delegation", "max_spawn_depth"],
  ["delegation", "orchestrator_enabled"],
  ["compression", "threshold"],
];
const RUNTIME_STEM = ["co", "dex"].join("");
const OPENAI_PROVIDER = `openai-${RUNTIME_STEM}`;
const RESPONSES_MODE = `${RUNTIME_STEM}_responses`;

function isCredentialLikeKey(value) {
  const normalized = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_");
  return CREDENTIAL_KEY.test(normalized);
}

function isEnvironmentName(value) {
  return /^[A-Z][A-Z0-9_]*$/.test(value) && /_/.test(value);
}

function isSecretLookingScalar(node) {
  if (!isScalar(node)) return false;
  const value = node.value;
  if (value === null || typeof value === "boolean" || typeof value === "number") return false;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || /^(?:true|false|null)$/i.test(trimmed)) return false;
  if (isEnvironmentName(trimmed) || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(trimmed)) return false;
  // Explicitly redacted fixtures are test/documentation placeholders, not
  // material that a config round-trip could expose; real non-empty secrets
  // (including ordinary `sk-...` values) remain blocked.
  if (/(?:^|[-_])(redacted|placeholder)(?:[-_]|$)/i.test(trimmed)) return false;
  return true;
}

function findCredentialRiskKey(document) {
  let credentialKey = null;
  // The writer serializes the complete document and may create a complete
  // backup, so an unrelated credential can still be copied or reformatted.
  visit(document, {
    Pair(_key, pair) {
      if (isScalar(pair.key)
        && isCredentialLikeKey(pair.key.value)
        && isSecretLookingScalar(pair.value)) {
        credentialKey = String(pair.key.value);
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return credentialKey;
}

function sourceHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Hermes 0.19 prints "Hermes Agent v0.19.0 (2026.7.20) · upstream <hash>" plus an
// "Install directory:" second line; only that exact build/upstream shape is
// tolerated — arbitrary suffixes ("-beta", "_beta", " stable") stay rejected.
function exactHostVersion(raw) {
  const firstLine = String(raw || "").split(/\r?\n/, 1)[0];
  const match = firstLine
    .match(/^(?:Hermes Agent )?v?([0-9]+(?:\.[0-9]+)+)(?: \([0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}\)(?: · upstream [0-9a-f]{7,40})?)?$/);
  return match?.[1] || "";
}

/** Compare dotted numeric versions. Returns <0, 0 or >0. */
function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Classify a host banner. The banner shape stays strict — arbitrary suffixes such as
 * "-beta", "_beta", " stable" and four-part builds are still not a release we will write
 * against — but a well-formed release at or above the floor is accepted whether or not
 * this matrix has seen it.
 */
function classifyHostVersion(raw) {
  if (raw === NOT_PROBED_HOST_VERSION) return { version: "", status: "not-probed" };
  const version = exactHostVersion(raw);
  // A release is exactly major.minor.patch. Four-part builds such as 0.19.0.1 are not a
  // published release line and were rejected before this gate accepted unseen versions.
  if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) return { version: "", status: "malformed" };
  if (compareVersions(version, MINIMUM_HOST_VERSION) < 0) return { version, status: "too-old" };
  if (VERIFIED_HOST_VERSIONS.has(version)) return { version, status: "verified" };
  return { version, status: "beyond-verified" };
}

function hostVersionError(classified) {
  if (classified.status === "not-probed") {
    return "Hermes host version not probed (dry-run); re-run without --dry-run to detect the host and its capabilities";
  }
  if (classified.status === "malformed") {
    return `unsupported Hermes host version; expected a release banner at or above ${MINIMUM_HOST_VERSION} (verified: ${VERIFIED_HOST_VERSION_TEXT})`;
  }
  if (classified.status === "too-old") {
    return `Hermes host ${classified.version} is older than the minimum supported Hermes host ${MINIMUM_HOST_VERSION}`;
  }
  return "";
}

function parseBoundary(text, options = {}) {
  const raw = String(text || "");
  if (!raw.trim()) {
    const document = parseDocument(`_config_version: ${CONFIG_VERSION}\n`);
    const classified = classifyHostVersion(options.hostVersion);
    const versionError = hostVersionError(classified);
    if (versionError) {
      return { document, error: versionError, fresh: true };
    }
    if (!options.hostCapabilities?.concurrencyHard
      || !options.hostCapabilities?.delegationRouteHard
      || !options.hostCapabilities?.runtimeHard) {
      return { document, error: "unverified Hermes host source/runtime markers", fresh: true };
    }
    return { document, fresh: true };
  }
  const document = parseDocument(raw, {
    keepSourceTokens: true,
    maxAliasCount: 50,
    merge: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length || !isMap(document.contents)) {
    return { error: "malformed host config" };
  }
  const credentialKey = findCredentialRiskKey(document);
  const configVersion = document.get("_config_version");
  if (!Number.isInteger(configVersion) || configVersion < CONFIG_VERSION) {
    return { error: `unknown host config schema; expected integer version >= ${CONFIG_VERSION}` };
  }
  for (const key of MAP_PATHS) {
    const node = document.get(key, true);
    if (node !== undefined && !isMap(node)) return { error: `unknown host config schema at ${key}` };
  }
  for (const routePath of SCALAR_PATHS) {
    const node = document.getIn(routePath, true);
    if (node !== undefined && !isScalar(node)) {
      return {
        document,
        error: `malformed model route at ${routePath.join(".")}`,
        fresh: false,
      };
    }
  }
  const classified = classifyHostVersion(options.hostVersion);
  const versionError = hostVersionError(classified);
  if (versionError) {
    return { document, error: versionError, fresh: false };
  }
  if (!options.hostCapabilities?.concurrencyHard
    || !options.hostCapabilities?.delegationRouteHard
    || !options.hostCapabilities?.runtimeHard) {
    return { document, error: "unverified Hermes host source/runtime markers", fresh: false };
  }
  if (credentialKey) {
    return {
      document,
      credentialKey,
      error: `credential-risk host config (key: ${credentialKey})`,
      fresh: false,
    };
  }
  return { document, fresh: false };
}

module.exports = {
  MINIMUM_HOST_VERSION,
  NOT_PROBED_HOST_VERSION,
  OPENAI_PROVIDER,
  RESPONSES_MODE,
  VERIFIED_CONFIG_VERSION,
  classifyHostVersion,
  exactHostVersion,
  parseBoundary,
  sourceHash,
};
