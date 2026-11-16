import fs from 'node:fs'; import { loadMap, loadDsm, loadGround, roughness, QC } from './lib.mjs';
for (const slug of ['centrs', 'agenskalns', 'mezaparks', 'purvciems']) {
  const M = loadMap(slug), dsm = loadDsm(slug), G = await loadGround(slug), RG = roughness(dsm); const b = M.bounds; const { w, h, x0, z0, d } = dsm;
  const ox = Math.round(b.minX - x0), oz = Math.round(b.minZ - z0);
  const cnt = new Array(10).fill(0); let tot = 0, meshTree = 0, meshObs = 0, pngCan = 0, meshTreeAndPngCan = 0, meshTreeOnly = 0;
  for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) { const c = G.cls[j * G.w + i]; cnt[c]++; const k = (j + oz) * w + (i + ox); const v = d[k]; if (v !== v) continue; meshObs++; 
    // tree proxy: rough cell, and elevated over local 15 m min
    }
  // local ground via 4 m min filter window 20 m
  const S = 4, cw = Math.ceil(w / S), ch = Math.ceil(h / S); const mn = new Float32Array(cw * ch).fill(1e9); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = d[j * w + i]; if (v === v) { const k = ((j / S) | 0) * cw + ((i / S) | 0); if (v < mn[k]) mn[k] = v; } }
  const loc = (i, j) => { let m = 1e9; for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) { const a = Math.floor(i / S) + di, bq = Math.floor(j / S) + dj; if (a < 0 || bq < 0 || a >= cw || bq >= ch) continue; m = Math.min(m, mn[bq * cw + a]); } return m; };
  let obs = 0, tree = 0, treeCls2 = 0, cls2 = 0, cls1 = 0, cls1tree = 0;
  for (let j = 0; j < G.h; j += 2) for (let i = 0; i < G.w; i += 2) { const k = (j + oz) * w + (i + ox); const v = d[k]; if (v !== v) continue; const r = RG[k]; if (r !== r) continue; const c = G.cls[j * G.w + i]; const lg = loc(i + ox, j + oz); const isTree = v - lg >= 3 && r > 1.3; obs++; if (isTree) tree++; if (c === 2) { cls2++; if (isTree) treeCls2++; } if (c === 1) { cls1++; if (isTree) cls1tree++; } }
  const tot2 = G.w * G.h; const names = ['other', 'lawn', 'canopy', 'asphalt', 'paving', 'gravel', 'water', 'ballast', 'sett'];
  const r = { slug, classShares: Object.fromEntries(names.map((n, i) => [n, +(cnt[i] / tot2).toFixed(3)])), meshObservedCells: obs, meshTreeShareOfObserved: +(tree / obs).toFixed(3), gameCanopyClassShareOfObserved: +(cls2 / obs).toFixed(3), canopyClassCellsThatMeshCallsTree: +(treeCls2 / Math.max(1, cls2)).toFixed(2), lawnClassCellsThatMeshCallsTree: +(cls1tree / Math.max(1, cls1)).toFixed(2), treesInData: M.city.trees.length };
  fs.writeFileSync(`${QC}/canopy-${slug}.json`, JSON.stringify(r)); console.log(JSON.stringify(r));
}
