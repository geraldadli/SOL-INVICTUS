// Home hero: a solar panel of 1,000 cells, one per Sol Coin. The cursor is the sun; when it leaves, the sun glides on along its own arc.
const COLS = 40, ROWS = 25, TOTAL = COLS * ROWS, PAD = 16;
const GLASS = [52, 15, 36], GLASS2 = [74, 24, 44], GOLD = [250, 189, 61], HOT = [255, 240, 190], BOUGHT = [233, 92, 5], WHITE = [255, 255, 255];
const lerp = (a, b, k) => a + (b - a) * k, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

export function createHomeWall({ canvas, tilt, onSelect }) {
  const ctx = canvas.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const data = { ready: false, sold: 0, mine: 0 };
  let W = 0, H = 0, cs = 0, sel = 0, painting = false, inside = false, sx = .5, sy = .42, vx = 0, vy = 0, tx = .5, ty = .42, start = performance.now(), last = start;

  const available = () => TOTAL - data.sold;
  const setSelection = n => { n = data.ready ? clamp(n, 0, available()) : 0; if (n === sel) return; sel = n; onSelect?.(sel); if (reduce) draw(performance.now()); };

  function size() {
    const width = canvas.clientWidth; if (!width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cs = (width - 2 * PAD) / COLS; W = width; H = ROWS * cs + 2 * PAD;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) draw(performance.now());
  }
  const round = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

  function draw(now) {
    if (!W) return;
    const t = (now - start) / 1000;
    if (!inside) { tx = .5 + .4 * Math.sin(t * .45); ty = .42 + .22 * Math.cos(t * .7); } // glide on, from wherever the sun is
    // The sun is a critically damped spring: it speeds up and settles smoothly, never overshoots, and keeps its momentum when the target changes (cursor in, cursor out).
    const dt = clamp((now - last) / 1000, 0, .05), w = inside ? 7 : 3.4; last = now;
    if (reduce) { sx = tx; sy = ty; }
    else { vx += (w * w * (tx - sx) - 2 * w * vx) * dt; vy += (w * w * (ty - sy) - 2 * w * vy) * dt; sx += vx * dt; sy += vy * dt; }
    const px = sx * W, py = sy * H, sigma = cs * 6.2, boughtEnd = data.sold - data.mine;
    const frame = ctx.createLinearGradient(0, 0, W, H); frame.addColorStop(0, '#d9c4b8'); frame.addColorStop(.5, '#8d6a62'); frame.addColorStop(1, '#c9b0a4');
    round(0, 0, W, H, 26); ctx.fillStyle = frame; ctx.fill();
    const back = ctx.createLinearGradient(0, 0, 0, H); back.addColorStop(0, '#2a0b1a'); back.addColorStop(1, '#3a1226');
    round(5, 5, W - 10, H - 10, 22); ctx.fillStyle = back; ctx.fill();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, x = PAD + c * cs, y = PAD + r * cs, gap = cs * .12, w = cs - gap * 2;
      const dx = x + cs / 2 - px, dy = y + cs / 2 - py, light = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      const picked = i >= data.sold && i < data.sold + sel;
      let col = mix(GLASS, GLASS2, (Math.sin(i * 12.9898) * .5 + .5) * .6);
      if (i < boughtEnd) col = mix(col, BOUGHT, .55 + .08 * Math.sin(t * 1.6 + i * .37));
      else if (i < data.sold) col = mix(col, GOLD, .9);
      col = mix(col, GOLD, clamp(light * 1.1, 0, 1)); if (light > .75) col = mix(col, HOT, (light - .75) * 3);
      if (picked) col = mix(col, WHITE, .55 + .1 * Math.sin(t * 5 + i));
      round(x + gap, y + gap, w, w, cs * .2); ctx.fillStyle = rgb(col); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${.05 + light * .22})`; ctx.fillRect(x + gap + w * .32, y + gap, 1, w); ctx.fillRect(x + gap + w * .66, y + gap, 1, w);
      if (picked) { round(x + gap, y + gap, w, w, cs * .2); ctx.strokeStyle = '#FABD3D'; ctx.lineWidth = 2; ctx.stroke(); }
      else if (i >= boughtEnd && i < data.sold) { round(x + gap, y + gap, w, w, cs * .2); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const glass = ctx.createLinearGradient(sx * W - W * .5, 0, sx * W + W * .1, H); // reflection that slides with the sun
    glass.addColorStop(0, 'rgba(255,255,255,0)'); glass.addColorStop(.5, 'rgba(255,255,255,.10)'); glass.addColorStop(1, 'rgba(255,255,255,0)');
    round(5, 5, W - 10, H - 10, 22); ctx.fillStyle = glass; ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(px, py, 0, px, py, cs * 9); halo.addColorStop(0, 'rgba(255,214,120,.55)'); halo.addColorStop(.4, 'rgba(250,150,40,.22)'); halo.addColorStop(1, 'rgba(250,150,40,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(px, py); ctx.rotate(t * .25); ctx.strokeStyle = 'rgba(255,236,170,.9)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, r1 = cs * 1.45, r2 = r1 + (k % 2 ? cs * .5 : cs * .9); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); ctx.stroke(); }
    ctx.restore();
    const disc = ctx.createRadialGradient(px - cs * .3, py - cs * .3, 0, px, py, cs * 1.2); disc.addColorStop(0, '#FFF4C8'); disc.addColorStop(.55, '#FABD3D'); disc.addColorStop(1, '#E95C05');
    ctx.beginPath(); ctx.arc(px, py, cs * 1.15, 0, 7); ctx.fillStyle = disc; ctx.fill();
  }
  function loop(now) { if (canvas.offsetParent && !document.hidden) draw(now); requestAnimationFrame(loop); }

  const cellAt = e => {
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    return clamp(Math.floor((y - PAD) / cs), 0, ROWS - 1) * COLS + clamp(Math.floor((x - PAD) / cs), 0, COLS - 1);
  };
  const choose = e => { const i = cellAt(e); setSelection(i >= data.sold ? i - data.sold + 1 : 0); };
  const aim = e => { const r = canvas.getBoundingClientRect(); inside = true; tx = (e.clientX - r.left) / r.width; ty = (e.clientY - r.top) / r.height; if (reduce) draw(performance.now()); };
  const lean = (ry, rx) => { tilt.style.setProperty('--ry', `${ry.toFixed(2)}deg`); tilt.style.setProperty('--rx', `${rx.toFixed(2)}deg`); };
  canvas.addEventListener('pointerdown', e => { if (!data.ready || e.button > 0) return; aim(e); painting = true; canvas.setPointerCapture(e.pointerId); choose(e); });
  canvas.addEventListener('pointermove', e => {
    aim(e); if (painting) choose(e);
    const r = canvas.getBoundingClientRect(); lean(((e.clientX - r.left) / r.width - .5) * 7, -((e.clientY - r.top) / r.height - .5) * 5);
  });
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => { painting = false; });
  canvas.addEventListener('pointerenter', () => { inside = true; });
  canvas.addEventListener('pointerleave', () => { inside = false; lean(0, 0); });
  new ResizeObserver(size).observe(canvas);
  size();
  if (!reduce) requestAnimationFrame(loop);

  return {
    // sold: coins bought by anyone; mine: coins held by the connected investor (drawn gold at the end of the sold run).
    update({ ready, sold, mine }) {
      const bought = ready && Math.min(mine, sold) > data.mine; // the visitor just bought coins, so their selection is spent
      Object.assign(data, { ready, sold, mine: Math.min(mine, sold) });
      if (bought || sel > available() || !ready) setSelection(0); else if (reduce) draw(performance.now());
    },
    clear() { setSelection(0); },
    get selection() { return sel; },
  };
}
