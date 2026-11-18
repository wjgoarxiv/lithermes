// lit-adhd default output: the six-line verdict card. A versioned rule table picks one verdict
// from the collected record; these tests replay hand-labelled snapshots against it, then try to
// make it lie (canaries), then run the real CLI with an isolated HOME for the cursor.
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const SKILL = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-adhd");
const CLI = path.join(SKILL, "scripts", "adhd.mjs");
const VERDICT = "../assets/lithermes-plugin/skills/lit-adhd/scripts/lib/verdict.mjs";

const NOW = "2026-11-18T09:00:00.000Z";
// A fully read record set with nothing open; each snapshot below adds one situation to it.
const base = (extra = {}) => ({
  generatedAt: NOW,
  sources: { sessions: "ok", gitState: "ok" },
  coverage: { notRead: { budget: 0, limit: 0, unreadable: 0 } },
  sessions: [{ id8: "self0001", self: true, status: "active", worktree: "~/w/main", last: NOW }],
  gitState: [{ worktree: "~/w/main", uncommitted: 0, unpushed: 0 }],
  roadmap: { plans: [] },
  startWork: [],
  next: { kind: "none", target: null },
  nextRecorded: false,
  finished: { runs: [], plans: [] },
  commits: [],
  stalePlans: [],
  ...extra,
});
const waiting = { id8: "abcd1234", self: false, status: "waiting-on-user", waitingReason: "asked the user", worktree: "~/w/lane-a", last: "2026-11-18T08:50:00.000Z" };
const endedRun = { status: "paused", pendingBoundary: { boundary: "b-7" }, workId: "work-1", revision: 4, plan: "plans/2026-11-18-leftovers.md", worktree: "~/w/main" };

// Hand-labelled: the situation a tired person comes back to, and the rule a careful human would
// apply first. Every rule appears at least once; null means no action (all clear or no verdict).
const SNAPSHOTS = [
  ["a run stopped when its session ended beats everything", base({ startWork: [endedRun], sessions: [...base().sessions, waiting] }), "resume-ended-run"],
  ["another session waits on the user", base({ sessions: [...base().sessions, waiting] }), "answer-session"],
  ["a session holding a stopped run is the run, not a question", base({ sessions: [...base().sessions, { ...waiting, waitingReason: "bounded-work boundary" }] }), null],
  ["this session's run is going", base({ next: { kind: "continue-work", target: { workId: "w2", plan: "plans/a.md" } }, nextRecorded: true }), "continue-own-work"],
  ["two other lanes are at work here", base({ next: { kind: "wait-lanes", target: { lanes: 2, waiting: null } } }), "other-lanes-at-work"],
  ["one open plan and nothing running", base({ next: { kind: "start-plan", target: { plan: "plans/a.md" }, command: "/start-work plans/a.md" }, roadmap: { plans: [{ plan: "plans/a.md", local: true, current: "1. Do it" }] } }), "start-single-plan"],
  ["uncommitted files and no plan", base({ gitState: [{ worktree: "~/w/main", uncommitted: 3, unpushed: 0 }] }), "uncommitted-work"],
  ["uncommitted files beat an open plan row", base({ gitState: [{ worktree: "~/w/main", uncommitted: 1, unpushed: 0 }], roadmap: { plans: [{ plan: "plans/a.md", local: true, current: "2. Next" }] } }), "uncommitted-work"],
  ["an unticked row in this folder's plan", base({ roadmap: { plans: [{ plan: "plans/a.md", local: true, current: "2. Wire the route" }] } }), "next-plan-row"],
  ["an unticked row in another worktree", base({ roadmap: { plans: [{ plan: "plans/b.md", local: false, worktree: "~/w/lane-b", current: "4. Docs" }] } }), "next-plan-row"],
  ["unpushed commits are never the action", base({ gitState: [{ worktree: "~/w/main", uncommitted: 0, unpushed: 3 }] }), null],
  ["parked steps are a question, not the action", base({ startWork: [{ status: "active", parked: 2, workId: "w3", plan: "plans/c.md", worktree: "~/w/main" }] }), null],
  ["everything read and nothing open", base(), null],
  ["a session over the cap is a gap, not a clear", base({ coverage: { notRead: { budget: 0, limit: 2, unreadable: 0 } } }), null],
];

test("verdict ladder matches at least 8 in 10 hand-labelled snapshots", async () => {
  const { decideVerdict, VERDICT_RULES_VERSION } = await import(VERDICT);
  const misses = SNAPSHOTS.filter(([, data, rule]) => decideVerdict(data).rule !== rule).map(([name, data]) => `${name}: got ${decideVerdict(data).rule}`);
  assert.ok((SNAPSHOTS.length - misses.length) / SNAPSHOTS.length >= 0.8, misses.join("\n"));
  assert.deepEqual(misses, []);
  assert.equal(VERDICT_RULES_VERSION, "adhd-verdict.hermes.v1");
});

