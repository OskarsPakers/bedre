// street-variety sheet: ?r4=0 (round 3 look) | ?r4=1 (round 4) for 10 stretches: node tools/tramcity/varsheet.mjs
import sharp from 'sharp'; import fs from 'node:fs';
const D = 'scripts/out/tramcity/var/', W = 640, H = 360;
const items = [['centrs-1', 600], ['centrs-1', 1600], ['centrs-1', 2600], ['centrs-1', 3500], ['centrs-2', 400], ['centrs-2', 1700], ['centrs-3', 300], ['centrs-3', 700], ['centrs-3', 2000], ['centrs-3', 2500]];
for (let k = 0; k < 2; k++) {
  const part = items.slice(k * 5, k * 5 + 5), comps = [];
  for (let i = 0; i < part.length; i++) for (let c = 0; c < 2; c++) comps.push({ input: await sharp(`${D}v${c}-day-chase-${part[i][0]}-${part[i][1]}.png`).resize(W, H, { fit: 'cover' }).toBuffer(), left: c * W, top: 30 + i * H });
  comps.unshift({ input: Buffer.from(`<svg width="${W * 2}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="21" font-family="Helvetica" font-size="18" fill="#fff">ROUND 3 look (?r4=0): ${part.map((p) => p.join(' s=')).join(', ')}</text><text x="${W + 10}" y="21" font-family="Helvetica" font-size="18" fill="#fff">ROUND 4</text></svg>`), left: 0, top: 0 });
  await sharp({ create: { width: W * 2, height: 30 + part.length * H, channels: 3, background: '#111' } }).composite(comps).png().toFile(`scripts/out/tramcity/street-variety-${k + 1}.png`);
}
