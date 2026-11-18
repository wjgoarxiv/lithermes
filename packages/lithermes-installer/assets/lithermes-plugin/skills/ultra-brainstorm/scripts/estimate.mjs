#!/usr/bin/env node
// The launch question's cost line for a Hermes ultra-brainstorm run.
//
//   node <skill-root>/scripts/estimate.mjs <children> [--json] [--config <path to config.yaml>]
//
// Hermes picks every delegate_task child's model from the profile's `delegation.model` (empty means
// the session's own model) and its effort from `delegation.reasoning_effort`; a child cannot ask for
// another model. So the line names what this profile will really use, read from its config.yaml
// (HERMES_HOME, else ~/.hermes), and how many batches `delegation.max_concurrent_children` allows.
// The token figure is a planning range, never a bill. Read-only.
//
// Calibration (2026-11-18, this host's own session store, read-only): a delegate_task child keeps
// the parent's toolsets, so its first call already carries Hermes' system prompt and every tool
// schema, measured at about 20k input tokens per first call (17 core tools alone are ~8k). A
// no-tool idea child is that one call plus at most five ideas back. A reducer reads thirty
// children's ideas on top of the same prompt. The judge is this session, so its share depends on
// how long the session already is.
//
// The session's own share is the largest part. Every batch it launches comes back as further
// turns, and each turn replays the whole session context. A live run (2026-11-18, 30 children in
// 3 batches) measured ~1.58M tokens in the session itself, about 0.53M per batch, while the 21
// recorded children averaged ~20k each.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IDEA_TOKENS = Object.freeze({ low: 20_000, high: 28_000 });
export const REDUCER_TOKENS = Object.freeze({ low: 60_000, high: 90_000 });
export const JUDGE_TOKENS = Object.freeze({ low: 40_000, high: 120_000 });
export const SESSION_PER_BATCH = Object.freeze({ low: 350_000, high: 530_000 });
export const PER_REDUCER = 30;
export const MAX_CHILDREN = 900;
const DEFAULT_CONCURRENCY = 10;

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/u, '$2').trim();

/** The three `delegation:` keys the line needs, from a config.yaml text. Anything unreadable is empty. */
export const delegationSettings = (yamlText) => {
  const settings = { model: '', effort: '', concurrency: DEFAULT_CONCURRENCY };
  const lines = String(yamlText ?? '').split(/\r?\n/u);
  const start = lines.findIndex((line) => /^delegation:\s*$/u.test(line));
  if (start === -1) return settings;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const match = /^\s{2}([a-z_]+):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    const value = unquote(raw.replace(/\s+#.*$/u, ''));
    if (key === 'model') settings.model = value;
    else if (key === 'reasoning_effort') settings.effort = value;
    else if (key === 'max_concurrent_children' && /^\d{1,3}$/u.test(value) && Number(value) > 0) settings.concurrency = Number(value);
  }
  return settings;
};

export const readDelegationSettings = (configPath) => {
  try {
    return delegationSettings(readFileSync(configPath, 'utf8'));
  } catch {
    return delegationSettings('');
  }
};

export const estimate = (children, settings = delegationSettings('')) => {
  if (!Number.isInteger(children) || children < 1) throw new Error('children must be a positive whole number');
  if (children > MAX_CHILDREN) throw new Error(`at most ${MAX_CHILDREN} idea children per run; split a larger run`);
  const reducers = Math.ceil(children / PER_REDUCER);
  const batches = Math.ceil(children / settings.concurrency);
  const total = (end) => children * IDEA_TOKENS[end] + reducers * REDUCER_TOKENS[end] + JUDGE_TOKENS[end]
    + batches * SESSION_PER_BATCH[end];
  return { children, reducers, judges: 1, batches, perBatch: settings.concurrency, model: settings.model || null, effort: settings.effort || null, tokens: { low: total('low'), high: total('high') } };
};

export const costLine = (children, settings) => {
  const run = estimate(children, settings);
  const model = run.model ? `delegation.model ${run.model}` : 'the session model (delegation.model is empty)';
  const effort = run.effort ? `effort ${run.effort}` : 'default effort';
  return `${run.children} idea children on ${model}, ${effort}, in ${run.batches} batches of ${run.perBatch} + ${run.reducers} reducer children + 1 judge (this session) ≈ ${(run.tokens.low / 1_000_000).toFixed(1)}M–${(run.tokens.high / 1_000_000).toFixed(1)}M tokens`;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const configAt = args.indexOf('--config');
  const configPath = configAt !== -1 && args[configAt + 1]
    ? args[configAt + 1]
    : join(process.env.HERMES_HOME || join(process.env.HOME || homedir(), '.hermes'), 'config.yaml');
  const count = Number(args.find((arg) => /^\d+$/u.test(arg)));
  try {
    const settings = readDelegationSettings(configPath);
    process.stdout.write(`${json ? JSON.stringify(estimate(count, settings)) : costLine(count, settings)}\n`);
  } catch (error) {
    process.stderr.write(`estimate: ${error.message}\n`);
    process.exitCode = 64;
  }
}
