const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyModelConfigPlan,
  configHasLitHermes,
  disableLitHermesConfig,
  enableLitHermesConfig,
  formatConcurrencyCapability,
  inspectHermesCapabilities,
  planModelConfig,
  readConfig,
  setTuiAgentsNudgeConfig,
  revalidateModelConfigPlan,
  writeConfig,
} = require("./config");
const { copyTree, removeEmptyDirs, sha256, writeFileAtomic } = require("./files");
const { assertStateParent, assertPluginParent, defaultHermesHome, defaultHermesRepo, detectHermesRuntimeRepo, detectHermesVersion, ensureHermesHome, inspectHermesHostCapabilities, LitHermesError } = require("./hermesDiscovery");
const { NOT_PROBED_HOST_VERSION } = require("./modelConfigBoundary");
const { patchInstalledHermes, rollbackPatches } = require("./patch");
const {
  ASTRA_MODEL,
  formatManagedRoute,
  managedRequest,
  missingCredentialWarning,
  unavailableReviewerRouteName,
  unavailableReviewerRoutes,
  unavailableTuiRouteVisibility,
} = require("./modelRoutePolicy");
const { installSkins } = require("./skins");

const packageRoot = path.resolve(__dirname, "..", "..");
const assetRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const LEGACY_VENDOR_DIRS = new Map([
  ["vendor/022_handoff", "vendor/handoff"],
  ["vendor/045_scientific-visualization", "vendor/scientific-visualization"],
]);
const LEGACY_SKILL_PATH = "skills/lit-korean";

function manifestPath(hermesHome) {
  return path.join(hermesHome, "lithermes", "install-manifest.json");
}

function pluginDest(hermesHome) {
  return path.join(hermesHome, "plugins", "lithermes");
}

function withLock(hermesHome, fn, expectedState) {
  assertStateParent(hermesHome, expectedState);
  const lock = path.join(hermesHome, "lithermes", "install.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const state = assertStateParent(hermesHome, expectedState || undefined);
  const checkState = () => assertStateParent(hermesHome, state);
  let fd;
  let lockStat;
  try {
    try {
      checkState();
      fd = fs.openSync(lock, "wx");
      lockStat = fs.fstatSync(fd);
      fs.writeFileSync(fd, String(process.pid));
    } catch (error) {
      if (error.code === "EEXIST") throw new LitHermesError(`LitHermes install lock already exists at ${lock}`, 3);
      throw error;
    }
    checkState();
    const result = fn(checkState);
    checkState();
    return result;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      checkState();
      const current = fs.lstatSync(lock, { throwIfNoEntry: false });
      if (current?.isFile() && lockStat && current.dev === lockStat.dev && current.ino === lockStat.ino) fs.unlinkSync(lock);
    } catch {
      // A moved state directory retains its lock for manual recovery.
    }
  }
}

function loadManifest(hermesHome) {
  const state = assertStateParent(hermesHome);
  const file = manifestPath(hermesHome);
  const before = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!before) return null;
  if (!before.isFile()) throw new LitHermesError(`Unsafe install manifest at ${file}.`, 5);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new LitHermesError(`Replaced install manifest at ${file}.`, 5);
    assertStateParent(hermesHome, state);
    const text = fs.readFileSync(fd, "utf8");
    assertStateParent(hermesHome, state);
    const after = fs.lstatSync(file);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino) throw new LitHermesError(`Replaced install manifest at ${file}.`, 5);
    return JSON.parse(text);
  } finally {
    fs.closeSync(fd);
  }
}

function validManifestFiles(manifest) {
  return Array.isArray(manifest?.files) && manifest.files.every((entry) =>
    typeof entry?.path === "string" && entry.path.length > 0
    && !path.isAbsolute(entry.path) && !entry.path.includes("\\") && !entry.path.includes("\0")
    && entry.path.split("/").every((part) => part && part !== "." && part !== "..")
    && /^[a-f0-9]{64}$/.test(entry.sha256))
    && new Set(manifest.files.map((entry) => entry.path)).size === manifest.files.length;
}

function installedMatchesManifest(hermesHome, manifest, caches = []) {
  if (!validManifestFiles(manifest)) return false;
  const dest = pluginDest(hermesHome);
  const owned = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  let matched = 0;
  const matches = (dir) => fs.readdirSync(dir, { withFileTypes: true }).every((entry) => {
    const file = path.join(dir, entry.name);
    const relative = path.relative(dest, file).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        const entries = fs.readdirSync(file, { withFileTypes: true });
        if (!entries.length || !entries.every((cache) => {
          const name = /^([^.]+)\.[a-zA-Z][a-zA-Z0-9_-]*(?:\.opt-[0-9]+)?\.pyc$/.exec(cache.name);
          const source = name && path.relative(dest, path.join(dir, `${name[1]}.py`)).split(path.sep).join("/");
          return cache.isFile() && name && owned.has(source);
        })) return false;
        const stat = fs.lstatSync(file);
        caches.push({ path: relative, dev: stat.dev, ino: stat.ino, files: entries.map((cache) => ({
          path: cache.name, sha256: sha256(path.join(file, cache.name)),
        })) });
        return true;
      }
      return [...owned.keys()].some((name) => name.startsWith(`${relative}/`)) && matches(file);
    }
    if (!entry.isFile() || !owned.has(relative) || sha256(file) !== owned.get(relative)) return false;
    matched += 1;
    return true;
  });
  return fs.lstatSync(dest).isDirectory() && matches(dest) && matched === owned.size;
}

