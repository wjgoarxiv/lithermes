#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(scriptDir, '../../..');
const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(name);
  return index < 0 ? null : argv[index + 1];
};
const url = option('--url');
const source = option('--static');
const out = option('--out');
if (!out || (!url && !source)) {
  process.stderr.write('usage: probe.mjs --url <http(s) URL> --out <directory> [--static <HTML/CSS/JSX path>]\n');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const thresholds = JSON.parse(readFileSync(join(scriptDir, 'probe-rules.json'), 'utf8'));
const referenceDir = resolve(scriptDir, '../references');
const allRules = [...new Set(['craft-floor.md', 'slop-register.md'].flatMap((name) =>
  [...readFileSync(join(referenceDir, name), 'utf8').matchAll(/^\| ((?:CF|RS|SLOP)-\d{3}) \|/gm)].map((match) => match[1])))];
const staticRules = new Set(['SLOP-058', 'CF-503', 'SLOP-009', 'SLOP-057', 'SLOP-060', 'SLOP-061', 'CF-507']);
const liveRules = new Set(['RS-001', 'RS-002', 'RS-003', 'RS-006', 'RS-007', 'RS-008', 'CF-101', 'CF-102', 'CF-103',
  'CF-107', 'CF-201', 'CF-202', 'CF-205', 'CF-401', 'CF-404', 'CF-406', 'CF-503', 'CF-507', 'CF-603', 'CF-701', 'CF-806', 'CF-807', 'SLOP-008',
  'SLOP-009', 'SLOP-036', 'SLOP-040', 'SLOP-053', 'SLOP-057', 'SLOP-058', 'SLOP-059', 'SLOP-060', 'SLOP-061']);
const notVerified = allRules.filter((rule) => !staticRules.has(rule))
  .map((rule) => ({ rule, reason: 'static fallback: needs a rendered DOM or reviewer' }));

function staticFallback(file) {
  if (!file || !existsSync(file)) return { findings: [], not_verified: notVerified, source: null };
  const findings = [];
  const visit = (item) => {
    const info = lstatSync(item);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const child of readdirSync(item)) {
        if (child === 'node_modules' || child === '.git') continue;
        visit(join(item, child));
      }
      return;
    }
    const extension = extname(item).toLowerCase();
    if (!['.html', '.htm', '.css', '.js', '.jsx', '.tsx'].includes(extension)) return;
    const contents = readFileSync(item, 'utf8');
    const add = (rule, value, threshold, severity = 'MEDIUM', tier = 'measured', match = null) => findings.push({
      rule, severity, tier, viewport: 'static', selector: `${item}:${match ? contents.slice(0, match.index).split('\n').length : 1}`,
      value, threshold,
    });
    if (['.html', '.htm', '.jsx', '.tsx'].includes(extension) && /href\s*=\s*["'](?:#|javascript:[^"']*)["']/i.test(contents))
      add('SLOP-058', 'placeholder destination', 'working destination', 'MEDIUM', 'derived', /href\s*=\s*["'](?:#|javascript:[^"']*)["']/i.exec(contents));
    if (/scale\(\s*0(?:[\s,)]|$)/i.test(contents)) add('CF-503', 'scale(0)', thresholds.entranceScaleMinimum, 'LOW', 'derived', /scale\(\s*0(?:[\s,)]|$)/i.exec(contents));
    if (/background-clip\s*:\s*text[^}]*gradient\(/is.test(contents) || /gradient\([^}]*background-clip\s*:\s*text/is.test(contents))
      add('SLOP-009', 'gradient text', 'solid text');
    if (/<img\b[^>]*\bsrc\s*=\s*["'](?:|#|undefined)["']/i.test(contents)) add('SLOP-057', 'broken source', 'decodable image', 'HIGH');
    if (/lorem ipsum|\[placeholder\]|\bTODO\b/i.test(contents)) add('SLOP-060', 'placeholder copy', 'finished copy', 'LOW');
    if (/<marquee\b/i.test(contents)) add('SLOP-061', 'marquee', 'stationary copy');
    if (/will-change\s*:\s*(?:all|width|height|margin|padding)/i.test(contents)) add('CF-507', 'layout property', 'active compositor property');
  };
  visit(file);
  return { findings, not_verified: notVerified, source: file };
}

function save(report) {
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ manifest: report.manifest, findings: report.findings }, null, 2)}\n`);
  const rows = report.findings.map((entry) =>
    `| ${entry.severity} | ${entry.rule} | ${entry.selector || 'source'} @ ${entry.viewport} | ${entry.tier}: ${JSON.stringify(entry.value)} (floor ${JSON.stringify(entry.threshold)}) | ${fixFor(entry.rule)} |`);
  writeFileSync(join(out, 'review.md'), [
    '| Severity | Rule | Where | Measured | Fix |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Not verified',
    '',
    ...report.not_verified.map(({ rule, viewport, reason }) => `- ${rule}${viewport ? ` @ ${viewport}` : ''}: ${reason}`),
    '',
    `Decision: ${report.manifest.exit_code === 2 ? 'BLOCKED' : report.manifest.exit_code === 1 ? 'Block' : 'Approve'}`,
    '',
  ].join('\n'));
  process.stdout.write(report.manifest?.blocked_reason ? `BLOCKED: ${report.manifest.blocked_reason}\n` :
    `${report.findings.length} findings; ${report.manifest?.exit_code === 1 ? 'Block' : 'Approve'}\n`);
}

function fixFor(rule) {
  const named = { 'RS-006': 'Remove page overflow or contain the intentional rail',
    'RS-007': 'Restore readable text and its container', 'CF-201': 'Use a contrasting ink or surface',
    'CF-701': 'Expand the target without shifting visual hierarchy', 'CF-503': 'Start entrance at or above the scale floor',
    'SLOP-058': 'Use a working destination', 'SLOP-060': 'Replace unfinished copy' };
  return named[rule] || 'Review the numbered rule and correct the smallest cause';
}

const fallback = staticFallback(source);
if (!url) {
  save({ manifest: { url: null, viewports_run: [], browser_version: null, not_verified: fallback.not_verified,
    screenshots: [], exit_code: 2, blocked_reason: 'browser unavailable' }, findings: fallback.findings, status: 'BLOCKED: browser unavailable', not_verified: fallback.not_verified });
  process.exit(2);
}
const origin = JSON.parse(readFileSync(resolve(pluginDir, 'skills/browser-drive/ORIGIN.json'), 'utf8'));
if (origin.schema !== 'lithermes.browser-drive-origin/v1' || origin.package?.name !== 'agent-browser' ||
    !origin.package.dist?.integrity || !origin.verifiedVersionFloor) {
  save({ status: 'BLOCKED: browser identity unverified', findings: fallback.findings, not_verified: fallback.not_verified,
    manifest: { url: null, viewports_run: [], browser_version: null, not_verified: fallback.not_verified, screenshots: [], exit_code: 2, blocked_reason: 'browser identity unverified' } });
  process.exit(2);
}
let capability;
try {
  capability = JSON.parse(execFileSync('python3', [resolve(pluginDir, 'skills/browser-drive/scripts/capability_probe.py')],
    { encoding: 'utf8', timeout: 15000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
} catch {
  save({ status: 'BLOCKED: browser unavailable', findings: fallback.findings, not_verified: fallback.not_verified,
    manifest: { url: null, viewports_run: [], browser_version: null, not_verified: fallback.not_verified, screenshots: [], exit_code: 2, blocked_reason: 'browser unavailable' } });
  process.exit(2);
}
if (capability.status !== 'available' || !capability.command) {
  save({ status: 'BLOCKED: browser unavailable', findings: fallback.findings, not_verified: fallback.not_verified,
    manifest: { url: null, viewports_run: [], browser_version: null, not_verified: fallback.not_verified, screenshots: [], exit_code: 2, blocked_reason: 'browser unavailable' } });
  process.exit(2);
}

const session = `lhui-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const script = readFileSync(join(scriptDir, 'probe-page.js'), 'utf8');
const socketDir = mkdtempSync(join(tmpdir(), 'lhui-ab-'));
const browserEnv = { ...process.env, AGENT_BROWSER_IDLE_TIMEOUT_MS: '120000', AGENT_BROWSER_HIDE_SCROLLBARS: 'true',
  AGENT_BROWSER_SOCKET_DIR: socketDir };
