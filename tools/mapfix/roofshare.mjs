// Roof-colour shares measured from the orthophoto (measuring only, nothing shipped): per building the majority of un-shadowed, non-vegetated pixels inside its footprint
// -> red/brown clay, grey zinc / tar / slate, green copper. Area-weighted shares per neighbourhood (Old Town ellipse / centre grid / rest) -> tools/.cache/mapfix/roofshare.json
//   node tools/mapfix/roofshare.mjs [slug]   (the centre mosaic: tools/.cache/ortho/local05.bin, from tools/surface)
import fs from 'node:fs'; import path from 'node:path';
import { Grid, loadCity, mapInfo, cacheDir, SLUGS } from './lib.mjs';
const RB = +(process.env.RB || 14), RG = +(process.env.RG || 6); // red/brown clay: r - b and r - g margins (the 2016-18 ortho renders clay tile as dull rust)
const zoneOf = (x, z) => { const a = (x + 400) / 520, b = (z - 260) / 380; if (a * a + b * b < 1) return 'old'; if (x > -150 && x < 700 && z > -900 && z < -60) return 'centre'; return 'other'; };
export function measure(slug) {
  const b = mapInfo(slug).bounds, W = Math.round(b.maxX - b.minX) * 2, H = Math.round(b.maxZ - b.minZ) * 2;
  const f = path.join(cacheDir, 'ortho', slug === 'centrs' ? 'local05.bin' : `local05_${slug}.bin`), buf = fs.readFileSync(f), n = W * H;
  const R = buf.subarray(0, n), G = buf.subarray(n, 2 * n), B = buf.subarray(2 * n);
  const city = loadCity(slug), g = new Grid({ minX: b.minX, minZ: b.minZ, maxX: b.minX + W / 2, maxZ: b.minZ + H / 2 }), out = [];
  const g2 = { x0: b.minX, z0: b.minZ, W, H };
  for (const bd of city.buildings) {
    if ((bd.t === 'aux' && bd.h < 4) || bd.id >= 5e10) continue;
    const m = new Uint8Array(0); void m; // scanline sample on the 0.5 m grid
    let zmin = 1e9, zmax = -1e9; for (const p of bd.p) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
    let red = 0, grey = 0, green = 0, cx = 0, cz = 0;
    const j0 = Math.max(0, Math.floor((zmin - g2.z0) * 2)), j1 = Math.min(H - 1, Math.ceil((zmax - g2.z0) * 2));
    for (let j = j0; j <= j1; j++) {
      const z = g2.z0 + (j + 0.5) / 2, xs = [];
      for (let a = 0, c = bd.p.length - 1; a < bd.p.length; c = a++) { const [ax, az] = bd.p[a], [bx, bz] = bd.p[c]; if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az)); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - g2.x0) * 2 + 2)); i <= Math.min(W - 1, Math.floor((xs[k + 1] - g2.x0) * 2 - 2)); i++) {
        const q = j * W + i, r = R[q], gg = G[q], bb = B[q], lum = 0.3 * r + 0.59 * gg + 0.11 * bb;
        if (lum < 70 || lum > 235) continue; // shadow / glare
        if (gg - r >= 4 && gg - bb >= 2) green++; // verdigris OR a tree over the roof: counted as green only when it dominates
        else if (r - bb >= RB && r - gg >= RG) red++;
        else grey++;
        cx += (i / 2) + g2.x0; cz += (j / 2) + g2.z0;
      }
    }
    const tot = red + grey + green; if (tot < 30) continue;
    const mx = bd.p.reduce((s, p) => s + p[0], 0) / bd.p.length, mz = bd.p.reduce((s, p) => s + p[1], 0) / bd.p.length;
    out.push({ id: bd.id, t: bd.t, x: mx, z: mz, zone: zoneOf(mx, mz), cls: green / tot > 0.55 ? 'green' : red / tot >= grey / tot && red / tot > 0.3 ? 'red' : 'grey', area: tot / 4, fr: +(red / tot).toFixed(2), fg: +(grey / tot).toFixed(2), fgr: +(green / tot).toFixed(2) });
  }
  const sh = {};
  for (const z of ['old', 'centre', 'other']) { const L = out.filter((o) => o.zone === z && o.t !== 'ind' && o.t !== 'aux' && o.area >= 60); const A = L.reduce((s, o) => s + o.area, 0), by = (c) => +(L.filter((o) => o.cls === c).reduce((s, o) => s + o.area, 0) / A).toFixed(3); sh[z] = { n: L.length, red: by('red'), grey: by('grey'), green: by('green') }; }
  return { slug, shares: sh, per: out };
}
if (process.argv[1] === import.meta.filename) {
  const list = process.argv.slice(2).length ? process.argv.slice(2) : ['centrs'];
  const res = {}; for (const s of list) { const r = measure(s); res[s] = r.shares; console.log(s, JSON.stringify(r.shares)); fs.mkdirSync(path.join(cacheDir, 'mapfix'), { recursive: true }); fs.writeFileSync(path.join(cacheDir, 'mapfix', `roofcls-${s}.json`), JSON.stringify(r.per)); }
  fs.writeFileSync(path.join(cacheDir, 'mapfix', 'roofshare.json'), JSON.stringify(res));
}
