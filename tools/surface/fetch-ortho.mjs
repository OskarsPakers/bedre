#!/usr/bin/env node
// Fetches the part of the LĢIA open-data orthophoto (cycle 6, 2016-2018, 0.25 m, CC BY 4.0) that covers the map and caches it
// as a 0.5 m RGB mosaic in tools/.cache/ortho/ (ortho05.rgb + ortho05.json). The source GeoTIFFs are uncompressed + 512 px tiled, so only
// the needed tiles are range-requested (<= 3 concurrent, retries with backoff, generic User-Agent). The imagery itself is never shipped.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, BOUNDS, UA, CT, lksFromLocal } from './common.mjs';

const BASE = 'https://s3.storage.pub.lvdc.gov.lv/lgia-opendata/ortofoto_rgb_v6';
const DIR = path.join(CACHE, 'ortho');
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RES = 0.5, TILE_M = 2500, TS = 512, PXT = 10000, SRC_RES = 0.25;

async function range(url, a, b) {
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(180000) });
      if (r.status === 206 || r.status === 200) return Buffer.from(await r.arrayBuffer());
      err = new Error('HTTP ' + r.status);
    } catch (e) { err = e; }
    await sleep(2000 * (i + 1));
  }
  throw err;
}

// ---- needed LKS window
let Emin = 1e9, Emax = -1e9, Nmin = 1e9, Nmax = -1e9;
for (let i = 0; i <= 20; i++) for (const [x, z] of [[BOUNDS.minX + (i / 20) * (BOUNDS.maxX - BOUNDS.minX), BOUNDS.minZ], [BOUNDS.minX + (i / 20) * (BOUNDS.maxX - BOUNDS.minX), BOUNDS.maxZ], [BOUNDS.minX, BOUNDS.minZ + (i / 20) * (BOUNDS.maxZ - BOUNDS.minZ)], [BOUNDS.maxX, BOUNDS.minZ + (i / 20) * (BOUNDS.maxZ - BOUNDS.minZ)]]) {
  const [E, N] = lksFromLocal(x, z);
  Emin = Math.min(Emin, E); Emax = Math.max(Emax, E); Nmin = Math.min(Nmin, N); Nmax = Math.max(Nmax, N);
}
const pad = 40;
const E0 = Math.floor((Emin - pad) / 10) * 10, E1 = Math.ceil((Emax + pad) / 10) * 10;
const N0 = Math.floor((Nmin - pad) / 10) * 10, N1 = Math.ceil((Nmax + pad) / 10) * 10; // N1 = top
const W = Math.round((E1 - E0) / RES), H = Math.round((N1 - N0) / RES);
console.log('LKS window', { E0, E1, N0, N1, W, H });
const metaF = path.join(DIR, `ortho05${CT}.json`), rgbF = path.join(DIR, `ortho05${CT}.rgb`);
if (fs.existsSync(metaF) && fs.existsSync(rgbF) && fs.statSync(rgbF).size === W * H * 3) { console.log('cache hit ortho05'); process.exit(0); }
const mosaic = Buffer.alloc(W * H * 3);

const tiles = [];
for (let ex = Math.floor((E0 - 500000) / TILE_M); ex <= Math.floor((E1 - 500000 - 1e-6) / TILE_M); ex++)
  for (let ny = Math.floor((N0 - 300000) / TILE_M); ny <= Math.floor((N1 - 300000 - 1e-6) / TILE_M); ny++) {
    const cx = Math.floor(ex / 2) + 1, cy = Math.floor(ny / 2) + 1, q = 1 + (ex % 2) + 2 * (ny % 2);
    tiles.push({ ex, ny, name: `4311-${cy}${cx}_${q}`, x0: 500000 + ex * TILE_M, ytop: 300000 + (ny + 1) * TILE_M });
  }
console.log('tiles', tiles.map((t) => t.name).join(' '));

async function doTile(t) {
  const url = `${BASE}/4311/${t.name}.tif`;
  const head = await range(url, 0, 7);
  if (head.toString('latin1', 0, 2) !== 'II') throw new Error('not LE tiff');
  const ifdOff = head.readUInt32LE(4);
  const ifd = await range(url, ifdOff, ifdOff + 2 + 12 * 24);
  const n = ifd.readUInt16LE(0);
  const tag = {};
  for (let i = 0; i < n; i++) { const o = 2 + i * 12; tag[ifd.readUInt16LE(o)] = { typ: ifd.readUInt16LE(o + 2), cnt: ifd.readUInt32LE(o + 4), val: ifd.readUInt32LE(o + 8) }; }
  if (tag[259].val !== 1 || tag[322].val !== TS || tag[277].val !== 3) throw new Error('unexpected tiff layout ' + t.name);
  const offs = await range(url, tag[324].val, tag[324].val + 4 * tag[324].cnt - 1);
  const tpr = Math.ceil(PXT / TS);
  // needed tile columns/rows within this file (pixel space of the tile; row 0 = top)
  const pxE0 = Math.max(0, Math.floor((E0 - t.x0) / SRC_RES)), pxE1 = Math.min(PXT, Math.ceil((E1 - t.x0) / SRC_RES));
  const pyT = Math.max(0, Math.floor((t.ytop - N1) / SRC_RES)), pyB = Math.min(PXT, Math.ceil((t.ytop - N0) / SRC_RES));
  if (pxE1 <= pxE0 || pyB <= pyT) return 0;
  let got = 0;
  for (let tr = Math.floor(pyT / TS); tr <= Math.floor((pyB - 1) / TS); tr++) {
    const c0 = Math.floor(pxE0 / TS), c1 = Math.floor((pxE1 - 1) / TS);
    const a = offs.readUInt32LE(4 * (tr * tpr + c0)), bEnd = offs.readUInt32LE(4 * (tr * tpr + c1)) + TS * TS * 3 - 1;
    const buf = await range(url, a, bEnd);
    for (let tc = c0; tc <= c1; tc++) {
      const base = offs.readUInt32LE(4 * (tr * tpr + tc)) - a;
      // downsample 2x2 -> 0.5 m
      for (let ry = 0; ry < TS; ry += 2) {
        const py = tr * TS + ry; if (py >= PXT || py < pyT - 1 || py >= pyB) continue;
        const wy = Math.floor((N1 - (t.ytop - (py + 0.5) * SRC_RES)) / RES); if (wy < 0 || wy >= H) continue;
        for (let rx = 0; rx < TS; rx += 2) {
          const px = tc * TS + rx; if (px >= PXT) continue;
          const wx = Math.floor((t.x0 + (px + 0.5) * SRC_RES - E0) / RES); if (wx < 0 || wx >= W) continue;
          let r = 0, g = 0, bb = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = base + ((ry + dy) * TS + rx + dx) * 3; r += buf[o]; g += buf[o + 1]; bb += buf[o + 2]; }
          const o2 = (wy * W + wx) * 3; mosaic[o2] = r >> 2; mosaic[o2 + 1] = g >> 2; mosaic[o2 + 2] = bb >> 2;
        }
      }
      got++;
    }
  }
  return got;
}

let next = 0;
async function worker() { while (next < tiles.length) { const t = tiles[next++]; const g = await doTile(t); console.log('done', t.name, g, 'tiles'); await sleep(500); } }
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(rgbF, mosaic);
fs.writeFileSync(metaF, JSON.stringify({ E0, E1, N0, N1, W, H, res: RES, source: 'LGIA ortofoto cycle 6 (2016-2018) 0.25 m, CC BY 4.0', tiles: tiles.map((t) => t.name) }));
console.log('wrote', rgbF, (mosaic.length / 1048576).toFixed(0), 'MB');
