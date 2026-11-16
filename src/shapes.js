// Loader for public/data/riga-shapes.bin.gz (built by tools/detail/build-meshes.mjs): measured heights for every building plus
// simplified roof meshes + outline loops for notable / relief buildings. Optional: resolves null on any failure.
import { CFG } from './config.js';


/** file triangle material -> render class (0/1 roof, 2 wall with windows, 3 spire / dome accent, 5 gilded accent, 6 plain wall-coloured tread); shared by buildings.js and tools/detail/roof-report.mjs */
export function renderClass(m) { return m === 2 ? 2 : m === 3 ? 3 : m === 5 ? 5 : m === 4 ? 2 : m === 6 ? 6 : 1; }
/** colour slot per render class: every roof face (class 0 and 1, any slope) shares the single 'roof' colour; accents are whole spires / domes only */
export const COLOR_SLOT = ['roof', 'roof', 'wall', 'accent', 'wall', 'accent', 'wall']; // 6 = wall-coloured faces with their real normals (parapet / step treads)

async function inflate(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(s).arrayBuffer();
  }
  return buf;
}

function planes16(buf, byteOff, n, signed) {
  const u8 = new Uint8Array(buf, byteOff, n * 2);
  const out = signed ? new Int16Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = u8[i] | (u8[n + i] << 8);
  return out;
}

export async function loadShapes() {
  try {
    const res = await fetch(CFG.shapesUrl);
    if (!res.ok) return null;
    const buf = await inflate(await res.arrayBuffer());
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x31485342) return null; // 'BSH1'
    const hl = dv.getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    let off = 8 + hl;
    const [bv, bt, bm, bl] = head.bytes;
    const STRIDE = head.stride || 10;
    const nB = head.b.length / STRIDE;
    let totV = 0, totT = 0, totL = 0;
    for (let i = 0; i < nB; i++) { totV += head.b[i * STRIDE + 1]; totT += head.b[i * STRIDE + 2]; totL += head.b[i * STRIDE + 3]; }
    const V = planes16(buf, off, totV * 3, true); off += bv;
    const T = planes16(buf, off, totT * 3, false); off += bt;
    const M = new Uint8Array(buf, off, totT); off += bm;
    const L = planes16(buf, off, totL, true);
    const hs = new Map();
    for (let i = 0; i < head.hs.length; i += 3) hs.set(head.hs[i], [head.hs[i + 1] / 10, head.hs[i + 2] / 10]);
    const recs = new Map();
    let ov = 0, ot = 0, ol = 0;
    for (let i = 0; i < nB; i++) {
      const r = head.b.slice(i * STRIDE, i * STRIDE + STRIDE);
      recs.set(r[0], { id: r[0], nv: r[1], nt: r[2], nl: r[3], src: r[4], vol: r[5], hmax: r[6] / 10, eave: r[7] / 10, roofRGB: r[8], wallRGB: r[9] || 0, domeRGB: r[10] || 0, accentRGB: r[11] || 0, style: r[12] || 0, flags: r[13] || 0, ov, ot, ol });
      ov += r[1]; ot += r[2]; ol += r[3];
    }
    return { q: head.q, V, T, M, L, hs, recs, meta: head.meta };
  } catch (e) {
    console.info('[shapes] unavailable:', e.message);
    return null;
  }
}
