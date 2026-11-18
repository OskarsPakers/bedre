// compare sheets round 3 | round 4 | real mesh: node tools/tramcity/compare4.mjs   (inputs: scripts/out/tramcity/after-* = round 3 shots, r4-* = round 4 shots, scripts/out/realistic/c-*)
import sharp from 'sharp';
const O = 'scripts/out/tramcity/', S = [1200, 1250, 1300, 1400, 1500], W = 640, H = 360;
for (const view of ['cab', 'chase']) {
  const comps = [];
  for (let i = 0; i < S.length; i++) {
    const s = S[i], files = [`${O}after-day-${view}-centrs-3-${s}.png`, `${O}r4-day-${view}-centrs-3-${s}.png`, `scripts/out/realistic/c-${view}-${s}.png`];
    for (let c = 0; c < 3; c++) comps.push({ input: await sharp(files[c]).resize(W, H, { fit: 'cover' }).toBuffer(), left: c * W, top: 30 + i * H });
  }
  const hdr = Buffer.from(`<svg width="${W * 3}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="21" font-family="Helvetica" font-size="18" fill="#fff">PREVIOUS (round 3 shots)</text><text x="${W + 10}" y="21" font-family="Helvetica" font-size="18" fill="#fff">ROUND 4</text><text x="${2 * W + 10}" y="21" font-family="Helvetica" font-size="18" fill="#fff">REAL photogrammetry (${view}, s = ${S.join(', ')})</text></svg>`);
  comps.unshift({ input: hdr, left: 0, top: 0 });
  await sharp({ create: { width: W * 3, height: 30 + S.length * H, channels: 3, background: '#111' } }).composite(comps).png().toFile(`${O}compare4-${view}.png`);
}
