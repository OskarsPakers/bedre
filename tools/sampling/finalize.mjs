// node finalize.mjs : params-centrs.full.json + analysis-centrs.json (+ OSM colour tags, shapes-file colours) -> params-look.full.json (what ships) -> pack.mjs look -> public/data/riga-look.bin.gz
// Steps beyond the raw sample (all deterministic, derived facts only):
//  (b) hue sanity: a wall whose well-measured facades disagree in hue (> 60 deg) is rejected (the game keeps its palette); lilac (shade) and pink hues are pulled towards neutral
//  (a) strong known colour: where the sample is low-chroma and an OSM building:colour tag (or the shapes-file wallRGB) is a strong colour, blend towards it; roofs: an OSM roof:colour with a different material class wins
//  (c) small deterministic per-building variation (hash of the id): +-3 L*, +-5 deg hue, so streets do not become uniform
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const D = path.join(import.meta.dirname, 'data'), ROOT = path.resolve(import.meta.dirname, '../..');
const full = JSON.parse(fs.readFileSync(`${D}/params-centrs.full.json`, 'utf8')), A = new Map(JSON.parse(fs.readFileSync(`${D}/analysis-centrs.json`, 'utf8')).results.map((r) => [r.id, r]));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function lab(r, g, b) { const R = lin(r), G = lin(g), B = lin(b); let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883; const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); X = f(X); Y = f(Y); Z = f(Z); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; }
function unlab(L, a, b) { const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200; const fi = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787); const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883; let R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z; const gm = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); }; return [gm(R), gm(G), gm(B)]; }
const hueOf = (l) => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360, chroma = (l) => Math.hypot(l[1], l[2]), hdiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const hash = (id) => { let h = (id * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
// ---- OSM colour tags -> game building ids (centroid inside the cadastre polygon)
const NAMED = { white: [235, 232, 222], red: [200, 70, 60], yellow: [230, 200, 100], orange: [220, 140, 70], green: [110, 160, 120], brown: [140, 100, 80], grey: [160, 160, 160], gray: [160, 160, 160], beige: [225, 210, 175], cream: [235, 225, 195], pink: [225, 160, 160], blue: [110, 140, 190], black: [60, 60, 60], tan: [200, 170, 130] };
const parseCol = (s) => { if (!s) return null; s = s.trim().toLowerCase(); if (/^#[0-9a-f]{6}$/.test(s)) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); return NAMED[s] || null; };
const city = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/riga.json'), 'utf8')); const M_LON = 111320 * Math.cos((56.9515 * Math.PI) / 180);
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/.cache/osm_buildings.json'), 'utf8')).elements; const cells = new Map(); const key = (x, z) => Math.floor(x / 50) + ',' + Math.floor(z / 50);
for (const b of city.buildings) { for (const [x, z] of b.p) { const k = key(x, z); (cells.get(k) || cells.set(k, new Set()).get(k)).add(b); } }
const inside = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const osmCol = new Map(); for (const e of osm) { const t = e.tags || {}; const wc = parseCol(t['building:colour']), rc = parseCol(t['roof:colour']); if ((!wc && !rc) || !e.geometry) continue; let cx = 0, cz = 0; for (const g of e.geometry) { cx += (g.lon - 24.1133) * M_LON; cz += -(g.lat - 56.9515) * 111320; } cx /= e.geometry.length; cz /= e.geometry.length;
  for (const b of cells.get(key(cx, cz)) || []) if (inside(cx, cz, b.p)) { const o = osmCol.get(b.id) || {}; if (wc) o.w = wc; if (rc) o.r = rc; osmCol.set(b.id, o); } }
// shapes file wall colours (hero parts / measured)
const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'public/data/riga-shapes.bin.gz'))); const hl = raw.readUInt32LE(4), head = JSON.parse(raw.slice(8, 8 + hl).toString()), ST = head.stride || 10; const shapeWall = new Map();
for (let i = 0; i < head.b.length / ST; i++) { const r = head.b.slice(i * ST, i * ST + ST); if (r[9]) shapeWall.set(r[0], [(r[9] >> 16) & 255, (r[9] >> 8) & 255, r[9] & 255]); }
const stats = { wallRejectedHue: 0, lilacPulled: 0, pinkPulled: 0, blendedOsm: 0, blendedShape: 0, roofOsm: 0, w2Dropped: 0, varied: 0 };
const out = [];
for (const p of full.buildings) {
  const q = p.q || [0, 0, 0]; const r = { ...p }; const an = A.get(p.id);
  if (r.w && q[0] >= 2) {
    let L = lab(...r.w);
    // (b) disagreement between well measured facades
    const runs = an ? an.runs.filter((x) => x.res && x.res.ok && x.res.cover > 0.4 && x.len >= 5 && chroma(x.res.albLab) >= 8) : [];
    let maxd = 0; for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) maxd = Math.max(maxd, hdiff(hueOf(runs[i].res.albLab), hueOf(runs[j].res.albLab)));
    if (runs.length >= 2 && maxd > 60) { delete r.w; delete r.w2; delete r.w2r; stats.wallRejectedHue++; q[0] = 0; }
    else {
      let [l0, a0, b0] = L; const h = hueOf(L), C = chroma(L);
      if (C > 7 && h > 285 && h < 340) { a0 *= 0.3; b0 *= 0.3; stats.lilacPulled++; } else if (C > 14 && (h >= 340 || h < 18)) { a0 *= 0.6; b0 *= 0.6; stats.pinkPulled++; }
      // (a) strong known colour
      const known = (osmCol.get(p.id) || {}).w || shapeWall.get(p.id); if (known) { const K = lab(...known), Ck = chroma(K); if (Ck > 18 && chroma([l0, a0, b0]) < 0.7 * Ck) { const t = 0.65; l0 = l0 + (K[0] - l0) * t * 0.6; a0 += (K[1] - a0) * t; b0 += (K[2] - b0) * t; if (osmCol.get(p.id)?.w) stats.blendedOsm++; else stats.blendedShape++; } }
      // (c) deterministic variation
      const u = hash(p.id), v = hash(p.id + 7919); const dh = (v - 0.5) * 2 * 5 * Math.PI / 180, dl = (u - 0.5) * 6; const ch = Math.hypot(a0, b0), hh = Math.atan2(b0, a0) + dh; l0 += dl; a0 = ch * Math.cos(hh); b0 = ch * Math.sin(hh); stats.varied++;
      r.w = unlab(Math.max(55, Math.min(92, l0)), a0, b0);
    }
  }
  if (r.w2 && r.w) { const L2 = lab(...r.w2), h = hueOf(L2); if (chroma(L2) > 7 && h > 285 && h < 340) { delete r.w2; delete r.w2r; stats.w2Dropped++; } }
  if (r.r && q[2] >= 2) { const o = (osmCol.get(p.id) || {}).r; if (o) { const K = lab(...o), Ck = chroma(K), hk = hueOf(K); const cls = Ck > 18 && hk < 70 ? 0 : Ck > 12 && hk > 120 && hk < 210 ? 2 : -1; if (cls >= 0 && cls !== r.rc) { const S = lab(...r.r); const t = 0.7; r.r = unlab(S[0] + (K[0] - S[0]) * 0.5, S[1] + (K[1] - S[1]) * t, S[2] + (K[2] - S[2]) * t); r.rc = cls; stats.roofOsm++; } } }
  r.q = q; out.push(r);
}
fs.writeFileSync(`${D}/params-look.full.json`, JSON.stringify({ v: 3, stats, buildings: out })); console.log(JSON.stringify(stats), 'osm colour matches', osmCol.size, 'shape wall colours', shapeWall.size);
