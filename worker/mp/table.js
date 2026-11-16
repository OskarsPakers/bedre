// Placement / object table file: THE single source of truth for "which swallowable objects exist" (ids, positions, fit, value, kinds)
// on every engine. Client AND server read exactly these bytes:
//   * the browser builds its props + movers FROM this file (src/placements.js, src/world.js) instead of running the procedural
//     scatter, whose result differs between JS engines (V8 / JavaScriptCore / SpiderMonkey);
//   * the Worker parses the same file (centre map: /data/riga-objects.bin.gz via the ASSETS binding) as its object table.
// Object id = index in the file = index in the client's `world.objects` (buildings first, in riga.json order, then props / movers).
// The handshake id is hashBytes() of the (decompressed) file bytes: identical bytes -> identical id on every engine, nothing float-based.
//
// Generated at build time by tools/mp/build-objects.mjs, which drives the real client world in headless Chromium with ?placements=generate.
//
// Layout (little endian), all columns 4-byte aligned:
//   u32 magic 'BOP2' | u32 n | u32 nB (buildings = ids 0..nB-1) | u32 nSpawn | u32 nMov | u32 metaLen | u32 0 | u32 0   (32 bytes)
//   meta JSON (UTF-8, padded to 4):  { v, slug, bounds, spawn, kinds[], names[[id,name]..], roads{}, parks }
//   u16 xLo[n], u16 zLo[n] + i8 xHi[n], i8 zHi[n]  = delta from the previous object's position in 1/16 m (absolute coordinates; split in planes: props of one chunk are
//   neighbours, so the deltas are small and the high planes are almost all zero -> gzips well)
//   u16 fit[n] (1/200 m) | u16 value[n] | u16 yaw[n] (turn/1024) | u16 s[n] (1/64; 0 for buildings) | u16 tint[n] (65535 = none, else /4094) | u8 kind[n] | u8 flags[n]
//   f32 mover[nMov * 12]   one record per mover object in id order (see src/traffic.js moverRecord / moverFromRecord)
//   f32 spawnX[nSpawn] | f32 spawnZ[nSpawn] | u16 dens[nSpawn]
// flags: 1 = mover (position unreliable: simulated per client), 2 = building, 4 = landmark

export const TABLE_MAGIC = 0x32504f42; // 'BOP2'
export const F_MOVER = 1;
export const F_BUILDING = 2;
export const F_LANDMARK = 4;
export const MOVER_STRIDE = 12;
export const TINT_NONE = 65535;
const pad4 = (n) => (n + 3) & ~3;

/** Content id of a file: two independent FNV-1a 32 passes over the bytes -> 16 hex chars. Pure integer math (same on every engine). */
export function hashBytes(u8) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b + c + 1, 0x85ebca6b);
    b ^= b >>> 15;   // second stream: other seed, other mixer
  }
  const h = (v) => (v >>> 0).toString(16).padStart(8, '0');
  return h(a) + h(b);
}

