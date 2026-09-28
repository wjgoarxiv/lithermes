#!/usr/bin/env node
// lit-typographic-motion render CLI for LitHermes. The mode set and flags
// follow pdoom's scripts/render.ts (stills, sheet, perf, video; --samples,
// --shutter, --scale), MIT, see NOTICE; `run` is the one end-to-end command
// and `gate`/`complete` re-check an existing output directory. The render only
// reads the pre-warmed cache and writes inside --out (MO-A-43).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDIT_LINE, ENGINE_CREDIT, EXIT, FRAME, PERF, SAMPLING } from '../engine/constants.mjs';
import { PRESETS, pickPreset, planPasses, terminalSignal } from '../engine/presets.mjs';
import { buildTimeline, normalizeBrief, shotsOf } from '../engine/timeline.mjs';
import { FONT_FILES, FrameComposer, resolveFontId } from '../engine/frame.mjs';
import { openTypeAdapter, scriptRuns } from '../engine/type.mjs';
import { parseStrokeFont, STROKE_FONTS } from '../engine/stroke.mjs';
import { FlashDetector } from '../engine/flash.mjs';
import { measureContrast, preflightGate, promoteExports, renderReport, runGate } from '../engine/gate.mjs';
import { areaResize, contactSheet, encodePreview, ffprobe, hasFfmpeg, pngDecode, pngEncode, startMaster } from '../engine/encode.mjs';
import { openRenderer } from '../engine/browser.mjs';
import { WARM, audioState, findCache, fontFile, fontState, hangulPath, runtimeRequire, skillRoot, wordTimingReady } from './runtime.mjs';
import { loadTreatment } from '../engine/treatment.mjs';
import { recordFirstTreatment } from '../engine/director.mjs';
import { stageCommand, stageRegate } from '../engine/stage.mjs';
import { completeCommand, lookCommand } from '../engine/look.mjs';
import { stampStills, stillsPlan, writeStillsSet } from '../engine/stills.mjs';
import { produceSound, soundCommand, soundGate } from '../engine/sound.mjs';
import { viewedFiles } from '../engine/director.mjs';

const USAGE = `LitHermes lit-typographic-motion
usage: node motion.mjs <subcommand> --out DIR [options]   (write DIR/treatment.json first)
  stage    --out DIR [--stills-only] [--round 1-3]                stage path: capture DIR/stage/index.html frame by frame; stills, film, sound, gate
  run      --out DIR [--brief FILE] [--round 1-3] [--stills-only] type path: the WebGL2 type engine; stills, cut sheet, film, preview, poster, gate
  sound    --out DIR                                              build the generated sound bed and sound-cues.json from the treatment
  look     --out DIR --round 1-3 --answers FILE                   record one look round against the latest stills set
  gate     --out DIR                                              rerun the gate on an existing output dir
  complete --out DIR                                              exit 0 only when this film is done (treatment, gate, look rounds)
type-path tools: stills, sheet, video, perf (--brief FILE --out DIR)
options: --scale 1-4  --word-timing  --force-software
exit: 0 ok, 10 no Chrome, 11 no WebGL2, 12 no ffmpeg for video, 13 QA gate failed, 14 not pre-warmed, 15 font missing or corrupt,
      16 treatment invalid, 17 stage contract, 18 stage not deterministic, 19 stage network request, 20 sound invalid
${CREDIT_LINE}`;

const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { exitCode: code });
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const NOTICE_SHA = '6734178ad953e5f40585d000c13e4803e670d9e8982b7f6ef0395d47a9eedf30';

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { flags._.push(arg); continue; }
    const key = arg.slice(2);
    if (['stills-only', 'cuts', 'word-timing', 'force-software', 'help', 'no-rerender', 'aids', 'detach'].includes(key)) flags[key] = true;
    else if (key === 'viewed') flags.viewed = String(argv[++i] || '').split(',').map((v) => Number(v.replace(/^f/, ''))).filter(Number.isInteger);
    else flags[key] = argv[++i];
  }
  return flags;
}

class FontSet {
  constructor(opentype, cache) { this.opentype = opentype; this.cache = cache; this.fonts = new Map(); }
  path(id) {
    const file = FONT_FILES[id];
    return file.startsWith('lit-pptx:') ? hangulPath(file.slice(9)) : fontFile(this.cache, file);
  }
  get(id) {
    if (!this.fonts.has(id)) {
      const bytes = readFileSync(this.path(id));
      const parsed = this.opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      this.fonts.set(id, openTypeAdapter(parsed, id, FONT_FILES[id].replace(/^lit-pptx:/, '').split('/').pop()));
    }
    return this.fonts.get(id);
  }
}

class StrokeSet {
  constructor(cache) { this.cache = cache; this.fonts = new Map(); }
  get(name) {
    if (!this.fonts.has(name)) {
      const file = STROKE_FONTS[name];
      const font = parseStrokeFont(readFileSync(fontFile(this.cache, `fonts/stroke/${file}`), 'utf8'), name);
      font.file = file;
      this.fonts.set(name, font);
    }
    return this.fonts.get(name);
  }
}

const FILTER_ORDER = { 'swiss-signal': ['dither'], terminalcore: ['crt', 'dither', 'glitch'], tidal: ['glitch'] };

