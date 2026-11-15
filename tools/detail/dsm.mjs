// Footprint -> height grid (DSM) built from I3S mesh triangles. The mesh is a measuring instrument only.
//
// Raster: max elevation per cell (metres a.s.l., as stored in the mesh) in game-local coordinates.
//   cell (i,j) covers x in [x0+i*cell, x0+(i+1)*cell), z in [z0+j*cell, ...). Empty cells = NaN.
import { openLayers, localToMerc, MERC_K, mercToLocal } from './i3s.mjs';

const R = 6378137, D2R = Math.PI / 180;
import { ORIGIN, M_LON, M_LAT } from './i3s.mjs';

export class Raster {
  constructor(x0, z0, w, h, cell) {
    Object.assign(this, { x0, z0, w, h, cell });
    this.d = new Float32Array(w * h).fill(NaN);
  }
  static forBox(minX, minZ, maxX, maxZ, cell) {
    return new Raster(minX, minZ, Math.ceil((maxX - minX) / cell), Math.ceil((maxZ - minZ) / cell), cell);
  }
  put(i, j, z) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const k = j * this.w + i;
    const v = this.d[k];
    if (!(v >= z)) this.d[k] = z;
  }
  get(i, j) { return i < 0 || j < 0 || i >= this.w || j >= this.h ? NaN : this.d[j * this.w + i]; }
  at(x, z) { return this.get(Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)); }
}

/** project mercator vertices (relative to obb centre) of a node geometry into local metres: Float64 [x,z,elev]* */
export function projectNode(node, geo) {
  const c = node.obb.center;
  const n = geo.n;
  const out = new Float64Array(n * 3);
  const p = geo.pos;
  for (let i = 0; i < n; i++) {
    const mx = c[0] + p[i * 3], my = c[1] + p[i * 3 + 1];
    const lon = mx / R / D2R;
    const lat = Math.atan(Math.sinh(my / R)) / D2R;
    out[i * 3] = (lon - ORIGIN.lon) * M_LON;
    out[i * 3 + 1] = -(lat - ORIGIN.lat) * M_LAT;
    out[i * 3 + 2] = c[2] + p[i * 3 + 2];
  }
  return out;
}

/** rasterise triangles (non-indexed unless idx given) into the raster, max-z. Walls are covered via edge sampling. */
export function rasterizeTriangles(rs, v, idx) {
  const { x0, z0, cell, w, h } = rs;
  const nt = idx ? idx.length / 3 : v.length / 9;
  const inv = 1 / cell;
  const maxX = x0 + w * cell, maxZ = z0 + h * cell;
  const edge = (ax, az, ay, bx, bz, by) => {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      rs.put(Math.floor((ax + (bx - ax) * t - x0) * inv), Math.floor((az + (bz - az) * t - z0) * inv), ay + (by - ay) * t);
    }
  };
  for (let t = 0; t < nt; t++) {
    const a = idx ? idx[t * 3] * 3 : t * 9, b = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3, c = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    const ax = v[a], az = v[a + 1], ay = v[a + 2], bx = v[b], bz = v[b + 1], by = v[b + 2], cx = v[c], cz = v[c + 1], cy = v[c + 2];
    const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx), minz = Math.min(az, bz, cz), maxz = Math.max(az, bz, cz);
    if (maxx < x0 || minx >= maxX || maxz < z0 || minz >= maxZ) continue;
    if (maxx - minx > 80 || maxz - minz > 80) continue; // stray long triangles (mesh borders)
    const i0 = Math.max(0, Math.floor((minx - x0) * inv)), i1 = Math.min(w - 1, Math.floor((maxx - x0) * inv));
    const j0 = Math.max(0, Math.floor((minz - z0) * inv)), j1 = Math.min(h - 1, Math.floor((maxz - z0) * inv));
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) > 1e-9) {
      const id = 1 / den;
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * cell;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) * id;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) * id;
          const l3 = 1 - l1 - l2;
          if (l1 >= -0.001 && l2 >= -0.001 && l3 >= -0.001) rs.put(i, j, l1 * ay + l2 * by + l3 * cy);
        }
      }
    }
    // always splat the border so thin/vertical triangles register
    edge(ax, az, ay, bx, bz, by);
    edge(bx, bz, by, cx, cz, cy);
    edge(cx, cz, cy, ax, az, ay);
  }
}

/**
 * Build a DSM for a local-metre box from the given (already opened) I3S layers.
 * perLayer: if true also returns the individual layer rasters.
 */
export async function buildDsm(layers, box, cell, spacing, { draco = false, perLayer = false, log = () => {} } = {}) {
  const [a, b] = [localToMerc(box.minX, box.maxZ), localToMerc(box.maxX, box.minZ)];
  const pad = 5 * MERC_K;
  const bbox = [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad];
  const comb = Raster.forBox(box.minX, box.minZ, box.maxX, box.maxZ, cell);
  const layerRs = {};
  const info = [];
  for (const L of layers) {
    const e = L.extent;
    if (e[2] < bbox[0] || e[0] > bbox[2] || e[3] < bbox[1] || e[1] > bbox[3]) continue;
    const nodes = await L.select(bbox, spacing);
    if (!nodes.length) continue;
    const rs = Raster.forBox(box.minX, box.minZ, box.maxX, box.maxZ, cell);
    let vc = 0;
    const geos = await Promise.all(nodes.map((n) => L.geometry(n, { draco }))); // network concurrency is capped inside getCached
    nodes.forEach((n, k) => {
      vc += geos[k].n;
      rasterizeTriangles(rs, projectNode(n, geos[k]), geos[k].idx);
    });
    let filled = 0;
    for (let k = 0; k < rs.d.length; k++) if (!Number.isNaN(rs.d[k])) { filled++; if (!(comb.d[k] >= rs.d[k])) comb.d[k] = rs.d[k]; }
    info.push({ layer: L.name, nodes: nodes.length, vertices: vc, filled: filled / rs.d.length });
    if (perLayer) layerRs[L.name] = rs;
  }
  return { raster: comb, info, layerRs };
}

