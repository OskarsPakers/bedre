// Sights: every important sight / building of a map, found automatically and generously, deduplicated, categorised and tiered.
//   node tools/detail/sights.mjs [--map=<slug>|all]        (default all)
// Output: tools/detail/data/sights-<map>.json (full records), public/data/<map>/sights.json (compact client file, centre: public/data/sights.json),
//         tools/detail/audit-sights.md (readable list; the tier A verdict table is kept by hand below the generated part, see audit-sights.tail.md)
// Inputs (offline): public/data/<map>/riga.json (cadastre footprints, `n` names, `t` types, `landmarks`), the cached OSM building download
// tools/.cache/osm_buildings_<sfx>.json + osm_misc_<sfx>.json (tags: amenity, tourism, historic, building, man_made, leisure, shop, office, ...), src/meta/album.js (album rules).
// Sources of a sight (field `why`): album, landmark, osm-name, t:pub|rel, tag:<k>=<v>, tall (>= 30 m), tierA.
// Not downloaded again: the cache only holds OSM buildings that carry a name, a height or levels, so an unnamed, level-less school would be missed (it is still found via t=pub).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATS, CAT_IDX, TIER_A, FEAT_HINT } from '../../src/sights.js';
import { MAPS } from '../maps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ORIGIN = { lat: 56.9515, lon: 24.1133 };
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const arg = (process.argv.find((a) => a.startsWith('--map=')) || '--map=all').slice(6);

const RE_ADDR = /(\s\d+[A-Za-zĀ-ž]?(\s*k-\d+)?([\s]*[-/][\s]*\d+[A-Za-zĀ-ž]?)?$)|^Bez adreses/;
const isAddr = (n) => !n || RE_ADDR.test(n);
const area2 = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; } return Math.abs(a / 2); };
const cen = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
function pip(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }

