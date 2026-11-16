// Before -> after table of the reviewer's numeric checks. before = tools/.cache/qa-map, after = tools/.cache/qa-map-after (QA_DIR run: dump-game, buildings, missing)
//   node tools/qa-map/recheck.mjs        needs both dirs; canopy: game ground raster classes 2 + 10 vs the mesh tree-like cells (canopy-<map>.json for the mesh share)
import fs from 'node:fs'; import path from 'node:path';
import { ROOT } from './lib.mjs';
import { readGround, loadDsm } from '../mapfix/lib.mjs';
import { mapInfo } from '../mapfix/lib.mjs';
const B = path.join(ROOT, 'tools/.cache/qa-map'), A = path.join(ROOT, 'tools/.cache/qa-map-after');
const rd = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f)));
const rows = [];
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const m = (d) => {
    const bld = rd(d, `bld-${slug}.json`), ok = bld.filter((r) => r.meanS !== undefined && r.cover >= 0.6 && r.n >= 20);
    const body = (r) => r.rMean - r.meanS;
    const phantom = bld.filter((r) => r.m50 !== undefined && r.cover >= 0.5 && r.n >= 20 && r.mMean <= 2.5 && r.m50 <= 1.5 && r.rMean >= 6);
    const slab = bld.filter((r) => r.m50 !== undefined && r.cover >= 0.5 && r.n >= 20 && r.area >= 800 && r.m90 < 2 && r.rMax >= 2.5);
    const spike = bld.filter((r) => r.shaped && r.rHmax >= 12 && r.topS !== undefined && r.topS <= 0.5 * r.rHmax);
    const within = ok.filter((r) => Math.abs(body(r)) <= Math.max(4, 0.25 * Math.max(r.meanS, 1)));
    const miss = rd(d, `missing-${slug}.json`).filter((r) => r.area >= 80 && r.canopy < 0.3 && r.maxH >= 5 && r.fill >= 0.4 && r.wall >= 0.35);
    return { n: bld.length, phantom: phantom.length, phantom15: phantom.filter((r) => r.rMax >= 15).length, slab: slab.length, spike: spike.length, within: +(100 * within.length / ok.length).toFixed(1), usable: ok.length, missing: miss.length };
  };
  rows.push({ slug, before: m(B), after: m(A) });
}
// canopy share (class 2 + 10 of observed mesh cells) before = the original png (tools/.cache/mapfix-before), after = public/data
const cano = async (png, slug) => {
  const G = await (async () => { const sharp = (await import('sharp')).default; const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); const cls = new Uint8Array(info.width * info.height); for (let k = 0; k < cls.length; k++) cls[k] = Math.round(data[k * info.channels] / 16); return { cls, W: info.width, H: info.height }; })();
  const b = mapInfo(slug).bounds, dsm = loadDsm(slug); let obs = 0, can = 0;
  for (let j = 0; j < G.H; j++) for (let i = 0; i < G.W; i++) { const x = b.minX + i + 0.5, z = b.minZ + j + 0.5, v = dsm.at(x, z); if (v !== v) continue; obs++; const c = G.cls[j * G.W + i]; if (c === 2 || c === 10) can++; }
  return +(100 * can / obs).toFixed(1);
};
for (const r of rows) {
  const d = r.slug === 'centrs' ? '' : r.slug + '/';
  r.before.canopyPct = await cano(path.join(ROOT, 'tools/.cache/mapfix-before/data', d + 'riga-ground.png'), r.slug);
  r.after.canopyPct = await cano(path.join(ROOT, 'public/data', d + 'riga-ground.png'), r.slug);
  r.meshCanopyPct = +(100 * rd(B, `canopy-${r.slug}.json`).meshTreeShareOfObserved).toFixed(1);
}
console.log(JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(ROOT, 'tools/.cache/mapfix/recheck.json'), JSON.stringify(rows, null, 1));
