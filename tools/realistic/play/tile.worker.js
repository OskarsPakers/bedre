// Tile worker: fetch geometry + jpg from the local server, decode, transform into the game's local frame, resize the texture. All off the main thread.
const R = 6378137, D2R = Math.PI / 180, MX0 = 24.1133 * D2R * R, MY0 = Math.log(Math.tan(Math.PI / 4 + 56.9515 * D2R / 2)) * R, K = 1 / Math.cos(56.9515 * D2R);
const TS = { Float32: [4, Float32Array], UInt8: [1, Uint8Array], UInt16: [2, Uint16Array], UInt32: [4, Uint32Array] };
function jpegSize(u8) { let i = 2; while (i < u8.length) { if (u8[i] !== 0xFF) { i++; continue; } const m = u8[i + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [(u8[i + 7] << 8) | u8[i + 8], (u8[i + 5] << 8) | u8[i + 6]]; i += 2 + ((u8[i + 2] << 8) | u8[i + 3]); } return [0, 0]; }
onmessage = async ({ data: { id, gurl, turl, url, def, center: c, cap } }) => {
  try {
    let gb, tb;
    if (url) { const r = await fetch(url); if (!r.ok) throw new Error('tile ' + r.status); const all = await r.arrayBuffer(), dv0 = new DataView(all), gl = dv0.getUint32(0, true), tl = dv0.getUint32(4, true); gb = all.slice(8, 8 + gl); tb = tl ? new Blob([all.slice(8 + gl, 8 + gl + tl)], { type: 'image/jpeg' }) : null; }
    else [gb, tb] = await Promise.all([fetch(gurl).then((r) => { if (!r.ok) throw new Error('geo ' + r.status); return r.arrayBuffer(); }), turl ? fetch(turl).then((r) => { if (!r.ok) throw new Error('tex ' + r.status); return r.blob(); }) : null]);
    const vc = new DataView(gb).getUint32(0, true); let off = 8; const A = {};
    const hasN = gb.byteLength - 8 >= vc * 32; for (const k of ['position', 'normal', 'uv0', 'color']) { const a = def[k]; if (!a || (k === 'normal' && !hasN)) continue; const [sz, C] = TS[a.type], n = vc * a.component; A[k] = new C(gb, off, n); off += n * sz; }
    const pos = new Float32Array(vc * 3), P = A.position; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < vc; i++) { const x = (c[0] + P[i * 3] - MX0) / K, y = c[2] + P[i * 3 + 2], z = -((c[1] + P[i * 3 + 1] - MY0) / K); pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const uv = new Float32Array(A.uv0); let bitmap = null, w = 0, h = 0;
    if (tb) { const [W, H] = jpegSize(new Uint8Array(await tb.slice(0, 65536).arrayBuffer())); let rw = W, rh = H; if (W * H > cap) { const s = Math.sqrt(cap / (W * H)); rw = Math.max(16, Math.round(W * s)); rh = Math.max(16, Math.round(H * s)); }
      bitmap = await createImageBitmap(tb, W && (rw !== W) ? { imageOrientation: 'none', resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' } : { imageOrientation: 'none' }); w = bitmap.width; h = bitmap.height; }
    postMessage({ id, pos, uv, bb: [x0, y0, z0, x1, y1, z1], bitmap, w, h, vc }, bitmap ? [pos.buffer, uv.buffer, bitmap] : [pos.buffer, uv.buffer]);
  } catch (e) { postMessage({ id, error: String(e.message || e) }); }
};
