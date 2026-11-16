// Ground: city map painted into canvas tiles, one plane per tile, all sharing one patched material type.
// Layers (bottom -> top): class raster (measured from an open orthophoto, optional) or OSM land cover (landuse / parks / hard
// surfaces), water, piers, pavements, kerb + carriageways, paths / rail / tram, bridge decks, building footprints.
// The close-up DetailLayer repaints the same data at ~19 px/m and adds lane markings + zebra crossings.
import * as THREE from 'three';
import { CFG } from './config.js';
import { patchGroundMaterial, holeUniforms } from './holeView.js';
import { cleanRing, bbox, pointInPoly, minBox } from './geo.js';
import { zoneOf } from './buildings.js';

const ROAD_ORDER = ['service', 'residential', 'tertiary', 'secondary', 'primary', 'motorway'];
const VEHICLE = new Set(ROAD_ORDER);

// ---- class raster (public/data/riga-ground.png): palette index -> game colour. Index 0 / unknown = paving.
export const GROUND_CLASS = { OTHER: 0, GRASS: 1, CANOPY: 2, ASPHALT: 3, PAVING: 4, GRAVEL: 5, WATER: 6, BALLAST: 7, SETT: 8, TRACK: 9, FOREST: 10 };
const CLASS_RGB = [
  [218, 213, 202], // 0 other -> light paving
  [166, 200, 124], // 1 lawn
  [108, 152, 92],  // 2 tree canopy
  [142, 141, 137], // 3 asphalt
  [219, 215, 204], // 4 light paving / granite
  [203, 184, 143], // 5 gravel / bare
  [95, 134, 163],  // 6 water (vectors are authoritative; only a fallback colour)
  [160, 152, 140], // 7 ballast
  [168, 158, 142], // 8 sett (patterned at runtime)
  [176, 98, 72],   // 9 running track (stadium)
  [52, 88, 55],    // 10 dense forest floor under conifer canopy (Mežaparks): dark, the pines are placed on these cells
];

/** Fetch + decode the class raster: { W, H, cls: Uint8Array } or null. Never throws. */
export async function loadGroundRaster(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/image\/png/.test(blob.type || 'image/png')) return null;
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const cls = new Uint8Array(c.width * c.height);
    for (let i = 0; i < cls.length; i++) cls[i] = Math.min(15, Math.round(px[i * 4] / 16));
    bmp.close && bmp.close();
    return { W: c.width, H: c.height, cls };
  } catch (e) { console.info('[ground] raster unavailable:', e.message); return null; }
}

function path(ctx, p, close) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  if (close) ctx.closePath();
}
/** Add a polygon with holes as sub-paths (fill with 'evenodd'). */
function polyPath(ctx, o) {
  ctx.beginPath();
  for (const r of [o._r, ...(o._h || [])]) {
    ctx.moveTo(r[0][0], r[0][1]);
    for (let i = 1; i < r.length; i++) ctx.lineTo(r[i][0], r[i][1]);
    ctx.closePath();
  }
}
function prepPoly(o) {
  if (o._h) return o;
  o._r = o._r || cleanRing(o.p);
  o._h = (o.h || []).map(cleanRing).filter((h) => h.length >= 3);
  return o;
}
function inRect(r, x0, z0, x1, z1) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const q of r) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b) b = q[1]; if (q[1] > d) d = q[1]; }
  return !(c < x0 || a > x1 || d < z0 || b > z1);
}

const BRIDGE_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'pedestrian', 'rail']);

