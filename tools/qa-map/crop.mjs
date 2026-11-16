// crop(map, cx, cz, size, {px}) -> sharp-ready PNG buffers for orthophoto, DSM hillshade with footprint outlines overlay, side by side.
import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
import { loadMap, loadDsm, QC, ROOT } from './lib.mjs';
const cache = {};
function orthoFor(slug) {
  if (cache['o' + slug]) return cache['o' + slug];
  const f = path.join(ROOT, 'tools/.cache/ortho', slug === 'centrs' ? 'local05.bin' : `local05_${slug}.bin`);
  const buf = fs.readFileSync(f);
  const W = slug === 'centrs' ? 6600 : 5200, H = slug === 'centrs' ? 5400 : 5200;
  return (cache['o' + slug] = { buf, W, H, res: 0.5 });
}
export function ctx(slug) {
  if (!cache['c' + slug]) { const M = loadMap(slug); cache['c' + slug] = { M, dsm: loadDsm(slug), or: orthoFor(slug) }; }
  return cache['c' + slug];
}
export async function cropPair(slug, cx, cz, size = 160, { px = 480, outlines = true, marks = [], label = '' } = {}) {
  const { M, dsm, or } = ctx(slug);
  const b = M.bounds, res = size / px;
  const rgb = Buffer.alloc(px * px * 3), hs = Buffer.alloc(px * px * 3);
  const x0 = cx - size / 2, z0 = cz - size / 2;
  const dz = (x, z) => dsm.at(x, z);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res;
    // ortho
    const oi = Math.floor((x - b.minX) / or.res), oj = Math.floor((z - b.minZ) / or.res), k = (j * px + i) * 3;
    if (oi >= 0 && oj >= 0 && oi < or.W && oj < or.H) { const o = oj * or.W + oi, pl = or.W * or.H; rgb[k] = or.buf[o]; rgb[k + 1] = or.buf[pl + o]; rgb[k + 2] = or.buf[2 * pl + o]; } else { rgb[k] = rgb[k + 1] = rgb[k + 2] = 40; }
    // hillshade
    const h0 = dz(x, z);
    if (h0 !== h0) { hs[k] = hs[k + 1] = hs[k + 2] = 30; continue; }
    const s = Math.max(0.8, res);
    const hx = dz(x + s, z), hxm = dz(x - s, z), hz = dz(x, z + s), hzm = dz(x, z - s);
    const gx = ((hx === hx ? hx : h0) - (hxm === hxm ? hxm : h0)) / (2 * s), gz = ((hz === hz ? hz : h0) - (hzm === hzm ? hzm : h0)) / (2 * s);
    const nx = -gx * 1.6, nz = -gz * 1.6, ny = 1, nl = Math.hypot(nx, nz, ny);
    const lx = -0.5, lz = -0.6, ly = 0.65; // light from NW and above
    const sh = Math.max(0.15, Math.min(1, (nx * lx + nz * lz + ny * ly) / nl / Math.hypot(lx, lz, ly) * 1.15));
    const e = Math.max(0, Math.min(1, (h0 - 3) / 40)); // height tint (a.s.l. roughly)
    hs[k] = Math.round(255 * sh * (0.55 + 0.45 * e)); hs[k + 1] = Math.round(255 * sh * (0.75 - 0.15 * e)); hs[k + 2] = Math.round(255 * sh * (0.95 - 0.55 * e));
  }
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">`;
  if (outlines) for (const g of M.game) {
    if (!g.ring.length) continue; let inb = false; for (const [x, z] of g.ring) if (Math.abs(x - cx) < size / 2 + 20 && Math.abs(z - cz) < size / 2 + 20) { inb = true; break; }
    if (!inb) continue;
    svg += `<polygon fill="none" stroke="${g.sight ? '#ff9a00' : '#ff2d55'}" stroke-width="1.2" points="${g.ring.map(([x, z]) => `${((x - x0) / res).toFixed(1)},${((z - z0) / res).toFixed(1)}`).join(' ')}"/>`;
  }
  for (const m of marks) svg += `<circle cx="${((m.x - x0) / res).toFixed(1)}" cy="${((m.z - z0) / res).toFixed(1)}" r="6" fill="none" stroke="#00ffd0" stroke-width="2"/>`;
  svg += `<text x="4" y="14" font-size="12" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="2.5" paint-order="stroke">${label.replace(/[<&]/g, '')}</text></svg>`;
  const A = await sharp(rgb, { raw: { width: px, height: px, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const Bh = await sharp(hs, { raw: { width: px, height: px, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  return [A, Bh];
}
export async function sheet(items, file, cols = 2) {
  // items: [Buffer...] laid in grid
  const meta = await Promise.all(items.map((b) => sharp(b).metadata()));
  const w = Math.max(...meta.map((m) => m.width)), h = Math.max(...meta.map((m) => m.height));
  const rows = Math.ceil(items.length / cols);
  await sharp({ create: { width: cols * w + (cols + 1) * 3, height: rows * h + (rows + 1) * 3, channels: 3, background: '#1d2127' } })
    .composite(items.map((b, i) => ({ input: b, left: 3 + (i % cols) * (w + 3), top: 3 + Math.floor(i / cols) * (h + 3) }))).png().toFile(file);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug, cx, cz, size, out] = process.argv.slice(2);
  const [A, B] = await cropPair(slug, +cx, +cz, +size, { label: `${slug} ${cx},${cz}` });
  await sheet([A, B], out, 2);
}
