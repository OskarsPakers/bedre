// node bldsheet.mjs : 12 evenly spaced buildings of the rhythm set: rectified real facade (intermediate, local only) | game L0 | L1 | L2 with the sampled numbers -> scripts/out/sampling/buildings-12.png (+ per-building log buildings-12.json)
import { launch, BASE } from './pw.mjs'; import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'), OUT = ROOT + '/scripts/out/sampling', SC = ROOT + '/tools/.cache/sampling'; fs.mkdirSync(OUT + '/raw/b', { recursive: true });
const P = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data/params-full.json'), 'utf8')).buildings.filter((p) => p.fh && p.ref != null); const meta = JSON.parse(fs.readFileSync(SC + '/meta.json', 'utf8'));
const N = 12; const pick = Array.from({ length: N }, (_, i) => P[Math.floor((i + 0.5) * P.length / N)]);
const jobs = pick.map((p) => { const b = meta.buildings.find((x) => x.id === p.id), r = b.runs.find((x) => x.i === p.ref); return { p, b, r, o: { len: r.len, h: b.h, mx: b.x + (r.a[0] + r.b[0]) / 2, mz: b.z + (r.a[1] + r.b[1]) / 2, nx: r.n[0], nz: r.n[1], id: p.id } }; });
const CW = 420, CH = 300;
for (const lv of [0, 1, 2]) { const { b, p } = await launch({ width: CW, height: CH }); await p.goto(`${BASE}/play.html?level=${lv}`); await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 }); await p.evaluate(([w, h]) => window.__p.size(w, h), [CW, CH]);
  for (const j of jobs) { await p.evaluate((o) => window.__p.building({ ...o, aspect: 1.4 }), j.o); await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/raw/b/${j.p.id}-L${lv}.png` }); } await b.close(); }
const comp = []; const RW = 520; const rowH = CH + 56; const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
for (let k = 0; k < N; k++) { const j = jobs[k], p = j.p, y = k * (rowH + 6) + 4;
  const rect = await sharp(`${SC}/rect/${p.id}_${p.ref}.png`).flatten({ background: '#d0f' }).resize(RW, CH, { fit: 'contain', background: '#222' }).png().toBuffer(); comp.push({ input: rect, left: 4, top: y });
  for (let l = 0; l < 3; l++) comp.push({ input: `${OUT}/raw/b/${p.id}-L${l}.png`, left: RW + 10 + l * (CW + 4), top: y });
  const txt = `${p.id} ${j.b.name || ''}  floors ${p.nF} x ${p.fh} m, bay ${p.sp} m, window ${p.ww} x ${p.wh} of bay/floor, ground band ${p.gh} m ${p.gk ? '(shop)' : ''}, cornice ${p.co} m, string course ${p.sc}, pilaster ${p.pil}, wall ${hex(p.w)}${p.w2 ? ' / ' + hex(p.w2) : ''}, trim ${hex(p.trim)}, roof ${p.r ? hex(p.r) : '-'} class ${p.rc}   (conf fh ${p.conf.fh} sp ${p.conf.sp} cover ${p.conf.cover})`;
  comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${RW + 3 * CW + 20}" height="50"><rect x="${RW + 10 + 0}" y="2" width="14" height="14" fill="${hex(p.w)}"/><text x="${RW + 30}" y="14" font-size="14" font-family="Helvetica" fill="#fff">wall</text><rect x="${RW + 80}" y="2" width="14" height="14" fill="${p.r ? hex(p.r) : '#000'}"/><text x="4" y="36" font-size="13" font-family="Helvetica" fill="#ddd">${txt.replace(/&/g, '+')}</text></svg>`), left: 0, top: y + CH + 2 }); }
const W = RW + 3 * CW + 20, H = N * (rowH + 6) + 8;
const hdr = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1"></svg>`);
await sharp({ create: { width: W, height: H, channels: 3, background: '#161616' } }).composite(comp).png().toFile(`${OUT}/buildings-12.png`); fs.writeFileSync(`${OUT}/buildings-12.json`, JSON.stringify(jobs.map((j) => ({ id: j.p.id, name: j.b.name, ...j.p, fr: undefined }))));
console.log('wrote buildings-12.png', W, H);