class Session {
  constructor(flags, mode) {
    this.flags = flags;
    this.mode = mode;
    this.out = resolve(flags.out || 'motion-output');
    this.round = Number(flags.round || 1);
    this.scale = Math.max(1, Math.min(FRAME.maxScale, Math.round(Number(flags.scale || 1))));
    this.framesViewed = flags.viewed || [];
    this.records = [];
    this.previewRecords = [];
    this.contrast = [];
  }

  prepare() {
    if (!this.flags.brief) throw fail(2, 'missing --brief FILE (a JSON brief with "text": ["line", ...])');
    this.briefPath = resolve(this.flags.brief);
    if (!existsSync(this.briefPath)) throw fail(2, `brief not found: ${this.briefPath}`);
    const rawBytes = readFileSync(this.briefPath);
    let raw;
    try { raw = JSON.parse(rawBytes.toString('utf8')); } catch (error) { throw fail(2, `brief is not valid JSON: ${error.message}`); }
    try { this.brief = normalizeBrief(raw); } catch (error) { throw fail(2, error.message); }
    this.briefSha = sha(rawBytes);
    if (![1, 2, 3].includes(this.round)) throw fail(2, '--round must be 1, 2 or 3');
    if ((this.flags['word-timing'] || this.brief.wordTiming) && !wordTimingReady()) {
      throw fail(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: word-timing models are not installed; run \`${WARM} --word-timing\` outside this session (Tier 3 is fail-closed until its Korean alignment model is pinned)`);
    }
    this.require = runtimeRequire();
    this.cache = findCache();
    const fonts = fontState();
    if (!fonts.ok) {
      throw fail(EXIT.BLOCKED_FONT_FETCH, `BLOCKED_FONT_FETCH: ${[...fonts.missing.map((f) => `missing ${f}`), ...fonts.mismatched.map((f) => `sha256 mismatch ${f}`)].join('; ')}; run \`${WARM}\` outside this session`);
    }
    this.PNG = this.require('pngjs').PNG;
    this.fonts = new FontSet(this.require('opentype.js'), this.cache);
    this.strokes = new StrokeSet(this.cache);
    if (this.treatment && this.brief.durationSec == null) this.brief.durationSec = this.treatment.durationSec;
    this.choice = pickPreset(this.brief, { request: this.treatment?.request || '' });
    this.presetId = this.choice.id;
    this.preset = PRESETS[this.presetId];
    this.signal = this.presetId === 'terminalcore' ? terminalSignal(this.brief) : this.preset.palette.signal;
    this.warnings = [];
    this.audioGrid = null;
    if (this.brief.audio) this.audioGrid = this.analyzeAudio();
    const built = buildTimeline(this.brief, { presetId: this.presetId, fps: FRAME.fps, audioGrid: this.audioGrid });
    this.timeline = built.timeline;
    this.durationSec = built.durationSec;
    this.warnings.push(...built.warnings);
    this.totalFrames = Math.round(this.durationSec * FRAME.fps);
  }

  analyzeAudio() {
    const audioPath = isAbsolute(this.brief.audio) ? this.brief.audio : resolve(dirname(this.briefPath), this.brief.audio);
    const state = audioState();
    if (state.state !== 'ready') {
      this.warnings.push(state.state === 'absent'
        ? `audio analysis not prewarmed: run ${WARM} --audio (Tier 1 text timing used)`
        : `audio venv does not match its pins (${state.detail}); run ${WARM} --audio (Tier 1 text timing used)`);
      return null;
    }
    mkdirSync(this.out, { recursive: true });
    const grid = join(this.out, 'audio-grid.json');
    const result = spawnSync(state.python, [join(skillRoot, 'bin', 'audio.py'), audioPath, grid], { encoding: 'utf8', timeout: 300000 });
    if (result.status !== 0 || !existsSync(grid)) {
      this.warnings.push(`audio analysis failed (${(result.stderr || result.error?.message || '').trim().split('\n').at(-1)}); Tier 1 text timing used`);
      return null;
    }
    const parsed = JSON.parse(readFileSync(grid, 'utf8'));
    if (!parsed.beats?.length) { this.warnings.push('audio analysis found no beats; Tier 1 text timing used'); return null; }
    this.audioPath = audioPath;
    return parsed;
  }

  baseManifest() {
    return {
      schemaVersion: 1, engineCredit: ENGINE_CREDIT, presetId: this.presetId, seed: this.brief.seed, fps: FRAME.fps,
      resolution: [FRAME.width * this.scale, FRAME.height * this.scale], scale: this.scale,
      samples: this.samples ?? SAMPLING.masterSamples, shutter: SAMPLING.masterShutter,
      renderer: this.renderer?.renderer || '', softwareRenderer: Boolean(this.renderer?.software), chromeFlags: this.renderer?.flags || [],
      previewEncoder: this.previewEncoder || '', audioTier: this.audioGrid ? 'librosa-beat-grid' : 'text-reading-time',
      ...(this.audioGrid ? { beatGrid: this.audioGrid.beats } : { bpm: this.brief.bpm }),
      durationSec: this.durationSec, generatedAt: new Date().toISOString(),
      passRanges: this.plan?.passRanges || [], timeline: this.timeline, warnings: this.warnings,
      lithermes: {
        mode: this.mode, round: this.round, presetReason: this.choice.reason, brief: { path: this.briefPath, sha256: this.briefSha },
        signal: this.signal, events: this.plan?.events || [], shots: this.shotStates || [], egress: this.renderer?.egress, listenError: this.renderer?.listenError,
        chromeSockets: this.renderer?.sockets, previewFps: this.previewFps, previewWidth: this.previewWidth, previewAttempts: this.previewAttempts,
        stills: this.stillFrames, cuts: this.cutFrames, contrastFrames: this.contrastFrames, determinism: this.determinism, perf: this.perf, sound: this.sound?.summary,
        reducedInk: this.reducedInk, posterInk: this.posterInk, accent: this.accent, cache: this.cache, framesViewed: this.framesViewed,
      },
    };
  }

