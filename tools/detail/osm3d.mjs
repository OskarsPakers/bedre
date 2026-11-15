// Track A helper: OSM "Simple 3D Buildings" (building:part + 3D tags) -> our `parts` schema.
// Heights follow the OSM wiki: `height` = top of roof incl. roof; `building:levels` excludes the roof; levels = 3 m (we use 3.2).
import { elementRings, parseNum, loadOsm, ringCentroid, ringArea } from './fetch-osm-parts.mjs';
import { pip } from './dsm.mjs';

const LEVEL = 3.2;
const SHAPE = {
  flat: 'flat', gabled: 'gabled', hipped: 'hipped', pyramidal: 'pyramid', pyramid: 'pyramid', cone: 'cone', dome: 'dome', onion: 'onion',
  skillion: 'skillion', mansard: 'hipped', gambrel: 'gabled', saltbox: 'gabled', side_hipped: 'hipped', 'half-hipped': 'hipped', crosspitched: 'gabled',
  apse_gabled: 'gabled', round: 'dome', 'half-dome': 'dome', quadruple_saltbox: 'hipped', many: 'gabled',
};
const DEFAULT_ROOF_H = { gabled: 3.5, hipped: 3.5, pyramid: 4, cone: 5, dome: 4, onion: 5, skillion: 1.5, flat: 0 };

function colourHex(c) {
  if (!c) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const named = { red: '#b03a2e', brown: '#7b5238', grey: '#808080', gray: '#808080', green: '#4a7c59', black: '#222222', white: '#eeeeee', yellow: '#d6b84a', orange: '#d9822b', blue: '#3a5f9a', beige: '#d8c9a3', darkgray: '#505050', silver: '#b0b0b0', copper: '#4f9f8b' };
  return named[String(c).toLowerCase()];
}

/** convert one OSM element (part or building outline) to a part, or null */
export function osmToPart(el, ring) {
  const t = el.tags || {};
  const shape = SHAPE[t['roof:shape']] || (t['roof:shape'] ? 'gabled' : 'flat');
  const minH = !Number.isNaN(parseNum(t.min_height)) ? parseNum(t.min_height) : !Number.isNaN(parseNum(t['building:min_level'])) ? parseNum(t['building:min_level']) * LEVEL : 0;
  let roofH = !Number.isNaN(parseNum(t['roof:height'])) ? parseNum(t['roof:height']) : !Number.isNaN(parseNum(t['roof:levels'])) ? parseNum(t['roof:levels']) * LEVEL : shape === 'flat' ? 0 : null;
  let top = !Number.isNaN(parseNum(t.height)) ? parseNum(t.height) : !Number.isNaN(parseNum(t['building:height'])) ? parseNum(t['building:height']) : null;
  const lv = parseNum(t['building:levels']);
  if (top == null && !Number.isNaN(lv)) {
    if (roofH == null) roofH = DEFAULT_ROOF_H[shape] ?? 0;
    top = lv * LEVEL + roofH;
  }
  if (top == null) return null;
  if (roofH == null) roofH = Math.min(DEFAULT_ROOF_H[shape] ?? 0, (top - minH) * 0.5);
  roofH = Math.min(roofH, top - minH);
  const part = { p: ring.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), y0: Math.round(minH * 10) / 10, y1: Math.round((top - roofH) * 10) / 10, roof: { shape: roofH > 0.2 ? shape : 'flat', h: Math.round(roofH * 10) / 10 } };
  if (['gabled', 'hipped', 'skillion'].includes(part.roof.shape)) {
    const dir = parseNum(t['roof:direction']);
    // roof:direction = compass bearing (0=N,90=E) the roof slopes DOWN towards. Our `dir` = ridge direction (deg from +x east toward +z south);
    // ridge = slope direction + 90 and our angle = compass - 90 -> dir = compass bearing (mod 360). For skillion the high side is across(+).
    if (!Number.isNaN(dir)) part.roof.dir = ((Math.round(dir) % 360) + 360) % 360;
    else part.roof.dir = ridgeAlongLongSide(ring, t['roof:orientation'] === 'across');
  }
  const rc = colourHex(t['roof:colour']);
  if (rc) part.col = rc;
  return part;
}
function ridgeAlongLongSide(ring, across) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || l > best.l) best = { l, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  const d = (best.ang * 180) / Math.PI + (across ? 90 : 0);
  return Math.round(((d % 180) + 180) % 180);
}

/** index OSM parts/outlines by game building: returns Map(gameId -> {parts:[part...], outlines:[el...], elements}) */
export async function indexOsmByBuilding(buildings) {
  const { parts, buildings: osmB } = await loadOsm();
  const res = new Map();
  const get = (id) => { if (!res.has(id)) res.set(id, { parts: [], outline: [], partEls: [], outEls: [] }); return res.get(id); };
  const bbs = buildings.map((b) => { let a = 1e9, c = 1e9, d = -1e9, e = -1e9; for (const [x, z] of b.p) { a = Math.min(a, x); d = Math.max(d, x); c = Math.min(c, z); e = Math.max(e, z); } return [a, c, d, e]; });
  const place = (el, kind) => {
    for (const ring of elementRings(el)) {
      if (ring.length < 3) continue;
      const [cx, cz] = ringCentroid(ring);
      for (let i = 0; i < buildings.length; i++) {
        const bb = bbs[i];
        if (cx < bb[0] || cx > bb[2] || cz < bb[1] || cz > bb[3]) continue;
        if (pip(cx, cz, buildings[i].p)) {
          const rec = get(buildings[i].id);
          const part = osmToPart(el, ring);
          if (kind === 'part') { rec.partEls.push(el); if (part) rec.parts.push(part); } else { rec.outEls.push(el); if (part) rec.outline.push({ part, area: ringArea(ring) }); }
          break;
        }
      }
    }
  };
  for (const el of parts) place(el, 'part');
  for (const el of osmB) if (el.tags && (el.tags['roof:shape'] || el.tags.height || el.tags['building:levels'] || el.tags.name)) place(el, 'outline');
  return res;
}

/** best OSM-derived part list for one game building (parts if any, else the largest outline element) */
export function osmPartsOf(rec) {
  if (!rec) return null;
  if (rec.parts.length) return rec.parts;
  if (rec.outline.length) return [rec.outline.sort((a, b) => b.area - a.area)[0].part];
  return null;
}
