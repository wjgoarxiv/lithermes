// treatment.json: the film's plan, written before any render on either path.
// The validator runs before every render (stills-only too) and names the first
// field that breaks a rule; the CLI turns that into exit 16. It checks shape and
// the anti-restatement rules, never taste: taste is the look rounds' job.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENRES = Object.freeze(['announcement', 'brand-mood', 'event', 'explainer', 'motion-graphics', 'type-led', 'other']);
export const ARC_STAGES = Object.freeze({ announcement: 5, 'brand-mood': 4, event: 4, explainer: 4, 'motion-graphics': 5, other: 3 });
export const DEVICE_KINDS = Object.freeze(['illustration', 'diagram', 'chart', 'icon', 'shape', 'path', 'mask', 'depth3d', 'particles', 'grid', 'gradient', 'photo-texture']);
export const TEXTURE_KINDS = Object.freeze(['grid', 'gradient', 'particles', 'photo-texture']);
export const FORMATS = Object.freeze({ '16:9': [1920, 1080], '9:16': [1080, 1920] });
export const SOUND_MODES = Object.freeze(['generated', 'supplied', 'authored', 'none']);
// The families fonts.css serves; the type engine draws from the same set.
export const FACES = Object.freeze(['Pretendard', 'Archivo', 'Galmuri9', 'VT323', 'Silkscreen', 'MesloLGS NF']);
export const SOUND_PALETTES = Object.freeze(['soft-mallet', 'warm-keys', 'glass-pulse', 'low-strings']);
const FLOOR_GENRES = new Set(['announcement', 'event', 'explainer', 'motion-graphics']);
const MIN_BEAT_SEC = 1.2;
const MAX_GAP_SEC = 0.25;

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const normalizeText = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const QUOTED = /"[^"\n]*"|“[^”\n]*”|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z])|「[^」\n]*」/gu;
export const withoutQuoted = (value) => String(value ?? '').replace(QUOTED, ' ');

// Port of this product's router cue (core_routing.motion_cue): a type compound,
// an explicit kinetic-type or lyric ask, or a quoted span of two or more words.
const TYPE_CUE = /타이포\s*모션|키네틱\s*타이포(?:그래피)?|타이포(?:그래피)?\s*영상|가사\s*영상|리릭\s*(?:비디오|영상)|타이틀\s*시퀀스|오프닝\s*타이틀|(?<![A-Za-z])(?:kinetic\s+type(?:graphy)?|typographic\s+motion|typography\s+videos?|lyric\s+videos?|title\s+sequences?|opening\s+titles?)(?![A-Za-z])/iu;
export function typeCue(request) {
  const value = String(request ?? '');
  const compound = value.match(TYPE_CUE);
  if (compound) return compound[0];
  for (const span of value.match(QUOTED) || []) {
    if (span.slice(1, -1).trim().split(/\s+/u).length >= 2) return span;
  }
  return null;
}

const SILENT_REQUEST = /무음|소리\s*없|음악\s*없|(?<![A-Za-z])(?:silent|silence|no\s+(?:sound|music|audio)|without\s+(?:sound|music|audio)|muted?)(?![A-Za-z])/iu;
const LENGTH_REQUEST = /\d+(?:\.\d+)?\s*(?:초|분|s\b|sec|secs|seconds?|min|minutes?)/iu;

// The shared-substring limit: min(10, half the normalized request length).
export function restatementLimit(request) {
  return Math.min(10, Math.floor(normalizeText(withoutQuoted(request)).length / 2));
}

export function sharesSubstring(text, request, limit = restatementLimit(request)) {
  if (limit < 2) return false;
  const a = normalizeText(text), b = normalizeText(withoutQuoted(request));
  const chars = Array.from(a);
  for (let i = 0; i + limit <= chars.length; i++) if (b.includes(chars.slice(i, i + limit).join(''))) return true;
  return false;
}

// Free-text leaves the copiedExample rule compares.
export function freeTextLeaves(t) {
  const leaves = [t?.idea, t?.audience, t?.channel, t?.ambition];
  for (const beat of Array.isArray(t?.beats) ? t.beats : []) leaves.push(beat?.purpose, beat?.onScreen, beat?.motion, beat?.sound);
  for (const line of Array.isArray(t?.copy?.lines) ? t.copy.lines : []) leaves.push(line);
  for (const entry of Array.isArray(t?.palette) ? t.palette : []) leaves.push(entry?.role);
  return leaves.filter((v) => typeof v === 'string').map(normalizeText).filter(Boolean);
}

