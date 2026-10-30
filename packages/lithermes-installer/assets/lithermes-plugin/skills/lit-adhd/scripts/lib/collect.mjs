// The lit-adhd record collector behind `node scripts/adhd.mjs --json`. It reads what is on disk
// for every worktree of this repo (Hermes sessions from the state database, the litgoal records,
// plan rows, handoff headings, git log, the adhd stack file, start-work runs and bounded-work
// states, and herdr when HERDR_ENV=1) and returns one redacted, capped JSON brief. A source that
// is not there reads `unknown`; nothing is inferred. It writes one file only: this session's
// next-step record for `go`.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { parsePlanTaskRows } from './plan-task-rows.mjs';
import { aggregateProgress, clipToWidth, displayWidth, progressOf } from './gauge.mjs';
import { chooseNextStep, suggestNext, waitText, writeNextStep } from './next-step.mjs';
import { makeRedactor } from './redact.mjs';
import { findHermesSessions, hermesSessionRecord, hermesStorePath, makeBudget, normalizeRoot, readHermesMessages } from './hermes-sessions.mjs';

const SMALL_FILE_BYTES = 1024 * 1024;
const HERDR_TIMEOUT_MS = 2000;
const GIT_TIMEOUT_MS = 5000;
const DEFAULT_SINCE = '7d';
const DEFAULT_MAX = 12;
const NAME_MAX = 90;
const PLAN_LIMIT = 8;
const GOAL_LIMIT = 8;

/** `7d`, `12h`, `30m` in milliseconds, or null. */
export const parseSince = (text) => {
  const match = /^(\d{1,4})([dhm])$/u.exec(String(text ?? ''));
  if (!match) return null;
  return Number(match[1]) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2]];
};

const readSmallFile = (path, budget) => {
  let fd;
  try {
    if (!lstatSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const { size } = fstatSync(fd);
    const length = Math.min(size, SMALL_FILE_BYTES, budget.limit - budget.used);
    if (length < size) budget.exhausted = budget.exhausted || length < Math.min(size, SMALL_FILE_BYTES);
    const buffer = Buffer.alloc(Math.max(0, length));
    const read = length > 0 ? readSync(fd, buffer, 0, length, 0) : 0;
    budget.used += read;
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
const readJson = (path, budget) => {
  const text = readSmallFile(path, budget);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const entries = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
};

const defaultExec = (file, args, options) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });

// The nearest `.git` (a directory, or the file a linked worktree carries) bounds the state root,
// so a worktree nested inside another checkout never reads that checkout's stale plans.
const nearestRoot = (startDir) => {
  const start = resolve(startDir);
  let current = start;
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
};

const worktreesOf = (cwd, exec) => {
  try {
    const out = exec('git', ['worktree', 'list', '--porcelain'], { cwd, timeout: GIT_TIMEOUT_MS });
    const paths = out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9).trim()).filter(Boolean);
    return paths.length ? paths : null;
  } catch {
    return null;
  }
};

const mtimeOf = (path) => {
  try {
    return lstatSync(path).mtimeMs;
  } catch {
    return null;
  }
};

// A plan met once the read budget is spent is counted in `skipped.count`, so the brief can say so.
const plansIn = (root, budget, redact, local, skipped) => {
  const list = entries(join(root, 'plans'));
  if (!list) return null;
  return list.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (budget.used >= budget.limit) {
      skipped.count += 1;
      return [];
    }
    const path = join(root, 'plans', entry.name);
    const text = readSmallFile(path, budget);
    if (text === null) return [];
    // Column-zero `- [ ] N. title` and `- [ ] FN. title` rows; a non-numbered checkbox row
    // still counts, the same way the source collector counts every checkbox row.
    const rows = parsePlanTaskRows(text);
    if (!rows.length) return [];
    const open = rows.filter((row) => !row.checked);
    const done = rows.length - open.length;
    // Every row ticked: kept and marked complete, as finished work for the opener, never roadmap.
    return [{
      worktree: redact(root),
      plan: `plans/${entry.name}`,
      local,
      complete: open.length === 0,
      changedMs: mtimeOf(path),
      rows: rows.map((row) => ({ checked: row.checked, title: clipToWidth(redact(row.text), NAME_MAX) })),
      current: open.length ? clipToWidth(redact(open[0].text), NAME_MAX) : null,
      progress: progressOf(done, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX))),
    }];
  });
};

