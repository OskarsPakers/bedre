// node sheets2.mjs : raw2/*.png -> scripts/out/sampling/v2-compare-{chase,cab,top,areas,maps}.png  (L0 | L1 colours | L2 colours+rhythm | real mesh)
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '../../scripts/out/sampling'), RAW = OUT + '/raw2', SP = path.resolve(import.meta.dirname, '../../scripts/out/realistic');
const CW = 760, CH = 428, G = 4;
async function sheet(name, cols, rows) { const W = cols.length * (CW + G) + 110, H = rows.length * (CH + G) + 30; const comp = [];
  cols.forEach((c, i) => comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="26"><text x="6" y="19" font-size="18" font-family="Helvetica" fill="#fff" font-weight="bold">${c}</text></svg>`), left: 110 + i * (CW + G), top: 0 }));
  for (let r = 0; r < rows.length; r++) { comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="106" height="40"><text x="4" y="24" font-size="15" font-family="Helvetica" fill="#fff">${rows[r].label}</text></svg>`), left: 0, top: 30 + r * (CH + G) + CH / 2 - 12 });
    for (let c = 0; c < cols.length; c++) { const f = rows[r].files[c]; if (f && fs.existsSync(f)) comp.push({ input: await sharp(f).resize(CW, CH).png().toBuffer(), left: 110 + c * (CW + G), top: 30 + r * (CH + G) }); } }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#161616' } }).composite(comp).png().toFile(`${OUT}/${name}`); console.log(name, W, H); }
const C4 = ['L0 game now', 'L1 sampled colours', 'L2 colours + rhythm', 'real mesh'], SS = [1200, 1250, 1300, 1400, 1500];
for (const v of ['chase', 'cab']) await sheet(`v2-compare-${v}.png`, C4, SS.map((s) => ({ label: `s=${s}`, files: [0, 1, 2].map((l) => `${RAW}/${v}-${s}-L${l}.png`).concat([`${SP}/c-${v}-${s}.png`]) })));
const tops = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'tops.json'), 'utf8')), ov = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'overviews.json'), 'utf8'));
const trow = (t) => ({ label: t.name.replace('-', ' '), files: [0, 1, 2].map((l) => `${RAW}/top-${t.name}-L${l}.png`).concat([`${RAW}/top-${t.name}-real.png`]) });
await sheet('v2-compare-top.png', C4, tops.map(trow)); await sheet('v2-compare-areas.png', C4, ov.filter((t) => !/^map-/.test(t.name)).map(trow));
await sheet('v2-compare-maps.png', ['L0 game now', 'L1 sampled colours', 'L2 colours + rhythm'], ov.filter((t) => /^map-/.test(t.name)).map(trow));
