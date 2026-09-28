// Look rounds and the done-check, shared by both paths. Only `look` writes
// look.json; each round is stamped with the SHA-256 of the render's manifest
// and of every frame it lists, and only frames from the latest stills set are
// accepted. `complete` then decides done from the gate, the treatment, the
// rounds and (when the Hermes tool hook is live) the vision_analyze receipts.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkCompletion } from './completion.mjs';
import { writeJson } from './director.mjs';
import { validateTreatment } from './treatment.mjs';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const usage = (message) => Object.assign(new Error(message), { exitCode: 2 });
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const QUESTIONS = Object.freeze({
  1: 'A stranger would say this film is for: <...>',
  2: 'Does every beat show its onScreen plan?',
  3: 'Is the craft at the level ambition asks for (transitions, rhythm, depth, hierarchy)?',
  4: 'Is any request text, meta label, placeholder, file name or internal term on screen?',
  5: 'Does the ending land?',
  6: 'Does the sound follow the cuts? (answer from sound-cues.json)',
  7: 'Name one thing a skilled motion designer, given only the request, would have shown that this film does not.',
  8: 'Is any element on screen without a job in its beat?',
  9: 'Could every copy line be pasted unchanged into a film about a different subject?',
});
const NEED_YES = new Set([1, 2, 3, 5, 6]);
const NEED_NO = new Set([4, 8, 9]);
const BARE = /^(?:yes|no|y|n|ok|okay|none|n\/a|네|예|아니오|아니요|아니|응|없음|있음)[.!]?$/iu;

export function verdictOf(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (/^(?:yes|y|true|예|네|응)$/u.test(v)) return 'yes';
  if (/^(?:no|n|false|아니오|아니요|아니)$/u.test(v)) return 'no';
  if (/^(?:named|yes-named)$/u.test(v)) return 'named';
  if (/^(?:none|없음)$/u.test(v)) return 'none';
  return v;
}

// A concrete observation is at least one sentence: several words (or, for
// Hangul, several syllables), not a bare verdict.
export function concrete(observed) {
  const s = String(observed ?? '').trim();
  if (!s || BARE.test(s)) return false;
  const words = s.split(/\s+/u).filter(Boolean).length;
  const hangul = (s.match(/[가-힣]/gu) || []).length;
  return words >= 4 || hangul >= 8;
}

export function readStillsSet(out) {
  const file = join(out, 'stills', 'stills.json');
  if (!existsSync(file)) throw usage(`no stills set in ${out}; render with --stills-only (round 1) or a full render first`);
  return readJson(file);
}

export function readLook(out) {
  const file = join(out, 'look.json');
  return existsSync(file) ? readJson(file) : { schema: 'lithermes.look/v1', rounds: [] };
}

const stillsOnlyMode = (mode) => /stills/u.test(String(mode || ''));

