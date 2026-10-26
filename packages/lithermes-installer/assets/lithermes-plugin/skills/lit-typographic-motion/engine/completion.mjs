// When a motion turn counts as done (the route contract's completion rule).
// Only a completed, verified render counts: the manifest and gate report are
// newer than the last brief edit, and either the gate passed with all four
// artifacts delivered, or round 3 of 3 ended in exit 13 with the artifacts in
// the place the failure demands (delivered for an ordinary failure, withheld
// for a flash failure). Started, stills-only, BLOCKED or silent runs never count.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ARTIFACTS = ['film.mp4', 'poster.png', 'reduced-motion.png'];
const previewName = (dir) => ['preview.webp', 'preview.gif'].find((name) => existsSync(join(dir, name)));
const no = (reason) => ({ done: false, reason, downgraded: [] });

// Beats covered by the subject devices (the count the downgrade rule compares).
const subjectBeats = (t) => new Set((t?.visualDevices ?? []).filter((d) => d?.role === 'subject').flatMap((d) => d?.beats ?? [])).size;

// Downgrades from the first valid treatment to the final one. Recorded on the
// result, never a reason to un-count the render.
export function downgrades(first, final) {
  if (!first || !final) return [];
  const items = [];
  if (final.durationSec < first.durationSec * 0.8) items.push(`the film was shortened from ${first.durationSec} s to ${final.durationSec} s`);
  if (subjectBeats(final) < subjectBeats(first)) items.push(`the subject is on screen in fewer beats (${subjectBeats(first)} -> ${subjectBeats(final)})`);
  if (final.sound?.mode === 'none' && first.sound?.mode !== 'none') items.push('the sound was switched to none');
  if (first.path === 'stage' && final.path === 'type') items.push('the path moved from stage to type');
  return items;
}

function downgraded(out) {
  try {
    const first = JSON.parse(readFileSync(join(out, '.run', 'treatment-first.json'), 'utf8'));
    const final = JSON.parse(readFileSync(join(out, 'treatment.json'), 'utf8'));
    return downgrades(first, final);
  } catch { return []; }
}

const withDowngrades = (out, result) => {
  const down = downgraded(out);
  return { ...result, downgraded: down, reason: down.length ? `${result.reason}; downgraded: ${down.join('; ')}` : result.reason };
};

export function checkCompletion(out) {
  const statePath = join(out, 'run-state.json');
  if (!existsSync(statePath)) return no('no run-state.json: the render command never finished');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.exitCode === null || state.exitCode === undefined || !state.finished) return no('the render command started but did not finish');
  if (state.mode === 'stills-only' || state.mode === 'stills' || state.mode === 'sheet') {
    // A film whose treatment asks for a preview is done at its board: a
    // stills-only render whose layout check passed, looked at, storyboard included.
    if (state.exitCode === 0) {
      try {
        const treatment = JSON.parse(readFileSync(join(out, 'treatment.json'), 'utf8'));
        if (treatment?.preview === true) {
          const check = JSON.parse(readFileSync(join(out, 'stills', 'check.json'), 'utf8'));
          const failed = (check.rules || []).filter((rule) => rule.status === 'FAIL');
          if (!failed.length && existsSync(join(out, 'stills', 'board.png'))) return withDowngrades(out, { done: true, reason: 'preview film: board check passed' });
          return no(`the preview board check did not pass (${failed.map((rule) => rule.id).join(', ') || 'no board'}); fix the page and render --stills-only again`);
        }
      } catch { /* fall through to the stills-only rule */ }
    }
    return no('a stills-only look pass is not a delivered film');
  }
  if ([10, 11, 12, 14, 15].includes(state.exitCode)) return no(`BLOCKED exit ${state.exitCode}: fix the named prerequisite and rerun`);
  if (state.exitCode !== 0 && state.exitCode !== 13) return no(`the command exited ${state.exitCode}`);
  const manifestPath = join(out, 'manifest.json'), reportPath = join(out, 'gate-report.txt');
  if (!existsSync(manifestPath)) return no('manifest.json is missing');
  if (!existsSync(reportPath)) return no('gate-report.txt is missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const brief = manifest.lithermes?.brief;
  if (!brief?.path || !existsSync(brief.path)) return no('the manifest does not name an existing brief');
  const briefTime = statSync(brief.path).mtimeMs;
  if (statSync(manifestPath).mtimeMs < briefTime || statSync(reportPath).mtimeMs < briefTime) return no('the brief changed after the last render; rerun');
  if (createHash('sha256').update(readFileSync(brief.path)).digest('hex') !== brief.sha256) return no('the brief no longer matches the rendered one; rerun');
  const report = readFileSync(reportPath, 'utf8');
  const failed = state.failed || [];
  const flash = failed.includes('MO-C-03');
  const delivered = ARTIFACTS.every((name) => existsSync(join(out, name))) && previewName(out);
  const withheldDir = join(out, 'withheld');
  const withheld = ARTIFACTS.every((name) => existsSync(join(withheldDir, name))) && previewName(withheldDir);
  if (state.exitCode === 0) {
    if (!/QA gate: PASS/.test(report)) return no('exit 0 without a passing gate report');
    return delivered ? withDowngrades(out, { done: true, reason: 'gate passed; four artifacts delivered' }) : no('gate passed but an artifact is missing from its deliverable name');
  }
  if ((state.round ?? manifest.lithermes?.round ?? 1) < 3) return no(`gate failed in round ${state.round}; fix the named rules and rerun with --round ${(state.round || 1) + 1}`);
  if (flash) {
    if (delivered || ['film.mp4', 'poster.png', 'preview.webp', 'preview.gif'].some((name) => existsSync(join(out, name)))) return no('a flash-failing export sits at a deliverable name');
    if (!withheld) return no('flash failure without the exports in withheld/');
    if (!/WITHHELD/.test(report)) return no('the report does not say the render is withheld');
    return withDowngrades(out, { done: true, reason: 'round 3 flash failure: exports withheld pending a fix' });
  }
  if (!delivered) return no('round 3 failure but the artifacts are not at their deliverable names');
  if (!failed.length || !failed.every((id) => report.includes(id))) return no('the report does not name the failed rules');
  return withDowngrades(out, { done: true, reason: `round 3 ended with ${failed.join(', ')} failing; artifacts delivered with the report` });
}
