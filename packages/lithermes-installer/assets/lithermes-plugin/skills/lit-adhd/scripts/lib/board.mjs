// The lit-adhd KPI board: the default face of a brief. Code draws all of it (the four buckets,
// the counts, the ten-cell bars, the percentages, the milestone rows, the capped lists and the
// action-shaped reminders) so the model shows it as given and never counts anything itself.
//
// The board reads only the collected data object; it never opens a file. Every label exists in
// Korean and English. Internal ids, commit hashes, raw status codes and file slugs stay off it;
// the one path it may print is the command the user types (`/start-work plans/<f>.md`).
import { basename } from 'node:path';

import { clipToWidth } from './gauge.mjs';
import { suggestNext } from './next-step.mjs';

const BAR_CELLS = 10;
const MILESTONE_ROWS = 4;
const DONE_ITEMS = 5;
const REMAINING_ITEMS = 7;
const REMINDERS = 5;
const NAME_COLS = 40;
const ITEM_COLS = 80;

const LABELS = {
  en: {
    now: '🎯 Do this now', glance: '📊 At a glance', milestones: '🏁 Milestones', done: '✅ Done lately', left: '⬜ Still to do', remember: "🔔 Don't forget",
    buckets: { done: '✅ Done', inProgress: '🔄 In progress', waiting: '⏳ Waiting on you', remaining: '⬜ Left' },
    milestoneHead: '| Milestone | Status | Progress | Last change |',
    overall: 'Overall', nothingToCount: 'Nothing to count yet', type: '👉 Type:',
    noMilestones: 'No plans or goals in this window', noDone: 'Nothing finished in this window', noLeft: 'Nothing left', noReminders: 'Nothing to remember right now',
    more: (n) => `…and ${n} more`, stepsUnknown: 'steps not recorded', unknownTime: '—',
    justNow: 'just now', minutes: (n) => `${n}m ago`, hours: (n) => `${n}h ago`, days: (n) => `${n}d ago`, today: (t) => `today ${t}`,
    runFinished: (name) => `${name}: start-work finished`,
  },
  ko: {
    now: '🎯 지금 할 일', glance: '📊 한눈에 보기', milestones: '🏁 마일스톤', done: '✅ 최근 끝낸 일', left: '⬜ 남은 일', remember: '🔔 잊지 말 것',
    buckets: { done: '✅ 끝남', inProgress: '🔄 진행 중', waiting: '⏳ 나를 기다림', remaining: '⬜ 남음' },
    milestoneHead: '| 마일스톤 | 상태 | 진행 | 최근 |',
    overall: '전체 진행', nothingToCount: '아직 셀 일이 없어요', type: '👉 입력:',
    noMilestones: '이 기간에 계획이나 목표가 없어요', noDone: '이 기간에 끝낸 일이 없어요', noLeft: '남은 일이 없어요', noReminders: '지금 챙길 것이 없어요',
    more: (n) => `…외 ${n}개`, stepsUnknown: '단계 기록 없음', unknownTime: '—',
    justNow: '방금', minutes: (n) => `${n}분 전`, hours: (n) => `${n}시간 전`, days: (n) => `${n}일 전`, today: (t) => `오늘 ${t}`,
    runFinished: (name) => `${name}: 실행 끝남`,
  },
};

const known = (value) => Number.isInteger(value) && value >= 0;
const plain = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim();
const cell = (text, cols = NAME_COLS) => clipToWidth(plain(text), cols).replace(/\|/gu, '\\|');
// A plan row reads as a sentence: its `1.` / `F2.` / `3.1)` numbering is dropped.
const sentence = (text) => clipToWidth(plain(text).replace(/^[A-Za-z]{0,2}\d+(?:\.\d+)*[.)]\s+/u, ''), ITEM_COLS);
const planInWorktree = (worktree, plan) => (typeof plan === 'string' && typeof worktree === 'string' && plan.startsWith(`${worktree}/`) ? plan.slice(worktree.length + 1) : plan);
// A plan without a `# ` heading is named from its file: no date prefix, no dashes, no `.md`.
export const planName = (plan, title) => {
  if (title && plain(title)) return plain(title);
  const stem = basename(String(plan ?? 'plan')).replace(/\.md$/u, '').replace(/^\d{4}-\d{2}-\d{2}-/u, '').replace(/[-_]+/gu, ' ').trim();
  return stem ? stem[0].toUpperCase() + stem.slice(1) : 'Plan';
};

