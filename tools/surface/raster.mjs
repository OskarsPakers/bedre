// Small raster helpers for the ground-class builder: polygon / line fills on a Uint8 grid, nearest-class fill, mode filter, PNG writer.
import zlib from 'node:zlib';

/** Grid: W x H cells of `res` metres, origin (x0, z0) = top-left corner in local metres. */
export class Grid {
  constructor(x0, z0, W, H, res) { this.x0 = x0; this.z0 = z0; this.W = W; this.H = H; this.res = res; }
  ix(x) { return (x - this.x0) / this.res; }
  iz(z) { return (z - this.z0) / this.res; }
}

/** Even-odd polygon fill (rings = array of [x,z] rings in metres) into `a` (Uint8Array) with `val`. */
export function fillPolys(g, a, rings, val, only = null) {
  let zmin = Infinity, zmax = -Infinity;
  for (const r of rings) for (const q of r) { if (q[1] < zmin) zmin = q[1]; if (q[1] > zmax) zmax = q[1]; }
  const j0 = Math.max(0, Math.floor(g.iz(zmin) - 1)), j1 = Math.min(g.H - 1, Math.ceil(g.iz(zmax) + 1));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = g.z0 + (j + 0.5) * g.res;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, n = r.length, k = n - 1; i < n; k = i++) {
        const a0 = r[i], b0 = r[k];
        if ((a0[1] > z) !== (b0[1] > z)) xs.push(a0[0] + ((z - a0[1]) / (b0[1] - a0[1])) * (b0[0] - a0[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(g.ix(xs[k]) - 0.5)), i1 = Math.min(g.W - 1, Math.floor(g.ix(xs[k + 1]) - 0.5));
      for (let i = i0; i <= i1; i++) { const o = j * g.W + i; if (!only || only(a[o])) a[o] = val; }
    }
  }
}

/** Stamp a polyline of half-width hw (metres) into `a`. */
export function strokeLine(g, a, pts, hw, val) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s], [x1, z1] = pts[s + 1];
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
    const i0 = Math.max(0, Math.floor(g.ix(Math.min(x0, x1) - hw))), i1 = Math.min(g.W - 1, Math.ceil(g.ix(Math.max(x0, x1) + hw)));
    const j0 = Math.max(0, Math.floor(g.iz(Math.min(z0, z1) - hw))), j1 = Math.min(g.H - 1, Math.ceil(g.iz(Math.max(z0, z1) + hw)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.x0 + (i + 0.5) * g.res, z = g.z0 + (j + 0.5) * g.res;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
      if (Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz)) <= hw) a[j * g.W + i] = val;
    }
  }
}

/** Replace every cell where `isHole(v)` by the nearest cell (BFS, 8-neighbourhood, <= maxD steps) where it is false; unfilled -> `fallback`. */
export function nearestFill(a, W, H, isHole, maxD, fallback) {
  const N = W * H;
  const q = new Int32Array(N);
  const d = new Uint16Array(N).fill(65535);
  const src = new Int32Array(N).fill(-1);
  let qh = 0, qt = 0;
  for (let k = 0; k < N; k++) if (!isHole(a[k])) { d[k] = 0; src[k] = k; q[qt++] = k; }
  while (qh < qt) {
    const k = q[qh++];
    if (d[k] >= maxD) continue;
    const x = k % W, y = (k / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const kk = yy * W + xx;
      if (d[kk] !== 65535) continue;
      d[kk] = d[k] + 1; src[kk] = src[k]; q[qt++] = kk;
    }
  }
  const out = new Uint8Array(a);
  for (let k = 0; k < N; k++) if (isHole(a[k])) out[k] = src[k] >= 0 ? a[src[k]] : fallback;
  return out;
}

