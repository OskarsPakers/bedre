// The 2D guess map: drawn from the map data (water, parks, wood, squares, building mass, streets). No labels except optional neighbourhood
// names (easy). Zoomed out it blits one pre-rendered bitmap; zoomed in it draws the visible vector features live (bbox-culled).
// Pan = drag, zoom = wheel / pinch / buttons, tap = place pin (when enabled). Also renders the reveal (guess, truth, line) and mini maps.
import { getAreas } from '../../meta/districts-names.js';

const BG = '#ece4d2', WATER = '#7ba7c5', PARK = '#b9d39c', WOOD = '#9fc185', SQUARE = '#f5f0e4', RAIL = '#cdc5b3', BLD = '#d6c6a4', BLD_EDGE = '#bba984';
const ROAD_FILL = '#ffffff', ROAD_CASE = '#cbc1a9', MINOR_FILL = '#fbf8ef', WALK = '#ddd4bd';
const INK = '#14283a', TEAL = '#0f7b6c', AMBER = '#f2a81d';

const bbox = (p) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; } return [x0, x1, z0, z1]; };
const prepList = (list, filter) => (list || []).filter((o) => o.p && o.p.length >= 3 && (!filter || filter(o))).map((o) => ({ p: o.p, h: o.h && Array.isArray(o.h) && Array.isArray(o.h[0]) && Array.isArray(o.h[0][0]) ? o.h : null, b: bbox(o.p) }));

const prepCache = new WeakMap();
function prep(data) {
  let P = prepCache.get(data);
  if (P) return P;
  P = {
    water: prepList(data.water), parks: prepList(data.parks), wood: prepList(data.areas, (o) => o.c === 'wd'), sq: prepList(data.areas, (o) => o.c === 'sq'),
    railA: prepList(data.areas, (o) => o.c === 'rail'), bld: prepList(data.buildings),
    roads: (data.roads || []).filter((r) => r.p && r.p.length >= 2 && !r.tn).map((r) => ({
      p: r.p, w: r.w || 6, k: r.k, b: bbox(r.p),
      major: r.k === 'primary' || r.k === 'secondary' || r.k === 'tertiary',
      walk: r.k === 'footway' || r.k === 'pedestrian', rail: r.k === 'rail',
    })),
  };
  prepCache.set(data, P);
  return P;
}

/** Paint the base map for view T = { ox, oz (world coords of the top-left), s (px per metre), w, h (px) } into g. */
export function paintMap(g, data, T) {
  const P = prep(data), s = T.s, x0 = T.ox, z0 = T.oz, x1 = T.ox + T.w / s, z1 = T.oz + T.h / s;
  const vis = (b, m = 0) => !(b[1] < x0 - m || b[0] > x1 + m || b[3] < z0 - m || b[2] > z1 + m);
  const X = (x) => (x - x0) * s, Z = (z) => (z - z0) * s;
  g.fillStyle = BG; g.fillRect(0, 0, T.w, T.h);
  const poly = (list, fill, stroke) => {
    g.fillStyle = fill; if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.8; }
    for (const o of list) {
      if (!vis(o.b)) continue;
      g.beginPath();
      o.p.forEach((q, i) => (i ? g.lineTo(X(q[0]), Z(q[1])) : g.moveTo(X(q[0]), Z(q[1])))); g.closePath();
      if (o.h) for (const h of o.h) { h.forEach((q, i) => (i ? g.lineTo(X(q[0]), Z(q[1])) : g.moveTo(X(q[0]), Z(q[1])))); g.closePath(); }
      g.fill('evenodd'); if (stroke) g.stroke();
    }
  };
  poly(P.railA, RAIL); poly(P.wood, WOOD); poly(P.parks, PARK); poly(P.sq, SQUARE); poly(P.water, WATER);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (r, width, col, dash) => {
    g.lineWidth = width; g.strokeStyle = col; g.setLineDash(dash || []);
    g.beginPath(); r.p.forEach((q, i) => (i ? g.lineTo(X(q[0]), Z(q[1])) : g.moveTo(X(q[0]), Z(q[1])))); g.stroke();
  };
  if (s > 0.9) for (const r of P.roads) if (r.walk && r.k === 'footway' && vis(r.b)) line(r, Math.max(1, 1.6 * s * 0.5), WALK, [3, 3]);
  g.setLineDash([]);
  poly(P.bld, BLD, s > 1.4 ? BLD_EDGE : null);
  const roadW = (r) => Math.max(r.major ? 1.5 : 1.0, r.w * s * (r.major ? 0.95 : 0.9));
  for (const pass of [0, 1, 2]) { // 0 = minor casing + fill, 1 = major casing + fill (minor under major)
    for (const r of P.roads) {
      if (r.rail || r.k === 'footway' || !vis(r.b, 8)) continue;
      if (pass === 2) break;
      if ((pass === 1) !== r.major) continue;
      const w = roadW(r);
      if (s > 0.35) line(r, w + 1.6, ROAD_CASE);
    }
    for (const r of P.roads) {
      if (r.rail || r.k === 'footway' || !vis(r.b, 8)) continue;
      if (pass === 2) break;
      if ((pass === 1) !== r.major) continue;
      line(r, roadW(r), r.major ? ROAD_FILL : MINOR_FILL);
    }
  }
  if (s > 0.25) for (const r of P.roads) if (r.rail && vis(r.b)) line(r, Math.max(1, 3 * s * 0.6), '#b9b09e', [6, 4]);
  g.setLineDash([]);
}

