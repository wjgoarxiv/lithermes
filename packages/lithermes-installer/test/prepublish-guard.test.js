const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const guardPath = path.join(packageRoot, "scripts", "prepublish-guard.js");
const registry = "https://registry.npmjs.org/";
const sha = "a".repeat(40);
// Derive the stubbed pack artifact name from the real version so it cannot go stale.
const packageVersion = require("../package.json").version;

function loadGuard() {
  return require(guardPath);
}

function commandText(call) {
  return [call.command, ...call.args].join(" ");
}

function createHarness(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-prepublish-test."));
  const calls = [];
  const workspaces = [];
  let runCount = 0;
  let gateStarted = false;
  let versionLookups = 0;
  let finalNetworkComplete = false;

  function result(status = 0, stdout = "", stderr = "") {
    return { status, stdout, stderr, signal: null };
  }

  async function runCommand(command, args, options) {
    const call = { command, args: [...args], options: { ...options } };
    calls.push(call);
    const text = commandText(call);
    const overridden = await overrides.command?.(text, call, { result, calls, workspaces });
    if (overridden !== undefined) return overridden;

    const finalInvalid = gateStarted ? overrides.finalInvalid : null;
    if (text === "git status --porcelain") {
      const dirty = finalInvalid === "tree" || (finalNetworkComplete && overrides.lateInvalid === "tree");
      return result(0, dirty ? " M package.json\n" : overrides.dirty || "");
    }
    if (text === "git branch --show-current") {
      const branch = finalInvalid === "branch" || (finalNetworkComplete && overrides.lateInvalid === "branch")
        ? "release"
        : overrides.branch || "main";
      return result(0, `${branch}\n`);
    }
    if (text === "git rev-parse --verify HEAD") {
      const head = finalInvalid === "head" || (finalNetworkComplete && overrides.lateInvalid === "head")
        ? "b".repeat(40)
        : overrides.head || sha;
      return result(0, `${head}\n`);
    }
    if (text === "git ls-remote --exit-code origin refs/heads/main") {
      const remoteHead = finalInvalid === "remote" ? "b".repeat(40) : overrides.originHead || sha;
      return result(0, `${remoteHead}\trefs/heads/main\n`);
    }
    if (text === "npm config get registry") {
      const configured = finalInvalid === "registry"
        ? "https://registry.example.invalid/"
        : overrides.registry || registry;
      return result(0, `${configured}\n`);
    }
    if (text.startsWith("npm whoami ")) {
      return overrides.authFailure || finalInvalid === "auth"
        ? result(1, "", "not authenticated")
        : result(0, "maintainer\n");
    }
    if (text.startsWith("npm view ")) {
      versionLookups += 1;
      if (versionLookups === 2) finalNetworkComplete = true;
      if (overrides.versionExists) return result(0, '"0.8.40"\n');
      if (overrides.absence) return overrides.absence(result);
      if (finalInvalid === "version") return result(0, '"0.8.40"\n');
      if (finalInvalid === "mixed-absence") {
        return result(1, JSON.stringify({
          error: { code: "E404", summary: "E401 mixed", detail: "absent" },
        }));
      }
      return result(1, `${JSON.stringify({
        error: {
          code: "E404",
          summary: "No match found for version 0.8.40",
          detail: "The requested package version is absent",
        },
      })}\n`);
    }
    if (text.includes("scan-forbidden-tokens.js --pack-tar")) {
      const snapshot = args[args.indexOf("--snapshot-out") + 1];
      const bytes = Buffer.from(overrides.snapshotBytes || "packed-release-candidate");
      fs.writeFileSync(snapshot, bytes, { mode: 0o600 });
      const digest = overrides.reportedDigest
        || crypto.createHash("sha256").update(bytes).digest("hex");
      const receipt = overrides.scannerReceipt || {
        ok: true,
        hits: [],
        validatedArchive: {
          bytes: bytes.length,
          sha256: digest,
          source: "descriptor-captured-private-snapshot",
        },
      };
      return result(overrides.scannerStatus ?? 0, `${JSON.stringify(receipt)}\n`);
    }
    if (text.startsWith("npm pack ")) {
      if (overrides.interruptPack) throw new Error("interrupted");
      const destination = args[args.indexOf("--pack-destination") + 1];
      const filename = `litfamily-lithermes-${packageVersion}-${runCount}.tgz`;
      fs.writeFileSync(path.join(destination, filename), "packed-release-candidate");
      return result(0, `${JSON.stringify([{ filename }])}\n`);
    }
    if (text === "npm test") gateStarted = true;
    return result();
  }

  const dependencies = {
    packageRoot,
    runCommand,
    makeTempWorkspace() {
      runCount += 1;
      const workspace = fs.mkdtempSync(path.join(root, "run."));
      workspaces.push(workspace);
      return workspace;
    },
    removeTempWorkspace(workspace) {
      fs.rmSync(workspace, { recursive: true, force: true });
    },
  };

  return {
    calls,
    dependencies,
    root,
    workspaces,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function runWithHarness(t, overrides = {}) {
  const harness = createHarness(overrides);
  t.after(() => harness.cleanup());
  const receipt = await loadGuard().runPrepublishGuard(harness.dependencies);
  return { ...harness, receipt };
}

test("guard fails immediately on a dirty worktree", async (t) => {
  const harness = createHarness({ dirty: " M package.json\n" });
  t.after(() => harness.cleanup());
  await assert.rejects(
    async () => loadGuard().runPrepublishGuard(harness.dependencies),
    /worktree.*clean/i,
  );
  assert.deepEqual(harness.calls.map(commandText), ["git status --porcelain"]);
});

test("guard rejects a non-main branch and a stale origin/main", async (t) => {
  for (const [overrides, message] of [
    [{ branch: "release" }, /main branch/i],
    [{ originHead: "b".repeat(40) }, /origin\/main/i],
  ]) {
    const harness = createHarness(overrides);
    t.after(() => harness.cleanup());
    await assert.rejects(async () => loadGuard().runPrepublishGuard(harness.dependencies), message);
  }
});

test("guard requires the exact public registry and pins registry network calls", async (t) => {
  const wrong = createHarness({ registry: "https://registry.example.invalid/" });
  t.after(() => wrong.cleanup());
  await assert.rejects(async () => loadGuard().runPrepublishGuard(wrong.dependencies), /registry/i);

  const good = await runWithHarness(t);
  const registryCalls = good.calls.filter((call) => ["whoami", "view"].includes(call.args[0]));
  assert.equal(registryCalls.length, 4);
  for (const call of registryCalls) assert.ok(call.args.includes(`--registry=${registry}`));
});

test("guard fails closed on authentication failure or an existing target version", async (t) => {
  for (const [overrides, message] of [
    [{ authFailure: true }, /authentication/i],
    [{ versionExists: true }, /already exists/i],
  ]) {
    const harness = createHarness(overrides);
    t.after(() => harness.cleanup());
    await assert.rejects(async () => loadGuard().runPrepublishGuard(harness.dependencies), message);
  }
});

test("only one structured E404 response proves target-version absence", async (t) => {
  const cases = [
    (result) => result(1, "not found\n"),
    (result) => result(1, "{malformed\n"),
    (result) => result(1, JSON.stringify({ error: { code: "E404", summary: "E401 mixed", detail: "absent" } })),
    (result) => result(1, JSON.stringify({ error: { code: "E401", summary: "unauthorized", detail: "no access" } })),
    (result) => result(1, JSON.stringify({ error: { code: "E404", summary: "absent", detail: "absent" } }), "extra"),
  ];
  for (const absence of cases) {
    const harness = createHarness({ absence });
    t.after(() => harness.cleanup());
    await assert.rejects(
      async () => loadGuard().runPrepublishGuard(harness.dependencies),
      /structured E404/i,
    );
  }
});

test("completion failures outrank valid-looking E404 and scanner JSON", () => {
  const { parseScanReceipt, requireStructuredAbsence } = loadGuard();
  const e404 = JSON.stringify({ error: { code: "E404", summary: "absent", detail: "absent" } });
  const receipt = JSON.stringify({
    ok: true,
    hits: [],
    validatedArchive: {
      bytes: 10,
      sha256: "a".repeat(64),
      source: "descriptor-captured-private-snapshot",
    },
  });

  for (const [fields, expectedExitCode] of [
    [{ timedOut: true }, null],
    [{ interruptedSignal: "SIGINT" }, 130],
    [{ interruptedSignal: "SIGTERM" }, 143],
    [{ error: new Error("spawn failed") }, null],
    [{ signal: "SIGKILL" }, null],
  ]) {
    const absenceResult = { status: 1, signal: null, stdout: e404, stderr: "", ...fields };
    assert.throws(
      () => requireStructuredAbsence(absenceResult),
      (error) => expectedExitCode === null ? /complete|deadline/i.test(error.message) : error.exitCode === expectedExitCode,
    );

    const scannerResult = { status: 0, signal: null, stdout: receipt, stderr: "", ...fields };
    assert.throws(
      () => parseScanReceipt(scannerResult),
      (error) => expectedExitCode === null ? /complete|deadline/i.test(error.message) : error.exitCode === expectedExitCode,
    );
  }
});

test("guard runs every required gate and artifact step serially without publication", async (t) => {
  let privateWorkspaceExistsAtCleanup = false;
  const harness = await runWithHarness(t, {
    command(text, _call, context) {
      if (text === "npm run clean:payload") {
        privateWorkspaceExistsAtCleanup = context.workspaces.length === 1
          && fs.existsSync(context.workspaces[0]);
      }
    },
  });
  const commands = harness.calls.map(commandText);
  const ordered = [
    "git status --porcelain",
    "git branch --show-current",
    "git rev-parse --verify HEAD",
    "git ls-remote --exit-code origin refs/heads/main",
    "npm config get registry",
    "npm whoami --registry=https://registry.npmjs.org/",
    "npm view @litfamily\/lithermes@1.0.15 version --json --loglevel=silent --registry=https://registry.npmjs.org/",
    "npm test",
    "npm run test:python",
  ];
  assert.deepEqual(commands.slice(0, ordered.length), ordered);
  assert.match(commands[9], /scan-forbidden-tokens\.js --tracked$/);
  assert.match(commands[10], /scan-forbidden-tokens\.js --package-root$/);
  assert.equal(commands[11], "npm run qa:real-surface");
  assert.equal(commands[12], "npm run clean:payload");
  assert.match(commands[13], /^npm pack --ignore-scripts --json --pack-destination /);
  assert.match(commands[14], /scan-forbidden-tokens\.js --pack-tar .* --snapshot-out .* --json$/);
  assert.deepEqual(commands.slice(15), [...ordered.slice(0, 7), ...ordered.slice(0, 3)]);
  assert.equal(commands.filter((command) => command.startsWith("npm whoami ")).length, 2);
  assert.equal(commands.filter((command) => command.startsWith("npm view ")).length, 2);
  assert.equal(commands.some((command) => /\bnpm\s+publish\b/.test(command)), false);
  assert.ok(harness.calls.every((call) => Number.isSafeInteger(call.options.deadlineMs)));
  assert.ok(harness.calls[7].options.deadlineMs > harness.calls[0].options.deadlineMs);
  assert.equal(privateWorkspaceExistsAtCleanup, true);
  assert.equal(harness.receipt.ok, true);
  assert.match(harness.receipt.sha256, /^[a-f0-9]{64}$/);
});

test("final authoritative guards catch state invalidated during a long-running gate", async (t) => {
  for (const [finalInvalid, message] of [
    ["tree", /worktree.*clean/i],
    ["branch", /main branch/i],
    ["head", /live origin\/main/i],
    ["remote", /live origin\/main/i],
    ["registry", /registry/i],
    ["auth", /authentication/i],
    ["version", /already exists/i],
    ["mixed-absence", /structured E404/i],
  ]) {
    const harness = createHarness({ finalInvalid });
    t.after(() => harness.cleanup());
    await assert.rejects(async () => loadGuard().runPrepublishGuard(harness.dependencies), message);
    const commands = harness.calls.map(commandText);
    const scanAt = commands.findIndex((command) => command.includes(" --pack-tar "));
    const finalStatusAt = commands.lastIndexOf("git status --porcelain");
    assert.ok(scanAt >= 0 && finalStatusAt > scanAt, `${finalInvalid} must be checked after artifact scan`);
    assert.ok(harness.workspaces.every((workspace) => !fs.existsSync(workspace)));
  }
});

test("last local snapshot rejects state changed after the final network checks", async (t) => {
  for (const [lateInvalid, message] of [
    ["tree", /worktree.*clean/i],
    ["branch", /main branch/i],
    ["head", /local HEAD changed/i],
  ]) {
    const harness = createHarness({ lateInvalid });
    t.after(() => harness.cleanup());
    await assert.rejects(async () => loadGuard().runPrepublishGuard(harness.dependencies), message);
    const commands = harness.calls.map(commandText);
    const finalViewAt = commands.lastIndexOf(
    "npm view @litfamily\/lithermes@1.0.15 version --json --loglevel=silent --registry=https://registry.npmjs.org/",
    );
    assert.ok(finalViewAt >= 0);
    assert.deepEqual(commands.slice(finalViewAt + 1, finalViewAt + 4), [
      "git status --porcelain",
      ...(lateInvalid === "tree" ? [] : ["git branch --show-current"]),
      ...(lateInvalid === "head" ? ["git rev-parse --verify HEAD"] : []),
    ]);
    assert.ok(harness.workspaces.every((workspace) => !fs.existsSync(workspace)));
  }
});

test("final auth and target-version checks stay registry-pinned and strict", async (t) => {
  const harness = await runWithHarness(t);
  const commands = harness.calls.map(commandText);
  const scanAt = commands.findIndex((command) => command.includes(" --pack-tar "));
  const finalNetworkChecks = harness.calls.slice(scanAt + 1).filter(
    (call) => call.command === "npm" && ["whoami", "view"].includes(call.args[0]),
  );
  assert.deepEqual(finalNetworkChecks.map((call) => call.args[0]), ["whoami", "view"]);
  for (const call of finalNetworkChecks) assert.ok(call.args.includes(`--registry=${registry}`));
  const finalView = finalNetworkChecks.find((call) => call.args[0] === "view");
  assert.ok(finalView.args.includes("--json"));
  assert.ok(finalView.args.includes("--loglevel=silent"));
  const finalViewAt = commands.lastIndexOf(commandText(finalView));
  assert.deepEqual(commands.slice(finalViewAt + 1), [
    "git status --porcelain",
    "git branch --show-current",
    "git rev-parse --verify HEAD",
  ]);
  assert.equal(harness.receipt.ok, true);
});

test("scanner failures and snapshot digest mismatches fail closed", async (t) => {
  for (const [overrides, message] of [
    [{ scannerStatus: 1, scannerReceipt: { ok: false, hits: [{ path: "x", where: "hit" }] } }, /scanner/i],
    [{ reportedDigest: "0".repeat(64) }, /digest/i],
  ]) {
    const harness = createHarness(overrides);
    t.after(() => harness.cleanup());
    await assert.rejects(async () => loadGuard().runPrepublishGuard(harness.dependencies), message);
    assert.ok(harness.workspaces.every((workspace) => !fs.existsSync(workspace)));
  }
});

test("interruption and repeated runs remove every private workspace", async (t) => {
  const interrupted = createHarness({ interruptPack: true });
  t.after(() => interrupted.cleanup());
  await assert.rejects(async () => loadGuard().runPrepublishGuard(interrupted.dependencies), /interrupted/);
  assert.ok(interrupted.workspaces.every((workspace) => !fs.existsSync(workspace)));

  const repeated = createHarness();
  t.after(() => repeated.cleanup());
  await loadGuard().runPrepublishGuard(repeated.dependencies);
  await loadGuard().runPrepublishGuard(repeated.dependencies);
  assert.equal(repeated.workspaces.length, 2);
  assert.notEqual(repeated.workspaces[0], repeated.workspaces[1]);
  assert.ok(repeated.workspaces.every((workspace) => !fs.existsSync(workspace)));
});
