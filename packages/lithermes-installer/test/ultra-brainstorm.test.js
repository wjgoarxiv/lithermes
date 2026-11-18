// ultra-brainstorm: the launch question's cost line comes from estimate.mjs, which reads the
// Hermes delegation settings (the only place a child's model can be chosen) and sizes the run:
// batches of delegation.max_concurrent_children, one reducer per 30 children, one judge.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const SKILL = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "ultra-brainstorm");
const ESTIMATE = "../assets/lithermes-plugin/skills/ultra-brainstorm/scripts/estimate.mjs";

test("the estimate sizes batches, reducers and the judge from the delegation settings", async () => {
  const { estimate, delegationSettings, costLine } = await import(ESTIMATE);
  const cheap = delegationSettings("delegation:\n  model: small-1\n  reasoning_effort: low\n  max_concurrent_children: 25\n");
  assert.deepEqual(
    { ...estimate(100, cheap), tokens: undefined },
    { children: 100, reducers: 4, judges: 1, batches: 4, perBatch: 25, model: "small-1", effort: "low", tokens: undefined },
  );
  assert.equal(estimate(300).reducers, 10);
  assert.equal(estimate(300).batches, 30, "default concurrency is 10 children per call");
  assert.match(costLine(100, cheap), /^100 idea children on delegation\.model small-1, effort low, in 4 batches of 25 \+ 4 reducer children \+ 1 judge \(this session\) ≈ [\d.]+M–[\d.]+M tokens$/u);
  assert.match(costLine(100, delegationSettings("")), /session model \(delegation\.model is empty\)/u);
});

test("the CLI prints one cost line and refuses counts it cannot run", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-ultra-"));
  try {
    const config = path.join(tmp, "config.yaml");
    fs.writeFileSync(config, "delegation:\n  model: small-1\n  reasoning_effort: low\n");
    const run = (...args) => spawnSync(process.execPath, [path.join(SKILL, "scripts", "estimate.mjs"), ...args, "--config", config], { encoding: "utf8" });
    const ok = run("300");
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim().split("\n").length, 1);
    assert.match(ok.stdout, /^300 idea children on delegation\.model small-1/u);
    for (const bad of ["0", "abc", "100000"]) assert.notEqual(run(bad).status, 0, bad);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the skill asks one launch question with the cost line and keeps idea children cheap and tool-free", () => {
  const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  assert.match(text, /^---\nname: ultra-brainstorm\n/u);
  assert.match(text, /\ngoal: never\n/u);
  assert.match(text, /\*\*100\*\* \(recommended minimum\), \*\*300\*\*, or a number/u);
  assert.match(text, /hermes config set delegation\.model/u);
  assert.match(text, /at most five ideas/iu);
  assert.match(text, /\.hermes\/lithermes\/brainstorm\/<slug>\//u);
  assert.match(text, /ultra-result\.json/u);
  for (const ref of ["references/lenses.md", "references/fan-out.md", "scripts/estimate.mjs"]) {
    assert.ok(text.includes(ref), ref);
    assert.ok(fs.existsSync(path.join(SKILL, ref)), ref);
  }
});

test("the cost line is a calibrated range: each child pays Hermes' whole first-call prompt", async () => {
  const { estimate, costLine, IDEA_TOKENS, REDUCER_TOKENS, JUDGE_TOKENS, SESSION_PER_BATCH } = await import(ESTIMATE);
  const run = estimate(100);
  assert.deepEqual(run.tokens, {
    low: 100 * IDEA_TOKENS.low + 4 * REDUCER_TOKENS.low + JUDGE_TOKENS.low + 10 * SESSION_PER_BATCH.low,
    high: 100 * IDEA_TOKENS.high + 4 * REDUCER_TOKENS.high + JUDGE_TOKENS.high + 10 * SESSION_PER_BATCH.high,
  });
  assert.ok(IDEA_TOKENS.low >= 20_000, "a child's first call carries ~20k of system prompt and tool schemas");
  // Live run, 30 children in 3 batches: the session itself used ~1.58M, about 0.53M per batch.
  const live = estimate(30);
  assert.equal(live.batches, 3);
  assert.ok(live.tokens.low <= 1_580_000 + 30 * 20_324 && 1_580_000 <= live.tokens.high, "the measured run sits inside the range");
  assert.match(costLine(100), / ≈ 5\.8M–8\.6M tokens$/u);
  assert.match(fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8"), /≈ 5\.8M–8\.6M tokens/u);
});

const ANSWER = path.join(SKILL, "scripts", "launch-answer.mjs");
const answer = (reply, { args = [], cwd } = {}) =>
  spawnSync(process.execPath, [ANSWER, ...args], { encoding: "utf8", input: reply, cwd });

test("the launch reply is read from stdin: labels, a plain no and ambiguous replies", () => {
  const cases = [
    ["100", { answer: "launch", children: 100 }],
    ["(Recommended) 100 (recommended minimum)", { answer: "launch", children: 100 }],
    ["100 (recommended minimum)", { answer: "launch", children: 100 }],
    ["300명 (Recommended)", { answer: "launch", children: 300 }],
    ["1,000", { answer: "ask", reason: "the count must be 1 to 900" }],
    ["100 or 300?", { answer: "ask", reason: "the reply is a question" }],
    ["100 or 300", { answer: "ask", reason: "the reply names more than one count" }],
    ["no", { answer: "stop" }],
    ["No.", { answer: "stop" }],
    ["아니요", { answer: "stop" }],
    ["sure", { answer: "ask", reason: "the reply names no count" }],
    ["", { answer: "ask", reason: "no reply" }],
  ];
  for (const [reply, expected] of cases) {
    const out = answer(reply);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), expected, reply);
  }
});

test("the parser refuses any argument, so a reply never rides on a command line", () => {
  for (const args of [["--answer", "100"], ["100"], ["--answer=100"]]) {
    const out = answer("", { args });
    assert.equal(out.status, 64, args.join(" "));
    assert.equal(out.stdout, "");
  }
});

test("a reply with $(...) and backticks stays data through the quoted heredoc", () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-reply-")));
  try {
    const reply = "100 $(touch pwned-a) `touch pwned-b`";
    const script = `node ${JSON.stringify(ANSWER)} <<'LIT_REPLY_END_9Q7'\n${reply}\nLIT_REPLY_END_9Q7\n`;
    const out = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8", cwd: tmp });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { answer: "launch", children: 100 });
    assert.deepEqual(fs.readdirSync(tmp), [], "nothing in the reply ran");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("the skill carries the heredoc form and the delimiter rule", () => {
  const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  assert.ok(text.includes("node <skill-root>/scripts/launch-answer.mjs <<'LIT_REPLY_END_9Q7'"));
  assert.match(text, /if any of its lines is exactly `LIT_REPLY_END_9Q7`, do not run\s+the command and treat the reply as `ask`/u);
  assert.match(text, /`\{"answer":"stop"\}`[^\n]*\n[^\n]*end the skill\. Do not ask again\./u);
  assert.doesNotMatch(text, /--answer/u);
});
