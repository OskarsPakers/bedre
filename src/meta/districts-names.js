// Neighbourhoods (apkaimes) as simple polygons in local metres. Loaded from /data/riga-areas.json (tools/meta/areas.mjs,
// municipal open data); a few hand-drawn rectangles are the fallback when the file is unavailable.
const FALLBACK = [
  { id: 'vecriga', lv: 'Vecrīga', en: 'Old Town', bank: 'R', poly: [[-900, -60], [-200, -60], [-200, 640], [-900, 640]] },
  { id: 'klusais-centrs', lv: 'Klusais centrs', en: 'Quiet Centre', bank: 'R', poly: [[-200, -1500], [1000, -1500], [1000, -640], [-200, -640]] },
  { id: 'centrs', lv: 'Centrs', en: 'Centre', bank: 'R', poly: [[-200, -640], [1000, -640], [1000, 700], [-200, 700]] },
  { id: 'maskavas-forstate', lv: 'Maskavas forštate', en: 'Moscow Suburb', bank: 'R', poly: [[-300, 700], [1000, 700], [1000, 1300], [-300, 1300]] },
  { id: 'petersala-andrejsala', lv: 'Pētersala-Andrejsala', en: 'Pētersala-Andrejsala', bank: 'R', poly: [[-1250, -1500], [-200, -1500], [-200, -60], [-900, -60], [-1250, -300]] },
  { id: 'pardaugava', lv: 'Pārdaugava', en: 'Left bank', bank: 'L', poly: [[-4000, -3000], [-1250, -3000], [-1250, 3000], [-4000, 3000]] },
];

let areas = null;

function prep(list) {
  return list.map((a) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of a.poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    return { ...a, x0, x1, z0, z1 };
  });
}

export async function loadAreas(url = '/data/riga-areas.json') {
  if (areas) return areas;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!j || !Array.isArray(j.areas) || !j.areas.length) throw new Error('empty');
    areas = prep(j.areas);
  } catch { areas = prep(FALLBACK); }
  return areas;
}
export const getAreas = () => areas || (areas = prep(FALLBACK));

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** Area containing (x,z) or null. */
export function areaAt(x, z) {
  for (const a of getAreas()) if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1 && inside(a.poly, x, z)) return a;
  return null;
}