test("the card is about six lines, Korean by default, with the exact input", async () => {
  const { renderVerdict } = await import(VERDICT);
  const data = base({ startWork: [endedRun], sessions: [...base().sessions, waiting], gitState: [{ worktree: "~/w/main", uncommitted: 0, unpushed: 2 }] });
  const { text } = renderVerdict(data, { cursor: { at: "2026-11-18T08:02:00.000Z", seen: [] } });
  const lines = text.trimEnd().split("\n");
  assert.ok(lines.length >= 5 && lines.length <= 6, text);
  assert.match(lines[0], /^\d\d:\d\d 이후: 0개 끝남, 2개가 너를 기다림$/u);
  assert.match(lines[1], /^지금 할 일: main 에서 leftovers 실행을 새 세션에 넘기기 #[0-9a-f]{6}$/u);
  assert.equal(lines[2], "입력: `/lit-loop resume work-1 --revision 4 --boundary b-7 --grant continue-session@~/w/main`");
  assert.match(lines[3], /^이유: .+ · 안 하면: .+$/u);
  assert.match(lines[4], /^다음 대기: lane-a 세션이 답을 기다림 · 네 확인 필요: main의 커밋 2개를 push 할까\?$/u);
  assert.equal(lines[5], "읽음 2/2 세션");
  const en = renderVerdict(data, { lang: "en" }).text;
  assert.match(en, /^First look — no baseline yet\nDo now: in main: hand the leftovers run to a new session #/u);
});

test("canary: a session's own claim never counts as done", async () => {
  const { decideVerdict } = await import(VERDICT);
  const claimed = base({ sessions: [...base().sessions, { ...waiting, status: "ended", result: "All done, everything shipped!" }] });
  const verdict = decideVerdict(claimed, { cursor: { at: "2026-11-18T08:00:00.000Z", seen: [] } });
  assert.equal(verdict.newlyDone, 0);
  const proven = base({ finished: { runs: [{ workId: "w9", plan: "plans/z.md" }], plans: [{ plan: "plans/y.md", progress: { done: 3, total: 3 } }] }, commits: [{ hash: "abc1234" }] });
  assert.equal(decideVerdict(proven, { cursor: { at: "2026-11-18T08:00:00.000Z", seen: ["commit:abc1234"] } }).newlyDone, 2);
});

test("canary: nothing to do appears only with full coverage", async () => {
  const { renderVerdict } = await import(VERDICT);
  assert.match(renderVerdict(base()).text, /지금 할 일 없음 — 확인한 기록 \d+개/u);
  for (const gap of [
    base({ coverage: { notRead: { budget: 1, limit: 0, unreadable: 0 } } }),
    base({ sources: { sessions: "unknown", gitState: "ok" } }),
    base({ sources: { sessions: "ok", gitState: "unknown" } }),
  ]) {
    const { text } = renderVerdict(gap);
    assert.doesNotMatch(text, /지금 할 일 없음/u);
    assert.match(text, /판단 보류/u);
    assert.match(text, /못 읽음: /u);
  }
});

test("canary: irreversible steps stay questions and never reach the input line", async () => {
  const { renderVerdict } = await import(VERDICT);
  const data = base({ gitState: [{ worktree: "~/w/main", uncommitted: 0, unpushed: 5 }], startWork: [{ status: "active", parked: 1, workId: "w3", plan: "plans/c.md", worktree: "~/w/main" }] });
  const { text } = renderVerdict(data);
  assert.doesNotMatch(text, /입력: `(?:git push|lit approve|lit deny)/u);
  assert.match(text, /네 확인 필요: c의 보류된 단계 1개 — lit approve 또는 lit deny\?/u);
  assert.match(text, /네 확인 필요: main의 커밋 5개를 push 할까\?/u);
});

test("canary: an action whose records moved is withdrawn, not repeated silently", async () => {
  const { renderVerdict, decideVerdict } = await import(VERDICT);
  const before = base({ gitState: [{ worktree: "~/w/main", uncommitted: 2, unpushed: 0 }] });
  const fp = decideVerdict(before).action.fp;
  const after = base({ gitState: [{ worktree: "~/w/main", uncommitted: 5, unpushed: 0 }] });
  const { text } = renderVerdict(after, { cursor: { at: "2026-11-18T08:30:00.000Z", seen: [], fp } });
  assert.match(text.split("\n")[0], new RegExp(`지난 할 일 #${fp} 철회 — 상태가 바뀜`, "u"));
  const same = renderVerdict(before, { cursor: { at: "2026-11-18T08:30:00.000Z", seen: [], fp } }).text;
  assert.doesNotMatch(same, /철회/u);
});

test("canary: `go` is offered only when the collector recorded the step", async () => {
  const { renderVerdict } = await import(VERDICT);
  const start = { next: { kind: "start-plan", target: { plan: "plans/a.md" }, command: "/start-work plans/a.md" } };
  assert.match(renderVerdict(base({ ...start, nextRecorded: true })).text, /입력: `go`/u);
  assert.match(renderVerdict(base({ ...start, nextRecorded: false })).text, /입력: `\/start-work plans\/a\.md`/u);
});

function hasSqlite3() {
  try {
    return spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

test("CLI --verdict prints the card and moves the per-user cursor outside the worktree", { skip: !hasSqlite3() && "sqlite3 not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-verdict-"));
  try {
    const ws = path.join(tmp, "repo");
    const home = path.join(tmp, "home");
    fs.mkdirSync(path.join(ws, "plans"), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: ws });
    fs.writeFileSync(path.join(ws, "plans", "only.md"), "# Only\n\n- [x] 1. First\n- [ ] 2. Second\n");
    const env = { PATH: process.env.PATH, HOME: home, HERMES_HOME: home, HERMES_SESSION_STORE: path.join(tmp, "none.db") };
    const run = (...args) => spawnSync(process.execPath, [CLI, "--verdict", ...args], { cwd: ws, encoding: "utf8", env });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^처음 봄 — 비교할 기준 없음\n/u);
    assert.match(first.stdout, /지금 할 일: /u);
    assert.match(first.stdout, /못 읽음: Hermes 세션 기록 없음/u);
    const cursors = fs.readdirSync(path.join(home, "lithermes", "adhd"));
    assert.equal(cursors.length, 1);
    assert.match(cursors[0], /^cursor-[0-9a-f]{16}\.json$/u);
    assert.equal(fs.existsSync(path.join(ws, ".hermes", "lithermes", "adhd", "cursor.json")), false);
    const second = run("--en");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /^Since \d\d:\d\d: /u);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
