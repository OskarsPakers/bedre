import fs from 'node:fs'; import { QC } from './lib.mjs';
const out = {};
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const B = JSON.parse(fs.readFileSync(`${QC}/bld-${slug}.json`));
  const ok = B.filter((r) => r.meanS !== undefined && r.cover >= 0.6 && r.n >= 20);
  const body = (r) => r.rMean - r.meanS, topE = (r) => r.rHmax - (r.fine ? Math.max(r.aMax || 0, r.topS) : r.topS);
  const bodyBad = ok.filter((r) => Math.abs(body(r)) > Math.max(4, 0.25 * Math.max(r.meanS, 1)) && r.treeF < 0.5);
  const topBad = ok.filter((r) => r.shaped && Math.abs(topE(r)) > Math.max(4, 0.25 * (r.topS || 1)) && r.treeF < 0.5);
  const noMesh = B.filter((r) => r.meanS === undefined || r.cover < 0.6);
  const notable = noMesh.filter((r) => r.rMax >= 20 || (r.sight && r.sight.tier !== 0 && r.sight.tier <= 1) || r.area >= 1500 || r.lm);
  const rank = (r) => (r.sight ? (r.sight.tier === 'A' || r.sight.tier === 0 ? 1e6 : r.sight.tier === 'B' || r.sight.tier === 1 ? 2e4 : 2e3) : 0) + (r.lm ? 5e3 : 0) + Math.min(r.area, 5000) * Math.abs(body(r));
  bodyBad.sort((a, b) => rank(b) - rank(a));
  out[slug] = { usable: ok.length, total: B.length, bodyBad: bodyBad.length, bodyUnder: bodyBad.filter((r) => body(r) < 0).length, bodyOver: bodyBad.filter((r) => body(r) > 0).length, topBad: topBad.length, noMesh: noMesh.length, notableNoMesh: notable.length };
  fs.writeFileSync(`${QC}/heights-${slug}.json`, JSON.stringify({ summary: out[slug], body: bodyBad.slice(0, 60).map((r) => ({ id: r.id, name: r.name, t: r.t, x: r.x, z: r.z, area: r.area, rBody: r.rMean, mMean: r.meanS, m50: r.m50, m90: r.m90, rMax: r.rMax, shaped: r.shaped, sight: r.sight, lm: r.lm, treeF: r.treeF })), top: topBad.sort((a, b) => b.area - a.area).slice(0, 30).map((r) => ({ id: r.id, name: r.name, area: r.area, rHmax: r.rHmax, topS: r.topS, aMax: r.aMax })), notable: notable.slice(0, 40).map((r) => ({ id: r.id, name: r.name, t: r.t, x: r.x, z: r.z, area: r.area, rMax: r.rMax, cover: r.cover })) }));
}
console.log(JSON.stringify(out, null, 1));
