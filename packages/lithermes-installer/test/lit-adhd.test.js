const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const SKILL = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-adhd");
const CLI = path.join(SKILL, "scripts", "adhd.mjs");

function runCLI(args, options) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
}

function fixtureWs() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-adhd-")));
  fs.mkdirSync(path.join(root, "plans"), { recursive: true });
  fs.writeFileSync(path.join(root, "plans", "a.md"), "# A\n\n- [ ] 1. Do the one thing\n- [ ] 2. Do the other thing\n");
  return root;
}

function baseEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.HERDR_ENV;
  return env;
}

function hasSqlite3() {
  try {
    return spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

function writeFixtureDb(dbPath, ws) {
  const now = Math.floor(Date.now() / 1000);
  const secret = "s3cr3t-collector-value-99";
  const sql = [
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, last_activity_at REAL, cwd TEXT, git_branch TEXT, git_repo_root TEXT, message_count INTEGER, tool_call_count INTEGER, tool_names TEXT, title TEXT, display_name TEXT, archived INTEGER, hidden INTEGER);",
    "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, active INTEGER);",
    `INSERT INTO sessions VALUES ('sess-active-1', ${now - 3600}, NULL, ${now - 60}, '${ws}', 'port/1038', '', 4, 2, '["edit_file"]', '', 'Bridge the collector', 0, 0);`,
    `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-active-1', 'user', 'please bridge the collector next, api_token=${secret}', ${now - 300}, 1);`,
    `INSERT INTO messages (session_id, role, content, tool_name, timestamp, active) VALUES ('sess-active-1', 'tool', 'wrote the file', 'edit_file', ${now - 120}, 1);`,
    `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-active-1', 'assistant', 'on it', ${now - 60}, 1);`,
    `INSERT INTO sessions VALUES ('sess-old-1', ${now - 86400 * 9}, ${now - 86400 * 8}, ${now - 86400 * 8}, '${ws}', '', '', 1, 0, '[]', '', 'Old thread', 0, 0);`,
    `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-old-1', 'user', 'old ask', ${now - 86400 * 8}, 1);`,
  ].join("\n");
  const r = spawnSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return secret;
}

test("the collector briefs plans with no store and exits 64 on a bogus flag", () => {
  const ws = fixtureWs();
  try {
    const env = baseEnv({ HERMES_SESSION_STORE: path.join(ws, "no-store.db") });
    const brief = runCLI(["--json", "--here"], { cwd: ws, env });
    assert.equal(brief.status, 0, brief.stderr);
    const data = JSON.parse(brief.stdout);
    assert.equal(data.sources.sessions, "unknown");
    assert.equal(data.sources.plans, "ok");
    assert.equal(data.roadmap.plans[0].plan, "plans/a.md");
    assert.equal(data.roadmap.plans[0].progress.gauge, "[░░] 0/2");
    assert.equal(data.next.kind, "start-plan");
    assert.equal(data.next.command, "/start-work plans/a.md");
    const bad = runCLI(["--bogus"], { cwd: ws, env });
    assert.equal(bad.status, 64);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("sessions, gauges and redaction come from the Hermes store", { skip: !hasSqlite3() }, () => {
  const ws = fixtureWs();
  try {
    const db = path.join(ws, "state.db");
    const secret = writeFixtureDb(db, ws);
    const workDir = path.join(ws, ".hermes", "lithermes", "work", "work-1");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "state.json"), JSON.stringify({
      work_id: "work-1", status: "active", plan: path.join(ws, "plans", "a.md"),
      active_session_id: "sess-active-1",
      progress: [{ id: "s1", status: "pass" }, { id: "s2", status: "pending" }],
    }));
    const env = baseEnv({ HERMES_SESSION_STORE: db });
    const brief = runCLI(["--json", "--here", "--session", "sess-active-1"], { cwd: ws, env });
    assert.equal(brief.status, 0, brief.stderr);
    const data = JSON.parse(brief.stdout);
    assert.equal(data.sources.sessions, "ok");
    // Only the recent session is in the window; the nine-day-old one is out.
    assert.equal(data.summary.sessions, 1);
    const session = data.sessions[0];
    assert.equal(session.title, "Bridge the collector");
    assert.deepEqual(session.asked, ["please bridge the collector next, [redacted]"]);
    assert.equal(session.status, "active");
    assert.equal(session.branch, "port/1038");
    assert.ok((session.done.tools.edit_file ?? 0) >= 1, "tool tally keeps the store count");
    assert.equal(data.nextRecorded, true);
    const record = JSON.parse(fs.readFileSync(path.join(ws, ".hermes", "lithermes", "adhd", "next-sess-active-1.json"), "utf8"));
    assert.equal(record.kind, "continue-work");
    // A planted credential shape never leaves the collector.
    const raw = brief.stdout;
    assert.ok(!raw.includes(secret), "planted secret leaked into the brief");
    assert.ok(raw.includes("[redacted]"), "redaction marker missing");
    // No forbidden placeholder reaches the surface.
    for (const token of ["?/?", "[???]", "k/?"]) assert.ok(!raw.includes(token), `${token} reached the brief`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("the text brief carries the next command and names unknown sources once", { skip: !hasSqlite3() }, () => {
  const ws = fixtureWs();
  try {
    const db = path.join(ws, "state.db");
    writeFixtureDb(db, ws);
    const env = baseEnv({ HERMES_SESSION_STORE: db });
    // The brief runs as the fixture's live session, so no other lane holds the plan back.
    const brief = runCLI(["--here", "--width", "100", "--session", "sess-active-1"], { cwd: ws, env });
    assert.equal(brief.status, 0, brief.stderr);
    assert.match(brief.stdout, /lit-adhd: 1 session\(s\) · 0 waiting on you · next: start plan/);
    assert.match(brief.stdout, /\(run \/start-work plans\/a\.md\)/);
    assert.match(brief.stdout, /\[░░\] 0\/2/);
    assert.doesNotMatch(brief.stdout, /Say `go`/);
    assert.match(brief.stdout, /^unknown: .*$/m);
    for (const token of ["?/?", "[???]", "k/?"]) assert.ok(!brief.stdout.includes(token), `${token} reached the text brief`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("ended sessions fold to a table and a missing step becomes a suggestion", { skip: !hasSqlite3() }, async () => {
  const ws = fixtureWs();
  try {
    fs.writeFileSync(path.join(ws, "plans", "a.md"), "# A\n\n- [x] 1. The done thing\n");
    const db = path.join(ws, "state.db");
    const now = Math.floor(Date.now() / 1000);
    const sql = [
      "CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, last_activity_at REAL, cwd TEXT, git_branch TEXT, git_repo_root TEXT, message_count INTEGER, tool_call_count INTEGER, tool_names TEXT, title TEXT, display_name TEXT, archived INTEGER, hidden INTEGER);",
      "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, active INTEGER);",
      `INSERT INTO sessions VALUES ('sess-active-1', ${now - 3600}, NULL, ${now - 60}, '${ws}', 'port/1038', '', 4, 2, '["edit_file"]', '', 'Bridge the collector', 0, 0);`,
      `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-active-1', 'user', 'please bridge the collector next', ${now - 300}, 1);`,
      `INSERT INTO messages (session_id, role, content, tool_name, timestamp, active) VALUES ('sess-active-1', 'tool', 'wrote the file', 'edit_file', ${now - 120}, 1);`,
      `INSERT INTO sessions VALUES ('sess-ended-1', ${now - 86400 * 2}, ${now - 86400}, ${now - 86400}, '${ws}', '', '', 1, 1, '["read_file"]', '', 'A very long finished thread title that keeps going well past the forty-four column goal limit', 0, 0);`,
      `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-ended-1', 'user', 'old ask', ${now - 86400}, 1);`,
    ].join("\n");
    assert.equal(spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" }).status, 0);
    const env = baseEnv({ HERMES_SESSION_STORE: db });
    const brief = runCLI(["--here", "--width", "160"], { cwd: ws, env });
    assert.equal(brief.status, 0, brief.stderr);
    // The other live session is a lane at work, which outranks every other suggestion.
    assert.match(brief.stdout, /next: wait for lanes/);
    assert.match(brief.stdout, /-- next --\n> wait for 1 lane to finish/);
    assert.match(brief.stdout, /-- ended · 1 --/);
    assert.match(brief.stdout, /\| id \| where \| goal \| ago \| done \|/);
    assert.match(brief.stdout, /now: edit_file "wrote the file"/);
    assert.match(brief.stdout, /\| sess-end \|/);
    assert.match(brief.stdout, /\| 1d \|/);
    assert.match(brief.stdout, /used read_file/);
    const gauge = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/gauge.mjs");
    for (const raw of brief.stdout.split("\n")) assert.ok(gauge.displayWidth(raw) <= 160, `line exceeds width: ${raw}`);
    const narrow = runCLI(["--here", "--width", "100"], { cwd: ws, env });
    assert.equal(narrow.status, 0, narrow.stderr);
    for (const raw of narrow.stdout.split("\n")) assert.ok(gauge.displayWidth(raw) <= 100, `line exceeds width: ${raw}`);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("the skill body carries its contracts and cross-links lit-recap both ways", () => {
  const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  assert.ok(text.split(/\s+/u).length >= 1000, "dense body");
  for (const heading of ["## When this applies", "## Inputs and state", "## Procedure", "## Hermes tools and approvals", "## Evidence", "## Stop and report", "## Pitfalls"]) {
    assert.ok(text.includes(heading), heading);
  }
  for (const rule of [/\[▉▉▉░░\] 3\/5/u, /remaining items?/iu, /… \d+ steps/u, /no typed `go`/u]) {
    assert.ok(rule.test(text), `gauge rule: ${rule}`);
  }
  for (const ref of ["references/status-taxonomy.md", "references/card-examples.md", "references/brief-contract.md"]) {
    assert.ok(text.includes(ref), ref);
    assert.ok(fs.existsSync(path.join(SKILL, ref)), ref);
  }
  for (const lib of ["scripts/adhd.mjs", "scripts/lib/collect.mjs", "scripts/lib/gauge.mjs", "scripts/lib/redact.mjs", "scripts/lib/secret-shapes.mjs", "scripts/lib/plan-task-rows.mjs", "scripts/lib/next-step.mjs", "scripts/lib/hermes-sessions.mjs"]) {
    assert.ok(fs.existsSync(path.join(SKILL, lib)), `${lib} ships`);
  }
  const description = /^description: "(.*)"$/mu.exec(text)[1];
  assert.ok(Buffer.byteLength(description) <= 110, `catalog description ${Buffer.byteLength(description)} B fits the budget`);
  assert.match(text, /lit recap/u, "cross-links lit-recap");
  const recap = fs.readFileSync(path.join(SKILL, "..", "lit-recap", "SKILL.md"), "utf8");
  assert.match(recap, /lit adhd/u, "lit-recap cross-links lit-adhd");
});

test("redaction masks quoted-JSON secrets and short secret-like env values", async () => {
  const { makeRedactor } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/redact.mjs");
  const redact = makeRedactor({ env: { ADHD_TEST_API_TOKEN: "zq9x", ADHD_TEST_MODE: "ab", PATH: "/usr/bin:/bin" }, home: "/tmp/nowhere-home" });
  assert.equal(redact('{"api_key":"supersecret12"}'), '{"api_key":"[redacted]"}');
  assert.equal(redact("{'password':'abc'}"), "{'password':'[redacted]'}");
  assert.ok(!redact("use zq9x now").includes("zq9x"), "short secret-like env value leaked");
  assert.ok(redact("mode ab here").includes("ab"), "non-secret short value must stay");
  assert.ok(redact("PATH is /usr/bin:/bin").includes("/usr/bin"), "path value must stay");
});

test("redaction strips terminal control bytes but keeps tabs and newlines", async () => {
  const { makeRedactor } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/redact.mjs");
  const redact = makeRedactor({ env: {}, home: "/tmp/nowhere-home" });
  const out = redact("landed\u001b]0;pwned\u0007done");
  assert.ok(!out.includes("\u001b") && !out.includes("\u0007"), "escape bytes survived redaction");
  assert.ok(out.includes("landed") && out.includes("done"), "printable text lost");
  assert.equal(redact("a\tb\nc"), "a\tb\nc");
});

test("clipToWidth strips terminal control bytes before measuring", async () => {
  const { clipToWidth } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/gauge.mjs");
  assert.equal(clipToWidth("a\u001b[2Jb", 10), "ab");
  assert.equal(clipToWidth("landed\u001b]0;pwned\u0007done", 40), "landeddone");
  assert.equal(clipToWidth("a\tb", 10), "a\tb");
});

test("a secret past the clip window is masked, not cut and leaked", { skip: !hasSqlite3() }, () => {
  const ws = fixtureWs();
  try {
    const db = path.join(ws, "state.db");
    const now = Math.floor(Date.now() / 1000);
    const secret = "zx9q-unique-collector-77";
    const pad = "P".repeat(140);
    const sql = [
      "CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, last_activity_at REAL, cwd TEXT, git_branch TEXT, git_repo_root TEXT, message_count INTEGER, tool_call_count INTEGER, tool_names TEXT, title TEXT, display_name TEXT, archived INTEGER, hidden INTEGER);",
      "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, active INTEGER);",
      `INSERT INTO sessions VALUES ('sess-long-1', ${now - 3600}, NULL, ${now - 60}, '${ws}', 'port/1038', '', 1, 0, '[]', '', 'Long thread', 0, 0);`,
      `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-long-1', 'user', '${pad} see ${secret} here', ${now - 300}, 1);`,
    ].join("\n");
    assert.equal(spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" }).status, 0);
    const env = baseEnv({ HERMES_SESSION_STORE: db, ADHD_TEST_LONG_TOKEN: secret });
    const brief = runCLI(["--json", "--here", "--width", "100"], { cwd: ws, env });
    assert.equal(brief.status, 0, brief.stderr);
    assert.ok(!brief.stdout.includes("zx9q"), "cut secret fragment leaked into the brief");
    assert.ok(brief.stdout.includes("[redacted]"), "redaction marker missing");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("a session whose bodies exceed the remaining budget is dropped unread", async () => {
  const lib = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/hermes-sessions.mjs");
  const big = "X".repeat(20_000_000);
  const bodyQueries = [];
  const exec = (file, args) => {
    const sql = args[args.length - 1];
    if (sql.includes("SUM(")) return JSON.stringify([{ total: 20000000 }]);
    bodyQueries.push(sql);
    return JSON.stringify([{ role: "user", content: big, tool_name: null, tool_calls: null, timestamp: 1, active: 1 }]);
  };
  const budget = lib.makeBudget();
  const out = lib.readHermesMessages("/nonexistent/store.db", "sess-big", budget, { exec });
  assert.equal(out, null, "over-budget batch was loaded instead of dropped");
  assert.equal(budget.exhausted, true);
  assert.equal(bodyQueries.length, 0, "message bodies were read for an over-budget batch");
});

test("next-step writes refuse planted symlinks", async () => {
  const { writeNextStep, nextStepPath } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/next-step.mjs");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-symlink-")));
  try {
    const adhdDir = path.join(root, ".hermes", "lithermes", "adhd");
    fs.mkdirSync(adhdDir, { recursive: true });
    const target = path.join(root, "victim.json");
    fs.writeFileSync(target, "original");
    const session = "sess-link";
    const staging = `${nextStepPath(root, session)}.${process.pid}.tmp`;
    fs.symlinkSync(target, staging);
    assert.throws(() => writeNextStep(root, session, { kind: "none", target: null }), "staging symlink was followed");
    assert.equal(fs.readFileSync(target, "utf8"), "original", "symlink target was overwritten");
    fs.rmSync(staging);
    const root2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-symlinkdir-")));
    try {
      const outside = path.join(root2, "outside");
      fs.mkdirSync(outside, { recursive: true });
      fs.symlinkSync(outside, path.join(root2, ".hermes"));
      assert.throws(() => writeNextStep(root2, session, { kind: "none", target: null }), "symlinked .hermes was followed");
      assert.equal(fs.readdirSync(outside).length, 0, "write escaped through the symlinked directory");
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the collector records the next step beside cwd, not at the outermost git root", async () => {
  const { collectAdhd } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/collect.mjs");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-cwdroot-")));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    const sub = path.join(root, "sub");
    fs.mkdirSync(path.join(sub, "plans"), { recursive: true });
    fs.writeFileSync(path.join(sub, "plans", "a.md"), "# A\n\n- [ ] 1. Do the one thing\n");
    const exec = (file, args) => {
      if (file === "git") throw new Error("no git here");
      throw new Error(`unexpected exec ${file}`);
    };
    const data = collectAdhd({ cwd: sub, here: true, sessionId: "sess-cwd", exec, env: { ...process.env, HERMES_SESSION_STORE: path.join(sub, "no-store.db") } });
    assert.equal(data.nextRecorded, true);
    assert.ok(fs.existsSync(path.join(sub, ".hermes", "lithermes", "adhd", "next-sess-cwd.json")), "record missing beside cwd");
    assert.ok(!fs.existsSync(path.join(root, ".hermes")), "record escaped to the git root");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function roundThreeWs({ openPlan = true } = {}) {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-round3-")));
  fs.mkdirSync(path.join(ws, "plans"));
  fs.writeFileSync(path.join(ws, "plans", "done.md"), "# Done\n\n## Todos\n- [x] 1. Port the collector\n- [x] 2. Run the gates\n");
  const stale = path.join(ws, "plans", "stale.md");
  fs.writeFileSync(stale, "# Stale\n\n## Todos\n- [ ] 1. Old abandoned step\n");
  const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
  fs.utimesSync(stale, tenDaysAgo, tenDaysAgo);
  if (openPlan) fs.writeFileSync(path.join(ws, "plans", "open.md"), "# Open\n\n## Todos\n- [x] 1. First\n- [ ] 2. Second step\n");
  const run = path.join(ws, ".hermes", "lithermes", "runs", "run-1");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "state.json"), JSON.stringify({
    run_id: "run-1", command: "start-work", created_at: new Date().toISOString(), plan: path.join(ws, "plans", "done.md"),
  }));
  fs.writeFileSync(path.join(ws, "HANDOFF.md"), "# Handoff\n\n## State\n\nall green\n\n## Next\n\n- Ship the port to main\n- Then rest\n");
  return ws;
}

async function collectQuiet(ws) {
  const { collectAdhd, renderAdhd } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/collect.mjs");
  const env = { ...process.env, HERMES_SESSION_STORE: path.join(ws, "no-store.db") };
  delete env.HERDR_ENV;
  const exec = () => {
    throw new Error("no git here");
  };
  const data = collectAdhd({ cwd: ws, here: true, exec, env, record: false });
  return { data, text: renderAdhd(data, 120) };
}

test("the brief opens with done, doing and next; finished plans count as done", async () => {
  const ws = roundThreeWs();
  try {
    const { data, text } = await collectQuiet(ws);
    assert.deepEqual(data.roadmap.plans.map((plan) => plan.plan), ["plans/open.md"], "stale and finished plans stay off the roadmap");
    assert.deepEqual(data.finished.plans.map((plan) => plan.plan), ["plans/done.md"]);
    assert.equal(data.finished.runs.length, 1);
    assert.equal(data.startWork[0].status, "done");
    const [done, doing, next] = text.split("\n");
    assert.match(done, /^Done so far: .*plans\/done\.md \(start-work complete\)/u);
    assert.equal(doing, "Doing now: nothing running");
    assert.match(next, /^Next: start plan: plans\/open\.md \(run \/start-work plans\/open\.md\)$/u);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("HANDOFF.md Next is the fallback and a stale or finished plan is never suggested", async () => {
  const ws = roundThreeWs({ openPlan: false });
  try {
    const { data, text } = await collectQuiet(ws);
    assert.equal(data.next.kind, "none");
    assert.equal(data.handoffs.find((handoff) => handoff.file === "HANDOFF.md").next, "Ship the port to main");
    assert.match(text.split("\n")[2], /^Next: HANDOFF\.md Next: Ship the port to main/u);
    assert.match(text, /-- next --\n> HANDOFF\.md Next: Ship the port to main/u);
    assert.doesNotMatch(text, /stale\.md|Old abandoned step/u);
    assert.doesNotMatch(text, /Next in plans\/done\.md/u);

    const work = path.join(ws, ".hermes", "lithermes", "work", "work-9");
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, "state.json"), JSON.stringify({
      work_id: "work-9", status: "active", plan: path.join(ws, "plans", "stale.md"), active_session_id: "someone-else",
      updated_at: new Date().toISOString(), progress: [{ id: "1", status: "pass" }, { id: "2", status: "pending" }],
    }));
    const running = await collectQuiet(ws);
    assert.match(running.text.split("\n")[1], /^Doing now: start-work .*stale\.md \[▉░\] 1\/2 \(another session\)$/u);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("plans past the read budget are counted and reported", async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-budget-")));
  try {
    fs.mkdirSync(path.join(ws, "plans"));
    const pad = `${"x".repeat(1024 * 1024)}\n`;
    for (let index = 0; index < 10; index += 1) {
      fs.writeFileSync(path.join(ws, "plans", `p${index}.md`), `- [ ] 1. Step ${index}\n${pad}`);
    }
    const { data, text } = await collectQuiet(ws);
    assert.equal(data.roadmap.plansSkipped, 2);
    assert.match(text, /2 plans were not read \(read budget used up\)/u);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("a linked worktree nested in a checkout is its own state root", async () => {
  const { collectAdhd } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/collect.mjs");
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-nested-")));
  try {
    fs.mkdirSync(path.join(outer, ".git"));
    fs.mkdirSync(path.join(outer, "plans"));
    fs.writeFileSync(path.join(outer, "plans", "stale.md"), "# Stale\n\n- [ ] 1. Left over in the main checkout\n");
    const lane = path.join(outer, ".worktrees", "lane");
    fs.mkdirSync(path.join(lane, "plans"), { recursive: true });
    fs.writeFileSync(path.join(lane, ".git"), "gitdir: ../../.git/worktrees/lane\n");
    fs.writeFileSync(path.join(lane, "plans", "now.md"), "# Now\n\n- [ ] 1. The lane's own step\n");
    const exec = () => {
      throw new Error("no git here");
    };
    const env = { ...process.env, HERMES_SESSION_STORE: path.join(lane, "no-store.db") };
    delete env.HERDR_ENV;
    const data = collectAdhd({ cwd: lane, exec, env, record: false });
    assert.deepEqual(data.scope.worktrees, [lane]);
    assert.deepEqual(data.roadmap.plans.map((plan) => plan.plan), ["plans/now.md"]);
    assert.equal(data.roadmap.plans[0].local, true);

    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-nogit-")));
    try {
      fs.mkdirSync(path.join(bare, "plans"));
      fs.writeFileSync(path.join(bare, "plans", "a.md"), "# A\n\n- [ ] 1. Git-less step\n");
      const loose = collectAdhd({ cwd: bare, exec, env, record: false });
      assert.deepEqual(loose.scope.worktrees, [bare]);
      assert.equal(loose.roadmap.plans[0].local, true);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

// Lanes, ownership and HANDOFF ordering for the one next step.
const { execFileSync } = require("node:child_process");

function herdrJson(agents) {
  return JSON.stringify({ result: { agents } });
}

async function collectWith(ws, { herdr = null, sessionId = null, store = null } = {}) {
  const { collectAdhd, renderAdhd } = await import("../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/collect.mjs");
  const env = { ...process.env, HERMES_SESSION_STORE: store ?? path.join(ws, "no-store.db") };
  for (const key of ["HERDR_ENV", "HERDR_WORKSPACE_ID", "HERDR_PANE_ID"]) delete env[key];
  if (herdr !== null) Object.assign(env, { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w1", HERDR_PANE_ID: "w1:p1" });
  const exec = (file, args, options) => {
    if (file === "herdr") {
      if (herdr instanceof Error) throw herdr;
      return herdr;
    }
    if (file === "sqlite3") return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options });
    throw new Error("no git here");
  };
  const data = collectAdhd({ cwd: ws, here: true, exec, env, sessionId, record: false });
  return { data, text: renderAdhd(data, 160, sessionId) };
}

const lastLine = (text) => text.trimEnd().split("\n").at(-1);
const nextBox = (text) => /-- next --\n> (.*)/u.exec(text)?.[1] ?? "";

test("herdr lanes at work turn a start-plan step into a wait with no go", async () => {
  const ws = roundThreeWs();
  try {
    const agents = [
      { agent: "claude", agent_status: "working", pane_id: "w1:p1", workspace_id: "w1", cwd: "/elsewhere" },
      { agent: "claude", agent_status: "working", pane_id: "w1:p2", workspace_id: "w1", cwd: "/elsewhere" },
      { agent: "hermes", agent_status: "blocked", pane_id: "w2:p3", workspace_id: "w2", cwd: "/x", foreground_cwd: path.join(ws, "sub") },
      { agent: "claude", agent_status: "idle", pane_id: "w1:p4", workspace_id: "w1", cwd: ws },
      { agent: "claude", agent_status: "done", pane_id: "w1:p7", workspace_id: "w1", cwd: ws },
      { agent: "claude", agent_status: "working", pane_id: "w3:p5", workspace_id: "w3", cwd: "/elsewhere" },
      { agent: "claude", agent_status: "working", pane_id: "w9:p9", workspace_id: "w9", cwd: `${ws}-sibling` },
    ];
    const { data, text } = await collectWith(ws, { herdr: herdrJson(agents) });
    assert.equal(data.sources.herdr, "ok");
    assert.equal(data.lanes.count, 2);
    assert.equal(data.next.kind, "wait-lanes");
    assert.match(nextBox(text), /wait for 2 lanes/u);
    assert.doesNotMatch(nextBox(text), /\/start-work/u);
    assert.equal(lastLine(text), "Do not type `go` until they finish.");

    for (const broken of [new Error("herdr timed out"), "not json", herdrJson("nope")]) {
      const quiet = await collectWith(ws, { herdr: broken });
      assert.equal(quiet.data.sources.herdr, "unknown");
      assert.equal(quiet.data.lanes.count, 0);
      assert.equal(quiet.data.next.kind, "start-plan");
      assert.doesNotMatch(quiet.text, /Do not type `go`/u);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("another live session is a lane, counted once when herdr sees it too", { skip: !hasSqlite3() }, async () => {
  const ws = fixtureWs();
  try {
    const db = path.join(ws, "state.db");
    writeFixtureDb(db, ws);
    const own = await collectWith(ws, { store: db, sessionId: "sess-active-1" });
    assert.equal(own.data.lanes.count, 0, "this session is never its own lane");
    assert.equal(own.data.next.kind, "start-plan");

    const agents = [
      { agent: "hermes", agent_status: "working", pane_id: "w1:p2", workspace_id: "w1", cwd: ws, agent_session: { value: "sess-active-1" } },
      { agent: "claude", agent_status: "working", pane_id: "w1:p3", workspace_id: "w1", cwd: ws, agent_session: { value: "someone-else" } },
      { agent: "hermes", agent_status: "working", pane_id: "w1:p8", workspace_id: "w1", cwd: ws, agent_session: { value: "me-session" } },
    ];
    const { data, text } = await collectWith(ws, { store: db, sessionId: "me-session", herdr: herdrJson(agents) });
    assert.equal(data.lanes.count, 2);
    assert.equal(data.next.kind, "wait-lanes");
    assert.match(nextBox(text), /wait for 2 lanes/u);
    assert.equal(lastLine(text), "Do not type `go` until they finish.");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("a lane waiting on the user is the step to answer while lanes work", { skip: !hasSqlite3() }, async () => {
  const ws = fixtureWs();
  try {
    const db = path.join(ws, "state.db");
    writeFixtureDb(db, ws);
    const now = Math.floor(Date.now() / 1000);
    const sql = `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-active-1', 'user', 'Which port should it bind?', ${now - 30}, 1);`;
    assert.equal(spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" }).status, 0);
    const { data, text } = await collectWith(ws, { store: db, sessionId: "me-session" });
    assert.equal(data.lanes.count, 1);
    assert.equal(data.next.kind, "wait-lanes");
    assert.match(nextBox(text), /answer sess-act/u);
    assert.equal(lastLine(text), "Do not type `go` until they finish.");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("an ownerless start-work run is never this session's run to continue", async () => {
  const ws = roundThreeWs();
  try {
    const run = path.join(ws, ".hermes", "lithermes", "runs", "run-2");
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, "state.json"), JSON.stringify({
      run_id: "run-2", command: "start-work", created_at: new Date(Date.now() + 1000).toISOString(), plan: path.join(ws, "plans", "open.md"),
    }));
    const { data, text } = await collectWith(ws, { sessionId: "me-session" });
    assert.equal(data.startWork[0].status, "active");
    assert.equal(data.startWork[0].self, false);
    assert.notEqual(data.next.kind, "continue-work");
    assert.doesNotMatch(text, /^(?!.*Do not).*\b(type|say) [`"]go/imu);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("HANDOFF Next skips finished items and the newest handoff file wins", async () => {
  const ws = roundThreeWs({ openPlan: false });
  try {
    fs.writeFileSync(path.join(ws, "HANDOFF.md"), [
      "# Handoff", "", "## Next", "",
      "- ✅ Ship the port", "- [x] Tag it", "- ~~Old idea~~", "- DONE: rerun gates", "- SHIPPED 1.0.3", "- ✓ notes",
      "- Done-ish wording stays open", "- Later item", "",
    ].join("\n"));
    let quiet = await collectWith(ws);
    assert.equal(quiet.data.handoffs.find((handoff) => handoff.file === "HANDOFF.md").next, "Done-ish wording stays open");

    const twoDaysAgo = (Date.now() - 2 * 86_400_000) / 1000;
    fs.utimesSync(path.join(ws, "HANDOFF.md"), twoDaysAgo, twoDaysAgo);
    fs.mkdirSync(path.join(ws, ".handoff"));
    fs.writeFileSync(path.join(ws, ".handoff", "HANDOFF.md"), "# Handoff\n\n## Next\n\n- Fresh dedicated step\n");
    quiet = await collectWith(ws);
    assert.match(nextBox(quiet.text), /HANDOFF\.md Next: Fresh dedicated step/u);

    fs.utimesSync(path.join(ws, ".handoff", "HANDOFF.md"), twoDaysAgo - 10, twoDaysAgo - 10);
    fs.writeFileSync(path.join(ws, "HANDOFF-lane.md"), "# Lane\n\n## Next\n\n- Newest lane step\n");
    quiet = await collectWith(ws);
    assert.match(nextBox(quiet.text), /HANDOFF\.md Next: Newest lane step/u);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("live lanes and open plan items outrank the HANDOFF Next item", async () => {
  const ws = roundThreeWs({ openPlan: false });
  try {
    const agents = [{ agent: "claude", agent_status: "working", pane_id: "w1:p2", workspace_id: "w1", cwd: ws }];
    const busy = await collectWith(ws, { herdr: herdrJson(agents) });
    assert.equal(busy.data.next.kind, "none");
    assert.match(nextBox(busy.text), /wait for 1 lane/u);
    assert.doesNotMatch(nextBox(busy.text), /HANDOFF/u);
    assert.equal(lastLine(busy.text), "Do not type `go` until they finish.");

    fs.writeFileSync(path.join(ws, "plans", "one.md"), "# One\n\n- [ ] 1. First open step\n");
    fs.writeFileSync(path.join(ws, "plans", "two.md"), "# Two\n\n- [ ] 1. Second open step\n");
    const planned = await collectWith(ws);
    assert.equal(planned.data.next.kind, "none");
    assert.match(nextBox(planned.text), /^Next in plans\/(one|two)\.md/u);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
