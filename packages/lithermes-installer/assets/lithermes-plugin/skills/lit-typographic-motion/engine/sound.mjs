// Sound for both paths. The generated bed is pure code (no network, no model
// weights): a tempo, a pulse and a pad chord progression that changes on the
// film's cuts, plus accents only where a beat's `sound` field asks for one.
// Loudness is measured here per ITU-R BS.1770-4. Every planned track, whether
// generated, supplied or authored, is muxed; it is padded or trimmed to the
// film with a 50 ms fade and never shortens it.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { EXIT } from './constants.mjs';
import { loadTreatment, SOUND_PALETTES } from './treatment.mjs';
import { writeJson } from './director.mjs';

export const RATE = 48000;
export const TARGET_LUFS = -16;
export const BED_PEAK_DBFS = -2;
export const MUX_PEAK_DBFS = -0.5;
export const AAC_BITRATE = '256k';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message) => Object.assign(new Error(`SOUND_INVALID: ${message}`), { exitCode: EXIT.SOUND_INVALID });
const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// ---------------------------------------------------------------------------
// ITU-R BS.1770-4 integrated loudness at 48 kHz.

function biquad(input, b, a) {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const HIGHPASS = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] };

export function integratedLoudness(channels) {
  const weighted = channels.map((ch) => biquad(biquad(ch, SHELF.b, SHELF.a), HIGHPASS.b, HIGHPASS.a));
  const block = Math.round(0.4 * RATE), hop = Math.round(0.1 * RATE);
  const n = weighted[0].length;
  const power = [];
  for (let start = 0; start + block <= n; start += hop) {
    let sum = 0;
    for (const ch of weighted) { let s = 0; for (let i = start; i < start + block; i++) s += ch[i] * ch[i]; sum += s / block; }
    power.push(sum);
  }
  const loud = (p) => -0.691 + 10 * Math.log10(p);
  const absolute = power.filter((p) => p > 0 && loud(p) > -70);
  if (!absolute.length) return -Infinity;
  const relative = loud(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const kept = absolute.filter((p) => loud(p) > relative);
  return loud(kept.reduce((a, b) => a + b, 0) / kept.length);
}

// ---------------------------------------------------------------------------
// Timbre palettes (key and tempo come from the treatment).

export const PALETTES = Object.freeze({
  'soft-mallet': { tempo: [78, 100], octave: 3, pad: 'sine', pulse: 'mallet', hats: false, attack: 0.35 },
  'warm-keys': { tempo: [84, 108], octave: 3, pad: 'keys', pulse: 'thump', hats: false, attack: 0.25 },
  'glass-pulse': { tempo: [100, 124], octave: 4, pad: 'glass', pulse: 'tick', hats: true, attack: 0.15 },
  'low-strings': { tempo: [66, 88], octave: 2, pad: 'strings', pulse: 'thump', hats: false, attack: 0.6 },
});
const PROGRESSIONS = { major: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], minor: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] };
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What a beat's `sound` field asks for. Only these accents are ever added.
export function accentsFor(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  if (/hit|impact|stab|punch|slam|boom|타격|히트|강타|쿵|임팩트/u.test(s)) out.push('hit');
  if (/rise|riser|swell|build|lift|sweep up|crescendo|상승|고조|부풀|쌓/u.test(s)) out.push('rise');
  if (/cadence|resolve|resolution|close|closing|final chord|ending|종지|해결|마무리|끝맺/u.test(s)) out.push('cadence');
  if (/chime|sparkle|shimmer|twinkle|bell|반짝|차임|종소리/u.test(s)) out.push('chime');
  if (/drop out|dropout|silence|hush|breath|pause|멈춤|정적|숨/u.test(s)) out.push('hush');
  return out;
}

// Pick the tempo in the palette range whose beat grid best meets the cuts.
function lockTempo([lo, hi], cuts) {
  let best = lo, bestErr = Infinity;
  for (let bpm = lo; bpm <= hi; bpm += 0.5) {
    const beat = 60 / bpm;
    let err = 0;
    for (const c of cuts) { const r = c / beat; err += Math.abs(r - Math.round(r)) * beat; }
    if (err < bestErr - 1e-9) { bestErr = err; best = bpm; }
  }
  return best;
}

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function padSample(kind, hz, t, rnd) {
  const w = 2 * Math.PI * hz * t;
  switch (kind) {
    case 'keys': return 0.7 * Math.sin(w + 0.8 * Math.sin(w) * Math.exp(-t * 1.5)) + 0.2 * Math.sin(2 * w);
    case 'glass': return 0.6 * Math.sin(w) + 0.25 * Math.sin(w * 1.5 + 0.3) + 0.15 * Math.sin(w * 3.01);
    case 'strings': { let v = 0; for (let k = 1; k <= 7; k++) v += Math.sin(k * w * (1 + 0.0007 * k)) / k; return 0.55 * v; }
    default: return 0.8 * Math.sin(w) + 0.15 * Math.sin(2 * w + rnd);
  }
}