// Hermes keeps goals in `.hermes/lithermes/litgoal/`: one `goals.json` per session scope plus the
// legacy root one, each holding a `goals` list with `status` and per-criterion `status`.
const goalsOf = (root, budget, redact) => {
  const files = [];
  const legacy = join(root, '.hermes', 'lithermes', 'litgoal', 'goals.json');
  if (existsSync(legacy)) files.push(legacy);
  const scopes = entries(join(root, '.hermes', 'lithermes', 'litgoal', 'sessions'));
  if (scopes) {
    for (const scope of scopes) {
      if (!scope.isDirectory()) continue;
      const path = join(root, '.hermes', 'lithermes', 'litgoal', 'sessions', scope.name, 'goals.json');
      if (existsSync(path)) files.push(path);
    }
  }
  if (!files.length) return null;
  return files.flatMap((path) => {
    const store = readJson(path, budget);
    const goals = Array.isArray(store?.goals) ? store.goals : [];
    return goals.slice(0, GOAL_LIMIT).filter((goal) => goal && Array.isArray(goal.criteria)).map((goal) => {
      const criteria = goal.criteria.filter((criterion) => criterion && typeof criterion === 'object');
      const passed = criteria.filter((criterion) => criterion.status === 'pass');
      const remaining = criteria.filter((criterion) => criterion.status !== 'pass').map((criterion) => clipToWidth(redact(String(criterion.id ?? 'unknown')), NAME_MAX));
      return {
        worktree: redact(root),
        file: basename(dirname(path) === 'litgoal' ? path : dirname(path)),
        status: typeof goal.status === 'string' ? goal.status : 'unknown',
        objective: clipToWidth(redact(String(goal.objective ?? goal.title ?? 'unknown').split('\n')[0]), 120),
        progress: progressOf(passed.length, criteria.length, remaining),
      };
    });
  });
};

// A Next item already marked finished: a tick, a checked box, a struck line, or DONE/SHIPPED
// written in capitals (lowercase "done" in ordinary prose stays open).
const finishedItem = (raw, line) =>
  /[✅✓]/u.test(line) || /^(?:[-*+]|\d+[.)])\s+\[[xX]\]/u.test(raw) || /^~~.*~~$/u.test(line) || /\b(?:DONE|SHIPPED)\b/u.test(line);

// The first open item under a `## Next` (or `## Next steps`) heading, its list marker removed.
const nextItemOf = (text) => {
  let inside = false;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (/^#{1,6}\s/u.test(trimmed)) {
      if (inside) return null;
      inside = /^#{1,6}\s+next(?:\s+steps?)?$/iu.test(trimmed);
    } else if (inside && trimmed) {
      const item = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, '');
      if (!finishedItem(trimmed, item)) return item;
    }
  }
  return null;
};

// Only this worktree's own handoff offers a `next`, and only from its newest file: an old root
// HANDOFF.md never outranks a newer one (the dedicated `.handoff/HANDOFF.md` wins a tie).
// Another worktree's handoff never offers one.
const handoffsOf = (root, budget, redact, local) => {
  const files = (entries(root) ?? [])
    .filter((entry) => entry.isFile() && /^HANDOFF.*\.md$/u.test(entry.name))
    .map((entry) => join(root, entry.name));
  const dotted = join(root, '.handoff', 'HANDOFF.md');
  if (existsSync(dotted)) files.push(dotted);
  const read = files.map((path) => ({ path, text: readSmallFile(path, budget) ?? '', mtimeMs: mtimeOf(path) ?? 0 }));
  const newest = read.reduce((best, item) => (best === null || item.mtimeMs > best.mtimeMs || (item.mtimeMs === best.mtimeMs && item.path === dotted) ? item : best), null);
  return read.map((item) => {
    const headings = item.text.split('\n').slice(0, 40).filter((line) => /^#{1,3} /u.test(line)).map((line) => clipToWidth(redact(line), 100));
    const next = local && item === newest ? nextItemOf(item.text) : null;
    return { worktree: redact(root), file: basename(item.path), headings, local, next: next ? clipToWidth(redact(next), 120) : null };
  });
};

const commitsOf = (root, sinceMs, now, exec, redact) => {
  try {
    const since = new Date(now - sinceMs).toISOString();
    const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: GIT_TIMEOUT_MS }).trim();
    const out = exec('git', ['log', `--since=${since}`, '--max-count=20', '--format=%H%x09%cI%x09%s'], { cwd: root, timeout: GIT_TIMEOUT_MS });
    return out.split('\n').filter(Boolean).map((line) => {
      const [hash, at, ...subject] = line.split('\t');
      return { worktree: redact(root), branch: redact(branch), hash: hash.slice(0, 7), at, atMs: Date.parse(at), subject: clipToWidth(redact(subject.join('\t')), 100) };
    });
  } catch {
    return null;
  }
};

