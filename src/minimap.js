// Minimap: static city map pre-rendered once from the data (water, parks, roads, building mass),
// plus live dots for every hole (sized by radius), the player highlighted, and the visible camera area.
import * as THREE from 'three';

const BG = '#e9e1cf', WATER = '#6f98b5', PARK = '#a9c78a', ROAD = '#fbf8ef', ROADM = '#ffffff', BLD = '#c4b79c';

export class Minimap {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const b = data.meta.bounds;
    this.b = b;
    this.w = b.maxX - b.minX; this.h = b.maxZ - b.minZ;
    this.bg = this._render(data, 360);
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._last = 0;
    this.size = 0;
    this.resizeToCss();
  }

  _render(data, S) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const sx = S / this.w, sz = S / this.h, b = this.b;
    const P = (p) => [(p[0] - b.minX) * sx, (p[1] - b.minZ) * sz];
    g.fillStyle = BG; g.fillRect(0, 0, S, S);
    const poly = (list, fill) => {
      g.fillStyle = fill;
      for (const o of list) {
        const pts = o.p; if (!pts || pts.length < 3) continue;
        g.beginPath();
        pts.forEach((q, i) => { const [x, y] = P(q); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.closePath(); g.fill();
      }
    };
    poly(data.parks, PARK);
    poly(data.water, WATER);
    poly(data.buildings, BLD);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const r of data.roads) {
        if (!r.p || r.k === 'rail' || r.k === 'footway') continue;
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
    if (px !== this.canvas.width) { this.canvas.width = this.canvas.height = px; }
    this.size = px;
  }

  _toMap(x, z) { return [((x - this.b.minX) / this.w) * this.size, ((z - this.b.minZ) / this.h) * this.size]; }

  /** Intersect a screen-space NDC point with the ground plane; null if it points above the horizon. */
  _ground(camera, nx, ny) {
    this._v.set(nx, ny, 0.5).unproject(camera);
    this._dir.copy(this._v).sub(camera.position);
    if (this._dir.y > -1e-4) return null;
    const t = -camera.position.y / this._dir.y;
    return [camera.position.x + this._dir.x * t, camera.position.z + this._dir.z * t];
  }

  draw(holes, player, camera, leader, now) {
    if (now - this._last < 1 / 20) return;
    this._last = now;
    if (!this.size || Math.abs(this.canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1) - this.size) > 2) this.resizeToCss();
    const g = this.ctx, S = this.size;
    g.drawImage(this.bg, 0, 0, S, S);
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
    for (const h of holes) if (h.alive && h !== player) dot(h, false);
    if (player.alive) dot(player, true);
  }
}