// Returns { left, right, cues, info } for exactly `samples` samples.
export function synthesizeBed({ treatment, durationSec, samples, cuts }) {
  const paletteId = SOUND_PALETTES.includes(treatment.sound?.palette) ? treatment.sound.palette : 'soft-mallet';
  const palette = PALETTES[paletteId];
  const seed = Number.parseInt(sha(`${treatment.request}|${paletteId}|${treatment.genre}`).slice(0, 8), 16) >>> 0;
  const rnd = mulberry32(seed);
  const root = Math.floor(rnd() * 12);
  const mode = ['brand-mood', 'other', 'type-led'].includes(treatment.genre) && rnd() < 0.5 ? 'minor' : (rnd() < 0.3 ? 'minor' : 'major');
  const bpm = lockTempo(palette.tempo, cuts);
  const beat = 60 / bpm;
  const left = new Float64Array(samples), right = new Float64Array(samples);
  const cues = [];
  const scale = durationSec / treatment.durationSec;
  const beats = treatment.beats.map((b) => ({ t0: b.t0 * scale, t1: Math.min(durationSec, b.t1 * scale), sound: b.sound }));
  const sections = [0, ...cuts.filter((c) => c > 0 && c < durationSec)].sort((a, b) => a - b);
  const progression = PROGRESSIONS[mode];
  const add = (i, l, r) => { if (i >= 0 && i < samples) { left[i] += l; right[i] += r; } };

  // Pad: one chord per section, changing on the cuts.
  sections.forEach((start, k) => {
    const end = k + 1 < sections.length ? sections[k + 1] : durationSec;
    const chord = progression[k % progression.length];
    const base = 12 * (palette.octave + 1) + root;
    const from = Math.floor(start * RATE), to = Math.min(samples, Math.ceil((end + 0.08) * RATE));
    for (let v = 0; v < chord.length; v++) {
      const hz = midiHz(base + chord[v]);
      const pan = (v - 1) * 0.3;
      const phase = rnd() * 6.28;
      for (let i = from; i < to; i++) {
        const t = (i - from) / RATE;
        const env = Math.min(1, t / palette.attack) * Math.min(1, (to - i) / (0.08 * RATE));
        const s = 0.07 * env * padSample(palette.pad, hz, t, phase);
        add(i, s * (1 - pan), s * (1 + pan));
      }
    }
    cues.push({ cue: 'chord', time: Number(start.toFixed(4)), target: Number(start.toFixed(4)), delta: 0, section: k });
  });

  // Pulse on the tempo grid, from 0.
  const pulseHz = midiHz(12 * palette.octave + root);
  for (let n = 0, t0 = 0; t0 < durationSec; n++, t0 = n * beat) {
    const from = Math.round(t0 * RATE), len = Math.round(0.35 * RATE);
    for (let i = 0; i < len; i++) {
      const t = i / RATE;
      let s;
      if (palette.pulse === 'mallet') s = 0.16 * Math.sin(2 * Math.PI * pulseHz * 2 * t) * Math.exp(-t * 11);
      else if (palette.pulse === 'tick') s = 0.1 * Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 60) + 0.12 * Math.sin(2 * Math.PI * pulseHz * t) * Math.exp(-t * 14);
      else s = 0.22 * Math.sin(2 * Math.PI * (55 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9);
      add(from + i, s, s);
    }
    if (palette.hats) {
      const off = Math.round((t0 + beat / 2) * RATE);
      for (let i = 0; i < Math.round(0.05 * RATE); i++) { const s = 0.03 * (rnd() * 2 - 1) * Math.exp(-(i / RATE) * 70); add(off + i, s, s); }
    }
  }

  // Accents, only where a beat asks.
  beats.forEach((b, k) => {
    for (const kind of accentsFor(b.sound)) {
      if (kind === 'hit') {
        const from = Math.round(b.t0 * RATE);
        for (let i = 0; i < Math.round(0.6 * RATE); i++) {
          const t = i / RATE;
          const s = 0.32 * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 22)) * t) * Math.exp(-t * 5) + 0.05 * (rnd() * 2 - 1) * Math.exp(-t * 30);
          add(from + i, s, s);
        }
        cues.push({ cue: 'hit', beat: k, time: b.t0, target: b.t0, delta: 0 });
      } else if (kind === 'rise') {
        const end = b.t1, start = Math.max(b.t0, end - Math.min(2, (b.t1 - b.t0) * 0.8));
        const from = Math.round(start * RATE), to = Math.round(end * RATE);
        for (let i = from; i < to; i++) {
          const p = (i - from) / Math.max(1, to - from);
          const s = 0.12 * p * p * (0.6 * (rnd() * 2 - 1) + Math.sin(2 * Math.PI * (200 + 900 * p) * (i / RATE)));
          add(i, s * 0.9, s * 1.1);
        }
        cues.push({ cue: 'rise', beat: k, time: Number(end.toFixed(4)), target: Number(end.toFixed(4)), delta: 0 });
      } else if (kind === 'chime') {
        const from = Math.round(b.t0 * RATE), hz = midiHz(12 * (palette.octave + 3) + root + progression[k % progression.length][2]);
        for (let i = 0; i < Math.round(1.2 * RATE); i++) { const t = i / RATE; const s = 0.09 * Math.sin(2 * Math.PI * hz * t + 1.5 * Math.sin(2 * Math.PI * hz * 3.5 * t) * Math.exp(-t * 4)) * Math.exp(-t * 3); add(from + i, s * 1.1, s * 0.9); }
        cues.push({ cue: 'chime', beat: k, time: b.t0, target: b.t0, delta: 0 });
      } else if (kind === 'cadence') {
        const at = Math.max(0, b.t1 - 1.2);
        const from = Math.round(at * RATE), hz = midiHz(12 * (palette.octave + 1) + root);
        for (let i = 0; from + i < samples; i++) { const t = i / RATE; const s = 0.12 * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * hz * 1.5 * t)) * Math.exp(-t * 1.2); add(from + i, s, s); }
        cues.push({ cue: 'cadence', beat: k, time: Number(at.toFixed(4)), target: Number(b.t1.toFixed(4)), delta: Number((at - b.t1).toFixed(4)) });
      } else if (kind === 'hush') {
        const from = Math.round(b.t0 * RATE), to = Math.round(Math.min(b.t1, b.t0 + 0.6) * RATE);
        for (let i = from; i < to && i < samples; i++) { const g = 0.35 + 0.65 * Math.abs(((i - from) / Math.max(1, to - from)) * 2 - 1); left[i] *= g; right[i] *= g; }
        cues.push({ cue: 'hush', beat: k, time: b.t0, target: b.t0, delta: 0 });
      }
    }
  });

  // Edges: 20 ms in, 0.5 s out.
  for (let i = 0; i < Math.min(samples, 0.02 * RATE); i++) { const g = i / (0.02 * RATE); left[i] *= g; right[i] *= g; }
  const tail = Math.min(samples, Math.round(0.5 * RATE));
  for (let i = 0; i < tail; i++) { const g = i / tail; left[samples - 1 - i] *= g; right[samples - 1 - i] *= g; }

  // Loudness to -16 LUFS with a soft ceiling so the sample peak stays <= -2 dBFS.
  const ceiling = 10 ** (BED_PEAK_DBFS / 20) * 0.985;
  let loudness = integratedLoudness([left, right]);
  for (let pass = 0; pass < 4 && Number.isFinite(loudness); pass++) {
    const gain = 10 ** ((TARGET_LUFS - loudness) / 20);
    for (const ch of [left, right]) for (let i = 0; i < samples; i++) {
      const x = ch[i] * gain, m = Math.abs(x), knee = ceiling * 0.7;
      ch[i] = m <= knee ? x : Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((m - knee) / (ceiling - knee)));
    }
    loudness = integratedLoudness([left, right]);
    if (Math.abs(loudness - TARGET_LUFS) < 0.2) break;
  }
  cues.sort((a, b) => a.time - b.time);
  return { left, right, cues, info: { palette: paletteId, key: `${KEYS[root]} ${mode}`, bpm, beatSec: Number(beat.toFixed(4)) } };
}

