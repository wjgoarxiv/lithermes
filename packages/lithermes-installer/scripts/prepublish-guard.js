#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const SHORT_DEADLINE_MS = 30_000;
const LONG_DEADLINE_MS = 15 * 60_000;
const TERMINATION_GRACE_MS = 2_000;
const TERMINATION_VERIFY_MS = 2_000;

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

function sanitizedChildEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run"),
  );
}

function createCommandRunner(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const signalTarget = options.signalTarget || process;
  const childEnv = sanitizedChildEnv(options.env || process.env);
  const terminationGraceMs = options.terminationGraceMs ?? TERMINATION_GRACE_MS;
  const terminationVerifyMs = options.terminationVerifyMs ?? TERMINATION_VERIFY_MS;
  // POSIX detached children are owned as process groups. Windows has no
  // equivalent negative-PID signal, so it fails closed after child-only cleanup.
  const detached = options.detached ?? process.platform !== "win32";
  const timers = new Set();
  let active = null;
  let interruptedSignal = null;
  let disposed = false;

  function clearTimer(timer) {
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(timer);
  }

  function setTimer(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function signalChild(record, signal) {
    if (!record) return;
    try {
      if (record.groupId) process.kill(-record.groupId, signal);
      else if (!record.closed) record.child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") record.signalError = error;
    }
  }

  function groupExists(record) {
    if (!record.groupId) return !record.closed;
    try {
      process.kill(-record.groupId, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (error.code !== "EPERM") record.signalError = error;
      return true;
    }
  }

  function wait(delay) {
    return new Promise((resolve) => setTimer(resolve, delay));
  }

  async function waitForGroupGone(record, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (groupExists(record) && Date.now() < deadline) await wait(20);
    return !groupExists(record);
  }

  async function waitForLeaderClose(record, timeoutMs) {
    if (record.closed) return true;
    await Promise.race([record.closePromise, wait(timeoutMs)]);
    return record.closed;
  }

  function finishTermination(record) {
    if (record.terminationPromise) return record.terminationPromise;
    record.terminationPromise = (async () => {
      if (record.groupId) {
        let groupGone = await waitForGroupGone(record, terminationGraceMs);
        if (!groupGone) {
          signalChild(record, "SIGKILL");
          groupGone = await waitForGroupGone(record, terminationVerifyMs);
        }
        if (!groupGone) record.signalError ||= new Error("process group survived SIGKILL");
        if (!await waitForLeaderClose(record, terminationVerifyMs)) {
          record.signalError ||= new Error("process-group leader did not close");
        }
      } else {
        let leaderClosed = await waitForLeaderClose(record, terminationGraceMs);
        if (!leaderClosed) {
          signalChild(record, "SIGKILL");
          leaderClosed = await waitForLeaderClose(record, terminationVerifyMs);
        }
        if (!leaderClosed) record.signalError ||= new Error("child process survived SIGKILL");
      }
      record.terminationComplete = true;
      record.maybeResolve();
    })();
    return record.terminationPromise;
  }

  function terminate(record, signal) {
    if (!record || record.terminationRequested) return;
    record.terminationRequested = true;
    signalChild(record, signal);
    void finishTermination(record);
  }

  function forward(signal) {
    if (!interruptedSignal) interruptedSignal = signal;
    if (active) terminate(active, signal);
  }

  const onSigint = () => forward("SIGINT");
  const onSigterm = () => forward("SIGTERM");
  signalTarget.on("SIGINT", onSigint);
  signalTarget.on("SIGTERM", onSigterm);

  function interruptionError(signal = interruptedSignal) {
    const error = new Error(`prepublish guard interrupted by ${signal}`);
    error.signal = signal;
    error.exitCode = signalExitCode(signal);
    return error;
  }

  async function runCommand(command, args, runOptions) {
    if (disposed) throw new Error("command runner is disposed");
    if (interruptedSignal) throw interruptionError();
    const deadlineMs = runOptions.deadlineMs;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
      throw new Error("command deadline must be a positive integer");
    }

    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(command, args, {
          cwd: runOptions.cwd,
          detached,
          env: childEnv,
          stdio: runOptions.capture ? ["ignore", "pipe", "pipe"] : "inherit",
        });
      } catch (error) {
        resolve({ status: null, signal: null, stdout: "", stderr: "", error, timedOut: false });
        return;
      }

      const stdout = [];
      const stderr = [];
      const record = {
        child,
        groupId: detached && child.pid ? child.pid : null,
        closed: false,
        deadlineTimer: null,
        signalError: null,
        terminationRequested: false,
        terminationComplete: false,
        terminationPromise: null,
        status: null,
        closeSignal: null,
      };
      if (runOptions.capture) {
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      }

      let spawnError = null;
      let timedOut = false;
      child.once("error", (error) => {
        spawnError = error;
      });
      record.closePromise = new Promise((closeResolve) => {
        child.once("close", (status, signal) => {
          record.closed = true;
          record.status = status;
          record.closeSignal = signal;
          clearTimer(record.deadlineTimer);
          closeResolve();
          record.maybeResolve();
        });
      });
      let resolved = false;
      record.maybeResolve = () => {
        if (
          resolved
          || (!record.closed && !record.terminationComplete)
          || (record.terminationRequested && !record.terminationComplete)
        ) return;
        resolved = true;
        if (active === record) active = null;
        resolve({
          status: record.status,
          signal: record.closeSignal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          error: spawnError || record.signalError,
          timedOut,
          interruptedSignal,
        });
      };
      active = record;
      if (interruptedSignal) terminate(record, interruptedSignal);
      record.deadlineTimer = setTimer(() => {
        timedOut = true;
        terminate(record, "SIGTERM");
      }, deadlineMs);
    });
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    signalTarget.removeListener("SIGINT", onSigint);
    signalTarget.removeListener("SIGTERM", onSigterm);
    if (active && !active.closed) {
      terminate(active, "SIGTERM");
      await active.closePromise;
      await active.terminationPromise;
    } else if (active?.terminationPromise) {
      await active.terminationPromise;
    }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  return { dispose, runCommand };
}