/** album rules: ids + name regexes parsed from src/meta/album.js (RULES rows built with nm(/re/)) */
function albumRules() {
  const src = fs.readFileSync(path.join(root, 'src/meta/album.js'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/\['(\w+)', '([^']*)', '([^']*)', '(\w+)', nm\((\/.*?\/[a-z]*)\)/g)) { try { out.push({ id: m[1], lv: m[2], en: m[3], re: eval(m[5]) }); } catch { /* skip */ } } // eslint-disable-line no-eval
  return out;
}

/** category from OSM tags (first match wins); returns [cat, tagLabel] or null */
export function catFromTags(t) {
  const b = t.building || '', am = t.amenity || '', to = t.tourism || '', hi = t.historic || '', mm = t.man_made || '', le = t.leisure || '', sh = t.shop || '', of = t.office || '';
  if (am === 'place_of_worship' || ['church', 'cathedral', 'chapel', 'synagogue', 'mosque', 'temple'].includes(b)) return ['church', am ? 'amenity=' + am : 'building=' + b];
  if (['castle', 'fort', 'city_wall', 'tower', 'citywalls'].includes(hi) || b === 'castle' || ['gatehouse'].includes(b) && hi) return ['castle', hi ? 'historic=' + hi : 'building=' + b];
  if (hi === 'city_gate' || b === 'gatehouse') return ['historic', hi ? 'historic=' + hi : 'building=gatehouse'];
  if (b === 'train_station' || b === 'transportation' || b === 'bridge' || am === 'bus_station' || am === 'ferry_terminal' || t.railway === 'station' || t.public_transport === 'station') return ['station', am ? 'amenity=' + am : 'building=' + b];
  if (am === 'marketplace' || b === 'market' || sh === 'mall' || sh === 'department_store' || (b === 'retail' && false)) return ['market', am ? 'amenity=' + am : sh ? 'shop=' + sh : 'building=' + b];
  if (['theatre', 'cinema', 'arts_centre', 'community_centre', 'library', 'events_venue', 'concert_hall', 'exhibition_centre', 'studio'].includes(am) || to === 'gallery' || b === 'gallery') return ['theatre', 'amenity=' + am];
  if (to === 'museum' || b === 'museum') return ['museum', to ? 'tourism=museum' : 'building=museum'];
  if (['school', 'kindergarten', 'college', 'university'].includes(am) || ['school', 'university', 'kindergarten', 'college', 'education', 'dormitory'].includes(b) || of === 'educational_institution') return ['school', am ? 'amenity=' + am : 'building=' + b];
  if (['hospital', 'clinic', 'doctors', 'dentist'].includes(am) || b === 'hospital') return ['hospital', am ? 'amenity=' + am : 'building=hospital'];
  if (['townhall', 'courthouse', 'embassy', 'police', 'fire_station', 'post_office', 'prison'].includes(am) || of === 'government' || of === 'diplomatic' || ['government', 'civic'].includes(b)) return ['gov', am ? 'amenity=' + am : of ? 'office=' + of : 'building=' + b];
  if (to === 'hotel' || b === 'hotel' || to === 'hostel') return ['hotel', to ? 'tourism=' + to : 'building=hotel'];
  if (le === 'stadium' || le === 'sports_centre' || b === 'stadium' || b === 'sports_hall' || le === 'swimming_pool') return ['sports', le ? 'leisure=' + le : 'building=' + b];
  if (mm === 'chimney' || mm === 'water_tower' || mm === 'works' || mm === 'silo') return ['industrial', 'man_made=' + mm];
  if (mm === 'tower' || mm === 'observatory' || mm === 'lighthouse') return ['tower', 'man_made=' + mm];
  if (hi && hi !== 'yes' || hi === 'yes' || to === 'attraction') return ['historic', hi ? 'historic=' + hi : 'tourism=attraction'];
  if (am === 'bank' || b === 'public') return ['public', am ? 'amenity=' + am : 'building=public'];
  if (b === 'hangar' || b === 'warehouse' && false) return ['industrial', 'building=' + b];
  return null;
}

function loadJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function osmItems(slug) {
  const sfx = slug === 'centrs' ? '_v2' : '_' + slug;
  const out = [];
  const seen = new Set();
  for (const f of [`osm_buildings${sfx}.json`, `osm_misc${sfx}.json`, `osm_sights_${slug}.json`]) { // the last one: tools/detail/fetch-osm-sights.mjs (sight-tagged buildings regardless of name / height)
    const j = loadJson(path.join(root, 'tools/.cache', f));
    if (!j) continue;
    for (const e of j.elements) {
      const key = e.type + e.id;
      if (seen.has(key)) continue;
      const t = e.tags || {};
      if (!Object.keys(t).length) continue;
      let ring = null, pt = null;
      if (e.geometry && e.geometry.length >= 3) { ring = e.geometry.map((g) => proj(g.lon, g.lat)); pt = cen(ring); }
      else if (e.type === 'node' && e.lat != null) pt = proj(e.lon, e.lat);
      else if (e.members) { const m = e.members.find((q) => q.geometry && q.geometry.length >= 3 && (q.role === 'outer' || !q.role)); if (m) { ring = m.geometry.map((g) => proj(g.lon, g.lat)); pt = cen(ring); } }
      if (!pt) continue;
      seen.add(key);
      out.push({ key, t, ring, pt, name: t.name || t['name:lv'] || null, nameEn: t['name:en'] || null, building: !!(t.building && t.building !== 'no') });
    }
  }
  return out;
}

const TALL = 30;
const WOODEN_ZONES = { agenskalns: { id: 49636186, r: 450 } };
const dropped = { named: 0, tallRes: 0 };
/** default category of a named / landmark building without a tag-derived category, from the cadastre type; null = plain housing or shop, not a sight */
function catFromT(b, named) {
  if (!b) return null;
  if (b.t === 'rel') return 'church';
  if (b.t === 'pub' || b.t === 'oth') return 'public';
  if (b.t === 'ind') return b.area >= 800 ? 'industrial' : null;
  if (b.t === 'com') return b.area >= 1200 || b.h >= 24 ? (b.h >= TALL ? 'tower' : 'market') : null;
  if (b.t === 'res') return b.h >= 24 && b.area >= 1000 ? 'historic' : null;
  return null;
}

function build(map) {
  const pub = path.join(root, 'public/data', map.slug === 'centrs' ? '' : map.slug);
  const city = JSON.parse(fs.readFileSync(path.join(pub, 'riga.json'), 'utf8'));
  const B = city.buildings.map((b) => ({ id: b.id, p: b.p, h: b.h, t: b.t, n: b.n || null, c: cen(b.p), area: area2(b.p) }));
  // spatial index (40 m cells)
  const CELL = 40, grid = new Map();
  const ck = (i, j) => i + ',' + j;
  B.forEach((b, idx) => {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const q of b.p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    b.bb = [x0, z0, x1, z1];
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = ck(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(idx); }
  });
  const near = (x, z, r = 0) => { const s = new Set(); for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) for (const k of grid.get(ck(i, j)) || []) s.add(k); return [...s].map((k) => B[k]); };
  const containing = (x, z) => near(x, z).filter((b) => pip(x, z, b.p));

  const S = new Map(); // lead id -> sight
  const byId = new Map(); // any piece id -> sight
  const add = (ids, why, over = {}) => {
    ids = [...new Set(ids)].filter((i) => B.some((b) => b.id === i));
    if (!ids.length) return null;
    // merge into an existing sight when any piece already belongs to one
    let s = null;
    for (const i of ids) if (byId.has(i)) { s = byId.get(i); break; }
    if (!s) { s = { ids: [], why: [], tags: {}, cat: null, name: null, nameEn: null }; }
    for (const i of ids) if (!s.ids.includes(i)) { s.ids.push(i); byId.set(i, s); }
    for (const w of [].concat(why)) if (!s.why.includes(w)) s.why.push(w);
    for (const [k, v] of Object.entries(over)) { if (v != null && (s[k] == null || over.force)) s[k] = v; }
    return s;
  };
  const bById = new Map(B.map((b) => [b.id, b]));

  // 1. OSM elements with sight tags
  for (const e of osmItems(map.slug)) {
    const c = catFromTags(e.t);
    const hasHeightMeta = e.t.height || e.t['building:levels'];
    const named = e.name && !isAddr(e.name);
    const big = (e.t.building === 'retail' || e.t.building === 'supermarket' || e.t.building === 'commercial' || e.t.building === 'office');
    if (!c && !(named && e.building) && !(e.t['building:material'] === 'wood' && map.slug === 'agenskalns') && !(e.t.heritage && named)) continue;
    if (!c && big && !named) continue;
    if (!c && (e.t.shop || ['fuel', 'restaurant', 'cafe', 'fast_food', 'bar', 'car_wash', 'parking', 'toilets', 'shelter'].includes(e.t.amenity)) && !e.t.heritage) { if (!(e.t.shop && ['supermarket', 'mall', 'department_store', 'doityourself', 'electronics', 'furniture'].includes(e.t.shop))) { dropped.named++; continue; } }
    let ids = [];
    if (e.ring) {
      for (const b of near(e.pt[0], e.pt[1], 40)) { if (pip(b.c[0], b.c[1], e.ring) || pip(e.pt[0], e.pt[1], b.p)) ids.push(b.id); }
    } else ids = containing(e.pt[0], e.pt[1]).map((b) => b.id);
    if (!ids.length) continue;
    // a huge OSM polygon (park, campus) must not swallow dozens of unrelated houses: keep pieces that are not much smaller than the lead or are sizeable
    const cand = ids.map((i) => bById.get(i)).sort((a, b) => b.area - a.area);
    ids = cand.filter((b) => b.area >= Math.max(40, cand[0].area * 0.04)).slice(0, 8).map((b) => b.id);
    const wood = e.t['building:material'] === 'wood' || e.t['roof:material'] === 'wood';
    const lead0 = cand[0];
    const cat = c ? c[0] : wood && !named ? 'wooden' : e.t.heritage ? 'historic' : catFromT(lead0, true);
    if (!cat) { dropped.named++; continue; }
    const why = [];
    if (c) why.push('tag:' + c[1]);
    if (named) why.push('osm-name');
    if (wood) why.push('tag:building:material=wood');
    if (e.t.heritage) why.push('tag:heritage');
    const s = add(ids, why, { name: named ? e.name : null, nameEn: e.nameEn });
    if (s && e.t.man_made === 'water_tower') s.hint = 'watertower';
    if (s && e.t.man_made === 'chimney') s.hint = 'chimney';
    if (s) { if (!s.cats) s.cats = []; s.cats.push(cat); s.tagBuilding = e.t.building || s.tagBuilding; if (e.t.height) s.tagH = parseFloat(e.t.height); }
  }
  // 2. cadastre: t=pub / rel, named non-address, tall
  for (const b of B) {
    const named = b.n && !isAddr(b.n);
    if (b.t === 'pub' || b.t === 'rel') { if (b.area >= 90 || named || b.t === 'rel') { const s = add([b.id], 't:' + b.t, { name: named ? b.n : null }); if (s) (s.cats ||= []).push(b.t === 'rel' ? 'church' : 'public'); } }
    if (named && b.area >= 150 && b.t !== 'aux') { const c0 = catFromT(b, true); if (c0) { const s = add([b.id], 'osm-name', { name: b.n }); if (s) (s.cats ||= []).push(c0); } else dropped.named++; }
    if (b.h >= TALL && b.t !== 'aux') { if (b.t === 'res') dropped.tallRes++; else { const s = add([b.id], 'tall', {}); if (s) (s.cats ||= []).push(b.t === 'ind' ? 'industrial' : b.t === 'pub' ? 'public' : 'tower'); } }
  }
  // 2b. wooden-house quarter: OSM carries almost no building:material=wood (1 in Āgenskalns), so the district's wooden houses are taken as the small detached
  // residential houses (60-400 m2, <= 11 m) within WOODEN_ZONES.r of the Kalnciema quarter (a documented heuristic, not a survey)
  const WZ = WOODEN_ZONES[map.slug];
  if (WZ && bById.get(WZ.id)) {
    const a0 = bById.get(WZ.id);
    for (const b of B) if (b.t === 'res' && b.area >= 60 && b.area <= 400 && b.h <= 11 && Math.hypot(b.c[0] - a0.c[0], b.c[1] - a0.c[1]) <= WZ.r && !byId.has(b.id)) { const s = add([b.id], 'wooden-quarter', {}); if (s) (s.cats ||= []).push('wooden'); }
  }
  // 3. landmarks (riga.json) and album rules: match the nearest building (inside or within 40 m, area >= 60)
  const rules = albumRules();
  for (const lm of city.landmarks || []) {
    if (/piemineklis|pulkstenis|parks$|koki$|rats$|^Šerloks|^Jauniela|^Dhanvantari|^Ganden|^Atklāsme/i.test(lm.n) && !/baznīca/.test(lm.n)) continue; // props / parks / non-building spots
    let best = null, bd = 1e9;
    for (const b of near(lm.x, lm.z, 45)) { if (b.area < 60 || b.t === 'aux' && b.area < 150) continue; const d = pip(lm.x, lm.z, b.p) ? -1e3 + Math.hypot(lm.x - b.c[0], lm.z - b.c[1]) : Math.hypot(lm.x - b.c[0], lm.z - b.c[1]); if (d < bd) { bd = d; best = b; } }
    if (best && bd < 40) { const s = add([best.id], 'landmark', { name: lm.n }); if (s) (s.cats ||= []).push(/baznīca|katedrāle|sinagoga|doms|draudze/i.test(lm.n) ? 'church' : /tornis|vārti/i.test(lm.n) ? 'castle' : catFromT(best, true) || (best.t === 'com' ? 'market' : best.t === 'ind' ? 'industrial' : 'public')); }
  }
  for (const r of rules) {
    for (const b of B) if (b.n && r.re.test(b.n)) { const s = add([b.id], 'album:' + r.id, { name: r.lv, nameEn: r.en }); if (s) { s.album = r.id; (s.cats ||= []).push(CAT_OF_ALBUM[r.id] || 'public'); } }
  }
  // 4. tier A table (explicit ids / regexes / points), highest priority
  const A = new Map();
  for (const a of TIER_A) {
    if ((a.map || 'centrs') !== map.slug) continue;
    let ids = a.ids ? a.ids.slice() : [];
    if (a.re) for (const b of B) if (b.n && a.re.test(b.n) && (!a.minArea || b.area >= a.minArea)) ids.push(b.id);
    if (a.pt) { const [x, z] = a.pt; const ct = near(x, z, 30).filter((b) => b.area >= (a.minArea || 60)).sort((p, q) => Math.hypot(p.c[0] - x, p.c[1] - z) - Math.hypot(q.c[0] - x, q.c[1] - z))[0]; if (ct) ids.push(ct.id); }
    ids = ids.filter((i) => bById.has(i));
    if (!ids.length) { A.set(a.key, null); continue; }
    // a tier A entry owns its pieces: detach them from any earlier sight first
    for (const i of ids) { const old = byId.get(i); if (old && !old.tierAKey) { old.ids = old.ids.filter((q) => q !== i); byId.delete(i); } }
    const s = { ids: [], why: ['tierA'], tags: {}, cat: a.cat, name: a.lv, nameEn: a.en || a.lv, tierAKey: a.key, album: a.album || null, cats: [a.cat] };
    for (const i of ids) { if (!s.ids.includes(i)) s.ids.push(i); byId.set(i, s); }
    A.set(a.key, s);
  }

  // finalise
  const all = [...new Set(byId.values())].filter((s) => s.ids.length);
  for (const s of all) {
    const bs = s.ids.map((i) => bById.get(i)).sort((a, b) => b.area - a.area);
    s.lead = s.tierAKey && TIER_A.find((a) => a.key === s.tierAKey).lead ? TIER_A.find((a) => a.key === s.tierAKey).lead : bs[0].id;
    if (!s.ids.includes(s.lead)) s.lead = bs[0].id;
    s.ids.sort((a, b) => (a === s.lead ? -1 : b === s.lead ? 1 : 0));
    s.area = Math.round(bs.reduce((q, b) => q + b.area, 0));
    s.h = Math.max(...bs.map((b) => b.h));
    s.x = Math.round(bs[0].c[0]); s.z = Math.round(bs[0].c[1]);
    if (!s.cat) s.cat = pickCat(s);
    if (!s.name) { const nb = bs.find((b) => b.n && !isAddr(b.n)); s.name = nb ? nb.n : (bs[0].n || null); }
    s.tier = tierOf(s, map.slug);
  }
  // open yards / car parks the cadastre lists as 'aux' boxes (flat, < 4 m) are not buildings worth painting: drop such pieces (a sight with nothing left disappears)
  for (const s of all) {
    const keep = s.ids.filter((i) => { const b = bById.get(i); return !(b.t === 'aux' && b.h < 4 && !s.tierAKey); });
    if (keep.length !== s.ids.length) { for (const i of s.ids) if (!keep.includes(i)) byId.delete(i); s.ids = keep; dropped.yards = (dropped.yards || 0) + 1; }
  }
  for (const s of all) if (!s.ids.length) s.drop = true;
  for (const s of all) if (s.tier === 'C' && s.area < 150 && !['church', 'castle', 'historic', 'wooden'].includes(s.cat)) { s.drop = true; for (const i of s.ids) byId.delete(i); }
  for (const s of all) if (!s.drop) { const bs = s.ids.map((i) => bById.get(i)).sort((a, b) => b.area - a.area); s.area = Math.round(bs.reduce((q, b) => q + b.area, 0)); s.h = Math.max(...bs.map((b) => b.h)); if (!s.ids.includes(s.lead)) { s.lead = bs[0].id; s.ids.sort((a, b) => (a === s.lead ? -1 : b === s.lead ? 1 : 0)); s.x = Math.round(bs[0].c[0]); s.z = Math.round(bs[0].c[1]); } }
  const kept = all.filter((s) => !s.drop);
  // drop mere address-only tier C items that have no category evidence beyond t=pub tiny: keep only area >= 90 (done above)
  return { map: map.slug, sights: kept.sort((a, b) => a.tier.localeCompare(b.tier) || b.area - a.area), A };
}

