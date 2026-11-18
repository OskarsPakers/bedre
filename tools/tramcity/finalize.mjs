#!/usr/bin/env node
// facades-raw.json (measure.mjs) + tools/tramcity/overrides.json (hand corrections) -> public/data/tram/facades-centrs.json.gz
//  per building: facade runs { i, a:[x,z], b:[x,z] (building-local chord), len, g, gh, gk (0 none/unknown, 1 shop glazing, 2 plain/rusticated), rows:[[v0,v1]..] (windows, m above the game ground, bottom floor first),
//  cols:[[u,w]..] (window centre / width in metres along the run from a), mask: one integer per row (bit k = column k has a window), col: albedo rgb hex (lit, pavement-normalised) }.
import fs from 'node:fs';
import zlib from 'node:zlib';
const raw = JSON.parse(fs.readFileSync('tools/.cache/tramcity/facades-raw.json', 'utf8'));
const OV = fs.existsSync('tools/tramcity/overrides.json') ? JSON.parse(fs.readFileSync('tools/tramcity/overrides.json', 'utf8')) : {};
const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const srgb = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
const r2 = (v, k = 100) => Math.round(v * k) / k;

export function albedo(col, pave) {
  if (!col) return null;
  const pl = pave ? pave.map(lin) : [0.3, 0.3, 0.3]; const k = col.map((c, i) => c / Math.max(0.01, pl[i])); const kb = (k[0] + k[1] + k[2]) / 3;
  let a = k.map((v) => kb * Math.max(0.8, Math.min(1.25, v / kb)) * 0.32);
  if (a[2] > (a[0] + a[1]) / 2 * 1.04) a[2] = (a[0] + a[1]) / 2 + (a[2] - (a[0] + a[1]) / 2) * 0.3; // shaded facades read cool: pull the blue cast back to a neutral
  if (a[0] > a[1] * 1.1 && a[2] > a[1] * 0.97) a[0] = a[1] + (a[0] - a[1]) * 0.45; // rosy cast (red high, blue not low): not a Riga paint colour
  const lum = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; if (lum < 0.34) a = a.map((v) => v * 0.34 / lum); if (lum > 0.62) a = a.map((v) => v * 0.62 / lum);
  const mx = Math.max(...a); if (mx > 0.82) a = a.map((v) => v * 0.82 / mx);
  return (srgb(a[0]) << 16) | (srgb(a[1]) << 8) | srgb(a[2]);
}

/** uniform grid facade (override / default): floors of height fh with windows ww x wh on bays of width sp, optional ground band */
export function gridFacade(len, H, o) {
  const nb = Math.max(1, Math.round(len / o.sp)), bay = len / nb, gh = o.gh ?? 0, nF = o.floors ?? Math.max(1, Math.round((H - gh - 0.6) / (o.fh ?? 3.5))), fh = (H - gh - 0.6) / nF;
  const rows = [], cols = [], mask = [];
  for (let f = 0; f < nF; f++) { const b = gh + f * fh; rows.push([r2(b + fh * 0.2), r2(b + fh * 0.2 + (o.wh ?? 1.9))]); }
  for (let c = 0; c < nb; c++) cols.push([r2((c + 0.5) * bay), r2(o.ww ?? 1.25)]);
  for (let f = 0; f < nF; f++) mask.push(2 ** nb - 1);
  return { rows, cols, mask };
}

