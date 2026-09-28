const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const guardPath = path.join(packageRoot, "scripts", "prepublish-guard.js");

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`);
}

async function spawnReady(command, args, options, readyFile) {
  const child = spawn(command, args, options);
  try {
    await waitForFile(readyFile);
    return child;
  } catch (error) {
    if (child.pid) forceKill(child.pid);
    throw error;
  }
}

async function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("subprocess did not exit")), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForPidGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} survived cleanup`);
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function forceKill(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function realJsonResult(t, payload, termination) {
  const { createCommandRunner } = require(guardPath);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-runner-json."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const readyFile = path.join(sandbox, "ready");
  const signalTarget = new EventEmitter();
  const args = [
    "-e",
    `const fs=require("node:fs");fs.writeSync(1,${JSON.stringify(JSON.stringify(payload))});`
      + `fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");setInterval(()=>{},1000)`,
  ];
  const child = await spawnReady(process.execPath, args, {
    cwd: packageRoot,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }, readyFile);
  const runner = createCommandRunner({
    signalTarget,
    terminationGraceMs: 60,
    spawnImpl() {
      return child;
    },
  });
  const resultPromise = runner.runCommand(
    process.execPath,
    args,
    { cwd: packageRoot, capture: true, deadlineMs: termination === "timeout" ? 100 : 5000 },
  );
  if (termination !== "timeout") {
    signalTarget.emit(termination);
  }
  const result = await resultPromise;
  await runner.dispose();
  return result;
}

test("timeout kills a TERM-resistant descendant after its process-group leader exits", {
  skip: process.platform === "win32" ? "POSIX process-group probe" : false,
}, async (t) => {
  const { createCommandRunner } = require(guardPath);
  assert.equal(typeof createCommandRunner, "function");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-runner-timeout."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const pidsFile = path.join(sandbox, "pids.txt");
  const worker = path.join(sandbox, "worker.js");
  fs.writeFileSync(worker, `
    const fs = require("node:fs");
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
    fs.writeFileSync(process.argv[2], process.pid + " " + child.pid);
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1000);
  `);

  t.after(() => {
    if (!fs.existsSync(pidsFile)) return;
    for (const pid of fs.readFileSync(pidsFile, "utf8").trim().split(" ").map(Number)) forceKill(pid);
  });

  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  const runner = createCommandRunner({ terminationGraceMs: 80 });
  const started = Date.now();
  const result = await runner.runCommand(process.execPath, [worker, pidsFile], {
    cwd: packageRoot,
    capture: true,
    deadlineMs: 500,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.status, 0);
  assert.ok(Date.now() - started < 2500, "timeout and escalation must remain bounded");
  const pids = (await waitForFile(pidsFile)).split(" ").map(Number);
  for (const pid of pids) assert.equal(pidExists(pid), false, `process ${pid} remained when runCommand resolved`);
  await runner.dispose();
  for (const pid of pids) await waitForPidGone(pid);
  assert.equal(process.listenerCount("SIGINT"), beforeInt);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
});

test("an interruption recorded during spawn is forwarded after active-child assignment", async () => {
  const { createCommandRunner } = require(guardPath);
  const signalTarget = new EventEmitter();
  const runner = createCommandRunner({
    signalTarget,
    terminationGraceMs: 60,
    spawnImpl(command, args, options) {
      const child = spawn(command, args, options);
      signalTarget.emit("SIGINT");
      return child;
    },
  });
  const result = await runner.runCommand(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { cwd: packageRoot, capture: true, deadlineMs: 2000 },
  );
  await runner.dispose();

  assert.equal(result.interruptedSignal, "SIGINT");
  assert.equal(result.timedOut, false);
  assert.equal(result.signal, "SIGINT");
});

test("async runner captures requested streams and otherwise inherits stdio", async () => {
  const { createCommandRunner } = require(guardPath);
  const stdio = [];
  const runner = createCommandRunner({
    spawnImpl(command, args, options) {
      stdio.push(options.stdio);
      return spawn(command, args, options);
    },
  });
  const captured = await runner.runCommand(
    process.execPath,
    ["-e", "process.stdout.write('out');process.stderr.write('err')"],
    { cwd: packageRoot, capture: true, deadlineMs: 1000 },
  );
  const inherited = await runner.runCommand(
    process.execPath,
    ["-e", "process.exit(0)"],
    { cwd: packageRoot, capture: false, deadlineMs: 1000 },
  );
  await runner.dispose();

  assert.equal(captured.stdout, "out");
  assert.equal(captured.stderr, "err");
  assert.equal(inherited.stdout, "");
  assert.equal(inherited.stderr, "");
  assert.deepEqual(stdio, [["ignore", "pipe", "pipe"], "inherit"]);
});

test("child-only fallback completes bounded TERM-to-KILL cleanup and fails closed", async (t) => {
  const { createCommandRunner, requireCompleted } = require(guardPath);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-runner-child-only."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const readyFile = path.join(sandbox, "ready");
  let childPid = null;
  t.after(() => {
    if (childPid) forceKill(childPid);
  });
  const args = [
    "-e",
    `const fs=require("node:fs");process.on("SIGTERM",()=>{});`
      + `fs.writeFileSync(${JSON.stringify(readyFile)}, "ready");setInterval(()=>{},1000)`,
  ];
  const child = await spawnReady(process.execPath, args, {
    cwd: packageRoot,
    detached: false,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }, readyFile);
  childPid = child.pid;
  const runner = createCommandRunner({
    detached: false,
    terminationGraceMs: 60,
    spawnImpl() {
      return child;
    },
  });
  const result = await runner.runCommand(
    process.execPath,
    args,
    { cwd: packageRoot, capture: true, deadlineMs: 100 },
  );

  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(pidExists(childPid), false, "child remained when child-only runCommand resolved");
  assert.throws(() => requireCompleted(result, "child-only probe"), /deadline/i);
  await runner.dispose();
});

test("real SIGINT and SIGTERM kill descendants after leader exit and clean workspace", {
  skip: process.platform === "win32" ? "POSIX process-group probe" : false,
}, async (t) => {
  const { createCommandRunner } = require(guardPath);
  assert.equal(typeof createCommandRunner, "function");
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-runner-signal."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const fakeCommand = path.join(sandbox, "fake-command.js");
  const harness = path.join(sandbox, "harness.js");
  const spawnedPids = new Set();
  t.after(() => {
    for (const pid of spawnedPids) forceKill(pid);
  });

  fs.writeFileSync(fakeCommand, `
    const fs = require("node:fs");
    const path = require("node:path");
    const command = process.argv[2];
    const args = JSON.parse(process.argv[3]);
    const out = (value) => process.stdout.write(value);
    if (command === "git" && args[0] === "status") process.exit(0);
    if (command === "git" && args[0] === "branch") out("main\\n");
    if (command === "git" && args[0] === "rev-parse") out("${"a".repeat(40)}\\n");
    if (command === "git" && args[0] === "ls-remote") out("${"a".repeat(40)}\\trefs/heads/main\\n");
    if (command === "npm" && args[0] === "config") out("https://registry.npmjs.org/\\n");
    if (command === "npm" && args[0] === "whoami") out("maintainer\\n");
    if (command === "npm" && args[0] === "view") {
      out(JSON.stringify({ error: { code: "E404", summary: "absent", detail: "absent" } }));
      process.exit(1);
    }
    if (command === "npm" && args[0] === "pack") {
      const { spawn } = require("node:child_process");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
      fs.writeFileSync(process.env.ACTIVE_PID_FILE, process.pid + " " + descendant.pid);
      process.on("SIGINT", () => process.exit(0));
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);
    } else {
      process.exit(0);
    }
  `);

  fs.writeFileSync(harness, `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { spawn } = require("node:child_process");
    const { createCommandRunner, runPrepublishGuard } = require(${JSON.stringify(guardPath)});
    const fakeCommand = ${JSON.stringify(fakeCommand)};
    const packageRoot = ${JSON.stringify(packageRoot)};
    const workspaceFile = process.env.WORKSPACE_FILE;
    const runner = createCommandRunner({
      terminationGraceMs: 60,
      spawnImpl(command, args, options) {
        return spawn(process.execPath, [fakeCommand, command, JSON.stringify(args)], {
          ...options,
          env: { ...process.env },
        });
      },
    });
    (async () => {
      try {
        await runPrepublishGuard({
          packageRoot,
          commandRunner: runner,
          makeTempWorkspace() {
            const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-signal-workspace."));
            fs.writeFileSync(workspaceFile, workspace);
            return workspace;
          },
        });
        process.exitCode = 99;
      } catch (error) {
        process.stderr.write(String(error && error.stack || error) + "\\n");
        process.exitCode = error.exitCode || 1;
      } finally {
        await runner.dispose();
      }
    })();
  `);

  const fakeProbe = spawn(process.execPath, [fakeCommand, "git", JSON.stringify(["status", "--porcelain"])], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fakeProbeOutput = [];
  fakeProbe.stderr.on("data", (chunk) => fakeProbeOutput.push(Buffer.from(chunk)));
  assert.deepEqual(
    await waitForExit(fakeProbe),
    { code: 0, signal: null },
    Buffer.concat(fakeProbeOutput).toString("utf8"),
  );

  for (const [signal, expectedCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const workspaceFile = path.join(sandbox, `${signal}.workspace`);
    const activePidFile = path.join(sandbox, `${signal}.pid`);
    const child = spawn(process.execPath, [harness], {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ACTIVE_PID_FILE: activePidFile,
        WORKSPACE_FILE: workspaceFile,
      },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const exitPromise = waitForExit(child, 15_000);
    const workspace = await Promise.race([
      waitForFile(workspaceFile),
      exitPromise.then((exit) => {
        throw new Error(
          `harness exited before workspace: ${JSON.stringify(exit)}\n${Buffer.concat(stdout)}\n${Buffer.concat(stderr)}`,
        );
      }),
    ]);
    const activePids = (await waitForFile(activePidFile)).split(" ").map(Number);
    for (const pid of activePids) spawnedPids.add(pid);
    child.kill(signal);
    const exit = await exitPromise;
    assert.equal(exit.signal, null);
    assert.equal(exit.code, expectedCode);
    for (const pid of activePids) {
      assert.equal(pidExists(pid), false, `process ${pid} remained when the ${signal} harness resolved`);
    }
    for (const pid of activePids) await waitForPidGone(pid);
    assert.equal(fs.existsSync(workspace), false, `${signal} must remove the private workspace`);
  }
});

test("real timed-out and interrupted JSON results fail completion before parsing", async (t) => {
  const { parseScanReceipt, requireStructuredAbsence } = require(guardPath);
  const e404 = { error: { code: "E404", summary: "absent", detail: "absent" } };
  const receipt = {
    ok: true,
    hits: [],
    validatedArchive: {
      bytes: 10,
      sha256: "a".repeat(64),
      source: "descriptor-captured-private-snapshot",
    },
  };

  const timedOutE404 = await realJsonResult(t, e404, "timeout");
  assert.deepEqual(JSON.parse(timedOutE404.stdout), e404);
  assert.throws(() => requireStructuredAbsence(timedOutE404), /deadline/i);

  const interruptedE404 = await realJsonResult(t, e404, "SIGINT");
  assert.deepEqual(JSON.parse(interruptedE404.stdout), e404);
  assert.throws(
    () => requireStructuredAbsence(interruptedE404),
    (error) => error.exitCode === 130,
  );

  const timedOutReceipt = await realJsonResult(t, receipt, "timeout");
  assert.deepEqual(JSON.parse(timedOutReceipt.stdout), receipt);
  assert.throws(() => parseScanReceipt(timedOutReceipt), /deadline/i);

  const interruptedReceipt = await realJsonResult(t, receipt, "SIGTERM");
  assert.deepEqual(JSON.parse(interruptedReceipt.stdout), receipt);
  assert.throws(
    () => parseScanReceipt(interruptedReceipt),
    (error) => error.exitCode === 143,
  );
});

test("publish dry-run lifecycle sanitizes every guard child without mutating its parent env", async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-runner-dry-env."));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const fakeCommand = path.join(sandbox, "fake-command.js");
  const harness = path.join(sandbox, "harness.js");
  const envLog = path.join(sandbox, "child-env.jsonl");
  const workspaceFile = path.join(sandbox, "workspace");

  fs.writeFileSync(fakeCommand, `
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const command = process.argv[2];
    const args = JSON.parse(process.argv[3]);
    const dryRunKeys = Object.keys(process.env).filter((key) => key.toLowerCase() === "npm_config_dry_run");
    fs.appendFileSync(process.env.ENV_LOG, JSON.stringify({
      command,
      args,
      dryRunKeys,
      registry: process.env.npm_config_registry,
      otp: process.env.npm_config_otp,
      access: process.env.npm_config_access,
      token: process.env.NPM_TOKEN,
      normal: process.env.NORMAL_SENTINEL,
    }) + "\\n");
    const out = (value) => process.stdout.write(value);
    if (command === "git" && args[0] === "status") process.exit(0);
    if (command === "git" && args[0] === "branch") out("main\\n");
    if (command === "git" && args[0] === "rev-parse") out("${"a".repeat(40)}\\n");
    if (command === "git" && args[0] === "ls-remote") out("${"a".repeat(40)}\\trefs/heads/main\\n");
    if (command === "npm" && args[0] === "config") out("https://registry.npmjs.org/\\n");
    if (command === "npm" && args[0] === "whoami") out("maintainer\\n");
    if (command === "npm" && args[0] === "view") {
      out(JSON.stringify({ error: { code: "E404", summary: "absent", detail: "absent" } }));
      process.exit(1);
    }
    if (command === "npm" && args[0] === "test" && dryRunKeys.length) process.exit(7);
    if (command === "npm" && args[0] === "pack") {
      const destination = args[args.indexOf("--pack-destination") + 1];
      const filename = "lithermes-ai-0.8.39.tgz";
      if (!dryRunKeys.length) fs.writeFileSync(path.join(destination, filename), "archive");
      out(JSON.stringify([{ filename }]));
      process.exit(0);
    }
    if (command === process.execPath && args.includes("--pack-tar")) {
      const snapshot = args[args.indexOf("--snapshot-out") + 1];
      const bytes = Buffer.from("validated-snapshot");
      fs.writeFileSync(snapshot, bytes);
      out(JSON.stringify({
        ok: true,
        hits: [],
        validatedArchive: {
          bytes: bytes.length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          source: "descriptor-captured-private-snapshot",
        },
      }));
      process.exit(0);
    }
    process.exit(0);
  `);

  fs.writeFileSync(harness, `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { spawn } = require("node:child_process");
    const { createCommandRunner, runPrepublishGuard } = require(${JSON.stringify(guardPath)});
    const runner = createCommandRunner({
      spawnImpl(command, args, options) {
        return spawn(process.execPath, [${JSON.stringify(fakeCommand)}, command, JSON.stringify(args)], options);
      },
    });
    let workspace = null;
    (async () => {
      try {
        const receipt = await runPrepublishGuard({
          packageRoot: ${JSON.stringify(packageRoot)},
          commandRunner: runner,
          makeTempWorkspace() {
            workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-dry-env-workspace."));
            fs.writeFileSync(${JSON.stringify(workspaceFile)}, workspace);
            return workspace;
          },
        });
        process.stdout.write(JSON.stringify({
          receipt,
          parentLower: process.env.npm_config_dry_run,
          parentUpper: process.env.NPM_CONFIG_DRY_RUN,
          workspaceExists: fs.existsSync(workspace),
        }));
      } catch (error) {
        process.stderr.write(String(error && error.stack || error));
        process.exitCode = 1;
      } finally {
        await runner.dispose();
      }
    })();
  `);

  const child = spawn(process.execPath, [harness], {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      npm_config_dry_run: "true",
      NPM_CONFIG_DRY_RUN: "true",
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_otp: "123456",
      npm_config_access: "public",
      NPM_TOKEN: "test-token",
      NORMAL_SENTINEL: "preserved",
      ENV_LOG: envLog,
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const exit = await waitForExit(child, 15_000);
  assert.deepEqual(exit, { code: 0, signal: null }, Buffer.concat(stderr).toString("utf8"));

  const result = JSON.parse(Buffer.concat(stdout).toString("utf8"));
  assert.equal(result.receipt.ok, true);
  assert.equal(result.parentLower, "true");
  assert.equal(result.parentUpper, "true");
  assert.equal(result.workspaceExists, false);
  const observations = fs.readFileSync(envLog, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(observations.length > 20, "the full guard command sequence must be observed");
  for (const observation of observations) {
    assert.deepEqual(observation.dryRunKeys, []);
    assert.equal(observation.registry, "https://registry.npmjs.org/");
    assert.equal(observation.otp, "123456");
    assert.equal(observation.access, "public");
    assert.equal(observation.token, "test-token");
    assert.equal(observation.normal, "preserved");
  }
  const workspace = fs.readFileSync(workspaceFile, "utf8");
  assert.equal(fs.existsSync(workspace), false);
});