// The adhd stack file the Python hooks write: active disciplines per session. Hermes has no
// pausable stack, so frames are active or finished and carry no k/n; progress reads `unknown`.
const stacksOf = (root, budget, redact) => {
  const stack = readJson(join(root, '.hermes', 'lithermes', 'adhd', 'stack.json'), budget);
  const sessions = stack && typeof stack === 'object' && stack.sessions && typeof stack.sessions === 'object' ? stack.sessions : null;
  if (!sessions) return null;
  return Object.entries(sessions).flatMap(([sessionId, record]) => {
    const frames = record && Array.isArray(record.frames) ? record.frames : [];
    return frames.slice(0, 3).map((frame) => ({
      worktree: redact(root),
      sessionId: typeof sessionId === 'string' ? sessionId : null,
      id8: typeof sessionId === 'string' ? sessionId.slice(0, 8) : 'unknown',
      skill: typeof frame?.skill === 'string' ? frame.skill : 'unknown',
      stage: typeof frame?.stage === 'string' ? frame.stage : 'unknown',
      role: 'spine',
      status: frame?.status === 'finished' ? 'finished' : 'active',
      at: typeof frame?.at === 'string' ? frame.at : 'unknown',
      progress: progressOf(null, null),
    }));
  });
};

// Hermes start-work state: newest `runs/*/state.json` with `command: start-work` (a run has no
// status field, so an unfinished plan reads active and a finished plan reads done), plus
// bounded-work `work/*/state.json` records, which carry a real status and a pending boundary.
const startWorkOf = (root, budget, redact) => {
  const items = [];
  const runs = entries(join(root, '.hermes', 'lithermes', 'runs')) ?? [];
  let newestRun = null;
  for (const entry of runs) {
    if (!entry.isDirectory()) continue;
    const state = readJson(join(root, '.hermes', 'lithermes', 'runs', entry.name, 'state.json'), budget);
    if (!state || state.command !== 'start-work') continue;
    if (!newestRun || String(state.created_at ?? '') > String(newestRun.created_at ?? '')) newestRun = state;
  }
  if (newestRun) {
    const plan = typeof newestRun.plan === 'string' && newestRun.plan ? newestRun.plan : null;
    const planText = plan ? readSmallFile(plan, budget) : null;
    const rows = planText === null ? [] : parsePlanTaskRows(planText);
    const open = rows.filter((row) => !row.checked);
    items.push({
      worktree: redact(root),
      workId: `run-${String(newestRun.run_id ?? 'unknown').slice(0, 16)}`,
      plan: plan ? redact(plan) : 'unknown',
      status: rows.length && !open.length ? 'done' : 'active',
      atMs: Date.parse(String(newestRun.created_at ?? '')),
      // A start-work run records no session, so it is never assumed to be this session's.
      sessionId: null,
      id8: 'unknown',
      progress: rows.length
        ? progressOf(rows.length - open.length, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX)))
        : progressOf(null, null),
    });
  }
  const works = entries(join(root, '.hermes', 'lithermes', 'work')) ?? [];
  for (const entry of works) {
    if (!entry.isDirectory()) continue;
    const state = readJson(join(root, '.hermes', 'lithermes', 'work', entry.name, 'state.json'), budget);
    if (!state || typeof state !== 'object') continue;
    const status = state.status;
    if (!['active', 'paused', 'completed'].includes(status)) continue;
    const plan = typeof state.plan === 'string' && state.plan ? state.plan : null;
    const planText = plan ? readSmallFile(plan, budget) : null;
    const rows = planText === null ? [] : parsePlanTaskRows(planText);
    const open = rows.filter((row) => !row.checked);
    const steps = Array.isArray(state.progress) ? state.progress : [];
    const passed = steps.filter((item) => item && typeof item === 'object' && item.status === 'pass').length;
    const boundary = state.status === 'paused' && state.boundary && typeof state.boundary === 'object' ? state.boundary : null;
    const owner = typeof state.active_session_id === 'string' && state.active_session_id ? state.active_session_id : null;
    items.push({
      worktree: redact(root),
      workId: typeof state.work_id === 'string' ? state.work_id : entry.name,
      plan: plan ? redact(plan) : 'unknown',
      status,
      atMs: Date.parse(String(state.updated_at ?? state.created_at ?? '')),
      sessionId: owner,
      id8: owner ? owner.slice(0, 8) : 'unknown',
      ...(boundary ? { pendingBoundary: { boundary: clipToWidth(redact(String(boundary.id ?? 'unknown')), NAME_MAX) } } : {}),
      progress: steps.length
        ? progressOf(passed, steps.length)
        : rows.length
          ? progressOf(rows.length - open.length, rows.length, open.map((row) => clipToWidth(redact(row.text), NAME_MAX)))
          : progressOf(null, null),
    });
  }
  return items.length ? items : null;
};