const out = {}; const st = { runs: 0, withWin: 0, nF: {}, overridden: 0 };
for (const [bid, B] of Object.entries(raw)) {
  const runs = [];
  for (const r of B.runs) {
    const ov = OV[bid + '_' + r.i] || OV[bid + '_*'];
    const e = { i: r.i, a: r.a, b: r.b, len: r.len, g: r2(r.g ?? 0) };
    const al = r.m ? albedo(r.col, r.pave) : null; if (al != null) e.col = al;
    const m = r.m;
    const unreliable = m && B.h > 9 && m.floors.filter((f) => f.bot > 1.4).length < 2;
    if (unreliable) delete e.col;
    const tiny = r.len < 5.5;
    if (m && !unreliable && !tiny && !(ov && ov.skip)) {
      const sorted = m.floors.slice().sort((x, y) => x.bot - y.bot);
      let ground = null; const up = [];
      for (const f of sorted) { if (!ground && f.bot < 1.4 && f.top < 6 && up.length === 0) ground = f; else up.push(f); }
      if (ground) { const wsum = ground.cols.reduce((s, c) => s + c[1] - c[0], 0); e.gh = r2(Math.min(6.5, Math.max(2.6, ground.top + 0.5))); e.gk = wsum / r.len > 0.5 ? 1 : 2; e.gc = ground.cols.map(([u0, u1]) => [r2((u0 + u1) / 2), r2(u1 - u0)]); } else { e.gk = 0; }
      // fill one missing floor inside (gap ~ 2 periods)
      const cen = up.map((f) => (f.top + f.bot) / 2); const per = med(cen.slice(1).map((c, i) => c - cen[i]).filter((d) => d > 2.3));
      const fl = []; for (let i = 0; i < up.length; i++) { fl.push(up[i]); if (i + 1 < up.length && per && cen[i + 1] - cen[i] > per * 1.7 && cen[i + 1] - cen[i] < per * 2.4) fl.push({ top: up[i].top + per, bot: up[i].bot + per, cols: null, cover: 0, inferred: true }); }
      if (fl.length) {
        // consensus columns
        const cand = []; for (const f of fl) if (f.cols) for (const [u0, u1] of f.cols) cand.push({ u: (u0 + u1) / 2, w: u1 - u0 });
        cand.sort((x, y) => x.u - y.u); const cl = []; for (const c of cand) { const l = cl[cl.length - 1]; if (l && c.u - l.us[l.us.length - 1] < 0.55) { l.us.push(c.u); l.ws.push(c.w); } else cl.push({ us: [c.u], ws: [c.w] }); }
        const covered = fl.filter((f) => f.cols && f.cover > 0.4).length || 1;
        const cols = cl.filter((c) => c.us.length >= Math.max(1, Math.ceil(covered * 0.5))).map((c) => [r2(med(c.us)), r2(Math.min(2.6, Math.max(0.7, med(c.ws))))]);
        const mask = fl.map(() => 2 ** cols.length - 1); // consensus columns on every floor (detection holes are misses far more often than blind bays; blind bays go in overrides)
        if (cols.length && cols.length <= 48) { e.rows = fl.map((f) => [r2(f.bot + e.g), r2(f.top + e.g)]); e.cols = cols; e.mask = mask; st.withWin++; st.nF[fl.length] = (st.nF[fl.length] || 0) + 1; }
      }
    }
    if (ov && ov.floors && e.cols) { const H = B.h, gh0 = e.gh ?? 3.4, top = H - 1.2, per = (top - gh0) / ov.floors; e.rows = Array.from({ length: ov.floors }, (_, f) => { const c = gh0 + per * (f + 0.5) + e.g; return [r2(c - 0.95), r2(c + 0.95)]; }); e.mask = e.rows.map(() => 2 ** e.cols.length - 1); st.overridden++; }
    if (ov && ov.skip) { delete e.rows; delete e.cols; delete e.mask; delete e.col; delete e.gh; delete e.gc; delete e.gk; st.overridden++; }
    if (ov && !ov.skip && !ov.floors) { st.overridden++; if (ov.grid) { const H = B.h; Object.assign(e, gridFacade(r.len, H, { ...ov.grid, gh: ov.grid.gh ?? e.gh ?? 0 })); if (ov.grid.gh != null) e.gh = ov.grid.gh; } if (ov.gh != null) e.gh = ov.gh; if (ov.gk != null) e.gk = ov.gk; }
    st.runs++;
    if (e.rows || e.col != null || e.gh) runs.push(e);
  }
  if (runs.length) out[bid] = runs;
}
fs.writeFileSync('public/data/tram/facades-centrs.json.gz', zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, b: out })), { level: 9 }));
console.log('facades', Object.keys(out).length, 'buildings', st.runs, 'runs', st.withWin, 'with window grid', JSON.stringify(st.nF), 'overridden', st.overridden, fs.statSync('public/data/tram/facades-centrs.json.gz').size, 'B gz');
