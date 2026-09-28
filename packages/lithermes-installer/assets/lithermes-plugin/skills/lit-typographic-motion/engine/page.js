/* LitHermes typographic-motion renderer, browser half.
 * Raw WebGL2 re-expression of mexicat/pdoom-video's gl.ts (fullscreen passes,
 * half-float targets, Canvas2D layers as textures), lines.ts (instanced capsule
 * hairlines), post.ts (bloom pyramid, halation, CA, shoulder, grain, vignette,
 * flash, shake/zoom) and glsl/common.ts (hashes, simplex/fbm, curl, sRGB), MIT,
 * see NOTICE. The six look passes are original GLSL. Every uniform write goes
 * through setPass(), which records the per-pass uniforms and draw count that
 * the render log needs (MO-SH-00a). Nothing here reads a clock for pixels.
 */
(() => {
  const COMMON = `
#define PI 3.14159265359
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3 sat(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 seedOffset(uint s) { return vec2(float(s & 0xFFFFu), float((s >> 16) & 0xFFFFu)) / 65535.0; }
vec3 _m289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _m289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _perm(vec4 x) { return _m289(((x * 34.0) + 10.0) * x); }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = _m289(i);
  vec4 p = _perm(_perm(_perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 * vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
vec3 toSRGB(vec3 c) { return mix(12.92 * c, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
`;

  const VERT = `#version 300 es
in vec2 a_pos; out vec2 vUv;
void main() { vUv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const FRAG = {
    // Background fill in linear light.
    clear: `uniform vec3 u_color; void main() { fragColor = vec4(u_color, 0.0); }`,
    // tidal-gradient (MO-SH-06): domain-warped simplex flow between 2-3 stops,
    // seeded origin per shot, surge envelope computed on the CPU (attack/decay >= 0.1 s).
    tidal: `uniform float u_time; uniform uint u_seed; uniform vec3 u_stopA; uniform vec3 u_stopB; uniform vec3 u_base;
      uniform float u_flowSpeed, u_warpAmount, u_curlStrength, u_surge, u_ditherAmount; uniform int u_octaves; uniform vec2 u_res;
      float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { if (i >= u_octaves) break; s += a * snoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      void main() {
        vec2 uv = vUv * vec2(u_res.x / u_res.y, 1.0) * 1.4 + seedOffset(u_seed) * 40.0;
        float tt = u_time * u_flowSpeed;
        vec2 w = vec2(fbm3(vec3(uv, tt)), fbm3(vec3(uv + 5.2, tt + 1.3)));
        vec2 c = vec2(snoise(vec3(uv * 0.7, tt + 9.1)), snoise(vec3(uv * 0.7 + 3.3, tt + 4.7))) * u_curlStrength;
        float n = fbm3(vec3(uv + w * u_warpAmount * 2.0 + c, tt * 0.5));
        float k = smoothstep(-0.55, 0.55, n);
        vec3 col = mix(u_stopA, u_stopB, k);
        col = mix(u_base, col, 0.55 + 0.45 * smoothstep(-0.8, 0.8, w.x));
        col *= 1.0 + u_surge * 0.35;
        col += (hash12(gl_FragCoord.xy + seedOffset(u_seed) * 977.0) - 0.5) * u_ditherAmount * 0.02;
        fragColor = vec4(max(col, 0.0), 0.0);
      }`,
    // Canvas2D layer (straight alpha, sRGB) over the target in linear light.
    layer: `uniform sampler2D u_tex;
      void main() { vec4 c = texture(u_tex, vUv); fragColor = vec4(toLinear(c.rgb) * c.a, c.a); }`,
    // Average N sub-samples; only sample floor(N/2) contributes the glyph mask.
    accumulate: `uniform sampler2D u_tex; uniform float u_weight; uniform float u_maskWeight;
      void main() { vec4 c = texture(u_tex, vUv); fragColor = vec4(c.rgb * u_weight, c.a * u_maskWeight); }`,
    // crt (MO-SH-07): barrel curvature, scanlines, seeded triad grain, capped flicker, vignette,
    // phosphor persistence from the two previous composites of the same shot.
    crt: `uniform sampler2D u_tex; uniform sampler2D u_prev1; uniform sampler2D u_prev2; uniform float u_time; uniform uint u_seed;
      uniform float u_scanlineFreqPerFrame, u_scanlineDepth, u_phosphorPersistence, u_curvature, u_vignette, u_triadMaskAmount, u_flickerAmp, u_flickerFreqHz;
      uniform float u_prevCount; uniform vec2 u_res;
      void main() {
        vec2 dc = vUv - 0.5; float r2 = dot(dc, dc);
        vec2 uv = 0.5 + dc * (1.0 - u_curvature * r2);
        vec4 c = texture(u_tex, uv);
        vec3 col = c.rgb;
        if (u_prevCount > 0.5) col = max(col, texture(u_prev1, uv).rgb * u_phosphorPersistence);
        if (u_prevCount > 1.5) col = max(col, texture(u_prev2, uv).rgb * u_phosphorPersistence * u_phosphorPersistence);
        float yLogical = (1.0 - uv.y) * 1080.0;
        float scan = 1.0 - u_scanlineDepth * (0.5 + 0.5 * cos(yLogical * PI * 2.0 * u_scanlineFreqPerFrame / 1080.0));
        col *= scan;
        float stripe = mod(floor(gl_FragCoord.x + seedOffset(u_seed).x * 3.0), 3.0);
        vec3 triad = vec3(stripe == 0.0 ? 1.0 : 0.82, stripe == 1.0 ? 1.0 : 0.82, stripe == 2.0 ? 1.0 : 0.82);
        col *= mix(vec3(1.0), triad, u_triadMaskAmount);
        col *= 1.0 + 0.5 * u_flickerAmp * sin(2.0 * PI * u_flickerFreqHz * u_time);
        float v = smoothstep(0.85, 0.3, length(dc * vec2(1.0, 0.85)));
        col *= mix(1.0, v, u_vignette);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
        fragColor = vec4(col, c.a);
      }`,
    // dither (MO-SH-08): ordered Bayer quantisation in display space, locked to screen
    // pixels; the seed is used only by the blue-noise mode, once per shot.
    dither: `uniform sampler2D u_tex; uniform int u_ditherMode; uniform int u_paletteSize; uniform int u_pixelScale; uniform float u_ditherStrength; uniform uint u_seed; uniform float u_pxScale;
      float bayer(ivec2 p, int n) {
        int b = 0; int size = n;
        for (int bit = 0; bit < 3; bit++) {
          if ((1 << bit) >= size) break;
          int x = (p.x >> bit) & 1, y = (p.y >> bit) & 1;
          b = (b << 2) | ((x ^ y) << 1) | y;
        }
        int bits = size == 2 ? 1 : size == 4 ? 2 : 3;
        int r = 0; for (int i = 0; i < 6; i++) { if (i >= bits * 2) break; r = (r << 1) | ((b >> i) & 1); }
        return (float(r) + 0.5) / float(size * size);
      }
      void main() {
        vec4 c = texture(u_tex, vUv);
        ivec2 cell = ivec2(floor(gl_FragCoord.xy / (float(u_pixelScale) * u_pxScale)));
        float threshold;
        if (u_ditherMode == 3) threshold = hash12(vec2(cell) + seedOffset(u_seed) * 4096.0);
        else threshold = bayer(cell & 7, u_ditherMode == 0 ? 2 : u_ditherMode == 1 ? 4 : 8);
        float levels = float(max(u_paletteSize, 2) - 1);
        vec3 s = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
        vec3 q = floor(s * levels + threshold) / levels;
        vec3 outc = mix(s, q, u_ditherStrength);
        fragColor = vec4(pow(max(outc, 0.0), vec3(2.2)), c.a);
      }`,
    // glitch (MO-SH-05): a scheduled hit displaces horizontal slices (offset + RGB split);
    // one hit = one displace, held u_holdFrames, then restore. No luminance inversion.
    glitch: `uniform sampler2D u_tex; uniform int u_active; uniform int u_count; uniform vec3 u_slices[8]; uniform float u_rgbSplitPx; uniform float u_intensity; uniform uint u_seed; uniform vec2 u_res;
      void main() {
        vec2 uv = vUv;
        float y = (1.0 - vUv.y) * 1080.0;
        float dx = 0.0;
        if (u_active == 1) for (int i = 0; i < 8; i++) {
          if (i >= u_count) break;
          vec3 s = u_slices[i];
          if (y >= s.x && y < s.x + s.y) dx = s.z * (0.5 + u_intensity);
        }
        vec2 off = vec2(dx / 1920.0, 0.0);
        vec4 c = texture(u_tex, uv - off);
        if (dx != 0.0) {
          vec2 split = vec2(u_rgbSplitPx / 1920.0, 0.0);
          c.r = texture(u_tex, uv - off - split).r;
          c.b = texture(u_tex, uv - off + split).b;
        }
        fragColor = c;
      }`,
    // Post (MO-A-29, §A7 order): bloom prefilter and pyramid, then one final pass.
    prefilter: `uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_threshold, u_knee;
      void main() {
        vec3 c = texture(u_tex, vUv + u_texel * vec2(-1, -1)).rgb + texture(u_tex, vUv + u_texel * vec2(1, -1)).rgb
          + texture(u_tex, vUv + u_texel * vec2(-1, 1)).rgb + texture(u_tex, vUv + u_texel * vec2(1, 1)).rgb;
        c = min(c * 0.25, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float knee = max(u_knee, 1e-4);
        float rq = clamp(l - u_threshold + knee, 0.0, 2.0 * knee); rq = rq * rq / (4.0 * knee + 1e-5);
        fragColor = vec4(c * max(rq, l - u_threshold) / max(l, 1e-5), 1.0);
      }`,
    down: `uniform sampler2D u_tex; uniform vec2 u_texel;
      void main() {
        vec3 a = texture(u_tex, vUv + u_texel * vec2(-2, -2)).rgb, b = texture(u_tex, vUv + u_texel * vec2(0, -2)).rgb, c = texture(u_tex, vUv + u_texel * vec2(2, -2)).rgb;
        vec3 d = texture(u_tex, vUv + u_texel * vec2(-1, -1)).rgb, e = texture(u_tex, vUv + u_texel * vec2(1, -1)).rgb;
        vec3 f = texture(u_tex, vUv + u_texel * vec2(-2, 0)).rgb, g = texture(u_tex, vUv).rgb, h = texture(u_tex, vUv + u_texel * vec2(2, 0)).rgb;
        vec3 i = texture(u_tex, vUv + u_texel * vec2(-1, 1)).rgb, j = texture(u_tex, vUv + u_texel * vec2(1, 1)).rgb;
        vec3 k = texture(u_tex, vUv + u_texel * vec2(-2, 2)).rgb, l = texture(u_tex, vUv + u_texel * vec2(0, 2)).rgb, m = texture(u_tex, vUv + u_texel * vec2(2, 2)).rgb;
        fragColor = vec4((d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125, 1.0);
      }`,
    up: `uniform sampler2D u_tex; uniform sampler2D u_prev; uniform vec2 u_texel; uniform float u_radius;
      void main() {
        vec2 o = u_texel * u_radius;
        vec3 s = texture(u_tex, vUv - o).rgb + 2.0 * texture(u_tex, vUv + vec2(0, -o.y)).rgb + texture(u_tex, vUv + vec2(o.x, -o.y)).rgb
          + 2.0 * texture(u_tex, vUv + vec2(-o.x, 0)).rgb + 4.0 * texture(u_tex, vUv).rgb + 2.0 * texture(u_tex, vUv + vec2(o.x, 0)).rgb
          + texture(u_tex, vUv + vec2(-o.x, o.y)).rgb + 2.0 * texture(u_tex, vUv + vec2(0, o.y)).rgb + texture(u_tex, vUv + o).rgb;
        fragColor = vec4(texture(u_prev, vUv).rgb + s / 16.0, 1.0);
      }`,
    final: `uniform sampler2D u_tex; uniform sampler2D u_bloom; uniform sampler2D u_halo;
      uniform float u_exposure, u_bloomAmt, u_halation, u_ca, u_grain, u_vignette, u_fade, u_flash, u_zoom, u_invert, u_grainSeed;
      uniform vec2 u_shake; uniform vec2 u_res; uniform vec3 u_flashColor;
      vec3 shoulder(vec3 x) {
        const float k = 0.72;
        vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
        float over = max(max(x.r, x.g), x.b);
        return mix(y, vec3(1.0), smoothstep(2.0, 12.0, over) * 0.85);
      }
      void main() {
        vec2 img = vec2(vUv.x, 1.0 - vUv.y);
        vec2 uv = (img - 0.5) / u_zoom + 0.5 - u_shake / u_res * vec2(1.0, -1.0);
        vec2 dc = uv - 0.5;
        float r2 = dot(dc * vec2(u_res.x / u_res.y, 1.0), dc * vec2(u_res.x / u_res.y, 1.0));
        vec2 off = dc * r2 * u_ca / u_res.x * 4.0;
        vec4 base = texture(u_tex, uv);
        vec3 col = vec3(texture(u_tex, uv + off).r, base.g, texture(u_tex, uv - off).b);
        col += texture(u_bloom, uv).rgb * u_bloomAmt;
        col += vec3(1.0, 0.18, 0.04) * luma(texture(u_halo, uv).rgb) * u_halation;
        col *= u_exposure;
        col = shoulder(col);
        col += u_flashColor * u_flash;
        float v = smoothstep(0.95, 0.25, length(dc * vec2(1.0, 0.8)));
        col *= mix(1.0, v, u_vignette);
        col *= u_fade;
        if (u_invert > 0.5) col = vec3(0.8515) - col * 0.84;
        vec3 s = toSRGB(sat(col));
        if (u_grain > 0.0) {
          vec2 gp = gl_FragCoord.xy + vec2(u_grainSeed * 37.0, u_grainSeed * 71.0);
          float g1 = hash12(gp) - 0.5, g2 = hash12(floor(gl_FragCoord.xy / 2.0) + vec2(u_grainSeed * 13.0, u_grainSeed * 29.0)) - 0.5;
          float lm = luma(s);
          s += (g1 * 0.6 + g2 * 0.4) * u_grain * (0.55 + 1.2 * lm * (1.0 - lm));
          s += (hash12(gl_FragCoord.xy * 1.37 + u_grainSeed) - 0.5) / 255.0;
        }
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        fragColor = vec4(sat(s), base.a * inside);
      }`,
  };

  // Instanced anti-aliased capsule segments (swiss-grid hairlines), after lines.ts.
  const LINE_VERT = `#version 300 es
in vec2 a_pos; in vec2 i_a; in vec2 i_b; in vec4 i_color; in float i_width;
uniform vec2 u_res; uniform float u_px;
out vec2 vLocal; out float vLen; out float vHalf; out vec4 vColor;
void main() {
  vec2 sa = i_a * u_px, sb = i_b * u_px;
  float w = i_width * u_px; float hw = max(w * 0.5, 0.35) + 1.0;
  vec2 d = sb - sa; float len = length(d); vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);
  float along = mix(-hw, len + hw, a_pos.x);
  vec2 p = sa + dir * along + nrm * a_pos.y * hw;
  vec2 res = u_res * u_px;
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
  vLocal = vec2(along, a_pos.y * hw); vLen = len; vHalf = max(w * 0.5, 0.35);
  vColor = i_color * vec4(1.0, 1.0, 1.0, min(1.0, w / 0.7));
}`;
  const LINE_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal; in float vLen; in float vHalf; in vec4 vColor; out vec4 fragColor;
void main() {
  float x = clamp(vLocal.x, 0.0, vLen);
  float d = length(vec2(vLocal.x - x, vLocal.y)) - vHalf;
  float a = clamp(0.5 - d, 0.0, 1.0) * vColor.a;
  if (a <= 0.0) discard;
  fragColor = vec4(vColor.rgb * a, a);
}`;

  let gl, S, W, H, PW, PH, programs, quad, lineProg, lineVao, lineBuf, rt, textures, canvases, pbo, frameLog;
  const paths = new Map();

  const srgbToLinear = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const hexLinear = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(srgbToLinear); };

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    return shader;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
    const uniforms = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms.set(info.name.replace(/\[0\]$/, ''), { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size });
    }
    return { p, uniforms };
  }
  const fs = (body) => `#version 300 es\nprecision highp float;\nprecision highp int;\nin vec2 vUv;\nout vec4 fragColor;\n${COMMON}\n${body}`;

  function target(w, h, format = 'rgba16f') {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (format === 'rgba8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer ${format} incomplete`);
    return { tex, fb, w, h };
  }

  // The one uniform-setter wrapper (MO-SH-00a): records what each pass set.
  function setPass(name, prog, uniforms, logAs, record = true) {
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [key, value] of Object.entries(uniforms)) {
      const u = prog.uniforms.get(key);
      if (!u) continue;
      if (value && value.tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, value.tex); gl.uniform1i(u.loc, unit); unit++; continue; }
      switch (u.type) {
        case gl.FLOAT: gl.uniform1f(u.loc, value); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, Number(value)); break;
        case gl.UNSIGNED_INT: gl.uniform1ui(u.loc, value >>> 0); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, value); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, u.size > 1 ? new Float32Array(value.flat().concat(Array(Math.max(0, u.size * 3 - value.flat().length)).fill(0))) : value); break;
        default: break;
      }
    }
    if (logAs) {
      const entry = frameLog.passes[logAs] || (frameLog.passes[logAs] = { draws: 0, uniforms: {} });
      if (record) for (const [key, value] of Object.entries(uniforms)) if (!(value && value.tex)) entry.uniforms[key] = value;
    }
  }
  function drawQuad(dest, logAs) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fb : null);
    gl.viewport(0, 0, dest ? dest.w : PW, dest ? dest.h : PH);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (logAs) frameLog.passes[logAs].draws++;
  }

  window.motionSetup = async (config) => {
    S = config.scale || 1; W = config.width; H = config.height; PW = W * S; PH = H * S;
    const canvas = document.createElement('canvas');
    canvas.width = PW; canvas.height = PH;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) return { webgl2: false, error: 'canvas.getContext("webgl2") returned null' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown (debug-info extension unavailable)';
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      return { webgl2: true, renderer, error: 'half-float render targets unavailable (EXT_color_buffer_float)' };
    }
    programs = Object.fromEntries(Object.entries(FRAG).map(([k, body]) => [k, program(VERT, fs(body))]));
    quad = gl.createVertexArray();
    gl.bindVertexArray(quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const prog of Object.values(programs)) {
      const loc = gl.getAttribLocation(prog.p, 'a_pos');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    lineProg = program(LINE_VERT, LINE_FRAG);
    lineVao = gl.createVertexArray();
    gl.bindVertexArray(lineVao);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(lineProg.p, 'a_pos');
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    const stride = 9 * 4;
    for (const [name, size, offset] of [['i_a', 2, 0], ['i_b', 2, 2], ['i_color', 4, 4], ['i_width', 1, 8]]) {
      const loc = gl.getAttribLocation(lineProg.p, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4); gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    rt = { scene: target(PW, PH), acc: target(PW, PH), a: target(PW, PH), b: target(PW, PH), ring: [target(PW, PH), target(PW, PH)], final: target(PW, PH, 'rgba8'), mips: [], ups: [] };
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < 7; i++) { rt.mips.push(target(Math.max(2, w), Math.max(2, h))); rt.ups.push(target(Math.max(2, w), Math.max(2, h))); w >>= 1; h >>= 1; }
    rt.ringFrames = [];
    canvases = {};
    textures = {};
    for (const name of ['type', 'flat']) {
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      canvases[name] = c.getContext('2d', { alpha: true, willReadFrequently: false });
      textures[name] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, textures[name]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, PW * PH * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const probe = gl.getError();
    return { webgl2: true, renderer, glError: probe };
  };

  window.motionConnect = (port) => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => { window.__motionSocket = socket; resolve(true); };
    socket.onerror = () => reject(new Error('frame WebSocket could not connect'));
  });

  function upload(name) {
    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvases[name].canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  function drawType(sample) {
    const c = canvases.type;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, PW, PH);
    for (const [key, x, y, s, fill, alpha] of sample.glyphs) {
      const path = paths.get(key);
      if (!path) throw new Error(`glyph outline ${key} was never defined`);
      c.globalAlpha = alpha;
      c.fillStyle = fill;
      c.setTransform(s * S, 0, 0, s * S, x * S, y * S);
      c.fill(path);
    }
    c.setTransform(S, 0, 0, S, 0, 0);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const st of sample.strokes || []) {
      c.globalAlpha = st.alpha; c.strokeStyle = st.fill; c.lineWidth = st.width;
      c.beginPath();
      for (const flat of st.polylines) {
        c.moveTo(flat[0], flat[1]);
        for (let i = 2; i < flat.length; i += 2) c.lineTo(flat[i], flat[i + 1]);
        if (flat.length === 2) c.lineTo(flat[0] + 0.01, flat[1]);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
    return sample.glyphs.length + (sample.strokes || []).length;
  }

  function drawFlat(sample) {
    const c = canvases.flat;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, PW, PH);
    c.setTransform(S, 0, 0, S, 0, 0);
    const items = [...(sample.terminal || []), ...(sample.rects || [])];
    for (const r of items) { c.globalAlpha = r.alpha; c.fillStyle = r.fill; c.fillRect(r.x, r.y, r.w, r.h); }
    c.globalAlpha = 1;
    return items.length;
  }

  function drawRules(sample, uniforms) {
    const rules = sample.rules || [];
    if (!rules.length) return 0;
    const data = new Float32Array(rules.length * 9);
    rules.forEach((r, i) => {
      const [lr, lg, lb] = hexLinear(r.fill);
      data.set([r.x0, r.y0, r.x1, r.y1, lr, lg, lb, r.alpha, r.width], i * 9);
    });
    gl.useProgram(lineProg.p);
    gl.uniform2f(lineProg.uniforms.get('u_res').loc, W, H);
    gl.uniform1f(lineProg.uniforms.get('u_px').loc, S);
    gl.bindVertexArray(lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.scene.fb);
    gl.viewport(0, 0, PW, PH);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, rules.length);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    const entry = frameLog.passes['swiss-grid'] || (frameLog.passes['swiss-grid'] = { draws: 0, uniforms: {} });
    Object.assign(entry.uniforms, uniforms);
    entry.draws++;
    return rules.length;
  }

  function renderSample(spec, sample, index, count) {
    setPass('clear', programs.clear, { u_color: hexLinear(sample.background) });
    drawQuad(rt.scene);
    if (sample.tidal) {
      const tidal = sample.tidal;
      setPass('tidal-gradient', programs.tidal, {
        u_time: tidal.u_time, u_seed: tidal.u_seed, u_stopA: hexLinear(tidal.u_paletteStops[0]), u_stopB: hexLinear(tidal.u_paletteStops[1]),
        u_base: hexLinear(sample.background), u_flowSpeed: tidal.u_flowSpeed, u_warpAmount: tidal.u_warpAmount, u_curlStrength: tidal.u_curlStrength,
        u_surge: tidal.u_surge, u_ditherAmount: tidal.u_ditherAmount, u_octaves: tidal.u_octaves, u_res: [W, H],
      }, 'tidal-gradient', index === spec.mid);
      drawQuad(rt.scene, 'tidal-gradient');
    }
    const flatCount = drawFlat(sample);
    if (flatCount) {
      upload('flat');
      const logAs = spec.passes.terminalUi && sample.terminal ? 'terminal-ui' : null;
      setPass('layer', programs.layer, { u_tex: { tex: textures.flat }, ...(logAs ? spec.passes.terminalUi : {}) }, logAs, index === spec.mid);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      drawQuad(rt.scene, logAs);
      gl.disable(gl.BLEND);
    }
    if (spec.passes.swissGrid) drawRules(sample, spec.passes.swissGrid);
    else if ((sample.rules || []).length) drawRules(sample, {});
    const typeCount = drawType(sample);
    if (typeCount) {
      upload('type');
      setPass('layer', programs.layer, { u_tex: { tex: textures.type } });
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawQuad(rt.scene);
      gl.disable(gl.BLEND);
    }
    setPass('accumulate', programs.accumulate, { u_tex: { tex: rt.scene.tex }, u_weight: 1 / count, u_maskWeight: index === spec.mid ? 1 : 0 });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    drawQuad(rt.acc);
    gl.disable(gl.BLEND);
  }

  function copy(src, dst) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fb);
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  function filters(spec, order) {
    let src = rt.acc;
    const next = () => (src === rt.a ? rt.b : rt.a);
    for (const pass of order) {
      if (pass === 'crt' && spec.passes.crt) {
        const u = spec.passes.crt;
        if (!u.persistenceEnabled || rt.ringShot !== u.shotKey || spec.resetRing) { rt.ringFrames = []; rt.ringShot = u.shotKey; }
        const prev = rt.ringFrames.filter((f) => f.frame < spec.frame && f.frame >= spec.frame - 2).sort((a, b) => b.frame - a.frame);
        const dst = next();
        setPass('crt', programs.crt, {
          u_tex: { tex: src.tex }, u_prev1: { tex: (prev[0] || { rt: rt.ring[0] }).rt.tex }, u_prev2: { tex: (prev[1] || { rt: rt.ring[1] }).rt.tex },
          u_prevCount: u.persistenceEnabled ? prev.length : 0, u_res: [W, H],
          u_time: u.u_time, u_seed: u.u_seed, u_scanlineFreqPerFrame: u.u_scanlineFreqPerFrame, u_scanlineDepth: u.u_scanlineDepth,
          u_phosphorPersistence: u.u_phosphorPersistence, u_curvature: u.u_curvature, u_vignette: u.u_vignette,
          u_triadMaskAmount: u.u_triadMaskAmount, u_flickerAmp: u.u_flickerAmp, u_flickerFreqHz: u.u_flickerFreqHz,
        }, 'crt');
        drawQuad(dst, 'crt');
        if (u.persistenceEnabled) {
          const slot = rt.ringFrames.length < 2 ? rt.ring[rt.ringFrames.length] : rt.ringFrames.sort((a, b) => a.frame - b.frame)[0].rt;
          rt.ringFrames = rt.ringFrames.filter((f) => f.rt !== slot);
          copy(src, slot);
          rt.ringFrames.push({ frame: spec.frame, rt: slot });
        }
        src = dst;
      }
      if (pass === 'dither' && spec.passes.dither) {
        const u = spec.passes.dither;
        const dst = next();
        setPass('dither', programs.dither, { u_tex: { tex: src.tex }, u_ditherMode: u.u_ditherMode, u_paletteSize: u.u_paletteSize, u_pixelScale: u.u_pixelScale, u_ditherStrength: u.u_ditherStrength, u_seed: u.u_seed, u_pxScale: S }, 'dither');
        drawQuad(dst, 'dither');
        src = dst;
      }
      if (pass === 'glitch' && spec.passes.glitch) {
        const u = spec.passes.glitch;
        const dst = next();
        setPass('glitch', programs.glitch, { u_tex: { tex: src.tex }, u_active: u.u_active, u_count: u.u_slices.length, u_slices: u.u_slices, u_rgbSplitPx: u.u_rgbSplitPx, u_intensity: u.u_intensity, u_seed: u.u_seed, u_res: [W, H] }, 'glitch');
        drawQuad(dst, 'glitch');
        src = dst;
      }
    }
    return src;
  }

  function post(src, p) {
    setPass('prefilter', programs.prefilter, { u_tex: { tex: src.tex }, u_texel: [1 / PW, 1 / PH], u_threshold: p.bloomThreshold, u_knee: p.bloomKnee });
    drawQuad(rt.mips[0]);
    for (let i = 1; i < rt.mips.length; i++) {
      const s = rt.mips[i - 1];
      setPass('down', programs.down, { u_tex: { tex: s.tex }, u_texel: [1 / s.w, 1 / s.h] });
      drawQuad(rt.mips[i]);
    }
    let prevTex = rt.mips[rt.mips.length - 1].tex;
    for (let i = rt.mips.length - 2; i >= 0; i--) {
      const small = i === rt.mips.length - 2 ? rt.mips[rt.mips.length - 1] : rt.ups[i + 1];
      setPass('up', programs.up, { u_tex: { tex: prevTex }, u_prev: { tex: rt.mips[i].tex }, u_texel: [1 / small.w, 1 / small.h], u_radius: 0.5 + p.bloomRadius });
      drawQuad(rt.ups[i]);
      prevTex = rt.ups[i].tex;
    }
    setPass('final', programs.final, {
      u_tex: { tex: src.tex }, u_bloom: { tex: rt.ups[0].tex }, u_halo: { tex: rt.ups[3].tex },
      u_exposure: p.exposure, u_bloomAmt: p.bloom / 3, u_halation: p.halation, u_ca: p.ca, u_grain: p.grain, u_vignette: p.vignette,
      u_fade: p.fade, u_flash: p.flash, u_zoom: p.zoom, u_invert: p.invert ? 1 : 0, u_grainSeed: p.grainSeed % 4096,
      u_shake: p.shake, u_res: [W, H], u_flashColor: [0.82, 0.82, 0.8],
    });
    drawQuad(rt.final);
  }

  async function readback() {
    const out = new Uint8Array(PW * PH * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rt.final.fb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.readPixels(0, 0, PW, PH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    for (let i = 0; ; i++) {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
      if (status === gl.WAIT_FAILED) throw new Error('GPU fence wait failed');
      if (i > 200000) throw new Error('GPU fence timed out');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    gl.deleteSync(sync);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  }

  // One output frame. `order` is the preset's filter order after the background passes.
  window.motionFrame = async (spec) => {
    const began = performance.now();
    frameLog = { passes: {} };
    for (const [key, def] of Object.entries(spec.defs || {})) paths.set(key, new Path2D(def.path));
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.acc.fb);
    gl.viewport(0, 0, PW, PH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    spec.samples.forEach((sample, i) => renderSample(spec, sample, i, spec.samples.length));
    const filtered = filters(spec, spec.order || []);
    post(filtered, spec.post);
    if (spec.prime) return { primed: true };
    const bytes = await readback();
    const renderMs = performance.now() - began;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`WebGL error 0x${err.toString(16)} on frame ${spec.frame}`);
    const passes = Object.fromEntries(Object.entries(frameLog.passes).map(([k, v]) => [k, { draws: v.draws, uniforms: v.uniforms }]));
    if (spec.egress === 'websocket') {
      window.__motionSocket.send(bytes.buffer);
      return { passes, renderMs };
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { passes, renderMs, rgbaBase64: btoa(binary) };
  };
})();