export function recordLook(out, round, answers) {
  if (![1, 2, 3].includes(round)) throw usage('--round must be 1, 2 or 3');
  const set = readStillsSet(out);
  if (set.round !== round) throw usage(`the latest stills set belongs to round ${set.round}; renders and looks share one counter, so record look --round ${set.round}`);
  const look = readLook(out);
  if (look.rounds.some((r) => r.round >= round)) throw usage(`look round ${round} (or a later one) is already recorded; render the next round first`);
  if (!existsSync(join(out, 'manifest.json'))) throw usage('no manifest.json for the latest stills set');
  const manifestSha256 = sha(readFileSync(join(out, 'manifest.json')));
  if (set.manifestSha256 && set.manifestSha256 !== manifestSha256) throw usage('the stills set does not belong to the current manifest; render again');
  const base = { round, at: new Date().toISOString(), manifestSha256, stillsSha256: sha(readFileSync(join(out, 'stills', 'stills.json'))), stillsMode: set.mode };

  if (answers.blocked === 'no-vision-tool') {
    look.rounds.push({ ...base, blocked: 'no-vision-tool', frames: [], answers: [], another: false, reasons: [] });
    writeJson(join(out, 'look.json'), look);
    return look.rounds.at(-1);
  }

  const files = new Map(set.files.map((f) => [f.file, f]));
  const viewed = [...new Set(answers.viewed || [])];
  if (!viewed.length) throw usage('list every stills file you viewed in "viewed"');
  const answerList = Array.isArray(answers.answers) ? answers.answers : [];
  const frames = [];
  for (const file of new Set([...viewed, ...answerList.map((a) => a.frame)])) {
    if (!files.has(file)) throw usage(`${file} is not in the latest stills set (stills/stills.json); look only at frames that set lists`);
    const onDisk = sha(readFileSync(join(out, file)));
    if (onDisk !== files.get(file).sha256) throw usage(`${file} changed after the stills set was written; render again`);
    if (viewed.includes(file)) frames.push({ file, sha256: onDisk });
  }
  for (const q of Object.keys(QUESTIONS).map(Number)) {
    if (!answerList.some((a) => Number(a.q) === q)) throw usage(`question ${q} is unanswered: ${QUESTIONS[q]}`);
  }
  const reasons = [];
  for (const a of answerList) {
    const q = Number(a.q);
    if (!QUESTIONS[q]) throw usage(`unknown question ${a.q}`);
    if (!a.frame) throw usage(`question ${q} names no frame`);
    if (!concrete(a.observed)) throw usage(`question ${q}: "observed" must be at least one sentence naming a concrete visible detail in ${a.frame}, not a bare yes or no`);
    const verdict = verdictOf(a.verdict);
    if (q === 1) {
      if (!['blind', 'self'].includes(a.by)) throw usage('question 1 needs "by": "blind" (a fresh delegate_task subagent) or "self"');
      if (a.by === 'blind' && !concrete(a.stranger)) throw usage('question 1 answered blind needs the subagent\'s sentence, verbatim, in "stranger"');
    }
    if (NEED_YES.has(q) && verdict === 'no') reasons.push(`Q${q}: no`);
    if (NEED_NO.has(q) && verdict === 'yes') reasons.push(`Q${q}: yes`);
    if (q === 7 && verdict !== 'none') reasons.push('Q7: a designer would have shown something this film does not');
  }
  if (round === 1) {
    if (!stillsOnlyMode(set.mode)) throw usage('round 1 is a stills round: render with --stills-only --round 1 before the first full render');
    if (!concrete(answers.change)) throw usage('round 1 must name the weakest beat and the change you made in "change"');
  }
  look.rounds.push({ ...base, frames, answers: answerList, change: answers.change || null, aids: answers.aids || [], another: reasons.length > 0, reasons });
  writeJson(join(out, 'look.json'), look);
  return look.rounds.at(-1);
}

export async function lookCommand(flags) {
  const out = resolve(flags.out || 'motion-output');
  try {
    if (!flags.answers) throw usage('look needs --answers FILE (see references/craft-loop.md)');
    const file = resolve(flags.answers);
    if (!existsSync(file)) throw usage(`answers file not found: ${file}`);
    let answers;
    try { answers = readJson(file); } catch (error) { throw usage(`answers file is not valid JSON: ${error.message}`); }
    const round = recordLook(out, Number(flags.round), answers);
    if (round.blocked) {
      console.log(`look round ${round.round} recorded as blocked: no image tool reached the frames; the done-check will end DONE_UNVIEWED and the reply must say nobody viewed the frames`);
      return 0;
    }
    console.log(`look round ${round.round} recorded: ${round.frames.length} frames viewed (manifest ${round.manifestSha256.slice(0, 12)})`);
    if (round.another) console.log(`another round is due (${round.reasons.join('; ')})${round.round >= 3 ? '; this was round 3 of 3: deliver with these open items stated plainly' : `; revise and render --round ${round.round + 1}`}`);
    else if (round.round === 1) console.log('round 1 done: make the change you named, then render the film with --round 2');
    return 0;
  } catch (error) {
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    return error.exitCode ?? 1;
  }
}

// ---------------------------------------------------------------------------

const SILENT_REQUEST = /무음|소리\s*없|음악\s*없|(?<![A-Za-z])(?:silent|silence|no\s+(?:sound|music|audio)|without\s+(?:sound|music|audio)|muted?)(?![A-Za-z])/iu;
const subjectSeconds = (t) => {
  const beats = new Set((t.visualDevices || []).filter((d) => d.role === 'subject').flatMap((d) => d.beats || []));
  return { count: beats.size };
};

export function downgrades(first, final) {
  const out = [];
  if (!first || !final) return out;
  if (final.durationSec < 0.8 * first.durationSec) out.push(`durationSec dropped from ${first.durationSec} s to ${final.durationSec} s`);
  if (subjectSeconds(final).count < subjectSeconds(first).count) out.push(`fewer subject beats (${subjectSeconds(first).count} -> ${subjectSeconds(final).count})`);
  if (first.sound?.mode !== 'none' && final.sound?.mode === 'none' && !SILENT_REQUEST.test(final.request || '')) out.push('sound changed to none without a user request');
  if (first.path === 'stage' && final.path === 'type') out.push('path changed from stage to type');
  return out;
}

