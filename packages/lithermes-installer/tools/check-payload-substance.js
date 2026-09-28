#!/usr/bin/env node
const childProcess = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SKILL_ROOT_RELATIVE = path.join("assets", "lithermes-plugin", "skills");
const PACK_PREFIX = "assets/lithermes-plugin/skills";
const ALLOWLIST_RELATIVE = path.join("tools", "payload-substance-allowlist.json");
const PARITY_MANIFEST_RELATIVE = path.join("tools", "payload-substance-parity.json");
const REFERENCE_EXEMPTIONS_RELATIVE = path.join("tools", "payload-reference-exemptions.json");
const SCHEMA = "litfamily.payload-substance/v1";
const PARITY_SCHEMA = "litfamily.payload-parity/v1";
const REFERENCE_SCHEMA = "litfamily.payload-references/v1";
const LEGAL_NAMES = new Set(["ATTRIBUTION.md", "LICENSE", "NOTICE", "ORIGIN.json", "PROVENANCE.md"]);
const GENERIC_REFERENCE_NAMES = new Set(["README.md", "package.json", "SKILL.md", "AGENTS.md", "CLAUDE.md"]);
// Claims are markdown targets plus local path tokens outside fenced examples: inline/bare tokens need a file extension, an explicit relative/absolute marker, or a trailing resource directory. URLs, generic filenames, placeholders, and prose/API identifiers are not claims.
const REFERENCE_ROOTS = new Set(["references", "scripts", "assets", "templates", "tests", "test", "vendor", "original", "evals", "schemas", "schema", "skills", "modes", "src", "bin", "lib", "plugins", "docs", "wiki", "data", "dist", "examples"]);
const PACKED_REFERENCE_ROOTS = new Set(["references", "scripts", "assets", "templates", "vendor", "original", "evals", "schemas", "schema", "skills", "modes", "plugins", "data", "examples"]);
const HOST_ENV_HOME_PREFIX = ["CO", "DEX_HOME/"].join("");
const PARITY_FRACTION = 0.5;
const PRODUCT_ID = "p28";
const PARITY_PRODUCT_IDS = Object.freeze(["p27", "p28", "p31", "p32", "p33"]);
const FAMILY_LAYOUT_SCHEMA = "litfamily.payload-layout/v1";

function regularFiles(directory, relativePath = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`PAYLOAD_SUBSTANCE_SYMLINK: ${childRelative}`);
    if (entry.isDirectory()) files.push(...regularFiles(child, childRelative));
    else if (entry.isFile()) files.push(childRelative.split(path.sep).join("/"));
  }
  return files;
}

function skillInventory(skillRoot) {
  if (!fs.existsSync(skillRoot) || !fs.lstatSync(skillRoot).isDirectory()) {
    throw new Error(`SKILL_ROOT_MISSING: ${skillRoot}`);
  }
  return fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const directory = path.join(skillRoot, entry.name);
      return { name: entry.name, files: regularFiles(directory), directory };
    });
}

function loadAllowlist(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema !== SCHEMA || !parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    throw new Error(`ALLOWLIST_INVALID: expected ${SCHEMA}`);
  }
  const allowlist = new Map();
  for (const [skill, reason] of Object.entries(parsed.skills)) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(skill)) throw new Error(`ALLOWLIST_SKILL_INVALID: ${skill}`);
    if (typeof reason !== "string" || reason.trim().length < 40) throw new Error(`ALLOWLIST_REASON_MISSING: ${skill}`);
    allowlist.set(skill, reason.trim());
  }
  return allowlist;
}

function loadAllowlistDocument(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema !== SCHEMA || !parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    throw new Error(`ALLOWLIST_INVALID: expected ${SCHEMA}`);
  }
  const divergences = parsed.parityDivergences || {};
  if (!divergences || typeof divergences !== "object" || Array.isArray(divergences)) throw new Error("PARITY_DIVERGENCES_INVALID: expected an object");
  const result = new Map();
  for (const [skill, entry] of Object.entries(divergences)) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(skill)) throw new Error(`PARITY_DIVERGENCE_SKILL_INVALID: ${skill}`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`PARITY_DIVERGENCE_INVALID: ${skill}`);
    const date = typeof entry.date === "string" ? entry.date : "";
    if (!validIsoDate(date)) throw new Error(`PARITY_DIVERGENCE_DATE_INVALID: ${skill}`);
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    if (reason.length < 40) throw new Error(`PARITY_DIVERGENCE_REASON_MISSING: ${skill}`);
    result.set(skill, { date, reason });
  }
  return result;
}

function loadParityDivergences(filePath) {
  return loadAllowlistDocument(filePath);
}

function validIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function skillNamesDigest(names) {
  return createHash("sha256").update(JSON.stringify([...names].sort())).digest("hex");
}