function pinPath(g, x, y, k) { // teardrop with the tip at (x, y)
  const r = 11 * k, cy = y - 24 * k;
  g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - r * 0.15, y - 8 * k, x - r, cy + r * 0.9, x - r, cy); g.arc(x, cy, r, Math.PI, 0); g.bezierCurveTo(x + r, cy + r * 0.9, x + r * 0.15, y - 8 * k, x, y); g.closePath();
}
export function drawPin(g, x, y, fill, k = 1) {
  pinPath(g, x, y, k); g.fillStyle = fill; g.fill(); g.lineWidth = 2.2 * k; g.strokeStyle = '#fff'; g.stroke();
  g.beginPath(); g.arc(x, y - 24 * k, 4 * k, 0, 6.2832); g.fillStyle = '#fff'; g.fill();
}
export function drawFlag(g, x, y, k = 1) { // truth marker: ring + dot
  g.beginPath(); g.arc(x, y, 12 * k, 0, 6.2832); g.fillStyle = 'rgba(242,168,29,.35)'; g.fill();
  g.beginPath(); g.arc(x, y, 7 * k, 0, 6.2832); g.fillStyle = AMBER; g.fill(); g.lineWidth = 2.4 * k; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(x, y, 2.4 * k, 0, 6.2832); g.fillStyle = INK; g.fill();
}

