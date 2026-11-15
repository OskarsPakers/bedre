// Builds public/data/riga-areas.json: Riga's apkaimes (neighbourhoods) as simple polygons in the game's local metres.
// Source: Riga municipality open layer "Apkaimes_updated" (ArcGIS FeatureServer, public). Cached under tools/.cache/meta.
// Projection = tools/build-data.mjs (origin lat 56.9515 lon 24.1133, x east, z south). Re-run after the map bounds change:  node tools/meta/areas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = path.join(root, 'tools', '.cache', 'meta');
fs.mkdirSync(cache, { recursive: true });
const URL_ = 'https://services-eu1.arcgis.com/JzVauvrMa89dBJ9D/arcgis/rest/services/Apkaimes_updated/FeatureServer/10/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';
const file = path.join(cache, 'apkaimes.geojson');
if (!fs.existsSync(file) || process.argv.includes('--refresh')) {
  const r = await fetch(URL_, { headers: { 'user-agent': 'bedre-meta-build/1.0' } });
  if (!r.ok) throw new Error('apkaimes fetch failed ' + r.status);
  fs.writeFileSync(file, await r.text());
}
const gj = JSON.parse(fs.readFileSync(file, 'utf8'));

const ORIGIN = { lat: 56.9515, lon: 24.1133 };
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const proj = ([lon, lat]) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];

// one areas file for every map: the union of all map bounds (tools/maps.mjs; shared projection)
const { MAPS } = await import('../maps.mjs');
const B = { minX: Math.min(...MAPS.map((m) => m.bounds.minX)), maxX: Math.max(...MAPS.map((m) => m.bounds.maxX)), minZ: Math.min(...MAPS.map((m) => m.bounds.minZ)), maxZ: Math.max(...MAPS.map((m) => m.bounds.maxZ)) }, PAD = 250;

const NAMES = { // [lv, en]
  Vecpilsēta: ['Vecrīga', 'Old Town'], Centrs: ['Centrs', 'Centre'], Latgale: ['Maskavas forštate', 'Moscow Suburb'],
  'Pētersala-Andrejsala': ['Pētersala-Andrejsala', 'Pētersala-Andrejsala'], Ķīpsala: ['Ķīpsala', 'Ķīpsala'],
  Āgenskalns: ['Āgenskalns', 'Āgenskalns'], Torņakalns: ['Torņakalns', 'Torņakalns'], Avoti: ['Avoti', 'Avoti'],
  Grīziņkalns: ['Grīziņkalns', 'Grīziņkalns'], Skanste: ['Skanste', 'Skanste'], Sarkandaugava: ['Sarkandaugava', 'Sarkandaugava'],
  Mežaparks: ['Mežaparks', 'Mežaparks'],
};
const LEFT = new Set(['Āgenskalns', 'Ķīpsala', 'Torņakalns', 'Zasulauks', 'Iļģuciems', 'Zolitūde', 'Imanta', 'Ziepniekkalns', 'Bolderāja',
  'Daugavgrīva', 'Katlakalns', 'Dzirciems', 'Bieriņi', 'Voleri', 'Pleskodāle', 'Mangaļsala', 'Bišumuiža', 'Šampēteris', 'Kleisti']);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function dp(pts, eps) { // Douglas-Peucker on a closed ring
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function clipZ(ring, z0, keepBelow) { // half-plane clip (Sutherland-Hodgman): keep z < z0 (keepBelow) or z >= z0
  const inside = (p) => (keepBelow ? p[1] < z0 : p[1] >= z0), out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) { const u = (z0 - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * u, z0]); }
  }
  return out;
}
const rd = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

const areas = [];
for (const f of gj.features) {
  const name = f.properties.apkaime;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const pc of polys) {
    let ring = pc[0].map(proj);
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    if (Math.max(...xs) < B.minX - PAD || Math.min(...xs) > B.maxX + PAD || Math.max(...zs) < B.minZ - PAD || Math.min(...zs) > B.maxZ + PAD) continue;
    ring = ring.slice(0, -1); const mid = Math.floor(ring.length / 2); ring = dp(ring.slice(0, mid + 1), 4).slice(0, -1).concat(dp(ring.slice(mid).concat([ring[0]]), 4).slice(0, -1));
    const [lv, en] = NAMES[name] || [name, name];
    if (name === 'Centrs') { // carve the Quiet Centre (Jugendstil quarter, north of Elizabetes iela, z < -640 in game coordinates)
      const north = clipZ(ring, -640, true), south = clipZ(ring, -640, false);
      if (north.length > 2) areas.push({ id: 'klusais-centrs', lv: 'Klusais centrs', en: 'Quiet Centre', bank: 'R', poly: north.map(rd) });
      if (south.length > 2) areas.push({ id: 'centrs', lv, en, bank: 'R', poly: south.map(rd) });
      continue;
    }
    areas.push({ id: slug(name), lv, en, bank: LEFT.has(name) ? 'L' : 'R', poly: ring.map(rd) });
  }
}
const out = { source: 'Rīgas valstspilsētas pašvaldība, Apkaimes (open data, ArcGIS FeatureServer)', bounds: B, areas };
fs.writeFileSync(path.join(root, 'public', 'data', 'riga-areas.json'), JSON.stringify(out));
console.log(areas.length, 'areas:', areas.map((a) => a.id + '(' + a.poly.length + ')').join(' '));
