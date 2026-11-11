// lit-adhd v2: the KPI board the collector draws ahead of the old per-session brief.
// The board is computed in code (buckets, counts, bars, percentages, reminders) and the
// skill shows it as given, so every assertion here runs against the collector itself.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const SKILL = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-adhd");
const CLI = path.join(SKILL, "scripts", "adhd.mjs");
const COLLECT = "../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/collect.mjs";

const EN_HEADINGS = ["## 🎯 Do this now", "## 📊 At a glance", "## 🏁 Milestones", "## ✅ Done lately", "## ⬜ Still to do", "## 🔔 Don't forget"];
const KO_HEADINGS = ["## 🎯 지금 할 일", "## 📊 한눈에 보기", "## 🏁 마일스톤", "## ✅ 최근 끝낸 일", "## ⬜ 남은 일", "## 🔔 잊지 말 것"];
const LINE_CAP = 44;

function hasSqlite3() {
  try {
    return spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of ["HERDR_ENV", "HERDR_WORKSPACE_ID", "HERDR_PANE_ID"]) delete env[key];
  return env;
}

const realExec = (file, args, options) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...options });

// The spec fixture: one fully ticked plan, one half-ticked plan, one plan untouched for ten
// days, a session waiting on the user, and uncommitted changes in a real git repository.
function specFixture() {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-board-")));
  git(ws, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(ws, "README.md"), "# fixture\n");
  git(ws, "add", "README.md");
  git(ws, "commit", "-q", "-m", "chore: seed the fixture");
  const hash = git(ws, "rev-parse", "HEAD").trim();
  fs.mkdirSync(path.join(ws, "plans"));
  fs.writeFileSync(path.join(ws, "plans", "2026-11-01-ship-board.md"), "# Ship the board\n\n- [x] 1. Write the RED tests\n- [x] 2. Build the collector\n");
  fs.writeFileSync(path.join(ws, "plans", "2026-11-09-polish-docs.md"), "# Polish the docs\n\n- [x] 1. Draft the README section\n- [x] 2. Draft the Korean README section\n- [ ] 3. Proofread both READMEs\n- [ ] 4. Record the rendered sample\n");
  const stale = path.join(ws, "plans", "2026-10-20-old-idea.md");
  fs.writeFileSync(stale, "# Old idea\n\n- [ ] 1. Sketch the old idea\n");
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
  fs.utimesSync(stale, tenDaysAgo, tenDaysAgo);
  fs.writeFileSync(path.join(ws, "README.md"), "# fixture, edited\n");
  return { ws, hash };
}

function writeWaitingStore(db, ws) {
  const now = Math.floor(Date.now() / 1000);
  const sql = [
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL, ended_at REAL, last_activity_at REAL, cwd TEXT, git_branch TEXT, git_repo_root TEXT, message_count INTEGER, tool_call_count INTEGER, tool_names TEXT, title TEXT, display_name TEXT, archived INTEGER, hidden INTEGER);",
    "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, active INTEGER);",
    `INSERT INTO sessions VALUES ('sess-wait-0001-uuid', ${now - 1800}, NULL, ${now - 30}, '${ws}', 'main', '', 2, 0, '[]', '', 'Pick the board port', 0, 0);`,
    `INSERT INTO messages (session_id, role, content, timestamp, active) VALUES ('sess-wait-0001-uuid', 'user', 'Which port should the board bind?', ${now - 30}, 1);`,
  ].join("\n");
  const r = spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

async function boardOf(ws, { lang = "en", store = null, sessionId = "me-session" } = {}) {
  const { collectAdhd } = await import(COLLECT);
  const env = cleanEnv({ HERMES_SESSION_STORE: store ?? path.join(ws, "no-store.db") });
  return collectAdhd({ cwd: ws, here: true, exec: realExec, env, sessionId, lang, record: false });
}

const sectionOf = (text, heading, headings) => {
  const start = text.indexOf(heading);
  const after = headings.map((item) => text.indexOf(item)).filter((index) => index > start).sort((a, b) => a - b)[0] ?? text.length;
  return text.slice(start + heading.length, after).trim();
};