/** Ten cells of `█` and `░`: full only when every item is done, empty only when none is. */
export const bar = (done, total) => {
  if (!known(total) || total === 0) return null;
  const k = Math.min(known(done) ? done : 0, total);
  let filled = Math.round((k * BAR_CELLS) / total);
  if (k > 0 && filled === 0) filled = 1;
  if (k < total && filled === BAR_CELLS) filled = BAR_CELLS - 1;
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
};
// The percentage follows the bar's rule: 100% only when finished, 0% only when nothing is done.
const percent = (done, total) => {
  const p = Math.round((100 * done) / total);
  return done > 0 && done < total ? Math.min(99, Math.max(1, p)) : p;
};
const barText = (done, total, labels) => (bar(done, total) ? `${bar(done, total)} ${done}/${total} (${percent(done, total)}%)` : labels.stepsUnknown);

const ageText = (ms, nowMs, labels) => {
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return labels.unknownTime;
  const minutes = Math.max(0, Math.floor((nowMs - ms) / 60_000));
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return labels.minutes(minutes);
  const then = new Date(ms);
  if (then.toDateString() === new Date(nowMs).toDateString()) {
    return labels.today(`${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`);
  }
  if (minutes < 24 * 60) return labels.hours(Math.floor(minutes / 60));
  return labels.days(Math.floor(minutes / (24 * 60)));
};

const goalDone = (goal) => ['complete', 'completed', 'achieved', 'done', 'passed'].includes(goal.status)
  || (known(goal.progress?.total) && goal.progress.total > 0 && goal.progress.done >= goal.progress.total);

/**
 * Milestones: open and recently finished plans, litgoal goals, and runs whose plan is not one of
 * those plans. Each lands in exactly one bucket; the current plan row of a milestone in progress
 * (or waiting) is that bucket's item, the rest of its open rows are left.
 */
