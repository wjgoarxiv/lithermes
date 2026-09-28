// Every number the LitHermes motion engine and its gate use, in one place.
// Source: the family motion spec (FINAL + Delta 1). Rows the spec marks [NEW]
// are PROVISIONAL: implemented exactly as written, pending a user decision, and
// labelled "provisional" here and in every gate report.

export const PROVISIONAL = Object.freeze(new Set([
  'MO-C-05', 'MO-C-06', 'MO-C-07', 'MO-C-08', 'MO-C-13', 'MO-C-14', 'MO-C-25', 'MO-C-29',
  'MO-D-02', 'MO-D-03', 'MO-D-04',
]));

export const FRAME = Object.freeze({ width: 1920, height: 1080, fps: 60, maxScale: 4 });

export const SAMPLING = Object.freeze({
  masterSamples: 4, // MO-A-26
  masterShutter: 0.5,
  previewSamples: 1, // MO-A-27 (stills, sheet, perf)
});

export const TIMING = Object.freeze({
  defaultBpm: 100, // MO-A-14
  paceMargin: 1.25, // MO-A-09/10: generator pace = 1.25 x floor
  minSceneBeats: 2, // MO-A-16
  cutToleranceFrames: 1, // MO-A-15
  minBpm: 40,
  maxBpm: 220,
});

// MO-C-07 / MO-C-08: the one reading-floor function (provisional numbers).
export const READING = Object.freeze({
  hangulSecPerSyllable: 0.2,
  englishWordsPerSec: 3.3,
  englishCps: 17,
  lineFloorLatin: 0.9, // MO-A-11
  lineFloorHangul: 1.0,
  wordFloor: 0.5,
  revealFloor: 0.35, // MO-A-12
});

export const SAFE = Object.freeze({
  titleX: 96, titleY: 54, // MO-C-04
  actionX: 48, actionY: 27, // MO-C-05 provisional
});

export const CONTRAST = Object.freeze({
  body: 4.5, large: 3.0, // MO-C-06 floors
  largePx: 32, largeBoldPx: 25, largeBoldWeight: 700, // MO-C-06 provisional "large"
  maskErodePx: 1, maskDilatePx: 2, bboxExpandCap: 0.25,
});

export const TYPE = Object.freeze({
  displayTrackingMinEm: -0.04, // MO-C-25 provisional
  machineTrackingMinEm: 0,
  lineHeightLatin: 1.5, lineHeightCjk: 1.6, lineHeightThreePlus: 1.4, // MO-C-26
  paragraphChMin: 60, paragraphChMax: 75, // MO-C-27 (Latin FAIL; CJK 30-45 advisory)
  cjkChAdvisoryMin: 30, cjkChAdvisoryMax: 45,
  entranceScaleFloor: 0.95, // CF-503 via MO-A-08
});

export const FLASH = Object.freeze({
  gridX: 320, gridY: 180, cellLogicalPx: 6, // MO-C-03
  cellDelta: 0.1, cellCeiling: 0.8,
  windowLogicalW: 640, windowLogicalH: 360, windowFraction: 0.25,
  redShare: 0.8, redScale: 320, redDelta: 20,
  lookbackFrames: 2,
  maxFlashes: 3, maxRedFlashes: 3,
  fullFrameFraction: 0.25, // MO-SH-04a
});

export const EVENTS = Object.freeze({
  perShotWindowSec: 1, maxPerShotWindow: 2, // MO-SH-03
  flashRiseThreshold: 0.1, // MO-A-58
});

export const PASS_CAPS = Object.freeze({
  glitchHitsPerSec: 2.0, glitchAreaPct: 20, // MO-SH-05
  surgePerSec: 2, surgeAttackSec: 0.1, surgeDecaySec: 0.1, // MO-SH-06
  crtFlickerPeakToPeak: 0.06, // MO-SH-07
  terminalLayersMax: 2, // MO-SH-11
});

