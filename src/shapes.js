// Loader for public/data/riga-shapes.bin.gz (built by tools/detail/build-meshes.mjs): measured heights for every building plus
// simplified roof meshes + outline loops for notable / relief buildings. Optional: resolves null on any failure.
import { CFG } from './config.js';

const STRIDE = 10;

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
      recs.set(r[0], { id: r[0], nv: r[1], nt: r[2], nl: r[3], src: r[4], vol: r[5], hmax: r[6] / 10, eave: r[7] / 10, roofRGB: r[8], ov, ot, ol });
      ov += r[1]; ot += r[2]; ol += r[3];
    }
    return { q: head.q, V, T, M, L, hs, recs, meta: head.meta };
  } catch (e) {
    console.info('[shapes] unavailable:', e.message);
    return null;
  }
}