// Every JSON example shipped in the references. They use placeholders, so an
// example never validates as it stands; copying one is caught before that.
export function shippedExamples(root = skillRoot) {
  const out = [];
  for (const ref of ['treatment.md', 'stage.md']) {
    const file = join(root, 'references', ref);
    if (!existsSync(file)) continue;
    for (const block of readFileSync(file, 'utf8').matchAll(/```json\n([\s\S]*?)```/g)) {
      try {
        const parsed = JSON.parse(block[1]);
        if (parsed && typeof parsed === 'object' && 'beats' in parsed) out.push(parsed);
      } catch { /* a non-JSON snippet is documentation, not an example */ }
    }
  }
  return out;
}

const PLACEHOLDER = /<[^<>\n]{1,80}>/u;
function findPlaceholder(value, at) {
  if (typeof value === 'string') return PLACEHOLDER.test(value) ? at : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const hit = findPlaceholder(value[i], `${at}[${i}]`); if (hit) return hit; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) { const hit = findPlaceholder(inner, at ? `${at}.${key}` : key); if (hit) return hit; }
  }
  return null;
}

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const sentences = (value) => String(value).trim().split(/(?<=[.!?。])\s+/u).filter((s) => s.trim());

class Invalid extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const need = (cond, field, message) => { if (!cond) throw new Invalid(field, message); };