/** objs: [{kind(index), x, z, fit, value, flags, yaw, s, tint}] in id order; movers: Float32Array(nMov*12); spawns: [{x,z,dens}]; meta: JSON-able. */
export function encodeTable({ objs, nB, movers, spawns, meta }) {
  const n = objs.length, s = spawns.length, nMov = movers.length / MOVER_STRIDE;
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const mlen = pad4(metaBytes.length);
  const size = 32 + mlen + n * 2 * 7 + 4 + pad4(n) * 4 + nMov * MOVER_STRIDE * 4 + s * 8 + pad4(s * 2) + 4;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint32(0, TABLE_MAGIC, true); dv.setUint32(4, n, true); dv.setUint32(8, nB, true); dv.setUint32(12, s, true);
  dv.setUint32(16, nMov, true); dv.setUint32(20, metaBytes.length, true);
  new Uint8Array(buf, 32, metaBytes.length).set(metaBytes);
  let o = 32 + mlen;
  const x = new Uint16Array(buf, o, n); o += n * 2;
  const z = new Uint16Array(buf, o, n); o += n * 2;
  const fit = new Uint16Array(buf, o, n); o += n * 2;
  const val = new Uint16Array(buf, o, n); o += n * 2;
  const yaw = new Uint16Array(buf, o, n); o += n * 2;
  const sc = new Uint16Array(buf, o, n); o += n * 2;
  const tint = new Uint16Array(buf, o, n); o += n * 2;
  o = pad4(o);
  const kind = new Uint8Array(buf, o, n); o += pad4(n);
  const fl = new Uint8Array(buf, o, n); o += pad4(n);
  const xh = new Int8Array(buf, o, n); o += pad4(n);
  const zh = new Int8Array(buf, o, n); o += pad4(n);
  new Float32Array(buf, o, nMov * MOVER_STRIDE).set(movers); o += nMov * MOVER_STRIDE * 4;
  const sx = new Float32Array(buf, o, s); o += s * 4;
  const sz = new Float32Array(buf, o, s); o += s * 4;
  const sd = new Uint16Array(buf, o, s);
  const inRange = (v, max, what, i) => { if (!(v >= -128 && v <= max)) throw new Error(`encodeTable: ${what} out of range for object ${i} (${v})`); return v; };
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const q = objs[i];
    const qx = Math.round(q.x * 16), qz = Math.round(q.z * 16);
    const dx = qx - px, dz = qz - pz;
    x[i] = dx & 0xffff; xh[i] = inRange(dx >> 16, 127, 'x', i) | 0; z[i] = dz & 0xffff; zh[i] = inRange(dz >> 16, 127, 'z', i) | 0; px = qx; pz = qz;
    fit[i] = inRange(Math.round(q.fit * 200), 65535, 'fit', i); val[i] = inRange(q.value | 0, 65535, 'value', i);
    const turn = (((q.yaw || 0) / (Math.PI * 2)) % 1 + 1) % 1;
    yaw[i] = Math.round(turn * 1024) & 1023;
    sc[i] = inRange(Math.round((q.s || 0) * 64), 65535, 's', i);
    tint[i] = q.tint == null ? TINT_NONE : Math.min(4094, Math.round(q.tint * 4094));
    kind[i] = q.kind; fl[i] = q.flags;
  }
  for (let i = 0; i < s; i++) { sx[i] = spawns[i].x; sz[i] = spawns[i].z; sd[i] = Math.min(65535, spawns[i].dens | 0); }
  return buf;
}

/** buf: the decompressed file bytes. Returns typed columns + helpers; throws on a bad file. */
export function parseTable(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 32) throw new Error('object table: bad buffer');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== TABLE_MAGIC) throw new Error('object table: bad magic (missing or old-format objects file?)');
  const n = dv.getUint32(4, true), nB = dv.getUint32(8, true), s = dv.getUint32(12, true), nMov = dv.getUint32(16, true), ml = dv.getUint32(20, true);
  const hash = hashBytes(new Uint8Array(buf));
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 32, ml)));
  let o = 32 + pad4(ml);
  const xd = new Uint16Array(buf, o, n); o += n * 2;
  const zd = new Uint16Array(buf, o, n); o += n * 2;
  const fq = new Uint16Array(buf, o, n); o += n * 2;
  const value = new Uint16Array(buf, o, n); o += n * 2;
  const yq = new Uint16Array(buf, o, n); o += n * 2;
  const sq = new Uint16Array(buf, o, n); o += n * 2;
  const tint = new Uint16Array(buf, o, n); o += n * 2;
  o = pad4(o);
  const kind = new Uint8Array(buf, o, n); o += pad4(n);
  const flags = new Uint8Array(buf, o, n); o += pad4(n);
  const xh = new Int8Array(buf, o, n); o += pad4(n);
  const zh = new Int8Array(buf, o, n); o += pad4(n);
  const movers = new Float32Array(buf, o, nMov * MOVER_STRIDE); o += nMov * MOVER_STRIDE * 4;
  const sx = new Float32Array(buf, o, s); o += s * 4;
  const sz = new Float32Array(buf, o, s); o += s * 4;
  const dens = new Uint16Array(buf, o, s);
  const x = new Float64Array(n), z = new Float64Array(n), fit = new Float64Array(n), yaw = new Float64Array(n), sc = new Float64Array(n);
  let px = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    px += (xh[i] << 16) | xd[i]; pz += (zh[i] << 16) | zd[i];
    x[i] = px / 16; z[i] = pz / 16;      // exact binary fractions: bit-identical on every engine
    fit[i] = fq[i] / 200; yaw[i] = yq[i] / 1024 * (Math.PI * 2); sc[i] = sq[i] / 64;
  }
  return { n, nB, nMov, hash, meta, bounds: meta.bounds, kinds: meta.kinds, x, z, fit, value, yaw, s: sc, tint, kind, flags, movers, spawn: { n: s, x: sx, z: sz, dens } };
}

/** gunzip when the bytes are gzip (magic 1f 8b), otherwise pass through. Works in browsers (>= iOS 16.4), workerd and Node 18+. */
export async function inflateIfGzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return buf;
}
