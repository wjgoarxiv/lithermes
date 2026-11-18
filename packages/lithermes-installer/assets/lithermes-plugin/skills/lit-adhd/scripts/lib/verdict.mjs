// The lit-adhd verdict card: about six lines that answer "so what do I do now?" from the collected
// record alone. A versioned rule table picks ONE verdict, the first rule that holds; the model only
// prints the card it is given.
//
//   1 what changed since the user's last look   `18:02 이후: 2개 끝남, 1개가 너를 기다림`
//   2 the one action and where                 `지금 할 일: <where> 에서 <action> #<fp>`
//   3 the exact text to type                   `입력: \`go\``
//   4 why, and what not doing it costs         `이유: … · 안 하면: …`
//   5 what else waits, at most two             `다음 대기: …`
//   6 coverage                                 `읽음 6/7 세션 — 못 읽음: …`
//
// Inputs are evidence-gated. Proven done: a start-work or bounded-work run the collector read as
// finished, a plan with every row ticked, a commit. A Hermes session never reads `done` (nothing ties
// a finished run to the session that ran it), so a session's own words count for nothing here.
// Every action carries a fingerprint of the records it rests on and a precondition; when the next
// card's fingerprint differs, line 1 says the last action was withdrawn. A step that cannot be
// undone (a push, a parked tool call) is never the action, only `네 확인 필요: <question>`.
// `지금 할 일 없음` is printed only when every source was read. Pure: the CLI reads and writes the
// cursor file, never this module.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { clipToWidth } from './gauge.mjs';

export const VERDICT_RULES_VERSION = 'adhd-verdict.hermes.v1';
const TEXT_MAX = 64;