export function wavBytes(left, right) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(left[i]), 44 + i * 4); buf.writeInt16LE(q(right[i]), 46 + i * 4); }
  return buf;
}

export function readWav16(bytes) {
  const channels = bytes.readUInt16LE(22), bits = bytes.readUInt16LE(34);
  let at = 12;
  while (at + 8 <= bytes.length && bytes.toString('ascii', at, at + 4) !== 'data') at += 8 + bytes.readUInt32LE(at + 4);
  const size = bytes.readUInt32LE(at + 4), start = at + 8, frames = size / (channels * bits / 8);
  const out = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = bytes.readInt16LE(start + (i * channels + c) * 2) / 32768;
  return out;
}

// Build DIR/sound/bed.wav and DIR/sound-cues.json. frameCount x 48000 / fps samples, exactly.
export function buildBed({ out, treatment, fps, totalFrames, cuts }) {
  const samples = Math.round((totalFrames * RATE) / fps);
  const durationSec = totalFrames / fps;
  const bed = synthesizeBed({ treatment, durationSec, samples, cuts });
  const bytes = wavBytes(bed.left, bed.right);
  const [l, r] = readWav16(bytes);
  const peak = Math.max(...[l, r].map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const loudness = integratedLoudness([l, r]);
  mkdirSync(join(out, 'sound'), { recursive: true });
  const file = join(out, 'sound', 'bed.wav');
  writeFileSync(file, bytes);
  const cueDoc = {
    mode: 'generated', label: 'generated sound bed', ...bed.info, samples, sampleRate: RATE, durationSec,
    loudnessLufs: Number(loudness.toFixed(2)), peakDbfs: Number(dbfs(peak).toFixed(2)), sha256: sha(bytes),
    cuts: cuts.map((c) => Number(c.toFixed(4))), cues: bed.cues,
  };
  writeJson(join(out, 'sound-cues.json'), cueDoc);
  return { file, ...cueDoc };
}

// ---------------------------------------------------------------------------
// Mux and gate.

export function muxArgs({ video, track, output, durationSec }) {
  const d = durationSec.toFixed(6), fadeAt = Math.max(0, durationSec - 0.05).toFixed(6);
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', track, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    '-af', `aresample=${RATE},apad=whole_dur=${d},atrim=0:${d},afade=t=out:st=${fadeAt}:d=0.05`, '-ac', '2',
    '-c:a', 'aac', '-b:a', AAC_BITRATE, '-movflags', '+faststart', output];
}

