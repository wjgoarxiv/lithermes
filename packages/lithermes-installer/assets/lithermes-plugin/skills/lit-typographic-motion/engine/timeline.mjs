// Brief -> canonical timeline (§A4, §A10). Tier 1 paces each unit at 1.25x its
// reading floor and snaps every cut FORWARD to the beat grid, never shortening a
// hold (MO-A-06/09/10/14/15/16). Tier 2 swaps the fixed-BPM grid for the beats a
// pre-warmed librosa venv detected in the user's own audio. The anchor-and-snap
// idea is the only thing taken from pdoom's timeline method; nothing of its
// content is used.
import { FRAME, OUTPUT, READING, TIMING } from './constants.mjs';
import { eojeols, readingCounts, readingFloor, scriptOf, smart, plain } from './type.mjs';

export const SCENES = Object.freeze(['title-slam', 'karaoke-line', 'kinetic-list', 'number-counter', 'stroke-signature', 'end-card']);
const LIST_SPLIT = /\s*(?:·|•|\||;|,|\/)\s*/u;

export function listItems(text) {
  return String(text).split(LIST_SPLIT).map((item) => item.trim()).filter(Boolean);
}

export function defaultScene(text, index, count) {
  if (index === 0) return 'title-slam';
  if (count >= 2 && index === count - 1) return 'end-card';
  if (/\d/.test(text)) return 'number-counter';
  if (listItems(text).length >= 3) return 'kinetic-list';
  return 'karaoke-line';
}

// Grid of beat times starting at 0 (the film start is always an anchor).
export function makeGrid({ bpm, beats }) {
  if (beats?.length) {
    const sorted = [...new Set(beats.filter((b) => Number.isFinite(b) && b > 0))].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((b, i) => b - sorted[i]).sort((a, b) => a - b);
    const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60 / bpm;
    return { beat: step, at: (target) => {
      const hit = sorted.find((b) => b >= target - 1e-9);
      if (target <= 1e-9) return 0;
      if (hit !== undefined) return hit;
      const last = sorted.at(-1) ?? 0;
      return last + Math.ceil((target - last - 1e-9) / step) * step;
    } };
  }
  const beat = 60 / bpm;
  return { beat, at: (target) => Math.ceil((target - 1e-9) / beat) * beat };
}

const frameRound = (t, fps) => Math.round(t * fps) / fps;
const fix = (x) => Math.round(x * 1e6) / 1e6;

