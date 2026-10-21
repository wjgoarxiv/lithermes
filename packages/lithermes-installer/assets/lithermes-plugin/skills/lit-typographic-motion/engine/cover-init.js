// Cover init script: runs in every cover document before any page script. The film stage gives a
// page a virtual clock; a cover page gets none, because a cover frame is a function of t alone and
// the renderer seeks frames out of order. Every clock and every unseeded entropy source therefore
// throws, and the call is remembered by name so the renderer can report it (exit 18) even when the
// page caught the error. CSS animations and transitions would run on the wall clock: they are off.
(function litCoverInit() {
  'use strict';
  const seen = [];
  const refuse = (name, fix) => function refused() {
    if (!seen.includes(name)) seen.push(name);
    throw new Error(`${name} is not available in a cover page; ${fix}`);
  };
  const fromT = 'draw every frame from t';
  Math.random = refuse('Math.random', 'use LitLoop.rng(seed) for layout and t for motion');
  const NativeDate = Date;
  function CoverDate(...args) {
    if (!new.target || args.length === 0) return refuse('Date', fromT)();
    return Reflect.construct(NativeDate, args, new.target);
  }
  CoverDate.prototype = NativeDate.prototype;
  CoverDate.now = refuse('Date.now', fromT);
  CoverDate.parse = NativeDate.parse;
  CoverDate.UTC = NativeDate.UTC;
  Object.defineProperty(window, 'Date', { value: CoverDate, writable: true, configurable: true });
  Object.defineProperty(Performance.prototype, 'now', { value: refuse('performance.now', fromT), writable: true, configurable: true });
  window.requestAnimationFrame = refuse('requestAnimationFrame', 'the renderer calls renderFrame(t); a cover runs no loop of its own');
  window.setInterval = refuse('setInterval', 'the renderer calls renderFrame(t); a cover runs no loop of its own');
  if (window.crypto) Object.defineProperty(window.crypto, 'getRandomValues', { value: refuse('crypto.getRandomValues', 'use LitLoop.rng(seed)'), configurable: true });
  const still = () => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.documentElement) still(); else document.addEventListener('readystatechange', still, { once: true });
  window.__litCoverMisuse = () => seen.slice();
})