const milestonesOf = (data) => {
  const works = (data.startWork ?? []).filter((work) => ['active', 'paused'].includes(work.status));
  const workOn = (plan) => works.filter((work) => work.worktree === plan.worktree && planInWorktree(work.worktree, work.plan) === plan.plan);
  const plans = [
    ...(data.roadmap?.plans ?? []).map((plan) => ({ ...plan, complete: false })),
    ...(data.finished?.plans ?? []).map((plan) => ({ ...plan, complete: true })),
  ];
  const seen = new Set();
  const list = [];
  for (const plan of plans) {
    const key = `${plan.worktree}\n${plan.plan}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const done = plan.progress?.done ?? null;
    const total = plan.progress?.total ?? null;
    const on = workOn(plan);
    const bucket = plan.complete || (known(total) && total > 0 && done >= total)
      ? 'done'
      : on.some((work) => work.status === 'paused' && work.pendingBoundary)
        ? 'waiting'
        : on.some((work) => work.status === 'active') || (known(done) && done > 0)
          ? 'inProgress'
          : 'remaining';
    const rows = Array.isArray(plan.rows) ? plan.rows : [];
    list.push({
      kind: 'plan', plan: plan.plan, worktree: plan.worktree, local: Boolean(plan.local), running: on.length > 0,
      name: `${planName(plan.plan, plan.title)}${plan.local === false && plan.worktree ? ` (${basename(String(plan.worktree))})` : ''}`,
      bucket, done, total, changedMs: plan.changedMs ?? null,
      doneRows: rows.filter((row) => row.checked).map((row) => sentence(row.title)),
      openRows: rows.filter((row) => !row.checked).map((row) => sentence(row.title)),
    });
  }
  for (const goal of data.roadmap?.litgoal ?? []) {
    const done = goal.progress?.done ?? null;
    const total = goal.progress?.total ?? null;
    list.push({
      kind: 'goal', name: plain(goal.objective), local: Boolean(goal.local), running: false,
      bucket: goalDone(goal) ? 'done' : known(done) && done > 0 ? 'inProgress' : 'remaining',
      done, total, changedMs: goal.changedMs ?? null, doneRows: [],
      openRows: (goal.remainingText ?? []).map((text) => sentence(text)),
    });
  }
  for (const work of works) {
    const plan = planInWorktree(work.worktree, work.plan);
    if (list.some((item) => item.kind === 'plan' && item.worktree === work.worktree && item.plan === plan)) continue;
    list.push({
      kind: 'run', plan, worktree: work.worktree, local: true, running: true,
      name: planName(plan === 'unknown' ? 'start-work run' : plan, null),
      bucket: work.status === 'paused' && work.pendingBoundary ? 'waiting' : 'inProgress',
      done: work.progress?.done ?? null, total: work.progress?.total ?? null, changedMs: null,
      doneRows: [], openRows: (work.progress?.remaining ?? []).filter((name) => name !== 'unknown').map((name) => sentence(name)),
    });
  }
  // Live work first (waiting, then in progress), then work not started, then finished; newest first inside each.
  const rank = { waiting: 0, inProgress: 1, remaining: 2, done: 3 };
  return list.sort((a, b) => rank[a.bucket] - rank[b.bucket] || Number(b.running) - Number(a.running) || Number(b.local) - Number(a.local) || (b.changedMs ?? 0) - (a.changedMs ?? 0));
};

const otherSessions = (data) => (data.sessions ?? []).filter((session) => !session.self);
const sessionGoal = (session) => clipToWidth(plain(session.title && session.title !== 'unknown' ? session.title : (session.asked ?? [])[0] ?? 'a session'), NAME_COLS);
const questionOf = (session) => {
  const text = (session.asked ?? []).filter((item) => item && item !== 'unknown').at(-1);
  return text ? clipToWidth(plain(text), 70) : null;
};

/** The four bucket counts: one item per milestone row and per live thing waiting or working. */
const countsOf = (milestones, data) => {
  const counts = { done: 0, inProgress: 0, waiting: 0, remaining: 0 };
  for (const item of milestones) {
    if (known(item.done)) counts.done += item.done;
    const open = known(item.total) && known(item.done) ? Math.max(0, item.total - item.done) : null;
    if (item.bucket === 'waiting' || item.bucket === 'inProgress') {
      counts[item.bucket] += 1;
      if (open !== null) counts.remaining += Math.max(0, open - 1);
    } else if (item.bucket === 'remaining' && open !== null) {
      counts.remaining += open;
    }
  }
  const workIds = new Set((data.startWork ?? []).filter((work) => ['active', 'paused'].includes(work.status)).map((work) => work.id8));
  for (const session of otherSessions(data)) {
    if (workIds.has(session.id8) && session.id8 !== 'unknown') continue;
    if (session.status === 'waiting-on-user') counts.waiting += 1;
    else if (session.status === 'active') counts.inProgress += 1;
  }
  counts.inProgress += (data.lanes?.agents ?? []).length;
  counts.total = counts.done + counts.inProgress + counts.waiting + counts.remaining;
  return counts;
};

const workingLanes = (data) => {
  const waitingIds = new Set(otherSessions(data).filter((session) => session.status === 'waiting-on-user').map((session) => session.id8));
  return Math.max(0, (data.lanes?.count ?? 0) - (data.lanes?.sessions ?? []).filter((id) => waitingIds.has(id)).length);
};

const T = {
  en: {
    answer: 'Answer the session that is waiting on you', asked: (goal) => `"${goal}" asked you a question`, question: (q) => `Question: "${q}"`,
    answerType: "answer it in that session's chat", noGoYet: '; do not type `go` yet',
    waitLanes: 'Wait for the other lanes to finish', lanesWorking: (n) => `${n} lane${n === 1 ? ' is' : 's are'} still working in this repo`, waitType: (n) => `wait until ${n === 1 ? 'that lane finishes' : `those ${n} lanes finish`}`,
    approve: 'Decide whether the paused run may go on', approveWhy: (name) => `"${name}" is waiting for you to approve its next step`, approveStep: (b) => `Waiting before: ${b}`, approveType: 'reply in chat: approve, or deny',
    continueRun: (name) => `Keep going with "${name}"`, continueWhy: (p) => `this session's run is under way${p ? ` (${p})` : ''}`, continueType: 'say "keep going" in chat',
    startPlan: (name) => `Start the plan "${name}"`, startWhy: (open) => `it is the one open plan here, ${open} step${open === 1 ? '' : 's'} left`, nextStep: (s) => `Next step: ${s}`,
    planNext: (name) => `Take the next step of "${name}"`, planWhy: (open) => `${open} step${open === 1 ? '' : 's'} left in this plan`,
    handoff: 'Pick up the next item from HANDOFF.md', handoffWhy: 'the last handoff left it as the next thing to do', handoffItem: (s) => `Item: ${s}`, handoffType: 'ask for it in chat',
    checkActive: (goal) => `Check on "${goal}"`, checkWhy: 'that session is still working', checkType: "open that session's chat",
    pickUp: (goal) => `Pick up "${goal}"`, pickWhy: 'it is the most recent session that stopped', pickType: "continue in that session's chat",
    empty: 'Say what to start', emptyWhy: 'no session or plan was found in this window', emptyType: 'describe the next task in chat',
    or: (cmd) => ` (or ${cmd})`,
    rWaiting: (goal) => `⏳ "${goal}" is waiting for your answer → answer in that session`,
    rBoundary: (name) => `⏳ "${name}" waits for your approval → reply in chat: approve, or deny`,
    rUncommitted: (n, wt) => `💾 ${n} uncommitted change${n === 1 ? '' : 's'} (${wt}) → review, then commit or discard`,
    rUnpushed: (n, wt) => `📤 ${n} unpushed commit${n === 1 ? '' : 's'} (${wt}) → decide whether to push`,
    rLanes: (n) => `🏃 ${n} lane${n === 1 ? '' : 's'} still working → do not type \`go\` until they finish`,
    rStale: (days, name, more) => `🕰️ Plan untouched for ${days} days: ${name}${more ? ` (+${more} more)` : ''} → decide whether to resume it or drop it`,
    rHandoff: (item) => `📌 HANDOFF next: ${item} → decide whether to pick it up`,
  },
  ko: {
    answer: '나를 기다리는 세션에 답하기', asked: (goal) => `"${goal}" 세션이 질문했어요`, question: (q) => `질문: "${q}"`,
    answerType: '그 세션 창에서 답하기', noGoYet: '. 아직 `go`는 치지 않기',
    waitLanes: '다른 레인이 끝날 때까지 기다리기', lanesWorking: (n) => `이 저장소에서 레인 ${n}개가 아직 일하고 있어요`, waitType: (n) => `기다리기: 레인 ${n}개가 끝날 때까지`,
    approve: '멈춘 실행을 이어 갈지 정하기', approveWhy: (name) => `"${name}" 실행이 다음 단계 승인을 기다려요`, approveStep: (b) => `멈춘 지점: ${b}`, approveType: '채팅으로 승인 또는 거절이라고 답하기',
    continueRun: (name) => `"${name}" 이어서 하기`, continueWhy: (p) => `이 세션의 실행이 진행 중이에요${p ? ` (${p})` : ''}`, continueType: '채팅에 "계속"이라고 말하기',
    startPlan: (name) => `"${name}" 계획 시작하기`, startWhy: (open) => `여기서 열린 계획은 이것 하나예요. ${open}단계 남음`, nextStep: (s) => `다음 단계: ${s}`,
    planNext: (name) => `"${name}"의 다음 단계 하기`, planWhy: (open) => `이 계획에 ${open}단계 남음`,
    handoff: 'HANDOFF.md의 다음 일 이어 하기', handoffWhy: '지난 인계가 다음 할 일로 남겨 둔 일이에요', handoffItem: (s) => `할 일: ${s}`, handoffType: '채팅으로 이 일을 요청하기',
    checkActive: (goal) => `"${goal}" 확인하기`, checkWhy: '그 세션이 아직 일하고 있어요', checkType: '그 세션 창 열기',
    pickUp: (goal) => `"${goal}" 이어 하기`, pickWhy: '가장 최근에 멈춘 세션이에요', pickType: '그 세션 창에서 이어 가기',
    empty: '무엇을 시작할지 말하기', emptyWhy: '이 기간에 세션도 계획도 없어요', emptyType: '다음 할 일을 채팅으로 말하기',
    or: (cmd) => ` (또는 ${cmd})`,
    rWaiting: (goal) => `⏳ "${goal}" 세션이 답을 기다려요 → 그 세션 창에서 답하기`,
    rBoundary: (name) => `⏳ "${name}" 실행이 승인을 기다려요 → 채팅으로 승인 또는 거절 답하기`,
    rUncommitted: (n, wt) => `💾 커밋 안 된 변경 ${n}개 (${wt}) → 확인하고 커밋하거나 되돌리기`,
    rUnpushed: (n, wt) => `📤 push 안 된 커밋 ${n}개 (${wt}) → push할지 정하기`,
    rLanes: (n) => `🏃 아직 일하는 레인 ${n}개 → 끝날 때까지 \`go\` 치지 않기`,
    rStale: (days, name, more) => `🕰️ ${days}일째 멈춘 계획: ${name}${more ? ` (외 ${more}개)` : ''} → 이어 할지, 접을지 정하기`,
    rHandoff: (item) => `📌 HANDOFF 다음 할 일: ${item} → 이어 할지 정하기`,
  },
};

