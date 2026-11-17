// Is the built world identical between two builds? SHA-256 of the building geometry buffers, of every building item (colours, height, fit, value) and of every object
// (kind, position, fit, value, name) per map. node scripts/perf/compare-world.mjs --a scripts/.dist-base --b scripts/.dist-perf [--maps ...] [--quality high]
import { serve, launch, arg } from './lib.mjs';
const maps = arg('--maps', 'centrs,agenskalns,mezaparks,purvciems').split(','), q = arg('--quality', 'high');
const digest = async (dist, map) => {
  const srv = await serve(dist, 5185); const b = await launch('chromium');
  const page = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  await page.goto(`http://localhost:5185/?map=${map}&quality=${q}&radio=0&sw=0&intro=0`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    const w = window.__life.world, H = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
    const g = w.buildingMesh.geometry, out = {};
    for (const k of Object.keys(g.attributes)) out['geo.' + k] = await H(g.attributes[k].array);
    if (g.index) out['geo.index'] = await H(g.index.array);
    const enc = new TextEncoder();
    out.items = await H(enc.encode(JSON.stringify(w.buildingItems.map((i) => [i.id, i.x, i.z, i.wallCol, i.roofHex, i.h, i.fit, i.value, i.name, i.sightCat, i.gidShape, i.gidBox]))));
    out.objects = await H(enc.encode(JSON.stringify(w.objects.map((o) => [o.id, o.kind, o.mover ? 0 : o.x, o.mover ? 0 : o.z, o.fit, o.value, o.name, o.mover ? 0 : o.yaw, o.s]))));
    out.counts = [w.objects.length, w.propMeshes.length, w.buildingItems.length];
    // instance colours / matrices of the props, summed per kind (mesh grouping may differ, the per-object data must not)
    const per = {}; for (const o of w.objects) if (!o.isBuilding && !o.mover) { const m = o.mesh; const a = m.instanceMatrix.array, i = o.idx; let s = (per[o.kind] ||= { n: 0, sum: 0, col: 0 }); s.n++; for (let k = 0; k < 16; k++) s.sum += a[i * 16 + k]; if (m.instanceColor) for (let k = 0; k < 3; k++) s.col += m.instanceColor.array[i * 3 + k]; }
    out.perKind = await H(enc.encode(JSON.stringify(Object.entries(per).sort().map(([k, v]) => [k, v.n, +v.sum.toFixed(3), +v.col.toFixed(4)]))));
    return out;
  });
  await b.close(); await srv.close(); return r;
};
let bad = 0;
for (const map of maps) {
  const A = await digest(arg('--a'), map), B = await digest(arg('--b'), map);
  const diffs = Object.keys(A).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
  console.log(map, diffs.length ? 'DIFFERENT: ' + diffs.map((k) => `${k} ${JSON.stringify(A[k])} vs ${JSON.stringify(B[k])}`).join('; ') : 'identical', 'counts', JSON.stringify(A.counts), JSON.stringify(B.counts));
  bad += diffs.length;
}
process.exit(bad ? 1 : 0);