function loadParityManifest(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema !== PARITY_SCHEMA || !parsed.products || typeof parsed.products !== "object" || Array.isArray(parsed.products) || !parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    throw new Error(`PARITY_MANIFEST_INVALID: expected ${PARITY_SCHEMA}`);
  }
  if (!validIsoDate(parsed.generatedAt)) throw new Error("PARITY_MANIFEST_DATE_INVALID");
  if (typeof parsed.fraction !== "number" || !Number.isFinite(parsed.fraction) || parsed.fraction !== PARITY_FRACTION) throw new Error("PARITY_MANIFEST_FRACTION_INVALID");
  if (parsed.scope !== "parity-enrolled") throw new Error("PARITY_MANIFEST_SCOPE_INVALID");
  const productIds = PARITY_PRODUCT_IDS;
  const actualProductIds = Object.keys(parsed.products).sort();
  if (actualProductIds.join(",") !== [...productIds].sort().join(",")) throw new Error("PARITY_MANIFEST_PRODUCTS_INVALID");
  const products = new Map();
  const inventories = new Map();
  for (const id of productIds) {
    const entry = parsed.products[id];
    if (!entry || !Array.isArray(entry.skills) || !entry.inventory || typeof entry.inventory !== "object" || Array.isArray(entry.inventory)) throw new Error(`PARITY_MANIFEST_PRODUCT_INVALID: ${id}`);
    if (!Number.isInteger(entry.inventory.count) || entry.inventory.count < 0 || !/^[a-f0-9]{64}$/.test(entry.inventory.sha256 || "")) throw new Error(`PARITY_MANIFEST_INVENTORY_INVALID: ${id}`);
    const names = entry.skills;
    if (names.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(name))) throw new Error(`PARITY_MANIFEST_SKILLS_INVALID: ${id}`);
    const unique = [...new Set(names)].sort();
    if (unique.length !== names.length || unique.join(",") !== names.join(",")) throw new Error(`PARITY_MANIFEST_SKILLS_UNSORTED: ${id}`);
    products.set(id, new Set(unique));
    inventories.set(id, { count: entry.inventory.count, sha256: entry.inventory.sha256 });
  }
  const skills = new Map();
  for (const [name, entry] of Object.entries(parsed.skills)) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || !entry || typeof entry !== "object" || Array.isArray(entry) || !entry.closures || typeof entry.closures !== "object" || Array.isArray(entry.closures)) throw new Error(`PARITY_MANIFEST_SKILL_INVALID: ${name}`);
    const ids = Object.keys(entry.closures).sort();
    if (ids.length < 2 || ids.some((id) => !products.has(id))) throw new Error(`PARITY_MANIFEST_CLOSURES_INVALID: ${name}`);
    const closures = {};
    for (const id of ids) {
      const closure = entry.closures[id];
      if (!Number.isInteger(closure) || closure < 0) throw new Error(`PARITY_MANIFEST_CLOSURE_INVALID: ${name}/${id}`);
      if (!products.get(id).has(name)) throw new Error(`PARITY_MANIFEST_ENROLLMENT_INVALID: ${name}/${id}`);
      closures[id] = closure;
    }
    if (!Number.isFinite(entry.median) || entry.median < 0 || entry.median !== median(ids.map((id) => closures[id]))) throw new Error(`PARITY_MANIFEST_MEDIAN_INVALID: ${name}`);
    skills.set(name, { median: entry.median, closures });
  }
  for (const [name, entry] of skills) {
    const enrolled = productIds.filter((productId) => products.get(productId).has(name));
    if (enrolled.length < 2 || enrolled.join(",") !== Object.keys(entry.closures).sort().join(",")) throw new Error(`PARITY_MANIFEST_ENROLLMENT_STALE: ${name}`);
  }
  for (const names of products.values()) {
    for (const name of names) {
      const enrolled = productIds.filter((productId) => products.get(productId).has(name));
      if (enrolled.length >= 2 && !skills.has(name)) throw new Error(`PARITY_MANIFEST_SKILL_MISSING: ${name}`);
      if (enrolled.length === 1 && skills.has(name)) throw new Error(`PARITY_MANIFEST_SINGLETON: ${name}`);
      if (skills.has(name) && enrolled.join(",") !== Object.keys(skills.get(name).closures).sort().join(",")) throw new Error(`PARITY_MANIFEST_ENROLLMENT_STALE: ${name}`);
    }
  }
  return { generatedAt: parsed.generatedAt, fraction: parsed.fraction, products, inventories, skills };
}

function parsePackJson(raw) {
  const start = raw.indexOf("[");
  if (start < 0) throw new Error("PACK_JSON_MISSING");
  const parsed = JSON.parse(raw.slice(start));
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!result || !Array.isArray(result.files)) throw new Error("PACK_JSON_INVALID");
  const paths = new Set();
  for (const file of result.files) {
    if (!file || typeof file.path !== "string" || file.path.length === 0) throw new Error("PACK_PATH_INVALID");
    paths.add(file.path.split("\\").join("/"));
  }
  return paths;
}