/** Road/rail stretches over large water polygons (+ abutments), cached on data. Drawn as bridge decks after all roads. */
export function findBridges(data) {
  if (data._bridges) return data._bridges;
  const waters = [];
  for (const w of data.water) {
    const r = w._r || (w._r = cleanRing(w.p));
    if (r.length < 3) continue;
    const b = bbox(r);
    if ((b.x1 - b.x0) * (b.z1 - b.z0) < 3000) continue;
    waters.push({ r, b, h: (w.h || []).map(cleanRing).filter((h) => h.length >= 3) });
  }
  const inW = (x, z) => {
    for (const w of waters) {
      if (x < w.b.x0 || x > w.b.x1 || z < w.b.z0 || z > w.b.z1) continue;
      if (pointInPoly(x, z, w.r) && !w.h.some((h) => pointInPoly(x, z, h))) return true;
    }
    return false;
  };
  const out = [];
  for (const rd of data.roads) {
    if (!rd.p || rd.p.length < 2 || rd.tn || !BRIDGE_KINDS.has(rd.k)) continue;
    // sample every ~3 m
    const pts = [];
    for (let i = 0; i < rd.p.length - 1; i++) {
      const [x0, z0] = rd.p[i], [x1, z1] = rd.p[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    pts.push(rd.p[rd.p.length - 1]);
    const wet = pts.map((q) => inW(q[0], q[1]));
    let i = 0;
    while (i < pts.length) {
      if (!wet[i]) { i++; continue; }
      let j = i;
      while (j + 1 < pts.length && wet[j + 1]) j++;
      if (j - i >= 3) out.push({ p: pts.slice(Math.max(0, i - 2), Math.min(pts.length, j + 3)), w: rd.w || (rd.k === 'footway' ? 2.5 : rd.k === 'rail' ? 4 : 7), k: rd.k });
      i = j + 1;
    }
  }
  // OSM chops a bridge into several ways: join pieces of the same kind that meet end to end (abutment overlaps trimmed)
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) for (let j = 0; j < out.length && !merged; j++) {
      if (i === j) continue;
      const A = out[i], B = out[j];
      if (A.k !== B.k || A.p.length < 4 || B.p.length < 4) continue;
      const ae = A.p[A.p.length - 1];
      for (const rev of [false, true]) {
        const Bp = rev ? B.p.slice().reverse() : B.p;
        if (dist2(ae, Bp[0]) > 14) continue;
        // drop B's leading points that overlap A's tail
        let k = 0;
        while (k < Bp.length - 1 && dist2(Bp[k], ae) < 14 && k < 6) k++;
        // direction must continue (no U-turn between two different bridges)
        const a1 = A.p[A.p.length - 4], b1 = Bp[Math.min(Bp.length - 1, k + 3)];
        const dx1 = ae[0] - a1[0], dz1 = ae[1] - a1[1], dx2 = b1[0] - Bp[k][0], dz2 = b1[1] - Bp[k][1];
        const cos = (dx1 * dx2 + dz1 * dz2) / (Math.hypot(dx1, dz1) * Math.hypot(dx2, dz2) || 1);
        if (cos < 0.5) continue;
        A.p = A.p.concat(Bp.slice(k));
        out.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  data._bridges = out;
  return out;
}

function paintBridges(ctx, data, inTile) {
  const C = CFG.colors;
  ctx.lineCap = 'butt';
  const list = findBridges(data).filter((br) => inTile(br.p));
  const deck = (br) => (br.k === 'rail' ? '#6d6862' : br.k === 'footway' || br.k === 'pedestrian' ? '#efe6d2' : br.k === 'primary' || br.k === 'secondary' ? C.roadMajor : C.road);
  // pass 1: shadow on the water + dark outline
  for (const br of list) {
    path(ctx, br.p, false);
    ctx.strokeStyle = 'rgba(28,46,62,0.30)'; ctx.lineWidth = br.w + 7; ctx.stroke();
    ctx.strokeStyle = '#4f4b47'; ctx.lineWidth = br.w + 3.2; ctx.stroke();
  }
  // pass 2: join twin carriageways into one deck (fill the gap between near parallel bridges)
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j];
    if (A.k === 'rail' || B.k === 'rail' || A.k === 'footway' || B.k === 'footway') {
      if (A.k !== B.k) continue;
    }
    for (let n = 0; n < A.p.length; n += 2) {
      const [ax, az] = A.p[n];
      let best = null, bd = 28;
      for (const q of B.p) { const d = Math.hypot(q[0] - ax, q[1] - az); if (d < bd) { bd = d; best = q; } }
      if (!best || bd < 1.5) continue;
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(best[0], best[1]);
      ctx.strokeStyle = '#4f4b47'; ctx.lineWidth = 3.4; ctx.stroke();
      ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = 2.6; ctx.stroke();
    }
  }
  // pass 3: parapet + deck
  for (const br of list) {
    path(ctx, br.p, false);
    ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = br.w + 1.8; ctx.stroke();
    ctx.strokeStyle = deck(br); ctx.lineWidth = br.w; ctx.stroke();
  }
  ctx.lineCap = 'round';
}

let _cobble = null;
function cobblePattern(ctx) {
  if (_cobble) return _cobble;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8f8574'; g.fillRect(0, 0, 128, 128);
  const cols = ['#b9ad99', '#a99d8a', '#c6baa4', '#b3a58f', '#9f9482', '#c0b29b'];
  let n = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const ox = (j % 2) * 8 + (((i * 7 + j * 3) % 5) - 2), oy = ((i * 5 + j * 11) % 4) - 1.5;
    g.fillStyle = cols[(n++ * 5 + j) % cols.length];
    g.beginPath(); g.roundRect(i * 16 + ox + 1.2, j * 16 + oy + 1.2, 13.2, 13.2, 3.5); g.fill();
  }
  _cobble = ctx.createPattern(c, 'repeat');
  _cobble.setTransform(new DOMMatrix().scale(8 / 128));
  return _cobble;
}
const inOld = (p) => { const a = p[0], b = p[Math.floor(p.length / 2)]; return zoneOf(a[0], a[1]) === 'old' || zoneOf(b[0], b[1]) === 'old'; };
const COBBLE_KINDS = new Set(['service', 'residential', 'tertiary', 'pedestrian']);

// ---- fallback land cover colours (OSM only)
const AREA_FILL = {
  res: '#d6cebb', com: '#d4cebf', ind: '#c8bfae', con: '#cdb994', rail: '#a69e91', sand: '#e0cf9e', wd: '#6e9660',
  ply: '#c8b890', pit: '#9cc47c', sta: '#b3c78a', pkg: '#97958f', as: '#8e8d89', verge: '#a3c47d', sq: '#dad6cc',
  plat: '#cfcac0', island: '#b7b3a9', pier: '#c3b9a4', brg: '#8f8c86',
};
const SURF_COL = { a: null, c: '#a29f98', p: '#d6d0c2', s: null, g: '#cdbb92', d: '#c4aa82', r: '#a3c47d', n: '#e0cf9e', w: '#b99a72', t: '#b5967a', m: '#a8a8a8' };
const SIDEWALK_W = { motorway: 0, primary: 2.6, secondary: 2.4, tertiary: 2.2, residential: 2.0, service: 0 };

/** offset a polyline sideways (d > 0 = left of travel; x right, z down) */
function offsetPoly(p, d) {
  const n = p.length, out = [];
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], L = Math.hypot(dx, dz) || 1;
    seg.push([dz / L, -dx / L]);
  }
  for (let i = 0; i < n; i++) {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(n - 2, i)];
    let nx = a[0] + b[0], nz = a[1] + b[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const k = Math.min(2, 1 / Math.max(0.5, nx * a[0] + nz * a[1]));
    out.push([p[i][0] + nx * d * k, p[i][1] + nz * d * k]);
  }
  return out;
}

