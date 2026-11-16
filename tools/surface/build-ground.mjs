#!/usr/bin/env node
// Builds public/data/riga-ground.png: a palette-indexed ground-cover class raster (1 m/px over meta.bounds).
// Inputs: public/data/riga.json (vectors: buildings, water, roads, parks, areas) + the cached LGIA orthophoto mosaic (fetch-ortho.mjs),
// used purely as a MEASURING source (colour -> grass / canopy / asphalt / paving / gravel). The imagery is never shipped.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE, BOUNDS, CT, DATA_DIR, MAP_SLUG } from './common.mjs';
import { loadOrtho, sampleLocal } from './raw.mjs';
import { Grid, fillPolys, strokeLine, nearestFill, modeFilter, removeSpecks, reclassComponents, encodePng } from './raster.mjs';

export const K = { OTHER: 0, GRASS: 1, CANOPY: 2, ASPHALT: 3, PAVING: 4, GRAVEL: 5, WATER: 6, BALLAST: 7, SETT: 8, SHADOW: 14, UNK: 15 };
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1) + 's', ...a);

const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'riga.json'), 'utf8'));
const RES = 1;
const W = Math.round((BOUNDS.maxX - BOUNDS.minX) / RES), H = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / RES);
const g = new Grid(BOUNDS.minX, BOUNDS.minZ, W, H, RES);
const N = W * H;

// ---- ortho sampled in the local frame at 0.5 m (cached as a raw file)
const f05 = path.join(CACHE, 'ortho', `local05${CT}.bin`);
let S;
{
  const W2 = W * 2, H2 = H * 2;
  if (fs.existsSync(f05) && fs.statSync(f05).size === W2 * H2 * 3) {
    const b = fs.readFileSync(f05), n = W2 * H2;
    S = { W: W2, H: H2, r: b.subarray(0, n), g: b.subarray(n, 2 * n), b: b.subarray(2 * n) };
  } else {
    S = sampleLocal(loadOrtho(), 0.5);
    fs.writeFileSync(f05, Buffer.concat([S.r, S.g, S.b]));
  }
}
log('ortho sampled', S.W, S.H);

// ---- vector masks (1 m)
const ringsOf = (o) => [o.p, ...(o.h || [])];
const M = { bld: new Uint8Array(N), water: new Uint8Array(N), road: new Uint8Array(N), park: new Uint8Array(N), sq: new Uint8Array(N), pkg: new Uint8Array(N), rail: new Uint8Array(N), wd: new Uint8Array(N), ped: new Uint8Array(N), pier: new Uint8Array(N), brg: new Uint8Array(N), ind: new Uint8Array(N), con: new Uint8Array(N), sand: new Uint8Array(N), pit: new Uint8Array(N), asph: new Uint8Array(N) };
for (const b of data.buildings) fillPolys(g, M.bld, [b.p], 1);
for (const w of data.water) fillPolys(g, M.water, ringsOf(w), 1);
for (const p of data.piers || []) fillPolys(g, M.pier, [p.p], 1);
for (const p of data.parks) fillPolys(g, M.park, ringsOf(p), 1);
for (const a of data.areas || []) {
  const m = { sq: M.sq, pkg: M.pkg, rail: M.rail, wd: M.wd, pier: M.pier, brg: M.brg, ind: M.ind, con: M.con, sand: M.sand, pit: M.pit, as: M.asph, plat: M.sq }[a.c];
  if (m) fillPolys(g, m, ringsOf(a), 1);
}
const bridgeSet = new Set();
for (const r of data.roads) {
  if (!r.p || r.tn) continue; // tunnels / underpasses are not surface
  if (['motorway', 'primary', 'secondary', 'tertiary', 'residential', 'service'].includes(r.k) && !r.br) strokeLine(g, M.road, r.p, Math.max(1.2, (r.w || 6) / 2), 1);
  else if (r.k === 'pedestrian') strokeLine(g, M.ped, r.p, Math.max(1.2, (r.w || 5) / 2), 1);
  else if (r.k === 'rail') strokeLine(g, M.rail, r.p, 3, 1);
}
log('masks done');