function isolatePublishedPackage(packageRoot, workspaceRoot = path.resolve(packageRoot, "../..")) {
  const packageRelative = path.relative(workspaceRoot, packageRoot);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "litfamily-published-pack-"));
  const copyRoot = path.join(parent, "repo");
  fs.cpSync(workspaceRoot, copyRoot, {
    recursive: true,
    filter(source) {
      const relativePath = path.relative(workspaceRoot, source).split(path.sep).join("/");
      if (relativePath === "") return true;
      const segments = relativePath.split("/");
      if ([".git", "node_modules", "# REFERENCE"].includes(segments[0]) || segments[0].startsWith(".lit")) return false;
      if (segments.includes("dist") || segments.includes("marketplace")) return false;
      if (relativePath.endsWith(".tsbuildinfo")) return false;
      return true;
    },
  });
  const dependencies = path.join(workspaceRoot, "node_modules");
  if (fs.existsSync(dependencies)) fs.symlinkSync(dependencies, path.join(copyRoot, "node_modules"), "dir");
  const gitEnv = {
    ...process.env,
    HOME: parent,
    USERPROFILE: parent,
    XDG_CONFIG_HOME: path.join(parent, "config"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  childProcess.execFileSync("git", ["init", "--quiet"], { cwd: copyRoot, env: gitEnv, stdio: "ignore" });
  childProcess.execFileSync("git", ["add", "."], { cwd: copyRoot, env: gitEnv, stdio: "ignore" });
  return { parent, packageRoot: path.join(copyRoot, packageRelative) };
}

function pack(root, { runScripts = false, workspaceRoot } = {}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "litfamily-payload-substance-"));
  const cache = path.join(sandbox, "npm-cache");
  fs.mkdirSync(cache, { recursive: true });
  const env = {
    ...process.env,
    HOME: sandbox,
    USERPROFILE: sandbox,
    GROK_HOME: path.join(sandbox, "grok"),
    npm_config_cache: cache,
    npm_config_userconfig: path.join(sandbox, ".npmrc"),
    NPM_CONFIG_USERCONFIG: path.join(sandbox, ".npmrc"),
  };
  let isolated;
  try {
    if (runScripts) isolated = isolatePublishedPackage(root, workspaceRoot);
    const packRoot = isolated?.packageRoot ?? root;
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["pack", "--dry-run", "--json"];
    if (!runScripts) args.push("--ignore-scripts");
    const result = childProcess.spawnSync(command, args, {
      cwd: packRoot,
      encoding: "utf8",
      env,
      shell: false,
      timeout: 180000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`PACK_FAILED status=${result.status}: ${result.stderr || result.error?.message || ""}`.trim());
    }
    return parsePackJson(result.stdout);
  } finally {
    if (isolated) fs.rmSync(isolated.parent, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function derivePackPrefix(packPaths, skillNames) {
  const names = new Set(skillNames);
  const candidates = new Map();
  for (const packedPath of packPaths) {
    const parts = packedPath.split("/");
    if (parts.length < 3 || parts.at(-1) !== "SKILL.md") continue;
    const skill = parts.at(-2);
    if (!names.has(skill)) continue;
    const prefix = parts.slice(0, -2).join("/");
    if (!prefix) continue;
    if (!candidates.has(prefix)) candidates.set(prefix, new Set());
    candidates.get(prefix).add(skill);
  }
  if (candidates.size === 0) throw new Error(`PACK_SKILL_PREFIX_MISSING: no packed SKILL.md matched ${names.size} source skill(s)`);
  const complete = [...candidates.entries()].filter(([, matched]) => matched.size === names.size);
  if (complete.length > 1) throw new Error(`PACK_SKILL_PREFIX_AMBIGUOUS: ${complete.map(([prefix]) => prefix).sort().join(",")}`);
  if (complete.length === 1) return complete[0][0];
  const max = Math.max(...[...candidates.values()].map((matched) => matched.size));
  const best = [...candidates.entries()].filter(([, matched]) => matched.size === max);
  if (best.length !== 1) throw new Error(`PACK_SKILL_PREFIX_AMBIGUOUS: ${best.map(([prefix]) => prefix).sort().join(",")}`);
  return best[0][0];
}

function evaluate({ productRoot, skillRoot, packPaths, allowlist }) {
  const inventory = skillInventory(skillRoot);
  const names = new Set(inventory.map(({ name }) => name));
  const failures = [];
  for (const skill of allowlist.keys()) if (!names.has(skill)) failures.push(`ALLOWLIST_STALE skill=${skill}`);
  let corpusSkills = 0;
  for (const { name, files } of inventory) {
    const prefix = `${PACK_PREFIX}/${name}/`;
    const packed = [...packPaths].filter((entry) => entry.startsWith(prefix));
    const skillPath = `${prefix}SKILL.md`;
    if (!files.includes("SKILL.md")) failures.push(`SKILL_SOURCE_MISSING skill=${name}`);
    if (!packPaths.has(skillPath)) failures.push(`PACKED_SKILL_MISSING skill=${name} path=${skillPath}`);
    const external = [];
    for (const root of externalRoots(productRoot, { name, directory: path.join(skillRoot, name) })) {
      const relativeRoot = path.relative(productRoot, root).split(path.sep).join("/");
      for (const entry of packPaths) {
        if (entry === relativeRoot || entry.startsWith(`${relativeRoot}/`)) external.push(entry);
      }
    }
    const corpus = [...new Set([...packed, ...external])]
      .filter((entry) => entry !== skillPath && !LEGAL_NAMES.has(path.basename(entry)));
    if (allowlist.has(name)) {
      const substantiveSource = files.filter((entry) => entry !== "SKILL.md" && !LEGAL_NAMES.has(path.basename(entry)));
      if (substantiveSource.length !== 0) failures.push(`ALLOWLIST_NOT_SELF_CONTAINED skill=${name} sourceFiles=${files.length}`);
    } else if (corpus.length === 0) {
      failures.push(`PAYLOAD_SUBSTANCE_FAIL skill=${name}: no packed corpus beyond SKILL.md and no justified allowlist entry`);
    } else {
      corpusSkills += 1;
    }
  }
  return {
    failures,
    skillCount: inventory.length,
    allowlistCount: [...allowlist.keys()].filter((name) => names.has(name)).length,
    corpusSkills,
    packedFiles: packPaths.size,
  };
}

function hostSurfaceToken(value) {
  return value.startsWith("~") || value.startsWith("$") || value.startsWith("/") || value.startsWith(".") || value.startsWith("HOME/") || value.startsWith(HOST_ENV_HOME_PREFIX) || value.startsWith("SESSION_DIR/") || value.startsWith("WORK_ROOT/") || value.startsWith("PROJECT_ROOT/") || value.startsWith("test/") || value.startsWith("tests/") || value.startsWith("docs/") || value.startsWith("src/") || value.startsWith("plans/") || value.startsWith("evidence/") || value.startsWith("target/") || value.startsWith("pkg/") || value.startsWith("packages/") || value.startsWith("dist/") || value.startsWith("api/") || value.startsWith("path/to/") || /^[A-Z][A-Z0-9_]*\//u.test(value) || /(?:AGENTS|CLAUDE)\.md\//u.test(value);
}

function loadReferenceExemptions(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema !== REFERENCE_SCHEMA || !Array.isArray(parsed.surfaces)) throw new Error(`REFERENCE_EXEMPTIONS_INVALID: expected ${REFERENCE_SCHEMA}`);
  const entries = [];
  const seen = new Set();
  for (const entry of parsed.surfaces) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("REFERENCE_EXEMPTION_INVALID");
    const exact = typeof entry.token === "string" ? entry.token.trim() : "";
    const prefix = typeof entry.prefix === "string" ? entry.prefix.trim() : "";
    if ((exact && prefix) || (!exact && !prefix)) throw new Error("REFERENCE_EXEMPTION_SELECTOR_INVALID");
    const selector = exact || prefix;
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    if (reason.length < 40) throw new Error(`REFERENCE_EXEMPTION_REASON_MISSING: ${selector}`);
    if (!hostSurfaceToken(selector)) throw new Error(`REFERENCE_EXEMPTION_NOT_HOST: ${selector}`);
    const root = selector.split("/")[0];
    if (selector.startsWith("../") || (selector.startsWith("./") && !selector.startsWith("./target")) || PACKED_REFERENCE_ROOTS.has(root)) throw new Error(`REFERENCE_EXEMPTION_NOT_HOST: ${selector}`);
    const key = `${exact ? "token" : "prefix"}:${selector}`;
    if (seen.has(key)) throw new Error(`REFERENCE_EXEMPTION_DUPLICATE: ${selector}`);
    seen.add(key);
    entries.push({ token: exact || undefined, prefix: prefix || undefined, reason });
  }
  return entries;
}