const insideAny = (dir, roots) =>
  typeof dir === 'string' && dir !== '' && roots.some((root) => dir === root || dir.startsWith(`${root}/`));

// `herdr agent list` prints one JSON document. An agent is a lane when it is working or blocked
// in this herdr workspace or inside one of this repo's worktrees; this pane is never a lane.
// Anything unreadable leaves herdr `unknown` with no lanes.
const herdrOf = (env, exec, redact, roots) => {
  if (env.HERDR_ENV !== '1') return { status: 'unknown', agents: [] };
  try {
    const out = exec('herdr', ['agent', 'list'], { timeout: HERDR_TIMEOUT_MS });
    const listed = JSON.parse(out)?.result?.agents;
    if (!Array.isArray(listed)) return { status: 'unknown', agents: [] };
    const agents = listed.slice(0, 40).filter((agent) => agent && typeof agent === 'object').map((agent) => {
      const status = typeof agent.agent_status === 'string' ? agent.agent_status : 'unknown';
      const pane = typeof agent.pane_id === 'string' ? agent.pane_id : 'unknown';
      const here = (env.HERDR_WORKSPACE_ID && agent.workspace_id === env.HERDR_WORKSPACE_ID)
        || insideAny(agent.cwd, roots) || insideAny(agent.foreground_cwd, roots);
      const session = typeof agent.agent_session?.value === 'string' ? agent.agent_session.value : null;
      return {
        agent: clipToWidth(redact(String(agent.agent ?? 'unknown')), 40),
        status,
        pane: clipToWidth(redact(pane), 40),
        lane: ['working', 'blocked'].includes(status) && Boolean(here) && !(env.HERDR_PANE_ID && pane === env.HERDR_PANE_ID),
        sessionId: session,
      };
    });
    return { status: 'ok', agents };
  } catch {
    return { status: 'unknown', agents: [] };
  }
};

// Lanes: other live sessions of this repo (active or waiting on the user) plus herdr lane agents;
// an agent whose session is already counted, or is this session, counts once or not at all.
const lanesOf = (sessions, herdr, sessionId) => {
  const others = sessions.filter((session) => session.sessionId !== sessionId && ['active', 'waiting-on-user'].includes(session.status));
  const counted = new Set(others.map((session) => session.sessionId));
  const agents = herdr.agents.filter((agent) => agent.lane && !(agent.sessionId && (counted.has(agent.sessionId) || agent.sessionId === sessionId)));
  const waiting = others.find((session) => session.status === 'waiting-on-user');
  return {
    count: others.length + agents.length,
    sessions: others.map((session) => session.id8),
    agents: agents.map((agent) => agent.pane),
    waiting: waiting ? waiting.id8 : null,
  };
};

const known = (list) => (list === null ? 'unknown' : 'ok');
// A run records its plan as an absolute path; inside its own worktree it reads `plans/<f>.md`.
const planInWorktree = (worktree, plan) => (plan.startsWith(`${worktree}/`) ? plan.slice(worktree.length + 1) : plan);
const statusRank = { 'waiting-on-user': 0, active: 1, ended: 2, unknown: 3 };

/**
 * Collects the brief. Options: `cwd`, `here` (cwd only), `since` (`7d`), `max` (12), `sessionId`
 * (this session, for the next step and waiting state), `env`, `now`, `exec` (git/herdr/sqlite3 runner).
 */
