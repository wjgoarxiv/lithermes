// The three preset style bibles as data (MO-B-01..03), the auto-pick table
// (MO-B-00), and the per-shot pass plan: seeds (MO-SH-01), event schedules
// under the shared per-shot ceiling (MO-SH-03), and the one software-GL
// downgrade formula (MO-SH-09).
import { EVENTS, PASS_CAPS } from './constants.mjs';
import { mulberry32, passSeed } from './util.mjs';

export const PRESETS = Object.freeze({
  'swiss-signal': {
    id: 'swiss-signal',
    palette: { background: '#E9EBE4', ink: '#0C0E13', bone: '#E9EBE4', signal: '#0F7A82', accent: '#D9A441', secondary: '#4B5058' },
    roles: { text: 'ink', annotation: 'ink', emphasis: 'signal', rule: 'ink', accent: 'accent' },
    passes: ['swiss-grid', 'dither'],
    post: { bloom: 0.12, bloomThreshold: 0.85, bloomKnee: 0.4, bloomRadius: 0.6, halation: 0.04, ca: 0.6, grain: 0.035, vignette: 0.18 },
    motion: { entrance: 'slam', entranceSec: 0.18, drift: 0 },
    voices: { display: 'archivo', body: 'pretendard', machine: 'meslo', label: 'meslo' },
  },
  terminalcore: {
    id: 'terminalcore',
    palette: { background: '#05070A', panel: '#0C1116', ink: '#39FF6A', signal: '#39FF6A', alternate: '#2FB6FF', secondary: '#7C8B93' },
    roles: { text: 'signal', annotation: 'secondary', emphasis: 'signal', rule: 'secondary', accent: null },
    passes: ['terminal-ui', 'crt', 'dither', 'glitch'],
    post: { bloom: 0.35, bloomThreshold: 0.8, bloomKnee: 0.5, bloomRadius: 0.55, halation: 0.06, ca: 0.9, grain: 0.03, vignette: 0.12 },
    motion: { entrance: 'type-in', typeCps: 22, drift: 0 },
    voices: { display: 'pixel', body: 'pixel', machine: 'meslo', label: 'silkscreen' },
  },
  tidal: {
    id: 'tidal',
    palette: { background: '#0E1420', ink: '#E8ECEF', stopA: '#124559', stopB: '#4C3B6E', accent: '#E07856', secondary: '#AEB7C0' },
    roles: { text: 'ink', annotation: 'secondary', emphasis: 'ink', rule: 'secondary', accent: 'accent' },
    passes: ['tidal-gradient', 'swiss-grid', 'glitch'],
    post: { bloom: 0.2, bloomThreshold: 0.85, bloomKnee: 0.5, bloomRadius: 0.7, halation: 0.04, ca: 0.4, grain: 0.03, vignette: 0.22 },
    motion: { entrance: 'drift', entranceSec: 2.4, drift: 1 },
    voices: { display: 'archivo', body: 'pretendard', machine: 'meslo', label: 'meslo' },
  },
});

// MO-B-00: first match wins; Latin at word boundaries, Korean at a token start.
const PICK_ROWS = [
  ['terminalcore', /\b(?:terminal|hacker|CRT)\b/i, /(?<![가-힣])(?:터미널|해커)/u],
  ['tidal', /\b(?:gradient|wave|tide|calm)\b/i, /(?<![가-힣])(?:물결|파도|잔잔한|흐름)/u],
];

// A style counts as user-specified only when the user's own request names it;
// a style the agent wrote into the brief is the agent's default choice.
const STYLE_WORDS = { 'swiss-signal': /swiss[\s-]*signal|스위스/i, terminalcore: /terminal[\s-]*core|터미널\s*코어/i, tidal: /(?<![A-Za-z])tidal(?![A-Za-z])|타이달/i };

export function pickPreset(brief, { request = '' } = {}) {
  if (brief.style) {
    if (!PRESETS[brief.style]) throw Object.assign(new Error(`unknown style "${brief.style}"; use swiss-signal, terminalcore or tidal`), { userError: true });
    return { id: brief.style, reason: STYLE_WORDS[brief.style].test(request) ? 'user-specified' : 'agent default' };
  }
  const copy = [...(brief.text || []), brief.mood || '', brief.topic || ''].join(' ');
  for (const [id, latin, korean] of PICK_ROWS) {
    const hit = copy.match(latin) || copy.match(korean);
    if (hit) return { id, reason: `agent default (the brief mentions "${hit[0]}"; auto-pick table, first match)` };
  }
  return { id: 'swiss-signal', reason: 'agent default (no terminal or tidal keyword in the brief)' };
}

export function terminalSignal(brief) {
  return brief.signalHue === 'blue' ? '#2FB6FF' : '#39FF6A';
}

// Events that count toward MO-SH-03 for one shot, all inside the shot window.
function scheduleShot(presetId, shot, index, shots, seedFor, fps) {
  const events = [];
  const hold = shot.end - shot.start;
  const frameAt = (t) => Math.round(t * fps) / fps;
  if (presetId === 'terminalcore') {
    if (index === 0) events.push({ kind: 'boot-flicker', t: frameAt(shot.start), duration: 0.25 });
    if (hold >= 1.8) {
      const rng = mulberry32(seedFor('glitch'));
      const t = frameAt(shot.start + hold * (0.45 + 0.2 * rng()));
      events.push({ kind: 'glitch-hit', t, holdFrames: 2 });
    }
  }
  if (presetId === 'tidal') {
    events.push({ kind: 'surge', t: frameAt(shot.start + Math.min(0.1, hold / 4)), attack: 0.15, decay: 0.25 });
    const longest = shots.reduce((best, s, i) => (s.end - s.start > shots[best].end - shots[best].start ? i : best), 0);
    if (index === longest && hold >= 3 && shots.length > 1) {
      const rng = mulberry32(seedFor('glitch'));
      events.push({ kind: 'glitch-hit', t: frameAt(shot.start + hold * (0.55 + 0.15 * rng())), holdFrames: 2 });
    }
  }
  return events;
}