/** Mode filter (radius r) over classes 0..15 restricted to cells where `eligible(v)`; ties keep the centre value. */
export function modeFilter(a, W, H, r, eligible) {
  const out = new Uint8Array(a);
  const cnt = new Uint16Array(16);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = a[y * W + x];
    if (!eligible(v)) continue;
    cnt.fill(0);
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; cnt[a[yy * W + xx]]++; } }
    let best = v, bc = cnt[v];
    for (let c = 0; c < 16; c++) if (eligible(c) && cnt[c] > bc) { bc = cnt[c]; best = c; }
    out[y * W + x] = best;
  }
  return out;
}

/** Remove connected regions of class `c` smaller than minCells by relabelling them to the most common neighbouring class. */
export function removeSpecks(a, W, H, minCells, classes) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !classes.has(a[s])) continue;
    const c = a[s];
    const comp = [];
    stack.length = 0; stack.push(s); seen[s] = 1;
    const border = new Uint32Array(16);
    while (stack.length) {
      const k = stack.pop(); comp.push(k);
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const kk = yy * W + xx;
        if (a[kk] === c) { if (!seen[kk]) { seen[kk] = 1; stack.push(kk); } } else border[a[kk]]++;
      }
    }
    if (comp.length < minCells) {
      let best = c, bc = 0;
      for (let v = 0; v < 16; v++) if (v !== c && border[v] > bc) { bc = border[v]; best = v; }
      if (best !== c) for (const k of comp) a[k] = best;
    }
  }
}

/** Relabel connected regions of class `c`: decide(compCells, borderCounts[16]) returns a new class or -1 to keep. */
export function reclassComponents(a, W, H, c, decide) {
  const seen = new Uint8Array(W * H), stack = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (seen[s0] || a[s0] !== c) continue;
    const comp = []; const border = new Uint32Array(16);
    stack.length = 0; stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const k = stack.pop(); comp.push(k);
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const kk = yy * W + xx;
        if (a[kk] === c) { if (!seen[kk]) { seen[kk] = 1; stack.push(kk); } } else border[a[kk]]++;
      }
    }
    const nc = decide(comp, border);
    if (nc >= 0) for (const k of comp) a[k] = nc;
  }
}

// ---- PNG (palette, 4 bit) writer
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
/** a: Uint8Array of palette indices (< 16), palette: [[r,g,b]...]. Row filter chosen per row (None/Sub/Up/Paeth) by min abs-sum. */
export function encodePng(a, W, H, palette, bitDepth = 4) {
  const per = 8 / bitDepth;
  const rowBytes = Math.ceil(W / per);
  const rows = [];
  for (let y = 0; y < H; y++) {
    const r = new Uint8Array(rowBytes);
    for (let x = 0; x < W; x++) r[(x / per) | 0] |= a[y * W + x] << (8 - bitDepth - (x % per) * bitDepth);
    rows.push(r);
  }
  const out = Buffer.alloc(H * (rowBytes + 1));
  const paeth = (a0, b0, c0) => { const p = a0 + b0 - c0, pa = Math.abs(p - a0), pb = Math.abs(p - b0), pc = Math.abs(p - c0); return pa <= pb && pa <= pc ? a0 : pb <= pc ? b0 : c0; };
  const zero = new Uint8Array(rowBytes);
  for (let y = 0; y < H; y++) {
    const cur = rows[y], up = y ? rows[y - 1] : zero;
    let bestF = 0, bestS = Infinity, bestBuf = null;
    for (const f of [0, 1, 2, 4]) {
      const b = Buffer.alloc(rowBytes);
      let s = 0;
      for (let i = 0; i < rowBytes; i++) {
        const left = i ? cur[i - 1] : 0, upl = i ? up[i - 1] : 0;
        const v = (cur[i] - (f === 0 ? 0 : f === 1 ? left : f === 2 ? up[i] : paeth(left, up[i], upl))) & 255;
        b[i] = v; s += v < 128 ? v : 256 - v;
      }
      if (s < bestS) { bestS = s; bestF = f; bestBuf = b; }
    }
    out[y * (rowBytes + 1)] = bestF; bestBuf.copy(out, y * (rowBytes + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = bitDepth; ihdr[9] = 3;
  const plte = Buffer.from(palette.flat());
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