function stripFencedCode(text) {
  let fence;
  return text.split("\n").map((line) => {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return "";
    }
    if (marker) {
      fence = marker;
      return "";
    }
    return line;
  }).join("\n");
}

function cleanReferenceToken(raw) {
  return raw.trim().replace(/^<|>$/gu, "").replace(/[),.;:!?]+$/gu, "").replace(/[?#].*$/u, "");
}

function isReferenceClaim(raw, kind) {
  const token = cleanReferenceToken(raw);
  if (!token || token.includes("<") || token.includes(">") || token.includes("$") || token.includes("{") || token.includes("}") || token.includes("*") || token.includes("…")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(token) || token.startsWith("//")) return false;
  if (!token.includes("/")) return false;
  if (kind === "markdown") return true;
  if (token.split("/").slice(0, -1).some((part) => !part.startsWith(".") && /\.[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(part))) return false;
  const extension = token.match(/\.([A-Za-z0-9][A-Za-z0-9_-]{0,19})$/u)?.[1];
  if (extension && extension === extension.toLowerCase()) return true;
  return token.endsWith("/") && [...REFERENCE_ROOTS].some((root) => token.startsWith(`${root}/`)) || token.startsWith("../") || token.startsWith("./") || token.startsWith("~/") || token.startsWith("/");
}

function referenceClaims(text) {
  const source = stripFencedCode(text);
  const claims = [];
  const seen = new Set();
  const add = (raw, kind, index) => {
    const preceding = source.slice(Math.max(0, index - 3), index);
    if (preceding.endsWith("://") || preceding.endsWith("//")) return;
    const token = cleanReferenceToken(raw);
    if (!isReferenceClaim(token, kind) || (GENERIC_REFERENCE_NAMES.has(token) && !token.includes("/"))) return;
    const line = Math.max(1, source.slice(0, index).split("\n").length);
    const key = `${token}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ token, line });
  };
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) add(match[1].split(/[\s]+/u)[0], "markdown", match.index || 0);
  const tokenPattern = /(?:~\/|(?:\.\.\/)+|\.\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,19})?\/?/gu;
  const directoryPattern = /(?:~\/|(?:\.\.\/)+|\.\/|\/)?(?:references|scripts|assets|templates|tests?|vendor|original|evals|schemas?|skills|modes|src|bin|lib|plugins|docs|wiki|data|dist|examples)(?:\/[A-Za-z0-9_.-]+)*\/(?![A-Za-z0-9_.-])/gu;
  for (const match of source.matchAll(/`([^`\n]+)`/gu)) {
    const start = match.index || 0;
    for (const token of match[1].matchAll(tokenPattern)) add(token[0], "code", start + (token.index || 0));
    for (const token of match[1].matchAll(directoryPattern)) add(token[0], "code", start + (token.index || 0));
  }
  for (const match of source.matchAll(tokenPattern)) add(match[0], "bare", match.index || 0);
  for (const match of source.matchAll(directoryPattern)) add(match[0], "bare", match.index || 0);
  return claims;
}

function matchesPackedPath(packPaths, relativePath) {
  const normalized = relativePath.split(path.sep).join("/").replace(/\/$/u, "");
  if (!normalized || normalized.startsWith("../")) return false;
  return packPaths.has(normalized) || [...packPaths].some((entry) => entry.startsWith(`${normalized}/`));
}

function referenceBases(productRoot, skill, packPaths, packPrefix) {
  const canonical = [];
  const prefix = `${packPrefix}/${skill.name}/`;
  for (const packedPath of packPaths) {
    if (!packedPath.startsWith(prefix)) continue;
    const parts = packedPath.slice(prefix.length).split("/");
    const marker = parts.findIndex((part) => part === "original" || part === "vendor" || part === "canonical");
    if (marker >= 0) {
      canonical.push(path.resolve(productRoot, prefix, ...parts.slice(0, marker + 1)));
      if (marker + 1 < parts.length) {
        const candidate = path.resolve(productRoot, prefix, ...parts.slice(0, marker + 2));
        if (fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory()) canonical.push(candidate);
      }
    }
  }
  return [skill.directory, productRoot, path.join(productRoot, "plugins", "litclaude"), path.join(productRoot, "plugins", ["lit", "co", "dex"].join("")), path.join(productRoot, "skills"), path.join(productRoot, ".grok"), path.join(productRoot, "assets", "lithermes-plugin"), ...externalRoots(productRoot, skill), ...canonical];
}

function resolvesReference({ productRoot, skill, token, packPaths, packPrefix }) {
  if (/^(?:~|\$|[A-Z][A-Z0-9_]*\/)/u.test(token)) return false;
  const pathToken = token.replace(/^\/+\s*/u, "").replace(/#.*$/u, "");
  const bases = referenceBases(productRoot, skill, packPaths, packPrefix);
  if (pathToken.startsWith("skills/")) bases.push(path.join(productRoot, packPrefix));
  const seen = new Set();
  for (const base of bases) {
    const relativePath = path.relative(productRoot, path.resolve(base, pathToken));
    const key = relativePath.split(path.sep).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    if (matchesPackedPath(packPaths, relativePath)) return true;
  }
  return false;
}

function evaluatePayloadReferences({ productRoot, skillRoot, packPaths, packPrefix, exemptions }) {
  const failures = [];
  const claims = [];
  const exemptionHits = [];
  for (const skill of skillInventory(skillRoot)) {
    const skillFile = path.join(skill.directory, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    for (const claim of referenceClaims(fs.readFileSync(skillFile, "utf8"))) {
      claims.push({ skill: skill.name, ...claim });
      if (resolvesReference({ productRoot, skill, token: claim.token, packPaths, packPrefix })) continue;
      const exemption = exemptions.find((entry) => entry.token === claim.token || (entry.prefix && claim.token.startsWith(entry.prefix)));
      if (exemption) exemptionHits.push(`${skill.name}:${claim.token}`);
      else failures.push(`PAYLOAD_REFERENCE_FAIL skill=${skill.name} token=${claim.token} line=${claim.line}`);
    }
  }
  return { failures, claims, exemptionHits };
}

function isContained(root, candidate) {
  const relation = path.relative(root, candidate);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${path.sep}`) && !relation.startsWith(path.sep);
}

function bindingTexts(productRoot, skill) {
  const paths = [
    path.join(skill.directory, "SKILL.md"),
    path.join(productRoot, "plugin.json"),
    path.join(productRoot, "plugins", "litclaude", ".claude-plugin", "plugin.json"),
    path.join(productRoot, "skills", "managed-skill-manifest.json"),
  ];
  const texts = [];
  for (const bindingPath of paths) {
    if (!fs.existsSync(bindingPath) || !fs.lstatSync(bindingPath).isFile()) continue;
    const text = fs.readFileSync(bindingPath, "utf8");
    if (bindingPath === paths[0] || text.includes(skill.name)) texts.push({ path: bindingPath, text });
  }
  return texts;
}

function externalRoots(productRoot, skill) {
  const roots = new Set();
  const candidates = [];
  for (const { path: bindingPath, text } of bindingTexts(productRoot, skill)) {
    const pattern = /(?:\.\.\/)+[^\s`)'"<>]+/g;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0].replace(/[),.;:]+$/u, "");
      if (raw.includes("/")) candidates.push({ bindingPath, raw });
    }
    if (text.includes("*_handoff")) {
      for (const match of text.matchAll(/((?:\.\.\/)+vendor)\//g)) {
        const vendorRoot = path.resolve(path.dirname(bindingPath), match[1]);
        if (!fs.existsSync(vendorRoot) || !fs.lstatSync(vendorRoot).isDirectory()) continue;
        for (const entry of fs.readdirSync(vendorRoot, { withFileTypes: true })) {
          const child = path.join(vendorRoot, entry.name);
          if (entry.isDirectory() && (entry.name.endsWith("_handoff") || entry.name === "handoff") && isContained(productRoot, child)) roots.add(child);
        }
      }
    }
  }
  for (const { bindingPath, raw } of candidates) {
    if (raw.replace(/\/+$/u, "").endsWith("/vendor")) continue;
    const candidate = path.resolve(path.dirname(bindingPath), raw);
    if (raw.includes("*")) {
      const wildcardParent = path.dirname(candidate);
      if (!fs.existsSync(wildcardParent) || !fs.lstatSync(wildcardParent).isDirectory()) continue;
      const suffix = path.basename(raw).replace(/^\*/, "");
      for (const entry of fs.readdirSync(wildcardParent, { withFileTypes: true })) {
        const child = path.join(wildcardParent, entry.name);
        if (entry.isDirectory() && entry.name.endsWith(suffix) && isContained(productRoot, child)) roots.add(child);
      }
      continue;
    }
    if (!fs.existsSync(candidate)) continue;
    let root = candidate;
    if (fs.lstatSync(candidate).isFile()) root = path.dirname(candidate);
    const relativeParts = path.relative(productRoot, root).split(path.sep);
    const canonicalMarker = relativeParts.some((part) => part === "vendor" || part === "canonical" || part === "original");
    if (canonicalMarker && isContained(productRoot, root) && !isContained(skill.directory, root)) roots.add(root);
  }
  return [...roots].sort();
}

function externalCompanionPaths(productRoot, skill, packPaths, roots) {
  const companions = new Set();
  const attributionIds = new Map([
    ["handoff", "022_handoff"],
    ["scientific-visualization", "045_scientific-visualization"],
  ]);
  for (const root of roots) {
    const relativeRoot = path.relative(productRoot, root).split(path.sep).join("/");
    const sourceId = path.basename(root);
    const attributionId = attributionIds.get(sourceId) || sourceId;
    if (relativeRoot.split("/").includes("vendor")) {
      for (const entry of packPaths) {
        if (
          entry.endsWith(`/licenses/${attributionId}-MIT.txt`)
          || entry.endsWith(`/provenance/${attributionId}.md`)
          || ((sourceId === "scientific-visualization" || sourceId === "045_scientific-visualization") && /\/NOTICE(?:\.md)?$/u.test(entry))
        ) companions.add(entry);
      }
    }
  }
  return companions;
}

function mapSourcePathToPackPath(productRoot, skillRoot, candidate, packPrefix) {
  const sourceSkillRoot = path.relative(productRoot, skillRoot).split(path.sep).join("/");
  const sourcePluginRoot = path.dirname(sourceSkillRoot).split(path.sep).join("/");
  const candidateRelative = path.relative(productRoot, candidate).split(path.sep).join("/");
  const packContainer = packPrefix.endsWith(`/${sourceSkillRoot}`)
    ? packPrefix.slice(0, -(sourceSkillRoot.length + 1))
    : packPrefix === sourceSkillRoot ? "" : undefined;
  if (packContainer === undefined) return undefined;
  if (candidateRelative !== sourcePluginRoot && !candidateRelative.startsWith(`${sourcePluginRoot}/`)) return undefined;
  return packContainer ? `${packContainer}/${candidateRelative}` : candidateRelative;
}

function resolveClosures(productRoot, skillRoot, skills, packPaths, packPrefix) {
  const records = new Map();
  for (const skill of skills) {
    const prefix = `${packPrefix}/${skill.name}/`;
    const paths = new Set([...packPaths].filter((path) => path.startsWith(prefix)));
    const roots = externalRoots(productRoot, skill);
    for (const root of roots) {
      const relativeRoot = path.relative(productRoot, root).split(path.sep).join("/");
      const packedRoot = mapSourcePathToPackPath(productRoot, skillRoot, root, packPrefix) ?? relativeRoot;
      for (const entry of packPaths) if (entry.startsWith(`${packedRoot}/`)) paths.add(entry);
    }
    for (const entry of externalCompanionPaths(productRoot, skill, packPaths, roots)) paths.add(entry);
    records.set(skill.name, {
      closure: packPaths.has(`${prefix}SKILL.md`) ? paths.size : 0,
      roots: roots.map((root) => path.relative(productRoot, root).split(path.sep).join("/")),
    });
  }
  return records;
}

function measureProduct(familyRoot, layout) {
  const productRoot = path.resolve(familyRoot, ...layout.packageRelative);
  const skillRoot = path.join(productRoot, layout.skillRootRelative);
  const skills = skillInventory(skillRoot);
  const packRoot = layout.packRootRelative ? path.resolve(familyRoot, ...layout.packRootRelative) : productRoot;
  const packPaths = pack(packRoot, { runScripts: layout.packWithScripts === true, workspaceRoot: familyRoot });
  const packPrefix = layout.packWithScripts
    ? derivePackPrefix(packPaths, skills.map(({ name }) => name))
    : layout.packPrefix;
  const divergences = loadParityDivergences(path.join(productRoot, "tools", "payload-substance-allowlist.json"));
  return { id: layout.id, productRoot, skills: resolveClosures(productRoot, skillRoot, skills, packPaths, packPrefix), divergences };
}

function measureFamily(familyRoot, layouts) {
  return layouts.map((layout) => measureProduct(familyRoot, layout));
}

function loadFamilyLayout(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema !== FAMILY_LAYOUT_SCHEMA || !Array.isArray(parsed.products)) {
    throw new Error(`FAMILY_LAYOUT_INVALID: expected ${FAMILY_LAYOUT_SCHEMA}`);
  }
  const seen = new Set();
  const layouts = parsed.products.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("FAMILY_LAYOUT_ENTRY_INVALID");
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!PARITY_PRODUCT_IDS.includes(id) || seen.has(id)) throw new Error(`FAMILY_LAYOUT_PRODUCT_INVALID: ${id || "missing"}`);
    seen.add(id);
    const packageRelative = Array.isArray(entry.packageRelative) ? entry.packageRelative : [];
    if (packageRelative.length === 0 || packageRelative.some((part) => typeof part !== "string" || !part || path.isAbsolute(part) || part === "." || part === ".." || part.includes(".."))) {
      throw new Error(`FAMILY_LAYOUT_PACKAGE_PATH_INVALID: ${id}`);
    }
    const skillRootRelative = typeof entry.skillRootRelative === "string" ? entry.skillRootRelative : "";
    if (!skillRootRelative || path.isAbsolute(skillRootRelative) || skillRootRelative.split(/[\\/]/u).includes("..")) throw new Error(`FAMILY_LAYOUT_SKILL_PATH_INVALID: ${id}`);
    const layout = { id, packageRelative, skillRootRelative };
    if (typeof entry.packPrefix === "string" && entry.packPrefix) layout.packPrefix = entry.packPrefix;
    if (Array.isArray(entry.packRootRelative)) layout.packRootRelative = entry.packRootRelative;
    if (entry.packWithScripts === true) layout.packWithScripts = true;
    return layout;
  });
  if (seen.size !== PARITY_PRODUCT_IDS.length) throw new Error("FAMILY_LAYOUT_PRODUCTS_INCOMPLETE");
  return Object.freeze(layouts);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function evaluateManifestParity({ manifest, targetId, productRoot, skillRoot, packPaths, packPrefix, divergences }) {
  const expectedSkills = manifest.products.get(targetId);
  if (!expectedSkills) return { failures: [`PAYLOAD_PARITY_MANIFEST_PRODUCT_MISSING product=${targetId}`], rows: [], exemptions: [] };
  const skills = skillInventory(skillRoot);
  const actualSkills = new Set(skills.map(({ name }) => name));
  const expectedInventory = manifest.inventories.get(targetId);
  const missing = [...expectedSkills].filter((name) => !actualSkills.has(name));
  const extra = [...actualSkills].filter((name) => manifest.skills.has(name) && !expectedSkills.has(name));
  const failures = [];
  const actualDigest = skillNamesDigest(skills.map(({ name }) => name));
  if (skills.length !== expectedInventory.count || actualDigest !== expectedInventory.sha256) failures.push(`PAYLOAD_PARITY_MANIFEST_INVENTORY_STALE product=${targetId} expected=${expectedInventory.count}/${expectedInventory.sha256} actual=${skills.length}/${actualDigest}`);
  if (missing.length || extra.length) failures.push(`PAYLOAD_PARITY_MANIFEST_SKILLS_STALE product=${targetId} missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`);
  const records = resolveClosures(productRoot, skillRoot, skills, packPaths, packPrefix);
  const rows = [];
  const exemptions = [];
  for (const [name, entry] of [...manifest.skills].sort(([left], [right]) => left.localeCompare(right))) {
    const expectedClosure = entry.closures[targetId];
    if (expectedClosure === undefined) continue;
    const summary = Object.entries(entry.closures).map(([id, closure]) => `${id}:${closure}`).join(",");
    rows.push(`PAYLOAD_PARITY_ROW skill=${name} median=${entry.median} closures=${summary}`);
    const record = records.get(name);
    if (!record) continue;
    if (record.closure !== expectedClosure) failures.push(`PAYLOAD_PARITY_MANIFEST_CLOSURE_STALE skill=${name} product=${targetId} expected=${expectedClosure} actual=${record.closure}`);
    const threshold = entry.median * manifest.fraction;
    if (record.closure < threshold) {
      const exception = divergences.get(name);
      if (exception) exemptions.push(`${name}@${exception.date}`);
      else failures.push(`PAYLOAD_PARITY_FAIL skill=${name} product=${targetId} closure=${record.closure} median=${entry.median} threshold=${threshold} enrolled=${Object.keys(entry.closures).join(",")}`);
    }
  }
  for (const name of divergences.keys()) if (!manifest.skills.has(name)) failures.push(`PAYLOAD_PARITY_DIVERGENCE_STALE skill=${name} product=${targetId}`);
  return { failures, rows, exemptions };
}

