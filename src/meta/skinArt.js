// 2D previews of the cosmetics (wardrobe grid + live preview + results). A JS port of the rim patterns of the ground shader (src/holeView.js skinPattern)
// and of the trail shapes, so what the wardrobe shows is what the ground shows. Pure canvas, own art, no assets.
import { itemOf, hexRgb } from '../skins.js';

const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);
const mix = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Same maths as skinPattern() in holeView.js. a, b = [r,g,b] 0..1. */
export function patternRgb(p, f, u, a, b, tm = 0) {
  const pick = (k) => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
  if (p < 1.5) return pick(fract(u * 24) < 0.5 ? 0 : 1);
  if (p < 2.5) return f < 0.38 ? a : f < 0.62 ? b : a;
  if (p < 3.5) { const x = fract(u * 44) - 0.5, y = (f - 0.5) * 1.3; return Math.hypot(x, y) < 0.36 ? b : a; }
  if (p < 4.5) { const w = Math.sin(u * TAU * 12 + f * 3.2) * 0.5 + 0.5; return pick(sstep(0.3, 0.7, w * 0.75 + f * 0.45)); }
  if (p < 5.5) return (Math.floor(u * 40) + Math.floor(f * 2)) % 2 === 0 ? a : b;
  if (p < 6.5) return pick(0.5 + 0.5 * Math.sin(u * TAU * 3 - tm * 2.2 + f * 2));
  if (p < 7.5) { const x = fract(u * 30) - 0.5; return f < 0.26 + 0.46 * (1 - 4 * x * x) ? b : a; }
  const m = pick(1 - sstep(0, 1, f)), g = 0.28 * Math.exp(-Math.pow((f - 0.35) * 4.5, 2));
  return [m[0] + g, m[1] + g, m[2] + g];
}

const css = (n) => '#' + n.toString(16).padStart(6, '0');

function trailMarks(ctx, item, cx, cy, R, n = 7) {
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);                    // 0 near the hole, 1 oldest
    const x = cx - (R * 1.35 + k * R * 3.3), y = cy + Math.sin(k * 4 + 0.6) * R * 0.28;
    const al = Math.pow(1 - k, 1.3) * 0.95, sz = R * (0.2 + k * 0.1);
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = al;
    const c1 = css(item.c1), c2 = css(item.c2);
    switch (item.shape) {
      case 1: ctx.fillStyle = c1; ctx.beginPath(); for (let j = 0; j < 8; j++) { const r = j % 2 ? sz * 0.28 : sz * 1.1, a = (j / 8) * TAU; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, sz * 0.22, 0, TAU); ctx.fill(); break;
      case 2: ctx.strokeStyle = c1; ctx.lineWidth = Math.max(1.2, sz * 0.18); ctx.beginPath(); ctx.arc(0, 0, sz * 0.85, 0, TAU); ctx.stroke(); ctx.fillStyle = c2; ctx.globalAlpha = al * 0.35; ctx.beginPath(); ctx.arc(0, 0, sz * 0.85, 0, TAU); ctx.fill(); break;
      case 3: ctx.rotate(i * 1.7); ctx.fillStyle = c1; ctx.beginPath(); ctx.ellipse(0, 0, sz * 1.1, sz * 0.55, 0, 0, TAU); ctx.fill(); ctx.fillStyle = c2; ctx.globalAlpha = al * 0.6; ctx.beginPath(); ctx.ellipse(-sz * 0.2, -sz * 0.1, sz * 0.5, sz * 0.2, 0, 0, TAU); ctx.fill(); break;
      case 4: ctx.rotate(i * 1.3); ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(0, 0, sz * 0.95, Math.PI, 0); ctx.quadraticCurveTo(0, sz * 0.6, -sz * 0.95, 0); ctx.fill(); ctx.strokeStyle = c2; ctx.lineWidth = Math.max(1, sz * 0.14); ctx.stroke(); break;
      case 5: { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 1.5); g.addColorStop(0, i % 2 ? c1 : c2); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sz * 1.5, 0, TAU); ctx.fill(); break; }
      default: { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 1.2); g.addColorStop(0, c1); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sz * 1.2, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }
}

