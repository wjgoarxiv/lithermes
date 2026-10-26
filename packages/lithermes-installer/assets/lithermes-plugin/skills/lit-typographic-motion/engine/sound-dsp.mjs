// Shared wavetable synthesis: a normalized single-cycle table of additive
// partials. A leaf module on purpose: score.mjs builds its timbre tables at
// load time, and score joins an import cycle with sound.mjs through
// treatment.mjs, so anything score touches while loading must not live in
// sound.mjs.
const TABLE = 4096;
export { TABLE as WAVETABLE_SIZE };

export function wavetable(harmonics) {
  const t = new Float32Array(TABLE + 1);
  let peak = 0;
  for (let i = 0; i < TABLE; i++) {
    let v = 0;
    harmonics.forEach((a, k) => { if (a) v += a * Math.sin((2 * Math.PI * (k + 1) * i) / TABLE); });
    t[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < TABLE; i++) t[i] /= peak || 1;
  t[TABLE] = t[0];
  return t;
}