function evaluateManifestFreshness({ manifest, measurements }) {
  const failures = [];
  for (const measurement of measurements) {
    const expectedSkills = manifest.products.get(measurement.id);
    if (!expectedSkills) {
      failures.push(`PAYLOAD_PARITY_MANIFEST_PRODUCT_MISSING product=${measurement.id}`);
      continue;
    }
    const actualSkills = new Set(measurement.skills.keys());
    const expectedInventory = manifest.inventories.get(measurement.id);
    const actualNames = [...actualSkills].sort((left, right) => left.localeCompare(right));
    const actualDigest = skillNamesDigest(actualNames);
    if (actualNames.length !== expectedInventory.count || actualDigest !== expectedInventory.sha256) failures.push(`PAYLOAD_PARITY_MANIFEST_FRESHNESS_INVENTORY_STALE product=${measurement.id} expected=${expectedInventory.count}/${expectedInventory.sha256} actual=${actualNames.length}/${actualDigest}`);
    const missing = [...expectedSkills].filter((name) => !actualSkills.has(name));
    const extra = [...actualSkills].filter((name) => manifest.skills.has(name) && !expectedSkills.has(name));
    if (missing.length || extra.length) failures.push(`PAYLOAD_PARITY_MANIFEST_FRESHNESS_SKILLS_STALE product=${measurement.id} missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`);
    for (const [name, entry] of manifest.skills) {
      const expectedClosure = entry.closures[measurement.id];
      if (expectedClosure === undefined) continue;
      const record = measurement.skills.get(name);
      if (!record) {
        failures.push(`PAYLOAD_PARITY_MANIFEST_FRESHNESS_SKILL_MISSING skill=${name} product=${measurement.id}`);
        continue;
      }
      if (record.closure !== expectedClosure) failures.push(`PAYLOAD_PARITY_MANIFEST_FRESHNESS_CLOSURE_STALE skill=${name} product=${measurement.id} expected=${expectedClosure} actual=${record.closure}`);
    }
  }
  for (const [name, entry] of manifest.skills) {
    const live = measurements.filter((measurement) => entry.closures[measurement.id] !== undefined);
    const liveMedian = median(live.map((measurement) => measurement.skills.get(name)?.closure ?? 0));
    if (live.length !== Object.keys(entry.closures).length || liveMedian !== entry.median) failures.push(`PAYLOAD_PARITY_MANIFEST_FRESHNESS_MEDIAN_STALE skill=${name} expected=${entry.median} actual=${liveMedian}`);
  }
  return { failures };
}