// A pre-canonical installation may be replaced only when both numbered vendor
// roots are ordinary directories whose complete tree is already covered by the
// install receipt. This reuses the existing manifest guard, while explicitly
// rejecting mixed old/new layouts before the destination is removed.
function validateLegacyVendorMigration(hermesHome, manifest) {
  const dest = pluginDest(hermesHome);
  let foundLegacy = false;
  for (const [legacy, canonical] of LEGACY_VENDOR_DIRS) {
    const legacyPath = path.join(dest, legacy);
    const legacyStat = fs.lstatSync(legacyPath, { throwIfNoEntry: false });
    if (!legacyStat) continue;
    foundLegacy = true;
    if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink()) {
      throw new LitHermesError(`Unsafe legacy vendor path at ${legacyPath}; refusing migration.`, 5);
    }
    if (fs.lstatSync(path.join(dest, canonical), { throwIfNoEntry: false })) {
      throw new LitHermesError(`Mixed legacy and canonical vendor paths at ${dest}; refusing migration.`, 5);
    }
  }
  if (!foundLegacy) return false;
  if (!installedMatchesManifest(hermesHome, manifest)) {
    throw new LitHermesError("Legacy vendor payload is not pristine and manifest-owned; refusing migration.", 5);
  }
  return true;
}

function isLegacySkillPath(relative) {
  return relative === LEGACY_SKILL_PATH || relative.startsWith(`${LEGACY_SKILL_PATH}/`);
}

function directoryIdentity(stat) {
  return stat && { dev: stat.dev, ino: stat.ino };
}

function snapshotLegacySkill(root) {
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat) return null;
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new LitHermesError(`Unsafe legacy skill path at ${root}; refusing migration.`, 5);
  }
  const entries = [];
  const digest = crypto.createHash("sha256");
  const visit = (dir, prefix = "") => {
    const rows = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const row of rows) {
      const relative = prefix ? `${prefix}/${row.name}` : row.name;
      const file = path.join(dir, row.name);
      const before = fs.lstatSync(file);
      if (before.isDirectory() && !before.isSymbolicLink()) {
        entries.push({ path: relative, type: "directory", ...directoryIdentity(before), mode: before.mode & 0o777 });
        digest.update(`d\0${relative}\0${before.mode & 0o777}\n`);
        visit(file, relative);
        const after = fs.lstatSync(file);
        if (!after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
          throw new LitHermesError(`Legacy skill changed during inspection at ${file}; refusing migration.`, 5);
        }
      } else if (before.isFile() && !before.isSymbolicLink()) {
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
        const fd = fs.openSync(file, flags);
        let bytes;
        try {
          const opened = fs.fstatSync(fd);
          if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new LitHermesError(`Legacy skill file was replaced during inspection at ${file}; refusing migration.`, 5);
          }
          bytes = fs.readFileSync(fd);
          const afterOpen = fs.fstatSync(fd);
          const afterPath = fs.lstatSync(file);
          if (!afterOpen.isFile() || afterOpen.dev !== before.dev || afterOpen.ino !== before.ino
            || afterOpen.size !== before.size || afterPath.dev !== before.dev || afterPath.ino !== before.ino) {
            throw new LitHermesError(`Legacy skill changed during inspection at ${file}; refusing migration.`, 5);
          }
        } finally {
          fs.closeSync(fd);
        }
        const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
        entries.push({
          path: relative, type: "file", dev: before.dev, ino: before.ino,
          size: before.size, mode: before.mode & 0o777, sha256: fileHash,
        });
        digest.update(`f\0${relative}\0${before.mode & 0o777}\0${fileHash}\n`);
      } else {
        throw new LitHermesError(`Unsupported entry in legacy skill at ${file}; refusing migration.`, 5);
      }
    }
  };
  visit(root);
  const after = fs.lstatSync(root);
  if (!after.isDirectory() || after.dev !== rootStat.dev || after.ino !== rootStat.ino) {
    throw new LitHermesError(`Legacy skill path changed during inspection at ${root}; refusing migration.`, 5);
  }
  return { rootStat, entries, digest: digest.digest("hex") };
}

