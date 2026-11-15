// Tiny software renderer for previews: PNG writer, hillshaded height-grid top view, oblique triangle render.
import fs from 'node:fs';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
}
export function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export class Canvas {
  constructor(w, h, bg = [24, 26, 32]) {
    this.w = w; this.h = h;
    this.px = new Uint8ClampedArray(w * h * 4);
    this.z = new Float32Array(w * h).fill(-Infinity);
    for (let i = 0; i < w * h; i++) { this.px[i * 4] = bg[0]; this.px[i * 4 + 1] = bg[1]; this.px[i * 4 + 2] = bg[2]; this.px[i * 4 + 3] = 255; }
  }
  set(x, y, c) { const k = (y * this.w + x) * 4; this.px[k] = c[0]; this.px[k + 1] = c[1]; this.px[k + 2] = c[2]; }
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const X = x + ox, Y = y + oy;
      if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
      const a = (y * src.w + x) * 4, b = (Y * this.w + X) * 4;
      this.px[b] = src.px[a]; this.px[b + 1] = src.px[a + 1]; this.px[b + 2] = src.px[a + 2];
    }
  }
  text(s, x, y, c = [230, 230, 230], sc = 2) {
    for (const ch of s) {
      const g = FONT[ch.toUpperCase()] || FONT[' '];
      for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r] & (4 >> q)) for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) { const X = x + q * sc + a, Y = y + r * sc + b; if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) this.set(X, Y, c); }
      x += 4 * sc;
    }
  }
}
const FONT = (() => {
  const rows = {
    '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 1, 1, 1], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
    A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [7, 4, 4, 4, 7], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [7, 4, 5, 5, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 7], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [7, 5, 5, 5, 7], P: [7, 5, 7, 4, 4], Q: [7, 5, 5, 7, 1], R: [6, 5, 6, 5, 5], S: [7, 4, 7, 1, 7], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7],
    ' ': [0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4], '-': [0, 0, 7, 0, 0], ':': [0, 2, 0, 2, 0], '/': [1, 1, 2, 4, 4], '(': [2, 4, 4, 4, 2], ')': [2, 1, 1, 1, 2], '=': [0, 7, 0, 7, 0], '+': [0, 2, 7, 2, 0], '%': [5, 1, 2, 4, 5], '#': [5, 7, 5, 7, 5],
  };
  return rows;
})();

// ---------------------------------------------------------------- hillshaded top view of a height grid
/** g: {w,h,cells:Float32 heights (NaN outside), cell}. Returns Canvas (scale px per cell). */
export function hillshade(g, scale = 6, maxH) {
  const cv = new Canvas(g.w * scale, g.h * scale);
  let mx = 0;
  for (const v of g.cells) if (v > mx) mx = v;
  maxH = maxH || mx || 1;
  const at = (i, j) => { const v = g.cells[Math.max(0, Math.min(g.h - 1, j)) * g.w + Math.max(0, Math.min(g.w - 1, i))]; return Number.isNaN(v) ? NaN : v; };
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const v = g.cells[j * g.w + i];
    if (Number.isNaN(v)) continue;
    const l = at(i - 1, j), r = at(i + 1, j), u = at(i, j - 1), d = at(i, j + 1);
    const dx = ((Number.isNaN(r) ? v : r) - (Number.isNaN(l) ? v : l)) / (2 * g.cell);
    const dz = ((Number.isNaN(d) ? v : d) - (Number.isNaN(u) ? v : u)) / (2 * g.cell);
    // light from north-west
    const nx = -dx, nz = -dz, ny = 1, len = Math.hypot(nx, ny, nz);
    const sh = Math.max(0, (nx * -0.5 + nz * -0.5 + ny * 0.7) / len / 1.0);
    const t = Math.min(1, v / maxH);
    const base = [60 + 190 * t, 90 + 130 * (1 - Math.abs(t - 0.5) * 2), 200 - 160 * t]; // blue (low) -> red (high)
    const k = 0.45 + 0.75 * sh;
    for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) cv.set(i * scale + a, j * scale + b, [base[0] * k, base[1] * k, base[2] * k]);
  }
  return cv;
}

// ---------------------------------------------------------------- oblique triangle renderer
/**
 * tris: array of {a:[x,y,z],b,c, col:[r,g,b]} in (x east, y up, z south) metres.
 * view: {yaw (deg, rotation about y), pitch (deg), cx,cy,cz centre, scale px per metre}
 */
export function renderTris(tris, w, h, view) {
  const cv = new Canvas(w, h, [34, 38, 48]);
  const yaw = (view.yaw * Math.PI) / 180, pit = (view.pitch * Math.PI) / 180;
  const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const proj = (p) => {
    const x = p[0] - view.cx, y = p[1] - view.cy, z = p[2] - view.cz;
    const x1 = x * cy_ + z * sy_, z1 = -x * sy_ + z * cy_; // yaw
    const y2 = y * cp - z1 * sp, d = y * sp + z1 * cp; // pitch; d = depth (larger = farther from the camera above)
    return [w / 2 + x1 * view.scale, h * view.yoff - y2 * view.scale, d];
  };
  const L = norm([-0.45, 0.8, -0.35]);
  for (const t of tris) {
    const A = proj(t.a), B = proj(t.b), C = proj(t.c);
    const ux = t.b[0] - t.a[0], uy = t.b[1] - t.a[1], uz = t.b[2] - t.a[2], vx = t.c[0] - t.a[0], vy = t.c[1] - t.a[1], vz = t.c[2] - t.a[2];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const nl = Math.hypot(...n) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    if (n[1] < 0 && !t.two) { /* winding-agnostic: flip so the normal faces the viewer-ish */ }
    const dot = Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    const k = 0.35 + 0.75 * dot;
    const col = [t.col[0] * k, t.col[1] * k, t.col[2] * k];
    const minx = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), maxx = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const miny = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), maxy = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
      const l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.0005 || l2 < -0.0005 || l3 < -0.0005) continue;
      const z = l1 * A[2] + l2 * B[2] + l3 * C[2];
      const idx = y * w + x;
      if (z > cv.z[idx]) { cv.z[idx] = z; cv.set(x, y, col); }
    }
  }
  return cv;
}
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