function output(result, field) {
  const value = result?.[field];
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return typeof value === "string" ? value : "";
}

function requireCompleted(result, label) {
  if (result?.interruptedSignal) {
    const error = new Error(`${label} interrupted by ${result.interruptedSignal}`);
    error.signal = result.interruptedSignal;
    error.exitCode = signalExitCode(result.interruptedSignal);
    throw error;
  }
  if (result?.timedOut) {
    const error = new Error(`${label} exceeded its command deadline`);
    error.timedOut = true;
    throw error;
  }
  if (result?.error || result?.signal || typeof result?.status !== "number") {
    throw new Error(`${label} did not complete cleanly`);
  }
  return result;
}

function requireSuccess(result, label) {
  requireCompleted(result, label);
  if (result.status !== 0) throw new Error(`${label} failed closed`);
  return result;
}

async function run(runCommand, packageRoot, command, args, capture, label, deadlineMs) {
  return requireSuccess(
    await runCommand(command, args, { cwd: packageRoot, capture, deadlineMs }),
    label,
  );
}

function parseSingleJsonChannel(result, label) {
  requireCompleted(result, label);
  const channels = [output(result, "stdout").trim(), output(result, "stderr").trim()].filter(Boolean);
  if (channels.length !== 1) throw new Error(`${label} is not one structured JSON response`);
  try {
    return { parsed: JSON.parse(channels[0]), raw: channels[0] };
  } catch {
    throw new Error(`${label} is not one structured JSON response`);
  }
}