  composer() {
    const shots = shotsOf(this.timeline);
    let accent = null;
    const host = this.brief.accent === false ? null : shots[typeof this.brief.accent === 'number' ? this.brief.accent : 0];
    if (host && this.preset.palette.accent) {
      const beat = 60 / this.brief.bpm;
      const from = (this.preset.motion.entranceSec ?? 0.18) + 0.1;
      const capSec = Math.floor(0.1 * this.totalFrames) / FRAME.fps;
      const to = Math.min(from + 2 * beat, host.holdSec - 1 / FRAME.fps, from + capSec);
      if (to > from) accent = { shotId: host.id, from: Math.round(from * FRAME.fps) / FRAME.fps, to: Math.round(to * FRAME.fps) / FRAME.fps };
    }
    this.accent = accent;
    return new FrameComposer({
      fonts: this.fonts, strokeFonts: this.strokes, presetId: this.presetId, signal: this.signal, timeline: this.timeline,
      plan: this.plan, fps: FRAME.fps, durationSec: this.durationSec, runSeed: this.brief.seed, software: Boolean(this.renderer?.software),
      brief: this.brief, accent,
    });
  }

  // MO-D-04 on exactly the elements that will be drawn, before any frame.
  preflight() {
    this.plan = planPasses({ presetId: this.presetId, timeline: this.timeline, runSeed: this.brief.seed, fps: FRAME.fps, software: false, brief: this.brief });
    const composer = this.composer();
    const missing = new Map();
    const check = (text, voice, weight, widthStep) => {
      for (const run of scriptRuns(text)) {
        const font = this.fonts.get(resolveFontId(this.presetId, voice, run.script, weight, widthStep));
        for (const ch of run.text) if (ch.trim() && !font.has(ch)) missing.set(`${ch}|${font.file}`, { ch, font: font.file });
      }
    };
    shotsOf(this.timeline).forEach((_, i) => {
      for (const reduced of [false, true]) {
        const { display } = composer.sceneAt(0, { still: true, reduced, shotIndex: i });
        for (const el of display.texts) check(el.text, el.voice, el.weight, el.widthStep);
        for (const st of display.strokes || []) {
          const font = this.strokes.get(st.font);
          for (const ch of st.text) if (ch.trim() && !font.glyphs.has(ch)) missing.set(`${ch}|${font.file}`, { ch, font: font.file });
        }
        if (display.terminal) for (const text of [display.terminal.title.toUpperCase(), display.terminal.status]) check(text, 'label', 400, 100);
      }
    });
    this.missingGlyphs = [...missing.values()];
    const manifest = this.baseManifest();
    const gate = preflightGate(manifest, { missingGlyphs: this.missingGlyphs });
    if (gate.failed.length) {
      mkdirSync(this.out, { recursive: true });
      writeJson(join(this.out, 'manifest.json'), manifest);
      writeFileSync(join(this.out, 'gate-report.txt'), renderReport(manifest, gate, { preflight: true }));
      throw Object.assign(fail(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA (pre-flight, nothing rendered): ${gate.rules.filter((r) => r.status === 'FAIL').map((r) => `${r.id} ${r.detail}`).join('; ')}`), { failed: gate.failed });
    }
  }

  async openChrome() {
    mkdirSync(join(this.out, '.run'), { recursive: true });
    this.renderer = await openRenderer({
      runtime: this.require, pageScript: join(skillRoot, 'engine', 'page.js'), profileRoot: join(this.out, '.run', `c${process.pid % 100000}`),
      scale: this.scale, forceSoftware: Boolean(this.flags['force-software']),
    });
    const software = this.renderer.software;
    this.samples = software ? 1 : SAMPLING.masterSamples;
    if (software) this.warnings.push(`software GL detected (${this.renderer.renderer}); renders will be slower, --samples lowered to 1`);
    this.plan = planPasses({ presetId: this.presetId, timeline: this.timeline, runSeed: this.brief.seed, fps: FRAME.fps, software, brief: this.brief });
    const persistence = this.plan.passRanges.some((r) => r.pass === 'crt' && r.params.persistenceEnabled);
    this.shotStates = shotsOf(this.timeline).map((s) => ({ sceneId: s.sceneId, shotIndex: s.shotIndex, stateful: persistence || s.sceneId === 'number-counter', prerollMax: s.sceneId === 'number-counter' ? s.holdSec : persistence ? 2 / FRAME.fps : 0 }));
    this.comp = this.composer();
    this.lastRendered = null;
  }

  persistenceFor(frame) {
    const range = this.plan.passRanges.find((r) => r.pass === 'crt' && frame >= r.frameStart && frame <= r.frameEnd);
    return range?.params.persistenceEnabled ? range : null;
  }

  async renderFrame(frame, { samples, settled = null } = {}) {
    const range = settled ? null : this.persistenceFor(frame);
    if (range && !(this.lastRendered && this.lastRendered.frame === frame - 1 && this.lastRendered.samples === samples)) {
      const from = Math.max(range.frameStart, frame - 2);
      for (let f = from; f < frame; f++) {
        const { spec } = this.comp.frameSpec(f, { samples, shutter: SAMPLING.masterShutter });
        spec.order = FILTER_ORDER[this.presetId]; spec.prime = true; spec.resetRing = f === from;
        await this.renderer.frame(spec);
      }
    }
    const { spec, meta } = this.comp.frameSpec(frame, { samples, shutter: SAMPLING.masterShutter, settled });
    spec.order = FILTER_ORDER[this.presetId];
    spec.resetRing = Boolean(range) && !(this.lastRendered && this.lastRendered.frame === frame - 1 && this.lastRendered.samples === samples) && frame === range.frameStart;
    const result = await this.renderer.frame(spec);
    this.lastRendered = settled ? null : { frame, samples };
    const bytes = result.bytes;
    const px = bytes.length / 4;
    const mask = Buffer.alloc(px);
    let ink = 0;
    for (let i = 0, j = 3; i < px; i++, j += 4) { const a = bytes[j]; mask[i] = a; if (a >= 128) ink++; bytes[j] = 255; }
    return { bytes, mask, ink, meta, page: result.meta };
  }

  shotFrames() {
    return shotsOf(this.timeline).map((s) => {
      const a = Math.round(s.start * FRAME.fps), b = Math.round(s.end * FRAME.fps) - 1;
      return { shot: s, first: a, last: b, rep: Math.max(a, b - 6) };
    });
  }

  savePng(file, bytes, width, height, opts) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pngEncode(this.PNG, bytes, width, height, opts));
  }

  async stills() {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    const dir = join(this.out, 'stills');
    rmSync(dir, { recursive: true, force: true });
    const paths = [];
    this.stillFrames = [];
    for (const [i, s] of this.shotFrames().entries()) {
      const r = await this.renderFrame(s.rep, { samples: SAMPLING.previewSamples });
      const file = join(dir, `${String(i + 1).padStart(2, '0')}-${s.shot.id}-f${s.rep}.png`);
      this.savePng(file, r.bytes, W, H);
      paths.push(file);
      this.stillFrames.push(s.rep);
    }
    return paths;
  }

  async sheet(cuts = true) {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    const frames = [];
    if (cuts) for (const s of this.shotFrames().slice(1)) for (const f of [s.first - 6, s.first - 1, s.first, s.first + 6]) frames.push(Math.max(0, Math.min(this.totalFrames - 1, f)));
    if (!frames.length) for (let i = 0; i < 12; i++) frames.push(Math.round((i * (this.totalFrames - 1)) / 11));
    this.cutFrames = this.shotFrames().slice(1).map((s) => s.first);
    const tiles = [];
    for (const f of frames) {
      const r = await this.renderFrame(f, { samples: SAMPLING.previewSamples });
      tiles.push({ data: r.bytes, width: W, height: H, frame: f });
    }
    mkdirSync(join(this.out, 'sheet'), { recursive: true });
    const file = join(this.out, 'sheet', cuts ? 'cuts.png' : 'sheet.png');
    contactSheet(this.PNG, tiles, file);
    return file;
  }

  // The master: every byte streamed to ffmpeg is the byte hashed and flash-audited.
  async master() {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    const run = join(this.out, '.run');
    const film = join(run, 'film.mp4');
    const video = join(run, 'video.mp4');
    const encoder = startMaster({ width: W, height: H, fps: FRAME.fps, output: video });
    const detector = new FlashDetector(W, H);
    const previewDir = join(run, 'preview-src');
    rmSync(previewDir, { recursive: true, force: true });
    mkdirSync(previewDir, { recursive: true });
    const previewFrames = [];
    const shots = this.shotFrames();
    const sampled = new Set([...shots.map((s) => s.rep), ...shots.slice(1).map((s) => s.first), 0]);
    this.contrastFrames = [...sampled].sort((a, b) => a - b);
    const LUT = Float64Array.from({ length: 256 }, (_, v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    const passes = this.preset.passes;
    this.dplan = this.directorPlan();
    const planFrames = new Set(this.dplan.frames);
    this.planPngs = new Map();
    for (let f = 0; f < this.totalFrames; f++) {
      const r = await this.renderFrame(f, { samples: this.samples });
      const flash = detector.push(r.bytes);
      const bins = new Uint32Array(1024);
      for (let i = 0; i < r.bytes.length; i += 4) {
        const l = 0.2126 * LUT[r.bytes[i]] + 0.7152 * LUT[r.bytes[i + 1]] + 0.0722 * LUT[r.bytes[i + 2]];
        bins[Math.min(1023, Math.floor(l * 1024))]++;
      }
      let acc = 0, p995 = 1;
      const target = 0.995 * (r.bytes.length / 4);
      for (let i = 0; i < 1024; i++) { acc += bins[i]; if (acc >= target) { p995 = (i + 1) / 1024; break; } }
      if (planFrames.has(f)) this.planPngs.set(f, pngEncode(this.PNG, r.bytes, W, H, { level: 1, scratch: true }));
      await encoder.write(r.bytes);
      if (f % 2 === 0) {
        const small = areaResize(r.bytes, W, H, 960);
        const file = join(previewDir, `s${String(f).padStart(5, '0')}.png`);
        writeFileSync(file, pngEncode(this.PNG, small.data, small.width, small.height, { level: 1, scratch: true }));
        previewFrames[f] = file;
      }
      if (sampled.has(f)) {
        this.savePng(join(run, 'masks', `f${String(f).padStart(5, '0')}.png`), r.mask, W, H, { gray: true });
        this.savePng(join(run, 'frames', `f${String(f).padStart(5, '0')}.png`), r.bytes, W, H);
        for (const box of r.meta.textBoxes) {
          if (!box.settled) continue;
          const m = measureContrast(r.bytes, r.mask, W, H, box, this.scale);
          if (m) this.contrast.push({ frame: f, elementId: box.elementId, ratio: m.ratio, floor: m.floor, fontSizePx: box.fontSizePx, weight: box.weight, fill: box.fill });
        }
      }
      this.records.push({
        frame: f, pass: null, rgbaSha256: sha(r.bytes), textBoxes: r.meta.textBoxes, graphics: r.meta.graphics, block: r.meta.block,
        glyphInk: r.ink, lumP995: Number(p995.toFixed(4)), flash: { general: flash.general, generalBoth: flash.generalBoth, red: flash.red, redBoth: flash.redBoth },
        fullFrameStep: Number(flash.fullFrameStep.toFixed(4)), overrides: r.meta.overrides, accent: r.meta.accent, fills: r.meta.fills,
        sampleTimes: r.meta.sampleTimes, sceneId: r.meta.sceneId, shotIndex: r.meta.shotIndex, renderMs: Number(r.page.renderMs.toFixed(2)),
      });
      for (const pass of passes) {
        const logged = r.page.passes[pass];
        this.records.push({ frame: f, pass, draws: logged?.draws || 0, uniforms: logged?.uniforms || {} });
      }
      if (f % 60 === 59) process.stderr.write(`motion: ${f + 1}/${this.totalFrames} frames\n`);
    }
    const encoded = await encoder.finish();
    if (encoded.code !== 0) throw fail(1, `ffmpeg master encode failed: ${encoded.stderr.split('\n').filter(Boolean).at(-1) || encoded.code}`);
    // Every planned track is muxed here, whatever the --audio tier's state:
    // the beat grid is optional, the soundtrack is not.
    const supplied = this.brief.audio ? (isAbsolute(this.brief.audio) ? this.brief.audio : resolve(dirname(this.briefPath), this.brief.audio)) : null;
    this.sound = await produceSound({
      out: this.out, treatment: this.treatment, fps: FRAME.fps, totalFrames: this.totalFrames,
      cuts: this.shotFrames().slice(1).map((s) => s.first / FRAME.fps), video, output: film, suppliedAudio: supplied,
    });
    rmSync(video, { force: true });
    const preview = encodePreview({ PNG: this.PNG, sourceFrames: previewFrames, masterFps: FRAME.fps, durationSec: this.durationSec, workDir: run,
      minGlyphPx: Math.min(...this.records.flatMap((row) => (row.textBoxes || []).map((b) => b.fontSizePx)).filter(Boolean), 64) });
    rmSync(previewDir, { recursive: true, force: true });
    this.previewAttempts = preview.attempts;
    if (preview.file) {
      this.previewEncoder = preview.encoder; this.previewFps = preview.fps; this.previewWidth = preview.width;
      this.previewRecords = preview.records.map((row) => ({ ...row, preview: true }));
      this.previewName = preview.encoder === 'gif' ? 'preview.gif' : 'preview.webp';
    }
    return film;
  }

  async stillsForExport() {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    const shots = shotsOf(this.timeline);
    const poster = await this.renderFrame(Math.round(shots[0].end * FRAME.fps) - 1, { samples: 1, settled: { shotIndex: 0, reduced: false } });
    this.savePng(join(this.out, '.run', 'poster.png'), poster.bytes, W, H, { level: 9 });
    this.posterInk = poster.ink;
    const reduced = await this.renderFrame(this.totalFrames - 1, { samples: 1, settled: { shotIndex: shots.length - 1, reduced: true } });
    this.savePng(join(this.out, '.run', 'reduced-motion.png'), reduced.bytes, W, H, { level: 9 });
    this.savePng(join(this.out, '.run', 'masks', 'reduced.png'), reduced.mask, W, H, { gray: true });
    this.reducedInk = reduced.ink;
  }

  // MO-C-09 / MO-A-25: each cut frame re-rendered as a seek in a fresh process.
  determinismCheck() {
    const shots = this.shotFrames();
    const frames = [...new Set([0, ...shots.slice(1).map((s) => s.first), ...shots.filter((s) => s.shot.sceneId === 'number-counter').map((s) => Math.round((s.first + s.last) / 2))])].slice(0, 6);
    const byFrame = new Map(this.records.filter((r) => r.pass === null).map((r) => [r.frame, r.rgbaSha256]));
    const child = (frame, software) => {
      const dir = join(this.out, '.run', `det-${frame}${software ? '-sw' : ''}-${Math.random().toString(36).slice(2, 6)}`);
      const args = [fileURLToPath(import.meta.url), 'hash-frame', '--brief', this.briefPath, '--out', dir, '--frame', String(frame), '--samples', String(this.samples), '--scale', String(this.scale)];
      if (software) args.push('--force-software');
      if (this.flags['force-software']) args.push('--force-software');
      const res = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 600000 });
      rmSync(dir, { recursive: true, force: true });
      const line = (res.stdout || '').split('\n').find((l) => l.startsWith('MOTION_FRAME '));
      if (!line) throw new Error(`determinism child for frame ${frame} failed: ${(res.stderr || '').trim().split('\n').at(-1) || res.status}`);
      return JSON.parse(line.slice('MOTION_FRAME '.length));
    };
    const checks = [];
    for (const frame of frames) {
      const seeked = child(frame, false);
      const sameHost = seeked.renderer === this.renderer.renderer && seeked.flags.join(' ') === this.renderer.flags.join(' ');
      const entry = { frame, sequential: byFrame.get(frame), seeked: seeked.rgbaSha256, match: sameHost && seeked.rgbaSha256 === byFrame.get(frame), renderer: seeked.renderer };
      if (!entry.match) {
        const a = child(frame, true), b = child(frame, true);
        entry.software = { first: a.rgbaSha256, second: b.rgbaSha256, renderer: a.renderer };
      }
      checks.push(entry);
    }
    this.determinism = { checks, samples: this.samples };
  }

  async perfRun() {
    const times = [];
    for (let i = 0; i < PERF.frames; i++) {
      const f = Math.round((i * (this.totalFrames - 1)) / (PERF.frames - 1));
      this.lastRendered = null;
      const r = await this.renderFrame(f, { samples: 1 });
      times.push(r.page.renderMs);
    }
    times.sort((a, b) => a - b);
    this.perf = { frames: times.length, p50Ms: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * 0.95) - 1], maxMs: times.at(-1), software: this.renderer.software, samples: 1 };
    return this.perf;
  }

  // The director stills set (craft-loop.md): every shot's midpoint, a strip
  // per cut, the contact sheet and the poster.
  directorPlan() {
    const beats = this.shotFrames().map((s, index) => ({ index, first: s.first, last: s.last, mid: Math.round((s.first + s.last) / 2) }));
    return stillsPlan({ totalFrames: this.totalFrames, beats });
  }

  async directorStillsOnly() {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    const plan = this.directorPlan();
    const pngs = new Map();
    for (const f of plan.frames) {
      const r = await this.renderFrame(f, { samples: SAMPLING.previewSamples });
      pngs.set(f, pngEncode(this.PNG, r.bytes, W, H, { level: 1, scratch: true }));
    }
    const shots = shotsOf(this.timeline);
    const poster = await this.renderFrame(Math.round(shots[0].end * FRAME.fps) - 1, { samples: 1, settled: { shotIndex: 0, reduced: false } });
    return writeStillsSet({ out: this.out, PNG: this.PNG, pngs, plan, size: [W, H], round: this.round, mode: 'stills-only', posterPng: pngEncode(this.PNG, poster.bytes, W, H) });
  }

  directorStillsFromMaster() {
    const W = FRAME.width * this.scale, H = FRAME.height * this.scale;
    return writeStillsSet({ out: this.out, PNG: this.PNG, pngs: this.planPngs, plan: this.dplan, size: [W, H], round: this.round, mode: this.mode, posterPng: readFileSync(join(this.out, '.run', 'poster.png')) });
  }

  gateNow() {
    const manifest = this.baseManifest();
    const where = (name) => [join(this.out, '.run', name), join(this.out, name), join(this.out, 'withheld', name)].find((p) => existsSync(p));
    const films = where('film.mp4'), prev = this.previewName && where(this.previewName), poster = where('poster.png'), reduced = where('reduced-motion.png');
    const exports = {
      probe: films ? ffprobe(films) : null,
      sizes: { film: films && statSync(films).size, preview: prev && statSync(prev).size, poster: poster && statSync(poster).size, reduced: reduced && statSync(reduced).size },
      present: { film: Boolean(films), preview: Boolean(prev), poster: Boolean(poster), reduced: Boolean(reduced), manifest: true },
    };
    const notice = existsSync(join(skillRoot, 'engine', 'NOTICE')) && sha(readFileSync(join(skillRoot, 'engine', 'NOTICE'))) === NOTICE_SHA;
    const gate = runGate({ manifest, records: this.records, preview: this.previewRecords, exports, contrast: this.contrast, preflight: { missingGlyphs: this.missingGlyphs || [] }, notice });
    gate.rules.push(...(this.sound?.rules || []));
    gate.failed = gate.rules.filter((r) => r.status === 'FAIL').map((r) => r.id);
    return { manifest, gate, exports };
  }

  writeOutputs(manifest, gate, { keepManifest = false } = {}) {
    if (!keepManifest) writeJson(join(this.out, 'manifest.json'), manifest);
    writeFileSync(join(this.out, 'render.jsonl'), [...this.records, ...this.previewRecords].map((row) => JSON.stringify(row)).join('\n') + '\n');
    const outputs = gate.withhold
      ? { film: 'withheld/film.mp4', preview: `withheld/${this.previewName || 'preview.webp'}`, poster: 'withheld/poster.png', reduced: 'withheld/reduced-motion.png' }
      : { film: 'film.mp4', preview: this.previewName || 'preview (not produced)', poster: 'poster.png', reduced: 'reduced-motion.png' };
    const looked = viewedFiles(this.out);
    writeFileSync(join(this.out, 'gate-report.txt'), renderReport(manifest, gate, { outputs, framesViewed: looked.length ? looked : this.framesViewed, egress: this.renderer?.egress, withheld: gate.withhold }));
  }
}

// Type path: the treatment comes first. Without --brief the engine brief is
// DIR/brief.json, written from the treatment's copy the first time and then
// yours to refine (scenes, style, accent).
function typePathTreatment(session) {
  const { treatment } = loadTreatment(session.out, EXIT.BLOCKED_TREATMENT_INVALID);
  if (treatment.path !== 'type') {
    throw fail(EXIT.BLOCKED_TREATMENT_INVALID, 'BLOCKED_TREATMENT_INVALID: field path: this treatment takes the stage path; render it with `stage --out DIR`');
  }
  recordFirstTreatment(session.out, treatment);
  session.treatment = treatment;
  if (!session.flags.brief) {
    const derived = join(session.out, 'brief.json');
    if (!existsSync(derived)) writeJson(derived, { text: treatment.copy.lines, durationSec: treatment.durationSec });
    session.flags.brief = derived;
  }
}

function writeState(out, state) {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'run-state.json'), { ...state, finishedAt: new Date().toISOString() });
}

async function main(argv) {
  const flags = parseArgs(argv);
  const mode = flags._[0];
  if (!mode || flags.help || mode === 'help') { console.log(USAGE); return 0; }
  if (mode === 'complete') return completeCommand(resolve(flags.out || 'motion-output'));
  if (mode === 'stage') return stageCommand(flags);
  if (mode === 'sound') return soundCommand(flags);
  if (mode === 'look') return lookCommand(flags);
  if (!['run', 'stills', 'sheet', 'video', 'perf', 'gate', 'hash-frame'].includes(mode)) { console.error(USAGE); return 2; }
  if (mode === 'gate') return regate(flags);
  const session = new Session(flags, flags['stills-only'] ? 'stills-only' : mode);
  const stateOut = mode === 'hash-frame' ? null : session.out;
  if (stateOut) writeState(stateOut, { exitCode: null, mode: session.mode, round: session.round, finished: false });
  try {
    if (mode !== 'hash-frame') typePathTreatment(session);
    session.prepare();
    if (mode !== 'hash-frame') session.preflight();
    const ffmpeg = hasFfmpeg();
    if (mode === 'video' && !ffmpeg) throw fail(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, 'BLOCKED_NO_FFMPEG_FOR_VIDEO: ffmpeg is not on PATH; `stills` and `sheet` still work, install ffmpeg for the film');
    await session.openChrome();
    try {
      if (mode === 'hash-frame') {
        const frame = Number(flags.frame);
        if (!Number.isInteger(frame) || frame < 0 || frame >= session.totalFrames) throw fail(2, '--frame must name a frame of this film');
        session.samples = Number(flags.samples || session.samples);
        // --from K renders K..frame sequentially in this one process (a video-mode
        // frame line); without it the frame is a cold seek (MO-A-25, MO-C-09).
        const from = flags.from == null ? frame : Number(flags.from);
        let r;
        for (let f = Math.max(0, Math.min(from, frame)); f <= frame; f++) r = await session.renderFrame(f, { samples: session.samples });
        console.log(`MOTION_FRAME ${JSON.stringify({ frame, rgbaSha256: sha(r.bytes), renderer: session.renderer.renderer, flags: session.renderer.flags, egress: session.renderer.egress })}`);
        return 0;
      }
      if (mode === 'perf') {
        const perf = await session.perfRun();
        mkdirSync(session.out, { recursive: true });
        writeJson(join(session.out, 'perf.json'), { ...perf, renderer: session.renderer.renderer, flags: session.renderer.flags });
        console.log(`motion perf: p95 ${perf.p95Ms.toFixed(1)} ms (p50 ${perf.p50Ms.toFixed(1)}, max ${perf.maxMs.toFixed(1)}) over ${perf.frames} frames at samples 1; renderer ${session.renderer.renderer}`);
        const ceiling = perf.software ? PERF.softwareP95Ms : PERF.hardwareP95Ms;
        writeState(session.out, { exitCode: perf.p95Ms > ceiling ? 13 : 0, mode, round: session.round, finished: true, failed: perf.p95Ms > ceiling ? ['MO-D-02'] : [] });
        return perf.p95Ms > ceiling ? 13 : 0;
      }
      if (mode === 'run' || mode === 'stills') {
        const stills = await session.stills();
        console.log(`stills: ${stills.join(' ')}`);
      }
      if (mode === 'run' || mode === 'sheet') {
        const sheet = await session.sheet(mode === 'run' || Boolean(flags.cuts));
        console.log(`sheet: ${sheet}`);
      }
      if (mode === 'run' && flags['stills-only']) {
        const set = await session.directorStillsOnly();
        console.log(`stills set: ${set.files.map((f) => join(session.out, f.file)).join(' ')}`);
      }
      if (mode === 'stills' || mode === 'sheet' || flags['stills-only']) {
        writeJson(join(session.out, 'manifest.json'), session.baseManifest());
        if (mode === 'run') stampStills(session.out);
        writeState(session.out, { exitCode: 0, mode: session.mode, round: session.round, finished: true, failed: [] });
        console.log('View every still, strip and the contact sheet with your image tool, then record the round with `look` before the full render.');
        return 0;
      }
      if (!ffmpeg) {
        writeJson(join(session.out, 'manifest.json'), session.baseManifest());
        throw fail(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, `BLOCKED_NO_FFMPEG_FOR_VIDEO: stills and the cut sheet are in ${session.out}; ffmpeg is not on PATH, so no film was encoded`);
      }
      await session.master();
      await session.stillsForExport();
      await session.perfRun();
      session.determinismCheck();
      if (mode === 'run') session.directorStillsFromMaster();
      const { manifest, gate } = session.gateNow();
      promoteExports(session.out, { withhold: gate.withhold, previewName: session.previewName || 'preview.webp' });
      session.writeOutputs(manifest, gate);
      if (mode === 'run') stampStills(session.out);
      const code = gate.failed.length ? EXIT.GATE_FAIL_QA : EXIT.OK;
      writeState(session.out, { exitCode: code, mode: session.mode, round: session.round, finished: true, failed: gate.failed, withheld: gate.withhold });
      console.log(`motion ${gate.failed.length ? `QA FAIL (${gate.failed.join(', ')})` : 'QA PASS'}; report ${join(session.out, 'gate-report.txt')}${gate.withhold ? '; exports WITHHELD in withheld/' : ''}`);
      if (gate.failed.length && session.round >= 3) console.log(gate.withhold ? 'Round 3 of 3: the render is withheld pending a fix of the flash failure.' : 'Round 3 of 3: stop and hand back the report with the delivered artifacts.');
      else if (gate.failed.length) console.log(`Fix the named rules and rerun with --round ${session.round + 1}.`);
      return code;
    } finally { await session.renderer.close(); }
  } catch (error) {
    const code = error.exitCode ?? 1;
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    if (stateOut) writeState(stateOut, { exitCode: code, mode: session.mode, round: session.round, finished: true, failed: error.failed || [], message: String(error.message).split('\n')[0] });
    return code;
  }
}

// `gate`: re-measure contrast from the saved masks, rerun determinism and perf,
// and rewrite the report for an existing output directory.
async function regate(flags) {
  const out = resolve(flags.out || 'motion-output');
  const manifestPath = join(out, 'manifest.json');
  if (!existsSync(manifestPath) || !existsSync(join(out, 'render.jsonl'))) { console.error(`no finished render in ${out}`); return 2; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.path === 'stage') return stageRegate(out);
  const session = new Session({ ...flags, brief: manifest.lithermes.brief.path, round: manifest.lithermes.round, scale: manifest.scale }, manifest.lithermes.mode);
  try {
    session.prepare();
    session.preflight();
    const rows = readFileSync(join(out, 'render.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    session.records = rows.filter((r) => !r.preview);
    session.previewRecords = rows.filter((r) => r.preview);
    session.previewEncoder = manifest.previewEncoder; session.previewFps = manifest.lithermes.previewFps; session.previewWidth = manifest.lithermes.previewWidth;
    session.previewName = manifest.previewEncoder === 'gif' ? 'preview.gif' : 'preview.webp';
    session.reducedInk = manifest.lithermes.reducedInk; session.posterInk = manifest.lithermes.posterInk;
    session.framesViewed = manifest.lithermes.framesViewed || [];
    session.stillFrames = manifest.lithermes.stills; session.cutFrames = manifest.lithermes.cuts; session.contrastFrames = manifest.lithermes.contrastFrames;
    const W = FRAME.width * session.scale, H = FRAME.height * session.scale;
    for (const f of session.contrastFrames || []) {
      const framePng = join(out, '.run', 'frames', `f${String(f).padStart(5, '0')}.png`), maskPng = join(out, '.run', 'masks', `f${String(f).padStart(5, '0')}.png`);
      if (!existsSync(framePng) || !existsSync(maskPng)) continue;
      const rgba = pngDecode(session.PNG, framePng).data, maskImg = pngDecode(session.PNG, maskPng).data;
      const mask = Buffer.alloc(W * H);
      for (let i = 0; i < mask.length; i++) mask[i] = maskImg[i * 4];
      const row = session.records.find((r) => r.pass === null && r.frame === f);
      for (const box of row?.textBoxes || []) {
        if (!box.settled) continue;
        const m = measureContrast(rgba, mask, W, H, box, session.scale);
        if (m) session.contrast.push({ frame: f, elementId: box.elementId, ratio: m.ratio, floor: m.floor, fontSizePx: box.fontSizePx, weight: box.weight, fill: box.fill });
      }
    }
    if (flags['no-rerender']) { session.determinism = manifest.lithermes.determinism; session.perf = manifest.lithermes.perf; session.renderer = { renderer: manifest.renderer, flags: manifest.chromeFlags, software: manifest.softwareRenderer, egress: manifest.lithermes.egress }; }
    else {
      await session.openChrome();
      try { await session.perfRun(); } finally { await session.renderer.close(); }
      session.determinismCheck();
    }
    session.plan = { passRanges: manifest.passRanges, events: manifest.lithermes.events };
    const planned = manifest.lithermes.sound;
    const filmFile = [join(out, 'film.mp4'), join(out, 'withheld', 'film.mp4')].find((f) => existsSync(f));
    session.sound = { summary: planned, rules: planned && planned.mode !== 'none' && filmFile ? soundGate({ file: filmFile, mode: planned.mode }).rules : [{ id: 'sound-stream', status: 'PASS', detail: 'no sound planned' }] };
    session.shotStates = manifest.lithermes.shots;
    session.samples = manifest.samples;
    const { manifest: fresh, gate } = session.gateNow();
    session.writeOutputs({ ...fresh, generatedAt: manifest.generatedAt }, gate, { keepManifest: true });
    console.log(readFileSync(join(out, 'gate-report.txt'), 'utf8'));
    writeState(out, { exitCode: gate.failed.length ? 13 : 0, mode: manifest.lithermes.mode, round: manifest.lithermes.round, finished: true, failed: gate.failed, withheld: gate.withhold });
    return gate.failed.length ? EXIT.GATE_FAIL_QA : EXIT.OK;
  } catch (error) {
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    return error.exitCode ?? 1;
  }
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) process.exitCode = await main(process.argv.slice(2));

export { main, parseArgs, USAGE };