const milestoneNamed = (milestones, worktree, plan) =>
  milestones.find((item) => item.plan && item.plan === planInWorktree(worktree, plan) && (!worktree || item.worktree === worktree))
  ?? milestones.find((item) => item.plan && item.plan === planInWorktree(worktree, plan));
const code = (text) => `\`${text}\``;

/**
 * "Do this now": the same step the brief's box names (chooseNextStep, then suggestNext), in plain
 * words. `go` is offered only for a step the collector recorded for this session, and never for an
 * approval, which stays the user's answer in words.
 */
const nowOf = (data, milestones, lang) => {
  const t = T[lang];
  const next = data.next ?? { kind: 'none' };
  const goOr = (command) => (data.nextRecorded ? `${code('go')}${command ? t.or(code(command)) : ''}` : null);
  const waitingSession = (id8) => otherSessions(data).find((session) => session.id8 === id8 && session.status === 'waiting-on-user');
  const answer = (session, lanesWorking) => ({
    source: 'waiting', action: t.answer, why: t.asked(sessionGoal(session)),
    detail: questionOf(session) ? t.question(questionOf(session)) : null, type: `${t.answerType}${lanesWorking ? t.noGoYet : ''}`,
  });
  if (next.kind === 'approve-boundary') {
    const item = milestoneNamed(milestones, null, next.target?.plan);
    const name = item?.name ?? planName(next.target?.plan, null);
    const step = next.target?.boundary && next.target.boundary !== 'unknown' ? t.approveStep(plain(next.target.boundary)) : null;
    return { source: 'approve', action: t.approve, why: t.approveWhy(name), detail: step, type: t.approveType };
  }
  if (next.kind === 'continue-work') {
    const work = (data.startWork ?? []).find((item) => item.workId === next.target?.workId);
    const item = milestoneNamed(milestones, work?.worktree ?? null, next.target?.plan);
    const name = item?.name ?? planName(next.target?.plan, null);
    const p = work && known(work.progress?.total) ? `${work.progress.done}/${work.progress.total}` : null;
    return { source: 'continue', action: t.continueRun(name), why: t.continueWhy(p), detail: item?.openRows?.[0] ? t.nextStep(item.openRows[0]) : null, type: goOr(null) ?? t.continueType };
  }
  if (next.kind === 'start-plan') {
    const item = milestoneNamed(milestones, null, next.target?.plan);
    const name = item?.name ?? planName(next.target?.plan, null);
    const open = item && known(item.total) && known(item.done) ? item.total - item.done : (item?.openRows?.length ?? 0);
    return { source: 'start', action: t.startPlan(name), why: t.startWhy(open), detail: item?.openRows?.[0] ? t.nextStep(item.openRows[0]) : null, type: goOr(next.command) ?? code(next.command) };
  }
  if (next.kind === 'wait-lanes') {
    const lanes = next.target?.lanes ?? data.lanes?.count ?? 0;
    const session = next.target?.waiting ? waitingSession(next.target.waiting) : null;
    if (session) return answer(session, true);
    return { source: 'lanes', action: t.waitLanes, why: t.lanesWorking(lanes), detail: null, type: t.waitType(lanes) };
  }
  // No runnable step: the brief's own suggestion, with this session left out of "others".
  const view = { ...data, sessions: otherSessions(data) };
  const suggestion = suggestNext(view, null);
  if (suggestion.source === 'waiting') {
    const session = otherSessions(data).find((item) => item.id8 === suggestion.ref);
    if (session) return answer(session, (data.lanes?.count ?? 0) > 0);
  }
  if (suggestion.source === 'lanes') {
    const lanes = data.lanes?.count ?? 0;
    return { source: 'lanes', action: t.waitLanes, why: t.lanesWorking(lanes), detail: null, type: t.waitType(lanes) };
  }
  if (suggestion.source === 'plan') {
    const item = milestoneNamed(milestones, suggestion.worktree ?? null, suggestion.ref);
    const name = item?.name ?? planName(suggestion.ref, null);
    const open = item && known(item.total) && known(item.done) ? item.total - item.done : (item?.openRows?.length ?? 0);
    return { source: 'plan', action: t.planNext(name), why: t.planWhy(open), detail: item?.openRows?.[0] ? t.nextStep(item.openRows[0]) : null, type: code(suggestion.command) };
  }
  if (suggestion.source === 'handoff') {
    return { source: 'handoff', action: t.handoff, why: t.handoffWhy, detail: t.handoffItem(clipToWidth(plain(suggestion.ref), ITEM_COLS)), type: t.handoffType };
  }
  const named = otherSessions(data).find((item) => item.id8 === suggestion.ref);
  if (suggestion.source === 'active' && named) return { source: 'active', action: t.checkActive(sessionGoal(named)), why: t.checkWhy, detail: null, type: t.checkType };
  if (suggestion.source === 'ended' && named) return { source: 'ended', action: t.pickUp(sessionGoal(named)), why: t.pickWhy, detail: null, type: t.pickType };
  return { source: 'empty', action: t.empty, why: t.emptyWhy, detail: null, type: t.emptyType };
};

