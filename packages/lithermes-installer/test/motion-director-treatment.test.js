// Treatment validator (director wave): every film starts with treatment.json and
// the validator exits 16 naming the field before any render. The base case is a
// fictional tide-pool explainer; each test breaks exactly one rule.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const load = () => import(pathToFileURL(path.join(skillRoot, "engine", "treatment.mjs")).href);
const cli = path.join(skillRoot, "bin", "motion.mjs");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function base() {
  return {
    request: "바닷가 조수 웅덩이에 사는 생물을 아이들에게 소개하는 영상 만들어줘",
    genre: "explainer",
    path: "stage",
    pathReason: "the film has to show animals and water, not only words",
    idea: "썰물 뒤에 남은 작은 바다가 한 마리 소라게의 하루로 열린다.",
    audience: "초등학생과 보호자",
    channel: "과학관 로비 대형 화면",
    format: "16:9",
    formatReason: "a landscape lobby screen",
    durationSec: 20,
    beats: [
      { t0: 0, t1: 5, purpose: "질문을 던진다", onScreen: "물이 빠진 바위와 웅덩이", motion: "수면이 내려가며 웅덩이가 드러난다", sound: "잔잔한 패드에 첫 박" },
      { t0: 5, t1: 10, purpose: "첫 번째 생물", onScreen: "소라게가 껍데기를 고른다", motion: "껍데기 윤곽이 그려진 뒤 몸이 들어간다", sound: "컷에 맞춘 타격" },
      { t0: 10, t1: 15, purpose: "두 번째 생물", onScreen: "말미잘이 촉수를 오므린다", motion: "촉수 패스가 모프한다", sound: "상승음으로 전환" },
      { t0: 15, t1: 20, purpose: "정리", onScreen: "웅덩이 전체 단면도", motion: "카메라가 뒤로 빠진다", sound: "종지 화음" },
    ],
    subject: { name: "소라게 모래", source: "invented", specifics: ["껍데기를 세 번 바꿔 입은 소라게", "아이들이 붙인 이름표를 단 채 웅덩이 가장자리에 산다"] },
    visualDevices: [
      { kind: "illustration", role: "subject", beats: [0, 1, 2, 3] },
      { kind: "path", role: "support", beats: [1, 2] },
      { kind: "diagram", role: "support", beats: [3] },
      { kind: "gradient", role: "texture", beats: [0, 1, 2, 3] },
    ],
    typePlan: { faces: ["Pretendard"], hierarchy: "one headline, one caption", maxWordsOnScreen: 6 },
    palette: [
      { color: "#0f3b4c", role: "deep water" },
      { color: "#f2c14e", role: "shell highlight" },
      { color: "#f7f4ea", role: "caption type" },
    ],
    sound: { mode: "generated", plan: "slow pulse under a warm pad, hits on each cut", palette: "soft-mallet" },
    copy: { source: "invented", lines: ["썰물이 남긴 작은 바다", "소라게는 집을 바꿔 입는다", "말미잘은 손을 오므린다", "다음 썰물에 다시 만나요"] },
    inventions: ["소라게 모래 (invented subject)", "all four copy lines"],
    ambition: "Match cuts between shell outlines and a steady pulse should make the tide feel alive.",
  };
}

async function expectField(treatment, field, extra = {}) {
  const { validateTreatment } = await load();
  const result = validateTreatment(treatment, extra);
  assert.equal(result.ok, false, `expected ${field} to fail`);
  assert.equal(result.field, field, result.message);
  return result;
}

test("treatment: the base tide-pool treatment validates", async () => {
  const { validateTreatment } = await load();
  const result = validateTreatment(base());
  assert.equal(result.ok, true, result.message);
});

test("treatment: every missing field exits with its own name", async () => {
  for (const field of ["request", "genre", "path", "pathReason", "idea", "audience", "channel", "format", "durationSec", "beats", "subject", "visualDevices", "typePlan", "palette", "sound", "copy", "ambition"]) {
    const t = base();
    delete t[field];
    await expectField(t, field);
  }
  const t = base();
  delete t.inventions;
  await expectField(t, "inventions");
});

test("treatment: placeholder values are rejected", async () => {
  const t = base();
  t.audience = "<who watches>";
  await expectField(t, "audience");
  const u = base();
  u.beats[2].motion = "slides in, then <one easing>";
  await expectField(u, "beats[2].motion");
});

test("treatment: a treatment copied from the shipped example is copiedExample", async () => {
  const { shippedExamples } = await load();
  const [example] = shippedExamples();
  assert.ok(example, "references/treatment.md ships one placeholder example");
  const t = base();
  t.idea = example.idea;
  t.audience = example.audience;
  t.channel = example.channel;
  t.ambition = example.ambition;
  t.beats = t.beats.map((beat, i) => ({ ...beat, purpose: example.beats[i % example.beats.length].purpose, onScreen: example.beats[i % example.beats.length].onScreen, motion: example.beats[i % example.beats.length].motion, sound: example.beats[i % example.beats.length].sound }));
  await expectField(t, "copiedExample");
});

