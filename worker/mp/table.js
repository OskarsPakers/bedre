// Object table: id -> (x, z, fit radius, value, flags) for every swallowable object of the map, plus spawn candidates.
// The ids are the indices of `world.objects` in the browser (deterministic world build), so client and server agree on
// them. The table is produced at build time by tools/mp/build-objects.mjs by dumping the REAL client world (the exact
// code that builds buildings / scatter / movers), and stored as public/mp/objects.bin (served via the ASSETS binding).
// `hash` covers every id's fit/value/flags (+ position of non-movers); the client computes the same hash from its own world
// and the server refuses clients whose hash differs ("reload").
//
// Layout (little endian):  u32 magic 'BOT1' | u32 n | u32 hash | u32 nSpawn | f32 minX maxX minZ maxZ
//   f32 x[n] | f32 z[n] | f32 fit[n] | f32 value[n] | u8 flags[n] (+pad to 4) | f32 sx[s] | f32 sz[s] | u16 dens[s] (+pad)
// flags: 1 = mover (position unreliable: simulated per client), 2 = building

export const TABLE_MAGIC = 0x31544f42;
export const F_MOVER = 1;
export const F_BUILDING = 2;
const pad4 = (n) => (n + 3) & ~3;

/** FNV-1a over quantised object data. objs: [{x,z,fit,value,mover,isBuilding}] (the client's world.objects). */
export function hashObjects(objs) {
  let h = 0x811c9dc5;
  const mix = (w) => { h = Math.imul(h ^ (w | 0), 16777619); };
  mix(objs.length);
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    const fl = (o.mover ? F_MOVER : 0) | (o.isBuilding ? F_BUILDING : 0);
    mix(Math.round(o.fit * 100)); mix(Math.round(o.value * 10)); mix(fl);
    if (!o.mover) { mix(Math.round(o.x * 10)); mix(Math.round(o.z * 10)); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** objs as above; spawns: [{x,z,dens}]; bounds {minX,maxX,minZ,maxZ}. Returns ArrayBuffer. */
export function encodeTable(objs, spawns, bounds) {
  const n = objs.length, s = spawns.length;
  const size = 32 + n * 16 + pad4(n) + s * 8 + pad4(s * 2);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint32(0, TABLE_MAGIC, true); dv.setUint32(4, n, true);
  dv.setUint32(8, parseInt(hashObjects(objs), 16) >>> 0, true); dv.setUint32(12, s, true);
  dv.setFloat32(16, bounds.minX, true); dv.setFloat32(20, bounds.maxX, true);
  dv.setFloat32(24, bounds.minZ, true); dv.setFloat32(28, bounds.maxZ, true);
  let o = 32;
  const x = new Float32Array(buf, o, n); o += n * 4;
  const z = new Float32Array(buf, o, n); o += n * 4;
  const fit = new Float32Array(buf, o, n); o += n * 4;
  const val = new Float32Array(buf, o, n); o += n * 4;
  const fl = new Uint8Array(buf, o, n); o += pad4(n);
  const sx = new Float32Array(buf, o, s); o += s * 4;
  const sz = new Float32Array(buf, o, s); o += s * 4;
  const sd = new Uint16Array(buf, o, s);
  for (let i = 0; i < n; i++) {
    const q = objs[i];
    x[i] = q.x; z[i] = q.z; fit[i] = q.fit; val[i] = q.value;
    fl[i] = (q.mover ? F_MOVER : 0) | (q.isBuilding ? F_BUILDING : 0);
  }
  for (let i = 0; i < s; i++) { sx[i] = spawns[i].x; sz[i] = spawns[i].z; sd[i] = Math.min(65535, spawns[i].dens | 0); }
  return buf;
}

export function parseTable(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 32) throw new Error('object table: bad buffer');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== TABLE_MAGIC) throw new Error('object table: bad magic (is /mp/objects.bin missing?)');
  const n = dv.getUint32(4, true), s = dv.getUint32(12, true);
  const hash = (dv.getUint32(8, true) >>> 0).toString(16).padStart(8, '0');
  const bounds = { minX: dv.getFloat32(16, true), maxX: dv.getFloat32(20, true), minZ: dv.getFloat32(24, true), maxZ: dv.getFloat32(28, true) };
  let o = 32;
  const x = new Float32Array(buf, o, n); o += n * 4;
  const z = new Float32Array(buf, o, n); o += n * 4;
  const fit = new Float32Array(buf, o, n); o += n * 4;
  const value = new Float32Array(buf, o, n); o += n * 4;
  const flags = new Uint8Array(buf, o, n); o += pad4(n);
  const sx = new Float32Array(buf, o, s); o += s * 4;
  const sz = new Float32Array(buf, o, s); o += s * 4;
  const dens = new Uint16Array(buf, o, s);
  return { n, hash, bounds, x, z, fit, value, flags, spawn: { n: s, x: sx, z: sz, dens } };
}