/** At most five reminders, most urgent first, each `thing → what to do`, from records only. */
const remindersOf = (data, milestones, now, lang) => {
  const t = T[lang];
  const out = [];
  for (const session of otherSessions(data)) {
    if (session.status === 'waiting-on-user' && session.waitingReason !== 'bounded-work boundary') out.push(t.rWaiting(sessionGoal(session)));
  }
  for (const item of milestones.filter((milestone) => milestone.bucket === 'waiting')) out.push(t.rBoundary(clipToWidth(item.name, NAME_COLS)));
  for (const state of data.gitState ?? []) {
    if (state.uncommitted > 0) out.push(t.rUncommitted(state.uncommitted, basename(String(state.worktree))));
  }
  for (const state of data.gitState ?? []) {
    if (state.unpushed > 0) out.push(t.rUnpushed(state.unpushed, basename(String(state.worktree))));
  }
  const working = workingLanes(data);
  if (working > 0) out.push(t.rLanes(working));
  const stale = data.stalePlans ?? [];
  if (stale.length) {
    const first = stale[0];
    const name = `${clipToWidth(planName(first.plan, first.title), NAME_COLS)}${first.local === false && first.worktree ? ` (${basename(String(first.worktree))})` : ''}`;
    out.push(t.rStale(first.days, name, stale.length - 1));
  }
  const handoff = (data.handoffs ?? []).find((item) => item.local && item.next)?.next;
  if (handoff && now.source !== 'handoff') out.push(t.rHandoff(clipToWidth(plain(handoff), 60)));
  return out.slice(0, REMINDERS);
};

