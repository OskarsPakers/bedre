#!/usr/bin/env node
// Renders public/data/riga.json to tools/.cache/preview.svg (north up).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/riga.json'), 'utf8'));
const b = d.meta.bounds;
const S = 0.8; // px per metre
const W = (b.maxX - b.minX) * S, H = (b.maxZ - b.minZ) * S;
const X = (x) => ((x - b.minX) * S).toFixed(1), Z = (z) => ((z - b.minZ) * S).toFixed(1); // z down == south down
const pts = (p) => p.map((q) => X(q[0]) + ',' + Z(q[1])).join(' ');
const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#f1efe9"/>`];
for (const p of d.parks) o.push(`<polygon points="${pts(p.p)}" fill="#bfe0a8"/>`);
for (const p of d.water) o.push(`<polygon points="${pts(p.p)}" fill="#8cc3ee"/>`);
const col = { rail: '#777', pedestrian: '#d9d2c4', footway: '#e2dccf' };
for (const r of d.roads) o.push(`<polyline points="${pts(r.p)}" fill="none" stroke="${col[r.k] || '#b0b0b0'}" stroke-width="${(r.w * S).toFixed(1)}" stroke-linejoin="round"/>`);
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
