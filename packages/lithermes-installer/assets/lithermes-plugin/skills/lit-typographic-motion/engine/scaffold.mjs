// `motion.mjs scaffold --out <dir>`: the starting stage page, written from the treatment, so every
// film has the same architecture: the COPY block, one <section> per shot with its type placed in
// the shot's type zone and an empty subject group in its subject zone, entrances and hand-offs
// on the house style's tokens, and one DRAW function per shot where the drawing goes. The page
// passes the style rules as written; the drawing is the model's. A 3D film (`depth: "3d"`) also
// gets the three.js world: an import map onto the vendored build, a full-frame canvas behind the
// shots, one persistent protagonist group lit and shadowed in the style's palette, and one WORLD
// function per shot. It never overwrites an existing page.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blenderVersion, findBlender } from './blender.mjs';
import { FORMATS } from './treatment.mjs';

const HANGUL = /[ㄱ-ㆎ가-힣]/u;

/**
 * Which copy lines each shot shows: the treatment's `lines` when given; otherwise spread in order
 * over the shots that have a type zone, the first line on the first and the last line on the last.
 */
export function linesPerShot(treatment) {
  const beats = treatment.beats;
  if (beats.some((beat) => Array.isArray(beat.lines))) return beats.map((beat) => (Array.isArray(beat.lines) ? beat.lines : []));
  const lines = treatment.copy.lines.map((_, index) => index);
  const textShots = beats.map((beat, index) => (beat.layout === 'full' ? null : index)).filter((index) => index !== null);
  const out = beats.map(() => []);
  if (!textShots.length) return out;
  lines.forEach((line, key) => {
    const at = lines.length > 1 ? Math.round((key * (textShots.length - 1)) / (lines.length - 1)) : 0;
    out[textShots[at]].push(line);
  });
  return out;
}

