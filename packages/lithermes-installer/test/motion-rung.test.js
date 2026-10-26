const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const skillRoot = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills", "lit-typographic-motion");
const loadStage = () => import(pathToFileURL(path.join(skillRoot, "engine", "stage.mjs")).href);
const loadConstants = () => import(pathToFileURL(path.join(skillRoot, "engine", "constants.mjs")).href);

test("stageRung: a three.js 3D world asks for the GPU, everything else the software rung", async () => {
  const { stageRung } = await loadStage();
  assert.equal(stageRung({ depth: "3d" }), "gpu");
  assert.equal(stageRung({ depth: "3d", render3d: "three" }), "gpu");
  assert.equal(stageRung({ depth: "3d", render3d: "blender" }), "software");
  assert.equal(stageRung({ depth: "2d" }), "software");
  assert.equal(stageRung({}), "software");
});

test("gpuStageFlags: platform GPU rung first, software determinism flags after", async () => {
  const { gpuStageFlags, stageFlags } = await loadStage();
  const { chromeFlagLadder, ALWAYS_FLAGS } = await loadConstants();
  for (const platform of ["darwin", "win32", "linux"]) {
    const flags = gpuStageFlags({ width: 1920, height: 1080 }, platform);
    assert.deepEqual(flags.slice(0, chromeFlagLadder(platform)[0].length), chromeFlagLadder(platform)[0]);
    assert.ok(!flags.includes("--use-angle=swiftshader"), "no SwiftShader on the GPU rung");
    assert.ok(flags.includes("--window-size=1920,1080"));
    for (const flag of ALWAYS_FLAGS) assert.ok(flags.includes(flag), `missing always flag ${flag}`);
  }
  assert.ok(stageFlags({ width: 1920, height: 1080 }).includes("--use-angle=swiftshader"));
});

test("threeFile: only vendored .js resolves, anything else is refused", async () => {
  const { threeFile } = await loadStage();
  const ok = threeFile("/lit/three/three.module.js");
  assert.equal(ok.status, 200);
  assert.ok(ok.file.endsWith("engine/vendor/three/three.module.js"), ok.file);
  assert.equal(threeFile("/lit/three/addons/environments/RoomEnvironment.js").status, 200);
  assert.equal(threeFile("/lit/three/addons/geometries/RoundedBoxGeometry.js").status, 200);
  for (const bad of ["/lit/three/../stage-kit.js", "/lit/three/three.module.css", "/lit/three/nope.js", "/lit/three/"]) {
    const found = threeFile(bad);
    assert.equal(found.status, 404, `${bad} must be refused`);
    assert.match(found.reason, /not a vendored three\.js file/);
  }
});
