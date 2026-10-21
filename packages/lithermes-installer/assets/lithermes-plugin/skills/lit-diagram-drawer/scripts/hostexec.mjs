// Child processes that survive Windows. Since the CVE-2024-27980 fix, Node refuses to spawn a
// .cmd or .bat file without a shell (spawnSync npm.cmd EINVAL), and PATH lookups there depend on
// PATHEXT. Platform, env and fs probes are arguments so tests can simulate win32 without
// touching globals. Every skill that spawns tools carries a byte-identical copy of this file.
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const SHELL_SCRIPT = /\.(?:cmd|bat)$/i;
const SAFE_ARG = /^[\w@+=:,./\\-]+$/;

export function whichSync(name, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const win = platform === 'win32';
  const p = win ? win32 : posix;
  const exts = win ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter(Boolean) : [''];
  const hasExt = win && exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()));
  // A bare name never matches on Windows: npm leaves an extensionless sh script beside npm.cmd.
  const names = win ? (hasExt ? [name] : exts.map((e) => name + e)) : [name];
  const dirs = p.isAbsolute(name) || /[\\/]/.test(name) ? [''] : String(env.PATH ?? env.Path ?? '').split(win ? ';' : ':').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = dir ? p.join(dir, candidate) : candidate;
      if (exists(full)) return full;
    }
  }
  return null;
}

// Quoted for cmd.exe, which still expands %VAR% inside quotes, so those are refused, never escaped.
export function quoteCmdArg(arg) {
  const text = String(arg);
  if (/["%\r\n\0]/.test(text)) throw new Error(`refusing an argument with a quote, percent sign or line break on a Windows shell: ${JSON.stringify(text.slice(0, 40))}`);
  if (text !== '' && SAFE_ARG.test(text)) return text;
  return `"${text.replace(/\\+$/, (run) => run + run)}"`;
}

// Where an npm or npx shim's JavaScript entry lives, so Windows can run it with node directly.
function npmCli(name, resolved, { env, execPath, exists }) {
  const cli = `${name}-cli.js`;
  const dirs = [];
  if (typeof env.npm_execpath === 'string' && /\.js$/i.test(env.npm_execpath)) dirs.push(win32.dirname(env.npm_execpath));
  dirs.push(win32.join(win32.dirname(resolved), 'node_modules', 'npm', 'bin'));
  dirs.push(win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin'));
  return dirs.map((dir) => win32.join(dir, cli)).find((file) => exists(file)) || null;
}

export function prepareSpawn(command, args = [], options = {}, ctx = {}) {
  const { platform = process.platform, execPath = process.execPath, exists = existsSync } = ctx;
  if (platform !== 'win32') return { command, args, options };
  const env = ctx.env || options.env || process.env;
  const resolved = whichSync(command, { platform, env, exists });
  if (!resolved || !SHELL_SCRIPT.test(resolved)) return { command: resolved || command, args, options };
  const base = win32.basename(resolved).replace(SHELL_SCRIPT, '').toLowerCase();
  if (base === 'npm' || base === 'npx') {
    const cli = npmCli(base, resolved, { env, execPath, exists });
    if (cli) return { command: execPath, args: [cli, ...args], options };
  }
  const line = [resolved, ...args].map(quoteCmdArg).join(' ');
  return { command: line, args: [], options: { ...options, shell: true } };
}

export function spawnTool(command, args, options, ctx = {}) {
  const run = ctx.spawnSync || nodeSpawnSync;
  const prepared = prepareSpawn(command, args, options, ctx);
  return run(prepared.command, prepared.args, prepared.options);
}

// One line naming the real cause: the spawn error, the exit status and the last stderr line.
export function describeSpawnFailure(label, result, { limit = 200 } = {}) {
  if (!result) return `${label} returned no result`;
  const tail = String(result.stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';
  const clean = tail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
  if (result.error) return `${label} could not run: ${result.error.code || 'error'} ${result.error.message}${clean ? ` (${clean})` : ''}`;
  if (result.signal) return `${label} stopped by ${result.signal}${clean ? ` (${clean})` : ''}`;
  return `${label} exited ${result.status}${clean ? `: ${clean}` : ''}`;
}

// Interpreter inside a venv: Scripts\python.exe on Windows, bin/python elsewhere.
export function venvPython(dir, platform = process.platform) {
  return platform === 'win32' ? win32.join(dir, 'Scripts', 'python.exe') : posix.join(dir, 'bin', 'python');
}

// The newest CPython the Office wheels ship for (pip runs --only-binary); 3.15 has no PyYAML wheel,
// so a python3 that is 3.15 is passed over. A caller whose lock is narrower passes its own max.
export const PYTHON_MAX = [3, 14];

export function probePython(command, env = process.env, spawn = spawnTool) {
  const result = spawn(command, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8', env, timeout: 10000 });
  if (!result || result.error || result.status !== 0) return null;
  const version = String(result.stdout || '').trim();
  const [major, minor] = version.split('.').map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) ? { version, major, minor } : null;
}

// The host Python a pinned venv is built from. An override variable, when set, is the only
// candidate and is not range-checked. Otherwise the newest python3.X from `max` down to `min`,
// then python3 and python, each kept only when it runs and falls inside min..max.
// Returns { python, version } or { python: null, detail } naming what was tried.
export function pickPython({ env = process.env, override, min = [3, 10], max = PYTHON_MAX, probe = probePython } = {}) {
  if (override && env[override]) {
    const found = probe(env[override], env);
    return found ? { python: env[override], version: found.version } : { python: null, detail: `${override} is set to ${env[override]}, which does not run` };
  }
  const candidates = [];
  for (let minor = max[1]; minor >= min[1]; minor -= 1) candidates.push(`python3.${minor}`);
  candidates.push('python3', 'python');
  const tried = [];
  for (const command of candidates) {
    const found = probe(command, env);
    if (!found) continue;
    const inRange = (found.major > min[0] || (found.major === min[0] && found.minor >= min[1]))
      && (found.major < max[0] || (found.major === max[0] && found.minor <= max[1]));
    if (inRange) return { python: command, version: found.version };
    tried.push(`${command} ${found.version}`);
  }
  const range = `${min.join('.')} to ${max.join('.')}`;
  return { python: null, detail: `no supported Python (${range}) on PATH${tried.length ? `; found only ${tried.join(', ')}` : ''}` };
}