const cases = [
  { name: '320', width: 320, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '390-dark', width: 390, height: 844, dark: true },
  { name: '390-reduced-motion', width: 390, height: 844, reduced: true },
  { name: '1440-zoom200', width: thresholds.zoomWidthPx, height: thresholds.zoomHeightPx, zoom: 200 },
];
const run = (...args) => {
  const result = spawnSync(capability.command, ['--session', session, ...args], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    env: browserEnv,
  });
  if (result.status !== 0 || result.error) throw new Error(`${args[0]}: ${result.error?.message || result.stderr?.slice(-500) || result.status}`);
  return result.stdout.trim();
};
const findings = [];
const screenshots = [];
const unverified = [];
const completed = [];
let report;
let contextStarted = false;
try {
  for (const item of cases) {
    run('set', 'viewport', String(item.width), String(item.height));
    contextStarted = true;
    run('set', 'media', item.dark ? 'dark' : 'light', ...(item.reduced ? ['reduced-motion'] : []));
    run('open', url);
    run('wait', '1200');
    const raw = spawnSync(capability.command, ['--session', session, 'eval', '--stdin'], {
      input: script.replace('__UIUX_THRESHOLDS__', JSON.stringify(thresholds)).replace('__UIUX_VIEWPORT__', JSON.stringify(item.name)),
      encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, env: browserEnv,
    });
    if (raw.status !== 0 || raw.error) throw new Error(`eval ${item.name}: ${raw.error?.message || raw.stderr?.slice(-500) || raw.status}`);
    let value = JSON.parse(raw.stdout.trim());
    if (typeof value === 'string') value = JSON.parse(value);
    if (!Array.isArray(value.findings)) throw new Error(`eval ${item.name}: invalid findings`);
    if (value.readyState !== 'complete') {
      run('wait', '1200');
      const retry = spawnSync(capability.command, ['--session', session, 'eval', '--stdin'], {
        input: script.replace('__UIUX_THRESHOLDS__', JSON.stringify(thresholds)).replace('__UIUX_VIEWPORT__', JSON.stringify(item.name)),
        encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, env: browserEnv,
      });
      if (retry.status !== 0) throw new Error(`eval ${item.name}: retry failed`);
      value = JSON.parse(retry.stdout.trim());
      if (typeof value === 'string') value = JSON.parse(value);
    }
    if (value.url !== url || value.readyState !== 'complete' || value.bodyElements < 1 || value.viewport !== item.name)
      throw new Error(`eval ${item.name}: page identity or layout state unverified`);
    findings.push(...value.findings);
    unverified.push(...allRules.filter((rule) => !liveRules.has(rule))
      .map((rule) => ({ rule, viewport: item.name, reason: 'probe has no deterministic implementation; review checklist' })),
    ...(value.not_verified || []));
    if (value.hover_target) {
      run('hover', value.hover_target);
      const hover = run('eval', `(() => { const element = document.querySelector(${JSON.stringify(value.hover_target)}); return JSON.stringify({ active: element?.matches(':hover'), duration: getComputedStyle(element).transitionDuration }); })()`);
      const state = JSON.parse(JSON.parse(hover));
      if (state.active) {
        const duration = Math.max(0, ...state.duration.split(',').map((part) => {
          const value = part.trim(); return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
        }));
        if (duration > thresholds.hoverMaximumMs) findings.push({ rule: 'CF-506', severity: 'LOW', tier: 'measured', viewport: item.name,
          selector: value.hover_target, value: duration, threshold: thresholds.hoverMaximumMs });
      } else unverified.push({ rule: 'CF-506', viewport: item.name, reason: 'hover state unverified' });
    }
    const capture = resolve(out, `${item.name}.png`);
    run('screenshot', capture);
    run('errors');
    screenshots.push({ viewport: item.name, path: capture });
    completed.push(item.name);
  }
  const exitCode = findings.some((entry) => entry.severity === 'HIGH' && entry.tier !== 'not_verified') ? 1 :
    completed.length === cases.length ? 0 : 2;
  report = { status: exitCode ? 'Block' : 'Approve', findings, not_verified: unverified, screenshots,
    manifest: { url, viewports_run: completed, browser_version: capability.version || null, zoom_emulation: 'viewport-halved',
      not_verified: unverified, screenshots, exit_code: exitCode, blocked_reason: exitCode === 2 ? 'matrix incomplete' : null } };
} catch (error) {
  const missing = cases.filter((item) => !completed.includes(item.name)).map((item) => item.name);
  const reason = completed.length ? `matrix incomplete (${missing.join(',')})` : 'browser unavailable';
  const code = findings.some((entry) => entry.severity === 'HIGH' && entry.tier !== 'not_verified') ? 1 : 2;
  const diagnostics = [{ rule: '*', reason: `browser command: ${error.message}` }];
  report = { status: `BLOCKED: ${reason}`, reason: error.message,
    findings: [...findings, ...fallback.findings], not_verified: [...unverified, ...fallback.not_verified, ...diagnostics], screenshots,
    manifest: { url: completed.length ? url : null, viewports_run: completed, browser_version: completed.length ? capability.version || null : null,
      not_verified: [...unverified, ...fallback.not_verified, ...diagnostics], screenshots, exit_code: code, blocked_reason: code === 2 ? reason : null } };
} finally {
  try { run('close'); } catch {
    if (contextStarted) {
      report.status = 'BLOCKED: browser cleanup failed';
      report.manifest.exit_code = 2;
      report.manifest.blocked_reason = 'browser cleanup failed';
    }
  }
  try { rmSync(socketDir, { recursive: true, force: true }); } catch {
    report.status = 'BLOCKED: browser cleanup failed';
    report.manifest.exit_code = 2;
    report.manifest.blocked_reason = 'browser cleanup failed';
  }
}
save(report);
process.exitCode = report.manifest.exit_code;