export const collectAdhd = ({
  cwd = process.cwd(),
  here = false,
  since = DEFAULT_SINCE,
  max = DEFAULT_MAX,
  sessionId = null,
  env = process.env,
  now = Date.now(),
  exec = defaultExec,
  record = true,
} = {}) => {
  const home = env.HOME || homedir();
  const redact = makeRedactor({ env, home });
  const budget = makeBudget();
  const sinceMs = parseSince(since) ?? parseSince(DEFAULT_SINCE);
  const limit = Number.isInteger(max) && max > 0 ? Math.min(max, 50) : DEFAULT_MAX;
  const start = normalizeRoot(resolve(cwd));
  const stateRoot = nearestRoot(start);
  const listed = here ? null : worktreesOf(start, exec);
  const roots = [...new Set([start, ...(here ? [] : listed ?? [stateRoot])])];

  // The small on-disk records first, so the session transcripts read after them cannot spend
  // the budget a plan or handoff needs.
  const collectEach = (read) => {
    const results = roots.map(read);
    return results.every((value) => value === null) ? null : results.flatMap((value) => value ?? []);
  };
  const isLocal = (root) => resolve(root) === stateRoot || resolve(root) === start;
  const plansSkipped = { count: 0 };
  const plans = collectEach((root) => plansIn(root, budget, redact, isLocal(root), plansSkipped));
  const litgoal = collectEach((root) => {
    const goals = goalsOf(root, budget, redact);
    return goals ? goals.map((goal) => ({ ...goal, local: isLocal(root) })) : null;
  });
  const handoffs = roots.flatMap((root) => handoffsOf(root, budget, redact, resolve(root) === start));
  const workflows = collectEach((root) => stacksOf(root, budget, redact));
  const startWork = collectEach((root) => startWorkOf(root, budget, redact));

  const found = findHermesSessions(hermesStorePath(env), roots, { exec });
  const sessions = [];
  for (const entry of found.sessions) {
    if (sessions.length >= limit || budget.exhausted) break;
    const messages = readHermesMessages(hermesStorePath(env), entry.sessionId, budget, { exec });
    const session = messages ? hermesSessionRecord(entry, messages, { redact, now }) : null;
    if (!session || (session.lastMs !== null && now - session.lastMs > sinceMs)) continue;
    if (here && session.cwd && resolve(session.cwd) !== start) continue;
    sessions.push(session);
  }

  const commits = collectEach((root) => commitsOf(root, sinceMs, now, exec, redact));
  const herdr = herdrOf(env, exec, redact, roots.map((root) => resolve(root)));

  // A session waits on the user when it asked something, or holds a paused boundary.
  for (const session of sessions) {
    const work = (startWork ?? []).find((item) => item.sessionId === session.sessionId);
    if (work?.status === 'paused') {
      session.status = 'waiting-on-user';
      session.waitingReason = 'bounded-work boundary';
    }
    const top = work;
    session.progress = top?.progress ?? progressOf(null, null);
    session.done.commits = (commits ?? [])
      .filter((commit) => session.lastMs !== null && Date.parse(session.started) <= commit.atMs && commit.atMs <= session.lastMs + 5 * 60_000
        && (session.branch === 'unknown' || commit.branch === session.branch))
      .slice(0, 5)
      .map(({ hash, subject }) => ({ hash, subject }));
  }
  sessions.sort((a, b) => statusRank[a.status] - statusRank[b.status] || (b.lastMs ?? 0) - (a.lastMs ?? 0));
  const lanes = lanesOf(sessions, herdr, sessionId);

  // Open plans changed inside the window are listed, this worktree's first, then the most recently
  // changed, up to a short cap; a stale plan is left out here and elsewhere. The roadmap gauge
  // counts this worktree only, since a sum over unrelated branches measures nothing.
  const recent = (plan) => plan.changedMs !== null && now - plan.changedMs <= sinceMs;
  const orderedPlans = (plans ?? [])
    .filter((plan) => !plan.complete && recent(plan))
    .sort((a, b) => Number(b.local) - Number(a.local) || (b.changedMs ?? 0) - (a.changedMs ?? 0));
  const shownPlans = orderedPlans.slice(0, PLAN_LIMIT);
  const localGoals = (litgoal ?? []).filter((goal) => goal.local);
  const roadmapItems = [...orderedPlans.filter((plan) => plan.local).map((plan) => plan.progress), ...localGoals.map((goal) => goal.progress)];
  const data = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    scope: { here, since: sinceMs === parseSince(since) ? since : DEFAULT_SINCE, max: limit, worktrees: roots.map(redact) },
    sources: {
      sessions: found.status,
      litgoal: known(litgoal),
      plans: known(plans),
      handoffs: handoffs.length ? 'ok' : 'unknown',
      git: known(commits),
      workflowStack: known(workflows),
      startWork: known(startWork),
      herdr: herdr.status,
    },
    budget: { bytesRead: budget.used, limit: budget.limit, exhausted: budget.exhausted },
    summary: {
      sessions: sessions.length,
      waitingOnUser: sessions.filter((session) => session.status === 'waiting-on-user').length,
      active: sessions.filter((session) => session.status === 'active').length,
    },
    sessions: sessions.map(({ cwd: _cwd, lastMs: _lastMs, sessionId: id, ...rest }) => ({ ...rest, self: Boolean(sessionId) && id === sessionId })),
    roadmap: {
      plans: shownPlans,
      plansOmitted: orderedPlans.length - shownPlans.length,
      plansSkipped: plansSkipped.count,
      litgoal: litgoal ?? [],
      progress: roadmapItems.length ? aggregateProgress(roadmapItems) : progressOf(null, null),
    },
    // Finished inside the window: start-work runs whose plan is fully ticked, completed bounded
    // work, and plans with every row ticked.
    finished: {
      runs: (startWork ?? [])
        .filter((work) => ['done', 'completed'].includes(work.status) && Number.isFinite(work.atMs) && now - work.atMs <= sinceMs)
        .map(({ worktree, plan, workId }) => ({ worktree, plan: planInWorktree(worktree, plan), workId })),
      plans: (plans ?? []).filter((plan) => plan.complete && recent(plan)).map(({ worktree, plan, local, progress }) => ({ worktree, plan, local, gauge: progress.gauge })),
    },
    workflows: (workflows ?? []).map((frame) => ({ ...frame, self: Boolean(sessionId) && frame.sessionId === sessionId })),
    startWork: startWork ?? [],
    handoffs,
    commits: (commits ?? []).slice(0, 20).map(({ atMs: _atMs, ...commit }) => commit),
    herdr: { status: herdr.status, agents: herdr.agents.map(({ sessionId: _sessionId, ...agent }) => agent) },
    lanes,
  };
  const next = chooseNextStep(data, sessionId);
  data.next = next;
  data.nextRecorded = false;
  if (record && sessionId) {
    try {
      // The record lives beside the working directory the hook reads (`go`
      // uses `Path.cwd()`), not at the git root: a brief run from a
      // subdirectory must be continued from that same directory.
      writeNextStep(start, sessionId, next, new Date(now));
      data.nextRecorded = true;
    } catch {
      data.nextRecorded = false;
    }
  }
  for (const frame of data.workflows) delete frame.sessionId;
  for (const work of data.startWork) {
    work.self = Boolean(sessionId) && work.sessionId === sessionId;
    delete work.sessionId;
    delete work.atMs;
  }
  return data;
};

