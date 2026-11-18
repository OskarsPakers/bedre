// node pack.mjs [tag] : params-<tag>.full.json -> data/params-<tag>.json (gated records + confidence flags, derived facts only) + data/params-<tag>.bin (packed, as the game would ship it) + round-trip check
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const TAG = process.argv[2] || 'centrs', D = path.join(import.meta.dirname, 'data'); const full = JSON.parse(fs.readFileSync(`${D}/params-${TAG}.full.json`, 'utf8'));
const GATE = { wall: 2, roof: 2, rhythm: 2 };
const q8 = (v, s, max = 255) => Math.max(0, Math.min(max, Math.round(v / s)));
const recs = []; for (const p of full.buildings.sort((a, b) => a.id - b.id)) { const q = p.q || [0, 0, 0]; const r = { id: p.id, q };
  if (p.w && q[0] >= GATE.wall) { r.w = p.w; if (p.w2 && p.w2r && p.w2r.every((i) => i < 16)) { r.w2 = p.w2; r.w2r = p.w2r; } }
  if (p.r && q[2] >= GATE.roof) { r.r = p.r; r.rc = p.rc; }
  if (p.fh && q[1] >= GATE.rhythm) Object.assign(r, { nF: p.nF, fh: p.fh, sp: p.sp, ww: p.ww, wh: p.wh, wy: p.wy, gh: p.gh, gk: p.gk, gs: p.gs, co: p.co, sc: p.sc, pil: p.pil, trim: p.trim });
  if (r.w || r.r || r.fh) recs.push(r); }
fs.writeFileSync(`${D}/params-${TAG}.json`, JSON.stringify({ v: 2, note: 'derived facts (colours, counts, periods) measured from the reality mesh; no pixels. q = [wall, rhythm, roof] confidence 0-3; fields are present only when the gate (>= 2) passed', buildings: recs }));
// ---- binary
const out = []; const vi = (n) => { while (n >= 128) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); };
out.push(0x42, 0x53, 0x50, 0x31); const cnt = recs.length; out.push(cnt & 255, (cnt >> 8) & 255, (cnt >> 16) & 255, (cnt >> 24) & 255); let prev = 0;
for (const r of recs) { vi(r.id - prev); prev = r.id; const hasW = !!r.w, hasR = !!r.r, hasH = !!r.fh, hasW2 = !!r.w2;
  out.push((hasW ? 1 : 0) | (hasR ? 2 : 0) | (hasH ? 4 : 0) | (hasW2 ? 8 : 0) | ((r.rc ?? 0) << 4) | (r.gk ? 128 : 0)); out.push(r.q[0] | (r.q[1] << 2) | (r.q[2] << 4));
  if (hasW) out.push(...r.w); if (hasR) out.push(...r.r); if (hasW2) { out.push(...r.w2); let m = 0; for (const i of r.w2r) m |= 1 << i; out.push(m & 255, m >> 8); }
  if (hasH) out.push(r.nF, q8(r.fh, 0.05), q8(r.sp, 0.05), q8(r.ww, 1 / 255), q8(r.wh, 1 / 255), q8(r.wy, 1 / 255), q8(r.gh, 0.1), q8(r.co, 0.05), q8(r.gs, 1 / 255), ...r.trim, (r.sc ? 1 : 0) | ((r.pil || 0) << 1)); }
const buf = Buffer.from(out); fs.writeFileSync(`${D}/params-${TAG}.bin`, buf);
// ---- decode + verify
let o = 8, pid = 0, bad = 0; const rd = () => buf[o++]; const rv = () => { let s = 0, n = 0, b; do { b = rd(); n |= (b & 127) << s; s += 7; } while (b & 128); return n; };
for (const r of recs) { pid += rv(); if (pid !== r.id) bad++; const f = rd(), qq = rd(); if (qq !== (r.q[0] | (r.q[1] << 2) | (r.q[2] << 4))) bad++; if (f & 1) { const w = [rd(), rd(), rd()]; if (w.join() !== r.w.join()) bad++; } if (f & 2) { const c = [rd(), rd(), rd()]; if (c.join() !== r.r.join() || ((f >> 4) & 7) !== r.rc) bad++; } if (f & 8) { o += 5; }
  if (f & 4) { const nF = rd(), fh = rd() * 0.05, sp = rd() * 0.05; o += 6 + 3 + 1; if (nF !== r.nF || Math.abs(fh - r.fh) > 0.026 || Math.abs(sp - r.sp) > 0.026) bad++; } }
console.log(`records ${recs.length}: wall ${recs.filter((r) => r.w).length}, roof ${recs.filter((r) => r.r).length}, rhythm ${recs.filter((r) => r.fh).length}, second wall ${recs.filter((r) => r.w2).length}`);
console.log(`binary ${buf.length} B (${(buf.length / recs.length).toFixed(1)} B/building), gzip ${zlib.gzipSync(buf).length} B; json ${fs.statSync(`${D}/params-${TAG}.json`).size} B, gzip ${zlib.gzipSync(fs.readFileSync(`${D}/params-${TAG}.json`)).length} B; round-trip mismatches ${bad}, trailing bytes ${buf.length - o}`);
