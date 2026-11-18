// node review.mjs [from] [count] : contact sheet of the reference facade of each building with the detected grid overlaid (floor lines red, ground band blue, bays yellow ticks) -> /tmp/review-N.png
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'), SC = path.join(ROOT, 'tools/.cache/sampling'); const TAG = process.env.TAG || 'centrs'; let P = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, `data/params-${TAG}.full.json`), 'utf8')).buildings.filter((p) => p.q && p.q[1] >= 2); const A = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, `data/analysis-${TAG}.json`), 'utf8')).results;
let sd = +(process.env.SEED || 7); const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296); P = P.map((p) => [rnd(), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); // seeded shuffle: a fresh random sample, not the first buildings
const from = +(process.argv[2] || 0), cnt = +(process.argv[3] || 8); const list = P.filter((p) => p.fh).slice(from, from + cnt); fs.writeFileSync(`/tmp/rv2-${from}.json`, JSON.stringify(list.map((p) => ({ id: p.id, nF: p.nF, fh: p.fh, sp: p.sp })))); const CW = 560, CH = 400; const comp = [];
let k = 0; for (const p of list) {
  const r = A.find((q) => q.id === p.id), run = r.runs.find((q) => q.i === p.ref), a = run.res; const f = path.join(SC, 'rect', `${p.id}_${p.ref}.png`); const m = await sharp(f).metadata(); const sc = Math.min(CW / m.width, (CH - 30) / m.height); const w = Math.round(m.width * sc), h = Math.round(m.height * sc);
  const px = run.len / m.width; const yTo = (y) => h - (y + 0.5) / 0.1 * sc; let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
  svg += `<line x1="0" x2="${w}" y1="${yTo(a.gH)}" y2="${yTo(a.gH)}" stroke="#08f" stroke-width="2"/>`; for (let i = 0; i <= a.nF; i++) { const y = a.gH + i * (a.Htop - a.gH - 0.5 * a.co) / a.nF; svg += `<line x1="0" x2="${w}" y1="${yTo(y)}" y2="${yTo(y)}" stroke="#f33" stroke-width="1"/>`; }
  const nb = a.nbays, Sadj = run.len / nb; for (let i = 0; i <= nb; i++) { const x = i * Sadj / px * sc; svg += `<line x1="${x}" x2="${x}" y1="${h - 14}" y2="${h}" stroke="#ff0" stroke-width="2"/>`; }
  svg += `<line x1="0" x2="${w}" y1="${yTo(a.Htop - a.co)}" y2="${yTo(a.Htop - a.co)}" stroke="#0f0" stroke-width="1"/></svg>`;
  const img = await sharp(f).resize(w, h).flatten({ background: '#d0f' }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const label = `${p.id} ${(r.name || '').slice(0, 24)} nF=${a.nF} fh=${a.fh.toFixed(1)} sp=${a.sp.toFixed(1)} gH=${a.gH.toFixed(1)} ww=${a.ww.toFixed(2)} ${a.shop ? 'shop' : ''} conf=${a.fhConf.toFixed(2)}/${a.spConf.toFixed(2)}`;
  const lab = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="30"><text x="4" y="20" font-size="15" font-family="monospace" fill="#fff">${label.replace(/&/g, '')}</text></svg>`);
  const x0 = (k % 4) * (CW + 6), y0 = Math.floor(k / 4) * (CH + 6); comp.push({ input: img, left: x0, top: y0 + 30 }, { input: lab, left: x0, top: y0 }); k++;
}
await sharp({ create: { width: 4 * (CW + 6), height: Math.ceil(cnt / 4) * (CH + 6), channels: 3, background: '#222' } }).composite(comp).png().toFile(`/tmp/rv2-${from}.png`);