function requireStructuredAbsence(result) {
  requireCompleted(result, "target-version lookup");
  if (result?.status === 0) throw new Error("target package version already exists");
  let response;
  try {
    response = parseSingleJsonChannel(result, "target-version lookup");
  } catch {
    throw new Error("target-version lookup did not return one structured E404 response");
  }
  const error = response.parsed?.error;
  const codes = response.raw.match(/\bE[A-Z0-9]{3,}\b/g) || [];
  if (
    !error
    || typeof error !== "object"
    || Array.isArray(error)
    || error.code !== "E404"
    || typeof error.summary !== "string"
    || !error.summary
    || typeof error.detail !== "string"
    || !error.detail
    || codes.some((code) => code !== "E404")
  ) {
    throw new Error("target-version lookup did not return one structured E404 response");
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeArchivePath(workspace, packJson) {
  if (!Array.isArray(packJson) || packJson.length !== 1) {
    throw new Error("pack output must describe exactly one archive");
  }
  const filename = packJson[0]?.filename;
  if (
    typeof filename !== "string"
    || !filename.endsWith(".tgz")
    || filename !== path.basename(filename)
  ) {
    throw new Error("pack output contains an unsafe archive name");
  }
  const archive = path.join(workspace, filename);
  const stat = fs.lstatSync(archive, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error("pack output archive is not a regular file");
  }
  return archive;
}

function parseScanReceipt(result) {
  requireCompleted(result, "packed-artifact scanner");
  if (result.status !== 0) throw new Error("packed-artifact scanner failed closed");
  let receipt;
  try {
    receipt = parseSingleJsonChannel(result, "packed-artifact scanner").parsed;
  } catch {
    throw new Error("packed-artifact scanner returned a malformed receipt");
  }
  const validated = receipt?.validatedArchive;
  if (
    receipt?.ok !== true
    || !Array.isArray(receipt.hits)
    || receipt.hits.length !== 0
    || !validated
    || !Number.isSafeInteger(validated.bytes)
    || validated.bytes <= 0
    || !/^[a-f0-9]{64}$/.test(validated.sha256 || "")
    || validated.source !== "descriptor-captured-private-snapshot"
  ) {
    throw new Error("packed-artifact scanner returned a non-zero-hit receipt");
  }
  return validated;
}

async function runLocalSnapshot({ expectedHead, packageRoot, runCommand }) {
  const status = await run(
    runCommand, packageRoot, "git", ["status", "--porcelain"], true, "git status", SHORT_DEADLINE_MS,
  );
  if (output(status, "stdout") !== "") throw new Error("worktree must be clean");

  const branch = await run(
    runCommand, packageRoot, "git", ["branch", "--show-current"], true, "git branch", SHORT_DEADLINE_MS,
  );
  if (output(branch, "stdout").trim() !== "main") throw new Error("release must run from the main branch");

  const head = output(await run(
    runCommand,
    packageRoot,
    "git",
    ["rev-parse", "--verify", "HEAD"],
    true,
    "local HEAD lookup",
    SHORT_DEADLINE_MS,
  ), "stdout").trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("local HEAD lookup returned a malformed commit");
  if (expectedHead && head !== expectedHead) throw new Error("local HEAD changed after final authoritative checks");
  return { head };
}

async function runAuthoritativeGuards({ packageMetadata, packageRoot, runCommand }) {
  const local = await runLocalSnapshot({ packageRoot, runCommand });
  const remote = output(await run(
    runCommand,
    packageRoot,
    "git",
    ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    true,
    "live origin/main lookup",
    SHORT_DEADLINE_MS,
  ), "stdout").trim();
  const remoteMatch = remote.match(/^([a-f0-9]{40})\trefs\/heads\/main$/);
  if (!remoteMatch || local.head !== remoteMatch[1]) {
    throw new Error("local HEAD must equal live origin/main");
  }

  const configuredRegistry = output(await run(
    runCommand,
    packageRoot,
    "npm",
    ["config", "get", "registry"],
    true,
    "npm registry lookup",
    SHORT_DEADLINE_MS,
  ), "stdout").trim();
  if (configuredRegistry !== PUBLIC_REGISTRY) throw new Error("npm registry must be exactly the public registry");

  const identity = await run(
    runCommand,
    packageRoot,
    "npm",
    ["whoami", `--registry=${PUBLIC_REGISTRY}`],
    true,
    "npm authentication",
    SHORT_DEADLINE_MS,
  );
  if (!output(identity, "stdout").trim()) throw new Error("npm authentication returned no identity");

  const packageSpec = `${packageMetadata.name}@${packageMetadata.version}`;
  const versionResult = await runCommand(
    "npm",
    ["view", packageSpec, "version", "--json", "--loglevel=silent", `--registry=${PUBLIC_REGISTRY}`],
    { cwd: packageRoot, capture: true, deadlineMs: SHORT_DEADLINE_MS },
  );
  requireStructuredAbsence(versionResult);
  return local;
}

async function runPrepublishGuard(dependencies = {}) {
  const packageRoot = dependencies.packageRoot || path.resolve(__dirname, "..");
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const scanner = path.join(packageRoot, "test", "scripts", "scan-forbidden-tokens.js");
  const ownedRunner = dependencies.commandRunner || dependencies.runCommand
    ? null
    : createCommandRunner();
  const commandRunner = dependencies.commandRunner || ownedRunner;
  const runCommand = dependencies.runCommand || commandRunner.runCommand;
  const makeTempWorkspace = dependencies.makeTempWorkspace
    || (() => fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-prepublish.")));
  const removeTempWorkspace = dependencies.removeTempWorkspace
    || ((workspace) => fs.rmSync(workspace, { recursive: true, force: true }));

  try {
    const guardInputs = { packageMetadata, packageRoot, runCommand };
    await runAuthoritativeGuards(guardInputs);

    for (const [command, args, label] of [
      ["npm", ["test"], "Node test gate"],
      ["npm", ["run", "test:python"], "Python test gate"],
      [process.execPath, [scanner, "--tracked"], "tracked scanner gate"],
      [process.execPath, [scanner, "--package-root"], "package-root scanner gate"],
      ["npm", ["run", "qa:real-surface"], "real-surface QA gate"],
    ]) {
      await run(runCommand, packageRoot, command, args, false, label, LONG_DEADLINE_MS);
    }

    let workspace = null;
    try {
      workspace = makeTempWorkspace();
      const stat = fs.lstatSync(workspace, { throwIfNoEntry: false });
      if (!stat?.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw new Error("temporary release workspace is not private");
      }
      await run(
        runCommand, packageRoot, "npm", ["run", "clean:payload"], false, "payload cleanup", LONG_DEADLINE_MS,
      );
      const packed = await run(
        runCommand,
        packageRoot,
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace],
        true,
        "npm pack",
        LONG_DEADLINE_MS,
      );
      const packJson = parseSingleJsonChannel(packed, "npm pack").parsed;
      const archive = safeArchivePath(workspace, packJson);
      const snapshot = path.join(workspace, "validated.tgz");
      const scanned = await runCommand(
        process.execPath,
        [scanner, "--pack-tar", archive, "--snapshot-out", snapshot, "--json"],
        { cwd: packageRoot, capture: true, deadlineMs: LONG_DEADLINE_MS },
      );
      const receipt = parseScanReceipt(scanned);
      const snapshotStat = fs.lstatSync(snapshot, { throwIfNoEntry: false });
      if (!snapshotStat?.isFile() || snapshotStat.isSymbolicLink()) {
        throw new Error("validated scanner snapshot is not a regular file");
      }
      const snapshotBytes = fs.readFileSync(snapshot);
      if (snapshotBytes.length !== receipt.bytes || sha256(snapshotBytes) !== receipt.sha256) {
        throw new Error("validated scanner snapshot digest does not match its receipt");
      }
      const finalLocal = await runAuthoritativeGuards(guardInputs);
      await runLocalSnapshot({ ...guardInputs, expectedHead: finalLocal.head });
      return { ok: true, bytes: receipt.bytes, sha256: receipt.sha256 };
    } finally {
      if (workspace) removeTempWorkspace(workspace);
    }
  } finally {
    if (ownedRunner) await ownedRunner.dispose();
  }
}

async function main() {
  try {
    const receipt = await runPrepublishGuard();
    process.stdout.write(`prepublish guard passed sha256=${receipt.sha256} bytes=${receipt.bytes}\n`);
  } catch (error) {
    process.stderr.write(`prepublish guard refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.exitCode || 1;
  }
}

if (require.main === module) void main();

module.exports = {
  LONG_DEADLINE_MS,
  PUBLIC_REGISTRY,
  SHORT_DEADLINE_MS,
  createCommandRunner,
  parseScanReceipt,
  requireCompleted,
  requireStructuredAbsence,
  runAuthoritativeGuards,
  runLocalSnapshot,
  runPrepublishGuard,
};
