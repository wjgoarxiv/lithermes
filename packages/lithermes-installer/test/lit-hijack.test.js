const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const CLI = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-hijack", "scripts", "hijack.mjs");
const SKILL = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-hijack");
const PYTHON = path.join(__dirname, "..", "assets", "lithermes-plugin");

function runCLI(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

function readLedger(run) {
  return JSON.parse(fs.readFileSync(path.join(run, "ledger.json"), "utf8"));
}

function writeLedger(run, mutate) {
  const file = path.join(run, "ledger.json");
  const ledger = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(ledger);
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function writeRun(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-hijack-"));
  const article = path.join(root, "article.md");
  fs.writeFileSync(article, "# Retry budgets\n\nA bounded retry helper with jitter and a deadline.\n");
  const target = path.join(root, "target");
  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.writeFileSync(path.join(target, "src", "helper.js"), "export function retry() {}\n");
  const run = path.join(root, "run");
  const init = runCLI("init", run, "--target", target, ...(overrides.initArgs || []));
  assert.equal(init.status, 0, init.stderr);
  const capture = runCLI("capture", run, article, "--kind", "file", "--licence", "MIT");
  assert.equal(capture.status, 0, capture.stderr);
  (overrides.files || {}).SPEC &&
    fs.writeFileSync(path.join(run, "SPEC.md"), overrides.files.SPEC);
  (overrides.files || {}).REPORT &&
    fs.writeFileSync(path.join(run, "REPORT.md"), overrides.files.REPORT);
  for (const [name, body] of Object.entries((overrides.files || {}).parity || {}))
    fs.writeFileSync(path.join(run, "parity", name), body);
  if (overrides.ledger) writeLedger(run, overrides.ledger);
  return { root, run, target, article };
}

test("init pins the base revision and refuses a missing target or an existing run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-hijack-"));
  const target = path.join(root, "target");
  fs.mkdirSync(target, { recursive: true });
  execFileSync("git", ["init", "-q", target]);
  execFileSync("git", ["-C", target, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", target, "config", "user.name", "test"]);
  fs.writeFileSync(path.join(target, "notes.md"), "base\n");
  execFileSync("git", ["-C", target, "add", "."]);
  execFileSync("git", ["-C", target, "commit", "-qm", "base"]);
  const head = execFileSync("git", ["-C", target, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const run = path.join(root, "run");
  assert.equal(runCLI("init", run, "--target", target).status, 0);
  assert.equal(readLedger(run).target.base_ref, head);
  assert.equal(runCLI("init", path.join(root, "run2"), "--target", path.join(root, "missing")).status, 1);
  assert.equal(runCLI("init", run, "--target", target).status, 1);
});

test("capture refuses a PDF whose bytes are not a PDF", () => {
  const { run, root } = writeRun();
  const fake = path.join(root, "fake.pdf");
  fs.writeFileSync(fake, "not a pdf\n");
  const out = runCLI("capture", run, fake);
  assert.equal(out.status, 1);
  assert.match(out.stdout + out.stderr, /not a PDF/i);
});

test("capture stores exact bytes and text with provenance", () => {
  const { run, article } = writeRun();
  const out = runCLI("capture", run, article, "--kind", "file", "--licence", "MIT", "--author", "A. Writer", "--date", "2026-10-26");
  assert.equal(out.status, 0, out.stderr);
  const sources = fs.readdirSync(path.join(run, "sources"));
  assert.ok(sources.length >= 2);
  const latest = path.join(run, "sources", `S${sources.length}`, "content.md");
  assert.equal(fs.readFileSync(latest, "utf8"), fs.readFileSync(article, "utf8"));
  const ledger = readLedger(run);
  const last = ledger.sources[ledger.sources.length - 1];
  assert.equal(last.kind, "file");
  assert.equal(last.author, "A. Writer");
});

test("every phase gate has a RED fixture", async (t) => {
  const hijack = await import(CLI);
  const phases = ["frame", "capture", "licence", "distil", "gap", "spec", "build", "parity", "report"];
  assert.deepEqual([...hijack.PHASES], phases);
  for (const phase of phases) {
    await t.test(`check --phase ${phase} fails on the empty run`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-hijack-red-"));
      const target = path.join(root, "target");
      fs.mkdirSync(target, { recursive: true });
      const run = path.join(root, "run");
      assert.equal(runCLI("init", run, "--target", target).status, 0);
      if (phase === "frame") writeLedger(run, (ledger) => { delete ledger.targetRoot; });
      const out = runCLI("check", run, "--phase", phase);
      assert.equal(out.status, 1, `${phase} must fail on the empty run`);
      assert.match(out.stdout, new RegExp(`FAIL check through ${phase}`, "i"));
    });
  }
});

test("check refuses an unknown phase", () => {
  const { run } = writeRun();
  const out = runCLI("check", run, "--phase", "publish");
  assert.equal(out.status, 1);
  assert.match(out.stdout + out.stderr, /unknown phase/i);
});

test("licence prints the decision table row per row", () => {
  const { run } = writeRun();
  const out = runCLI("licence", run);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /S1 MIT -> ideas-credit \(rule\)/);
  const overridden = runCLI("licence", run, "--set", "S1=ideas-only", "--reason", "test");
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.match(overridden.stdout, /S1 MIT -> ideas-only \(user\)/);
});

test("licence refuses an unknown decision and ignores an unknown source", () => {
  const { run } = writeRun();
  const bad = runCLI("licence", run, "--set", "S1=take-everything");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /must be one of/);
  const ignored = runCLI("licence", run, "--set", "S9=ideas-only");
  assert.equal(ignored.status, 0);
  const after = readLedger(run);
  assert.equal(after.sources.length, 1);
  assert.equal(after.sources[0].licence.decided_by, "rule");
});