function hostReceipts(out) {
  const file = join(out, '.run', 'host-events.jsonl');
  if (!existsSync(file)) return null;
  const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { events, viewed: new Set(events.filter((e) => e.tool === 'vision_analyze').map((e) => `${e.file}|${e.sha256}`)) };
}

// Done (craft-loop.md): gate PASS, a valid treatment, a stills round 1 with a
// change and a last round on the final render that viewed the whole set.
export function checkDone(out) {
  const no = (reason, extra = {}) => ({ done: false, status: 'NOT COMPLETE', reason, ...extra });
  const statePath = join(out, 'run-state.json');
  if (!existsSync(statePath)) return no('no run-state.json: no render finished in this directory');
  const state = readJson(statePath);
  if (!state.finished || state.exitCode === null || state.exitCode === undefined) return no('the render command started but did not finish');
  if (stillsOnlyMode(state.mode)) return no('the last render was a stills round; render the film');
  if (state.exitCode !== 0) return no(`the last render exited ${state.exitCode}${state.failed?.length ? ` (${state.failed.join(', ')})` : ''}; done needs a passing gate`);
  if (state.path !== 'stage') {
    const render = checkCompletion(out);
    if (!render.done) return no(render.reason);
  }
  const treatmentFile = join(out, 'treatment.json');
  if (!existsSync(treatmentFile)) return no('treatment.json is missing');
  const treatment = readJson(treatmentFile);
  const valid = validateTreatment(treatment, { outDir: out });
  if (!valid.ok) return no(`treatment.json no longer validates (field ${valid.field})`);
  const firstFile = join(out, '.run', 'treatment-first.json');
  const downgraded = downgrades(existsSync(firstFile) ? readJson(firstFile) : null, treatment);
  const manifestSha256 = sha(readFileSync(join(out, 'manifest.json')));
  const set = readStillsSet(out);
  const look = readLook(out);
  const rounds = look.rounds;
  const extra = { downgraded };
  if (!rounds.length) return no('no look round is recorded; view the stills and record them with `look`', extra);
  const last = rounds.at(-1);
  if (rounds.some((r) => r.blocked === 'no-vision-tool')) {
    if (last.manifestSha256 !== manifestSha256) return no('the last look round is older than the final render', extra);
    return { done: true, status: 'DONE_UNVIEWED', reason: 'the gate passed but no image tool could view the frames; say plainly that nobody viewed them', ...extra };
  }
  if (rounds.length < 2) return no('done needs two look rounds: the round-1 stills round and a last round on the final render', extra);
  const first = rounds[0];
  if (first.round !== 1 || !stillsOnlyMode(first.stillsMode) || !first.change) return no('round 1 must be a stills round that names a change', extra);
  if (last.manifestSha256 !== manifestSha256) return no('the last look round was recorded against an older render; look at the final render and record a round', extra);
  if (stillsOnlyMode(last.stillsMode)) return no('the last look round viewed stills, not the final render', extra);
  const seen = new Map(last.frames.map((f) => [f.file, f.sha256]));
  const missing = set.files.filter((f) => seen.get(f.file) !== f.sha256).map((f) => f.file);
  if (missing.length) return no(`the last round did not view ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` (+${missing.length - 4} more)` : ''}`, extra);
  const receipts = hostReceipts(out);
  if (receipts) {
    const unviewed = set.files.filter((f) => !receipts.viewed.has(`${f.file}|${f.sha256}`)).map((f) => f.file);
    if (unviewed.length) return no(`the tool hook saw no vision_analyze call on ${unviewed.slice(0, 4).join(', ')}${unviewed.length > 4 ? ` (+${unviewed.length - 4} more)` : ''}`, extra);
  }
  if (last.another && last.round < 3) return no(`the last look round asks for another round (${last.reasons.join('; ')})`, extra);
  const openItems = last.another ? last.reasons : [];
  return { done: true, status: 'COMPLETE', reason: `gate passed; ${rounds.length} look rounds; the last viewed all ${set.files.length} stills of the final render${receipts ? ' (vision_analyze receipts matched)' : ''}`, openItems, ...extra };
}

export function completeCommand(out) {
  const result = checkDone(out);
  if (existsSync(out)) writeJson(join(out, 'done.json'), { ...result, at: new Date().toISOString() });
  console.log(`${result.status}: ${result.reason}`);
  for (const item of result.downgraded || []) console.log(`downgraded: ${item}`);
  for (const item of result.openItems || []) console.log(`open item: ${item}`);
  return result.done ? 0 : 1;
}
