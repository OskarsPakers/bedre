// view list: [{map,key,name,x,z,y,dist,el,az,kind}] -> tools/.cache/qa-map/views.json
import fs from 'node:fs';
import { QC, readJson } from './lib.mjs';
const G = {}; for (const m of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) { G[m] = readJson(`${QC}/game-${m}.json`); }
const byId = (m, id) => G[m].find((g) => g.id === id);
const V = [];
const S = (map, key, name, id, o = {}) => { const g = byId(map, id); if (!g) { console.log('MISSING id', id, name); return; } const h = Math.max(o.h || g.h, 8); V.push({ map, key, name, id, x: o.x ?? g.x, z: o.z ?? g.z, y: o.y ?? Math.min(0.4 * h, 30), dist: o.dist ?? Math.max(110, Math.sqrt(g.area) * 2.3 + h * 1.6), el: o.el ?? 26, az: o.az ?? 200, kind: 'sight', h, area: g.area }); };
const P = (map, key, name, x, z, o = {}) => V.push({ map, key, name, x, z, y: o.y ?? 8, dist: o.dist ?? 150, el: o.el ?? 26, az: o.az ?? 200, kind: o.kind || 'place' });
// Old Town
S('centrs', 'peter', 'Sv. Pētera baznīca', 49614351, { dist: 190, el: 20, y: 40 });
S('centrs', 'dome', 'Rīgas Doms', 49614755, { dist: 170, el: 22, y: 18 });
S('centrs', 'jekab', 'Sv. Jēkaba katedrāle', 49614946, { dist: 150, az: 240 });
S('centrs', 'jani', 'Sv. Jāņa baznīca', 49614438, { dist: 110 });
S('centrs', 'townhall', 'Rātsnams', 49614687, { dist: 130 });
S('centrs', 'blackheads', 'Melngalvju nams', 49614347, { dist: 100 });
S('centrs', 'brothers', 'Trīs brāļi', 49614971, { dist: 90, az: 150 });
S('centrs', 'guild-great', 'Lielā ģilde', 49616381, { dist: 110 });
S('centrs', 'guild-small', 'Mazā ģilde', 49616364, { dist: 100 });
S('centrs', 'cathouse', 'Kaķu nams', 49616370, { dist: 100, az: 160 });
S('centrs', 'powder', 'Pulvertornis', 49615275, { dist: 90, y: 14 });
S('centrs', 'swedish', 'Zviedru vārti', 49614979, { dist: 80, az: 160 });
S('centrs', 'castle', 'Rīgas pils', 49615051, { dist: 230, az: 150 });
S('centrs', 'saeima', 'Saeima', 49614901, { dist: 110, az: 220 });
S('centrs', 'occupation', 'Okupācijas muzejs', 49614381, { dist: 110, az: 160 });
// boulevard ring
P('centrs', 'freedom', 'Brīvības piemineklis', 3.4, -1.5, { dist: 140, y: 20, kind: 'sight' });
S('centrs', 'opera', 'Nacionālā opera', 49616059, { dist: 190, az: 230 });
S('centrs', 'university', 'Latvijas Universitāte', 49616039, { dist: 190, az: 200 });
S('centrs', 'theatre', 'Nacionālais teātris', 49614719, { dist: 140, az: 200 });
S('centrs', 'artmuseum', 'Mākslas muzejs', 49615452, { dist: 170, az: 170 });
S('centrs', 'artacademy', 'Mākslas akadēmija', 49615853, { dist: 130, az: 170 });
S('centrs', 'nativity', 'Kristus Piedzimšanas katedrāle', 49615771, { dist: 150, az: 200, y: 20 });
S('centrs', 'congress', 'Kongresu nams', 49616534, { dist: 160, az: 150 });
P('centrs', 'laima', 'Laimas pulkstenis', -80.2, 117.8, { dist: 70, y: 8, kind: 'sight' });
P('centrs', 'bastejkalns', 'Bastejkalns', -560, -110, { dist: 220, el: 30, kind: 'sight' });
// centre
P('centrs', 'oldgertrude', 'Vecā Ģertrūdes baznīca', 506.6, -719.9, { dist: 120, y: 14, kind: 'sight' });
P('centrs', 'nevsky', 'Sv. Aleksandra Ņevska baznīca', 490.2, -504.7, { dist: 110, y: 12, kind: 'sight' });
S('centrs', 'hotel-latvija', 'Hotel Latvija', 49619752, { dist: 260, el: 18, y: 35 });
S('centrs', 'origo', 'Origo', 49614964, { dist: 220, az: 160 });
S('centrs', 'station', 'Centrālā stacija', 49614666, { dist: 220, az: 160 });
S('centrs', 'market', 'Centrāltirgus', 49614728, { dist: 330, el: 30, az: 120 });
S('centrs', 'academy', 'Zinātņu akadēmija', 49628422, { dist: 220, el: 20, y: 30, az: 200 });
S('centrs', 'spikeri', 'Spīķeri', 49614933, { dist: 260, az: 230 });
S('centrs', 'circus', 'Rīgas cirks', 49615676, { dist: 130 });
S('centrs', 'daile', 'Dailes teātris', 49621082, { dist: 260, az: 220 });
S('centrs', 'splendid', 'Splendid Palace', 49619824, { dist: 100 });
S('centrs', 'bank', 'Latvijas Banka', 49615814, { dist: 130 });
S('centrs', 'lbn', 'Latviešu biedrības nams', 49615638, { dist: 120 });
// left bank
S('centrs', 'library', 'Nacionālā bibliotēka', 49629679, { dist: 300, az: 90, el: 22, y: 25 });
S('centrs', 'saulesakmens', 'Saules akmens', 49639844, { dist: 330, az: 90, el: 16, y: 55 });
S('centrs', 'ztowers', 'Z-Towers', 49637749, { dist: 330, az: 90, el: 16, y: 55 });
S('centrs', 'presesnams', 'Preses nams', 49639106, { dist: 300, az: 90, el: 16, y: 35 });
S('centrs', 'radisson-daugava', 'Radisson Blu Daugava', 49629591, { dist: 260, az: 90, el: 18 });
P('centrs', 'uzvaras', 'Uzvaras parks', -1713.6, 1426.6, { dist: 330, el: 30, kind: 'sight' });
P('centrs', 'kipsala', 'Ķīpsala', -1250, 760, { dist: 500, el: 28, az: 80, kind: 'sight' });
// bridges
P('centrs', 'bridge-akmens', 'Akmens tilts (brg -933..-531, 576..948)', -732, 762, { dist: 420, el: 25, az: 120, kind: 'bridge' });
P('centrs', 'bridge-vansu', 'tilts (brg -839..-158, 844..1381)', -498, 1112, { dist: 520, el: 25, az: 100, kind: 'bridge' });
P('centrs', 'bridge-3', 'tilts (brg -1377..-741, -95..152)', -1060, 30, { dist: 380, el: 25, az: 150, kind: 'bridge' });
// districts
S('agenskalns', 'ag-market', 'Āgenskalna tirgus', 49634808, { dist: 140 });
S('agenskalns', 'ag-wooden', 'Kalnciema koka nami', 49636186, { dist: 110 });
S('agenskalns', 'ag-arhivs', 'Valsts vēstures arhīvs', 49637896, { dist: 170 });
S('agenskalns', 'ag-da-vinci', 'Da Vinci', 49639148, { dist: 260 });
S('agenskalns', 'ag-b3', 'B3 korpuss', 49634685, { dist: 200 });
S('mezaparks', 'mp-estrade', 'Lielā estrāde', 49673065, { dist: 330, az: 160, el: 28 });
S('mezaparks', 'mp-tropu', 'Tropu māja', 49672040, { dist: 150 });
S('mezaparks', 'mp-keizarmezs', 'Ķeizarmežs', 49665346, { dist: 200 });
P('mezaparks', 'mp-villas', 'villas near Mežaparka lielā estrāde S', 2600, -6400, { dist: 220, kind: 'street' });
P('mezaparks', 'mp-villas2', 'villas (-2 - Mežaparks centre)', 3000, -6100, { dist: 220, kind: 'street' });
S('purvciems', 'pc-nicgales26', 'Nīcgales iela 26', 49648478, { dist: 220 });
S('purvciems', 'pc-astras', 'Astras biroji', 49646439, { dist: 220 });
S('purvciems', 'pc-mebelu', 'Mēbeļu nams', 49645026, { dist: 300 });
S('purvciems', 'pc-astrasbiz', 'Astras biznesa centrs', 49646321, { dist: 220 });
S('purvciems', 'pc-barenu', 'Bāreņu aprūpes centrs', 49645032, { dist: 180 });
// streets: seeded picks from buildings with good mesh coverage
const B = {}; for (const m of Object.keys(G)) B[m] = readJson(`${QC}/bld-${m}.json`);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const streets = { centrs: 8, agenskalns: 4, mezaparks: 3, purvciems: 4 };
for (const [m, n] of Object.entries(streets)) {
  const c = B[m].filter((r) => r.t === 'res' && r.area > 300 && r.area < 1500 && r.cover > 0.9 && r.m50 !== undefined);
  for (let i = 0; i < n; i++) { const r = c[Math.floor(rnd() * c.length)]; P(m, `street-${m}-${i + 1}`, `street ${m} #${i + 1}`, r.x, r.z, { dist: 170, el: 24, az: Math.floor(rnd() * 360), kind: 'street' }); }
}
fs.writeFileSync(`${QC}/views.json`, JSON.stringify(V, null, 1));
console.log(V.length, 'views');
