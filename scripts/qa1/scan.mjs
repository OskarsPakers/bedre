// Read-only world audit: props inside building footprints / on water; traffic movers inside buildings or over water (sampled over time)
import { launch, newPage, sleep, note } from './lib.mjs';
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];
const b = await launch();
for (const map of maps) {
  const p = await newPage(b, { tag: 'scan-' + map, locale: 'en-US' });
  await p.openGame(`map=${map}&autostart=1&intro=0&mode=free`);
  await sleep(1500);
  const res = await p.evaluate(async () => {
    const L = window.__life, w = L.world, d = w.data;
    const pip = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const bb = (poly) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of poly) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; } return [x0, x1, z0, z1]; };
    const G = new Map(); const C = 50;
    const addGrid = (poly, tag, extra) => { const [x0, x1, z0, z1] = bb(poly); for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = i * 100003 + j; let a = G.get(k); if (!a) G.set(k, (a = [])); a.push({ poly, tag, bb: [x0, x1, z0, z1], extra }); } };
    for (const bu of d.buildings) addGrid(bu.p, 'b', bu);
    const wat = d.water; for (const wa of wat) addGrid(wa.p, 'w', wa);
    // bridges: road with bridge flag? record road polylines flagged bridge as allowed on water
    const hit = (x, z) => { const a = G.get(Math.floor(x / C) * 100003 + Math.floor(z / C)); const out = []; if (a) for (const e of a) { if (x < e.bb[0] || x > e.bb[1] || z < e.bb[2] || z > e.bb[3]) continue; if (pip(x, z, e.poly)) out.push(e.tag); } return out; };
    const props = w.objects.filter((o) => o.kind !== 'building');
    const stat = { n: props.length, inBuilding: {}, onWater: {}, samples: { b: [], w: [] } };
    const allowWater = new Set(['boat', 'ferry', 'swan', 'pigeon', 'bird']);
    for (const o of props) {
      const h = hit(o.x, o.z);
      if (h.includes('b') && !['pigeon'].includes(o.kind)) { stat.inBuilding[o.kind] = (stat.inBuilding[o.kind] || 0) + 1; if (stat.samples.b.length < 8) stat.samples.b.push([o.kind, Math.round(o.x), Math.round(o.z)]); }
      if (h.includes('w') && !allowWater.has(o.kind)) { stat.onWater[o.kind] = (stat.onWater[o.kind] || 0) + 1; if (stat.samples.w.length < 8) stat.samples.w.push([o.kind, Math.round(o.x), Math.round(o.z)]); }
    }
    // not-on-water-but-should-be: boats not on water
    const boats = props.filter((o) => o.kind === 'boat' || o.kind === 'ferry' || o.kind === 'swan');
    stat.boatsOffWater = boats.filter((o) => !hit(o.x, o.z).includes('w')).length; stat.boats = boats.length;
    // movers over time
    const tr = L.traffic; const list = tr.list || [];
    stat.movers = list.length;
    const mv = { inB: {}, inW: {}, ex: [] };
    const sample = () => { for (const m of list) { const o = m.obj || m; if (o.state !== 0 && o.state !== undefined) continue; const x = m.x ?? o.x, z = m.z ?? o.z; if (x === undefined) continue; const h = hit(x, z); if (h.includes('b')) { mv.inB[o.kind || m.kind] = (mv.inB[o.kind || m.kind] || 0) + 1; if (mv.ex.length < 6) mv.ex.push(['inB', o.kind || m.kind, Math.round(x), Math.round(z)]); } if (h.includes('w') && !allowWater.has(o.kind || m.kind)) { mv.inW[o.kind || m.kind] = (mv.inW[o.kind || m.kind] || 0) + 1; if (mv.ex.length < 12) mv.ex.push(['inW', o.kind || m.kind, Math.round(x), Math.round(z)]); } } };
    stat.moverSampleKeys = list[0] ? Object.keys(list[0]).slice(0, 20) : null;
    for (let i = 0; i < 12; i++) { sample(); await new Promise((r) => setTimeout(r, 1000)); }
    stat.mv = mv;
    // y anomalies: instanced meshes can't be read easily; skip
    return stat;
  });
  note(`SCAN ${map} ` + JSON.stringify(res));
  await p.context().close();
}
await b.close();
