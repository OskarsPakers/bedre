#!/usr/bin/env node
// Renders public/data/riga.json to tools/.cache/preview.svg (north up) and, when `sharp` is installed (dev machines), preview.svg.png.
// Shows the ground-cover layers: land cover areas, parks (with holes), water (with islands), pavements, carriageways, crossings.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/riga.json'), 'utf8'));
const b = d.meta.bounds;
const S = 0.8; // px per metre
const W = (b.maxX - b.minX) * S, H = (b.maxZ - b.minZ) * S;
const X = (x) => ((x - b.minX) * S).toFixed(1), Z = (z) => ((z - b.minZ) * S).toFixed(1); // z down == south down
const pts = (p) => p.map((q) => X(q[0]) + ',' + Z(q[1])).join(' ');
const poly = (o, fill, extra = '') => {
  const rings = [o.p, ...(o.h || [])].map((r) => 'M' + pts(r).replace(/ /g, 'L') + 'Z').join('');
  return `<path d="${rings}" fill="${fill}" fill-rule="evenodd" ${extra}/>`;
};
const AREA = { res: '#e4dccb', com: '#e0dacc', ind: '#d4cbbb', con: '#d8c5a0', rail: '#b3aa9c', sand: '#e8d9a8', wd: '#7fa56f', ply: '#d4c49b', pit: '#a6cd86', sta: '#bccf94', pkg: '#a5a39d', as: '#9a9994', verge: '#b0cf8a', sq: '#e8e4da', plat: '#d8d3c9', island: '#c2beb4', pier: '#cfc5b0', brg: '#9a9791' };
const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ece6d8"/>`];
for (const a of d.areas || []) if (a.c !== 'pier' && a.c !== 'brg') o.push(poly(a, AREA[a.c] || '#ddd'));
for (const p of d.parks) o.push(poly(p, '#b7d99c'));
for (const p of d.water) o.push(poly(p, '#7fb6e3'));
for (const a of d.areas || []) if (a.c === 'pier' || a.c === 'brg') o.push(poly(a, AREA[a.c]));
for (const p of d.piers || []) o.push(poly(p, '#cfc5b0'));
const col = { rail: '#777', pedestrian: '#d9d2c4', footway: '#e2dccf', service: '#b9b6ae' };
const veh = new Set(['motorway', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
for (const r of d.roads) if (veh.has(r.k) && r.sw !== 0 && !r.br) o.push(`<polyline points="${pts(r.p)}" fill="none" stroke="#efe9db" stroke-width="${((r.w + 4) * S).toFixed(1)}" stroke-linejoin="round"/>`);
for (const r of d.roads) o.push(`<polyline points="${pts(r.p)}" fill="none" stroke="${col[r.k] || '#8f8e8a'}" stroke-width="${(r.w * S).toFixed(1)}" stroke-linejoin="round"/>`);
for (const c of d.crossings || []) {
  const a = (c[2] * Math.PI) / 180, dx = Math.cos(a) * c[3] / 2, dz = Math.sin(a) * c[3] / 2;
  o.push(`<line x1="${X(c[0] - dx)}" y1="${Z(c[1] - dz)}" x2="${X(c[0] + dx)}" y2="${Z(c[1] + dz)}" stroke="${c[4] ? '#fff' : '#c8c8c8'}" stroke-width="${(2.2 * S).toFixed(1)}"/>`);
}
for (const bl of d.buildings) {
  const g = Math.round(235 - Math.min(bl.h, 40) * 4.5);
  o.push(`<polygon points="${pts(bl.p)}" fill="rgb(${g},${g - 5},${g - 12})" stroke="#555" stroke-width="0.3"/>`);
}
for (const t of d.trees) o.push(`<circle cx="${X(t[0])}" cy="${Z(t[1])}" r="1.6" fill="#2e8b3d"/>`);
for (const l of d.landmarks) o.push(`<circle cx="${X(l.x)}" cy="${Z(l.z)}" r="4" fill="#e03030"/>`);
o.push('</svg>');
const out = path.join(ROOT, 'tools/.cache/preview.svg');
fs.writeFileSync(out, o.join('\n'));
console.log('wrote', out, (fs.statSync(out).size / 1048576).toFixed(2), 'MB');
try {
  const sharp = createRequire(import.meta.url)(path.join(ROOT, 'node_modules/sharp/dist/index.cjs'));
  await sharp(Buffer.from(o.join('\n')), { density: 72, limitInputPixels: false }).png().toFile(out + '.png');
  console.log('wrote', out + '.png');
} catch (e) { console.log('(no PNG: sharp unavailable)', e.message); }
