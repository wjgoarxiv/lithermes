#!/usr/bin/env node
// LitHermes Office runtime. All dependencies live outside the installed plugin.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, cpSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawnFailure, pickPython, spawnTool, venvPython, whichSync } from './hostexec.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, '..', '..');
const runtime = join(root, 'runtime');
const digest = createHash('sha256').update(readFileSync(join(runtime, 'package-lock.json'))).update(readFileSync(join(runtime, 'requirements.lock'))).digest('hex').slice(0, 16);
const cacheBase = process.env.XDG_CACHE_HOME || join(process.env.HERMES_HOME || process.env.HOME || homedir(), '.cache');
const cache = join(cacheBase, 'lithermes', 'office', digest);
const nodeCache = join(cache, 'node');
const pythonCache = join(cache, 'python');
const python = venvPython(pythonCache);
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const nodeSupported = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 9);
const ready = () => existsSync(join(cache, 'READY')) && existsSync(join(nodeCache, 'node_modules', 'pptxgenjs')) && existsSync(join(nodeCache, 'node_modules', 'sharp')) && existsSync(python);
const run = (command, args, options = {}) => {
  const result = spawnTool(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(describeSpawnFailure(`${command} ${args[0] ?? ''}`.trim(), result));
};

function install() {
  if (ready()) return;
  const host = pickPython({ env: process.env, override: 'LITHERMES_OFFICE_BOOTSTRAP_PYTHON', min: [3, 10] });
  if (!host.python) throw new Error(`OFFICE_RUNTIME_PYTHON_UNAVAILABLE: ${host.detail}. Fix: install Python 3.14 (any 3.10 to 3.14 works) or set LITHERMES_OFFICE_BOOTSTRAP_PYTHON to one.`);
  mkdirSync(cache, { recursive: true });
  const staging = join(cache, `staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  console.error('LitHermes Office: installing pinned dependencies in the product cache (first use).');
  try {
    const nodeStage = join(staging, 'node');
    mkdirSync(nodeStage);
    for (const name of ['package.json', 'package-lock.json']) cpSync(join(runtime, name), join(nodeStage, name));
    run('npm', ['ci', '--prefix', nodeStage, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { env: { ...process.env, npm_config_cache: join(cache, 'npm-cache') } });
    const pythonStage = join(staging, 'python');
    run(host.python, ['-m', 'venv', pythonStage]);
    run(venvPython(pythonStage), ['-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '-r', join(runtime, 'requirements.lock')]);
    rmSync(nodeCache, { recursive: true, force: true });
    rmSync(pythonCache, { recursive: true, force: true });
    renameSync(nodeStage, nodeCache);
    renameSync(pythonStage, pythonCache);
    writeFileSync(join(cache, 'READY'), digest + '\n');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const [action, ...args] = process.argv.slice(2);
if (action === 'doctor') {
  const tools = ['soffice', 'pandoc', 'xelatex'].map(name => `${name}=${whichSync(name) ? 'available' : 'missing'}`);
  console.log(`office-runtime=${ready() ? 'READY' : 'NOT_INSTALLED'} node=${nodeSupported ? 'supported' : 'requires-20.9+'} cache=${cache} ${tools.join(' ')}`);
  process.exit(0);
}
const target = {
  pptx: ['node', join(root, 'scripts', 'compile-deck.js')],
  qa: [python, join(root, 'scripts', 'qa_deck.py')],
  integrity: [python, join(root, 'scripts', 'integrity.py')],
  docx: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'convert_md_to_docx.py')],
  edit: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'edit_docx.py')],
  pdf: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'convert_md_to_pdf.py')],
  audit: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'visual_audit.py')],
  gate: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'docx_gate.py')],
  lint: [python, join(plugin, 'skills', 'lit-docx', 'scripts', 'slop_lint.py')],
  learn: [python, join(root, 'scripts', 'learn_template.py')],
}[action];
if (!target) {
  console.error('usage: node office.mjs doctor|pptx|qa|integrity|docx|edit|pdf|audit|gate|lint|learn [arguments]');
  process.exit(2);
}
if (!nodeSupported) throw new Error('LitHermes Office requires Node.js 20.9 or newer for its pinned image runtime');
install();
const env = { ...process.env, NODE_PATH: join(nodeCache, 'node_modules'), LITHERMES_OFFICE_PYTHON: python };
// The tool's own exit code is the command's exit code: a failed gate must not read as success.
const child = spawnTool(target[0], [target[1], ...args], { stdio: 'inherit', env });
if (child.error) {
  console.error(describeSpawnFailure(`${target[0]} ${target[1]}`, child));
  process.exit(1);
}
process.exit(child.status ?? 1);
