// Packs a gen.js building (palette mode, NO photo pixels) into the tram game's own compact binary: public/data/tram/sig/<name>.bin (gzip by the caller / static server).
//   usage: node tools/onebuilding/pack.mjs opera [stockmann bernu ...]
// Format "SIG1" (little endian): u32 jsonLen, json {name, min[3], size[3], normals[[x,y,z]*127 ints], lods:[{groups:[{mat, nv, ni, idx32}]}]}, then per LOD per group the planes:
//   pos  Int16 x3 per vertex (quantised over the bbox), byte-plane shuffled (all low bytes, then all high bytes: gzip likes it)
//   nrm  Uint8 index into the normal table, tone Uint8 (wall: palette zone 0..7), shade Uint8 (baked vertex AO), gid Uint16 (glass: unique window id; else 0)
//   idx  Uint16 (or Uint32 when nv > 65535)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['opera'];
const SRC = { opera: async () => (await import('./gen.js')).build, };
for (const name of names) {
  const mod = name === 'opera' ? await import('./gen.js') : await import(`./gen-${name}.js`);
  const lods = [0, 1, 2].map((lod) => mod.build({ lod, uv: 'palette', game: true }));
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const r of lods) for (const m of Object.values(r.mats)) for (let i = 0; i < m.p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.p[i + k]); mx[k] = Math.max(mx[k], m.p[i + k]); }
  const size = mx.map((v, k) => Math.max(1e-3, v - mn[k]));
  const ntab = [], nkey = new Map(); const nIndex = (x, y, z) => { const q = [x, y, z].map((v) => Math.round(v * 127)); const k = q.join(','); let i = nkey.get(k); if (i == null) { i = ntab.length; ntab.push(q); nkey.set(k, i); } return i; };
  const chunks = []; const meta = { name, min: mn, size, normals: ntab, lods: [] };
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const r of lods) {
    const L = { groups: [] };
    for (const [mat, m] of Object.entries(r.mats)) {
      const nvIn = m.p.length / 3, map = new Map(), P = [], Nn = [], T = [], S = [], Gd = [], I = [];
      for (let q = 0; q < m.i.length; q++) {
        const v = m.i[q]; const px = m.p[v * 3], py = m.p[v * 3 + 1], pz = m.p[v * 3 + 2], nx = m.n[v * 3], ny = m.n[v * 3 + 1], nz = m.n[v * 3 + 2];
        const u = m.uv[v * 2]; const tone = mat === 'glass' ? 4 : mat === 'roof' ? 3 : Math.min(7, Math.floor(u * 8));
        // baked vertex AO: ground contact on vertical faces, lighter towards the cornice; under-faces already carry their shade from gen.js
        let sh = m.c[v * 3]; if (Math.abs(ny) < 0.5) sh *= 0.78 + 0.22 * sm(0, 3.2, py) ; else if (ny < -0.5) sh *= 0.8;
        const gid = mat === 'glass' ? (Math.floor(q / 6)) & 0xffff : 0; // unique per quad (4 verts, 6 indices)
        const key = mat === 'glass' ? 'g' + v : [px.toFixed(3), py.toFixed(3), pz.toFixed(3), nIndex(nx, ny, nz), tone, Math.round(sh * 255)].join(',');
        let id = map.get(key);
        if (id == null) { id = P.length / 3; map.set(key, id); P.push(px, py, pz); Nn.push(nIndex(nx, ny, nz)); T.push(tone); S.push(Math.max(0, Math.min(255, Math.round(sh * 255)))); Gd.push(gid); }
        I.push(id);
      }
      const nv = P.length / 3, ni = I.length, big = nv > 65535;
      const pos = new Int16Array(nv * 3); { const qv = []; for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) qv.push(Math.round((P[i * 3 + k] - mn[k]) / size[k] * 65535)); for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const d = qv[i * 3 + k] - (i ? qv[(i - 1) * 3 + k] : 0); pos[i * 3 + k] = d; } }  // delta to the previous vertex
      const pb = Buffer.from(pos.buffer), shuf = Buffer.alloc(pb.length); for (let i = 0; i < pb.length / 2; i++) { shuf[i] = pb[i * 2]; shuf[pb.length / 2 + i] = pb[i * 2 + 1]; }
      const gb = Buffer.from(new Uint16Array(Gd).buffer), gs = Buffer.alloc(gb.length); for (let i = 0; i < gb.length / 2; i++) { gs[i] = gb[i * 2]; gs[gb.length / 2 + i] = gb[i * 2 + 1]; }
      let mxs = -1; const dI = I.map((v) => { const d = v === mxs + 1 ? 0 : mxs - v + 1; if (v > mxs) mxs = v; return d; }); const ib0 = Buffer.from((big ? new Uint32Array(dI) : new Uint16Array(dI)).buffer), w = big ? 4 : 2, ib = Buffer.alloc(ib0.length); for (let i = 0; i < ib0.length / w; i++) for (let b = 0; b < w; b++) ib[b * (ib0.length / w) + i] = ib0[i * w + b];
      // indices: delta to the previous index (quads are 4 consecutive vertices) -> small numbers, zigzag as Int16 / Int32 low-high planes
      chunks.push(shuf, Buffer.from(Uint8Array.from(Nn)), Buffer.from(Uint8Array.from(T)), Buffer.from(Uint8Array.from(S)), mat === 'glass' ? gs : Buffer.alloc(0), ib);
      L.groups.push({ mat, nv, ni, big, glass: mat === 'glass' });
    }
    meta.lods.push(L);
  }
  const js = Buffer.from(JSON.stringify(meta)); const head = Buffer.alloc(4); head.writeUInt32LE(js.length);
  const out = Buffer.concat([Buffer.from('SIG1'), head, js, ...chunks]);
  const gz = zlib.gzipSync(out, { level: 9 });
  const dir = path.join(ROOT, 'public/data/tram/sig'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.bin.gz'), gz);
  const tri = meta.lods.map((l) => l.groups.reduce((s, g) => s + g.ni / 3, 0));
  console.log(name, 'raw', out.length, 'gz', gz.length, 'tris', tri.join('/'), 'verts', meta.lods.map((l) => l.groups.reduce((s, g) => s + g.nv, 0)).join('/'), 'normals', ntab.length);
}