// ---------------------------------------------------------------- polygon helpers (local metres)
export function pip(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function bboxOf(ring) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return { minX, minZ, maxX, maxZ };
}
export function distToRing(x, z, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}
const quant = (arr, q) => {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
export { quant };

/**
 * Height grid for one footprint from a raster: returns
 *  { ground, cells: Float32 heights above ground (NaN outside footprint / empty), x0,z0,cell,w,h, inside: Uint8, stats }
 * Ground = low-ish percentile (default 20 %) of mesh cells in a ring 1.5..5 m outside the footprint,
 * excluding cells that are much higher than the median of the ring (neighbouring buildings / trees).
 */
export function footprintGrid(raster, ring, { margin = 1, groundPct = 0.2, ringIn = 1.0, ringOut = 4.5 } = {}) {
  const bb = bboxOf(ring);
  const c = raster.cell;
  const gx0 = Math.floor((bb.minX - ringOut - raster.x0) / c), gz0 = Math.floor((bb.minZ - ringOut - raster.z0) / c);
  const gx1 = Math.ceil((bb.maxX + ringOut - raster.x0) / c), gz1 = Math.ceil((bb.maxZ + ringOut - raster.z0) / c);
  const ringVals = [];
  const w = Math.ceil((bb.maxX - bb.minX) / c) + 1, h = Math.ceil((bb.maxZ - bb.minZ) / c) + 1;
  const ox = raster.x0 + Math.floor((bb.minX - raster.x0) / c) * c, oz = raster.z0 + Math.floor((bb.minZ - raster.z0) / c) * c;
  const cells = new Float32Array(w * h).fill(NaN);
  const inside = new Uint8Array(w * h);
  for (let j = gz0; j <= gz1; j++) for (let i = gx0; i <= gx1; i++) {
    const v = raster.get(i, j);
    const x = raster.x0 + (i + 0.5) * c, z = raster.z0 + (j + 0.5) * c;
    const inP = pip(x, z, ring);
    if (inP) {
      const ci = Math.floor((x - ox) / c), cj = Math.floor((z - oz) / c);
      if (ci >= 0 && cj >= 0 && ci < w && cj < h) { inside[cj * w + ci] = 1; cells[cj * w + ci] = v; }
    } else if (!Number.isNaN(v)) {
      const d = distToRing(x, z, ring);
      if (d >= ringIn && d <= ringOut) ringVals.push(v);
    }
  }
  let ground = NaN, ringN = ringVals.length;
  if (ringN >= 4) {
    const med = quant(ringVals, 0.5);
    const lowish = ringVals.filter((v) => v < med + 2.5);
    ground = quant(lowish, groundPct);
  }
  return { ground, ringN, cells, inside, x0: ox, z0: oz, cell: c, w, h };
}

export function heightStats(fg) {
  const hs = [];
  let nIn = 0, nEmpty = 0;
  for (let k = 0; k < fg.cells.length; k++) if (fg.inside[k]) { nIn++; if (Number.isNaN(fg.cells[k])) nEmpty++; else hs.push(fg.cells[k] - fg.ground); }
  return { nIn, cover: nIn ? 1 - nEmpty / nIn : 0, max: hs.length ? Math.max(...hs) : NaN, p50: quant(hs, 0.5), p90: quant(hs, 0.9), p98: quant(hs, 0.98), p10: quant(hs, 0.1) };
}

/**
 * Heights above ground for the cells of a footprint grid: fills empty cells (mesh holes) from the nearest valid
 * neighbours (iterative 4-neighbour mean), clamps to >= 0. Cells outside the footprint stay NaN.
 */
export function heightAbove(fg) {
  const n = fg.cells.length;
  const hab = new Float32Array(n).fill(NaN);
  const have = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (fg.inside[k] && !Number.isNaN(fg.cells[k])) { hab[k] = Math.max(0, fg.cells[k] - fg.ground); have[k] = 1; }
  for (let it = 0; it < 8; it++) {
    let changed = 0;
    const nh = Float32Array.from(hab), nhave = Uint8Array.from(have);
    for (let j = 0; j < fg.h; j++) for (let i = 0; i < fg.w; i++) {
      const k = j * fg.w + i;
      if (!fg.inside[k] || have[k]) continue;
      let s = 0, c = 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (a >= 0 && b >= 0 && a < fg.w && b < fg.h && have[b * fg.w + a]) { s += hab[b * fg.w + a]; c++; }
      if (c) { nh[k] = s / c; nhave[k] = 1; changed++; }
    }
    hab.set(nh); have.set(nhave);
    if (!changed) break;
  }
  for (let k = 0; k < n; k++) if (fg.inside[k] && !have[k]) hab[k] = 0;
  return hab;
}