// ---- calibration statistics (STATS=1)
const Y = (i) => 0.299 * S.r[i] + 0.587 * S.g[i] + 0.114 * S.b[i];
function cellStats(mask, sel) {
  const ys = [], cs = [];
  for (let j = 0; j < H; j += 2) for (let i = 0; i < W; i += 2) {
    const k = j * W + i;
    if (!mask[k] || !sel(k)) continue;
    const o = (2 * j) * S.W + 2 * i;
    ys.push(Y(o)); cs.push([S.r[o], S.g[o], S.b[o]]);
  }
  ys.sort((a, b) => a - b);
  const pct = (p) => Math.round(ys[Math.floor(ys.length * p)] || 0);
  const mean = [0, 1, 2].map((c) => Math.round(cs.reduce((s, v) => s + v[c], 0) / Math.max(1, cs.length)));
  return `n=${ys.length} Y p10/50/90=${pct(0.1)}/${pct(0.5)}/${pct(0.9)} mean=${mean}`;
}
if (process.env.STATS) {
  const clean = (k) => !M.bld[k] && !M.water[k];
  console.log('road corridor   ', cellStats(M.road, (k) => clean(k) && !M.park[k]));
  console.log('sq (paved) area ', cellStats(M.sq, (k) => clean(k) && !M.road[k] && !M.park[k]));
  console.log('pedestrian ways ', cellStats(M.ped, (k) => clean(k)));
  console.log('park interior   ', cellStats(M.park, (k) => clean(k) && !M.road[k] && !M.sq[k]));
  console.log('parking         ', cellStats(M.pkg, (k) => clean(k) && !M.road[k]));
  console.log('rail landuse    ', cellStats(M.rail, (k) => clean(k) && !M.road[k]));
  console.log('buildings       ', cellStats(M.bld, () => true));
  console.log('water           ', cellStats(M.water, () => true));
  const feat = (mask, sel, name) => {
    const ex = [], hu = [], yy = [];
    for (let j = 0; j < H; j += 2) for (let i = 0; i < W; i += 2) {
      const k = j * W + i; if (!mask[k] || !sel(k)) continue;
      const o = 2 * j * S.W + 2 * i, r = S.r[o], gg = S.g[o], b = S.b[o];
      ex.push(2 * gg - r - b); yy.push(Y(o));
    }
    const p = (a, q) => { a.sort((x, y) => x - y); return Math.round(a[Math.floor(a.length * q)]); };
    console.log(name.padEnd(16), 'exg p5/25/50/75/95', [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => p(ex, q)).join('/'));
  };
  feat(M.road, (k) => clean(k) && !M.park[k], 'road');
  feat(M.sq, (k) => clean(k) && !M.road[k] && !M.park[k], 'sq');
  feat(M.park, (k) => clean(k) && !M.road[k] && !M.sq[k], 'park');
  feat(M.rail, (k) => clean(k) && !M.road[k], 'rail');
  process.exit(0);
}