export function muxAudio({ video, track, output, durationSec }) {
  const result = spawnSync('ffmpeg', muxArgs({ video, track, output, durationSec }), { encoding: 'utf8' });
  if (result.status !== 0) throw fail(`the sound track could not be muxed: ${(result.stderr || result.error?.message || '').trim().split('\n').at(-1)}`);
}

function streams(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', file], { encoding: 'utf8' });
  if (probe.status !== 0) return [];
  return JSON.parse(probe.stdout).streams || [];
}

// The decoded muxed stream: present, within 0.1 s of the video, peak <= -0.5
// dBFS, and (generated beds) no stretch under -50 dBFS RMS longer than 1.5 s
// in the first 3 s.
export function soundGate({ file, mode }) {
  const all = streams(file);
  const video = all.find((s) => s.codec_type === 'video');
  const audio = all.find((s) => s.codec_type === 'audio');
  if (!audio) throw fail(`the ${mode} sound track is planned but ${file} has no audio stream`);
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], { maxBuffer: 1024 * 1024 * 1024 });
  if (decode.status !== 0) throw fail(`the muxed audio stream in ${file} does not decode`);
  const pcm = new Float32Array(decode.stdout.buffer, decode.stdout.byteOffset, decode.stdout.byteLength / 4);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const frames = pcm.length / 2;
  const audioSec = frames / RATE, videoSec = Number(video?.duration || 0);
  const rules = [];
  const off = Math.abs(audioSec - videoSec);
  rules.push({ id: 'sound-stream', status: 'PASS', detail: `${mode} track muxed (AAC ${AAC_BITRATE})` });
  rules.push({ id: 'sound-duration', status: off <= 0.1 ? 'PASS' : 'FAIL', detail: `audio ${audioSec.toFixed(3)} s vs video ${videoSec.toFixed(3)} s (limit 0.1 s)` });
  rules.push({ id: 'sound-peak', status: dbfs(peak) <= MUX_PEAK_DBFS + 1e-9 ? 'PASS' : 'FAIL', detail: `sample peak ${dbfs(peak).toFixed(2)} dBFS (limit ${MUX_PEAK_DBFS})` });
  const win = Math.round(0.05 * RATE);
  let run = 0, longest = 0;
  for (let w = 0; (w + 1) * win <= Math.min(frames, 3 * RATE); w++) {
    let s = 0;
    for (let i = w * win; i < (w + 1) * win; i++) s += pcm[2 * i] * pcm[2 * i] + pcm[2 * i + 1] * pcm[2 * i + 1];
    const rms = Math.sqrt(s / (2 * win));
    if (dbfs(rms) < -50) { run++; longest = Math.max(longest, run); } else run = 0;
  }
  const silent = longest * 0.05;
  const silenceDetail = `longest stretch under -50 dBFS RMS in the first 3 s: ${silent.toFixed(2)} s (limit 1.5 s)`;
  if (silent > 1.5) {
    if (mode === 'generated') throw fail(`the generated bed is silent too long at the start; ${silenceDetail}`);
    rules.push({ id: 'sound-silence', status: 'WARN', detail: silenceDetail });
  } else rules.push({ id: 'sound-silence', status: 'PASS', detail: silenceDetail });
  return { rules, peakDbfs: Number(dbfs(peak).toFixed(2)), audioSec, videoSec };
}

