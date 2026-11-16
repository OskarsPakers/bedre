import fs from 'node:fs'; import { QC } from './lib.mjs';
const out = {};
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const B = JSON.parse(fs.readFileSync(`${QC}/bld-${slug}.json`));
  const al = B.filter((r) => r.al && r.al.s >= 0.3 && r.al.s - r.al.s0 >= 0 && r.fine !== undefined);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const mag = al.map((r) => Math.hypot(r.al.dx, r.al.dz)); const sm = [...mag].sort((a, b) => a - b);
  const cells = {}; for (const r of al) { const k = `${Math.floor(r.x / 500) * 500},${Math.floor(r.z / 500) * 500}`; (cells[k] ||= []).push(r); }
  const cellRows = Object.entries(cells).filter(([, v]) => v.length >= 15).map(([k, v]) => ({ cell: k, n: v.length, mdx: med(v.map((r) => r.al.dx)), mdz: med(v.map((r) => r.al.dz)), p90: [...v.map((r) => Math.hypot(r.al.dx, r.al.dz))].sort((a, b) => a - b)[Math.floor(v.length * 0.9)] }));
  const off = al.filter((r) => Math.hypot(r.al.dx, r.al.dz) > 3 && r.al.s - r.al.s0 >= 0.15 && r.area >= 150).map((r) => ({ id: r.id, name: r.name, t: r.t, x: r.x, z: r.z, area: r.area, dx: r.al.dx, dz: r.al.dz, s: r.al.s, s0: r.al.s0, sight: r.sight && r.sight.tier })).sort((a, b) => (b.sight !== null && b.sight !== undefined ? 1 : 0) - (a.sight !== null && a.sight !== undefined ? 1 : 0) || (b.area * Math.hypot(b.dx, b.dz)) - (a.area * Math.hypot(a.dx, a.dz)));
  out[slug] = { n: al.length, medDx: med(al.map((r) => r.al.dx)), medDz: med(al.map((r) => r.al.dz)), p50: +sm[sm.length >> 1].toFixed(1), p90: +sm[Math.floor(sm.length * 0.9)].toFixed(1), gt2: al.filter((r) => Math.hypot(r.al.dx, r.al.dz) > 2).length, gt3: al.filter((r) => Math.hypot(r.al.dx, r.al.dz) > 3).length, cellRows: cellRows.filter((c) => Math.hypot(c.mdx, c.mdz) >= 1).slice(0, 12), off: off.slice(0, 40) };
}
fs.writeFileSync(`${QC}/align.json`, JSON.stringify(out));
for (const [k, v] of Object.entries(out)) console.log(k, v.n, 'median shift', v.medDx, v.medDz, 'p50', v.p50, 'p90', v.p90, '>2m', v.gt2, '>3m', v.gt3, 'cells w/ |med|>=1:', JSON.stringify(v.cellRows.slice(0, 5)));
console.log(JSON.stringify(out.centrs.off.slice(0, 12)));
