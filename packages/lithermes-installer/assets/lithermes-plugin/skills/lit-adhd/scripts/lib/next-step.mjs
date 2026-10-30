// The one next step a lit-adhd brief offers, chosen by a fixed priority over the collected records.
// Hermes has no pausable discipline stack, so the source resume-frame branch is omitted. Hermes
// has no approve/deny command either: a paused bounded-work boundary is shown in chat and the
// user answers in words, and an active run simply continues in chat. The record `go` reads back
// lives under the workspace's `.hermes/lithermes/adhd/` directory alongside the stack file.
//
//   1. a bounded-work run paused at a boundary -> approve-boundary (shown, never started)
//   2. this session's own active run or bounded work  -> continue-work (continue in chat)
//   3. a single open plan with no work running        -> start-plan (`/start-work plans/<f>.md`),
//      or wait-lanes while other lanes are at work (no command, and no `go` until they finish)
//   4. otherwise                                     -> none
import { closeSync, constants, lstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { clipToWidth } from './gauge.mjs';

const bare1 = (text) => String(text ?? '').replace(/\s+/gu, ' ').trim();
const goalOf = (session) => (session.title && session.title !== 'unknown' ? session.title : session.asked?.[0] ?? 'unknown');

export const chooseNextStep = (data, sessionId) => {
  const own = (data.startWork ?? []).filter((work) => work.status === 'paused' && work.pendingBoundary);
  const paused = own.length ? own[0] : (data.startWork ?? []).find((work) => work.status === 'paused' && work.pendingBoundary);
  if (paused) {
    return { kind: 'approve-boundary', target: { workId: paused.workId, plan: paused.plan, ...paused.pendingBoundary }, say: null, automatic: false };
  }
  const active = sessionId
    ? (data.startWork ?? []).find((work) => work.status === 'active' && work.sessionId === sessionId)
    : null;
  if (active) return { kind: 'continue-work', target: { workId: active.workId, plan: active.plan }, say: null };
  const running = (data.startWork ?? []).some((work) => ['active', 'paused'].includes(work.status));
  const open = data.roadmap.plans.filter((plan) => plan.local && plan.progress.total !== null && plan.progress.done < plan.progress.total);
  if (!running && open.length === 1) {
    // Other lanes at work hold the plan back: the step is to wait (or answer the one waiting).
    const lanes = data.lanes?.count ?? 0;
    if (lanes > 0) {
      return { kind: 'wait-lanes', target: { lanes, waiting: data.lanes.waiting ?? null, plan: open[0].plan }, say: null };
    }
    return { kind: 'start-plan', target: { plan: open[0].plan }, say: null, command: `/start-work ${open[0].plan}` };
  }
  return { kind: 'none', target: null };
};

const lanesText = (count) => `${count} lane${count === 1 ? '' : 's'}`;

/** The box text for a lanes wait: answer the lane waiting on the user, else wait for the rest. */
export const waitText = (lanes, waiting) =>
  waiting ? `answer ${waiting} in chat (${lanesText(lanes)} at work)` : `wait for ${lanesText(lanes)} to finish`;

// Shown, never recorded: when no step can run, the brief still recommends one from what
// it read — a session that waits on the user, other lanes at work, the next item of an open
// plan, this worktree's newest HANDOFF Next item, the most recent other active session, the
// most recent other ended one. Live signals come first, so an old HANDOFF line never outranks
// them. Every suggestion continues in chat except a plan item, which names its command.
export const suggestNext = (data, sessionId) => {
  const sessions = data.sessions ?? [];
  const waiting = sessions.filter((session) => session.status === 'waiting-on-user');
  const first = waiting.find((session) => session.sessionId === sessionId) ?? waiting[0];
  if (first) {
    const question = (first.asked ?? []).filter((text) => text && text !== 'unknown').at(-1);
    const clipped = question ? clipToWidth(bare1(question), 90) : null;
    return { kind: 'suggest', label: `answer ${first.id8}`, say: `Answer ${first.id8} in chat${clipped ? `: "${clipped}"` : ''}`, command: null };
  }
  const lanes = data.lanes?.count ?? 0;
  if (lanes > 0) {
    return { kind: 'suggest', label: 'wait for lanes', say: waitText(lanes, null), command: null };
  }
  const open = (data.roadmap?.plans ?? []).filter((plan) => plan.current);
  const plan = open.find((item) => item.local) ?? open[0];
  if (plan) {
    return { kind: 'suggest', label: `start ${plan.plan}`, say: `Next in ${plan.plan}: ${clipToWidth(bare1(plan.current), 60)}`, command: `/start-work ${plan.plan}` };
  }
  const handoffNext = (data.handoffs ?? []).find((handoff) => handoff.local && handoff.next)?.next;
  if (handoffNext) return { kind: 'suggest', label: 'handoff next', say: `HANDOFF.md Next: ${handoffNext}`, command: null };
  const others = sessions.filter((session) => session.sessionId !== sessionId);
  const active = others.find((session) => session.status === 'active');
  if (active) {
    return { kind: 'suggest', label: `check ${active.id8}`, say: `Check on ${active.id8} in chat: ${clipToWidth(bare1(goalOf(active)), 50)}`, command: null };
  }
  const ended = others.find((session) => session.status === 'ended');
  if (ended) {
    return { kind: 'suggest', label: `pick up ${ended.id8}`, say: `Pick up ${ended.id8} in chat: ${clipToWidth(bare1(goalOf(ended)), 50)}`, command: null };
  }
  return { kind: 'suggest', label: 'say what to start', say: 'No session or plan in this window: say what to start', command: null };
};

const fileName = (sessionId) => `next-${String(sessionId ?? 'session').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128) || 'session'}.json`;

export const nextStepPath = (stateRoot, sessionId) => join(stateRoot, '.hermes', 'lithermes', 'adhd', fileName(sessionId));

/** Writes `{kind, target, at}` for this session, whole, through a temporary file. */
export const writeNextStep = (stateRoot, sessionId, step, now = new Date()) => {
  const path = nextStepPath(stateRoot, sessionId);
  const dir = dirname(path);
  // Refuse to write through a planted link: neither the adhd directory nor its
  // `.hermes` parent may be a symlink. Missing directories are fine; we create them.
  for (const probe of [dir, join(stateRoot, '.hermes')]) {
    let link = false;
    try {
      link = lstatSync(probe).isSymbolicLink();
    } catch {
      link = false;
    }
    if (link) throw new Error(`refusing to write a next-step record through symlinked ${probe}`);
  }
  mkdirSync(dir, { recursive: true });
  // Exclusive, no-follow staging: a pre-planted symlink (or any leftover) makes
  // this throw instead of redirecting the write into its target. Staging names
  // are pid-unique per run, so a leftover is a crash remnant or an attack, and
  // either way the safe answer is to refuse, never to replace.
  const staging = `${path}.${process.pid}.tmp`;
  const data = `${JSON.stringify({ kind: step.kind, target: step.target, at: now.toISOString() })}\n`;
  const fd = openSync(staging, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  renameSync(staging, path);
  return path;
};
