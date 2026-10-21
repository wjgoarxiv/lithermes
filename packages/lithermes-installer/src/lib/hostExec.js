"use strict";

// Child processes that survive Windows. Since the CVE-2024-27980 fix, Node refuses to spawn a
// .cmd or .bat file without a shell (spawnSync npm.cmd EINVAL), and PATH lookups there depend on
// PATHEXT. Everything takes its platform, env and fs probes as arguments so tests can simulate
// win32 without touching globals. The payload skills carry the same logic as hostexec.mjs.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SHELL_SCRIPT = /\.(?:cmd|bat)$/i;
const SAFE_ARG = /^[\w@+=:,./\\-]+$/;

function whichSync(name, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const exts = win ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim().toLowerCase()).filter(Boolean) : [""];
  const hasExt = win && exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()));
  // A bare name never matches on Windows: npm leaves an extensionless sh script beside npm.cmd.
  const names = win ? (hasExt ? [name] : exts.map((e) => name + e)) : [name];
  const dirs = p.isAbsolute(name) || /[\\/]/.test(name) ? [""] : String(env.PATH ?? env.Path ?? "").split(win ? ";" : ":").map((d) => d.trim().replace(/^"|"$/g, "")).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = dir ? p.join(dir, candidate) : candidate;
      if (exists(full)) return full;
    }
  }
  return null;
}

// Quoted for cmd.exe, which still expands %VAR% inside quotes, so those are refused, never escaped.
function quoteCmdArg(arg) {
  const text = String(arg);
  if (/["%\r\n\0]/.test(text)) throw new Error(`refusing an argument with a quote, percent sign or line break on a Windows shell: ${JSON.stringify(text.slice(0, 40))}`);
  if (text !== "" && SAFE_ARG.test(text)) return text;
  return `"${text.replace(/\\+$/, (run) => run + run)}"`;
}

// Where an npm or npx shim's JavaScript entry lives, so Windows can run it with node directly.
function npmCli(name, resolved, { env, execPath, exists }) {
  const cli = `${name}-cli.js`;
  const dirs = [];
  if (typeof env.npm_execpath === "string" && /\.js$/i.test(env.npm_execpath)) dirs.push(path.win32.dirname(env.npm_execpath));
  dirs.push(path.win32.join(path.win32.dirname(resolved), "node_modules", "npm", "bin"));
  dirs.push(path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin"));
  return dirs.map((dir) => path.win32.join(dir, cli)).find((file) => exists(file)) || null;
}

function prepareSpawn(command, args = [], options = {}, ctx = {}) {
  const { platform = process.platform, execPath = process.execPath, exists = fs.existsSync } = ctx;
  if (platform !== "win32") return { command, args, options };
  const env = ctx.env || options.env || process.env;
  const resolved = whichSync(command, { platform, env, exists });
  if (!resolved || !SHELL_SCRIPT.test(resolved)) return { command: resolved || command, args, options };
  const base = path.win32.basename(resolved).replace(SHELL_SCRIPT, "").toLowerCase();
  if (base === "npm" || base === "npx") {
    const cli = npmCli(base, resolved, { env, execPath, exists });
    if (cli) return { command: execPath, args: [cli, ...args], options };
  }
  const line = [resolved, ...args].map(quoteCmdArg).join(" ");
  return { command: line, args: [], options: { ...options, shell: true } };
}

function spawnTool(command, args, options, ctx = {}) {
  const run = ctx.spawnSync || childProcess.spawnSync;
  const prepared = prepareSpawn(command, args, options, ctx);
  return run(prepared.command, prepared.args, prepared.options);
}

// One line naming the real cause: the spawn error, the exit status and the last stderr line.
function describeSpawnFailure(label, result, { limit = 200 } = {}) {
  if (!result) return `${label} returned no result`;
  const tail = String(result.stderr || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || "";
  const clean = tail.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
  if (result.error) return `${label} could not run: ${result.error.code || "error"} ${result.error.message}${clean ? ` (${clean})` : ""}`;
  if (result.signal) return `${label} stopped by ${result.signal}${clean ? ` (${clean})` : ""}`;
  return `${label} exited ${result.status}${clean ? `: ${clean}` : ""}`;
}

module.exports = { describeSpawnFailure, prepareSpawn, quoteCmdArg, spawnTool, whichSync };