const LABELS = {
  ko: {
    since: (hhmm) => `${hhmm} 이후`,
    firstLook: '처음 봄 — 비교할 기준 없음',
    delta: (done, waiting) => `${done}개 끝남, ${waiting}개가 너를 기다림`,
    nothingChanged: '바뀐 것 없음',
    withdrawn: (fp) => `지난 할 일 #${fp} 철회 — 상태가 바뀜`,
    doNow: '지금 할 일',
    at: (where, action) => (where ? `${where} 에서 ${action}` : action),
    type: '입력',
    noType: (where) => `없음 — ${where ?? '그 세션'} 창에서 직접`,
    waitType: '없음 — 끝날 때까지 기다리기',
    why: '이유',
    ifNot: '안 하면',
    queue: '다음 대기',
    confirm: '네 확인 필요',
    read: (read, found) => `읽음 ${read}/${found} 세션`,
    missing: '못 읽음',
    nothing: (count) => `지금 할 일 없음 — 확인한 기록 ${count}개`,
    unknown: '판단 보류 — 못 읽은 기록이 있음',
    reasons: { budget: '읽기 예산 초과', limit: '최대 개수 초과', unreadable: '읽을 수 없음', sessions: 'Hermes 세션 기록 없음', git: 'git 상태' },
    actions: {
      resume: (plan) => `${plan} 실행을 새 세션에 넘기기`,
      answer: () => '기다리는 세션에 답하기',
      continue: (plan) => `${plan} 이어서 진행`,
      wait: (lanes) => `기다리기 — 다른 레인 ${lanes}개 작업 중`,
      startPlan: (plan) => `${plan} 실행 시작`,
      dirty: (count) => `바뀐 파일 ${count}개 확인`,
      planItem: (item) => `다음 항목: ${item}`,
    },
    why_: {
      resume: '세션이 끝나서 실행이 멈춤',
      answer: '그 세션이 네 답을 기다림',
      continue: '이 세션의 실행이 진행 중',
      wait: '다른 세션이 같은 저장소에서 일하는 중',
      startPlan: '열린 계획이 하나뿐이고 아무것도 안 돌고 있음',
      dirty: '커밋 안 된 변경이 있음',
      planItem: '계획에 체크 안 된 항목이 남음',
    },
    ifNot_: {
      resume: '실행이 멈춘 채 남음, 잃는 것 없음',
      answer: '그 세션이 계속 기다림',
      continue: '남은 항목이 그대로 남음',
      wait: '없음',
      startPlan: '계획이 그대로 남음',
      dirty: '변경이 커밋 안 된 채 남음',
      planItem: '계획이 그대로 남음',
    },
    push: (where, count) => `${where}의 커밋 ${count}개를 push 할까?`,
    parked: (plan, count) => `${plan}의 보류된 단계 ${count}개 — lit approve 또는 lit deny?`,
    stale: (name, days) => `${name} 계획이 ${days}일째 그대로 — 계속할지 닫을지`,
    waitingAt: (where) => `${where} 세션이 답을 기다림`,
    more: (n) => `(+${n})`,
  },
  en: {
    since: (hhmm) => `Since ${hhmm}`,
    firstLook: 'First look — no baseline yet',
    delta: (done, waiting) => `${done} finished, ${waiting} waiting on you`,
    nothingChanged: 'nothing changed',
    withdrawn: (fp) => `last action #${fp} withdrawn — the state moved`,
    doNow: 'Do now',
    at: (where, action) => (where ? `in ${where}: ${action}` : action),
    type: 'Type',
    noType: (where) => `nothing — answer in the ${where ?? 'waiting'} session's window`,
    waitType: 'nothing — wait for them to finish',
    why: 'Why',
    ifNot: 'If not',
    queue: 'Next waiting',
    confirm: 'Your call',
    read: (read, found) => `Read ${read}/${found} sessions`,
    missing: 'not read',
    nothing: (count) => `Nothing to do now — ${count} records checked`,
    unknown: 'No verdict — some records were not read',
    reasons: { budget: 'read budget spent', limit: 'over the session cap', unreadable: 'unreadable', sessions: 'no Hermes session records', git: 'git state' },
    actions: {
      resume: (plan) => `hand the ${plan} run to a new session`,
      answer: () => 'answer the waiting session',
      continue: (plan) => `continue ${plan}`,
      wait: (lanes) => `wait — ${lanes} other lane(s) at work`,
      startPlan: (plan) => `start ${plan}`,
      dirty: (count) => `review ${count} changed file(s)`,
      planItem: (item) => `next item: ${item}`,
    },
    why_: {
      resume: 'the run stopped when its session ended',
      answer: 'that session waits for your answer',
      continue: "this session's run is going",
      wait: 'another session works in this repository',
      startPlan: 'one open plan and nothing running',
      dirty: 'uncommitted changes',
      planItem: 'the plan has unticked rows',
    },
    ifNot_: {
      resume: 'the run stays stopped, nothing lost',
      answer: 'that session keeps waiting',
      continue: 'the open rows stay open',
      wait: 'nothing',
      startPlan: 'the plan stays as it is',
      dirty: 'the changes stay uncommitted',
      planItem: 'the plan stays as it is',
    },
    push: (where, count) => `push ${count} commit(s) in ${where}?`,
    parked: (plan, count) => `${count} parked step(s) in ${plan} — lit approve or lit deny?`,
    stale: (name, days) => `${name} untouched for ${days} days — keep or close?`,
    waitingAt: (where) => `the session in ${where} waits for an answer`,
    more: (n) => `(+${n})`,
  },
};