export class GuessMap {
  constructor(canvas, data, { onTap = null, onView = null } = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.data = data; this.onTap = onTap; this.onView = onView;
    this.b = data.meta.bounds; this.W = this.b.maxX - this.b.minX; this.H = this.b.maxZ - this.b.minZ;
    this.cx = (this.b.minX + this.b.maxX) / 2; this.cz = (this.b.minZ + this.b.maxZ) / 2; this.s = 0.2;
    this.w = 0; this.h = 0; this.dpr = 1;
    this.guess = null; this.truth = null; this.label = null; this.tapEnabled = false; this.names = false; this.base = null; this.anim = null;
    this._dirty = true; this._ptrs = new Map(); this._tap = null; this._pinch = null;
    const c = canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => { this._ptrs.delete(e.pointerId); this._pinch = null; this._tap = null; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    this._raf = () => { this._frame(); requestAnimationFrame(this._raf); };
    requestAnimationFrame(this._raf);
  }

  // ---- view ------------------------------------------------------------------------------------------------------------------
  get minScale() { return Math.max(0.02, Math.min(this.w / (this.W * 1.04), this.h / (this.H * 1.04))); }
  get maxScale() { return 4.5; }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return true;
    const first = !this.w;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    if (first) this.s = this.minScale;
    this.s = Math.max(this.s, this.minScale);
    this._dirty = true;
    return true;
  }
  _clamp() {
    this.s = Math.min(this.maxScale, Math.max(this.minScale, this.s));
    this.cx = Math.min(this.b.maxX, Math.max(this.b.minX, this.cx)); this.cz = Math.min(this.b.maxZ, Math.max(this.b.minZ, this.cz));
  }
  toScreen(x, z) { return [(x - this.cx) * this.s + this.w / 2, (z - this.cz) * this.s + this.h / 2]; }
  toWorld(px, py) { return [(px - this.w / 2) / this.s + this.cx, (py - this.h / 2) / this.s + this.cz]; }
  zoomAt(f, px, py) {
    const [wx, wz] = this.toWorld(px, py);
    this.s = Math.min(this.maxScale, Math.max(this.minScale, this.s * f));
    this.cx = wx - (px - this.w / 2) / this.s; this.cz = wz - (py - this.h / 2) / this.s;
    this._clamp(); this._changed();
  }
  zoomBy(f) { this.zoomAt(f, this.w / 2, this.h / 2); }
  _changed() { this._dirty = true; if (this.onView) this.onView(this); }
  /** fit world points (list of [x,z]) with padding in px; animate when ms > 0 */
  fitPoints(pts, { pad = 70, minSpan = 260, ms = 0, padTop = null } = {}) {
    if (!this.resize()) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const spanX = Math.max(minSpan, x1 - x0), spanZ = Math.max(minSpan, z1 - z0);
    const top = padTop == null ? pad : padTop;
    const s = Math.min((this.w - pad * 2) / spanX, (this.h - pad - top) / spanZ);
    const to = { s: Math.min(this.maxScale, Math.max(this.minScale, s)), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
    to.cz -= ((top - pad) / 2) / to.s; // padTop > pad: leave extra room at the top (the pin head, a banner)
    this.animateTo(to, ms);
  }
  fitAll(ms = 0) { this.resize(); this.animateTo({ s: this.minScale, cx: (this.b.minX + this.b.maxX) / 2, cz: (this.b.minZ + this.b.maxZ) / 2 }, ms); }
  animateTo(to, ms) {
    if (!ms) { this.s = to.s; this.cx = to.cx; this.cz = to.cz; this.anim = null; this._clamp(); this._changed(); return; }
    this.anim = { from: { s: this.s, cx: this.cx, cz: this.cz }, to, t0: performance.now(), ms };
  }

  // ---- state -----------------------------------------------------------------------------------------------------------------
  setGuess(x, z) { this.guess = x == null ? null : [x, z]; this._dirty = true; }
  setTruth(x, z, label) { this.truth = x == null ? null : [x, z]; this.label = label || null; this._dirty = true; }
  setNames(on) { this.names = !!on; this._dirty = true; }
  invalidate() { this._dirty = true; }

  // ---- input -----------------------------------------------------------------------------------------------------------------
  _pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _down(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic / released pointer */ }
    this.anim = null;
    this._ptrs.set(e.pointerId, this._pos(e));
    if (this._ptrs.size === 1) this._tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else { this._tap = null; this._startPinch(); }
  }
  _startPinch() {
    const [a, b] = [...this._ptrs.values()];
    this._pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
  }
  _move(e) {
    if (!this._ptrs.has(e.pointerId)) return;
    const prev = this._ptrs.get(e.pointerId), cur = this._pos(e);
    this._ptrs.set(e.pointerId, cur);
    if (this._tap && Math.hypot(e.clientX - this._tap.x, e.clientY - this._tap.y) > 7) this._tap.moved = true;
    if (this._ptrs.size === 1) {
      if (this._tap && !this._tap.moved) return;
      this.cx -= (cur[0] - prev[0]) / this.s; this.cz -= (cur[1] - prev[1]) / this.s; this._clamp(); this._changed();
    } else if (this._ptrs.size >= 2 && this._pinch) {
      const [a, b] = [...this._ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      this.zoomAt(d / this._pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      this._pinch.d = d;
    }
  }
  _up(e) {
    const tap = this._tap;
    this._ptrs.delete(e.pointerId);
    if (this._ptrs.size < 2) this._pinch = null;
    if (tap && tap.id === e.pointerId && !tap.moved && performance.now() - tap.t < 700) {
      this._tap = null;
      if (this.tapEnabled && this.onTap) { const [px, py] = this._pos(e); const [x, z] = this.toWorld(px, py); this.onTap(x, z); }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------
  _ensureBase() {
    if (this.base) return this.base;
    const sc = Math.min(0.6, 2200 / Math.max(this.W, this.H));
    const c = document.createElement('canvas');
    c.width = Math.round(this.W * sc); c.height = Math.round(this.H * sc);
    paintMap(c.getContext('2d'), this.data, { ox: this.b.minX, oz: this.b.minZ, s: sc, w: c.width, h: c.height });
    return (this.base = c);
  }
  _frame() {
    if (this.anim) {
      const a = this.anim, u = Math.min(1, (performance.now() - a.t0) / a.ms), e = 1 - Math.pow(1 - u, 3);
      // interpolate scale geometrically so zooming feels even
      this.s = a.from.s * Math.pow(a.to.s / a.from.s, e);
      this.cx = a.from.cx + (a.to.cx - a.from.cx) * e; this.cz = a.from.cz + (a.to.cz - a.from.cz) * e;
      if (u >= 1) this.anim = null;
      this._clamp(); this._changed();
    }
    if (!this._dirty) return;
    if (!this.resize()) return;
    this._dirty = false;
    this.draw(this.ctx, this.dpr);
  }
  draw(g, dpr) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = { ox: this.cx - this.w / 2 / this.s, oz: this.cz - this.h / 2 / this.s, s: this.s, w: this.w, h: this.h };
    if (this.s < 0.5) {
      const base = this._ensureBase();
      g.fillStyle = BG; g.fillRect(0, 0, this.w, this.h);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(base, (this.b.minX - T.ox) * this.s, (this.b.minZ - T.oz) * this.s, this.W * this.s, this.H * this.s);
    } else paintMap(g, this.data, T);
    if (this.names) this._drawNames(g);
    this._drawMarks(g, (x, z) => this.toScreen(x, z), this.w < 520 ? 1.15 : 1);
  }
  _drawNames(g) {
    const areas = getAreas();
    g.save(); g.lineWidth = 1.2; g.setLineDash([6, 5]); g.strokeStyle = 'rgba(40,60,80,.4)';
    for (const a of areas) {
      if (a.x1 < this.b.minX - 200 || a.x0 > this.b.maxX + 200 || a.z1 < this.b.minZ - 200 || a.z0 > this.b.maxZ + 200) continue;
      g.beginPath(); a.poly.forEach(([x, z], i) => { const [px, py] = this.toScreen(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.stroke();
    }
    g.setLineDash([]);
    if (this.s < 0.5) {
      g.font = '700 13px system-ui, sans-serif'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 4; g.fillStyle = '#1c3347'; g.strokeStyle = 'rgba(255,255,255,.85)';
      const lang = document.documentElement.lang === 'lv' ? 'lv' : 'en';
      for (const a of areas) {
        let sx = 0, sz = 0, n = 0;
        for (const [x, z] of a.poly) if (x > this.b.minX && x < this.b.maxX && z > this.b.minZ && z < this.b.maxZ) { sx += x; sz += z; n++; }
        if (n < 3) continue;
        const [px, py] = this.toScreen(sx / n, sz / n);
        if (px < 0 || py < 0 || px > this.w || py > this.h) continue;
        const name = a[lang] || a.lv; g.strokeText(name, px, py); g.fillText(name, px, py);
      }
    }
    g.restore();
  }
  _drawMarks(g, P, k) {
    if (this.guess && this.truth) {
      const [ax, ay] = P(...this.guess), [bx, by] = P(...this.truth);
      g.save(); g.lineCap = 'round'; g.setLineDash([9, 8]); g.lineWidth = 3.2 * k; g.strokeStyle = INK; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.restore();
      if (this.label) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        g.save(); g.font = `800 ${Math.round(14 * k)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const w = g.measureText(this.label).width + 18 * k;
        g.fillStyle = INK; g.beginPath(); g.roundRect(mx - w / 2, my - 13 * k, w, 26 * k, 13 * k); g.fill();
        g.fillStyle = '#fff'; g.fillText(this.label, mx, my + 1); g.restore();
      }
    }
    if (this.truth) { const [x, y] = P(...this.truth); drawFlag(g, x, y, k); }
    if (this.guess) { const [x, y] = P(...this.guess); drawPin(g, x, y, TEAL, k); }
  }
}

/** Static mini map into a canvas (its pixel size): fits the guess and the truth. */
export function renderMini(canvas, data, guess, truth) {
  const w = canvas.width, h = canvas.height, g = canvas.getContext('2d');
  const pts = guess ? [guess, truth] : [truth];
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
  const s = Math.min((w - 40) / Math.max(220, x1 - x0), (h - 52) / Math.max(220, z1 - z0));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2 - 10 / s;
  paintMap(g, data, { ox: cx - w / 2 / s, oz: cz - h / 2 / s, s, w, h });
  const m = { guess, truth, label: null };
  GuessMap.prototype._drawMarks.call(m, g, (x, z) => [(x - cx) * s + w / 2, (z - cz) * s + h / 2], 0.62);
}
