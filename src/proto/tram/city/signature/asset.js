// Signature assets of the tram city: parametric buildings baked by tools/onebuilding/pack.mjs into public/data/tram/sig/<name>.bin.gz (format SIG1, photo-free: geometry + zone ids + baked vertex AO only).
// The game dresses them here: palette per zone (stone base / plaster / trim / roof / glass / metal / sculpture / door), unique window ids for the shader's lit-window mask (evening), the
// city's lo material (snow on up-facing faces, flood light at night). Three LOD meshes per building, switched by distance in update().
import * as THREE from 'three';
import { lin } from '../facade.js';

async function gunzip(res) {
  const buf = await res.arrayBuffer(); const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return u8;
}
/** -> { meta, lods: [[{mat, pos(Float32), nrm, tone, shade, gid, idx}]] } or null */
export async function loadSigAsset(name) {
  let u8; try { const r = await fetch(`/data/tram/sig/${name}.bin.gz`); if (!r.ok) return null; u8 = await gunzip(r); } catch { return null; }
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'SIG1') return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), jl = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl))); let o = 8 + jl;
  const lods = [];
  for (const L of meta.lods) {
    const gs = [];
    for (const g of L.groups) {
      const nv = g.nv, ni = g.ni, pos = new Float32Array(nv * 3), n2 = nv * 3 * 2; const q = u8.subarray(o, o + n2); o += n2;
      const half = nv * 3; let a = [0, 0, 0];
      for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const e = i * 3 + k; a[k] = (a[k] + (q[e] | (q[half + e] << 8))) & 0xffff; pos[e] = meta.min[k] + a[k] / 65535 * meta.size[k]; }
      const nrm = u8.subarray(o, o + nv); o += nv; const tone = u8.subarray(o, o + nv); o += nv; const shade = u8.subarray(o, o + nv); o += nv;
      let gid = null; if (g.glass) { gid = new Uint16Array(nv); const gq = u8.subarray(o, o + nv * 2); o += nv * 2; for (let i = 0; i < nv; i++) gid[i] = gq[i] | (gq[nv + i] << 8); }
      const w = g.big ? 4 : 2, ib = u8.subarray(o, o + ni * w); o += ni * w; const idx = g.big ? new Uint32Array(ni) : new Uint16Array(ni); let mx = -1;
      for (let i = 0; i < ni; i++) { let d = 0; for (let b = 0; b < w; b++) d |= ib[b * ni + i] << (8 * b); const v = d === 0 ? mx + 1 : mx - d + 1; if (v > mx) mx = v; idx[i] = v; }
      gs.push({ mat: g.mat, nv, pos, nrm, tone, shade, gid, idx });
    }
    lods.push(gs);
  }
  return { meta, lods, bytes: u8.length };
}

/** build one THREE.BufferGeometry per LOD (all material groups merged: the city's lo layout, so one draw call per LOD). pal = { tone -> hex }, opts.flood: night flood-light on plaster / trim */
export function buildSigGeometries(asset, pal, opts = {}) {
  const tab = asset.meta.normals, col = {};
  const cl = (t) => col[t] || (col[t] = lin(pal[t] ?? 0xcccccc));
  const out = [];
  for (const gs of asset.lods) {
    let nv = 0, ni = 0; for (const g of gs) { nv += g.nv; ni += g.idx.length; }
    const P = new Float32Array(nv * 3), N = new Int8Array(nv * 4), C = new Uint8Array(nv * 4), UV = new Float32Array(nv * 4), A = new Uint8Array(nv * 4), B = new Uint8Array(nv * 4), I = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of gs) {
      for (let i = 0; i < g.nv; i++) {
        const v = vo + i, t = g.nrm[i], tone = g.tone[i], sh = g.shade[i] / 255, c = cl(tone);
        P[v * 3] = g.pos[i * 3]; P[v * 3 + 1] = g.pos[i * 3 + 1]; P[v * 3 + 2] = g.pos[i * 3 + 2];
        N[v * 4] = tab[t][0]; N[v * 4 + 1] = tab[t][1]; N[v * 4 + 2] = tab[t][2];
        const k = g.mat === 'glass' ? 1 : sh;
        C[v * 4] = Math.round(Math.min(1, c[0] * k) * 255); C[v * 4 + 1] = Math.round(Math.min(1, c[1] * k) * 255); C[v * 4 + 2] = Math.round(Math.min(1, c[2] * k) * 255); C[v * 4 + 3] = 255;
        if (g.mat === 'glass') { UV[v * 4] = g.gid[i] + 0.5; A[v * 4] = 128; B[v * 4 + 3] = (g.gid[i] * 37) & 255; B[v * 4] = 0; }
        else if (opts.flood && g.mat === 'wall' && (tone === 0 || tone === 1)) A[v * 4] = 46; // flood-lit stone at night (the city's flag 0.1..0.25)
      }
      for (let i = 0; i < g.idx.length; i++) I[io + i] = g.idx[i] + vo;
      vo += g.nv; io += g.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 4, true)); geo.setAttribute('color', new THREE.BufferAttribute(C, 4, true));
    geo.setAttribute('uvw', new THREE.BufferAttribute(UV, 4)); geo.setAttribute('aA', new THREE.BufferAttribute(A, 4, true)); geo.setAttribute('aB', new THREE.BufferAttribute(B, 4, true));
    geo.setIndex(new THREE.BufferAttribute(I, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox();
    out.push({ geo, tris: ni / 3 });
  }
  return out;
}
