#!/usr/bin/env node
// Alignment check between cadastre footprints (riga.json) and the reality mesh: for a sample of buildings, find the
// shift (dx,dz in +-4 m, 0.5 m steps) of the footprint that maximises the height contrast between a band just inside
// and a band just outside the outline. Reports the distribution of best shifts and of the contrast gain.
//   node tools/detail/check-alignment.mjs [--n=300]
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, openLayers, localToMerc } from './i3s.mjs';
import { buildDsm, pip, bboxOf, distToRing, quant } from './dsm.mjs';
import { game } from './build-detail.mjs';

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=300').slice(4));
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
// deterministic sample: free-standing-ish buildings (res/com/pub, area 150..3000 m2, height >= 9 m) spread over the map
const cand = game.buildings.filter((b) => ['res', 'com', 'pub', 'rel'].includes(b.t) && b.h >= 9 && area(b.p) > 150 && area(b.p) < 3000);
const step = Math.max(1, Math.floor(cand.length / N));
const sample = cand.filter((_, i) => i % step === 0).slice(0, N);
const [a, c] = [localToMerc(-1300, 1300), localToMerc(1300, -1300)];
const layers = (await openLayers([a[0], a[1], c[0], c[1]])).filter((l) => !/^Pazeme/i.test(l.name));
const tiles = new Map();
for (const b of sample) { const bb = bboxOf(b.p); const k = `${Math.floor((bb.minX + bb.maxX) / 2 / 250)},${Math.floor((bb.minZ + bb.maxZ) / 2 / 250)}`; if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(b); }
const results = [];
for (const [, items] of tiles) {
  const bbs = items.map((b) => bboxOf(b.p));
  const box = { minX: Math.min(...bbs.map((b) => b.minX)) - 8, maxX: Math.max(...bbs.map((b) => b.maxX)) + 8, minZ: Math.min(...bbs.map((b) => b.minZ)) - 8, maxZ: Math.max(...bbs.map((b) => b.maxZ)) + 8 };
  const { raster: R } = await buildDsm(layers, box, 0.5, 1.0);
  for (const b of items) {
    const bb = bboxOf(b.p);
    const ins = [], out = [];
    for (let x = bb.minX - 3.5; x <= bb.maxX + 3.5; x += 0.5) for (let z = bb.minZ - 3.5; z <= bb.maxZ + 3.5; z += 0.5) {
      const inside = pip(x, z, b.p);
      const d = distToRing(x, z, b.p);
      if (d < 1 || d > 3) continue;
      (inside ? ins : out).push([x, z]);
    }
    if (ins.length < 20 || out.length < 20) continue;
    const mean = (pts, dx, dz) => { let s = 0, n = 0; for (const [x, z] of pts) { const v = R.at(x - dx, z - dz); if (!Number.isNaN(v)) { s += v; n++; } } return n > pts.length * 0.6 ? s / n : NaN; };
    let best = null, zero = NaN;
    for (let dx = -4; dx <= 4; dx += 0.5) for (let dz = -4; dz <= 4; dz += 0.5) {
      const sc = mean(ins, dx, dz) - mean(out, dx, dz);
      if (dx === 0 && dz === 0) zero = sc;
      if (!Number.isNaN(sc) && (!best || sc > best.sc)) best = { dx, dz, sc };
    }
    if (best && !Number.isNaN(zero)) results.push({ id: b.id, dx: best.dx, dz: best.dz, gain: +(best.sc - zero).toFixed(2), contrast0: +zero.toFixed(2), contrastBest: +best.sc.toFixed(2) });
  }
}
const mag = results.map((r) => Math.hypot(r.dx, r.dz));
const ok = results.filter((r) => r.contrastBest > 2); // only buildings with a clear edge signal
const okMag = ok.map((r) => Math.hypot(r.dx, r.dz));
const med = (arr) => quant(arr, 0.5);
const rep = {
  sampled: sample.length, evaluated: results.length, withClearEdge: ok.length,
  bestShiftMagnitude_m: { p50: med(okMag), p75: quant(okMag, 0.75), p90: quant(okMag, 0.9), max: Math.max(...okMag) },
  medianShift_m: { dx: med(ok.map((r) => r.dx)), dz: med(ok.map((r) => r.dz)) },
  share_shift_le_1m: okMag.filter((m) => m <= 1).length / ok.length,
  share_shift_gt_2m: okMag.filter((m) => m > 2).length / ok.length,
  meanContrastAtZeroShift_m: ok.reduce((s, r) => s + r.contrast0, 0) / ok.length,
  meanContrastAtBestShift_m: ok.reduce((s, r) => s + r.contrastBest, 0) / ok.length,
  allMagnitudes: { p50: med(mag), p90: quant(mag, 0.9) },
};
console.log(JSON.stringify(rep, null, 1));
fs.writeFileSync(path.join(CACHE, 'alignment.json'), JSON.stringify({ rep, results }));