function matchingProductId(familyRoot, productRoot, layouts) {
  const resolvedProduct = path.resolve(productRoot);
  return layouts.find((layout) => path.resolve(familyRoot, ...layout.packageRelative) === resolvedProduct)?.id;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`OPTION_VALUE_MISSING: ${name}`);
  return value;
}

function run(argv = process.argv.slice(2)) {
  const allowed = new Set(["--skill-root", "--allowlist-file", "--pack-json", "--family-root", "--family-layout", "--product-root", "--product-id", "--parity-manifest", "--reference-exemptions"]);
  for (const arg of argv) if (arg.startsWith("--") && !allowed.has(arg)) throw new Error(`UNKNOWN_OPTION: ${arg}`);
  const productRoot = path.resolve(option(argv, "--product-root") || PACKAGE_ROOT);
  const skillRoot = path.resolve(productRoot, option(argv, "--skill-root") || SKILL_ROOT_RELATIVE);
  const allowlistPath = path.resolve(productRoot, option(argv, "--allowlist-file") || ALLOWLIST_RELATIVE);
  const packFile = option(argv, "--pack-json");
  const packPaths = packFile
    ? parsePackJson(fs.readFileSync(path.resolve(process.cwd(), packFile), "utf8"))
    : pack(productRoot);
  const report = evaluate({ productRoot, skillRoot, packPaths, allowlist: loadAllowlist(allowlistPath) });
  const referenceExemptionsPath = path.resolve(productRoot, option(argv, "--reference-exemptions") || REFERENCE_EXEMPTIONS_RELATIVE);
  const references = evaluatePayloadReferences({ productRoot, skillRoot, packPaths, packPrefix: PACK_PREFIX, exemptions: loadReferenceExemptions(referenceExemptionsPath) });
  const customInputs = Boolean(option(argv, "--skill-root") || option(argv, "--allowlist-file") || option(argv, "--pack-json") || option(argv, "--product-root"));
  const parityManifestOption = option(argv, "--parity-manifest");
  const parityManifestPath = path.resolve(productRoot, parityManifestOption || PARITY_MANIFEST_RELATIVE);
  const runManifest = !customInputs || Boolean(parityManifestOption);
  let parity;
  if (runManifest) {
    const manifest = loadParityManifest(parityManifestPath);
    const targetId = option(argv, "--product-id") || (productRoot === PACKAGE_ROOT ? PRODUCT_ID : undefined);
    if (!targetId) throw new Error("PAYLOAD_PARITY_TARGET_UNKNOWN: pass --product-id for a product outside the family root");
    parity = evaluateManifestParity({ manifest, targetId, productRoot, skillRoot, packPaths, packPrefix: PACK_PREFIX, divergences: loadParityDivergences(allowlistPath) });
  }
  const requestedFamilyRoot = option(argv, "--family-root") || process.env.LITHERMES_FAMILY_ROOT;
  const requestedFamilyLayout = option(argv, "--family-layout") || process.env.LITHERMES_FAMILY_LAYOUT;
  if (Boolean(requestedFamilyRoot) !== Boolean(requestedFamilyLayout)) throw new Error("FAMILY_LAYOUT_REQUIRED: provide both --family-root and --family-layout");
  const familyRoot = requestedFamilyRoot ? path.resolve(process.cwd(), requestedFamilyRoot) : undefined;
  if (!familyRoot) return { ...report, references, parity, freshness: undefined };
  const layouts = loadFamilyLayout(path.resolve(process.cwd(), requestedFamilyLayout));
  const targetId = option(argv, "--product-id") || matchingProductId(familyRoot, productRoot, layouts) || (productRoot === PACKAGE_ROOT ? PRODUCT_ID : undefined);
  if (!targetId) throw new Error("PAYLOAD_PARITY_TARGET_UNKNOWN: pass --product-id for a product outside the family root");
  const measurements = measureFamily(familyRoot, layouts);
  return { ...report, references, parity, freshness: evaluateManifestFreshness({ manifest: loadParityManifest(parityManifestPath), measurements }) };
}