export function maxEventsInWindow(events, windowSec = EVENTS.perShotWindowSec) {
  const times = events.map((e) => e.t).sort((a, b) => a - b);
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < windowSec - 1e-9; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

// Glitch hit geometry from the shot's PRNG, sampled once per hit (MO-SH-05).
export function glitchHitGeometry(seed, hitIndex, areaCapPct = 12, sliceCount = 6) {
  const rng = mulberry32((seed ^ Math.imul(hitIndex + 1, 0x9e3779b1)) >>> 0);
  const slices = [];
  const budget = (areaCapPct / 100) * 1080;
  let used = 0;
  for (let i = 0; i < sliceCount && used < budget; i++) {
    const height = Math.min(budget - used, 8 + Math.floor(rng() * 34));
    const y = 60 + Math.floor(rng() * (1080 - 120 - height));
    const dx = (rng() < 0.5 ? -1 : 1) * (6 + Math.floor(rng() * 18));
    slices.push([y, height, dx]);
    used += height;
  }
  return { slices, areaPct: (used / 1080) * 100, rgbSplitPx: 2 };
}

export function planPasses({ presetId, timeline, runSeed, fps, software, brief = {} }) {
  const preset = PRESETS[presetId];
  const shots = timeline.filter((u) => u.kind === 'line' || u.kind === 'scene');
  const passRanges = [];
  const events = [];
  const totalSec = shots.at(-1).end;
  shots.forEach((shot, index) => {
    const seedFor = (pass) => passSeed(runSeed, shot.sceneId, shot.shotIndex, pass);
    const shotEvents = scheduleShot(presetId, shot, index, shots, seedFor, fps)
      .map((e) => ({ ...e, sceneId: shot.sceneId, shotIndex: shot.shotIndex }));
    if (maxEventsInWindow(shotEvents) > EVENTS.maxPerShotWindow) throw new Error(`event plan for ${shot.sceneId} exceeds MO-SH-03`);
    events.push(...shotEvents);
    const frameStart = Math.round(shot.start * fps);
    const frameEnd = Math.round(shot.end * fps) - 1;
    const hits = shotEvents.filter((e) => e.kind === 'glitch-hit');
    const surges = shotEvents.filter((e) => e.kind === 'surge');
    for (const pass of preset.passes) {
      const seed = pass === 'swiss-grid' ? null : seedFor(pass);
      let params;
      if (pass === 'swiss-grid') params = { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, showGuides: false };
      else if (pass === 'dither') params = { mode: 1, paletteSize: presetId === 'terminalcore' ? 6 : 12, pixelScale: presetId === 'terminalcore' ? 2 : 1, ditherStrength: presetId === 'terminalcore' ? 0.5 : 0.3 };
      else if (pass === 'crt') {
        const boot = shotEvents.some((e) => e.kind === 'boot-flicker');
        params = {
          scanlineFreq: 540, scanlineDepth: 0.22, curvature: 0.05, vignette: 0.3, triadMaskAmount: 0.12,
          flickerAmp: 0.03, flickerFreqHz: 8, bootFlickerAmp: boot ? 0.06 : 0,
          flickerAmpRealized: boot ? 0.06 : 0.03,
          persistenceEnabled: !software, phosphorPersistence: software ? 0 : 0.15,
        };
      } else if (pass === 'glitch') {
        const geometry = hits.map((_, i) => glitchHitGeometry(seed, i));
        params = {
          intensity: 0.35, sliceCount: 6, maxOffsetPx: 24, rgbSplitPx: 2, holdFrames: 2,
          hitRatePerSec: presetId === 'tidal' ? 0.5 : 1.5, areaCapPct: 12,
          hitRatePerSecRealized: Number((hits.length / Math.max(1e-6, shot.end - shot.start)).toFixed(4)),
          hits: hits.map((h, i) => ({ t: h.t, frame: Math.round(h.t * fps), holdFrames: h.holdFrames, areaPct: Number(geometry[i].areaPct.toFixed(3)), slices: geometry[i].slices })),
        };
      } else if (pass === 'tidal-gradient') {
        const octaves = software ? Math.max(3, Math.floor(4 / 2)) : 4;
        params = {
          paletteStopsHex: [preset.palette.stopA, preset.palette.stopB], flowSpeed: 0.06, warpAmount: 0.35, curlStrength: 0.4,
          octaves, surgeOnHit: 0.5, surgeAttackSec: 0.15, surgeDecaySec: 0.25, surgeCapPerSec: 2,
          ditherAmount: 0.02, surgeCountRealized: surges.length,
          surges: surges.map((s) => ({ t: s.t, attack: s.attack, decay: s.decay })),
        };
      } else if (pass === 'terminal-ui') {
        params = { layers: 1, compositedThrough: ['crt', 'dither'], meterCount: 2, logLineRateCharsPerSec: 22, wordTimingSource: 'reading-time', caretBlinkHz: 1.2 };
      }
      passRanges.push({ pass, frameStart, frameEnd, sceneId: shot.sceneId, shotIndex: shot.shotIndex, seed, params, downgraded: Boolean(software) });
    }
  });
  return { passRanges, events, totalSec, signal: presetId === 'terminalcore' ? terminalSignal(brief) : preset.palette.signal };
}

export const GLITCH_CAPS = PASS_CAPS;