const CAT_OF_ALBUM = { peter: 'church', dome: 'church', nativity: 'church', opera: 'theatre', castle: 'castle', powder: 'castle', blackheads: 'historic', cat: 'historic', market: 'market', academy: 'tower', library: 'theatre', saules: 'tower', ztowers: 'tower', presesnams: 'tower', agmarket: 'market', estrade: 'sports', tropu: 'public', brothers: 'historic', jekab: 'church', jani: 'church', swedish: 'castle', ratsnams: 'gov', theatre: 'theatre', dailes: 'theatre', art: 'school', radio: 'gov', circus: 'theatre', splendid: 'theatre', lbn: 'theatre', guilds: 'historic', univlib: 'school', spikeri: 'industrial', radisson: 'hotel' };
const PRIO = ['church', 'castle', 'station', 'market', 'theatre', 'museum', 'school', 'hospital', 'gov', 'hotel', 'sports', 'industrial', 'historic', 'tower', 'public', 'wooden'];
function pickCat(s) {
  const c = (s.cats || []).filter(Boolean);
  for (const p of PRIO) if (c.includes(p)) {
    if (p === 'tower' && c.some((q) => q !== 'tower' && q !== 'public')) continue;
    return p;
  }
  return 'public';
}
function tierOf(s, slug) {
  if (s.tierAKey) return 'A';
  if (s.album && (s.why.some((w) => w.startsWith('album')))) return 'A';
  if (s.h >= 60 && s.area > 400) return 'A';
  const named = s.name && !isAddr(s.name);
  const bigCat = ['church', 'theatre', 'museum', 'gov', 'station', 'castle', 'hotel', 'sports', 'market', 'historic', 'school', 'hospital', 'tower'].includes(s.cat);
  if (s.why.some((w) => w === 'landmark')) return 'B';
  if (named && bigCat && (s.area >= 250 || s.h >= 24 || ['church', 'castle', 'historic', 'theatre', 'museum'].includes(s.cat))) return 'B';
  if (s.h >= TALL && s.area > 300) return 'B';
  if (['school', 'hospital', 'church', 'station', 'market'].includes(s.cat) && s.area >= 500) return 'B';
  if (s.cat === 'wooden') return 'C';
  return 'C';
}

