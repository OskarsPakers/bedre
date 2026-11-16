// Diagrams made only from the game's own data + the numeric findings (no reference imagery) -> scripts/out/qa-map-*.png
import fs from 'node:fs'; import sharp from 'sharp'; import { loadMap, QC, ROOT } from './lib.mjs';
const OUT = `${ROOT}/scripts/out`;
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const M = loadMap(slug), b = M.bounds, S = slug === 'centrs' ? 0.4 : 0.4; const W = Math.round((b.maxX - b.minX) * S), H = Math.round((b.maxZ - b.minZ) * S);
  const B = JSON.parse(fs.readFileSync(`${QC}/bld-${slug}.json`)); const ph = JSON.parse(fs.readFileSync(`${QC}/phantoms-${slug}.json`)); const ms = JSON.parse(fs.readFileSync(`${QC}/missing-${slug}.json`)).filter((r) => r.area >= 80 && r.canopy < 0.3 && r.maxH >= 5 && r.fill >= 0.4 && r.wall >= 0.35);
  const sp = JSON.parse(fs.readFileSync(`${QC}/spikes.json`))[slug] || [];
  const X = (x) => ((x - b.minX) * S).toFixed(1), Z = (z) => ((z - b.minZ) * S).toFixed(1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f4f1ea"/>`;
  for (const w of M.city.water) svg += `<polygon fill="#bcd3e6" points="${w.p.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}"/>`;
  const noMesh = new Set(B.filter((r) => r.meanS === undefined || r.cover < 0.6).map((r) => r.id));
  for (const g of M.game) { if (!g.ring.length) continue; svg += `<polygon fill="${noMesh.has(g.id) ? '#d9b3b3' : '#b9b9b9'}" points="${g.ring.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}"/>`; }
  for (const r of ph) svg += `<circle cx="${X(r.x)}" cy="${Z(r.z)}" r="${Math.max(3, Math.sqrt(r.area) * S * 0.9)}" fill="none" stroke="#d6001c" stroke-width="1.6"/>`;
  for (const r of ms) svg += `<rect x="${(+X(r.x) - 5).toFixed(1)}" y="${(+Z(r.z) - 5).toFixed(1)}" width="10" height="10" fill="none" stroke="#0057d6" stroke-width="2"/>`;
  svg += `<g font-family="sans-serif" font-size="13"><rect x="6" y="6" width="330" height="76" fill="#fff" opacity=".85"/><text x="12" y="22" fill="#222">${slug}: footprints grey (pink = no usable mesh data)</text><text x="12" y="40" fill="#d6001c">red circles: ${ph.length} rendered-tall boxes on mesh-flat ground</text><text x="12" y="58" fill="#0057d6">blue squares: ${ms.length} mesh volumes without footprint (unverified)</text><text x="12" y="74" fill="#555">scale 0.4 px/m, x east, z south</text></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/qa-map-findings-${slug}.png`); console.log(slug, W, H, ph.length, ms.length);
}
// height scatter: rendered body height vs measured mean (smooth cells), per map
const cols = { centrs: '#c4361a', agenskalns: '#1a6bc4', mezaparks: '#2a8a3a', purvciems: '#8a4ac4' };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="760"><rect width="760" height="760" fill="#fff"/><g font-family="sans-serif" font-size="12">`;
const L = 60, T = 20, R = 700, Bm = 700, mx = 40; const sx = (v) => L + (Math.min(v, mx) / mx) * (R - L), sy = (v) => Bm - (Math.min(v, mx) / mx) * (Bm - T);
for (let v = 0; v <= mx; v += 10) svg += `<line x1="${sx(v)}" y1="${T}" x2="${sx(v)}" y2="${Bm}" stroke="#eee"/><line x1="${L}" y1="${sy(v)}" x2="${R}" y2="${sy(v)}" stroke="#eee"/><text x="${sx(v) - 6}" y="${Bm + 16}">${v}</text><text x="30" y="${sy(v) + 4}">${v}</text>`;
svg += `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(mx)}" y2="${sy(mx)}" stroke="#444"/><path d="M${sx(0)},${sy(4)} L${sx(mx - 4)},${sy(mx)}" stroke="#999" stroke-dasharray="4 3" fill="none"/><path d="M${sx(4)},${sy(0)} L${sx(mx)},${sy(mx - 4)}" stroke="#999" stroke-dasharray="4 3" fill="none"/>`;
for (const [slug, c] of Object.entries(cols)) { const B = JSON.parse(fs.readFileSync(`${QC}/bld-${slug}.json`)).filter((r) => r.meanS !== undefined && r.cover >= 0.6 && r.n >= 20 && r.area >= 100); const step = Math.ceil(B.length / 900); B.forEach((r, i) => { if (i % step === 0) svg += `<circle cx="${sx(r.meanS).toFixed(1)}" cy="${sy(r.rMean).toFixed(1)}" r="2" fill="${c}" opacity=".45"/>`; }); }
let ly = 40; for (const [s, c] of Object.entries(cols)) { svg += `<circle cx="90" cy="${ly}" r="4" fill="${c}"/><text x="100" y="${ly + 4}">${s}</text>`; ly += 16; }
svg += `<text x="330" y="${Bm + 36}">mesh-measured mean height above ground (m, smooth cells)</text><text transform="translate(14,520) rotate(-90)">game body height (m)</text><text x="400" y="60">diagonal = agreement, dashed = +-4 m; points far above the diagonal = rendered tall over low mesh</text></g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(`${OUT}/qa-map-heights-scatter.png`);
