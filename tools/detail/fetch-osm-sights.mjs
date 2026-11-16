// Overpass: every OSM building that carries a sight-relevant tag, whether or not it has a name / height / levels (the base cache only keeps buildings with one of those).
//   node tools/detail/fetch-osm-sights.mjs [--map=<slug>|all]  -> tools/.cache/osm_sights_<slug>.json   (cached: delete the file to refetch; polite: 1 request at a time, generic UA, backoff)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS } from '../maps.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = { lat: 56.9515, lon: 24.1133 };
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const arg = (process.argv.find((a) => a.startsWith('--map=')) || '--map=all').slice(6);
const URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const m of MAPS.filter((x) => arg === 'all' || x.slug === arg)) {
  const out = path.join(root, 'tools/.cache', `osm_sights_${m.slug}.json`);
  if (fs.existsSync(out)) { console.log('cached', out); continue; }
  const b = m.bounds, s = ORIGIN.lat - b.maxZ / M_LAT, n = ORIGIN.lat - b.minZ / M_LAT, w = ORIGIN.lon + b.minX / M_LON, e = ORIGIN.lon + b.maxX / M_LON;
  const bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const q = `[out:json][timeout:120];(` +
    `way["building"]["building:material"~"^(wood|timber)$"](${bb});` +
    `way["building"]["heritage"](${bb});way["building"]["historic"](${bb});way["building"]["tourism"](${bb});` +
    `way["building"]["amenity"~"^(theatre|cinema|arts_centre|library|university|college|school|kindergarten|hospital|clinic|townhall|courthouse|embassy|police|fire_station|post_office|marketplace|place_of_worship|community_centre|bus_station|ferry_terminal|bank|events_venue|exhibition_centre)$"](${bb});` +
    `way["building"~"^(church|cathedral|chapel|synagogue|mosque|temple|train_station|transportation|civic|public|government|university|school|hospital|hotel|museum|stadium|sports_hall|tower|castle|palace|gatehouse|bridge|hangar|market|kindergarten)$"](${bb});` +
    `way["building"]["shop"~"^(mall|department_store|supermarket)$"](${bb});way["building"]["leisure"~"^(stadium|sports_centre)$"](${bb});way["building"]["man_made"~"^(tower|water_tower|chimney)$"](${bb});way["man_made"~"^(tower|water_tower|chimney)$"](${bb});` +
    `way["building"]["office"~"^(government|diplomatic)$"](${bb}););out tags geom;`;
  let done = false;
  for (let attempt = 0; attempt < 6 && !done; attempt++) {
    const url = URLS[attempt % URLS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'riga-game-data-builder', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(130000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      fs.writeFileSync(out, JSON.stringify(j));
      console.log(m.slug, j.elements.length, 'elements ->', out);
      done = true;
    } catch (err) { const wait = 8000 * 2 ** attempt; console.log(m.slug, 'retry in', wait / 1000, 's:', err.message); await sleep(wait); }
  }
  if (!done) { console.error('failed', m.slug); process.exit(1); }
  await sleep(4000);
}
