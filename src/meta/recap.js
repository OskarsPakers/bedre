// End-of-round recap: a mini map (own pre-render from the map data, aspect-correct for any bounds) with the player's coloured trail,
// eaten footprints, notable things and rival end positions, plus a growth sparkline. Everything is recorded cheaply during play
// (R.samples every ~0.5 s) and drawn once at the end.
import { mt } from './strings.js';
import { getAreas } from './districts-names.js';
import { lname } from './strings.js';

const BG = '#e9e1cf', WATER = '#6f98b5', PARK = '#a9c78a', ROAD = '#fbf8ef', ROADM = '#ffffff', BLD = '#d2c6ad';
const baseCache = new Map();

function dims(bounds, W) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxZ - bounds.minZ;
  return { w, h, W, H: Math.round(W * (h / w)), s: W / w };
}

export function renderBase(data, W) {
  const key = W + ':' + data.meta.bounds.minX + ':' + data.meta.bounds.maxX + ':' + data.meta.bounds.minZ + ':' + data.meta.bounds.maxZ;
  if (baseCache.has(key)) return baseCache.get(key);
  const b = data.meta.bounds, d = dims(b, W);
  const c = document.createElement('canvas'); c.width = d.W; c.height = d.H;
  const g = c.getContext('2d');
  const P = (p) => [(p[0] - b.minX) * d.s, (p[1] - b.minZ) * d.s];
  g.fillStyle = BG; g.fillRect(0, 0, d.W, d.H);
  const poly = (list, fill) => {
    g.fillStyle = fill;
    for (const o of list || []) {
      const pts = o.p; if (!pts || pts.length < 3) continue;
      g.beginPath(); pts.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
    }
  };
  poly(data.parks, PARK); poly(data.water, WATER); poly(data.buildings, BLD);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const r of data.roads || []) {
    if (!r.p || r.k === 'rail' || r.k === 'footway') continue;
    const major = r.k === 'primary' || r.k === 'secondary' || r.k === 'tertiary';
    if ((pass === 1) !== major) continue;
    g.strokeStyle = major ? ROADM : ROAD;
    g.lineWidth = Math.max(0.7, (major ? 1.3 : 0.6) * Math.max(r.w || 6, 5) * d.s * 0.7);
    g.beginPath(); r.p.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  if (baseCache.size > 3) baseCache.clear();
  baseCache.set(key, c);
  return c;
}

/** Draw the recap map into `canvas` (sets its pixel width to W, height by aspect). */
export function drawRecapMap(canvas, rec, W) {
  const b = rec.bounds, d = dims(b, W);
  canvas.width = d.W; canvas.height = d.H;
  const g = canvas.getContext('2d');
  g.drawImage(renderBase(rec.data, W), 0, 0);
  const P = (x, z) => [(x - b.minX) * d.s, (z - b.minZ) * d.s];
  // faint area outlines
  g.strokeStyle = 'rgba(43,58,74,.28)'; g.lineWidth = Math.max(1, W / 420); g.setLineDash([W / 90, W / 120]);
  for (const a of getAreas()) {
    g.beginPath(); a.poly.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.stroke();
  }
  g.setLineDash([]);
  // eaten building footprints, tinted with the player's colour
  g.fillStyle = rec.color + 'cc';
  for (const ring of rec.footprints) {
    g.beginPath(); ring.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.fill();
  }
  // trail: colour shifts with time (cream -> player colour), broken at teleports
  const S = rec.samples, lw = Math.max(1.6, W / 190);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = lw;
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], c = S[i];
    if (Math.hypot(c.x - a.x, c.z - a.z) > 90) continue;
    const u = i / S.length;
    g.strokeStyle = `hsl(${Math.round(48 - 40 * u)} 90% ${Math.round(62 - 20 * u)}%)`;
    g.beginPath(); const [x0, y0] = P(a.x, a.z), [x1, y1] = P(c.x, c.z); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // notable things (stars)
  g.fillStyle = '#ffd24a'; g.strokeStyle = '#3a2a1c'; g.lineWidth = Math.max(1, W / 380);
  for (const m of rec.marks) {
    const [x, y] = P(m.x, m.z), r = Math.max(3.5, W / 95);
    g.beginPath();
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * 0.45 : r, an = -Math.PI / 2 + (k * Math.PI) / 5; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
    g.closePath(); g.fill(); g.stroke();
  }
  // rivals' final positions
  for (const o of rec.bots) {
    const [x, y] = P(o.x, o.z);
    g.beginPath(); g.arc(x, y, Math.max(2.5, o.r * d.s * 1.1, W / 150), 0, 6.2832);
    g.fillStyle = o.color; g.fill(); g.lineWidth = Math.max(1, W / 330); g.strokeStyle = '#fff'; g.stroke();
  }
  // start + end of the player
  if (S.length) {
    const a = S[0], e = S[S.length - 1];
    const [sx, sy] = P(a.x, a.z); g.fillStyle = '#fff'; g.strokeStyle = '#2a2622'; g.lineWidth = Math.max(1.2, W / 300);
    g.beginPath(); g.arc(sx, sy, Math.max(3, W / 120), 0, 6.2832); g.fill(); g.stroke();
    const [ex, ey] = P(e.x, e.z);
    g.beginPath(); g.arc(ex, ey, Math.max(4.5, W / 85), 0, 6.2832); g.fillStyle = rec.color; g.fill(); g.lineWidth = Math.max(2, W / 200); g.strokeStyle = '#1c1814'; g.stroke();
  }
  return canvas;
}

/** Growth sparkline: radius over time, player vs best rival. */
export function drawSpark(canvas, rec, W = 560, H = 120) {
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const S = rec.samples;
  if (S.length < 2) return canvas;
  const tMax = S[S.length - 1].t || 1;
  const rMax = Math.max(...S.map((s) => Math.max(s.r, s.rr || 0)), 1);
  const x = (t) => 8 + (t / tMax) * (W - 16), y = (r) => H - 10 - (r / rMax) * (H - 22);
  g.strokeStyle = 'rgba(43,58,74,.15)'; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { g.beginPath(); g.moveTo(8, y((rMax * k) / 3)); g.lineTo(W - 8, y((rMax * k) / 3)); g.stroke(); }
  const line = (key, col, lw) => {
    g.beginPath(); let started = false;
    for (const s of S) { const v = s[key]; if (v == null) continue; started ? g.lineTo(x(s.t), y(v)) : g.moveTo(x(s.t), y(v)); started = true; }
    g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  };
  line('rr', '#2b3a4a', 2.4);
  line('r', rec.color, 3.4);
  g.fillStyle = '#6b6258'; g.font = '600 12px system-ui, sans-serif';
  g.fillText(`Ø ${(rMax * 2).toFixed(0)} m`, 10, 12);
  g.textAlign = 'right'; g.fillText(`${Math.round(tMax)} s`, W - 8, H - 1); g.textAlign = 'left';
  return canvas;
}

export function areaRows(areaPct, n = 4) {
  return Object.values(areaPct).filter((a) => a.pct >= 0.5).sort((a, b) => b.pct - a.pct).slice(0, n);
}
export { mt, lname };