/** Per-data caches used by every paint call. */
function prep(data) {
  if (data._gp) return data._gp;
  const gp = { roads: [], byKind: {}, sidewalks: [], bridgeRoads: new Set() };
  // tunnels / underpasses (r.tn) are never painted on the surface
  for (const r of data.roads) { if (r.p && r.p.length > 1 && !r.tn) { r._bb = bbox(r.p); gp.roads.push(r); } }
  for (const k of [...ROAD_ORDER, 'pedestrian', 'footway', 'rail']) gp.byKind[k] = gp.roads.filter((r) => r.k === k);
  // walkway centre-lines that run over cobbled ground (Old Town squares, sett streets) are routing lines, not strips: the sett shows wall to wall
  if (data.groundRaster) {
    const R = data.groundRaster, bd = data.meta.bounds, rx = R.W / (bd.maxX - bd.minX), rz = R.H / (bd.maxZ - bd.minZ);
    for (const r of [...gp.byKind.footway, ...gp.byKind.pedestrian]) {
      let n = 0, sett = 0;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
        for (let t = 0; t <= m; t++) {
          const x = Math.floor((x0 + ((x1 - x0) * t) / m - bd.minX) * rx), z = Math.floor((z0 + ((z1 - z0) * t) / m - bd.minZ) * rz);
          if (x < 0 || z < 0 || x >= R.W || z >= R.H) continue;
          n++; if (R.cls[z * R.W + x] === GROUND_CLASS.SETT) sett++;
        }
      }
      r._sett = n > 0 && sett / n > 0.3;
    }
  }
  for (const pk of data.parks) prepPoly(pk);
  for (const a of data.areas || []) prepPoly(a);
  for (const w of data.water) prepPoly(w);
  for (const pr of data.piers || []) prepPoly(pr);
  // the class raster as a 1 px/m colour canvas (+ a mask canvas for sett)
  const R = data.groundRaster;
  if (R) {
    const mk = () => { const c = document.createElement('canvas'); c.width = R.W; c.height = R.H; return c; };
    const col = mk(), sett = mk();
    const cg = col.getContext('2d'), sg = sett.getContext('2d');
    const ci = cg.createImageData(R.W, R.H), si = sg.createImageData(R.W, R.H);
    let nSett = 0;
    for (let i = 0; i < R.cls.length; i++) {
      const c = CLASS_RGB[R.cls[i]] || CLASS_RGB[0];
      ci.data[i * 4] = c[0]; ci.data[i * 4 + 1] = c[1]; ci.data[i * 4 + 2] = c[2]; ci.data[i * 4 + 3] = 255;
      if (R.cls[i] === GROUND_CLASS.SETT) { si.data[i * 4 + 3] = 255; nSett++; }
    }
    cg.putImageData(ci, 0, 0); sg.putImageData(si, 0, 0);
    gp.rasterCanvas = col; gp.settCanvas = nSett ? sett : null;
  }
  data._gp = gp;
  return gp;
}

/** Close-up class window: per output pixel (4 px/m) the class with the largest triangular-kernel weight among the raster cells around it. */
function smoothRasterWindow(data, gp, view) {
  const R = data.groundRaster, b = data.meta.bounds;
  const resX = (b.maxX - b.minX) / R.W, resZ = (b.maxZ - b.minZ) / R.H;
  const K = 4, w4 = Math.ceil(view.w * K), h4 = Math.ceil(view.h * K);
  let d = gp._win;
  if (!d || d.w !== w4 || d.h !== h4) {
    const mk = () => { const c = document.createElement('canvas'); c.width = w4; c.height = h4; return c; };
    const colour = mk(), sett = mk();
    d = gp._win = { w: w4, h: h4, colour, sett, ci: colour.getContext('2d').createImageData(w4, h4), si: sett.getContext('2d').createImageData(w4, h4) };
  }
  const cd = d.ci.data, sd = d.si.data, wgt = new Float32Array(16);
  let nSett = 0;
  for (let v = 0; v < h4; v++) {
    const fy = (view.z0 + (v + 0.5) / K - b.minZ) / resZ - 0.5;
    const jc = Math.round(fy);
    for (let u = 0; u < w4; u++) {
      const fx = (view.x0 + (u + 0.5) / K - b.minX) / resX - 0.5;
      const ic = Math.round(fx);
      wgt.fill(0);
      let best = 0, bw = -1;
      for (let dj = -1; dj <= 1; dj++) {
        const j = jc + dj; if (j < 0 || j >= R.H) continue;
        for (let di = -1; di <= 1; di++) {
          const i = ic + di; if (i < 0 || i >= R.W) continue;
          const dist = Math.hypot(i - fx, j - fy) / 1.9;
          if (dist >= 1) continue;
          const wt = 1 - dist * dist; // quadratic kernel (radius 1.9 cells, 3x3 reads): rounds the 1 m stair-steps a little more than the old triangular one
          const c = R.cls[j * R.W + i];
          wgt[c] += wt;
          if (wgt[c] > bw) { bw = wgt[c]; best = c; }
        }
      }
      const col = CLASS_RGB[best] || CLASS_RGB[0], o = (v * w4 + u) * 4;
      cd[o] = col[0]; cd[o + 1] = col[1]; cd[o + 2] = col[2]; cd[o + 3] = 255;
      sd[o + 3] = best === GROUND_CLASS.SETT ? 255 : 0;
      if (sd[o + 3]) nSett++;
    }
  }
  d.colour.getContext('2d').putImageData(d.ci, 0, 0);
  d.sett.getContext('2d').putImageData(d.si, 0, 0);
  d.hasSett = nSett > 0;
  return d;
}

/**
 * Paint one world rectangle. view = { x0, z0, w, h, sc } (metres, px per metre); detail = close-up layer (markings, crossings).
 */