export const OUTPUT = Object.freeze({
  minWidth: 1920, minHeight: 1080, minFps: 30, minDurationSec: 3, warnDurationSec: 90, // MO-C-10..12
  previewMaxBytes: 3 * 1000 * 1000, posterMaxBytes: 1000 * 1000, // MO-C-13 provisional
  mp4WarnBytesPer10s: 100 * 1000 * 1000,
  previewLadder: Object.freeze([[960, 30], [720, 24], [540, 20]]), // MO-A-38
  previewMinWidth: 540, previewMinGlyphPx: 10,
  reducedInkFraction: 0.9, // MO-C-14 provisional
  crf: 16,
});

export const PERF = Object.freeze({
  frames: 120, hardwareP95Ms: 40, softwareP95Ms: 250, // MO-D-02 provisional
});

export const EMPTY = Object.freeze({
  sceneHoldMultiplier: 2, fadeAllowanceSec: 1, p995Ceiling: 0.05, // MO-D-03 provisional
});

export const ACCENT = Object.freeze({
  maxFrameFraction: 0.1, maxEntries: 1, saturationFloor: 0.5, hueTolerance: 15, minFillPx: 24, // MO-C-29 provisional
  maxClusters: 2,
});

// MO-SH-09: the one canonical software-rasterizer list (case-insensitive substrings).
export const SOFTWARE_RENDERERS = Object.freeze([
  'swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', 'apple software renderer', 'microsoft basic render driver',
]);
export const UNKNOWN_RENDERER = 'unknown (debug-info extension unavailable)';

export function isSoftwareRenderer(renderer) {
  const value = String(renderer || '').toLowerCase();
  return SOFTWARE_RENDERERS.some((entry) => value.includes(entry));
}

// MO-A-51: per-platform ladder, then the SwiftShader rung; anti-throttling flags always appended,
// plus the two that keep Chrome off the OS keychain (a custom profile dir otherwise makes
// macOS ask the user where to store Chrome's safe-storage key).
export const ALWAYS_FLAGS = Object.freeze([
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--use-mock-keychain', '--password-store=basic',
]);
export function chromeFlagLadder(platform = process.platform) {
  const gpu = platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']
    : platform === 'win32'
      ? ['--use-angle=d3d11', '--enable-gpu-rasterization']
      : ['--use-angle=gl', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'];
  return [[...gpu, ...ALWAYS_FLAGS], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...ALWAYS_FLAGS]];
}

// MO-A-45 exit codes.
export const EXIT = Object.freeze({
  OK: 0,
  BLOCKED_NO_CHROME: 10,
  BLOCKED_NO_WEBGL2: 11,
  BLOCKED_NO_FFMPEG_FOR_VIDEO: 12,
  GATE_FAIL_QA: 13,
  BLOCKED_DEPS_NOT_PREWARMED: 14,
  BLOCKED_FONT_FETCH: 15,
  // Director wave, family-wide numbers.
  BLOCKED_TREATMENT_INVALID: 16,
  STAGE_CONTRACT_ERROR: 17,
  STAGE_NONDETERMINISTIC: 18,
  STAGE_NETWORK_REQUEST: 19,
  SOUND_INVALID: 20,
});

// MO-A-58 post-chain override vocabulary: [min, max, neutral]. null max = no ceiling.
export const OVERRIDES = Object.freeze({
  exposure: [0, null, 1], bloom: [0, 1, 0], bloomThreshold: [0, 1, 0.85], bloomKnee: [0, 1, 0],
  bloomRadius: [0, 1, 0], halation: [0, 1, 0], ca: [0, null, 0], grain: [0, 1, 0], vignette: [0, 1, 0],
  fade: [0, 1, 1], flash: [0, 1, 0], zoom: [0, null, 1],
});

export const POST_ORDER = Object.freeze([
  'bloom+halation', 'chromatic-aberration', 'tone-shoulder', 'film-grain', 'vignette', 'flash', 'shake/zoom', 'invert',
]);

export const LOOK_PASSES = Object.freeze(['glitch', 'tidal-gradient', 'crt', 'dither', 'swiss-grid', 'terminal-ui']);

export const ENGINE_CREDIT = 'mexicat/pdoom-video ca251e3dddda422b364385eb484b5a3593a0990d (MIT)';
export const CREDIT_LINE = 'Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.';