const line = (text, width) => clipToWidth(text, width);
const remainingLine = (names, width) => {
  if (!names.length || (names.length === 1 && names[0] === 'unknown')) return null;
  let out = '  left:';
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const piece = ` ${name}${index < names.length - 1 ? ',' : ''}`;
    if (displayWidth(out + piece) > width - 4) return `${out} …(+${names.length - index})`;
    out += piece;
  }
  return out;
};

const STATUS_BADGE = { 'waiting-on-user': '● waiting on you', active: '▶ active', ended: '✓ ended', unknown: '○ unknown' };

const toolsLine = (tools) => {
  const names = Object.entries(tools ?? {}).sort((a, b) => b[1] - a[1]);
  return names.length ? names.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(' · ') : null;
};

// Hermes has no typed `go`: the next step names a slash command when one continues the work
// (`/start-work plans/<f>.md`), otherwise the user answers in chat.
const sessionNext = (session, data) => {
  const boundary = (data.startWork ?? []).find((item) => item.id8 === session.id8 && item.status === 'paused' && item.pendingBoundary);
  if (boundary) return 'answer in chat to approve or deny the boundary';
  if (session.status === 'waiting-on-user') return 'answer its question';
  return null;
};

/** One session card: status badge, goal in plain words, gauge or known-facts line, done, next. */
const sessionCard = (session, data, push) => {
  push(`== ${STATUS_BADGE[session.status] ?? session.status} · ${session.id8} · ${session.title}`);
  for (const ask of session.asked.filter((text) => text !== 'unknown').slice(0, 2)) push(`asked: ${ask}`);
  const { gauge: pace, remaining } = session.progress;
  push(pace.startsWith('[▉') || pace.startsWith('[░') ? `${pace} · left: ${remaining.filter((name) => name !== 'unknown').join(', ') || '—'}` : `${pace}${remaining.filter((name) => name !== 'unknown').length ? ` · ${remaining.filter((name) => name !== 'unknown').join(', ')}` : ''}`);
  if (session.status === 'active' && session.lastTool) {
    const target = session.lastTool.target ? ` "${clipToWidth(session.lastTool.target, 50)}"` : '';
    push(`now: ${session.lastTool.tool}${target}`);
  }
  const tools = toolsLine(session.done.tools);
  const commits = session.done.commits.map((commit) => `${commit.hash} ${commit.subject}`);
  if (tools || commits.length) push(`did: ${[tools, ...commits].filter(Boolean).join(' · ')}`);
  const next = sessionNext(session, data);
  if (next) push(`next: ${next}`);
};

