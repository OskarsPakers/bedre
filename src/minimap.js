// Minimap: static city map pre-rendered once from the data (water, parks, roads, building mass),
// plus live dots for every hole (sized by radius), the player highlighted, and the visible camera area.
import * as THREE from 'three';
import { PU_COLOR } from './powerupView.js';

const BG = '#e9e1cf', WATER = '#6f98b5', PARK = '#a9c78a', WOOD = '#8fb676', ROAD = '#fbf8ef', ROADM = '#ffffff', BLD = '#c4b79c', RAIL = '#cfc7b6', SQUARE = '#f3eee2';

export class Minimap {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const b = data.meta.bounds;
    this.b = b;
    this.w = b.maxX - b.minX; this.h = b.maxZ - b.minZ;
    this.aspect = this.h / this.w; // the map is a rectangle: the canvas follows its aspect
    this.bg = this._render(data, 440);
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._last = 0;
    this.size = 0;
    this.resizeToCss();
  }

  _render(data, S) {
    const SH = Math.round(S * this.aspect);
    const c = document.createElement('canvas');
    c.width = S; c.height = SH;
    const g = c.getContext('2d');
    const sx = S / this.w, b = this.b;
    const P = (p) => [(p[0] - b.minX) * sx, (p[1] - b.minZ) * sx];
    g.fillStyle = BG; g.fillRect(0, 0, S, SH);
    const ring = (pts) => { pts.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const poly = (list, fill, only, holes = true) => {
      g.fillStyle = fill;
      for (const o of list) {
        const pts = o.p; if (!pts || pts.length < 3 || (only && !only(o))) continue;
        g.beginPath(); ring(pts);
        if (holes) for (const h of o.h || []) { g.moveTo(...P(h[0])); ring(h); }
        g.fill('evenodd');
      }
    };
    poly(data.areas || [], WOOD, (o) => o.c === 'wd');
    poly(data.areas || [], RAIL, (o) => o.c === 'rail');
    poly(data.parks, PARK);
    poly(data.areas || [], SQUARE, (o) => o.c === 'sq');
    poly(data.water, WATER);
    poly(data.buildings, BLD, null, false); // building `h` is its height, not holes
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const r of data.roads) {
        if (!r.p || r.tn || r.k === 'rail' || r.k === 'footway') continue;
        const major = r.k === 'primary' || r.k === 'secondary' || r.k === 'tertiary';
        if ((pass === 1) !== major) continue;
        g.strokeStyle = major ? ROADM : ROAD;
        g.lineWidth = Math.max(0.8, (major ? 1.3 : 0.6) * Math.max(r.w || 6, 5) * sx * 0.7);
        g.beginPath();
        r.p.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
    }
    return c;
  }

  resizeToCss() {
    const css = Math.round(this.canvas.clientWidth) || 160;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    const ph = Math.round(px * this.aspect);
    this.canvas.style.height = Math.round(css * this.aspect) + 'px';
    if (px !== this.canvas.width || ph !== this.canvas.height) { this.canvas.width = px; this.canvas.height = ph; }
    this.size = px; this.sizeH = ph;
  }

  _toMap(x, z) { return [((x - this.b.minX) / this.w) * this.size, ((z - this.b.minZ) / this.h) * this.sizeH]; }

  /** Intersect a screen-space NDC point with the ground plane; null if it points above the horizon. */
  _ground(camera, nx, ny) {
    this._v.set(nx, ny, 0.5).unproject(camera);
    this._dir.copy(this._v).sub(camera.position);
    if (this._dir.y > -1e-4) return null;
    const t = -camera.position.y / this._dir.y;
    return [camera.position.x + this._dir.x * t, camera.position.z + this._dir.z * t];
  }

  draw(holes, player, camera, leader, now, pickups = null) {
    if (now - this._last < 1 / 20) return;
    this._last = now;
    if (!this.size || Math.abs(this.canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1) - this.size) > 2) this.resizeToCss();
    const g = this.ctx, S = this.size;
    g.drawImage(this.bg, 0, 0, S, this.sizeH);
    // visible area (camera frustum on the ground)
    const pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([nx, ny]) => this._ground(camera, nx, ny));
    if (pts.every(Boolean)) {
      g.beginPath();
      pts.forEach((q, i) => { const [x, y] = this._toMap(q[0], q[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
      g.strokeStyle = 'rgba(40,34,28,0.75)'; g.lineWidth = Math.max(1, S / 140); g.stroke();
    }
    const dot = (h, me) => {
      const [x, y] = this._toMap(h.x, h.z);
      const r = Math.max(me ? 3.4 : 2.4, (h.radius / this.w) * S * 1.2) * (S / 160);
      g.globalAlpha = h.dying ? 0.5 : 1;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832);
      g.fillStyle = '#' + h.color.getHexString(); g.fill();
      g.lineWidth = me ? 2.2 * (S / 160) : 1.2 * (S / 160);
      g.strokeStyle = me ? '#1c1814' : 'rgba(255,255,255,.9)'; g.stroke();
      if (h === leader) {
        g.fillStyle = '#ffd24a'; g.strokeStyle = '#6b4a00'; g.lineWidth = 1;
        const cy = y - r - 3 * (S / 160), s = 3 * (S / 160);
        g.beginPath(); g.moveTo(x - s, cy); g.lineTo(x - s, cy - s); g.lineTo(x - s / 2, cy - s / 2); g.lineTo(x, cy - s * 1.3);
        g.lineTo(x + s / 2, cy - s / 2); g.lineTo(x + s, cy - s); g.lineTo(x + s, cy); g.closePath(); g.fill(); g.stroke();
      }
      g.globalAlpha = 1;
    };
    if (pickups) for (const p of pickups) {   // power-up dots: the token's colour with a white ring
      const [x, y] = this._toMap(p.x, p.z), u = S / 160, r = 3.6 * u;
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fillStyle = PU_COLOR[p.type]; g.fill();
      g.lineWidth = 1.6 * u; g.strokeStyle = '#fff'; g.stroke();
    }
    for (const h of holes) if (h.alive && h !== player) dot(h, false);
    if (player.alive) dot(player, true);
  }
}
