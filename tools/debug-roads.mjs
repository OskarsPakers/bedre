#!/usr/bin/env node
// Debug overlay of the OSM vectors by kind around a point: node tools/debug-roads.mjs [map] [cx] [cz] [half] [out.png]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [map = 'centrs', cx = 0, cz = 0, half = 125, outp = 'scripts/out/pathfix-debug.png'] = process.argv.slice(2);
const f = map === 'centrs' ? 'public/data/riga.json' : `public/data/${map}/riga.json`;
const d = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const S = 4, x0 = +cx - +half, z0 = +cz - +half, W = half * 2 * S;
const P = (p) => p.map((q) => ((q[0] - x0) * S).toFixed(1) + ',' + ((q[1] - z0) * S).toFixed(1)).join(' ');
const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#fff"/>`];
const poly = (a, fill, op) => o.push(`<path d="${[a.p, ...(a.h || [])].map((r) => 'M' + P(r).replace(/ /g, 'L') + 'Z').join('')}" fill="${fill}" fill-opacity="${op}" fill-rule="evenodd" stroke="${fill}" stroke-width="1"/>`);
for (const a of d.parks) poly(a, '#4c4', 0.25);
for (const a of d.water) poly(a, '#48f', 0.3);
for (const a of d.areas || []) poly(a, { sq: '#f90', as: '#888', plat: '#fc0', pkg: '#999', verge: '#6c6', island: '#a6a' }[a.c] || '#ccc', 0.3);
const COL = { motorway: '#000', primary: '#a00', secondary: '#c40', tertiary: '#c80', residential: '#555', service: '#999', pedestrian: '#f0f', footway: '#00d', rail: '#0a0' };
for (const r of d.roads) {
  const col = r.f === 's' ? '#0cc' : r.f === 'c' ? '#f00' : COL[r.k] || '#000';
  o.push(`<polyline points="${P(r.p)}" fill="none" stroke="${col}" stroke-opacity="0.35" stroke-width="${(r.w * S).toFixed(1)}" stroke-linejoin="round"/>`);
  o.push(`<polyline points="${P(r.p)}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
  const m = r.p[Math.floor(r.p.length / 2)];
  if (m[0] > x0 && m[0] < x0 + 2 * half && m[1] > z0 && m[1] < z0 + 2 * half) o.push(`<text x="${((m[0] - x0) * S).toFixed(0)}" y="${((m[1] - z0) * S).toFixed(0)}" font-size="11" fill="${col}">${r.k[0]}${r.f || ''}${r.w}${r.br ? 'B' : ''}${r.tn ? 'T' : ''}</text>`);
}
for (const c of d.crossings || []) { const a = c[2] * Math.PI / 180, dx = Math.cos(a) * c[3] / 2, dz = Math.sin(a) * c[3] / 2; o.push(`<line x1="${(c[0] - dx - x0) * S}" y1="${(c[1] - dz - z0) * S}" x2="${(c[0] + dx - x0) * S}" y2="${(c[1] + dz - z0) * S}" stroke="${c[4] ? '#e0e' : '#aaa'}" stroke-width="5"/>`); }
for (const t of d.tramways || []) o.push(`<polyline points="${P(t.p)}" fill="none" stroke="#a0a" stroke-width="3" stroke-dasharray="6 4"/>`);
for (const b of d.buildings) o.push(`<polygon points="${P(b.p)}" fill="none" stroke="#999" stroke-width="1"/>`);
o.push('</svg>');
const sharp = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/sharp/dist/index.cjs'));
await sharp(Buffer.from(o.join('\n')), { density: 72 }).png().toFile(path.join(ROOT, outp));
console.log('wrote', outp);