const maps = arg === 'all' ? MAPS : MAPS.filter((m) => m.slug === arg);
const report = [];
fs.mkdirSync(path.join(here, 'data'), { recursive: true });
for (const m of maps) {
  const res = build(m);
  const full = res.sights.map((s) => ({ hint: s.hint || null, key: s.tierAKey || null, name: s.name, en: s.nameEn || null, cat: s.cat, tier: s.tier, lead: s.lead, ids: s.ids, area: s.area, h: s.h, x: s.x, z: s.z, why: s.why, album: s.album || null }));
  fs.writeFileSync(path.join(here, 'data', `sights-${m.slug}.json`), JSON.stringify({ map: m.slug, generated: new Date().toISOString().slice(0, 10), count: full.length, sights: full, tierAMissing: [...res.A.entries()].filter(([, v]) => !v).map(([k]) => k) }, null, 1));
  // compact client file: id -> [cat, tier(0 A, 1 B, 2 C), lead(1/0), tier A key|null, feature hint index|null, piece index]
  const cs = {};
  for (const s of res.sights) s.ids.forEach((id, k) => { cs[id] = [CAT_IDX[s.cat], 'ABC'.indexOf(s.tier), id === s.lead ? 1 : 0, s.tierAKey || null, s.hint ? FEAT_HINT.indexOf(s.hint) : null, k]; });
  const outFile = path.join(root, 'public/data', m.slug === 'centrs' ? '' : m.slug, 'sights.json');
  fs.writeFileSync(outFile, JSON.stringify({ v: 1, cats: CATS.map((c) => c.id), s: cs }));
  const byTier = { A: 0, B: 0, C: 0 }; for (const s of full) byTier[s.tier]++;
  const byCat = {}; for (const s of full) byCat[s.cat] = (byCat[s.cat] || 0) + 1;
  console.log(`[sights ${m.slug}] ${full.length} sights (A ${byTier.A}, B ${byTier.B}, C ${byTier.C}); pieces ${Object.keys(cs).length}; tier A not found: ${[...res.A.entries()].filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}`);
  console.log('  by category', JSON.stringify(byCat), 'dropped named-only housing/shops', dropped.named, 'tall residential blocks (housing, not sights)', dropped.tallRes);
  dropped.named = 0; dropped.tallRes = 0;
  report.push({ m, full, A: res.A });
}

