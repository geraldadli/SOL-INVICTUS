// Page motion: blocks that fade up as they scroll into view, a blip of sunrays around buttons on hover, and counting numbers.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG = 'http://www.w3.org/2000/svg';

// Each element fades up once when it enters the viewport; elements arriving together are staggered. replay(root) re-arms the ones inside root, so a page fades in again on every visit.
export function createReveal(selector) {
  const items = [...document.querySelectorAll(selector)];
  if (reduce || !('IntersectionObserver' in window)) return { replay() {} };
  items.forEach(el => el.classList.add('reveal'));
  const io = new IntersectionObserver(entries => {
    let k = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--reveal-delay', `${Math.min(k++ * 70, 350)}ms`);
      entry.target.classList.add('in'); io.unobserve(entry.target);
    }
  }, { threshold: .15, rootMargin: '0px 0px -8% 0px' });
  items.forEach(el => io.observe(el));
  return {
    replay(root) { items.forEach(el => { if (!root.contains(el)) return; el.classList.remove('in'); io.unobserve(el); io.observe(el); }); },
  };
}

// The page being navigated to fades and rises in as a whole; its blocks then reveal on top of that.
export function fadeInPage(section) {
  if (reduce || !section) return;
  section.getAnimations().forEach(a => a.cancel());
  section.animate([{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }], { duration: 500, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

// A point every `step` px around a rounded rectangle centred on 0,0, with its outward normal.
function outline(w, h, r, step) {
  const a = w - 2 * r, b = h - 2 * r, arc = Math.PI * r / 2, sides = [a, arc, b, arc, a, arc, b, arc];
  const total = 2 * a + 2 * b + 4 * arc, count = Math.max(12, Math.min(32, Math.round(total / step))), points = [];
  for (let k = 0; k < count; k++) {
    let s = (k + .5) * total / count, side = 0;
    while (side < 7 && s >= sides[side]) s -= sides[side++];
    const corner = [[1, -1], [1, 1], [-1, 1], [-1, -1]][(side - 1) / 2 | 0];
    if (side % 2) { const t = -Math.PI / 2 + ((side - 1) / 2) * Math.PI / 2 + s / r, nx = Math.cos(t), ny = Math.sin(t); points.push({ x: corner[0] * (w / 2 - r) + r * nx, y: corner[1] * (h / 2 - r) + r * ny, nx, ny }); }
    else points.push([{ x: -a / 2 + s, y: -h / 2, nx: 0, ny: -1 }, { x: w / 2, y: -b / 2 + s, nx: 1, ny: 0 }, { x: a / 2 - s, y: h / 2, nx: 0, ny: 1 }, { x: -w / 2, y: b / 2 - s, nx: -1, ny: 0 }][side / 2]);
  }
  return points;
}

// Hovering a button flashes short rays around its outline, like a sun, then they're gone.
export function initButtonRays(selector = 'button, .btn, .wall-buy, .menu-item') {
  if (reduce) return;
  const last = new WeakMap(), PAD = 22;
  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const button = event.target.closest?.(selector);
    if (!button || button.disabled || button.contains(event.relatedTarget)) return;
    const now = performance.now();
    if (now - (last.get(button) ?? -1e4) < 400) return;
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    last.set(button, now);
    const w = rect.width, h = rect.height, r = Math.min(parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0, w / 2, h / 2);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'btn-rays'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', `${-w / 2 - PAD} ${-h / 2 - PAD} ${w + 2 * PAD} ${h + 2 * PAD}`);
    Object.assign(svg.style, { left: `${rect.left - PAD}px`, top: `${rect.top - PAD}px`, width: `${w + 2 * PAD}px`, height: `${h + 2 * PAD}px` });
    outline(w, h, r, 22).forEach((p, k) => {
      // Lean each ray a little away from the centre so flat edges fan out instead of running parallel.
      const len = Math.hypot(p.x, p.y) || 1, dx = p.nx * .65 + p.x / len * .35, dy = p.ny * .65 + p.y / len * .35, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, ray = k % 2 ? 6 : 9;
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', p.x + ux * 4); line.setAttribute('y1', p.y + uy * 4); line.setAttribute('x2', p.x + ux * (4 + ray)); line.setAttribute('y2', p.y + uy * (4 + ray));
      line.setAttribute('stroke', k % 2 ? '#E95C05' : '#FABD3D');
      svg.append(line);
      line.animate([{ transform: 'translate(0, 0)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: `translate(${ux * 9}px, ${uy * 9}px)`, opacity: 0 }], { duration: 460, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'forwards' });
    });
    (button.closest('dialog') ?? document.body).append(svg);
    setTimeout(() => svg.remove(), 500);
  });
}

// Counts el's number to `to`, easing out, starting from what it last showed (or opts.from).
const shown = new WeakMap(), frames = new WeakMap();
export function tick(el, to, { from = shown.get(el) ?? 0, duration = 1000, format = String } = {}) {
  cancelAnimationFrame(frames.get(el));
  const show = v => { shown.set(el, v); el.textContent = format(v); };
  if (reduce || duration <= 0 || from === to) { show(to); return; }
  const start = performance.now();
  const step = now => {
    const k = Math.min(1, (now - start) / duration);
    show(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) frames.set(el, requestAnimationFrame(step));
  };
  frames.set(el, requestAnimationFrame(step));
}