function paintTile(ctx, data, view, detail = false, scratch = null) {
  const C = CFG.colors;
  const gp = prep(data);
  const { x0, z0, w, h, sc } = view;
  const x1 = x0 + w, z1 = z0 + h;
  ctx.setTransform(sc, 0, 0, sc, -x0 * sc, -z0 * sc);
  const pad = 20;
  const inTile = (p) => { // cheap bbox reject
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const q of p) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b) b = q[1]; if (q[1] > d) d = q[1]; }
    return !(c < x0 - pad || a > x1 + pad || d < z0 - pad || b > z1 + pad);
  };
  const roadIn = (r) => !(r._bb.x1 < x0 - pad || r._bb.x0 > x1 + pad || r._bb.z1 < z0 - pad || r._bb.z0 > z1 + pad);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillStyle = C.paving;
  ctx.fillRect(x0 - 1, z0 - 1, w + 2, h + 2);

  const b = data.meta.bounds;
  const useRaster = !!data.groundRaster;
  if (useRaster) {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    let sett = gp.settCanvas;
    if (detail) { // close-up: smooth class boundaries (weighted vote over a 3x3 kernel at 4 px/m) instead of blurry bilinear colours
      const d = smoothRasterWindow(data, gp, view);
      ctx.drawImage(d.colour, x0, z0, w, h);
      sett = d.hasSett ? d.sett : null;
    } else {
      // base tiles: the 1 m class cells are stair-stepped when magnified; a ~0.9 m blur (no-op where ctx.filter is unsupported) rounds the corners
      if ('filter' in ctx) ctx.filter = `blur(${(0.9 * sc).toFixed(2)}px)`;
      ctx.drawImage(gp.rasterCanvas, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      if ('filter' in ctx) ctx.filter = 'none';
    }
    if (sett && scratch) {
      // cobbles only where the raster says "sett": pattern on a scratch canvas, masked, then composited
      const sg = scratch.getContext('2d');
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, scratch.width, scratch.height);
      sg.setTransform(sc, 0, 0, sc, -x0 * sc, -z0 * sc);
      sg.fillStyle = cobblePattern(sg); sg.fillRect(x0, z0, w, h);
      sg.globalCompositeOperation = 'destination-in';
      sg.imageSmoothingEnabled = true;
      if (detail) sg.drawImage(sett, x0, z0, w, h); else sg.drawImage(sett, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      sg.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(scratch, 0, 0); ctx.restore();
    }
  } else {
    // ---- fallback: OSM land cover only
    // Old Town: cobblestone paving (ellipse matching buildings.zoneOf 'old')
    ctx.save();
    ctx.beginPath(); ctx.ellipse(-400, 260, 520, 380, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = cobblePattern(ctx); ctx.fillRect(x0 - 1, z0 - 1, w + 2, h + 2);
    ctx.restore();
    const BASE = new Set(['res', 'com', 'ind', 'con', 'rail', 'sand', 'wd']);
    const fillArea = (a) => { polyPath(ctx, a); ctx.fillStyle = (a.s && SURF_COL[a.s]) || AREA_FILL[a.c] || C.paving; ctx.fill('evenodd'); };
    for (const a of data.areas || []) if (BASE.has(a.c) && inTile(a._r)) fillArea(a);
    for (const pk of data.parks) {
      if (pk._r.length < 3 || !inTile(pk._r)) continue;
      polyPath(ctx, pk);
      ctx.fillStyle = C.park; ctx.fill('evenodd');
    }
    // tree canopy: darker discs under mapped trees
    ctx.fillStyle = 'rgba(86,128,72,0.5)';
    for (const t of data.trees) {
      if (t[0] < x0 - 6 || t[0] > x1 + 6 || t[1] < z0 - 6 || t[1] > z1 + 6) continue;
      ctx.beginPath(); ctx.arc(t[0], t[1], 3.4, 0, 6.2832); ctx.fill();
    }
    // explicit hard surfaces ABOVE parks (a square mapped inside a park is paved)
    for (const a of data.areas || []) if (!BASE.has(a.c) && a.c !== 'pier' && a.c !== 'brg' && inTile(a._r)) fillArea(a);
  }

  // water (with islands)
  for (const wt of data.water) {
    if (wt._r.length < 3 || !inTile(wt._r)) continue;
    polyPath(ctx, wt);
    ctx.fillStyle = C.water; ctx.fill('evenodd');
    ctx.lineWidth = 3; ctx.strokeStyle = C.waterEdge; ctx.stroke();
    // quay edge
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#cfc6b3'; ctx.stroke();
  }
  // piers / quay decks (OSM piers + cadastre structures over water), after water, before roads
  for (const a of data.areas || []) if (a.c === 'pier' && inTile(a._r)) {
    polyPath(ctx, a); ctx.fillStyle = '#c3b9a4'; ctx.fill('evenodd');
    ctx.lineWidth = 0.7; ctx.strokeStyle = '#6f675b'; ctx.stroke();
  }
  for (const pr of data.piers || []) {
    if (pr._r.length < 3 || !inTile(pr._r)) continue;
    polyPath(ctx, pr);
    ctx.fillStyle = '#c3b9a4'; ctx.fill('evenodd');
    ctx.lineWidth = 0.7; ctx.strokeStyle = '#6f675b'; ctx.stroke();
  }
  const roads = gp.roads.filter(roadIn);
  const byKind = (k) => (gp.byKind[k] || []).filter(roadIn);
  // pavements first (all of them), so junctions merge cleanly; carriageways go on top afterwards
  ctx.lineCap = 'butt';
  ctx.strokeStyle = C.walk;
  for (const k of ROAD_ORDER) {
    const sw = SIDEWALK_W[k];
    if (!sw) continue;
    for (const r of byKind(k)) {
      if (r.br || r.sw === 0) continue;
      if (COBBLE_KINDS.has(k) && (r.s === 's' || (!r.s && inOld(r.p)))) continue; // cobbled street: sett wall to wall, no pavement strip
      const side = r.sw === 2 ? [1] : r.sw === 3 ? [-1] : [1, -1];
      if (side.length === 2) { path(ctx, r.p, false); ctx.lineWidth = (r.w || 6) + sw * 2; ctx.stroke(); }
      else { path(ctx, offsetPoly(r.p, side[0] * ((r.w || 6) / 2 + sw / 2 - 0.1)), false); ctx.lineWidth = sw; ctx.stroke(); }
    }
  }
  ctx.lineCap = 'round';
  // pedestrian streets + footways / paths / cycleways / steps. They go UNDER the carriageways: carriageway asphalt always wins, a walkway
  // is only visible on a road as a marked crossing (zebra, painted below). Walkways on bridges (overpasses) are painted after the roads.
  const walkways = (over) => {
    for (const r of byKind('pedestrian')) {
      if (!!r.br !== over || r._sett || r.s === 's' || (!r.s && inOld(r.p))) continue; // cobbled streets: the sett itself
      path(ctx, r.p, false); ctx.strokeStyle = '#cdbf9f'; ctx.lineWidth = (r.w || 5) + 1; ctx.stroke();
      ctx.strokeStyle = (r.s && SURF_COL[r.s]) || '#e4dcc9'; ctx.lineWidth = r.w || 5; ctx.stroke();
    }
    for (const r of byKind('footway')) {
      if (!!r.br !== over || r.f === 'c' || r._sett) continue; // crossings are zebras, not strips
      if (r.s === 's') { path(ctx, r.p, false); ctx.strokeStyle = cobblePattern(ctx); ctx.lineWidth = Math.max(1.4, r.w || 2); ctx.stroke(); continue; }
      let col = '#e6dfce';
      if (r.f === 'y') col = '#c9a898';
      else if (r.f === 's') col = C.walk;
      else if (r.s === 'g' || r.s === 'd' || r.s === 'n' || (!r.s && r.f === 'p')) col = '#cdbb92';
      else if (r.s && SURF_COL[r.s]) col = SURF_COL[r.s];
      path(ctx, r.p, false); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.4, r.w || 2); ctx.stroke();
      if (r.f === 't') { ctx.setLineDash([0.35, 0.35]); ctx.strokeStyle = '#a89f8f'; ctx.lineWidth = Math.max(1.4, r.w || 2); ctx.lineCap = 'butt'; ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'round'; }
    }
  };
  walkways(false);
  // kerb line (slightly darker light-stone edge) then asphalt
  const surfAsphalt = (r) => !r.s || r.s === 'a' || r.s === 'c';
  for (const k of ROAD_ORDER) {
    for (const r of byKind(k)) {
      if (r.br && k !== 'service') { /* decks are painted with parapets later */ }
      path(ctx, r.p, false); ctx.strokeStyle = '#c4bdae'; ctx.lineWidth = (r.w || 6) + 0.7; ctx.stroke();
    }
  }
  for (const k of ROAD_ORDER) {
    const major = k === 'primary' || k === 'motorway' || k === 'secondary';
    for (const r of byKind(k)) {
      const sf = r.s && !surfAsphalt(r) ? SURF_COL[r.s] : null;
      ctx.strokeStyle = sf || (r.s === 'c' ? SURF_COL.c : major ? C.roadMajor : C.road);
      path(ctx, r.p, false); ctx.lineWidth = r.w || 6; ctx.stroke();
    }
  }
  // cobbled streets (OSM surface=sett anywhere; otherwise the Old Town default)
  for (const k of COBBLE_KINDS) for (const r of byKind(k)) {
    const sett = r.s === 's' || (!r.s && inOld(r.p));
    if (!sett) continue;
    path(ctx, r.p, false); ctx.strokeStyle = cobblePattern(ctx); ctx.lineWidth = (r.w || (k === 'pedestrian' ? 5 : 6)) + 0.4; ctx.stroke();
  }
  if (detail) paintLaneMarks(ctx, gp, roadIn);
  paintZebras(ctx, data, view, detail);
  walkways(true);
  // rail: ballast bed + sleepers + two thin rails
  for (const r of byKind('rail')) {
    path(ctx, r.p, false); ctx.strokeStyle = '#a49c8e'; ctx.lineWidth = Math.max(3.2, r.w || 4); ctx.stroke();
  }
  for (const r of byKind('rail')) {
    path(ctx, r.p, false); ctx.strokeStyle = C.rail; ctx.lineWidth = 0.35; ctx.setLineDash([]); ctx.stroke();
  }
  // tram tracks: sleeper bed + two thin rails (dark outer stroke, lighter inner stroke leaves two dark lines)
  for (const tw of data.tramways || []) {
    if (!tw.p || tw.p.length < 2 || !inTile(tw.p)) continue;
    path(ctx, tw.p, false);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#a49e94'; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.strokeStyle = '#3f3c39'; ctx.lineWidth = 1.62; ctx.stroke();
    ctx.strokeStyle = '#b3ada3'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineCap = 'round';
  }
  // OSM bridge-structure polygons over water (deck), under the bridge roads
  for (const a of data.areas || []) if (a.c === 'brg' && inTile(a._r)) { polyPath(ctx, a); ctx.fillStyle = '#8f8c86'; ctx.fill('evenodd'); }
  paintBridges(ctx, data, inTile);
  if (detail) paintBridgeMarks(ctx, data);
  // building footprints (what is left when a building is swallowed)
  ctx.fillStyle = C.footprint;
  for (const bd of data.buildings) {
    const r = bd._r || (bd._r = cleanRing(bd.p || []));
    if (r.length < 3 || !inTile(r)) continue;
    path(ctx, r, true); ctx.fill();
  }
}