const planMark = (plan) => (plan.progress.total !== null && plan.progress.done >= plan.progress.total ? '✓' : plan.current ? '▶' : '○');

const ENDED_ROWS = 8;
const placeOf = (session) => (session.worktree && session.worktree !== 'unknown' ? basename(String(session.worktree)) : 'unknown');
const goalOf = (session) => (session.title && session.title !== 'unknown' ? session.title : session.asked?.[0] ?? 'unknown');

/** Largest unit since `lastMs`, for the ended table's ago column. */
const ageOf = (lastMs, nowMs) => {
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return '·';
  const seconds = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
};

/** Ended sessions, one table row each, newest first: history, not something to read now. */
const endedTable = (sessions, nowMs) => {
  const cell = (text) => text || '·';
  const rows = sessions.slice(0, ENDED_ROWS).map((session) => {
    const commits = session.done?.commits?.length ?? 0;
    const tools = toolsLine(session.done?.tools);
    const done = commits ? `${commits} commit${commits === 1 ? '' : 's'}` : tools ? `used ${tools}` : '·';
    const at = Date.parse(session.last);
    return `| ${session.id8} | ${cell(clipToWidth(placeOf(session), 20))} | ${cell(clipToWidth(goalOf(session), 44))} | ${cell(Number.isFinite(at) ? ageOf(at, nowMs) : '·')} | ${cell(done)} |`;
  });
  const more = sessions.length > ENDED_ROWS ? [`…(+${sessions.length - ENDED_ROWS} more ended)`] : [];
  return ['| id | where | goal | ago | done |', '|---|---|---|---|---|', ...rows, ...more];
};

/**
 * The three opening lines, from records only. Done: this worktree's newest commits in the window
 * (two at most), then its finished start-work runs and fully ticked plans (three items in all).
 * Doing: this session's active frame, else its own running start-work, else the newest active
 * session's goal, else another session's running start-work. Next: the same step the box names.
 */
const openerLines = (data, nextText) => {
  const local = data.scope.worktrees[0];
  const runs = (data.finished?.runs ?? []).filter((run) => run.worktree === local);
  const runPlans = new Set(runs.map((run) => run.plan));
  const finished = [
    ...(data.commits ?? []).filter((commit) => commit.worktree === local).slice(0, 2).map((commit) => commit.subject),
    ...runs.map((run) => `${run.plan} (start-work complete)`),
    ...(data.finished?.plans ?? []).filter((plan) => plan.worktree === local && !runPlans.has(plan.plan)).map((plan) => `${plan.plan} ${plan.gauge}`),
  ];
  const done = [...new Set(finished)].slice(0, 3).join('; ') || 'nothing finished in this window';
  const frame = (data.workflows ?? []).filter((item) => item.self && item.status === 'active').at(-1);
  const running = (data.startWork ?? []).filter((item) => item.status === 'active');
  const work = running.find((item) => item.self);
  const active = (data.sessions ?? []).find((session) => session.status === 'active');
  const doing = frame
    ? [frame.skill, frame.stage].filter((part) => part && part !== 'unknown').join(' · ')
    : work
      ? `start-work ${planInWorktree(work.worktree, work.plan)} ${work.progress.gauge}`
      : active
        ? clipToWidth(goalOf(active), 80)
        : running[0]
          ? `start-work ${planInWorktree(running[0].worktree, running[0].plan)} ${running[0].progress.gauge}${running[0].id8 === 'unknown' ? '' : ' (another session)'}`
          : 'nothing running';
  return [`Done so far: ${done}`, `Doing now: ${doing}`, `Next: ${nextText}`];
};

