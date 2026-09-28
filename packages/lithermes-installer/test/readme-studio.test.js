const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {resolvePython} = require("../scripts/test-python");
const root = path.resolve(__dirname, "../assets/lithermes-plugin/skills/readme-studio");

test("facts checker validates bounded evidence paths without claiming truth", (t) => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const project = fs.mkdtempSync(path.join(tempRoot, "readme facts "));
  t.after(() => fs.rmSync(project, {recursive:true, force:true}));
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"actual"}');
  const facts = {claims:[{id:"name", value:"not actually verified", sources:["package.json"]}], badges:[]};
  const file = path.join(project, "facts.json");
  const python = resolvePython().python;
  assert.ok(python, "Hermes-compatible Python interpreter must be available");
  function run() {
    fs.writeFileSync(file, JSON.stringify(facts));
    return spawnSync(python, [path.join(root, "scripts/check_facts.py"), "--project-root", project, "--facts", file], {cwd: tempRoot, encoding:"utf8", env:{...process.env, PYTHONDONTWRITEBYTECODE:"1"}});
  }
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {validation_scope:"structure-only", factual_accuracy:"not-checked", source_contents_compared:false, badge_truth_checked:false, claims:1});
  facts.claims[0].sources = ["../outside"];
  assert.equal(run().status, 1);
  fs.symlinkSync(path.join(project, "package.json"), path.join(project, "link.json"));
  facts.claims[0].sources = ["link.json"];
  assert.equal(run().status, 1);
  facts.claims[0].sources = ["missing.json"];
  assert.equal(run().status, 1);
  facts.claims[0].sources = ["package.json"];
  facts.badges = [{url:"https://user:secret@example.test/badge", source:"package.json"}];
  assert.equal(run().status, 1);
  facts.badges = [];
  facts.claims.push({...facts.claims[0]});
  assert.equal(run().status, 1);
});

test("motion templates bind contrasting ink and complete finite timelines", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(root, "templates/cover-settings.json")));
  function lum(hex) {
    const [r,g,b] = hex.slice(1).match(/../g).map((x) => parseInt(x,16)/255).map((c) => c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return 0.2126*r+0.7152*g+0.0722*b;
  }
  for(const theme of Object.values(settings.themes)) {
    const values=[lum(theme.field),lum(theme.ink)].sort((a,b)=>a-b);
    assert.ok((values[1]+0.05)/(values[0]+0.05)>=4.5);
    assert.equal(theme.outlineSuffix, theme.ink==="#f4f1e9"?"light-ink":"dark-ink");
  }
  assert.equal(settings.fps,60);
  assert.equal(settings.frames,300);
  const html = fs.readFileSync(path.join(root,"templates/hyperframes/index.html"),"utf8");
  assert.match(html,/data-no-timeline/);
  assert.match(html,/data-duration="5"/);
  assert.match(html,/title-light-ink.svg/);
  const motion=JSON.parse(fs.readFileSync(path.join(root,"templates/hyperframes/index.motion.json")));
  assert.equal(motion.assertions[0].withinSelector,"#cover");
});

test("README assembly includes researched decoration with repository-backed facts", () => {
  const references = path.join(root, "references");
  const decoration = fs.readFileSync(path.join(references, "decoration-patterns.md"), "utf8");
  const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
  const cover = fs.readFileSync(path.join(root, "templates/cover-section.md"), "utf8");

  for (const pattern of [
    /emoji section/i,
    /centered hero/i,
    /badge.{0,80}logo row/i,
    /section icon/i,
    /<details>/i,
    /contributor/i,
    /star.history/i,
    /showcase/i,
    /feature grid/i,
    /footer navigation/i,
    /plain markdown/i,
    /verified endpoint/i,
    /facts (?:rule|and endpoint check)/i,
  ]) assert.match(decoration, pattern);

  assert.match(decoration, /2026-09-21/);
  assert.match(decoration, /transient/i);
  for (const repository of [
    "vitejs/vite",
    "mlabonne/llm-course",
    "birobirobiro/awesome-shadcn-ui",
  ]) assert.ok(decoration.includes(repository), `missing inspected repository ${repository}`);
  assert.match(skill, /references\/decoration-patterns\.md/);
  assert.match(skill, /decorat/i);
  assert.match(cover, /badge.{0,120}verified endpoint/i);
  assert.match(cover, /##\s+✨\s+Features/);
  assert.match(cover, /##\s+🚀\s+Quick start/);
  assert.match(cover, /registry renderers remove raw HTML/i);
});

test("both cover templates keep staged depth and rim light in static output", () => {
  const remotion = fs.readFileSync(path.join(root, "templates/remotion/src/index.tsx"), "utf8");
  const html = fs.readFileSync(path.join(root, "templates/hyperframes/index.html"), "utf8");

  for (const source of [remotion, html]) {
    assert.match(source, /background-far|backgroundFar/);
    assert.match(source, /background-near|backgroundNear/);
    assert.match(source, /foreground-plane|foregroundPlane/);
    assert.match(source, /rim-light|rimLight/);
  }
  assert.match(remotion, /settings\.blurPx\+12/);
  assert.match(remotion, /Math\.max\(2,settings\.blurPx\/2\)/);
  assert.match(remotion, /clipPath:/);
  assert.match(remotion, /linear-gradient\(118deg/);
  assert.match(html, /#background-far\{[^}]*filter:blur\(18px\)/);
  assert.match(html, /#background-near\{[^}]*filter:blur\(5px\)/);
  assert.match(html, /clip-path:polygon/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  const reducedMotion = html.match(/@media\(prefers-reduced-motion:reduce\)\{([^}]+)\}/)?.[1];
  assert.match(reducedMotion, /animation:none/);
  assert.doesNotMatch(reducedMotion, /display:none|visibility:hidden|filter:none|opacity:0/);
});