function sameLegacySnapshot(left, right) {
  return Boolean(left && right && left.digest === right.digest
    && JSON.stringify(left.entries) === JSON.stringify(right.entries)
    && left.rootStat.dev === right.rootStat.dev && left.rootStat.ino === right.rootStat.ino);
}

// Permit a migration only when every manifest-owned path outside the retired
// skill is unchanged. The old skill itself may be retained as one atomic tree.
function inspectLegacySkillMigration(hermesHome, manifest) {
  const dest = pluginDest(hermesHome);
  const destStat = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (!destStat?.isDirectory() || destStat.isSymbolicLink()) {
    return { present: false, valid: false, modified: false, caches: [] };
  }
  const skillsStat = fs.lstatSync(path.join(dest, "skills"), { throwIfNoEntry: false });
  if (!skillsStat?.isDirectory() || skillsStat.isSymbolicLink()) {
    return { present: false, valid: false, modified: false, caches: [] };
  }
  const root = path.join(dest, LEGACY_SKILL_PATH);
  const snapshot = snapshotLegacySkill(root);
  if (!snapshot) return { present: false, valid: false, modified: false, caches: [] };
  if (!validManifestFiles(manifest)) return { present: true, valid: false, modified: false, caches: [], snapshot };

  const owned = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  const legacyOwned = [...owned.keys()].filter(isLegacySkillPath);
  const outsideOwnedCount = owned.size - legacyOwned.length;
  const seenLegacy = new Set();
  const seenLegacyDirs = new Set([LEGACY_SKILL_PATH]);
  const matchedOutside = new Set();
  const caches = [];
  let modified = legacyOwned.length === 0;
  const scan = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).every((entry) => {
    const file = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const inLegacy = isLegacySkillPath(relative);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        const files = fs.readdirSync(file, { withFileTypes: true });
        const valid = files.length > 0 && files.every((cache) => {
          const match = /^([^.]+)\.[a-zA-Z][a-zA-Z0-9_-]*(?:\.opt-[0-9]+)?\.pyc$/.exec(cache.name);
          const source = match && path.relative(dest, path.join(dir, `${match[1]}.py`)).split(path.sep).join("/");
          return cache.isFile() && match && owned.has(source);
        });
        if (!valid) return false;
        const stat = fs.lstatSync(file);
        const cache = { path: relative, dev: stat.dev, ino: stat.ino, files: files.map((entry) => ({
          path: entry.name, sha256: sha256(path.join(file, entry.name)),
        })) };
        if (!inLegacy) caches.push(cache);
        return true;
      }
      if (inLegacy) {
        seenLegacyDirs.add(relative);
        if (!legacyOwned.some((name) => name.startsWith(`${relative}/`))) modified = true;
      } else if (![...owned.keys()].some((name) => name.startsWith(`${relative}/`))) {
        return false;
      }
      return scan(file, relative);
    }
    if (!entry.isFile()) return false;
    if (inLegacy) {
      seenLegacy.add(relative);
      if (!owned.has(relative) || sha256(file) !== owned.get(relative)) modified = true;
      return true;
    }
    if (!owned.has(relative) || sha256(file) !== owned.get(relative)) return false;
    matchedOutside.add(relative);
    return true;
  });
  if (!scan(dest)) return { present: true, valid: false, modified, caches, snapshot };
  if (matchedOutside.size !== outsideOwnedCount) return { present: true, valid: false, modified, caches, snapshot };
  if (legacyOwned.some((relative) => !seenLegacy.has(relative))) modified = true;
  const expectedDirs = new Set([LEGACY_SKILL_PATH]);
  for (const relative of legacyOwned) {
    let parent = path.posix.dirname(relative);
    while (parent.startsWith(`${LEGACY_SKILL_PATH}/`)) {
      expectedDirs.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  if ([...seenLegacyDirs].some((dir) => !expectedDirs.has(dir))) modified = true;
  return {
    present: true, valid: true, modified, caches, snapshot,
    destStat: directoryIdentity(destStat), skillsStat: directoryIdentity(skillsStat),
  };
}

function retainedLegacySkillPath(hermesHome, snapshot) {
  return path.join(hermesHome, "lithermes", "retained-skills", `lit-korean-${snapshot.digest}`);
}

function retainLegacySkill(hermesHome, migration, checkState) {
  const state = assertStateParent(hermesHome);
  const stateDir = path.join(hermesHome, "lithermes");
  const retainedRoot = path.join(stateDir, "retained-skills");
  let retainedStat = fs.lstatSync(retainedRoot, { throwIfNoEntry: false });
  if (!retainedStat) {
    fs.mkdirSync(retainedRoot, { mode: 0o700 });
    retainedStat = fs.lstatSync(retainedRoot);
  }
  if (!retainedStat.isDirectory() || retainedStat.isSymbolicLink() || (retainedStat.mode & 0o077)) {
    throw new LitHermesError(`Unsafe retained-skills directory at ${retainedRoot}; refusing migration.`, 5);
  }
  const target = retainedLegacySkillPath(hermesHome, migration.snapshot);
  const source = path.join(pluginDest(hermesHome), LEGACY_SKILL_PATH);
  const verify = () => {
    checkState();
    assertPluginParent(hermesHome);
    const nowState = fs.lstatSync(stateDir);
    const nowRetained = fs.lstatSync(retainedRoot);
    const nowDest = fs.lstatSync(pluginDest(hermesHome));
    const nowSkills = fs.lstatSync(path.join(pluginDest(hermesHome), "skills"));
    if (nowState.dev !== state.dev || nowState.ino !== state.ino
      || nowRetained.dev !== retainedStat.dev || nowRetained.ino !== retainedStat.ino
      || nowDest.dev !== migration.destStat.dev || nowDest.ino !== migration.destStat.ino
      || nowSkills.dev !== migration.skillsStat.dev || nowSkills.ino !== migration.skillsStat.ino
      || fs.lstatSync(target, { throwIfNoEntry: false })) {
      throw new LitHermesError("Retained legacy skill destination changed; refusing migration.", 5);
    }
    const current = snapshotLegacySkill(source);
    if (!sameLegacySnapshot(migration.snapshot, current)) {
      throw new LitHermesError("Modified legacy skill changed before retention; refusing migration.", 5);
    }
  };
  verify();
  fs.renameSync(source, target);
  const moved = fs.lstatSync(target);
  if (!moved.isDirectory() || moved.dev !== migration.snapshot.rootStat.dev || moved.ino !== migration.snapshot.rootStat.ino) {
    throw new LitHermesError(`Legacy skill moved to an unexpected destination; inspect ${target}.`, 5);
  }
  return target;
}

function retainPythonCaches(hermesHome, manifest, caches, legacyMigration = null) {
  const parent = path.join(hermesHome, "lithermes");
  const parentStat = assertStateParent(hermesHome);
  const current = [];
  let matches = installedMatchesManifest(hermesHome, manifest, current);
  if (!matches && legacyMigration?.modified) {
    const inspected = inspectLegacySkillMigration(hermesHome, manifest);
    matches = inspected.valid && inspected.modified
      && sameLegacySnapshot(legacyMigration.snapshot, inspected.snapshot);
    if (matches) {
      current.length = 0;
      current.push(...inspected.caches);
    }
  }
  if (!matches || JSON.stringify(current) !== JSON.stringify(caches)) {
    throw new LitHermesError("Installed payload or Python cache changed before retention; refusing replacement.", 5);
  }
  const backup = fs.mkdtempSync(path.join(parent, "retained-python-cache-"));
  const backupStat = fs.lstatSync(backup);
  const safeBackup = () => {
    const nowParent = fs.lstatSync(parent);
    const nowBackup = fs.lstatSync(backup);
    return nowParent.isDirectory() && nowParent.dev === parentStat.dev && nowParent.ino === parentStat.ino
      && nowBackup.isDirectory() && nowBackup.dev === backupStat.dev && nowBackup.ino === backupStat.ino
      && (nowBackup.mode & 0o077) === 0;
  };
  try {
    if (path.dirname(backup) !== parent || !path.basename(backup).startsWith("retained-python-cache-")
      || !safeBackup() || fs.readdirSync(backup).length) throw new Error("Unsafe Python cache backup destination");
    writeFileAtomic(path.join(backup, "retention.json"), JSON.stringify({ pluginPath: pluginDest(hermesHome), caches }, null, 2), "utf8");
    for (const cache of caches) {
      const source = path.join(pluginDest(hermesHome), cache.path);
      const stat = fs.lstatSync(source);
      if (!safeBackup() || !stat.isDirectory() || stat.dev !== cache.dev || stat.ino !== cache.ino
        || fs.readdirSync(source).length !== cache.files.length
        || !cache.files.every((file) => {
          const cached = path.join(source, file.path);
          return fs.lstatSync(cached).isFile() && sha256(cached) === file.sha256;
        })) throw new Error("Python cache changed during retention");
      const target = path.join(backup, cache.path);
      let ancestor = backup;
      for (const part of cache.path.split("/").slice(0, -1)) {
        ancestor = path.join(ancestor, part);
        if (!fs.lstatSync(ancestor, { throwIfNoEntry: false })) fs.mkdirSync(ancestor, { mode: 0o700 });
        if (!safeBackup() || !fs.lstatSync(ancestor).isDirectory()) throw new Error("Unsafe Python cache backup ancestor");
      }
      if (!safeBackup() || fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error("Python cache backup target already exists");
      fs.renameSync(source, target);
    }
    return backup;
  } catch (error) {
    throw new LitHermesError(`${error.message}\nRetained Python cache backup: ${backup}`, 5);
  }
}

function isInstalledRegularFile(dest, relative) {
  let file = dest;
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory()) return false;
  const parts = relative.split("/");
  return parts.every((part, index) => {
    file = path.join(file, part);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return index === parts.length - 1 ? stat?.isFile() : stat?.isDirectory();
  });
}

// Version-aware install status (NOT a manifest-integrity check): distinguish a
// fresh install, a same-version reinstall, and a real upgrade so the message
// never claims "already up to date" while actually replacing an older version.
function installStatusLine(installedVersion, packageVersion) {
  if (!installedVersion) return `Installed LitHermes ${packageVersion}`;
  if (installedVersion === packageVersion) return `LitHermes already up to date (${packageVersion})`;
  return `Upgraded LitHermes ${installedVersion} → ${packageVersion}`;
}

function capabilityLines(plan, { dryRun = false } = {}) {
  const {
    autoCompaction,
    concurrency,
    delegationRoute,
    leadRoute,
    modelSafety,
    ordinaryWorkerRoute,
    recursion,
    reviewerRoutes,
    runtime,
    tuiRouteVisibility,
  } = plan.capabilities;
  const request = plan.request || managedRequest();
  const auto = autoCompaction.status === "hard"
    ? `hard (${autoCompaction.limit} tokens)`
    : `unavailable (${autoCompaction.reason.replace(/^Hermes 0\.17\.0 exposes /, "")})`;
  const sync = formatConcurrencyCapability(concurrency);
  const nesting = recursion.status === "hard"
    ? recursion.flatBy === "depth"
      ? `hard (depth ${recursion.limit}, flat)`
      : `hard (configured depth ${recursion.limit}, flat via orchestrator kill switch)`
    : `${recursion.status} (${recursion.reason})`;
  const wire = runtime.status === "hard"
    ? `hard (${runtime.provider} ${runtime.apiMode})`
    : `${runtime.status} (${runtime.reason})`;
  const routeLine = (label, route) => route.status === "configured"
    ? `${label}: configured (${route.model}, effort ${route.effort})`
    : `${label}: ${route.status} (${route.reason})`;
  const routeLines = dryRun
    ? [
      `lead route: requested (${request.model}, effort ${request.effort}; unapplied)`,
      `ordinary worker route: requested (${request.childModel}, effort ${request.childEffort}; unapplied)`,
      `${unavailableReviewerRouteName()} route: unavailable (${unavailableReviewerRoutes().reason})`,
      `litwork-reviewer route: unavailable (${unavailableReviewerRoutes().reason})`,
      `TUI route visibility: unavailable (${unavailableTuiRouteVisibility().reason})`,
    ]
    : [
      routeLine("lead route", leadRoute),
      routeLine("ordinary worker route", ordinaryWorkerRoute),
      routeLine(`${unavailableReviewerRouteName()} route`, reviewerRoutes),
      routeLine("litwork-reviewer route", reviewerRoutes),
      routeLine("TUI route visibility", tuiRouteVisibility),
    ];
  return [
    `auto-compaction: ${auto}`,
    `concurrency: ${sync}`,
    `recursion: ${nesting}`,
    `model route safety: ${modelSafety.status}${modelSafety.code ? ` (${modelSafety.code}; ${modelSafety.reason})` : ` (${modelSafety.reason})`}`,
    `runtime: ${wire}`,
    `global child route: ${formatManagedRoute(delegationRoute)}`,
    ...routeLines,
  ];
}

function legacySkillMigrationPreview(hermesHome) {
  const dest = pluginDest(hermesHome);
  if (!fs.lstatSync(dest, { throwIfNoEntry: false })?.isDirectory()) return null;
  const legacy = path.join(dest, LEGACY_SKILL_PATH);
  if (!fs.lstatSync(legacy, { throwIfNoEntry: false })) return null;
  try {
    const inspected = inspectLegacySkillMigration(hermesHome, loadManifest(hermesHome));
    if (!inspected.valid) return "legacy skill migration: blocked by unsafe or unrelated installed plugin drift";
    return inspected.modified
      ? `legacy skill migration: would retain modified copy at ${retainedLegacySkillPath(hermesHome, inspected.snapshot)}`
      : "legacy skill migration: clean managed copy would be removed by plugin replacement";
  } catch {
    return "legacy skill migration: could not safely inspect the existing copy";
  }
}

// Installer flags → managedRequest options (contract §Non-interactive defaults).
function routeOptions(flags = {}) {
  return {
    childEffort: flags["child-effort"],
    childModel: flags["child-model"],
    childProvider: flags["child-provider"],
    effort: flags.effort,
    model: flags.model,
    provider: flags.provider,
  };
}

// Tells the CLI whether the model prompts apply: only a fresh/unconfigured
// config or an explicit --reconfigure-model may rewrite the managed route.
// Read-only — nothing may touch the disk before the summary-card consent.
function previewModelRoute(flags = {}) {
  const hermesHome = defaultHermesHome(flags);
  assertStateParent(hermesHome);
  const hermesRepo = defaultHermesRepo(flags, hermesHome);
  const plan = planModelConfig(readConfig(hermesHome), {
    ...routeOptions(flags),
    hostCapabilities: inspectHermesHostCapabilities(hermesRepo || detectHermesRuntimeRepo()),
    hostVersion: detectHermesVersion(),
    reconfigure: Boolean(flags["reconfigure-model"]),
  });
  return {
    action: plan.action,
    configPath: path.join(hermesHome, "config.yaml"),
    reason: plan.reason,
    request: plan.request || null,
  };
}

function installLitHermes(flags = {}) {
  const dryRun = Boolean(flags["dry-run"]);
  const homeInfo = dryRun
    ? (() => {
      const hermesHome = defaultHermesHome(flags);
      return { hermesHome, hermesRepo: defaultHermesRepo(flags, hermesHome) };
    })()
    : ensureHermesHome(flags, { forInstall: true });
  const { hermesHome, hermesRepo } = homeInfo;
  const state = assertStateParent(hermesHome);
  const dest = pluginDest(hermesHome);
  const onProgress = typeof flags.onProgress === "function" ? flags.onProgress : () => {};
  const beforeConfig = readConfig(hermesHome);
  const capabilityRepo = hermesRepo || (dryRun ? null : detectHermesRuntimeRepo());
  const modelPlan = planModelConfig(beforeConfig, {
    ...routeOptions(flags),
    hostCapabilities: inspectHermesHostCapabilities(capabilityRepo),
    hostVersion: dryRun ? NOT_PROBED_HOST_VERSION : detectHermesVersion(),
    reconfigure: Boolean(flags["reconfigure-model"]),
  });
  if (modelPlan.action === "stop") {
    throw new LitHermesError(
      `${modelPlan.stop.code}: ${modelPlan.reason}; update the existing route with \`hermes model\` before installing.`,
      10,
    );
  }
  if (dryRun) {
    const selectedModel = modelPlan.request?.model || ASTRA_MODEL;
    const selectedEffort = modelPlan.request?.effort || "xhigh";
    const legacyPreview = legacySkillMigrationPreview(hermesHome);
    return {
      message: [
        "DRY RUN: would install LitHermes",
        `plugin: ${dest}`,
        `config: ${path.join(hermesHome, "config.yaml")}`,
        `manifest: ${manifestPath(hermesHome)}`,
        "Hermes CLI discovery: skipped (dry-run does not execute Hermes)",
        `model config: ${modelPlan.action === "preserve" ? "preserved" : modelPlan.action}`,
        ...(modelPlan.action === "write"
          ? [`model: ${selectedModel}`, `effort: ${selectedEffort}`]
          : [
            `requested model (unapplied): ${selectedModel}`,
            `requested effort (unapplied): ${selectedEffort}`,
          ]),
        ...(modelPlan.action === "fallback" ? [`reason: ${modelPlan.reason}`, `fallback: ${modelPlan.fallbackCommand}`] : []),
        ...(legacyPreview ? [legacyPreview] : []),
        ...capabilityLines(modelPlan, { dryRun: true }),
      ].join("\n"),
    };
  }
  if (!flags.yes) {
    throw new LitHermesError("Refusing to mutate Hermes config without --yes. Re-run with --dry-run to inspect changes.", 4);
  }
  onProgress("Preparing Hermes config");
  let retainedPythonCache = null;
  let retainedLegacySkill = null;
  try {
  return withLock(hermesHome, (checkState) => {
    assertPluginParent(hermesHome);
    onProgress("Inspecting existing plugin");
    checkState();
    const existingManifest = loadManifest(hermesHome);
    const packageVersion = require(path.join(packageRoot, "package.json")).version;
    const destinationExists = Boolean(fs.lstatSync(dest, { throwIfNoEntry: false }));
    const installedVersion = destinationExists && existingManifest ? existingManifest.version : null;
    const caches = [];
    let legacyMigration = destinationExists && existingManifest && !flags.force
      ? inspectLegacySkillMigration(hermesHome, existingManifest)
      : null;
    const pristinePayload = destinationExists && installedMatchesManifest(hermesHome, existingManifest, caches);
    if (destinationExists && !pristinePayload && !flags.force && !(legacyMigration?.valid && legacyMigration.modified)) {
      throw new LitHermesError(`Existing LitHermes plugin at ${dest} is not manifest-owned. Use --force after backing it up.`, 5);
    }
    if (destinationExists && existingManifest && !flags.force) validateLegacyVendorMigration(hermesHome, existingManifest);
    if (!pristinePayload && legacyMigration?.valid && legacyMigration.modified) {
      caches.length = 0;
      caches.push(...legacyMigration.caches);
    }
    onProgress("Copying LitHermes payload");
    checkState();
    if (!flags.force && destinationExists) {
      if (caches.length) retainedPythonCache = retainPythonCaches(hermesHome, existingManifest, caches, legacyMigration);
      assertPluginParent(hermesHome);
      if (legacyMigration?.modified) {
        const currentLegacy = inspectLegacySkillMigration(hermesHome, existingManifest);
        if (!currentLegacy.valid || !currentLegacy.modified
          || !sameLegacySnapshot(legacyMigration.snapshot, currentLegacy.snapshot)
          || currentLegacy.caches.length) {
          throw new LitHermesError("Installed payload changed before replacement; refusing to remove files.", 5);
        }
        legacyMigration = currentLegacy;
        retainedLegacySkill = retainLegacySkill(hermesHome, legacyMigration, checkState);
      } else {
        const remainingCaches = [];
        if (!installedMatchesManifest(hermesHome, existingManifest, remainingCaches) || remainingCaches.length) {
          throw new LitHermesError("Installed payload changed before replacement; refusing to remove files.", 5);
        }
      }
    }
    // Replacing the manifest-owned tree also migrates renamed skills: old
    // directories disappear and the new inventory becomes the install receipt.
    checkState();
    assertPluginParent(hermesHome);
    fs.rmSync(dest, { recursive: true, force: true });
    const files = copyTree(assetRoot, dest);
    onProgress("Writing Hermes config");
    checkState();
    let afterConfig = beforeConfig;
    let configAddedLitHermes = false;
    let effectiveModelAction = modelPlan.action;
    let effectiveCapabilities = modelPlan.capabilities;
    let modelReceipt = { backupPath: null, written: false };
    if (modelPlan.action === "write") {
      const plannedConfig = enableLitHermesConfig(modelPlan.text);
      modelReceipt = applyModelConfigPlan(hermesHome, { ...modelPlan, text: plannedConfig });
      if (modelReceipt.written) {
        afterConfig = plannedConfig;
        configAddedLitHermes = !configHasLitHermes(beforeConfig) && configHasLitHermes(afterConfig);
      } else if (modelReceipt.drifted) {
        afterConfig = readConfig(hermesHome);
        effectiveModelAction = "aborted";
        effectiveCapabilities = inspectHermesCapabilities(afterConfig);
      }
    } else if (modelPlan.action === "preserve") {
      const validation = revalidateModelConfigPlan(hermesHome, modelPlan);
      if (validation.ok) {
        afterConfig = enableLitHermesConfig(validation.current);
        if (afterConfig !== validation.current) {
          writeConfig(hermesHome, afterConfig);
          configAddedLitHermes = true;
        }
      } else {
        afterConfig = validation.current;
        modelReceipt = { backupPath: null, drifted: true, reason: validation.reason, written: false };
        effectiveModelAction = "aborted";
        effectiveCapabilities = inspectHermesCapabilities(afterConfig);
      }
    }
    if (!configAddedLitHermes && !configHasLitHermes(afterConfig)) {
      afterConfig = enableLitHermesConfig(afterConfig);
      writeConfig(hermesHome, afterConfig);
      configAddedLitHermes = true;
    }
    // Managed helper-visibility key, written only alongside a config write this
    // install already made — a preserved user config stays byte-identical
    // (Hermes defaults display.tui_agents_nudge to true anyway).
    if (configAddedLitHermes || (modelPlan.action === "write" && modelReceipt.written)) {
      const nudgedConfig = setTuiAgentsNudgeConfig(afterConfig);
      if (nudgedConfig !== afterConfig) {
        afterConfig = nudgedConfig;
        writeConfig(hermesHome, afterConfig);
      }
    }
    onProgress("Installing HUD skins");
    checkState();
    let skinFiles = [];
    try {
      skinFiles = installSkins(hermesHome);
    } catch {
      // HUD skins are optional polish; never fail the install over them.
    }
    onProgress("Recording install manifest");
    checkState();
    const retainedLegacySkillRecord = retainedLegacySkill || existingManifest?.retainedLegacySkill || null;
    const manifest = {
      version: packageVersion,
      distribution: "npm",
      installedAt: new Date().toISOString(),
      pluginPath: dest,
      configPath: path.join(hermesHome, "config.yaml"),
      files,
      configAddedLitHermes,
      modelConfigAction: effectiveModelAction,
      modelConfigReason: modelPlan.reason,
      ...(retainedPythonCache ? { retainedPythonCache } : {}),
      ...(retainedLegacySkillRecord ? { retainedLegacySkill: retainedLegacySkillRecord } : {}),
    };
    fs.mkdirSync(path.dirname(manifestPath(hermesHome)), { recursive: true });
    writeFileAtomic(manifestPath(hermesHome), JSON.stringify(manifest, null, 2), "utf8");
    let patchResult = null;
    let patchWarning = null;
    const shouldPatch = Boolean(flags["patch-installed-hermes"] || (!flags["no-patch-installed-hermes"] && hermesRepo));
    if (shouldPatch) {
      onProgress("Checking Hermes compatibility patches");
    checkState();
      try {
        patchResult = patchInstalledHermes({ hermesHome, hermesRepo, force: flags.force });
      } catch (error) {
        if (flags["patch-installed-hermes"]) throw error;
        patchWarning = error.message;
      }
    }
    const lines = [
      installStatusLine(installedVersion, packageVersion),
      `plugin: ${dest}`,
      ...(retainedPythonCache ? [`Retained Python cache backup: ${retainedPythonCache}`] : []),
      ...(retainedLegacySkill ? [`warning: modified legacy lit-korean skill retained at ${retainedLegacySkill}`] : []),
      `model config: ${effectiveModelAction === "write" ? "updated" : effectiveModelAction === "preserve" ? "preserved" : effectiveModelAction}`,
      ...(modelReceipt.backupPath ? [`model backup: ${modelReceipt.backupPath}`] : []),
      ...(modelReceipt.drifted ? [`model write: aborted (${modelReceipt.reason})`] : []),
      ...(modelPlan.action === "fallback" ? [
        `model reason: ${modelPlan.reason}`,
        `model fallback: ${modelPlan.fallbackCommand}`,
        ...(modelPlan.credentialKey
          ? [`credential guard: ${modelPlan.credentialKey} detected; use \`hermes model\` to manage it; installer left config untouched`]
          : []),
      ] : []),
      ...capabilityLines({ capabilities: effectiveCapabilities }),
    ];
    if (patchResult) {
      lines.push(
        patchResult.native
          ? "patches: native PluginContext.inject_message dispatch (no source patch)"
          : `patches: ${patchResult.changed.length ? patchResult.changed.join(", ") : "none needed"}`,
      );
    }
    if (patchWarning) lines.push(`patches: skipped (${patchWarning})`);
    const credentialWarning = modelPlan.request && effectiveModelAction === "write"
      ? missingCredentialWarning(modelPlan.request, process.env)
      : null;
    if (credentialWarning) lines.push(`warning: ${credentialWarning}`);
    if (skinFiles.length) lines.push(`HUD skins: ${skinFiles.length} accents installed — pick one with \`npx --package @litfamily/lithermes -- lithermes hud <accent>\``);
    lines.push("Restart any running Hermes gateway to load new plugins.");
    return { message: lines.join("\n") };
  }, state);
  } catch (error) {
    if (retainedPythonCache) error.message += `\nRetained Python cache backup: ${retainedPythonCache}`;
    if (retainedLegacySkill) error.message += `\nRetained modified legacy skill: ${retainedLegacySkill}`;
    throw error;
  }
}

function uninstallLitHermes(flags = {}) {
  const { hermesHome } = ensureHermesHome(flags);
  const state = assertStateParent(hermesHome);
  if (!flags.yes) {
    throw new LitHermesError("Refusing to uninstall without --yes.", 4);
  }
  return withLock(hermesHome, (checkState) => {
    assertPluginParent(hermesHome);
    const rollback = flags["rollback-patches"] ? rollbackPatches({ hermesHome }) : null;
    const manifest = loadManifest(hermesHome);
    checkState();
    if (!manifest) return { message: rollback ? `LitHermes is not installed by this installer.\n${rollback.message}` : "LitHermes is not installed by this installer." };
    if (!validManifestFiles(manifest)) throw new LitHermesError("Invalid LitHermes install manifest; refusing to remove files.", 5);
    const dest = pluginDest(hermesHome);
    for (const entry of [...manifest.files].reverse()) {
      checkState();
      assertPluginParent(hermesHome);
      const file = path.join(dest, entry.path);
      if (isInstalledRegularFile(dest, entry.path) && sha256(file) === entry.sha256) {
        fs.unlinkSync(file);
        removeEmptyDirs(path.dirname(file), dest);
      }
    }
    if (fs.lstatSync(dest, { throwIfNoEntry: false })?.isDirectory() && fs.readdirSync(dest).length === 0) fs.rmdirSync(dest);
    checkState();
    writeConfig(hermesHome, disableLitHermesConfig(readConfig(hermesHome)));
    checkState();
    fs.unlinkSync(manifestPath(hermesHome));
    return { message: rollback ? `Uninstalled LitHermes\n${rollback.message}` : "Uninstalled LitHermes" };
  }, state);
}

module.exports = {
  assetRoot,
  installLitHermes,
  installStatusLine,
  loadManifest,
  manifestPath,
  pluginDest,
  previewModelRoute,
  uninstallLitHermes,
};
