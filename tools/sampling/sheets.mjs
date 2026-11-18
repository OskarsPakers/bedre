// node sheets.mjs : raw/*.png -> compare-chase.png, compare-cab.png, compare-top.png (columns L0 | L1 | L2 | L3 | real mesh), labelled
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../scripts/out/sampling'), RAW = OUT + '/raw', SP = path.resolve(import.meta.dirname, '../../scripts/out/realistic');
const CW = 640, CH = 360, G = 4; const COLS = ['L0 game now', 'L1 colours', 'L2 colours+rhythm', 'L3 +bitmask+heroes', 'real mesh'];
async function sheet(name, rows) { // rows: [{label, files:[5]}]
  const W = 5 * (CW + G) + 90, H = rows.length * (CH + G) + 28; const comp = [];
  COLS.forEach((c, i) => comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="26"><text x="6" y="19" font-size="17" font-family="Helvetica" fill="#fff" font-weight="bold">${c}</text></svg>`), left: 90 + i * (CW + G), top: 0 }));
  for (let r = 0; r < rows.length; r++) { comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="40"><text x="4" y="24" font-size="15" font-family="Helvetica" fill="#fff">${rows[r].label}</text></svg>`), left: 0, top: 28 + r * (CH + G) + CH / 2 - 12 });
    for (let c = 0; c < 5; c++) { const f = rows[r].files[c]; comp.push({ input: await sharp(f).resize(CW, CH).png().toBuffer(), left: 90 + c * (CW + G), top: 28 + r * (CH + G) }); } }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#161616' } }).composite(comp).png().toFile(`${OUT}/${name}`); console.log(name, W, H);
}
const SS = [1200, 1250, 1300, 1400, 1500];
for (const v of ['chase', 'cab']) await sheet(`compare-${v}.png`, SS.map((s) => ({ label: `s=${s}`, files: [0, 1, 2, 3].map((l) => `${RAW}/${v}-${s}-L${l}.png`).concat([`${SP}/c-${v}-${s}.png`]) })));
const tops = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'tops.json'), 'utf8'));
await sheet('compare-top.png', tops.map((t) => ({ label: t.name.replace('-', ' '), files: [0, 1, 2, 3].map((l) => `${RAW}/top-${t.name}-L${l}.png`).concat([`${RAW}/top-${t.name}-real.png`]) })));