/** The scaffold page for a stage treatment. */
export function scaffoldHtml(treatment) {
  const [width, height] = FORMATS[treatment.format];
  const perShot = linesPerShot(treatment);
  const lang = treatment.copy.lines.some((line) => HANGUL.test(line)) ? 'ko' : 'en';
  const sections = treatment.beats.map((beat, index) => {
    const lines = perShot[index];
    const roleOf = (key) => (key > 0 ? 'lit-body lit-muted' : beat.layout === 'title' ? 'lit-display lit-ink' : 'lit-headline lit-ink');
    const type = beat.layout === 'full' || !lines.length ? '' : `\n    <div class="type" data-zone="type">${lines.map((line, key) => `\n      <p class="${roleOf(key)}" data-copy="${line}"></p>`).join('')}\n    </div>`;
    return `  <!-- shot ${index + 1}: ${String(beat.purpose).replace(/--/gu, '-')} -->\n  <section class="shot" data-shot="${index}">\n    <svg class="subject" data-zone="subject"></svg>${type}\n  </section>`;
  }).join('\n');
  const draws = treatment.beats.map((beat, index) => `    // shot ${index + 1} (${beat.layout}): ${String(beat.hero).replace(/\*\//gu, '* /')}\n    (s, svg, t) => {},`).join('\n');
  const solid = treatment.depth === '3d';
  const worlds = treatment.beats.map((beat, index) => `    // shot ${index + 1} (${beat.layout})\n    (s, hero, cam, t) => {},`).join('\n');
  const head3d = solid ? `
<script type="importmap">{ "imports": { "three": "/lit/three/three.module.js", "three/addons/": "/lit/three/addons/" } }</script>` : '';
  const canvas3d = solid ? `<canvas id="world" width="${width}" height="${height}"></canvas>\n` : '';
  const style3d = solid ? `
  #world { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }` : '';
  const world3d = solid ? `
  // The world: one scene for the whole film, drawn on the GPU rung (software when it is missing). The
  // protagonist lives in HERO from the first frame to the last; each shot's WORLD function poses it,
  // the camera and anything else as a function of the shot's progress. The camera is aimed so the
  // world origin sits at the centre of the shot's subject zone. More parts of the vendored build:
  // three/addons/geometries/RoundedBoxGeometry.js.
  const PAL = LitStyle.palette;
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("world"), antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(${width}, ${height}, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(32, ${width} / ${height}, 0.1, 100);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004; // without these a turning object's shadow acne flickers as flashes
  key.shadow.normalBias = 0.03;
  scene.add(key, new THREE.HemisphereLight(PAL.surface ?? PAL.ground, PAL.ground, 0.6));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const HERO = new THREE.Group();
  scene.add(HERO);

  // Aim the camera so the origin lands on the centre of the shot's subject zone.
  function aim(layout) {
    const z = LitStyle.zones[layout].subject;
    cam.setViewOffset(${width}, ${height}, ${width} / 2 - (z.x + z.w / 2), ${height} / 2 - (z.y + z.h / 2), ${width}, ${height});
    return z.h / ${height};
  }

  const WORLD = [
${worlds}
  ];

  function drawWorld(s, t) {
    cam.position.set(0, 1.6, 7);
    cam.lookAt(0, 0.6, 0);
    aim(s.beat.layout);
    WORLD[s.index](s, HERO, cam, t);
    renderer.render(scene, cam);
  }
` : '';
  const scriptOpen = solid ? `<script type="module">
  import * as THREE from "three";
  import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
` : `<script>
`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/lit/fonts.css">
<link rel="stylesheet" href="/lit/style.css">
<script src="/lit/style.js"></script>
<script src="/lit/stage-kit.js"></script>${head3d}
<style>
  html, body { width: ${width}px; height: ${height}px; }
  .shot { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; visibility: hidden; }
  .subject { position: absolute; overflow: visible; }
  .type { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 0.4em; }${style3d}
</style>
</head>
<body>
${canvas3d}${sections}
${scriptOpen}
  // The film's words: every copy line of treatment.json, verbatim. Edit them here.
  const COPY = ${JSON.stringify(treatment.copy.lines, null, 2).replace(/\n/gu, '\n  ')};

  const { define, text, bezier, clipInset, clipCircle } = LitStage;
  // The drawing helpers the shots use, from the house tokens, the pixel zones
  // and the shot clock (LitStyle, LitTimeline): the page writes no helpers of
  // its own for these, it reads them here.
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const tokens = () => ({
    dur: LitStyle.motion.dur,
    clamp: clamp01,
    ease: { move: bezier(...LitStyle.motion.ease.move) },
  });
  const place = (el, layout, kind) => {
    const z = LitStyle.zones[layout]?.[kind];
    if (el && z) Object.assign(el.style, { left: z.x + "px", top: z.y + "px", width: z.w + "px", height: z.h + "px" });
  };
  const shot = (t) => {
    let index = LitTimeline.beats.findIndex((b) => t < b.t1);
    if (index < 0) index = LitTimeline.beats.length - 1;
    const beat = LitTimeline.beats[index];
    return { index, beat, t, p: (t - beat.t0) / Math.max(1e-6, beat.t1 - beat.t0), enter: (delay = 0, dur = 0.45) => clamp01((t - beat.t0 - delay) / dur) };
  };
  const T = tokens();
  const BEATS = LitTimeline.beats;
  const SHOTS = [...document.querySelectorAll(".shot")];
  SHOTS.forEach((el, i) => {
    place(el.querySelector('[data-zone="subject"]'), BEATS[i].layout, "subject");
    const type = el.querySelector('[data-zone="type"]');
    if (type) place(type, BEATS[i].layout, "type");
  });
  for (const el of document.querySelectorAll("[data-copy]")) {
    el.textContent = COPY[Number(el.dataset.copy)];
    text(el);
  }

  // One function per shot: draw the subject into its svg (the subject zone) as a function of the
  // shot's progress. s is shot(t): s.p (0..1), s.enter(delay, dur).
  const DRAW = [
${draws}
  ];

  // How a shot hands off to the next, over the style's exit duration before the cut.
  const HANDOFF = T.dur.exit;
  const handoff = { wipe: (el, p) => clipInset(el, p, "left"), iris: (el, p) => clipCircle(el, p), dissolve: (el, p) => { el.style.opacity = String(p); } };

  function paint(i, s, t) {
    const el = SHOTS[i];
    el.style.visibility = "visible";
    const type = el.querySelector('[data-zone="type"]');
    if (type) {
      const e = s.enter(0.1);
      type.style.opacity = String(e);
      type.style.transform = \`translateY(\${(1 - e) * 24}px)\`;
    }
    DRAW[i](s, el.querySelector('[data-zone="subject"]'), t);
  }

  ${world3d}define({ width: ${width}, height: ${height}, fps: ${treatment.fps ?? 60}, duration: ${treatment.durationSec}, render(t) {
    for (const el of SHOTS) Object.assign(el.style, { visibility: "hidden", opacity: "", clipPath: "", transform: "", zIndex: "" });
    const s = shot(t);
    paint(s.index, s, t);${solid ? "\n    drawWorld(s, t);" : ""}
    const next = SHOTS[s.index + 1];
    const into = T.clamp((t - (s.beat.t1 - HANDOFF)) / HANDOFF);
    if (next && into > 0) {
      const p = T.ease.move(into);
      const kind = s.beat.transition;
      if (handoff[kind]) {
        next.style.zIndex = "1";
        paint(s.index + 1, shot(BEATS[s.index + 1].t0), t);
        handoff[kind](next, p);
      } else if (kind === "push") {
        SHOTS[s.index].style.transform = \`translateX(\${-p * ${width}}px)\`;
        paint(s.index + 1, shot(BEATS[s.index + 1].t0), t);
        next.style.transform = \`translateX(\${(1 - p) * ${width}}px)\`;
      }
    }
  } });
</script>
</body>
</html>
`;
}

/** The note a 3D treatment's scaffold carries: Blender here or not, preview before final, compare
 * with the GPU rung, and the seed only when the treatment pins one.
 */
export function rungNote(out, treatment) {
  if (treatment.depth !== '3d' || treatment.path !== 'stage') return null;
  if (treatment.render3d === 'blender') {
    const version = blenderVersion();
    const lines = version
      ? [`Blender is here (${version}). Write stage/scene.py with the \`lit\` helpers in scope (the base plate renders in stage/plate-preview), then blender --out ${out}, then blender --out ${out} --final.`]
      : [`Blender is not installed here (${findBlender() ? 'unreachable' : 'LITHERMES_BLENDER, /Applications/Blender.app, blender on PATH'}). Write stage/scene.py anyway so the film is ready, but set "render3d": "three" to render with three.js on the GPU rung (engine/blender/runner.py needs Blender 4.2+).`];
    if (treatment.seed !== undefined) lines.push(`Seed ${treatment.seed >>> 0}: the plate renders the same bytes again.`);
    return lines.join('\n');
  }
  return [
    'A depth: 3d film defaults to the GPU rung.',
    'Compare with what the offline Blender rung would build (render3d: blender), keep the cheaper honest one; a Blender film that shows its path-traced plate is checked by its receipt, not by the text checks above.',
  ].join('\n');
}

/** Write `<out>/stage/index.html` from the treatment; refuses to replace a page. Returns { file, note }. */
export function writeScaffold(out, treatment) {
  const file = path.join(out, 'stage', 'index.html');
  if (existsSync(file)) throw new Error(`scaffold: ${file} already exists; edit the page instead of scaffolding over it`);
  mkdirSync(path.join(out, 'stage'), { recursive: true });
  writeFileSync(file, `${scaffoldHtml(treatment)}`);
  return { file, note: rungNote(out, treatment) };
}
