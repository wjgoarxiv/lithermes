# Runtime, pre-warm and BLOCKED states

## What is installed, and when

The skill package ships engine code, a lockfile, font pins and licence files;
no font and no dependency is bundled. `lithermes motion-runtime install` (and
`lithermes install`, which attempts it) fills a product cache once:

- `npm ci --omit=dev --ignore-scripts` of `runtime/package-lock.json`
  (playwright-core as the Chrome driver, ws for frame egress, opentype.js for
  outlines, pngjs for stills), into a staging directory under an exclusive lock,
  renamed into place when complete;
- every font and licence file in `runtime/fonts.json`, each downloaded from its
  pinned URL and rejected unless its sha256 matches;
- a check that this product's Pretendard Regular and Bold still match their
  recorded hashes.

The cache is `${XDG_CACHE_HOME:-$HERMES_HOME/.cache}/lithermes/motion/<digest>`,
where the digest covers the lockfile and the font pins; the installed plugin also
finds a cache under the Hermes home it is installed in. A failed or skipped
pre-warm never fails `lithermes install`; it prints one receipt line naming the
command. With `--offline` the installer skips the pre-warm and says so.

Renders only read the cache and write inside `--out`. Nothing in a render or a
Hermes session runs npm, pip or a download. Run the pre-warm in a normal shell,
outside any sandboxed session, with the same `HOME`, `HERMES_HOME` and
`XDG_CACHE_HOME` the session will use.

## Status (five probes)

`lithermes motion-runtime status` and `lithermes doctor` report, every time:

1. **Chrome**: the executable and version, or not found (set `CHROME_PATH`).
2. **ffmpeg**: the version line and the preview encoder rung available
   (`libwebp_anim`, else `img2webp`, else GIF).
3. **WebGL2 renderer**: the `UNMASKED_RENDERER_WEBGL` string from a real headless
   probe, with the flag rung that produced it.
4. **Software GL**: none, a warning naming the software renderer (renders are
   slower and use 1 sample), or a distinct warning when the renderer string is
   unavailable.
5. **Pre-warm**: READY with the cache path, or exactly which dependencies and
   fonts are missing or hash-mismatched and the command that fixes them; plus
   the state of the optional audio venv.

## Chrome launch

The render tries, in order, the platform GPU rung (macOS
`--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist`, Linux
`--use-angle=gl ...`, Windows `--use-angle=d3d11 ...`) and then
`--use-angle=swiftshader --enable-unsafe-swiftshader`, always with the three
anti-throttling flags and `--use-mock-keychain --password-store=basic`, so a
render never makes macOS ask where to store Chrome's keychain item. A rung counts only after `getContext('webgl2')` succeeds
in the page, re-checked at every render launch. Chrome runs over the pipe
transport, with its own sandbox on and a profile inside `<out>/.run/`, removed
on exit. Frames leave the page over a WebSocket bound to `127.0.0.1:0`; if the
host refuses `listen`, the engine pulls each frame's readback buffer through the
driver instead and the report names that path.

A host sandbox that forbids Chrome's own sandbox (nested process sandboxes on
macOS fail with "sandbox initialization failed: Operation not permitted") stops
the render with exit 10 and that line. The engine never adds `--no-sandbox`.

## Exit codes

| Exit | State | What to tell the user |
|---|---|---|
| 0 | OK | the requested mode finished |
| 10 | BLOCKED_NO_CHROME | Chrome is missing or would not launch; quote the launcher's error line; install Chrome or set `CHROME_PATH`, or run outside the sandbox that blocks it |
| 11 | BLOCKED_NO_WEBGL2 | Chrome runs but has no WebGL2 (or frames could not leave the page); quote the renderer or error; check GPU drivers or SwiftShader |
| 12 | BLOCKED_NO_FFMPEG_FOR_VIDEO | ffmpeg is not on PATH; `run` still leaves stills and the cut sheet; install ffmpeg for the film |
| 13 | GATE_FAIL_QA | the gate or the pre-flight failed; the report names the rules; fix and rerun the next round |
| 14 | BLOCKED_DEPS_NOT_PREWARMED | the cache is not warm (or word-timing models are absent): run `lithermes motion-runtime install` outside this session |
| 15 | BLOCKED_FONT_FETCH | a pinned font or licence is missing or its sha256 differs: rerun `lithermes motion-runtime install`; never accept or re-fetch it inside a session |
| 2 | usage | a missing or invalid brief or flag |

Pre-flight order: brief, word-timing request, dependencies (14), fonts (15),
glyph coverage and timeline floors (13, nothing rendered), ffmpeg for `video`
(12), Chrome (10, 11).

## Audio (Tier 2)

`lithermes motion-runtime install --audio` creates a Python venv in the cache
from `runtime/requirements.lock` with
`pip install --require-hashes --only-binary=:all:` (librosa and its pinned
dependencies; Python 3.11 to 3.13; set `LITHERMES_MOTION_PYTHON` to choose the
interpreter). When a brief names an `audio` file and the venv is ready and still
matches its pins, `bin/audio.py` analyses that file once into
`<out>/audio-grid.json` and the beats replace the fixed grid. If the venv is
missing, drifted, or the analysis fails, the cuts use text timing and the
manifest and report carry the warning. Either way the audio itself is always
muxed into the MP4 (AAC 256k), padded or trimmed to the film with a 50 ms
fade; the venv only decides the beat grid, never whether the track plays. The
venv is never created or repaired during a render.

## Sound bed

The generated bed needs nothing pre-warmed: `sound.mjs` synthesizes it in pure
code (tempo, pulse, pad chords, accents asked for by the treatment's beats),
measures loudness per ITU-R BS.1770-4 (K-weighting, 400 ms blocks with 75 %
overlap, −70 LUFS absolute and −10 LU relative gates) to −16 LUFS ± 2 with a
sample peak at or under −2 dBFS, and writes a 48 kHz 16-bit stereo WAV with
exactly `round(frames × 48000 / fps)` samples. The same treatment gives the same
SHA-256. After the mux the gate decodes the film's audio: a stream must be
present when sound is planned (exit 20 otherwise), within 0.1 s of the video,
with a peak at or under −0.5 dBFS, and a generated bed may not sit under
−50 dBFS RMS for more than 1.5 s in the first 3 s (exit 20; a warning for a
supplied or authored track). aubio, essentia, madmom and
MMS_FA weights are never used.

## Word timing (Tier 3)

Opt-in only (`--word-timing` or `"wordTiming": true`), never from bare `lit`.
`lithermes motion-runtime install --word-timing` prints the model pins and the
download size before doing anything. No licence-clean, Korean-capable alignment
model with a recorded revision is pinned yet, so the install refuses and a
render that asks for word timing exits 14 naming that command.

## Diagnostics

`LITHERMES_MOTION_FAULT_LISTEN=EPERM` makes the frame server refuse `listen`,
to exercise the CDP-pull path. `--force-software` renders on the SwiftShader
rung only, which the determinism re-check uses.