// =============================================================== classification
const P = {
  exg: Number(process.env.EXG || 10),        // vegetation: 2g - r - b
  canopyY: Number(process.env.CANOPY_Y || 86), // vegetation darker than this (mean Y of the 1 m cell) = tree canopy
  shadowY: Number(process.env.SHADOW_Y || 74), // grey darker than this = shadow (filled from neighbours)
  warm: 13,                                    // r - b for gravel / bare earth
  paveY: Number(process.env.PAVE_Y || 122),    // smoothed grey luminance >= this = light paving, else asphalt (outside road corridors)
};
const GREY = 13;
const v05 = new Uint8Array(S.W * S.H); // per 0.5 m pixel class
for (let k = 0; k < S.W * S.H; k++) {
  const r = S.r[k], gg = S.g[k], b = S.b[k];
  const exg = 2 * gg - r - b, y = 0.299 * r + 0.587 * gg + 0.114 * b;
  if (exg >= P.exg && gg >= r) v05[k] = 1; // vegetation (grass/canopy decided per 1 m cell)
  else if (r - b >= P.warm && r >= gg - 2 && y > 70) v05[k] = 2; // gravel / bare
  else if (y < P.shadowY) v05[k] = 3; // shadow
  else v05[k] = 4; // grey
}
log('raw classes');
// 1 m cell: vote
let cls = new Uint8Array(N);
const yCell = new Float32Array(N), greyY = new Float32Array(N), greyN = new Float32Array(N);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const o = 2 * j * S.W + 2 * i;
  const cnt = [0, 0, 0, 0, 0];
  let ys = 0, gy = 0, gn = 0;
  for (const d of [0, 1, S.W, S.W + 1]) { cnt[v05[o + d]]++; const y = 0.299 * S.r[o + d] + 0.587 * S.g[o + d] + 0.114 * S.b[o + d]; ys += y; if (v05[o + d] === 4) { gy += y; gn++; } }
  const k = j * W + i;
  yCell[k] = ys / 4; greyY[k] = gy; greyN[k] = gn;
  let c;
  if (cnt[1] >= 2 && cnt[1] >= cnt[2] && cnt[1] >= cnt[4]) c = yCell[k] < P.canopyY ? K.CANOPY : K.GRASS;
  else if (cnt[2] >= 2 && cnt[2] > cnt[4]) c = K.GRAVEL;
  else if (cnt[3] >= 2 && cnt[3] > cnt[4]) c = K.SHADOW;
  else c = GREY;
  cls[k] = c;
}
// box-smoothed grey luminance (11 x 11) for asphalt-vs-paving decisions
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.max(0, Math.min(w - 1, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s; s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.max(0, Math.min(h - 1, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = s; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
log('voted');

// dilate buildings by 1 m (roof overhang / lean): their cells carry no ground information
const bld2 = new Uint8Array(N);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const k = j * W + i;
  if (M.bld[k]) { bld2[k] = 1; continue; }
  if (i > 0 && M.bld[k - 1] || i < W - 1 && M.bld[k + 1] || j > 0 && M.bld[k - W] || j < H - 1 && M.bld[k + W]) bld2[k] = 1;
}
for (let k = 0; k < N; k++) if (bld2[k]) { greyY[k] = 0; greyN[k] = 0; }
const sY = boxBlur(greyY, W, H, 6), sN = boxBlur(greyN, W, H, 6);
const smY = (k) => (sN[k] > 25 ? sY[k] / sN[k] : 0);
for (let k = 0; k < N; k++) if (bld2[k] && !M.road[k]) cls[k] = K.UNK;
// shadows -> nearest lit ground class (never from building cells)
cls = nearestFill(cls, W, H, (v) => v === K.UNK || v === K.SHADOW, 30, GREY);
log('filled');

// Old Town (cobbled): tighter than buildings.zoneOf (which also colours the facades)
const OLD = (x, z) => { const a = (x + 470) / 330, b = (z - 270) / 310; return a * a + b * b < 1; };
const out = new Uint8Array(N);
const cnts = {};
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const k = j * W + i, x = BOUNDS.minX + i + 0.5, z = BOUNDS.minZ + j + 0.5;
  if (bld2[k] && !M.road[k]) { out[k] = K.UNK; continue; }
  let c = cls[k];
  if (M.water[k] && !M.pier[k]) c = K.WATER;
  else if (M.road[k]) c = (c === K.CANOPY || c === K.GRASS) && !M.brg[k] ? c : K.ASPHALT;
  else if (c === GREY) {
    const my = smY(k);
    if (M.rail[k]) c = K.BALLAST;
    else if (M.pkg[k] || M.asph[k]) c = K.ASPHALT;
    else if (M.sq[k] || M.ped[k] || M.pier[k]) c = K.PAVING;
    else if (M.sand[k] || M.con[k]) c = K.GRAVEL;
    else if (M.park[k]) c = my && my < P.paveY - 22 ? K.CANOPY : K.PAVING;
    else if (my && my < P.paveY - (M.ind[k] ? -4 : 4)) c = K.ASPHALT;
    else c = K.PAVING;
  } else if (c === K.GRAVEL) {
    if (M.sq[k] || M.ped[k] || M.pier[k]) c = K.PAVING; // pink granite monument bases, tiles
    else if (M.rail[k]) c = K.BALLAST;
    else if (M.pkg[k] || M.asph[k]) c = K.ASPHALT;
    else if (!M.sand[k] && !M.con[k] && !M.park[k] && !M.ind[k]) c = smY(k) && smY(k) < P.paveY - 4 ? K.ASPHALT : K.PAVING; // warm roofs / cars / tiles leaking in
  }
  if (c === K.PAVING && OLD(x, z) && !M.park[k] && !(M.road[k])) c = K.SETT;
  out[k] = c;
}
// quay edge: the ortho shoreline (dark water, wet stone, shadows) never matches the vector waterline -> a 2.5 m paved apron along every bank
{
  let near = new Uint8Array(M.water);
  for (let it = 0; it < 3; it++) {
    const nx = new Uint8Array(near);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; if (!near[k] && (near[k - 1] || near[k + 1] || near[k - W] || near[k + W])) nx[k] = 1; }
    near = nx;
  }
  for (let k = 0; k < N; k++) if (near[k] && !M.water[k] && !M.road[k] && out[k] !== K.UNK && out[k] !== K.GRASS && out[k] !== K.WATER && out[k] !== K.CANOPY) out[k] = out[k] === K.SETT ? K.SETT : K.PAVING;
}
// buildings: take the nearest ground class (courtyards stay courtyards)
let res = nearestFill(out, W, H, (v) => v === K.UNK, 3, K.PAVING);
// tidy: majority filter + small specks
res = modeFilter(modeFilter(res, W, H, 1, (v) => v !== K.WATER), W, H, 1, (v) => v !== K.WATER);
removeSpecks(res, W, H, Number(process.env.SPECK || 45), new Set([K.GRASS, K.CANOPY, K.PAVING, K.ASPHALT, K.SETT]));
removeSpecks(res, W, H, 40, new Set([K.GRAVEL]));
// a tan blob that is surrounded by paving is a monument base / tile field, not a gravel path
reclassComponents(res, W, H, K.GRAVEL, (comp, border) => {
  let tot = 0; for (let v = 0; v < 16; v++) tot += border[v];
  const paved = border[K.PAVING] + border[K.SETT] + border[K.ASPHALT];
  const k = comp[0];
  if (M.sand[k] || M.con[k] || M.ind[k]) return -1;
  return tot && paved / tot > 0.55 ? K.PAVING : -1;
});
for (let k = 0; k < N; k++) cnts[res[k]] = (cnts[res[k]] || 0) + 1;
log('class cells', JSON.stringify(cnts));

const PAL = [[0, 0, 0], [16, 0, 0], [32, 0, 0], [48, 0, 0], [64, 0, 0], [80, 0, 0], [96, 0, 0], [112, 0, 0], [128, 0, 0], [144, 0, 0], [160, 0, 0], [176, 0, 0], [192, 0, 0], [208, 0, 0], [224, 0, 0], [240, 0, 0]];
const png = encodePng(res, W, H, PAL, 4);
const OUTF = path.join(DATA_DIR, 'riga-ground.png');
fs.writeFileSync(OUTF, png);
log('wrote', OUTF, (png.length / 1024).toFixed(0), 'KB', W + 'x' + H);
// debug preview in game colours
if (process.env.DEBUG_PNG) {
  const COL = { 0: [218, 213, 202], 1: [166, 200, 124], 2: [108, 152, 92], 3: [142, 141, 137], 4: [219, 215, 204], 5: [203, 184, 143], 6: [95, 134, 163], 7: [160, 152, 140], 8: [168, 158, 142] };
  const rgb = Buffer.alloc(N * 3);
  for (let k = 0; k < N; k++) { const c = COL[res[k]] || [255, 0, 255]; rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2]; }
  fs.writeFileSync('/tmp/ground_dbg.rgb', rgb);
  console.log('debug rgb /tmp/ground_dbg.rgb', W, H);
}

// ---- thumbnail for the map picker (class colours, ~120 px wide, palette PNG)
{
  const TW = 120, blk = Math.ceil(W / TW), TH = Math.ceil(H / blk), tw = Math.ceil(W / blk);
  const RGBP = [[218, 213, 202], [166, 200, 124], [108, 152, 92], [142, 141, 137], [219, 215, 204], [203, 184, 143], [95, 134, 163], [160, 152, 140], [168, 158, 142]];
  while (RGBP.length < 16) RGBP.push([0, 0, 0]);
  const th = new Uint8Array(tw * TH);
  const cnt = new Uint16Array(16);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < tw; tx++) {
    cnt.fill(0);
    for (let y = ty * blk; y < Math.min(H, (ty + 1) * blk); y++) for (let x = tx * blk; x < Math.min(W, (tx + 1) * blk); x++) cnt[res[y * W + x]]++;
    let best = 0; for (let c = 1; c < 9; c++) if (cnt[c] > cnt[best]) best = c;
    th[ty * tw + tx] = best;
  }
  fs.writeFileSync(path.join(DATA_DIR, 'thumb.png'), encodePng(th, tw, TH, RGBP, 4));
  log('thumb', tw + 'x' + TH);
}