const MARK = 'rgba(244,241,230,0.92)';
/** Lane markings (close-up layer only). */
function paintLaneMarks(ctx, gp, roadIn) {
  ctx.lineCap = 'butt';
  for (const k of ['primary', 'secondary', 'tertiary', 'residential']) {
    for (const r of gp.byKind[k]) {
      if (!roadIn(r) || (r.w || 6) < 5.2 || r.br) continue;
      const lanes = r.l || Math.max(1, Math.round(((r.w || 6) - 0.6) / 3.4));
      const w = r.w || 6;
      if (r.ow) {
        // one-way: dashed lines between lanes
        for (let i = 1; i < lanes; i++) {
          path(ctx, offsetPoly(r.p, -w / 2 + (w * i) / lanes), false);
          ctx.setLineDash([3, 5]); ctx.strokeStyle = MARK; ctx.lineWidth = 0.14; ctx.stroke();
        }
      } else if (lanes <= 2) {
        path(ctx, r.p, false);
        ctx.setLineDash(k === 'primary' || k === 'secondary' ? [5, 7] : [3, 6]); ctx.strokeStyle = MARK; ctx.lineWidth = 0.14; ctx.stroke();
      } else {
        path(ctx, r.p, false); ctx.setLineDash([]); ctx.strokeStyle = MARK; ctx.lineWidth = 0.16; ctx.stroke();
        const per = Math.max(1, Math.floor(lanes / 2));
        for (let i = 1; i < per; i++) for (const sg of [-1, 1]) {
          path(ctx, offsetPoly(r.p, sg * (w / 2) * (i / per)), false);
          ctx.setLineDash([3, 5]); ctx.strokeStyle = MARK; ctx.lineWidth = 0.14; ctx.stroke();
        }
      }
      if (k === 'primary' || k === 'secondary') {
        for (const sg of [-1, 1]) { path(ctx, offsetPoly(r.p, sg * (w / 2 - 0.3)), false); ctx.setLineDash([]); ctx.strokeStyle = 'rgba(244,241,230,0.7)'; ctx.lineWidth = 0.12; ctx.stroke(); }
      }
    }
  }
  ctx.setLineDash([]);
}
/** Dashed centre line on the main bridge spans (close-up layer only; after the decks). */
function paintBridgeMarks(ctx, data) {
  ctx.lineCap = 'butt';
  for (const br of findBridges(data)) {
    if (br.k !== 'primary' && br.k !== 'secondary') continue;
    path(ctx, br.p, false); ctx.setLineDash([4, 6]); ctx.strokeStyle = MARK; ctx.lineWidth = 0.14; ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
}
/**
 * Marked pedestrian crossings (OSM highway=crossing nodes / footway=crossing ways) as zebra bars on the asphalt. Base tiles and the close-up
 * layer paint the same bars (the base ones slightly translucent so they read as stripes at ~2.5 px/m instead of aliasing).
 */
function paintZebras(ctx, data, view, detail) {
  const { x0, z0, w, h } = view;
  ctx.lineCap = 'butt';
  ctx.fillStyle = detail ? MARK : 'rgba(244,241,230,0.8)';
  for (const c of data.crossings || []) {
    if (!c[4] || c[0] < x0 - 12 || c[0] > x0 + w + 12 || c[1] < z0 - 12 || c[1] > z0 + h + 12) continue;
    const len = Math.max(4, c[3]);
    ctx.save();
    ctx.translate(c[0], c[1]); ctx.rotate((c[2] * Math.PI) / 180);
    // zebra: 3 m long bars (running along the road) every 0.9 m across the carriageway
    for (let s = -len / 2 + 0.7; s <= len / 2 - 0.6; s += 0.9) ctx.fillRect(s - 0.25, -1.5, 0.5, 3);
    ctx.restore();
  }
  ctx.lineCap = 'round';
}

/** Tile layout for a bounds rectangle: ~CFG.ground.tileM tiles at a uniform px/m (density by quality tier). */
export function groundLayout(bounds, tier = 2) {
  const m = CFG.ground.margin, D = CFG.ground.pxPerM[tier];
  const minX = bounds.minX - m, minZ = bounds.minZ - m;
  const W = bounds.maxX - bounds.minX + 2 * m, H = bounds.maxZ - bounds.minZ + 2 * m;
  const cols = Math.max(1, Math.round(W / CFG.ground.tileM)), rows = Math.max(1, Math.round(H / CFG.ground.tileM));
  const tw = W / cols, th = H / rows;
  return { minX, minZ, W, H, cols, rows, tw, th, pw: Math.max(8, Math.round(tw * D)), ph: Math.max(8, Math.round(th * D)), D };
}

/** A tile that is nothing but open river water (no land, structure, road, bridge): a flat colour is enough. */
function plainWater(data, gp, x0, z0, w, h) {
  const N = 6;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = x0 + (w * i) / N, z = z0 + (h * j) / N;
    let wet = false;
    for (const wt of data.water) {
      const b = wt._b || (wt._b = bbox(wt._r));
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (pointInPoly(x, z, wt._r) && !wt._h.some((hh) => pointInPoly(x, z, hh))) { wet = true; break; }
    }
    if (!wet) return false;
  }
  const hit = (b) => !(b.x1 < x0 - 30 || b.x0 > x0 + w + 30 || b.z1 < z0 - 30 || b.z0 > z0 + h + 30);
  for (const r of gp.roads) if (hit(r._bb)) return false;
  for (const l of [data.piers || [], (data.areas || []).filter((a) => a.c === 'pier' || a.c === 'brg' || a.c === 'island'), data.tramways || []]) for (const o of l) { const p = o.p; if (p && hit(bbox(p))) return false; }
  for (const bd of data.buildings) { const p = bd.p; if (p && p.length && hit(bbox(p))) return false; }
  return true;
}