function revealSteps(parts, lineFloor, quarter) {
  const weights = parts.map((p) => {
    const { H, W } = readingCounts(p);
    return Math.max(0.05, READING.hangulSecPerSyllable * H + W / READING.englishWordsPerSec);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return parts.map((_, j) => {
    const share = TIMING.paceMargin * lineFloor * (weights[j] / total);
    return Math.ceil(Math.max(READING.revealFloor, share) / quarter - 1e-9) * quarter;
  });
}

export function normalizeBrief(raw) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('brief must be a JSON object'), { userError: true });
  const text = Array.isArray(raw.text) ? raw.text : typeof raw.text === 'string' ? [raw.text] : null;
  if (!text || !text.length || !text.every((line) => typeof line === 'string' && line.trim())) {
    throw Object.assign(new Error('brief.text must be a non-empty list of display lines'), { userError: true });
  }
  if (raw.scenes && (!Array.isArray(raw.scenes) || raw.scenes.some((s) => s != null && !SCENES.includes(s)))) {
    throw Object.assign(new Error(`brief.scenes entries must be one of ${SCENES.join(', ')}`), { userError: true });
  }
  const bpm = raw.bpm == null ? TIMING.defaultBpm : Number(raw.bpm);
  if (!Number.isFinite(bpm) || bpm < TIMING.minBpm || bpm > TIMING.maxBpm) {
    throw Object.assign(new Error(`brief.bpm must be ${TIMING.minBpm}..${TIMING.maxBpm}`), { userError: true });
  }
  for (const [key, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' && /<[^<>\n]{1,80}>/u.test(item)) throw Object.assign(new Error(`brief.${key} still holds an example placeholder (${item}); write this film's own value`), { userError: true });
    }
  }
  if (raw.durationSec != null && !(Number(raw.durationSec) >= 4 && Number(raw.durationSec) <= 90)) {
    throw Object.assign(new Error('brief.durationSec must be 4..90'), { userError: true });
  }
  return { ...raw, text: text.map((line) => line.trim()), bpm, seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : 20260926 };
}

export function buildTimeline(brief, { presetId, fps = FRAME.fps, audioGrid = null } = {}) {
  const grid = makeGrid(audioGrid ? { bpm: audioGrid.bpm, beats: audioGrid.beats } : { bpm: brief.bpm });
  const beat = grid.beat, quarter = beat / 4;
  const typed = presetId === 'terminalcore';
  const warnings = [];
  const lines = brief.text.map((line) => (typed ? plain(line) : smart(line)));
  const plan = lines.map((text, index) => {
    let sceneId = brief.scenes?.[index] || defaultScene(text, index, lines.length);
    if (sceneId === 'stroke-signature' && /[가-힣ᄀ-ᇿ㄰-㆏]/u.test(text)) {
      warnings.push(`line ${index + 1}: the stroke fonts have no Hangul, so it uses title-slam instead of stroke-signature`);
      sceneId = 'title-slam';
    }
    if (sceneId === 'number-counter' && !/\d/.test(text)) sceneId = 'karaoke-line';
    if (sceneId === 'kinetic-list' && listItems(text).length < 2) sceneId = 'karaoke-line';
    return { text, sceneId };
  });
  const lay = (scale) => {
    const uses = new Map();
    const units = [];
    let cursor = 0, gridBeat = 0;
    plan.forEach(({ text, sceneId }) => {
      const shotIndex = uses.get(sceneId) ?? 0;
      uses.set(sceneId, shotIndex + 1);
      const id = shotIndex === 0 ? sceneId : `${sceneId}-${shotIndex + 1}`;
      const floor = readingFloor(text, 'line');
      const { C } = readingCounts(text);
      let need = Math.max(TIMING.paceMargin * floor, C / READING.englishCps + 1 / fps, TIMING.minSceneBeats * beat);
      let parts = [], steps = [];
      if (sceneId === 'karaoke-line') parts = eojeols(text);
      if (sceneId === 'kinetic-list') parts = listItems(text);
      if (parts.length > 1) {
        steps = revealSteps(parts, floor, quarter);
        need = Math.max(need, steps.reduce((a, b) => a + b, 0) + beat);
      }
      if (sceneId === 'number-counter') need = Math.max(need, 1.2 + beat);
      if (sceneId === 'stroke-signature') need = Math.max(need, 0.11 * Array.from(text).length + beat);
      if (sceneId === 'end-card') need = Math.max(need, TIMING.paceMargin * floor + beat);
      need *= scale;
      const start = cursor;
      const endBeat = grid.at(gridBeat + need);
      const end = frameRound(endBeat, fps);
      units.push({ id, sceneId, shotIndex, start: fix(start), end: fix(end), holdSec: fix(end - start), kind: 'line', text, script: scriptOf(text), beatSec: fix(gridBeat) });
      let t = gridBeat;
      parts.forEach((part, j) => {
        if (parts.length < 2) return;
        const rs = frameRound(t, fps), re = frameRound(t + steps[j], fps);
        units.push({ id: `${id}/r${j}`, sceneId, shotIndex, start: fix(rs), end: fix(re), holdSec: fix(re - rs), kind: 'reveal', text: part, script: scriptOf(part), beatSec: fix(t) });
        t += steps[j];
      });
      cursor = end;
      gridBeat = endBeat;
    });
    return units;
  };
  // A treatment length scales every hold up (reveal steps stay on their floors)
  // until the film reaches it; the floors are never cut to meet a shorter one.
  let units = lay(1);
  const target = Number(brief.durationSec);
  if (Number.isFinite(target) && target > 0) {
    const endOf = (list) => list.filter((u) => u.kind === 'line').at(-1).end;
    const natural = endOf(units);
    if (natural < target - 1e-9) {
      let lo = 1, hi = 2 * target / natural;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (endOf(lay(mid)) >= target - 1e-9) hi = mid; else lo = mid;
      }
      units = lay(hi);
    } else if (natural > target + beat) {
      warnings.push(`the reading floors force a ${natural} s film, longer than the requested ${target} s`);
    }
  }
  const shots = units.filter((u) => u.kind === 'line');
  const last = shots.at(-1);
  if (last.end < OUTPUT.minDurationSec) {
    const endBeat = grid.at(OUTPUT.minDurationSec);
    last.end = fix(frameRound(endBeat, fps));
    last.holdSec = fix(last.end - last.start);
    warnings.push(`film extended to ${last.end} s to reach the 3 s duration floor`);
  }
  if (last.end > OUTPUT.warnDurationSec) warnings.push(`film runs ${last.end} s, past the 90 s advisory length`);
  return { timeline: units, durationSec: last.end, beat, warnings };
}

export function shotsOf(timeline) {
  return timeline.filter((u) => u.kind === 'line' || u.kind === 'scene');
}

export function shotAt(timeline, t) {
  const shots = shotsOf(timeline);
  return shots.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) || shots.at(-1);
}

export function revealsOf(timeline, shot) {
  return timeline.filter((u) => u.kind === 'reveal' && u.sceneId === shot.sceneId && u.shotIndex === shot.shotIndex);
}