/** Draw a hole with a skin. opts: { rim, trail, tag, ident (hex int), name, ground, withTag, bg } */
export function drawHole(canvas, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || canvas.width / dpr, H = canvas.clientHeight || canvas.height / dpr;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // street-coloured ground
  ctx.fillStyle = opts.bg || '#d8ccb0'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(80,70,50,.07)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const sk = [opts.rim | 0, opts.trail | 0, opts.tag | 0];
  const R = Math.min(W * 0.2, H * (opts.withTag ? 0.27 : 0.33)), cx = W * (sk[1] ? 0.68 : 0.5), cy = H * (opts.withTag ? 0.44 : 0.5);
  const tr = itemOf(1, sk[1]);
  if (sk[1] > 0) trailMarks(ctx, tr, cx, cy, R);
  const rim = itemOf(0, sk[0]);
  const ident = hexRgb(opts.ident == null ? 0xe8572f : opts.ident);
  const rimW = Math.max(5, R * 0.3);
  const outer = R + rimW + 2, x0 = Math.max(0, Math.floor((cx - outer) * dpr)), y0 = Math.max(0, Math.floor((cy - outer) * dpr));
  const x1 = Math.min(canvas.width, Math.ceil((cx + outer) * dpr)), y1 = Math.min(canvas.height, Math.ceil((cy + outer) * dpr));
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d8 = img.data;
  const a = rim.pat ? hexRgb(rim.c1) : null, b = rim.pat ? hexRgb(rim.c2) : null;
  const tint = rim.tint ? hexRgb(rim.tint) : [0.23, 0.16, 0.15];
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    const dx = (px + 0.5) / dpr - cx, dy = (py + 0.5) / dpr - cy, dist = Math.hypot(dx, dy), d = dist - R, i = ((py - y0) * (x1 - x0) + (px - x0)) * 4;
    let col = null, al = 1;
    if (d < 0) {            // shaft: tint fading to black towards the middle
      const k = Math.pow(Math.min(1, -d / R), 0.55), s = rim.tint ? 0.5 : 0.35;
      col = [tint[0] * s * (1 - k), tint[1] * s * (1 - k), tint[2] * s * (1 - k)];
      al = Math.min(1, -d * dpr * 0.8 + 0.5);   // anti-aliased inner edge
      if (-d * dpr < 1) { const e = Math.max(0, Math.min(1, -d * dpr + 0.5)); al = e; }
    } else if (d < rimW) {
      const f = d / rimW;
      if (rim.pat) {
        const u = Math.atan2(dy, dx) / TAU + 0.5;
        const pc = patternRgb(rim.pat, Math.min(1, f / 0.68), u, a, b, 0.4);
        const k = sstep(0.66, 0.74, f);
        col = [mix(pc[0], ident[0], k), mix(pc[1], ident[1], k), mix(pc[2], ident[2], k)];
        al = 1 - sstep(0.88, 1, f);
      } else { col = ident; al = 1 - sstep(0.55, 1, f); }
      al *= 0.97;
    }
    if (col) {
      const o = 1 - al;
      d8[i] = d8[i] * o + Math.min(1, col[0]) * 255 * al; d8[i + 1] = d8[i + 1] * o + Math.min(1, col[1]) * 255 * al; d8[i + 2] = d8[i + 2] * o + Math.min(1, col[2]) * 255 * al;
    }
  }
  ctx.putImageData(img, x0, y0);
  if (opts.withTag) drawTag(ctx, W, H, cx, H * 0.86, sk[2], opts.name || 'Tu', ident);
}

function drawTag(ctx, W, H, cx, cy, tagId, name, ident) {
  const it = itemOf(2, tagId);
  ctx.font = '800 13px system-ui, sans-serif';
  const w = ctx.measureText(name).width + 34, h = 24, x = cx - w / 2, y = cy - h / 2;
  const bg = tagId ? css(it.bg) : '#fff', fg = tagId ? css(it.fg) : '#2b2218';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = tagId ? css(it.frame) : '#d9552f'; ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 11); ctx.stroke();
  ctx.fillStyle = css(((ident[0] * 255) << 16) | ((ident[1] * 255) << 8) | (ident[2] * 255)); ctx.beginPath(); ctx.arc(x + 13, cy, 4.5, 0, TAU); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(name, x + 23, cy + 0.5);
}

/** A small swatch for one wardrobe card. */
export function drawItem(canvas, slot, id, ident = 0xe8572f) {
  if (slot === 0) drawHole(canvas, { rim: id, ident });
  else if (slot === 1) drawHole(canvas, { trail: id, ident });
  else {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = canvas.clientWidth || 96, H = canvas.clientHeight || 56;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#d8ccb0'; ctx.fillRect(0, 0, W, H);
    drawTag(ctx, W, H, W / 2, H / 2, id, 'Tu', hexRgb(ident));
  }
}