test("the board shows its six sections in the fixed order, in English and Korean", { skip: !hasSqlite3() }, async () => {
  const { ws } = specFixture();
  try {
    const db = path.join(ws, "state.db");
    writeWaitingStore(db, ws);
    for (const [lang, headings] of [["en", EN_HEADINGS], ["ko", KO_HEADINGS]]) {
      const data = await boardOf(ws, { lang, store: db });
      const text = data.board.text;
      assert.equal(text.split("\n")[0], "REWIND <<", "the rewind look opens the board");
      const positions = headings.map((heading) => text.indexOf(heading));
      for (const [index, position] of positions.entries()) assert.ok(position >= 0, `${headings[index]} missing (${lang})`);
      assert.deepEqual([...positions].sort((a, b) => a - b), positions, `section order (${lang})`);
      assert.equal(data.board.lang, lang);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("bucket counts, the overall bar and milestone rows come from the records", { skip: !hasSqlite3() }, async () => {
  const { ws } = specFixture();
  try {
    const db = path.join(ws, "state.db");
    writeWaitingStore(db, ws);
    const { board } = await boardOf(ws, { store: db });
    // Ticked rows 2 + 2; the half plan's current row is in progress; its last row remains;
    // the waiting session is the one thing waiting on the user. The stale plan is a reminder.
    assert.deepEqual(board.counts, { done: 4, inProgress: 1, waiting: 1, remaining: 1, total: 7 });
    assert.deepEqual(board.overall, { done: 4, total: 7, percent: 57, bar: "██████░░░░" });
    assert.match(board.text, /\| 4 \| 1 \| 1 \| 1 \|/u);
    assert.match(board.text, /Overall {2}██████░░░░ {2}4\/7 \(57%\)/u);
    assert.deepEqual(board.milestones.map(({ name, bucket, done, total }) => ({ name, bucket, done, total })), [
      { name: "Polish the docs", bucket: "inProgress", done: 2, total: 4 },
      { name: "Ship the board", bucket: "done", done: 2, total: 2 },
    ]);
    assert.match(board.text, /^\| Polish the docs \| 🔄 In progress \| █████░░░░░ 2\/4 \(50%\) \| .+ \|$/mu);
    assert.match(board.text, /^\| Ship the board \| ✅ Done \| ██████████ 2\/2 \(100%\) \| .+ \|$/mu);
    assert.doesNotMatch(board.text, /Old idea \|/u, "a stale plan is a reminder, not a milestone row");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("do-this-now keeps the next-step priority and says exactly what to type", { skip: !hasSqlite3() }, async () => {
  const { ws } = specFixture();
  try {
    const db = path.join(ws, "state.db");
    writeWaitingStore(db, ws);
    const waiting = await boardOf(ws, { store: db });
    assert.equal(waiting.next.kind, "wait-lanes", "the next-step priority is unchanged");
    const now = sectionOf(waiting.board.text, EN_HEADINGS[0], EN_HEADINGS).split("\n");
    assert.equal(now.length, 3);
    assert.match(now[0], /^\*\*Answer the session that is waiting on you\*\* — /u);
    assert.match(now[0], /Pick the board port/u);
    assert.match(now[2], /^👉 Type: answer it in that session's chat; do not type `go` yet$/u);

    const quiet = await boardOf(ws);
    assert.equal(quiet.next.kind, "start-plan");
    const start = sectionOf(quiet.board.text, EN_HEADINGS[0], EN_HEADINGS).split("\n");
    assert.match(start[0], /^\*\*Start the plan "Polish the docs"\*\* — /u);
    assert.match(start[1], /^Next step: Proofread both READMEs$/u);
    assert.equal(start[2], "👉 Type: `/start-work plans/2026-11-09-polish-docs.md`");
    const ko = await boardOf(ws, { lang: "ko" });
    assert.match(ko.board.text, /👉 입력: `\/start-work plans\/2026-11-09-polish-docs\.md`/u);
    assert.equal(ko.board.now.type, "`/start-work plans/2026-11-09-polish-docs.md`");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("a recorded next step offers `go`, an approval never does", async () => {
  const { renderBoard } = await import(COLLECT);
  const base = {
    generatedAt: new Date().toISOString(), scope: { worktrees: ["/tmp/ws"] }, sessions: [], startWork: [], commits: [],
    handoffs: [], lanes: { count: 0, sessions: [], agents: [], waiting: null }, finished: { runs: [], plans: [] },
    roadmap: { plans: [{ worktree: "/tmp/ws", plan: "plans/a.md", title: "A plan", local: true, current: "1. First", changedMs: Date.now(), rows: [{ checked: false, title: "1. First" }], progress: { done: 0, total: 1, gauge: "[░] 0/1", remaining: ["1. First"] } }], plansOmitted: 0, plansSkipped: 0, litgoal: [] },
    stalePlans: [], gitState: [],
  };
  const recorded = renderBoard({ ...base, next: { kind: "start-plan", target: { plan: "plans/a.md" }, command: "/start-work plans/a.md" }, nextRecorded: true }, "en");
  assert.equal(recorded.now.type, "`go` (or `/start-work plans/a.md`)");
  const boundary = renderBoard({
    ...base,
    startWork: [{ worktree: "/tmp/ws", workId: "work-1", plan: "/tmp/ws/plans/a.md", status: "paused", id8: "unknown", pendingBoundary: { boundary: "deploy" }, progress: { done: 0, total: 1, gauge: "[░] 0/1", remaining: [] } }],
    next: { kind: "approve-boundary", target: { workId: "work-1", plan: "/tmp/ws/plans/a.md", boundary: "deploy" } },
    nextRecorded: true,
  }, "en");
  assert.match(boundary.text, /^\*\*Hand the paused run to a session\*\*/mu);
  assert.match(boundary.now.type, /continue-session/u);
  assert.doesNotMatch(boundary.now.type, /`go`/u);
  assert.doesNotMatch(boundary.text, /work-1/u);
});

test("a partial count never reads 0% or 100%, in the bar or in the percentage", async () => {
  const { renderBoard } = await import(COLLECT);
  const planOf = (name, done, total) => ({
    worktree: "/tmp/ws", plan: `plans/${name}.md`, title: name, local: true, current: "open", changedMs: Date.now(), rows: [],
    progress: { done, total, gauge: `${done}/${total}`, remaining: [] },
  });
  const board = renderBoard({
    generatedAt: new Date().toISOString(), scope: { worktrees: ["/tmp/ws"] }, sessions: [], startWork: [], commits: [],
    handoffs: [], lanes: { count: 0, sessions: [], agents: [], waiting: null }, finished: { runs: [], plans: [] },
    roadmap: { plans: [planOf("Almost", 199, 200), planOf("Barely", 1, 300)], plansOmitted: 0, plansSkipped: 0, litgoal: [] },
    stalePlans: [], gitState: [], next: { kind: "none" }, nextRecorded: false,
  }, "en");
  const almost = board.milestones.find((item) => item.name === "Almost");
  const barely = board.milestones.find((item) => item.name === "Barely");
  assert.equal(almost.bar, "█████████░");
  assert.equal(almost.percent, 99, "199/200 is not finished, so it never reads 100%");
  assert.equal(barely.bar, "█░░░░░░░░░");
  assert.equal(barely.percent, 1, "1/300 has started, so it never reads 0%");
  assert.match(board.text, /█████████░ 199\/200 \(99%\)/u);
  assert.match(board.text, /█░░░░░░░░░ 1\/300 \(1%\)/u);
  assert.doesNotMatch(board.text, /\(100%\)|\(0%\)/u);
});

test("done lately caps at five, still-to-do caps at seven with a count of the rest", async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-board-caps-")));
  try {
    fs.mkdirSync(path.join(ws, "plans"));
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => `- [x] ${index + 1}. Finished step ${index + 1}`),
      ...Array.from({ length: 10 }, (_, index) => `- [ ] ${index + 10}. Open step ${index + 10}`),
    ];
    fs.writeFileSync(path.join(ws, "plans", "big.md"), `# Big plan\n\n${rows.join("\n")}\n`);
    for (const lang of ["en", "ko"]) {
      const { board } = await boardOf(ws, { lang });
      assert.equal(board.done.length, 5);
      assert.equal(board.done[0], "Finished step 9", "newest first: the last ticked row leads");
      assert.equal(board.remaining.items.length, 7);
      assert.equal(board.remaining.items[0], "Open step 10", "plan order, numbering stripped");
      assert.equal(board.remaining.more, 3);
      const left = sectionOf(board.text, (lang === "en" ? EN_HEADINGS : KO_HEADINGS)[4], lang === "en" ? EN_HEADINGS : KO_HEADINGS).split("\n");
      assert.equal(left.length, 8);
      assert.equal(left[0], "1. Open step 10");
      assert.equal(left.at(-1), lang === "en" ? "…and 3 more" : "…외 3개");
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("reminders are action-shaped, most urgent first, capped at five", { skip: !hasSqlite3() }, async () => {
  const { ws } = specFixture();
  try {
    const db = path.join(ws, "state.db");
    writeWaitingStore(db, ws);
    fs.writeFileSync(path.join(ws, "HANDOFF.md"), "# Handoff\n\n## Next\n- Ship the KPI board\n");
    const { board } = await boardOf(ws, { store: db });
    assert.ok(board.reminders.length <= 5);
    for (const reminder of board.reminders) assert.match(reminder, / → \S/u, `action-shaped: ${reminder}`);
    assert.match(board.reminders[0], /^⏳ "Pick the board port" is waiting for your answer → /u);
    assert.match(board.reminders[1], /^💾 \d+ uncommitted changes? \(lithermes-board-[^)]+\) → /u);
    assert.match(board.reminders.find((item) => item.startsWith("🕰️")), /^🕰️ Plan untouched for 10 days: Old idea → decide whether to resume it or drop it$/u);
    assert.ok(board.reminders.some((item) => item.startsWith("📌 HANDOFF next: Ship the KPI board → ")));
    const lines = sectionOf(board.text, EN_HEADINGS[5], EN_HEADINGS).split("\n");
    assert.deepEqual(lines, board.reminders.map((item) => `- ${item}`));
    // The collector's own next-step record lives under .hermes/; it is never a change to commit.
    const before = board.reminders[1];
    fs.mkdirSync(path.join(ws, ".hermes", "lithermes", "adhd"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".hermes", "lithermes", "adhd", "next-me.json"), "{}\n");
    assert.equal((await boardOf(ws, { store: db })).board.reminders[1], before);

    const { renderBoard } = await import(COLLECT);
    const many = renderBoard({
      generatedAt: new Date().toISOString(), scope: { worktrees: [ws] }, startWork: [], commits: [], finished: { runs: [], plans: [] },
      sessions: Array.from({ length: 7 }, (_, index) => ({ id8: `s${index}`, status: "waiting-on-user", title: `Question ${index}`, asked: ["Why?"], worktree: ws, last: new Date().toISOString(), self: false })),
      handoffs: [], lanes: { count: 7, sessions: [], agents: [], waiting: "s0" }, roadmap: { plans: [], plansOmitted: 0, plansSkipped: 0, litgoal: [] },
      stalePlans: [], gitState: [{ worktree: ws, uncommitted: 2, unpushed: 1 }], next: { kind: "wait-lanes", target: { lanes: 7, waiting: "s0" } }, nextRecorded: false,
    }, "en");
    assert.equal(many.reminders.length, 5);
    assert.ok(many.reminders.every((item) => item.startsWith("⏳")), "waiting reminders outrank the rest");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("the board never shows ids, hashes, slugs or raw status codes", { skip: !hasSqlite3() }, async () => {
  const { ws, hash } = specFixture();
  try {
    const db = path.join(ws, "state.db");
    writeWaitingStore(db, ws);
    for (const lang of ["en", "ko"]) {
      for (const sessionId of ["me-session", null]) {
        const { board } = await boardOf(ws, { lang, store: db, sessionId });
        for (const token of ["sess-wait", "me-session", hash.slice(0, 7), "waiting-on-user", "idle", "ended", "wait-lanes", "start-plan", "2026-11-09-polish-docs.md |", ws]) {
          assert.ok(!board.text.includes(token), `${token} reached the ${lang} board`);
        }
        assert.doesNotMatch(board.text, /\b[0-9a-f]{7,40}\b/u, "no commit hash");
        assert.doesNotMatch(board.text, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/u, "no uuid");
        assert.doesNotMatch(board.text, /\?\/\?|k\/\?|\[\?\?\?\]/u, "no question-mark gauge");
      }
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("empty sections print one plain line and the board stays short", async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-board-empty-")));
  try {
    const en = (await boardOf(ws)).board;
    assert.equal(sectionOf(en.text, EN_HEADINGS[3], EN_HEADINGS), "Nothing finished in this window");
    assert.equal(sectionOf(en.text, EN_HEADINGS[4], EN_HEADINGS), "Nothing left");
    assert.equal(sectionOf(en.text, EN_HEADINGS[2], EN_HEADINGS), "No plans or goals in this window");
    assert.equal(sectionOf(en.text, EN_HEADINGS[5], EN_HEADINGS), "Nothing to remember right now");
    assert.match(en.text, /Overall {2}Nothing to count yet/u);
    const ko = (await boardOf(ws, { lang: "ko" })).board;
    assert.equal(sectionOf(ko.text, KO_HEADINGS[4], KO_HEADINGS), "남은 일이 없어요");
    assert.equal(sectionOf(ko.text, KO_HEADINGS[3], KO_HEADINGS), "이 기간에 끝낸 일이 없어요");
    assert.equal(sectionOf(ko.text, KO_HEADINGS[5], KO_HEADINGS), "지금 챙길 것이 없어요");
    assert.ok(ko.text.split("\n").length <= 30);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("a full board stays within the line cap", async () => {
  const { renderBoard } = await import(COLLECT);
  const plan = (index) => ({
    worktree: "/tmp/ws", plan: `plans/p${index}.md`, title: `Plan ${index}`, local: true, current: "1. Open", changedMs: Date.now() - index * 60_000,
    rows: [{ checked: true, title: "0. Done" }, ...Array.from({ length: 9 }, (_, row) => ({ checked: false, title: `${row + 1}. Open ${row}` }))],
    progress: { done: 1, total: 10, gauge: "", remaining: [] },
  });
  const board = renderBoard({
    generatedAt: new Date().toISOString(), scope: { worktrees: ["/tmp/ws"] }, startWork: [], commits: [], finished: { runs: [], plans: [] },
    sessions: Array.from({ length: 9 }, (_, index) => ({ id8: `s${index}`, status: "waiting-on-user", title: `Q ${index}`, asked: ["Why?"], worktree: "/tmp/ws", last: new Date().toISOString(), self: false })),
    handoffs: [], lanes: { count: 9, sessions: [], agents: [], waiting: "s0" },
    roadmap: { plans: Array.from({ length: 8 }, (_, index) => plan(index)), plansOmitted: 4, plansSkipped: 0, litgoal: [] },
    stalePlans: [], gitState: [], next: { kind: "wait-lanes", target: { lanes: 9, waiting: "s0" } }, nextRecorded: false,
  }, "ko");
  const lines = board.text.split("\n");
  assert.ok(lines.length <= LINE_CAP, `board is ${lines.length} lines`);
  assert.match(board.text, /…외 \d+개/u);
});

test("the CLI prints the board by default and the old brief only on request", () => {
  const { ws } = specFixture();
  try {
    const env = cleanEnv({ HERMES_SESSION_STORE: path.join(ws, "no-store.db") });
    const plain = spawnSync(process.execPath, [CLI, "--here", "--lang", "ko"], { cwd: ws, env, encoding: "utf8" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.ok(plain.stdout.startsWith("REWIND <<\n## 🎯 지금 할 일"), plain.stdout.slice(0, 80));
    assert.doesNotMatch(plain.stdout, /^Done so far:/mu, "the per-session brief is not the default");
    const detail = spawnSync(process.execPath, [CLI, "--here", "--detail"], { cwd: ws, env, encoding: "utf8" });
    assert.equal(detail.status, 0, detail.stderr);
    assert.ok(detail.stdout.indexOf("## 🔔 Don't forget") < detail.stdout.indexOf("Done so far:"), "detail sits under the board");
    const json = JSON.parse(spawnSync(process.execPath, [CLI, "--json", "--here", "--lang", "ko"], { cwd: ws, env, encoding: "utf8" }).stdout);
    assert.ok(json.board.text.startsWith("REWIND <<"));
    assert.equal(json.board.detailText, undefined);
    const jsonDetail = JSON.parse(spawnSync(process.execPath, [CLI, "--json", "--here", "--detail"], { cwd: ws, env, encoding: "utf8" }).stdout);
    assert.match(jsonDetail.board.detailText, /^Done so far:/u);
    assert.equal(spawnSync(process.execPath, [CLI, "--lang", "fr"], { cwd: ws, env, encoding: "utf8" }).status, 64);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("the skill tells the model to show the board as given and keeps the detail view on request", () => {
  const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  assert.match(text, /board\.text/u);
  assert.match(text, /--lang ko/u);
  assert.match(text, /--detail/u);
  assert.match(text, /lit adhd 자세히/u);
  assert.match(text, /lit adhd detail/u);
  for (const heading of KO_HEADINGS) assert.ok(text.includes(heading.replace(/^## /u, "")), heading);
  const examples = fs.readFileSync(path.join(SKILL, "references", "card-examples.md"), "utf8");
  assert.match(examples, /## 🎯 지금 할 일/u);
  assert.match(examples, /## 🎯 Do this now/u);
});
