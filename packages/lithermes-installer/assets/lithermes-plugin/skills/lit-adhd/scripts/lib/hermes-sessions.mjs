// Hermes session store reader for the lit-adhd collector. Hermes keeps every session in one
// SQLite database (`~/.hermes/state.db`, `HERMES_SESSION_STORE` overrides it for tests) instead of
// per-session transcript files, so this module replaces the transcript reader with read-only SQL.
// The database is opened read-only and never written; a missing sqlite3 CLI or an unreadable
// store reads `unknown`, never an error. Every string is redacted before it leaves this module.
// Record shapes match the collector's session contract: asked, done.tools, done.commits, status.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const TOTAL_BUDGET_BYTES = 8 * 1024 * 1024;
const ACTIVE_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 400;
const MAX_MESSAGES_PER_SESSION = 300;

/** A byte budget shared by every read of one collector run. */
export const makeBudget = (limit = TOTAL_BUDGET_BYTES) => ({ limit, used: 0, exhausted: false });

/**
 * A worktree path with symlinks resolved (`/tmp` on macOS, `/var` spellings), falling back to
 * a lexical resolve when the path does not exist. The store may record either spelling.
 */
export const normalizeRoot = (path) => {
  try {
    return realpathSync(path);
  } catch {
    try {
      return resolve(path);
    } catch {
      return path;
    }
  }
};

export const hermesStorePath = (env = process.env) => {
  if (env.HERMES_SESSION_STORE) return env.HERMES_SESSION_STORE;
  return join(env.HOME || homedir(), '.hermes', 'state.db');
};

const runSql = (store, sql, exec) => {
  const out = exec('sqlite3', ['-readonly', '-json', store, sql], { timeout: 8000 });
  const text = String(out ?? '').trim();
  if (!text) return [];
  const rows = JSON.parse(text);
  return Array.isArray(rows) ? rows : [];
};

const toMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
};

const clip = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// The last assistant or user turn asking something reads as waiting on the user. A `?` glyph must
// never reach the brief, so the test looks at the raw text and the brief only names the reason.
const WAITING_TEXT = /[?？]\s*$|`?lit approve`?|`?lit deny`?|승인해\s*주|확인해\s*주|괜찮을까요|할까요/iu;

/**
 * The session rows of every given worktree path, newest first, and whether the session store was
 * there at all. A session belongs to a worktree when its repo root or cwd sits inside it.
 */
export const findHermesSessions = (store, paths, { exec = defaultExec } = {}) => {
  try {
    if (!store || !existsSync(store)) return { status: 'unknown', sessions: [] };
  } catch {
    return { status: 'unknown', sessions: [] };
  }
  const roots = paths.map((path) => normalizeRoot(path));
  let rows;
  try {
    rows = runSql(
      store,
      `SELECT id, started_at, ended_at, last_activity_at, cwd, git_branch, git_repo_root, ` +
        `message_count, tool_call_count, tool_names, title, display_name ` +
        `FROM sessions WHERE COALESCE(archived, 0) = 0 AND COALESCE(hidden, 0) = 0 ` +
        `ORDER BY COALESCE(last_activity_at, started_at, 0) DESC LIMIT ${MAX_SESSIONS}`,
      exec,
    );
  } catch {
    return { status: 'unknown', sessions: [] };
  }
  const sessions = [];
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    const anchor = typeof row.git_repo_root === 'string' && row.git_repo_root
      ? row.git_repo_root
      : typeof row.cwd === 'string' ? row.cwd : '';
    let cwd = null;
    try {
      cwd = anchor ? normalizeRoot(anchor) : null;
    } catch {
      cwd = null;
    }
    if (!cwd || !roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))) continue;
    sessions.push({ sessionId: row.id, row, cwd });
  }
  return { status: 'ok', sessions };
};

const defaultExec = (file, args, options) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });

const countTools = (messages, toolNamesJson) => {
  const tools = {};
  const bump = (name) => {
    if (typeof name === 'string' && name) tools[name] = (tools[name] ?? 0) + 1;
  };
  // The store's own tool-name tally is the first source that knows the counts.
  try {
    const names = JSON.parse(toolNamesJson ?? 'null');
    if (Array.isArray(names)) for (const name of names) bump(name);
  } catch { /* a malformed tally falls back to the message rows */ }
  for (const message of messages) {
    bump(message?.tool_name);
    const calls = message?.tool_calls;
    if (typeof calls === 'string' && calls) {
      try {
        const parsed = JSON.parse(calls);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const call of list) bump(call?.name ?? call?.tool_name);
      } catch { /* a cut or malformed call row is skipped */ }
    } else if (Array.isArray(calls)) {
      for (const call of calls) bump(call?.name ?? call?.tool_name);
    }
  }
  return tools;
};