/** Plain-text brief: opener, headline, cards for live sessions, ended table, roadmap, one next step in a box. */
export const renderAdhd = (data, width = 100, sessionId = null) => {
  const out = [];
  const push = (text) => out.push(line(text, width));
  const waiting = data.next.kind === 'wait-lanes';
  const recorded = data.next.kind !== 'none' && !waiting;
  // With no runnable step on record, the suggestion ranks live signals (a session waiting on the
  // user, lanes at work) and open plan items ahead of this worktree's HANDOFF.md `## Next` item.
  const step = recorded
    ? data.next
    : waiting
      ? { kind: 'suggest', label: 'wait for lanes', say: waitText(data.next.target.lanes, data.next.target.waiting), command: null }
      : suggestNext(data, sessionId);
  const stepName = recorded ? data.next.kind.replace(/-/gu, ' ') : step.label;
  const stepSay = recorded && data.next.say ? ` (say "${data.next.say}")` : '';
  const stepRun = step.command ? ` (run ${step.command})` : recorded ? '' : ' (continue in chat)';
  const target = recorded ? data.next.target?.plan ?? data.next.target?.workId ?? '' : '';
  const nextText = recorded ? `${stepName}${target ? `: ${target}` : ''}${stepSay}${stepRun}` : `${step.say}${stepRun}`;
  // While other lanes work and the step is not this session's own run, `go` has nothing to start.
  const holdGo = (data.lanes?.count ?? 0) > 0 && !recorded;
  for (const opener of openerLines(data, nextText)) push(opener);
  push(`lit-adhd: ${data.summary.sessions} session(s) · ${data.summary.waitingOnUser} waiting on you · next: ${stepName}${stepSay}${stepRun}`);
  const live = data.sessions.filter((session) => session.status !== 'ended');
  const ended = data.sessions.filter((session) => session.status === 'ended');
  const groups = new Map();
  for (const session of live) {
    const key = session.worktree && session.worktree !== 'unknown' ? session.worktree : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  for (const [worktree, groupSessions] of groups) {
    if (groups.size > 1 && worktree) push(`-- ${basename(worktree)} --`);
    for (const session of groupSessions) sessionCard(session, data, push);
  }
  if (ended.length) {
    push(`-- ended · ${ended.length} --`);
    for (const row of endedTable(ended, Date.parse(data.generatedAt))) push(row);
  }
  if (data.roadmap.plans.length || data.roadmap.litgoal.length) {
    push('-- roadmap --');
    for (const plan of data.roadmap.plans) {
      const head = `${plan.local ? '' : `${basename(plan.worktree)}: `}${plan.plan} ${plan.progress.gauge}`;
      push(planMark(plan) === '✓' ? `✓ ${head}` : plan.current ? `▶ ${head} now: ${plan.current}` : `○ ${head}`);
      const left = remainingLine(plan.progress.remaining.filter((name) => name !== 'unknown' && name !== plan.current), width);
      if (left) push(`  ○ later: ${left.replace(/^  left: /, '')}`);
    }
    if (data.roadmap.plansOmitted) push(`  …(+${data.roadmap.plansOmitted} more open plans)`);
    for (const goal of data.roadmap.litgoal) push(`○ litgoal ${goal.progress.gauge} ${goal.objective}`);
    for (const commit of data.commits.slice(0, 5)) push(`✓ ${commit.hash} ${commit.at.slice(0, 10)} ${commit.subject}`);
  }
  push(`-- next --\n> ${nextText}.`);
  const unknownSources = Object.entries(data.sources).filter(([, status]) => status !== 'ok').map(([name]) => name);
  if (unknownSources.length) push(`unknown: ${unknownSources.join(', ')}`);
  const skipped = data.roadmap.plansSkipped ?? 0;
  if (skipped) push(`${skipped} ${skipped === 1 ? 'plan was' : 'plans were'} not read (read budget used up)`);
  if (holdGo) push('Do not type `go` until they finish.');
  return `${out.join('\n')}\n`;
};

/** `adhd [--json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]`. */
export const runAdhdCli = (args, cwd = process.cwd(), { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) => {
  const options = { cwd, env, here: false, since: DEFAULT_SINCE, max: DEFAULT_MAX, sessionId: null };
  let json = false;
  let width = Number(stdout.columns) || 100;
  const usage = 'Usage: adhd [--json] [--here] [--since 7d] [--max 12] [--session <id>] [--width N]';
  if (args.some((arg) => arg === '--help' || arg === '-h')) {
    stdout.write(`${usage}\n`);
    return 0;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--here') options.here = true;
    else if (arg === '--since' && parseSince(args[index + 1])) options.since = args[++index];
    else if (arg === '--max' && /^\d{1,2}$/u.test(args[index + 1] ?? '')) options.max = Number(args[++index]);
    else if (arg === '--session' && /^[A-Za-z0-9._:-]{1,160}$/u.test(args[index + 1] ?? '')) options.sessionId = args[++index];
    else if (arg === '--width' && /^\d{2,3}$/u.test(args[index + 1] ?? '')) width = Number(args[++index]);
    else {
      stderr.write(`adhd: unknown argument ${JSON.stringify(basename(String(arg)))}. ${usage}\n`);
      return 64;
    }
  }
  const data = collectAdhd(options);
  stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : renderAdhd(data, width, options.sessionId));
  return 0;
};