// One call for both paths: build or find the track, mux it (or copy the silent
// video when sound is none by request), gate the result.
export async function produceSound({ out, treatment, fps, totalFrames, cuts, video, output, suppliedAudio = null }) {
  const mode = suppliedAudio && treatment.sound.mode === 'generated' ? 'supplied' : treatment.sound.mode;
  const durationSec = totalFrames / fps;
  if (mode === 'none') {
    copyFileSync(video, output);
    return { summary: { mode, label: 'no sound (silence was asked for, or the channel plays muted)' }, rules: [{ id: 'sound-stream', status: 'PASS', detail: 'no sound planned' }] };
  }
  let track, bed = null;
  if (mode === 'generated') {
    bed = buildBed({ out, treatment, fps, totalFrames, cuts });
    track = bed.file;
  } else {
    track = suppliedAudio || resolve(out, treatment.sound.file || '');
    if (!treatment.sound.file && !suppliedAudio) throw fail(`a ${mode} track needs sound.file`);
    if (!existsSync(track)) throw fail(`the ${mode} track ${track} does not exist`);
  }
  muxAudio({ video, track, output, durationSec });
  const gate = soundGate({ file: output, mode });
  const label = bed
    ? `generated sound bed (${bed.palette}, ${bed.key}, ${bed.bpm} BPM; ${bed.loudnessLufs} LUFS, peak ${bed.peakDbfs} dBFS) — labelled as generated`
    : `${mode} track ${track} muxed, padded or trimmed to the film`;
  return { summary: { mode, label, track, bed: bed && { sha256: bed.sha256, loudnessLufs: bed.loudnessLufs, peakDbfs: bed.peakDbfs, palette: bed.palette, key: bed.key, bpm: bed.bpm }, mux: { peakDbfs: gate.peakDbfs, audioSec: gate.audioSec, videoSec: gate.videoSec } }, rules: gate.rules };
}

// `sound --out DIR`: build the bed and cues from the treatment alone (the
// render rebuilds it with the film's exact frame count and cuts).
export async function soundCommand(flags) {
  const out = resolve(flags.out || 'motion-output');
  try {
    const { treatment } = loadTreatment(out, EXIT.BLOCKED_TREATMENT_INVALID);
    if (treatment.sound.mode !== 'generated') {
      console.log(`sound: the treatment's sound mode is ${treatment.sound.mode}; nothing to generate`);
      return 0;
    }
    const fps = treatment.fps === 30 ? 30 : 60;
    const manifestFile = join(out, 'manifest.json');
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
    const totalFrames = manifest?.totalFrames || Math.round((manifest?.durationSec || treatment.durationSec) * fps);
    const cuts = manifest?.path === 'stage' && manifest.beats ? manifest.beats.slice(1).map((b) => b.first / fps)
      : manifest?.timeline ? manifest.timeline.filter((u) => u.kind === 'line').slice(1).map((u) => u.start)
        : treatment.beats.slice(1).map((b) => b.t0);
    const bed = buildBed({ out, treatment, fps: manifest?.fps || fps, totalFrames, cuts });
    console.log(`sound: ${bed.file} (${bed.palette}, ${bed.key}, ${bed.bpm} BPM; ${bed.loudnessLufs} LUFS; peak ${bed.peakDbfs} dBFS; ${bed.samples} samples; sha256 ${bed.sha256.slice(0, 12)})`);
    console.log(`cues: ${join(out, 'sound-cues.json')} (${bed.cues.length} cues)`);
    return 0;
  } catch (error) {
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    return error.exitCode ?? 1;
  }
}