// readable audit (generated part)
const lines = ['# Sights audit (generated by tools/detail/sights.mjs — do not edit this part)', '', 'Every important sight / building per map: found from the album, riga.json `landmarks`, OSM names / tags, cadastre type pub / rel and every building >= 30 m. Multi-piece buildings are one sight (ids listed, lead first). Tier A = city icon, B = notable, C = minor public building.', ''];
for (const { m, full } of report) {
  const by = { A: 0, B: 0, C: 0 }; for (const s of full) by[s.tier]++;
  lines.push(`## ${m.slug} — ${full.length} sights (A ${by.A} / B ${by.B} / C ${by.C})`, '', '| tier | category | name | lead id | pieces | area m2 | h m | why |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of full) lines.push(`| ${s.tier} | ${s.cat} | ${(s.name || '(unnamed)').replace(/\|/g, '/')}${s.key ? ' [' + s.key + ']' : ''} | ${s.lead} | ${s.ids.length > 1 ? s.ids.join(' ') : '1'} | ${s.area} | ${s.h} | ${s.why.slice(0, 3).join(', ')} |`);
  lines.push('');
}
const tailFile = path.join(here, 'audit-sights.tail.md'); // hand-written part: tier A verdict table, measurements, notes
const tail = fs.existsSync(tailFile) ? '\n' + fs.readFileSync(tailFile, 'utf8') : '';
fs.writeFileSync(path.join(here, 'audit-sights.md'), tail.replace(/^\n/, '') + '\n\n---\n\n' + lines.join('\n'));
