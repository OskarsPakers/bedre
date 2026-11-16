// Per-building comparison game vs mesh: heights (A1), extra (A3), alignment (A4), roof form (A5)  -> tools/.cache/qa-map/bld-<map>.json
import fs from 'node:fs'; import path from 'node:path';
import { loadMap, loadRecs, loadDsm, loadAnalysis, dtm, roughness, pip, distToRing, area, bbox, quant, QC } from './lib.mjs';
const slug = process.argv[2] || 'centrs';
const RECS = loadRecs(slug); const M = loadMap(slug), dsm = loadDsm(slug), DT = dtm(dsm), RG = roughness(dsm);
const out = [];
const { w, h, x0, z0, d } = dsm;
const cellOf = (x, z) => [Math.floor(x - x0), Math.floor(z - z0)];
for (const b of M.city.buildings) {
  const g = M.gameById.get(b.id); if (!g) continue;
  const ring = g.ring.length ? g.ring : b.p; const ar = area(ring); const bb = bbox(ring);
  const an = loadAnalysis(b.id);
  const inside = [];
  for (let j = Math.floor(bb.minZ - z0); j <= Math.ceil(bb.maxZ - z0); j++) for (let i = Math.floor(bb.minX - x0); i <= Math.ceil(bb.maxX - x0); i++) {
    if (i < 0 || j < 0 || i >= w || j >= h) continue;
    if (pip(x0 + i + 0.5, z0 + j + 0.5, ring)) inside.push(j * w + i);
  }
  let ground = an && an.ok && isFinite(an.ground) ? an.ground : NaN;
  // dtm fallback at centroid
  let cdt = NaN; if (inside.length) { const vs = inside.map((k) => DT[k]).filter((v) => v === v); cdt = vs.length ? quant(vs, 0.5) : NaN; }
  const gSrc = ground === ground ? 'ring' : 'dtm';
  if (ground !== ground) ground = cdt;
  const hs = [], smooth = [];
  for (const k of inside) { const v = d[k]; if (v === v) { hs.push(v - ground); if (!(v - ground >= 3 && RG[k] > 1.3)) smooth.push(Math.max(0, v - ground)); } }
  const cover = inside.length ? hs.length / inside.length : 0;
  const rec0 = RECS.get(b.id); const rec = rec0 && (g.t !== 'aux' || rec0.roofRGB) && !(rec0.flags & 1) ? rec0 : null;
  const renderedMax = g.h; // final item.h (incl. sight decorations: towers, spires, flags)
  const renderedMean = rec ? Math.max(3, rec.vol / ar) : (g.hBox || g.h);
  const renderedEave = rec ? rec.eave : (g.hBox || g.h);
  const r = { id: b.id, t: g.t, name: g.name, x: g.x, z: g.z, area: +ar.toFixed(0), sight: g.sight ? { cat: g.sight[0], tier: g.sight[1], key: g.sight[3] } : null, lm: g.lm, shaped: !!rec, cityH: b.h,
    rMax: +renderedMax.toFixed(1), rMean: +renderedMean.toFixed(1), rEave: +renderedEave.toFixed(1), rHmax: rec ? rec.hmax : null, rStyle: rec ? rec.style : 0, rNt: rec ? rec.nt : 0, ground: +ground.toFixed(2), gSrc, cover: +cover.toFixed(2), n: inside.length };
  if (hs.length >= 4) {
    const pos = hs.map((v) => Math.max(0, v));
    r.mMean = +(pos.reduce((a, c) => a + c, 0) / pos.length).toFixed(1);
    r.m50 = +quant(pos, 0.5).toFixed(1); r.m90 = +quant(pos, 0.9).toFixed(1); r.m98 = +quant(pos, 0.98).toFixed(1); r.m10 = +quant(pos, 0.1).toFixed(1);
    r.treeF = +(1 - smooth.length / hs.length).toFixed(2);
    if (smooth.length >= 4) { const sm = Float64Array.from(smooth).sort(); r.topS = +sm[Math.max(0, sm.length - 1 - Math.min(5, sm.length - 1))].toFixed(1); r.meanS = +(smooth.reduce((a, c) => a + c, 0) / smooth.length).toFixed(1); }
    r.mMaxDsm = +Math.max(...pos).toFixed(1);
    { const srt = Float64Array.from(pos).sort(); const k = Math.min(srt.length - 1, 5); r.top6 = srt.length >= 20 ? +srt[srt.length - 1 - k].toFixed(1) : r.m98; r.f3 = +(pos.filter((v) => v >= 3).length / pos.length).toFixed(2); r.f6 = +(pos.filter((v) => v >= 6).length / pos.length).toFixed(2); }
    if (an && an.ok) { r.aMax = an.max; r.aP90 = an.p90; r.aP50 = an.p50; r.fine = !!an.fine; }
    r.mTop = an && an.ok && an.fine ? Math.max(an.max, r.top6) : r.top6;
    r.flat = pos.filter((v) => v <= 1.5).length / pos.length;
    r.relief = +(r.m90 - r.m10).toFixed(1);
  }
  // alignment (A4)
  if (r.m50 !== undefined && ar >= 120 && r.m90 >= 5 && cover >= 0.9 && ar < 6000) {
    const thr = Math.max(2.5, 0.5 * r.m90);
    const ringCells = [];
    for (let j = Math.floor(bb.minZ - z0 - 5); j <= Math.ceil(bb.maxZ - z0 + 5); j++) for (let i = Math.floor(bb.minX - x0 - 5); i <= Math.ceil(bb.maxX - x0 + 5); i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const px = x0 + i + 0.5, pz = z0 + j + 0.5;
      if (pip(px, pz, ring)) continue;
      if (distToRing(px, pz, ring) <= 3.5) ringCells.push(j * w + i);
    }
    const sc = (dx, dz) => {
      let a = 0, na = 0, c = 0, nc = 0;
      for (const k of inside) { const kk = k + dz * w + dx; const v = d[kk]; if (v === v) { na++; if (v - ground >= thr) a++; } }
      for (const k of ringCells) { const kk = k + dz * w + dx; const v = d[kk]; if (v === v) { nc++; if (v - ground >= thr) c++; } }
      return na && nc ? a / na - c / nc : -9;
    };
    let best = -9, bx = 0, bz = 0; const R = 7;
    const s0 = sc(0, 0);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { const s = sc(dx, dz); if (s > best) { best = s; bx = dx; bz = dz; } }
    // dsm cell (i+dx) means footprint should move by -dx? score(dx): footprint cells shifted by +dx hit mesh => mesh building sits at +dx relative to footprint
    r.al = { dx: bx, dz: bz, s: +best.toFixed(2), s0: +s0.toFixed(2) };
  }
  out.push(r);
}
fs.writeFileSync(path.join(QC, `bld-${slug}.json`), JSON.stringify(out));
console.log(slug, out.length, 'with mesh stats', out.filter((r) => r.m50 !== undefined).length, 'aligned', out.filter((r) => r.al).length);