/**
 * The board for `lang` (`en` or `ko`): `{lang, now, counts, overall, milestones, done, remaining,
 * reminders, lines, text}`. `width` clips the prose lines; table rows are bounded by their cells.
 */
export const renderBoard = (data, lang = 'en', { width = 100 } = {}) => {
  const language = lang === 'ko' ? 'ko' : 'en';
  const labels = LABELS[language];
  const nowMs = Date.parse(data.generatedAt ?? '') || Date.now();
  const milestones = milestonesOf(data);
  const counts = countsOf(milestones, data);
  const now = nowOf(data, milestones, language);
  const overall = counts.total > 0
    ? { done: counts.done, total: counts.total, percent: percent(counts.done, counts.total), bar: bar(counts.done, counts.total) }
    : { done: 0, total: 0, percent: null, bar: null };

  // Done lately: finished runs, then ticked rows from the most recently changed plan first,
  // its last ticked row first (the plan's own order is the only order on record).
  const finishedRuns = (data.finished?.runs ?? []).map((run) => labels.runFinished(clipToWidth(milestoneNamed(milestones, run.worktree, run.plan)?.name ?? planName(run.plan, null), NAME_COLS)));
  const tickedRows = [...milestones].filter((item) => item.kind === 'plan').sort((a, b) => (b.changedMs ?? 0) - (a.changedMs ?? 0)).flatMap((item) => [...item.doneRows].reverse());
  const done = [...new Set([...finishedRuns, ...tickedRows])].slice(0, DONE_ITEMS);

  // Still to do: open rows in plan order, the current plan (a running or waiting one) first.
  const openItems = milestones.filter((item) => item.bucket !== 'done').flatMap((item) => item.openRows);
  const remaining = { items: openItems.slice(0, REMAINING_ITEMS), more: Math.max(0, openItems.length - REMAINING_ITEMS) };
  const reminders = remindersOf(data, milestones, now, language);

  const clip = (text) => clipToWidth(text, width);
  const lines = ['REWIND <<', `## ${labels.now}`, clip(`**${now.action}** — ${now.why}`)];
  if (now.detail) lines.push(clip(now.detail));
  lines.push(clip(`${labels.type} ${now.type}`));
  lines.push('', `## ${labels.glance}`);
  const b = labels.buckets;
  lines.push(`| ${b.done} | ${b.inProgress} | ${b.waiting} | ${b.remaining} |`, '|:--:|:--:|:--:|:--:|', `| ${counts.done} | ${counts.inProgress} | ${counts.waiting} | ${counts.remaining} |`, '');
  lines.push(overall.bar ? `${labels.overall}  ${overall.bar}  ${overall.done}/${overall.total} (${overall.percent}%)` : `${labels.overall}  ${labels.nothingToCount}`);
  lines.push('', `## ${labels.milestones}`);
  if (milestones.length) {
    lines.push(labels.milestoneHead, '|---|---|---|---|');
    const shown = milestones.length > MILESTONE_ROWS ? milestones.slice(0, MILESTONE_ROWS - 1) : milestones;
    for (const item of shown) {
      lines.push(`| ${cell(item.name)} | ${b[item.bucket]} | ${barText(item.done, item.total, labels)} | ${ageText(item.changedMs, nowMs, labels)} |`);
    }
    if (shown.length < milestones.length) lines.push(`| ${labels.more(milestones.length - shown.length)} | | | |`);
  } else {
    lines.push(labels.noMilestones);
  }
  lines.push('', `## ${labels.done}`);
  lines.push(...(done.length ? done.map((item) => clip(`- ${item}`)) : [labels.noDone]));
  lines.push('', `## ${labels.left}`);
  if (remaining.items.length) {
    lines.push(...remaining.items.map((item, index) => clip(`${index + 1}. ${item}`)));
    if (remaining.more) lines.push(labels.more(remaining.more));
  } else {
    lines.push(labels.noLeft);
  }
  lines.push('', `## ${labels.remember}`);
  lines.push(...(reminders.length ? reminders.map((item) => clip(`- ${item}`)) : [labels.noReminders]));

  return {
    lang: language,
    now: { action: now.action, why: now.why, detail: now.detail, type: now.type },
    counts,
    overall,
    milestones: milestones.map(({ name, bucket, done: k, total, changedMs }) => ({
      name, bucket, done: k, total, bar: bar(k, total), percent: known(total) && total > 0 && known(k) ? percent(k, total) : null, recent: ageText(changedMs, nowMs, labels),
    })),
    done,
    remaining,
    reminders,
    lines: lines.length,
    text: lines.join('\n'),
  };
};