test("treatment: an idea or invented copy that restates the request fails", async () => {
  const t = base();
  t.idea = "조수 웅덩이에 사는 생물을 아이들에게 소개합니다.";
  await expectField(t, "idea");
  const u = base();
  u.copy.lines[1] = "조수 웅덩이에 사는 생물을 아이들에게";
  await expectField(u, "copy.lines[1]");
});

test("treatment: a user copy line must be found in the request", async () => {
  const t = base();
  t.request = '"물은 빠져도 바다는 남는다" 이 문장으로 영상 만들어줘';
  t.copy = { source: "user", lines: ["물은 빠져도 바다는 남는다", "소라게가 인사한다"] };
  await expectField(t, "copy.lines[1]");
});

test("treatment: the stage path needs a drawn subject device and two counting kinds", async () => {
  const t = base();
  t.visualDevices = t.visualDevices.map((d) => (d.role === "subject" ? { ...d, role: "support" } : d));
  await expectField(t, "visualDevices");
  const u = base();
  u.visualDevices = [{ kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }, { kind: "particles", role: "texture", beats: [0, 1] }];
  await expectField(u, "visualDevices");
  const w = base();
  w.visualDevices[0].beats = [0];
  await expectField(w, "visualDevices");
  const texture = base();
  texture.visualDevices.push({ kind: "grid", role: "subject", beats: [0, 1, 2, 3] });
  await expectField(texture, "visualDevices[4].role");
});

test("treatment: the type path needs user copy or a type-led cue, at 16:9 only", async () => {
  const t = base();
  t.path = "type";
  await expectField(t, "path");
  const u = base();
  u.request = '"물은 빠져도 바다는 남는다" 이 문장으로 세로 영상 만들어줘';
  u.path = "type";
  u.genre = "type-led";
  u.copy = { source: "user", lines: ["물은 빠져도 바다는 남는다"] };
  u.format = "9:16";
  u.beats = [{ t0: 0, t1: 20, purpose: "한 호흡", onScreen: "문장", motion: "어절 단위로 떠오른다", sound: "패드" }];
  u.visualDevices = [];
  await expectField(u, "path");
  u.format = "16:9";
  const { validateTreatment } = await load();
  assert.equal(validateTreatment(u).ok, true, validateTreatment(u).message);
});

test("treatment: too few beats for the genre and a beat under 1.2 s fail", async () => {
  const t = base();
  t.beats = t.beats.slice(0, 3);
  t.beats[2].t1 = 20;
  t.visualDevices = t.visualDevices.map((d) => ({ ...d, beats: d.beats.filter((b) => b < 3) }));
  await expectField(t, "beats");
  const u = base();
  u.beats[1].t1 = 5.8;
  u.beats[2].t0 = 5.8;
  await expectField(u, "beats[1]");
  const gap = base();
  gap.beats[2].t0 = 10.5;
  await expectField(gap, "beats[2]");
});

test("treatment: invented parts must list the subject name, and the genre floor holds", async () => {
  const t = base();
  t.inventions = ["all four copy lines"];
  await expectField(t, "inventions");
  const u = base();
  u.durationSec = 8;
  u.beats = u.beats.map((b, i) => ({ ...b, t0: i * 2, t1: i * 2 + 2 }));
  await expectField(u, "durationSec");
  u.request = "바닷가 조수 웅덩이 생물을 8초짜리 영상으로 만들어줘";
  u.idea = "작은 바다가 소라게의 하루로 열린다.";
  const { validateTreatment } = await load();
  assert.equal(validateTreatment(u).ok, true, validateTreatment(u).message);
});

test("treatment: sound none needs a silent request or a muted channel", async () => {
  const t = base();
  t.sound = { mode: "none", plan: "", palette: "" };
  await expectField(t, "sound.mode");
  t.channel = "지하철 역사 무음 사이니지";
  const { validateTreatment } = await load();
  assert.equal(validateTreatment(t).ok, true, validateTreatment(t).message);
});

test("CLI: a missing or invalid treatment exits 16 before any render and names the field", () => {
  const out = tmp("motion-treat-");
  const missing = spawnSync(process.execPath, [cli, "stage", "--out", out, "--stills-only"], { encoding: "utf8" });
  assert.equal(missing.status, 16, missing.stderr);
  assert.match(missing.stderr, /BLOCKED_TREATMENT_INVALID: field treatment/);
  const t = base();
  t.visualDevices = [{ kind: "gradient", role: "texture", beats: [0, 1, 2, 3] }];
  fs.writeFileSync(path.join(out, "treatment.json"), JSON.stringify(t));
  const bad = spawnSync(process.execPath, [cli, "stage", "--out", out, "--stills-only"], { encoding: "utf8" });
  assert.equal(bad.status, 16, bad.stderr);
  assert.match(bad.stderr, /BLOCKED_TREATMENT_INVALID: field visualDevices/);
  const typeRun = spawnSync(process.execPath, [cli, "run", "--out", out, "--stills-only"], { encoding: "utf8" });
  assert.equal(typeRun.status, 16, typeRun.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(out, "run-state.json"), "utf8"));
  assert.equal(state.exitCode, 16);
});
