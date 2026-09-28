(() => {
  const T = __UIUX_THRESHOLDS__;
  const findings = [];
  const viewport = __UIUX_VIEWPORT__;
  const not_verified = [];
  const selector = (element) => element === document.documentElement ? 'html' :
    `${element.tagName.toLowerCase()}${element.id ? `#${CSS.escape(element.id)}` : ''}`;
  const add = (rule, severity, element, value, threshold, tier = 'measured', note) => {
    findings.push({ rule, severity, tier, viewport, selector: selector(element), value, threshold,
      ...(note ? { note } : {}) });
  };
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 1 && box.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' &&
      !element.closest('[aria-hidden="true"],[hidden],[inert]') &&
      !element.matches('.sr-only,.visually-hidden,.visuallyhidden') &&
      style.clipPath !== 'inset(50%)' && !/^rect\(0/.test(style.clip) &&
      box.right >= -9000 && box.left <= innerWidth + 9000;
  };
  const proseText = (element) => !element.closest('code,pre,kbd,blockquote,q,script,style,textarea,select');
  const authoredText = (element) => !element.closest('code,pre,kbd,script,style,textarea,select');
  const externalQuote = (element) => {
    const quote = element.closest('q,blockquote');
    if (!quote?.cite) return false;
    try { return new URL(quote.cite, location.href).origin !== location.origin; } catch { return false; }
  };
  const rgb = (value) => {
    const match = value.match(/^rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? parts : null;
  };
  const composite = (foreground, background) => {
    const alpha = foreground[3] === undefined ? 1 : foreground[3];
    return foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
  };
  const background = (element) => {
    let color = [255, 255, 255];
    const lineage = [];
    for (let node = element; node instanceof Element; node = node.parentElement) lineage.unshift(node);
    for (const node of lineage) {
      const part = rgb(getComputedStyle(node).backgroundColor);
      if (part) color = composite(part, color);
    }
    return color;
  };
  const imageBehind = (element) => {
    for (let node = element; node instanceof Element; node = node.parentElement)
      if (getComputedStyle(node).backgroundImage !== 'none') return true;
    return false;
  };
  const luminance = (color) => {
    const channel = (value) => {
      const fraction = value / 255;
      return fraction <= 0.04045 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
  };
  const hueSaturation = (color) => {
    const [r, g, b] = color.slice(0, 3).map((value) => value / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    let hue = 0;
    if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { hue: (hue * 60 + 360) % 360, saturation, lightness };
  };
  const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (pageWidth > innerWidth + T.pageOverflowPx) add('RS-006', 'HIGH', document.documentElement, pageWidth, innerWidth + T.pageOverflowPx);
  const textElements = [...document.querySelectorAll('body *')].filter((element) =>
    visible(element) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
  for (const element of textElements) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const clipped = (/(hidden|clip)/.test(style.overflowX) && style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + T.elementClipPx) ||
      (/(hidden|clip)/.test(style.overflowY) && !/^[1-9]/.test(style.webkitLineClamp) && !/^[1-9]/.test(style.lineClamp) && element.scrollHeight > element.clientHeight + T.elementClipPx);
    if (clipped || box.right > innerWidth + T.offscreenPx || box.left < -T.offscreenPx) {
      add('RS-007', 'HIGH', element,
        { clipped, left: Math.round(box.left), right: Math.round(box.right) }, `within ${innerWidth}px`);
    }
    const foreground = rgb(style.color);
    if (element.closest(':disabled,[aria-disabled="true"]')) continue;
    if (foreground && foreground[3] !== 0 && !imageBehind(element)) {
      const back = background(element);
      const ink = composite(foreground, back);
      const a = luminance(ink), b = luminance(back);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = parseFloat(style.fontSize) >= T.largeTextPx || (parseFloat(style.fontSize) >= T.boldTextPx && Number(style.fontWeight) >= T.boldWeight);
      const floor = large ? T.largeContrast : T.bodyContrast;
      if (ratio < floor) add('CF-201', large ? 'MEDIUM' : 'HIGH', element, Number(ratio.toFixed(2)), floor, 'derived');
    } else if (imageBehind(element)) not_verified.push({ rule: 'CF-201', viewport, reason: `${selector(element)}: image or gradient background` });
  }
  const controls = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]')].filter(visible);
  const firstEmphasis = controls.find((element) => element.matches('button,.primary,[data-primary]') &&
    getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)');
  for (const element of controls) {
    if (!visible(element)) continue;
    const box = element.getBoundingClientRect();
    if (element.matches('a') && element.parentElement?.matches('p,li') && element.parentElement.textContent.trim().length > element.textContent.trim().length) continue;
    const primary = element === firstEmphasis || element.matches('button[type=submit]') &&
      element.form && [...element.form.querySelectorAll('button[type=submit]')].length === 1;
    const spaced = controls.every((other) => {
      if (other === element) return true;
      const peer = other.getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const px = peer.left + peer.width / 2, py = peer.top + peer.height / 2;
      return Math.hypot(cx - px, cy - py) >= T.hitMinimumPx;
    });
    if ((box.width < T.hitMinimumPx || box.height < T.hitMinimumPx) && !spaced) add('CF-701', 'HIGH', element,
      { width: Math.round(box.width), height: Math.round(box.height) }, T.hitMinimumPx);
    else if (innerWidth <= T.touchViewportPx && (box.width < T.hitRecommendedPx || box.height < T.hitRecommendedPx)) add('CF-701', primary ? 'HIGH' : 'MEDIUM', element,
      { width: Math.round(box.width), height: Math.round(box.height) }, T.hitRecommendedPx);
    if (innerWidth <= T.touchViewportPx && element.matches('input:not([type]),input:is([type=text],[type=email],[type=number],[type=password],[type=search],[type=tel],[type=url]),select,textarea,[contenteditable]') && parseFloat(getComputedStyle(element).fontSize) < T.mobileInputPx)
      add('RS-008', 'MEDIUM', element, parseFloat(getComputedStyle(element).fontSize), T.mobileInputPx);
    if (!element.matches('input[type=hidden]') && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') &&
        !element.textContent.trim() && !element.labels?.length && !element.getAttribute('title'))
      add('CF-603', 'HIGH', element, 'empty accessible name', 'discoverable name');
    if (element.matches('input[placeholder],textarea[placeholder]')) {
      const placeholder = rgb(getComputedStyle(element, '::placeholder').color);
      if (placeholder && !imageBehind(element)) {
        const back = background(element), ink = composite(placeholder, back);
        const a = luminance(ink), b = luminance(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < T.bodyContrast) add('CF-807', 'MEDIUM', element, Number(ratio.toFixed(2)), T.bodyContrast, 'derived', 'placeholder');
      }
      if (!element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby'))
        add('CF-806', 'MEDIUM', element, 'placeholder only', 'persistent label');
    }
    if (element.matches('button:not([type])') && element.form &&
        [...document.querySelectorAll('button')].filter((button) => button.form === element.form &&
          (!button.hasAttribute('type') || button.type === 'submit')).length >= 2)
      add('SLOP-059', 'HIGH', element, 'implicit submit beside another submit-capable button', 'explicit button type', 'derived');
  }
  for (const element of document.querySelectorAll('a[href]')) {
    const href = (element.getAttribute('href') || '').trim();
    if (href === '#' || /^javascript:/i.test(href)) add('SLOP-058', element.closest('nav') || element.matches('.primary,[data-primary]') ? 'HIGH' : 'MEDIUM', element, href, 'working destination', 'derived');
  }
  const focusCandidates = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
    .filter((element) => visible(element) && !element.matches(':disabled,[aria-disabled="true"]')).slice(0, 5);
  for (const element of focusCandidates) {
    const snapshot = () => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow,
        style.borderColor, style.backgroundColor];
    };
    const resting = snapshot();
    element.focus({ preventScroll: true });
    if (!element.matches(':focus-visible')) {
      not_verified.push({ rule: 'CF-202', viewport, reason: `${selector(element)}: focus-visible state unavailable` });
      element.blur();
      continue;
    }
    const focused = snapshot();
    element.blur();
    if (resting.every((part, index) => part === focused[index]))
      add('CF-202', 'HIGH', element, 'no visible focus change', 'outline, shadow, border or background change');
    else if (focused[0] !== 'auto' && focused[0] !== 'none' && parseFloat(focused[1]) < T.focusRingMinimumPx)
      add('CF-202', 'MEDIUM', element, parseFloat(focused[1]), T.focusRingMinimumPx);
  }
  const inspectRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) inspectRules(rule.cssRules);
      if (rule.type === CSSRule.KEYFRAMES_RULE) for (const frame of rule.cssRules) {
        if (!/^(?:from|0%)$/.test(frame.keyText)) continue;
        const match = frame.style.transform.match(/scale(?:X|Y)?\(\s*([\d.]+)/i);
        if (match && Number(match[1]) < T.entranceScaleMinimum) {
          const running = document.getAnimations().some((animation) => animation.playState === 'running' && animation.animationName === rule.name);
          add('CF-503', running ? 'MEDIUM' : 'LOW', document.documentElement, Number(match[1]), T.entranceScaleMinimum,
            running ? 'measured' : 'derived', running ? 'running entrance' : 'declared entrance; running state unverified');
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { inspectRules(sheet.cssRules); } catch { not_verified.push({ rule: '*', viewport, reason: 'cross-origin stylesheet' }); }
  }
  const prose = textElements.filter((element) => /^(P|LI|BLOCKQUOTE|DD|TD)$/.test(element.tagName) && !element.closest('nav,footer,[class*="ticker"]'));
  for (const element of prose) {
    const content = element.textContent.trim();
    if (content.length < 80) continue;
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = new Map();
    const node = [...element.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    if (!node) continue;
    for (let index = 0; index < Math.min(node.textContent.length, T.textCharacterCap); index++) {
      range.setStart(node, index); range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) lines.set(Math.round(rect.top), (lines.get(Math.round(rect.top)) || 0) + 1);
    }
    const estimate = Math.max(0, ...lines.values());
    const cjk = (content.match(/[一-鿿぀-ヿ가-힣]/g) || []).length / content.length > 0.3;
    const floor = cjk ? T.lineMeasureCjkMax : T.lineMeasureLatinMax;
    if (lines.size >= T.lineMeasureMinLines && estimate > floor) add('CF-101', 'MEDIUM', element, estimate, floor, 'measured');
  }
  for (const element of textElements) {
    const content = element.textContent.trim();
    if (authoredText(element) && !externalQuote(element) && (content.includes('—') || /\s–\s/.test(content)) && !/\d(?::\d+)?\s*–\s*\d(?::\d+)?/.test(content) &&
        !(content.includes('——') && (content.match(/[一-鿿]/g) || []).length / content.length > 0.3))
      add('SLOP-040', 'MEDIUM', element, content.slice(0, 80), 'no flourish dash');
    if (proseText(element) && /lorem ipsum|dolor sit amet|\[placeholder\]|\bTODO\b/i.test(content))
      add('SLOP-060', 'LOW', element, content.slice(0, 80), 'finished copy');
    if (proseText(element) && /\b(?:seamless experience|harness the power|best-in-class|transformative platform|next-generation solution)\b/i.test(content))
      add('SLOP-036', 'MEDIUM', element, content.slice(0, 80), 'concrete claim');
    if (element.matches('button,a') && /^(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+$/.test(content))
      add('CF-107', 'LOW', element, content.slice(0, 80), 'sentence case');
    if (element.matches('h1,h2,h3,h4,h5,h6,p,li')) {
      const s = getComputedStyle(element), font = parseFloat(s.fontSize), box = element.getBoundingClientRect();
      if (s.lineHeight !== 'normal' && box.height >= font * 2) {
        const ratio = parseFloat(s.lineHeight) / font;
        const heading = element.matches('h1,h2,h3,h4,h5,h6');
        const floor = heading ? T.headingLineHeightMinimum : (/[一-鿿぀-ヿ가-힣]/.test(content) ? T.bodyLineHeightCjk : T.bodyLineHeightLatin);
        if (ratio < floor || (heading && ratio > T.headingLineHeightMaximum))
          add(heading ? 'CF-102' : 'CF-103', heading ? 'LOW' : 'MEDIUM', element, Number(ratio.toFixed(2)), floor, 'derived');
      }
    }
  }
  for (const element of document.querySelectorAll('body *')) {
    if (!visible(element)) continue;
    const s = getComputedStyle(element);
    if (element.matches('img')) {
      const src = (element.getAttribute('src') || element.getAttribute('srcset') || '').trim();
      const lazy = [...element.attributes].some((attribute) => /^data-(?:src|srcset|lazy)/.test(attribute.name));
      if ((!src || /^(?:#|undefined)$/i.test(src)) && !lazy || element.complete && element.naturalWidth === 0 && !lazy)
        add('SLOP-057', 'HIGH', element, src, 'decodable image');
      else if (!element.complete || lazy) not_verified.push({ rule: 'SLOP-057', viewport, reason: `${selector(element)}: lazy image not fetched at capture` });
    }
    if (element.matches('marquee')) add('SLOP-061', 'LOW', element, 'marquee', 'stationary text');
    if (s.backgroundClip === 'text' && s.backgroundImage.includes('gradient(')) add('SLOP-009', 'MEDIUM', element, s.backgroundImage.slice(0, 80), 'solid text');
    if (element.matches('dialog,[role="dialog"]') && getComputedStyle(element, '::backdrop').backdropFilter !== 'none')
      add('CF-406', 'LOW', element, 'blurred scrim', 'solid scrim');
    const bounds = element.getBoundingClientRect();
    const parent = element.parentElement;
    if (parent && visible(parent) && s.borderTopLeftRadius.endsWith('px')) {
      const outer = getComputedStyle(parent), box = parent.getBoundingClientRect();
      const inset = [bounds.left - box.left, box.right - bounds.right, bounds.top - box.top, box.bottom - bounds.bottom];
      const symmetric = Math.max(...inset) - Math.min(...inset) <= T.frameInsetTolerancePx;
      const outerRadius = parseFloat(outer.borderTopLeftRadius), innerRadius = parseFloat(s.borderTopLeftRadius);
      const expected = Math.max(0, outerRadius - inset.reduce((sum, value) => sum + value, 0) / inset.length);
      if (symmetric && outerRadius > 0 && Number.isFinite(innerRadius) && Math.abs(innerRadius - expected) > T.radiusTolerancePx)
        add('CF-401', 'LOW', element, Number(innerRadius.toFixed(1)), Number(expected.toFixed(1)), 'derived');
    }
    const fill = rgb(s.backgroundColor);
    const ink = rgb(s.color);
    if (ink && element.matches('h1,h2,h3,h4,h5,h6')) {
      const hsl = hueSaturation(ink);
      if (Math.max(...ink.slice(0, 3)) - Math.min(...ink.slice(0, 3)) >= T.purpleChannelSpread &&
          hsl.hue >= T.accentHueMinimumDeg && hsl.hue <= T.accentHueMaximumDeg)
        add('SLOP-008', 'MEDIUM', element, Number(hsl.hue.toFixed(1)), [T.accentHueMinimumDeg, T.accentHueMaximumDeg], 'derived', 'check brand rationale');
    }
    const shadow = s.boxShadow.match(/(?:rgba?\([^)]+\)|#[\da-fA-F]{3,8})?\s*([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px/);
    if (shadow && Math.abs(Number(shadow[1])) < 2 && Math.abs(Number(shadow[2])) < 2 &&
        Number(shadow[3]) >= T.glowBlurToSideRatio * Math.min(bounds.width, bounds.height) && element.matches('button,[data-primary],.primary'))
      add('CF-404', 'LOW', element, Number(shadow[3]), T.glowBlurToSideRatio * Math.min(bounds.width, bounds.height), 'derived');
    if (s.willChange !== 'auto' && (!/^(?:transform|opacity|filter)(?:,\s*(?:transform|opacity|filter))*$/.test(s.willChange) || !element.getAnimations().some((animation) => animation.playState === 'running')))
      add('CF-507', /^(?:transform|opacity|filter)(?:,\s*(?:transform|opacity|filter))*$/.test(s.willChange) ? 'MEDIUM' : 'LOW', element, s.willChange, 'active compositor animation only');
    if (element.matches('a,button,[role="button"],[role="link"]') && /[\u{1F300}-\u{1FAFF}]/u.test(element.textContent))
      add('SLOP-053', 'MEDIUM', element, element.textContent.trim().slice(0, 32), 'consistent icon system', 'derived');
  }
  const accents = [];
  for (const element of document.querySelectorAll('button,[role="button"],.chip,.badge,.card')) {
    if (!visible(element)) continue;
    const bounds = element.getBoundingClientRect(), fill = rgb(getComputedStyle(element).backgroundColor);
    if (!fill || fill[3] === 0 || bounds.width < T.accentSurfaceMinimumPx || bounds.height < T.accentSurfaceMinimumPx) continue;
    const hsl = hueSaturation(fill);
    if (hsl.saturation < T.accentSaturationMinimum || hsl.lightness < 0.12 || hsl.lightness > 0.93 || bounds.height <= 32 ||
        element.closest('[role=status],[role=alert],[role=alertdialog],[role=log],[aria-live],[aria-invalid=true]') ||
        /(?:^|\s)(?:success|warning|warn|error|danger|destructive|info|critical)(?:\s|$)/i.test(element.className || '')) continue;
    if (!accents.some((hue) => Math.min(Math.abs(hue - hsl.hue), 360 - Math.abs(hue - hsl.hue)) <= T.accentHueToleranceDeg)) accents.push(hsl.hue);
  }
  if (accents.length > 1) add('CF-205', 'MEDIUM', document.documentElement, accents.map((hue) => Math.round(hue)), 1, 'derived');
  for (let i = 0; i < Math.min(100, textElements.length); i++) {
    const first = textElements[i], a = first.getBoundingClientRect();
    for (let j = i + 1; j < Math.min(100, textElements.length); j++) {
      const second = textElements[j];
      if (first.contains(second) || second.contains(first)) continue;
      const b = second.getBoundingClientRect();
      const area = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const fraction = area / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
      if (fraction >= T.textOverlapFraction) add('RS-007', 'MEDIUM', second, Number(fraction.toFixed(2)), T.textOverlapFraction, 'derived', `overlaps ${selector(first)}`);
    }
  }
  if (viewport === '390-dark' && luminance(background(document.body)) >= T.darkLuminanceMax) {
    const theme = [...document.querySelectorAll('[data-theme-toggle],button,[role=switch],[role=button]')].find((element) =>
      element.hasAttribute('data-theme-toggle') || /dark|theme|night|다크|테마|야간/i.test(`${element.getAttribute('aria-label') || ''} ${element.title || ''} ${element.textContent || ''}`));
    if (theme) not_verified.push({ rule: 'RS-002', viewport, reason: `dark path may sit behind ${selector(theme)}; probe activates no control` });
    else add('RS-002', 'MEDIUM', document.documentElement, Number(luminance(background(document.body)).toFixed(2)), T.darkLuminanceMax, 'derived');
  }
  if (viewport === '390-reduced-motion') {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) add('RS-003', 'HIGH', document.documentElement, false, true);
    for (const video of document.querySelectorAll('video')) if (!video.paused) add('RS-003', 'HIGH', video, 'playing', 'paused');
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const s = getComputedStyle(element);
      const transitionMs = Math.max(0, ...s.transitionDuration.split(',').map((value) => Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000)));
      const animationMs = Math.max(0, ...element.getAnimations().filter((animation) => animation.playState === 'running').map((animation) => {
        const frames = animation.effect?.getKeyframes?.() || [];
        return frames.some((frame) => Object.keys(frame).some((key) => /^(?:transform|translate|scale|rotate|top|right|bottom|left|inset|width|height|margin|offset|backgroundPosition)/.test(key)))
          ? Number(animation.effect?.getTiming?.().duration || 0) : 0;
      }));
      const motion = /\b(?:all|transform|translate|scale|rotate|top|right|bottom|left|inset|width|height|margin|offset|background-position)\b/.test(s.transitionProperty);
      const essential = element.closest('progress,[role=progressbar],[role=status],[aria-busy=true]');
      const longest = Math.max(motion ? transitionMs : 0, animationMs);
      if (!essential && longest > T.reducedMotionMaximumMs) add('RS-003', 'HIGH', element, longest, T.reducedMotionMaximumMs);
    }
  }
  return JSON.stringify({ viewport, url: location.href, readyState: document.readyState,
    bodyElements: document.body?.querySelectorAll('*').length ?? 0, findings, not_verified,
    hover_target: [...document.querySelectorAll('button')].some(visible) ? 'button' : null });
})()