/**
 * "The city continues": beyond the playable box the old plain tan slab is replaced by a mirrored, hazed copy of the map's own edge (ground class raster reflected across each
 * edge, 700 m deep, low resolution, desaturated and lightened with distance, a pale band + line at the boundary as the "map ends here" cue) plus simple non-swallowable building
 * mass (the mirrored footprints as flat grey-beige boxes, ONE merged static mesh, no shadows, never part of world.objects / the placement files). Texture: 16 / 6 / 4 m per pixel on
 * low / medium / high (<= ~7 MB on high), buildings on medium and high only (<= ~130 k triangles). Water and forest continue because they are mirrored.
 */
function buildSkirt(data, L, tier) {
  const R = data.groundRaster, b = data.meta.bounds;
  if (!R) return null;
  const M = 720, S = [16, 6, 4][tier] ?? 4;
  const X0 = L.minX - M, Z0 = L.minZ - M, TW = L.W + 2 * M, TH = L.H + 2 * M;
  const pw = Math.ceil(TW / S), ph = Math.ceil(TH / S);
  const refl = (t, lo, hi) => { const w = hi - lo, u = ((t - lo) % (2 * w) + 2 * w) % (2 * w); return lo + (u <= w ? u : 2 * w - u); };
  const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
  const cx = cv.getContext('2d'), img = cx.createImageData(pw, ph), d = img.data;
  const rx = R.W / (b.maxX - b.minX), rz = R.H / (b.maxZ - b.minZ), HAZE = [212, 207, 192];
  for (let j = 0; j < ph; j++) {
    const z = Z0 + (j + 0.5) * S, zm = refl(z, b.minZ, b.maxZ), dz = Math.max(L.minZ - z, z - (L.minZ + L.H), 0);
    for (let i = 0; i < pw; i++) {
      const x = X0 + (i + 0.5) * S, xm = refl(x, b.minX, b.maxX), dx = Math.max(L.minX - x, x - (L.minX + L.W), 0);
      const ii = Math.min(R.W - 1, Math.max(0, Math.floor((xm - b.minX) * rx))), jj = Math.min(R.H - 1, Math.max(0, Math.floor((zm - b.minZ) * rz)));
      const c = CLASS_RGB[R.cls[jj * R.W + ii]] || CLASS_RGB[0], dist = Math.hypot(dx, dz), f = Math.min(1, dist / M);
      const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], sat = 0.62 - 0.25 * f, haze = 0.2 + 0.45 * f;
      let r = lum + (c[0] - lum) * sat, g = lum + (c[1] - lum) * sat, bl = lum + (c[2] - lum) * sat;
      r += (HAZE[0] - r) * haze; g += (HAZE[1] - g) * haze; bl += (HAZE[2] - bl) * haze;
      const cue = dist < 46 ? (1 - dist / 46) * 0.2 + (dist < 2.5 ? 0.35 : 0) : 0; // pale band + line at the boundary
      r += (255 - r) * cue; g += (255 - g) * cue; bl += (255 - bl) * cue;
      const o = (j * pw + i) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 2; tex.onUpdate = () => { tex.onUpdate = null; cv.width = cv.height = 1; };
  const hw = L.W / 2, hh = L.H / 2, ox = L.minX + hw, oz = L.minZ + hh;
  const shape = new THREE.Shape();
  shape.moveTo(X0 - ox, Z0 - oz); shape.lineTo(X0 + TW - ox, Z0 - oz); shape.lineTo(X0 + TW - ox, Z0 + TH - oz); shape.lineTo(X0 - ox, Z0 + TH - oz); shape.closePath();
  const hole = new THREE.Path(); hole.moveTo(-hw, -hh); hole.lineTo(-hw, hh); hole.lineTo(hw, hh); hole.lineTo(hw, -hh); hole.closePath(); shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) { uv[k * 2] = (pos.getX(k) + ox - X0) / TW; uv[k * 2 + 1] = 1 - (pos.getZ(k) + oz - Z0) / TH; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = patchGroundMaterial(new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { detailMap: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(ox, 0.06, oz); mesh.receiveShadow = false;
  const grp = new THREE.Group(); grp.add(mesh); let tris = 0;
  if (tier >= 1) { // mirrored building mass
    const P = [], N = [], C = [], flips = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    const inSkirt = (x, z) => x > X0 + 20 && x < X0 + TW - 20 && z > Z0 + 20 && z < Z0 + TH - 20 && !(x > L.minX && x < L.minX + L.W && z > L.minZ && z < L.minZ + L.H);
    for (const mx of [-1, 0, 1]) for (const mz of [-1, 0, 1]) {
      if (!mx && !mz) continue;
      const fx = (x) => (mx < 0 ? 2 * b.minX - x : mx > 0 ? 2 * b.maxX - x : x), fz = (z) => (mz < 0 ? 2 * b.minZ - z : mz > 0 ? 2 * b.maxZ - z : z);
      for (const bd of data.buildings) {
        const ring = bd._r || (bd._r = cleanRing(bd.p || [])); if (ring.length < 3) continue;
        const c0 = ring[0], cxm = fx(c0[0]), czm = fz(c0[1]); if (!inSkirt(cxm, czm)) continue;
        if (mx && Math.abs(c0[0] - (mx < 0 ? b.minX : b.maxX)) > M) continue; if (mz && Math.abs(c0[1] - (mz < 0 ? b.minZ : b.maxZ)) > M) continue;
        const mb = minBox(ring); if (!mb.ux || mb.L * mb.W < 50) continue;
        const h = Math.max(5, Math.min(34, (bd.h || 9) * 0.9));
        // box centre / axes in the mirrored frame (reflection flips an axis sign only; the box is symmetric, so rebuild from reflected centre)
        const ccx = fx(mb.ux * mb.cu - mb.uz * mb.cv), ccz = fz(mb.uz * mb.cu + mb.ux * mb.cv);
        const ux = (mx ? -1 : 1) * mb.ux, uz = (mz ? -1 : 1) * mb.uz, vx = -uz, vz = ux, hl = Math.max(2, mb.L / 2), hwd = Math.max(2, mb.W / 2);
        const sh = 0.93 + ((Math.abs(Math.floor(c0[0] * 7 + c0[1] * 13)) % 9) / 9) * 0.1, col = [0.80 * sh, 0.77 * sh, 0.71 * sh];
        const corner = (a, bb, y) => [ccx + ux * a * hl + vx * bb * hwd, y, ccz + uz * a * hl + vz * bb * hwd];
        const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const tri = (p, q, r, n, k) => {
          const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2], bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
          if ((ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0) { const t = q; q = r; r = t; } // wind counter-clockwise seen from outside
          for (const v of [p, q, r]) { P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); C.push(col[0] * k, col[1] * k, col[2] * k); } tris++; };
        for (let k = 0; k < 4; k++) {
          const [a0, b0] = cs[k], [a1, b1] = cs[(k + 1) % 4], p0 = corner(a0, b0, 0), p1 = corner(a1, b1, 0), q0 = corner(a0, b0, h), q1 = corner(a1, b1, h);
          const nx = (p1[2] - p0[2]), nz = -(p1[0] - p0[0]), nl = Math.hypot(nx, nz) || 1, n = [nx / nl, 0, nz / nl], kk = 0.86 + 0.14 * Math.abs(n[0]);
          tri(p0, p1, q1, n, kk); tri(p0, q1, q0, n, kk);
        }
        const t0 = corner(-1, -1, h), t1 = corner(1, -1, h), t2 = corner(1, 1, h), t3 = corner(-1, 1, h);
        tri(t0, t1, t2, [0, 1, 0], 1.08); tri(t0, t2, t3, [0, 1, 0], 1.08);
      }
    }
    if (P.length) {
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g2.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      bmat.onBeforeCompile = (shader) => { // theme.js chains its ground night / snow code onto every material under the ground group: it reads vWXZ
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;');
      };
      bmat.customProgramCacheKey = () => 'skirt-bld';
      const bm = new THREE.Mesh(g2, bmat);
      bm.castShadow = false; bm.receiveShadow = false; bm.frustumCulled = true; grp.add(bm);
    }
  }
  grp.userData.stats = { skirtTexMB: Math.round(pw * ph * 4 * 1.33 / 1048576 * 10) / 10, skirtTris: tris * 1, px: [pw, ph] };
  return grp;
}

export function createGround(data, tier = 2) {
  const { bounds } = data.meta;
  const L = groundLayout(bounds, tier);
  const gp = prep(data);
  const group = new THREE.Group();
  const maxAniso = tier === 0 ? 4 : 8;
  const planeGeo = new THREE.PlaneGeometry(L.tw, L.th).rotateX(-Math.PI / 2);
  const scratch = document.createElement('canvas');
  scratch.width = L.pw; scratch.height = L.ph;
  let texBytes = 0, flat = 0;
  const t0 = performance.now();
  for (let i = 0; i < L.cols; i++) {
    for (let j = 0; j < L.rows; j++) {
      const x0 = L.minX + i * L.tw, z0 = L.minZ + j * L.th;
      const canvas = document.createElement('canvas');
      const isFlat = plainWater(data, gp, x0, z0, L.tw, L.th);
      if (isFlat) {
        canvas.width = canvas.height = 8; flat++;
        const c = canvas.getContext('2d'); c.fillStyle = CFG.colors.water; c.fillRect(0, 0, 8, 8);
        texBytes += 8 * 8 * 4 * 1.34;
      } else {
        canvas.width = L.pw; canvas.height = L.ph;
        const ctx = canvas.getContext('2d');
        paintTile(ctx, data, { x0, z0, w: L.tw, h: L.th, sc: L.D }, false, scratch);
        texBytes += L.pw * L.ph * 4 * 1.34;
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      // release the CPU-side pixel copy and the 2D context once uploaded (the GPU keeps the texture)
      tex.onUpdate = () => { tex.onUpdate = null; canvas.width = canvas.height = 1; };
      const mat = patchGroundMaterial(new THREE.MeshLambertMaterial({ map: tex }), { detailMap: true });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.set(x0 + L.tw / 2, 0, z0 + L.th / 2);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  scratch.width = scratch.height = 1;
  if (data._gp) { data._gp.rasterCanvas = null; data._gp.settCanvas = null; } // the close-up layer works from the class array
  // outer frame (no texture), same hole-patched shader family
  const big = 30000, hw = L.W / 2, hh = L.H / 2, cx = L.minX + hw, cz = L.minZ + hh;
  const shape = new THREE.Shape();
  shape.moveTo(-big, -big); shape.lineTo(big, -big); shape.lineTo(big, big); shape.lineTo(-big, big); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-hw, -hh); hole.lineTo(-hw, hh); hole.lineTo(hw, hh); hole.lineTo(hw, -hh); hole.closePath();
  shape.holes.push(hole);
  const frameGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const frameMat = patchGroundMaterial(new THREE.MeshLambertMaterial({ color: 0xcdbf9f, side: THREE.DoubleSide }), { detail: false });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(cx, 0, cz);
  frame.receiveShadow = true;
  group.add(frame);
  { const sk = buildSkirt(data, L, tier); if (sk) { group.add(sk); group.userData.skirt = sk.userData.stats; } }
  group.userData.extent = { minX: L.minX, minZ: L.minZ, size: Math.max(L.W, L.H), W: L.W, H: L.H };
  const detPx = CFG.ground.detailPx[tier];
  group.userData.detail = new DetailLayer(data, detPx);
  const detMB = detPx * detPx * 4 * 1.34 / 1048576;
  group.userData.stats = { tier, tiles: L.cols * L.rows, flatWaterTiles: flat, tilePx: [L.pw, L.ph], pxPerM: L.D, texMB: Math.round(texBytes / 1048576), detailMB: Math.round(detMB), buildMs: Math.round(performance.now() - t0), raster: !!data.groundRaster };
  return group;
}

/**
 * Close-up detail layer: a 2048 px canvas covering a ~110 m window around the player, repainted from the same
 * map data at ~19 px/m (the base map is only ~3 px/m). Blended over the base in the ground shader.
 */
export class DetailLayer {
  constructor(data, px = 2048) {
    this.data = data;
    this.size = 110;
    this.px = px;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.px;
    this.ctx = this.canvas.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.scratch.height = this.px;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.cx = NaN; this.cz = NaN;
    holeUniforms.uDetMap.value = this.tex;
  }

  /** Call every frame with focus and camera distance. */
  update(x, z, dist) {
    const on = dist < 85;
    const fade = on ? 1 - Math.max(0, (dist - 55) / 30) : 0;
    holeUniforms.uDetRect.value.w = fade;
    if (!on) return;
    if (this.cx === this.cx && Math.hypot(x - this.cx, z - this.cz) <= 22) return; // NaN = never painted
    this.cx = x; this.cz = z;
    const x0 = x - this.size / 2, z0 = z - this.size / 2;
    paintTile(this.ctx, this.data, { x0, z0, w: this.size, h: this.size, sc: this.px / this.size }, true, this.scratch);
    this.tex.needsUpdate = true;
    holeUniforms.uDetRect.value.set(x0, z0, this.size, fade);
  }
}