test("overlap runs Hangul word shingles across the target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-hijack-overlap-"));
  const planted = "한글 토큰 겹침 확인을 위한 문장입니다 추가 단어가 열두 개를 충분히 채웁니다\n";
  fs.writeFileSync(path.join(dir, "article.md"), `# 제목\n\n${planted}`);
  fs.mkdirSync(path.join(dir, "target", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "target", "src", "note.md"), `# 메모\n\n${planted}`);
  const run = path.join(dir, "run");
  assert.equal(runCLI("init", run, "--target", path.join(dir, "target")).status, 0);
  assert.equal(runCLI("capture", run, path.join(dir, "article.md"), "--kind", "file").status, 0);
  const out = runCLI("overlap", run, path.join(dir, "target", "src", "note.md"));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /FAIL overlap/);
  assert.match(out.stdout, /한글 토큰 겹침/);
});

test("overlap with no listed files and no spec passes vacuously", () => {
  const { run } = writeRun();
  const out = runCLI("overlap", run);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /PASS overlap \(0 file/);
});

test("brief refuses to print while the spec gate fails and prints from the spec alone", async () => {
  const hijack = await import(CLI);
  const { run, target } = writeRun({ files: { SPEC: "# Draft\n\n## M1\n\nBehaviour.\n" } });
  execFileSync("git", ["init", "-q", target]);
  execFileSync("git", ["-C", target, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", target, "config", "user.name", "test"]);
  execFileSync("git", ["-C", target, "add", "."]);
  execFileSync("git", ["-C", target, "commit", "-qm", "base"]);
  const head = execFileSync("git", ["-C", target, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeLedger(run, (ledger) => {
    ledger.target.base_ref = head;
    ledger.mechanisms = [{ id: "M1", title: "t", sources: ["S1"], locator: "p1", what: "w", why: "y", evidence: "evidenced", evidenceNote: "n", parity: "route X", gap: { status: "lacks", refs: ["src/helper.js:1"] }, port: { decision: "take", reason: "r" } }];
    ledger.sources[0].licence = { spdx: "MIT", decision: "ideas-only", reason: "test" };
    ledger.parity = { markers: ["route X"], blocked: false, rounds: [] };
  });
  assert.equal(hijack.checkRun(run, { phase: "spec" }).ok, true);
  const out = runCLI("brief", run);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /TASK:/);
  assert.match(out.stdout, /DELIVERABLE/);
  assert.match(out.stdout, /SCOPE/);
  assert.match(out.stdout, /VERIFY/);
  assert.match(out.stdout, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out.stdout, /article\.md|sources\//);

  const bad = writeRun();
  assert.equal(runCLI("brief", bad.run).status, 2);
});

test("the packaged skill names its references and its script, with no orphans", () => {
  const body = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  assert.match(body, /lithermes:lit-hijack/);
  assert.match(body, /hijack\.mjs (init|capture|check)/);
  assert.match(body, /litresearch/);
  assert.match(body, /lit-plan/);
  assert.match(body, /start-work/);
  assert.match(body, /review-work/);
  for (const name of fs.readdirSync(path.join(SKILL, "references"))) {
    assert.ok(body.includes(`references/${name}`), `SKILL.md must route ${name}`);
  }
  for (const name of fs.readdirSync(path.join(SKILL, "scripts"))) {
    assert.ok(body.includes(`scripts/${name}`), `SKILL.md must name ${name}`);
  }
  const referenced = new Set(
    [...body.matchAll(/references\/([A-Za-z0-9_.-]+\.md)/g)].map((m) => m[1])
  );
  for (const name of referenced) {
    assert.ok(fs.existsSync(path.join(SKILL, "references", name)), `orphan reference ${name}`);
  }
  assert.ok(fs.existsSync(path.join(SKILL, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(SKILL, "scripts", "hijack.mjs")));
});

test("the skill entry carries the contract headings, the route words and the run folder", () => {
  const body = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  for (const heading of [
    "## #contract.activation",
    "## #contract.inputs",
    "## #contract.mode_matrix",
    "## #contract.procedure",
    "## #contract.outputs",
    "## #contract.output_channels",
    "## #contract.evidence",
    "## #contract.hard_stops",
    "## #contract.anti_patterns",
  ]) assert.ok(body.includes(heading), `missing ${heading}`);
  for (const token of [
    "lit-hijack",
    "lit hijack",
    "hijacking",
    "하이재킹",
    "하이잭",
    "delegate_task",
    ".hermes/lithermes/runs/hijack-",
    "fxtwitter",
    "SPEC.md",
    "REPORT.md",
  ]) assert.ok(body.includes(token), `missing ${token}`);
  assert.ok(!body.includes(".litmuse/hijack"), "must not point at the source host run folder");
});

test("python route coverage names every hijack word", () => {
  const body = fs.readFileSync(
    path.join(__dirname, "python", "test_lit_hijack.py"), "utf8"
  );
  for (const token of ["lit-hijack", "lit hijack", "hijacking", "하이재킹", "하이잭"])
    assert.ok(body.includes(token), `route test must cover ${token}`);
});

test("neighbour skills point at the hijack handoff", () => {
  const root = path.join(PYTHON);
  const research = fs.readFileSync(path.join(root, "skills", "litresearch", "SKILL.md"), "utf8");
  assert.match(research, /lit-hijack/);
  const plan = fs.readFileSync(path.join(root, "skills", "lit-plan", "SKILL.md"), "utf8");
  assert.match(plan, /lit-hijack/);
  const start = fs.readFileSync(path.join(root, "skills", "start-work", "SKILL.md"), "utf8");
  assert.match(start, /lit-hijack/);
});

test("fetchBytes refuses loopback, caps streams and never follows blindly", async (t) => {
  const { fetchBytes, isPublicUnicastIp } = await import(CLI);
  await t.test("private and loopback addresses are not public", () => {
    assert.equal(isPublicUnicastIp("127.0.0.1", 4), false);
    assert.equal(isPublicUnicastIp("10.1.2.3", 4), false);
    assert.equal(isPublicUnicastIp("172.16.0.1", 4), false);
    assert.equal(isPublicUnicastIp("192.168.1.1", 4), false);
    assert.equal(isPublicUnicastIp("169.254.9.9", 4), false);
    assert.equal(isPublicUnicastIp("::1", 6), false);
    assert.equal(isPublicUnicastIp("8.8.8.8", 4), true);
  });
  await t.test("a redirect to loopback is refused without following", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/start")) {
        return { status: 302, ok: false, headers: new Map([["location", "http://127.0.0.1/evil"]]), body: null };
      }
      return { status: 200, ok: true, headers: new Map(), body: null };
    };
    const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    await assert.rejects(fetchBytes("http://example.com/start", { fetchImpl, lookupImpl }), /loopback|public/i);
    assert.equal(calls.length, 1);
  });
  await t.test("a hostname that resolves to loopback is refused before connecting", async () => {
    let connected = false;
    const fetchImpl = async () => { connected = true; throw new Error("must not connect"); };
    const lookupImpl = async () => [{ address: "127.0.0.1", family: 4 }];
    await assert.rejects(fetchBytes("http://internal.example/", { fetchImpl, lookupImpl }), /loopback|public/i);
    assert.equal(connected, false);
  });
  await t.test("an oversize stream aborts instead of buffering whole", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let chunks = 0;
    const reader = { read: async () => (++chunks <= 400 ? { done: false, value: chunk } : { done: true, value: undefined }), cancel: async () => {} };
    const fetchImpl = async () => ({ status: 200, ok: true, headers: new Map(), body: { getReader: () => reader } });
    const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    await assert.rejects(fetchBytes("http://example.com/big", { fetchImpl, lookupImpl }), /larger|exceed/i);
    assert.ok(chunks * chunk.length < 22 * 1024 * 1024, `read ${chunks * chunk.length} bytes before aborting`);
  });
});

test("fetchBytes connects to the address the hop check approved, even if the name rebinds", async () => {
  const { fetchBytes } = await import(CLI);
  const { Readable } = require("node:stream");
  const exterior = "203.0.113.9"; // TEST-NET-3: public, never a real host
  let resolutions = 0;
  const lookupImpl = async () => {
    resolutions += 1;
    // A rebinding name answers public once, then loopback: the socket must
    // still go to the first, approved answer, with no second resolution.
    return [{ address: resolutions === 1 ? exterior : "127.0.0.1", family: 4 }];
  };
  let connectedTo = null;
  const requestImpls = {
    "http:": (href, { lookup }, onResponse) => {
      lookup("rebind.example", {}, (error, address, family) => {
        assert.ifError(error);
        connectedTo = `${address}#${family}`;
      });
      const req = {
        on: () => req,
        end: () => {
          const body = Readable.from([Buffer.from("ok")]);
          body.statusCode = 200;
          body.headers = {};
          onResponse(body);
        },
      };
      return req;
    },
  };
  const out = await fetchBytes("http://rebind.example/page", { requestImpls, lookupImpl });
  assert.equal(out.buffer.toString(), "ok");
  assert.equal(connectedTo, `${exterior}#4`);
  assert.equal(resolutions, 1);
});

test("capture refuses a tree path that escapes the repository", () => {
  const { run } = writeRun();
  const out = runCLI("capture", run, "https://github.com/example/repo/tree/main/../../etc");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /outside the repository/i);
});