function check(t, { outDir, examples }) {
  need(t && typeof t === 'object' && !Array.isArray(t), 'treatment', 'treatment.json must be a JSON object');
  for (const field of ['request', 'genre', 'path', 'pathReason', 'idea', 'audience', 'channel', 'format', 'durationSec', 'beats', 'subject', 'visualDevices', 'typePlan', 'palette', 'sound', 'copy', 'ambition']) {
    need(t[field] !== undefined && t[field] !== null && t[field] !== '', field, `${field} is required`);
  }
  const mine = freeTextLeaves(t);
  for (const example of examples) {
    const theirs = new Set(freeTextLeaves(example));
    const same = mine.filter((leaf) => theirs.has(leaf)).length;
    need(!(mine.length && same * 2 >= mine.length), 'copiedExample', `${same} of ${mine.length} free-text values equal a shipped example; write this film's own treatment`);
  }
  const placeholder = findPlaceholder(t, '');
  need(!placeholder, placeholder, `${placeholder} still holds a <placeholder>; replace it with this film's value`);

  need(text(t.request), 'request', 'request must be the user\'s words, verbatim');
  need(GENRES.includes(t.genre), 'genre', `genre must be one of ${GENRES.join(', ')}`);
  need(['type', 'stage'].includes(t.path), 'path', 'path must be type or stage');
  need(text(t.pathReason), 'pathReason', 'pathReason must say why this path fits');
  need(Object.hasOwn(FORMATS, t.format), 'format', 'format must be 16:9 or 9:16');
  need(text(t.formatReason), 'formatReason', 'formatReason must tie the format to the channel');
  need(text(t.audience), 'audience', 'audience must say who watches');
  need(text(t.channel), 'channel', 'channel must say where it plays');

  need(text(t.idea) && sentences(t.idea).length === 1, 'idea', 'idea must be one sentence');
  need(!sharesSubstring(t.idea, t.request), 'idea', `idea restates the request (a shared run of ${restatementLimit(t.request)} or more characters); say the film's own idea`);
  need(text(t.ambition) && sentences(t.ambition).length <= 2, 'ambition', 'ambition must be one or two sentences in craft terms');

  const copy = t.copy;
  need(copy && ['user', 'invented'].includes(copy.source), 'copy.source', 'copy.source must be user or invented');
  need(Array.isArray(copy.lines) && copy.lines.length > 0 && copy.lines.every(text), 'copy.lines', 'copy.lines must be a non-empty list of lines');
  const request = normalizeText(t.request);
  copy.lines.forEach((line, i) => {
    if (copy.source === 'user') need(request.includes(normalizeText(line)), `copy.lines[${i}]`, `copy.lines[${i}] is marked user but is not in the request; mark the copy invented or use the user's words`);
    else need(!sharesSubstring(line, t.request), `copy.lines[${i}]`, `copy.lines[${i}] restates the request; write copy from subject.specifics`);
  });

  const cue = typeCue(t.request);
  if (t.path === 'type') {
    need(t.format === '16:9', 'path', 'a 9:16 film always takes the stage path');
    need(copy.source === 'user' || cue, 'path', 'the type path needs the user\'s own words or a type-led cue in the request; take the stage path');
  }

  const d = t.durationSec;
  need(typeof d === 'number' && Number.isFinite(d) && d >= 4 && d <= 90, 'durationSec', 'durationSec must be 4 to 90');
  if (FLOOR_GENRES.has(t.genre) && !LENGTH_REQUEST.test(t.request)) need(d >= 10, 'durationSec', `a ${t.genre} film runs at least 10 s unless the user asked for a length`);

  const beats = t.beats;
  need(Array.isArray(beats) && beats.length > 0, 'beats', 'beats must be a list');
  const arc = t.genre === 'type-led' ? copy.lines.length : ARC_STAGES[t.genre];
  need(beats.length >= arc, 'beats', `a ${t.genre} arc needs at least ${arc} beats; this has ${beats.length}`);
  let cursor = 0;
  beats.forEach((beat, i) => {
    const at = `beats[${i}]`;
    need(beat && typeof beat.t0 === 'number' && typeof beat.t1 === 'number', at, `${at} needs numeric t0 and t1`);
    for (const key of ['purpose', 'onScreen', 'motion', 'sound']) need(text(beat[key]), `${at}.${key}`, `${at}.${key} is required`);
    need(beat.t1 - beat.t0 >= MIN_BEAT_SEC - 1e-9, at, `${at} lasts ${(beat.t1 - beat.t0).toFixed(2)} s; every beat is at least ${MIN_BEAT_SEC} s`);
    need(beat.t0 - cursor <= MAX_GAP_SEC + 1e-9, at, `${at} leaves a ${(beat.t0 - cursor).toFixed(2)} s gap; beats cover the film with no gap over ${MAX_GAP_SEC} s`);
    cursor = Math.max(cursor, beat.t1);
  });
  need(d - cursor <= MAX_GAP_SEC + 1e-9 && cursor <= d + MAX_GAP_SEC, 'beats', `beats end at ${cursor} s but the film runs ${d} s`);

  const subject = t.subject;
  need(subject && text(subject.name), 'subject.name', 'subject.name is required');
  need(['user', 'invented'].includes(subject.source), 'subject.source', 'subject.source must be user or invented');
  need(Array.isArray(subject.specifics) && subject.specifics.filter(text).length >= (subject.source === 'invented' ? 2 : 1), 'subject.specifics',
    'an invented subject needs at least 2 concrete specifics (what it is or does, for whom, one distinctive detail)');

  const devices = t.visualDevices;
  need(Array.isArray(devices), 'visualDevices', 'visualDevices must be a list');
  devices.forEach((device, i) => {
    const at = `visualDevices[${i}]`;
    need(DEVICE_KINDS.includes(device?.kind), `${at}.kind`, `${at}.kind must be one of ${DEVICE_KINDS.join(', ')}`);
    need(['subject', 'support', 'texture'].includes(device.role), `${at}.role`, `${at}.role must be subject, support or texture`);
    need(!TEXTURE_KINDS.includes(device.kind) || device.role === 'texture', `${at}.role`, `${device.kind} is always a texture`);
    need(Array.isArray(device.beats) && device.beats.every((b) => Number.isInteger(b) && b >= 0 && b < beats.length), `${at}.beats`, `${at}.beats must list beat indexes`);
  });
  if (t.path === 'stage') {
    const subjects = devices.filter((device) => device.role === 'subject');
    need(subjects.length > 0, 'visualDevices', 'the stage path needs a role:subject device: a drawn depiction of what the film is about');
    const covered = new Set(subjects.flatMap((device) => device.beats));
    const seconds = [...covered].reduce((sum, b) => sum + (beats[b].t1 - beats[b].t0), 0);
    need(seconds >= 0.5 * d - 1e-9, 'visualDevices', `subject devices cover ${seconds.toFixed(1)} s of ${d} s; they must cover at least half the film`);
    const kinds = new Set(devices.filter((device) => !TEXTURE_KINDS.includes(device.kind)).map((device) => device.kind));
    need(kinds.size >= 2, 'visualDevices', `the stage path needs at least 2 distinct non-texture device kinds; this has ${kinds.size}`);
  }

  const plan = t.typePlan;
  need(plan && Array.isArray(plan.faces) && plan.faces.length > 0, 'typePlan.faces', 'typePlan.faces must list faces');
  plan.faces.forEach((face, i) => need(FACES.some((f) => f.toLowerCase() === String(face).toLowerCase()), `typePlan.faces[${i}]`, `${face} is not a verified face; use ${FACES.join(', ')}`));
  need(text(plan.hierarchy), 'typePlan.hierarchy', 'typePlan.hierarchy is required');
  need(Number.isInteger(plan.maxWordsOnScreen) && plan.maxWordsOnScreen > 0, 'typePlan.maxWordsOnScreen', 'typePlan.maxWordsOnScreen must be a positive integer');

  need(Array.isArray(t.palette) && t.palette.length >= 3 && t.palette.length <= 6, 'palette', 'palette must hold 3 to 6 colours');
  t.palette.forEach((entry, i) => {
    need(/^#[0-9a-f]{6}$/iu.test(entry?.color || ''), `palette[${i}].color`, `palette[${i}].color must be #rrggbb`);
    need(text(entry.role), `palette[${i}].role`, `palette[${i}].role is required`);
  });

  const sound = t.sound;
  need(sound && SOUND_MODES.includes(sound.mode), 'sound.mode', `sound.mode must be one of ${SOUND_MODES.join(', ')}`);
  if (sound.mode === 'none') {
    need(SILENT_REQUEST.test(t.request) || /무음|소리\s*없이|(?<![A-Za-z])muted?(?![A-Za-z])/iu.test(t.channel), 'sound.mode',
      'sound none is allowed only when the user asked for silence or the channel plays muted by design');
  } else {
    need(text(sound.plan), 'sound.plan', 'sound.plan is required');
    if (sound.mode === 'generated') need(SOUND_PALETTES.includes(sound.palette), 'sound.palette', `sound.palette must be one of ${SOUND_PALETTES.join(', ')}`);
    else {
      need(text(sound.file), 'sound.file', `a ${sound.mode} track names its WAV in sound.file`);
      if (sound.mode === 'authored') need(/^stage\//u.test(sound.file), 'sound.file', 'an authored track lives in the stage dir (stage/*.wav)');
      if (outDir) need(existsSync(resolve(outDir, sound.file)), 'sound.file', `${sound.file} does not exist in the output dir`);
    }
  }

  const inventedSubject = subject.source === 'invented';
  if (inventedSubject || copy.source === 'invented') {
    need(Array.isArray(t.inventions) && t.inventions.filter(text).length > 0, 'inventions', 'list every invented part in inventions[]');
    if (inventedSubject) need(t.inventions.some((entry) => normalizeText(entry).includes(normalizeText(subject.name))), 'inventions', 'inventions[] must contain subject.name');
  }
}

export function validateTreatment(treatment, { outDir = null, examples = shippedExamples() } = {}) {
  try {
    check(treatment, { outDir, examples });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof Invalid)) return { ok: false, field: 'treatment', message: `treatment could not be read: ${error.message}` };
    return { ok: false, field: error.field, message: error.message };
  }
}

// Read and validate <out>/treatment.json; a failure carries exit 16 and the field.
export function loadTreatment(outDir, exitCode = 16) {
  const file = join(outDir, 'treatment.json');
  const blocked = (field, message) => Object.assign(new Error(`BLOCKED_TREATMENT_INVALID: field ${field}: ${message}`), { exitCode, field });
  if (!existsSync(file)) throw blocked('treatment', `no treatment.json in ${outDir}; write the treatment first (references/treatment.md)`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw blocked('treatment', `treatment.json is not valid JSON: ${error.message}`); }
  const result = validateTreatment(parsed, { outDir });
  if (!result.ok) throw blocked(result.field, result.message);
  return { treatment: parsed, file, size: FORMATS[parsed.format] };
}