const placeOf = (worktree) => (worktree && worktree !== 'unknown' ? basename(String(worktree)) : null);
const short = (text) => clipToWidth(String(text ?? '').replace(/[`*_]/gu, '').replace(/\s+/gu, ' ').trim(), TEXT_MAX);
const planLabel = (path) => short(basename(String(path ?? 'plan')).replace(/\.md$/u, '').replace(/^\d{4}-\d{2}-\d{2}-/u, ''));
export const fingerprint = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 6);

/** Proven finished items, each with a stable id. A session's own claim is never one. */
export const provenDone = (data) => [
  ...(data.finished?.runs ?? []).map((run) => `run:${run.workId ?? run.plan}`),
  ...(data.finished?.plans ?? [])
    .filter((plan) => plan.progress?.total > 0 && plan.progress.done === plan.progress.total)
    .map((plan) => `plan:${plan.plan}`),
  ...(data.commits ?? []).map((commit) => `commit:${commit.hash}`),
];

const waitingSessions = (data) => (data.sessions ?? []).filter((session) => !session.self && session.status === 'waiting-on-user' && session.waitingReason !== 'bounded-work boundary');

/** Which records could not be read. `found` counts the sessions skipped, so `read < found` is a gap. */
export const coverageOf = (data) => {
  const notRead = data.coverage?.notRead ?? {};
  const missing = [];
  for (const reason of ['budget', 'limit', 'unreadable']) if (notRead[reason] > 0) missing.push({ reason, count: notRead[reason] });
  if (data.sources?.sessions !== 'ok') missing.push({ reason: 'sessions', count: null });
  if (data.sources?.gitState && data.sources.gitState !== 'ok') missing.push({ reason: 'git', count: null });
  const read = (data.sessions ?? []).length;
  const skipped = missing.reduce((sum, item) => sum + (item.count ?? 0), 0);
  return { read, found: read + skipped, missing, full: missing.length === 0 };
};

const resumeLine = (work) => {
  const revision = Number.isInteger(work.revision) ? work.revision : 'N';
  const boundary = work.pendingBoundary?.boundary && work.pendingBoundary.boundary !== 'unknown' ? work.pendingBoundary.boundary : 'ID';
  const root = work.worktree && work.worktree !== 'unknown' ? work.worktree : '<root>';
  return `/lit-loop resume ${work.workId} --revision ${revision} --boundary ${boundary} --grant continue-session@${root}`;
};

/**
 * The rule table, first match wins. Each rule returns null or
 * `{ code, kind, where, arg, type, fp, pre }`. A change of order or meaning bumps VERDICT_RULES_VERSION.
 */
export const RULES = Object.freeze([
  ['resume-ended-run', (data) => {
    const work = (data.startWork ?? []).find((item) => item.status === 'paused' && item.pendingBoundary);
    return work ? { code: 'NEEDS_YOU', kind: 'resume', where: placeOf(work.worktree), arg: planLabel(work.plan), type: resumeLine(work), fp: fingerprint(['resume', work.workId, work.pendingBoundary]), pre: 'the run is paused at a continue-session boundary' } : null;
  }],
  ['answer-session', (data) => {
    const session = waitingSessions(data)[0];
    return session ? { code: 'NEEDS_YOU', kind: 'answer', where: placeOf(session.worktree) ?? session.id8, arg: null, type: null, fp: fingerprint(['answer', session.id8, session.last]), pre: "that session's last turn is the user's open question" } : null;
  }],
  ['continue-own-work', (data) => (data.next?.kind === 'continue-work' ? { code: 'ONE_ACTION', kind: 'continue', where: null, arg: planLabel(data.next.target?.plan), type: data.nextRecorded ? 'go' : null, fp: fingerprint(['continue', data.next.target]), pre: "this session's run is active" } : null)],
  ['other-lanes-at-work', (data) => (data.next?.kind === 'wait-lanes' ? { code: 'WAIT', kind: 'wait', where: null, arg: data.next.target?.lanes ?? data.lanes?.count ?? 1, type: null, fp: fingerprint(['wait', data.next.target?.lanes ?? null]), pre: 'another lane is at work here' } : null)],
  ['start-single-plan', (data) => (data.next?.kind === 'start-plan' ? { code: 'ONE_ACTION', kind: 'startPlan', where: null, arg: planLabel(data.next.target?.plan), type: data.nextRecorded ? 'go' : data.next.command ?? `/start-work ${data.next.target?.plan}`, fp: fingerprint(['start', data.next.target]), pre: 'one open plan, nothing running' } : null)],
  ['uncommitted-work', (data) => {
    const tree = (data.gitState ?? []).find((item) => item.uncommitted > 0);
    return tree ? { code: 'ONE_ACTION', kind: 'dirty', where: placeOf(tree.worktree), arg: tree.uncommitted, type: 'git status', fp: fingerprint(['dirty', tree.worktree, tree.uncommitted]), pre: 'the worktree has uncommitted changes' } : null;
  }],
  ['next-plan-row', (data) => {
    const plans = data.roadmap?.plans ?? [];
    const plan = plans.find((item) => item.local && item.current) ?? plans.find((item) => item.current);
    return plan ? { code: 'ONE_ACTION', kind: 'planItem', where: plan.local ? null : placeOf(plan.worktree), arg: short(plan.current), type: plan.local ? `/start-work ${plan.plan}` : null, fp: fingerprint(['row', plan.plan, plan.current]), pre: 'that row is still unticked' } : null;
  }],
]);

const queueOf = (data, chosen, labels) => {
  const items = [];
  for (const session of waitingSessions(data)) {
    if (chosen?.kind === 'answer' && chosen.fp === fingerprint(['answer', session.id8, session.last])) continue;
    items.push(labels.waitingAt(placeOf(session.worktree) ?? session.id8));
  }
  for (const work of data.startWork ?? []) if (work.parked > 0) items.push(`${labels.confirm}: ${labels.parked(planLabel(work.plan), work.parked)}`);
  for (const tree of data.gitState ?? []) if (tree.unpushed > 0) items.push(`${labels.confirm}: ${labels.push(placeOf(tree.worktree) ?? 'here', tree.unpushed)}`);
  for (const plan of [...(data.stalePlans ?? [])].sort((a, b) => b.days - a.days)) items.push(labels.stale(planLabel(plan.plan), plan.days));
  return items;
};

/** The structured verdict: what changed, the one action (or nothing, or no verdict), coverage. */
export const decideVerdict = (data, { cursor = null } = {}) => {
  const done = provenDone(data);
  const since = cursor && Number.isFinite(Date.parse(cursor.at)) ? Date.parse(cursor.at) : null;
  const seen = new Set(Array.isArray(cursor?.seen) ? cursor.seen : []);
  const newlyDone = since === null ? null : done.filter((id) => !seen.has(id)).length;
  const waiting = waitingSessions(data).length + (data.startWork ?? []).filter((item) => item.status === 'paused').length;
  let action = null;
  let rule = null;
  for (const [name, test] of RULES) {
    action = test(data);
    if (action) {
      rule = name;
      break;
    }
  }
  const coverage = coverageOf(data);
  const code = action?.code ?? (coverage.full ? 'ALL_CLEAR' : 'UNKNOWN');
  const checked = done.length + (data.sessions ?? []).length + (data.roadmap?.plans ?? []).length + (data.gitState ?? []).length;
  return { version: VERDICT_RULES_VERSION, code, rule, action, since, newlyDone, waiting, coverage, checked, done };
};

const hhmm = (ms) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** The card as text lines. `lang` is ko (default) or en. */
export const renderVerdict = (data, { lang = 'ko', cursor = null } = {}) => {
  const labels = LABELS[lang] ?? LABELS.ko;
  const verdict = decideVerdict(data, { cursor });
  const { action } = verdict;
  const lines = [];
  if (verdict.since === null) {
    lines.push(labels.firstLook);
  } else {
    const moved = verdict.newlyDone === 0 && verdict.waiting === 0 ? labels.nothingChanged : labels.delta(verdict.newlyDone, verdict.waiting);
    const withdrawn = typeof cursor?.fp === 'string' && /^[0-9a-f]{6}$/u.test(cursor.fp) && cursor.fp !== (action?.fp ?? null) ? ` · ${labels.withdrawn(cursor.fp)}` : '';
    lines.push(`${labels.since(hhmm(verdict.since))}: ${moved}${withdrawn}`);
  }
  if (action) {
    lines.push(`${labels.doNow}: ${labels.at(action.where, labels.actions[action.kind](action.arg))} #${action.fp}`);
    lines.push(`${labels.type}: ${action.type ? `\`${action.type}\`` : action.kind === 'wait' ? labels.waitType : labels.noType(action.where)}`);
    lines.push(`${labels.why}: ${labels.why_[action.kind]} · ${labels.ifNot}: ${labels.ifNot_[action.kind]}`);
  } else {
    lines.push(verdict.code === 'ALL_CLEAR' ? labels.nothing(verdict.checked) : labels.unknown);
  }
  const queue = queueOf(data, action, labels);
  if (queue.length) lines.push(`${labels.queue}: ${queue.slice(0, 2).join(' · ')}${queue.length > 2 ? ` ${labels.more(queue.length - 2)}` : ''}`);
  const { read, found, missing } = verdict.coverage;
  const gaps = missing.map((item) => `${labels.reasons[item.reason]}${item.count ? ` ${item.count}` : ''}`).join(', ');
  lines.push(`${labels.read(read, found)}${missing.length ? ` — ${labels.missing}: ${gaps}` : ''}`);
  return { text: `${lines.join('\n')}\n`, verdict };
};

/** The next cursor: when the user looked, which proven items they have now seen, and the action shown. */
export const nextCursor = (verdict, now) => ({ version: 1, rules: VERDICT_RULES_VERSION, at: new Date(now).toISOString(), seen: verdict.done.slice(0, 500), fp: verdict.action?.fp ?? null });