if (require.main === module) {
  try {
    const report = run();
    const failures = [...report.failures, ...(report.references?.failures || []), ...(report.parity?.failures || []), ...(report.freshness?.failures || [])];
    if (failures.length) {
      for (const failure of failures) process.stderr.write(`${failure}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`PAYLOAD_SUBSTANCE_PASS: skills=${report.skillCount} allowlist=${report.allowlistCount} corpus=${report.corpusSkills} packedFiles=${report.packedFiles}\n`);
      process.stdout.write(`PAYLOAD_REFERENCES_PASS: claims=${report.references.claims.length} exemptions=${report.references.exemptionHits.length}\n`);
      if (report.parity) {
        process.stdout.write(`PAYLOAD_PARITY_PASS: source=manifest fraction=${PARITY_FRACTION} exemptions=${report.parity.exemptions.join(",") || "none"}\n`);
        for (const row of report.parity.rows) process.stdout.write(`${row}\n`);
      }
      if (report.freshness) process.stdout.write("PAYLOAD_PARITY_FRESHNESS_PASS: family-manifest\n");
    }
  } catch (error) {
    process.stderr.write(`PAYLOAD_SUBSTANCE_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

module.exports = { evaluate, evaluateManifestParity, evaluateManifestFreshness, evaluatePayloadReferences, loadAllowlist, loadFamilyLayout, loadParityDivergences, loadParityManifest, loadReferenceExemptions, measureFamily, parsePackJson, run };