/**
 * One session's record from the store: what it was asked, what it did, where it stands. `redact`
 * runs over every text field it returns. Changed files are not in this host's store, so the brief
 * shows commits and tool names instead.
 */
export const hermesSessionRecord = (entry, messages, { redact = (text) => text, now = Date.now() } = {}) => {
  const { sessionId, row, cwd } = entry;
  if (!sessionId || !row) return null;
  const started = toMs(row.started_at);
  const last = toMs(row.last_activity_at ?? row.ended_at ?? row.started_at);
  const ended = row.ended_at !== null && row.ended_at !== undefined && Number(row.ended_at) > 0;
  const prompts = [];
  let lastEntry = null;
  let lastTool = null;
  for (const message of messages) {
    const role = message?.role;
    const content = typeof message?.content === 'string' ? message.content : '';
    if (role === 'user' && content.trim()) {
      prompts.push(content);
      lastEntry = { role: 'user', text: content };
    } else if (role === 'assistant' && content.trim()) {
      lastEntry = { role: 'assistant', text: content };
    } else if (role === 'tool') {
      lastEntry = { role: 'tool' };
      const tool = typeof message?.tool_name === 'string' && message.tool_name ? message.tool_name : null;
      if (tool) lastTool = { tool, target: content.trim() ? clip(redact(content), 50) : null };
    }
  }
  const title = row.display_name || row.title || prompts[0] || 'unknown';
  const asked = [...new Set([prompts[0], prompts.at(-1)].filter(Boolean))].slice(0, 2).map((text) => clip(redact(text), 160));
  const waiting = lastEntry?.role === 'user' && WAITING_TEXT.test(lastEntry.text.slice(-400));
  const status = last === null ? 'unknown' : ended ? 'ended' : waiting ? 'waiting-on-user' : now - last <= ACTIVE_MS ? 'active' : 'ended';
  const tools = countTools(messages, row.tool_names);
  return {
    sessionId,
    id8: sessionId.slice(0, 8),
    worktree: cwd ? redact(cwd) : 'unknown',
    cwd,
    branch: typeof row.git_branch === 'string' && row.git_branch ? redact(row.git_branch) : 'unknown',
    started: started === null ? 'unknown' : new Date(started).toISOString(),
    last: last === null ? 'unknown' : new Date(last).toISOString(),
    lastMs: last,
    title: clip(redact(title), 80),
    asked: asked.length ? asked : ['unknown'],
    done: { tools, files: [], commits: [] },
    result: 'unknown',
    status,
    ...(waiting ? { waitingReason: 'asked the user' } : {}),
    ...(lastTool ? { lastTool } : {}),
  };
};

/** The newest message rows of one session, oldest first, under the run's byte budget. */
export const readHermesMessages = (store, sessionId, budget, { exec = defaultExec } = {}) => {
  const where =
    `WHERE session_id = '${String(sessionId).replace(/'/gu, "''")}' AND COALESCE(active, 1) = 1`;
  // Cap the read before touching bodies: sum the byte length first and drop a
  // batch that already crosses the remaining budget. A single huge session
  // must not be loaded and parsed only to be marked exhausted afterwards.
  let incoming = 0;
  try {
    const sized = runSql(store, `SELECT COALESCE(SUM(LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(tool_calls, ''))), 0) AS total FROM messages ${where}`, exec);
    incoming = Number(sized?.[0]?.total ?? 0);
  } catch {
    return null;
  }
  if (!Number.isFinite(incoming) || budget.used + incoming > budget.limit) {
    budget.exhausted = true;
    return null;
  }
  const sql =
    `SELECT role, content, tool_name, tool_calls, timestamp FROM messages ` +
    `${where} ` +
    `ORDER BY timestamp DESC LIMIT ${MAX_MESSAGES_PER_SESSION}`;
  let rows;
  try {
    rows = runSql(store, sql, exec);
  } catch {
    return null;
  }
  let bytes = 0;
  for (const row of rows) bytes += (row?.content ?? '').length + (row?.tool_calls ?? '').length;
  budget.used += bytes;
  if (budget.used > budget.limit) budget.exhausted = true;
  return rows.reverse();
};
