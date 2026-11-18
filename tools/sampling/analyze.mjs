// SAMPLING, step 2 (node): rectified facade / roof images (tools/.cache/sampling, intermediate) -> compact per-building parameters (tools/sampling/data/params.json, NO pixels) + analysis.json (per-run numbers for the review sheets).
// usage: node analyze.mjs
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'), SC = path.join(ROOT, 'tools/.cache/sampling'), OUT = path.join(import.meta.dirname, 'data'); fs.mkdirSync(OUT, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(SC, 'meta.json'), 'utf8'));
// ---- colour
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function lab(r, g, b) { const R = lin(r), G = lin(g), B = lin(b); let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); X = f(X); Y = f(Y); Z = f(Z); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; }
function unlab(L, a, b) { const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200; const fi = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787); const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883;
  let R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z; const gm = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); }; return [gm(R), gm(G), gm(B)]; }
const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const med = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const medLab = (L, A, B, idx) => [med(idx.map((i) => L[i])), med(idx.map((i) => A[i])), med(idx.map((i) => B[i]))];
async function loadImg(f) { const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { w: info.width, h: info.height, d: data }; }
const smooth = (a, k) => a.map((_, i) => { let s = 0, n = 0; for (let j = -k; j <= k; j++) { const v = a[i + j]; if (Number.isFinite(v)) { s += v; n++; } } return n ? s / n : NaN; });
function acf(x, lagMin, lagMax) { // normalised autocorrelation of a (mean-removed) series with NaN gaps
  const v = x.filter(Number.isFinite); const m = v.reduce((s, q) => s + q, 0) / (v.length || 1); const out = []; let var0 = 0, n0 = 0; for (const q of x) if (Number.isFinite(q)) { var0 += (q - m) ** 2; n0++; } var0 = var0 / (n0 || 1) || 1e-9;
  for (let lag = lagMin; lag <= lagMax; lag++) { let s = 0, n = 0; for (let i = 0; i + lag < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(x[i + lag])) { s += (x[i] - m) * (x[i + lag] - m); n++; } out.push(n > 8 ? s / n / var0 * Math.min(1, n / (x.length * 0.5)) : -1); }
  return out; }
function peaks(x, minV, minDist) { const p = []; for (let i = 1; i < x.length - 1; i++) if (Number.isFinite(x[i]) && x[i] >= minV && x[i] >= x[i - 1] && x[i] > x[i + 1]) { if (p.length && i - p[p.length - 1] < minDist) { if (x[i] > x[p[p.length - 1]]) p[p.length - 1] = i; } else p.push(i); } return p; }
function bestPeriod(x, minP, maxP, px) { // lag (pixels) of the first strong ACF peak (smallest lag with >= 0.75 of the max peak: avoids multiples)
  const a = acf(x, Math.round(minP / px), Math.round(maxP / px)); const lo = Math.round(minP / px); const pk = peaks(a, 0.05, 2); if (!pk.length) return { period: NaN, conf: 0 };
  const mx = Math.max(...pk.map((i) => a[i])); const first = pk.find((i) => a[i] >= (minP < 3 ? 0.75 : 0.55) * mx); return { period: (first + lo) * px, conf: a[first] }; }

// ---- one facade run
async function analyseRun(b, R) {
  const f = path.join(SC, 'rect', `${b.id}_${R.i}.png`); if (!fs.existsSync(f) || !R.w) return null;
  const im = await loadImg(f), { w, h, d } = im; const px = R.len / w, ypx = 0.1; const yOf = (r) => (h - 1 - r) * ypx - 0.5; // height above ground of image row r
  const N = w * h, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), valid = new Uint8Array(N); const hue = new Float32Array(N), rgb = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) { if (d[i * 4 + 3] < 128) continue; const [l, a, bb] = lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); L[i] = l; A[i] = a; B[i] = bb; valid[i] = 1; rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
  // facade top: highest row where >= 30 % of the columns have surface
  const rowCov = new Float32Array(h); for (let r = 0; r < h; r++) { let c = 0; for (let x = 0; x < w; x++) c += valid[r * w + x]; rowCov[r] = c / w; }
  let top = 0; for (let r = 0; r < h; r++) if (rowCov[r] >= 0.3) { top = yOf(r); break; } const Htop = Math.min(top, b.h + 0.5);
  // reject: trees (green), sky (bright blue), black
  const bad = new Uint8Array(N); for (let i = 0; i < N; i++) if (valid[i]) { const C = Math.hypot(A[i], B[i]); if ((A[i] < -7 && C > 14 && B[i] > -5) || (B[i] < -14 && L[i] > 72) || L[i] < 9) bad[i] = 1; }
  const y0c = 4.0, y1c = Htop - 0.3; const zone = []; for (let r = 0; r < h; r++) { const y = yOf(r); if (y < y0c || y > y1c) continue; for (let x = 0; x < w; x++) { const i = r * w + x; if (valid[i] && !bad[i]) zone.push(i); } }
  const zoneArea = (y1c - y0c) * R.len; const cover = zone.length * px * ypx / Math.max(1, zoneArea); if (zone.length < 300 || Htop < 5) return { cover, Htop, ok: false };
  // wall colour: upper 60 % by L, then refine within dE < 16 of the median
  const Ls = zone.map((i) => L[i]).sort((p, q) => p - q), Lcut = Ls[Math.floor(Ls.length * 0.4)]; let idx = zone.filter((i) => L[i] >= Lcut); let wl = medLab(L, A, B, idx);
  for (let k = 0; k < 2; k++) { idx = zone.filter((i) => dE([L[i], A[i], B[i]], wl) < 16 && L[i] > wl[0] - 12); if (idx.length > 100) wl = medLab(L, A, B, idx); }
  const wallShare = idx.length / zone.length;
  // opening mask: clearly darker than the wall (blurred 3x3), valid, not rejected
  const Lb = new Float32Array(N); for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const rr = r + dy, xx = x + dx; if (rr < 0 || rr >= h || xx < 0 || xx >= w) continue; const i = rr * w + xx; if (valid[i]) { s += L[i]; n++; } } Lb[r * w + x] = n ? s / n : NaN; }
  const thr = Math.max(10, Math.min(22, wl[0] * 0.22)); const M = new Uint8Array(N); for (let i = 0; i < N; i++) if (valid[i] && !bad[i] && Lb[i] < wl[0] - thr) M[i] = 1;
  // row profile of openings (fraction of valid, non-rejected pixels)
  const nrow = Math.floor((Htop + 0.5) / ypx); const prof = new Array(nrow).fill(NaN), lumRow = new Array(nrow).fill(NaN);
  for (let k = 0; k < nrow; k++) { const r = h - 1 - Math.round((k * ypx + 0.5) / ypx); if (r < 0 || r >= h) continue; let v = 0, m = 0, ls = 0; for (let x = 0; x < w; x++) { const i = r * w + x; if (valid[i] && !bad[i]) { v++; m += M[i]; ls += L[i]; } } if (v > w * 0.35) { prof[k] = m / v; lumRow[k] = ls / v; } }
  const sp = smooth(prof, 2); // index k = height k*0.1 m
  const yLo = Math.round(3.3 / ypx), yHi = Math.round((Htop - 0.4) / ypx);
  const seg = sp.slice(yLo, yHi); const per = bestPeriod(seg, 2.4, 7.6, ypx);
  // window-row peaks above 3.3 m
  const mx = Math.max(...seg.filter(Number.isFinite), 0.05); const pk = peaks(seg.map((v) => (Number.isFinite(v) ? v : 0)), Math.max(0.12, mx * 0.35), Math.round(2.0 / ypx)).map((i) => (i + yLo) * ypx);
  let fh = per.period, rows = pk;
  if (pk.length >= 3) { const n = pk.length; const xs = pk.map((_, i) => i), my = pk.reduce((s, q) => s + q, 0) / n, mx2 = (n - 1) / 2; let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx2) * (pk[i] - my); sxx += (x - mx2) ** 2; }); const slope = sxy / sxx; if (slope > 2.2 && slope < 8 && (!Number.isFinite(fh) || Math.abs(slope - fh) < 0.9)) fh = slope; }
  const fhOk = Number.isFinite(fh) && per.conf > 0.18; if (!Number.isFinite(fh)) fh = 3.4;
  // fold the opening profile (above 3.3 m) modulo fh: window vertical extent
  const fold = new Float64Array(20).fill(0), fn = new Float64Array(20).fill(0); const y1 = pk.length ? pk[0] : 4.6; // reference: first window row centre
  for (let k = yLo; k < yHi; k++) if (Number.isFinite(sp[k])) { const ph = (((k * ypx - y1) / fh) % 1 + 1) % 1; const bi = Math.floor(ph * 20); fold[bi] += sp[k]; fn[bi]++; }
  const fp = Array.from(fold, (v, i) => (fn[i] ? v / fn[i] : 0)); let ci = 0; for (let i = 0; i < 20; i++) if (fp[i] > fp[ci]) ci = i; const half = fp[ci] * 0.5; let a = ci, bq = ci; while (fp[(a + 19) % 20] > half && ci - a < 12) a--; while (fp[(bq + 1) % 20] > half && bq - ci < 12) bq++; // window phase extent around the row centre
  const wFrac = Math.max(0.25, Math.min(0.8, (bq - a + 1) / 20)); const cPh = ((a + bq + 1) / 2 / 20) % 1; // centre phase relative to y1 (y1 is the peak, so ~0)
  // floors: window centre of the first row = y1 + cPh offset ; gH = y1 - c*fh with the window centred at fraction wyC = wy0 + wFrac/2
  const wy0 = 0.5 - wFrac / 2 + 0.04; const gH0 = y1 - (wy0 + wFrac / 2) * fh; const gH = Math.max(2.4, Math.min(7.2, gH0));
  // opening width / spacing from the column profile inside the window rows of the upper floors
  const colp = new Array(w).fill(0), coln = new Array(w).fill(0);
  for (let r = 0; r < h; r++) { const y = yOf(r); if (y < gH + 0.3 || y > Htop - 0.5) continue; const ph = (((y - (gH)) / fh) % 1 + 1) % 1; if (ph < wy0 || ph > wy0 + wFrac) continue; for (let x = 0; x < w; x++) { const i = r * w + x; if (valid[i] && !bad[i]) { colp[x] += M[i]; coln[x]++; } } }
  const col = colp.map((v, x) => (coln[x] > 8 ? v / coln[x] : NaN)); const cs = smooth(col, 1); const perC = bestPeriod(cs, 1.5, 9, px);
  let spc = perC.period, spOk = Number.isFinite(spc) && perC.conf > 0.2; if (!Number.isFinite(spc)) spc = 3.6;
  // refine by regression on column peaks
  const cpk = peaks(cs.map((v) => (Number.isFinite(v) ? v : 0)), 0.2, Math.round(1.2 / px)); if (cpk.length >= 4) { const n = cpk.length, my = cpk.reduce((s, q) => s + q * px, 0) / n, mx2 = (n - 1) / 2; let sxy = 0, sxx = 0; cpk.forEach((q, i) => { sxy += (i - mx2) * (q * px - my); sxx += (i - mx2) ** 2; }); const sl = sxy / sxx; if (Math.abs(sl - spc) < 0.35 * spc) spc = sl; }
  // window width fraction: fold the column profile by spc
  const nb = 16, cf = new Float64Array(nb), cfn = new Float64Array(nb); cs.forEach((v, x) => { if (!Number.isFinite(v)) return; const ph = ((x * px / spc) % 1 + 1) % 1; const bi = Math.floor(ph * nb); cf[bi] += v; cfn[bi]++; }); const cfp = Array.from(cf, (v, i) => (cfn[i] ? v / cfn[i] : 0));
  let cj = 0; for (let i = 0; i < nb; i++) if (cfp[i] > cfp[cj]) cj = i; const chalf = cfp[cj] * 0.5; let ca = cj, cb = cj; while (cfp[(ca + nb - 1) % nb] > chalf && cj - ca < nb - 2) ca--; while (cfp[(cb + 1) % nb] > chalf && cb - cj < nb - 2) cb++; const ww = Math.max(0.25, Math.min(0.85, (cb - ca + 1) / nb));
  // window ratio of upper facade
  let mm = 0, vv = 0; for (let r = 0; r < h; r++) { const y = yOf(r); if (y < gH + 0.3 || y > Htop - 0.8) continue; for (let x = 0; x < w; x++) { const i = r * w + x; if (valid[i] && !bad[i]) { vv++; mm += M[i]; } } } const wwr = vv ? mm / vv : NaN;
  // floors above the ground band: count by the measured window rows & by geometry
  const co = Math.max(0.3, Math.min(1.8, Htop - gH - Math.round((Htop - gH - 0.6) / fh) * fh)); const nF = Math.max(1, Math.round((Htop - gH - 0.5 * co) / fh));
  const nPeaks = pk.filter((y) => y > gH + 0.3).length;
  // ground band: openings above 0.8 m vs upper facade; darker / glazed => shopfront
  let gm = 0, gv = 0, gl = 0; for (let r = 0; r < h; r++) { const y = yOf(r); if (y < 0.9 || y > gH - 0.35) continue; for (let x = 0; x < w; x++) { const i = r * w + x; if (valid[i] && !bad[i]) { gv++; gm += M[i]; gl += L[i]; } } } const gwr = gv > 200 ? gm / gv : NaN, gL = gv > 200 ? gl / gv : NaN;
  const shop = Number.isFinite(gwr) && (gwr > Math.max(0.3, wwr * 1.5) || (gL < wl[0] - 14 && gwr > 0.2)) ? 1 : 0;
  // vertical-gradient energy per floor phase: string courses (boundary phase) ; ground band rustication (energy of the band vs wall rows)
  const gE = new Float64Array(20), gEn = new Float64Array(20); for (let k = Math.round((gH + 0.3) / ypx); k < yHi - 1; k++) { const r = h - 1 - Math.round((k * ypx + 0.5) / ypx); if (r < 1 || r >= h - 1) continue; let s = 0, n = 0; for (let x = 0; x < w; x++) { const i = r * w + x, j = (r - 1) * w + x; if (valid[i] && valid[j] && !M[i] && !M[j] && !bad[i]) { s += Math.abs(L[i] - L[j]); n++; } } if (n > w * 0.3) { const ph = (((k * ypx - gH) / fh) % 1 + 1) % 1; gE[Math.floor(ph * 20)] += s / n; gEn[Math.floor(ph * 20)]++; } }
  const ge = Array.from(gE, (v, i) => (gEn[i] ? v / gEn[i] : 0)); const gmean = ge.reduce((s, v) => s + v, 0) / 20 || 1; const sc = (ge[0] + ge[19] + ge[1]) / 3 > 1.7 * gmean ? 1 : 0;
  // trim colour: ring 3 px around openings (not openings), median Lab vs wall
  const ring = []; for (let r = 3; r < h - 3; r += 1) { const y = yOf(r); if (y < gH + 0.3 || y > Htop - 0.8) continue; for (let x = 3; x < w - 3; x += 1) { const i = r * w + x; if (!valid[i] || bad[i] || M[i]) continue; let near = false; for (let dy = -3; dy <= 3 && !near; dy += 3) for (let dx = -3; dx <= 3; dx += 3) if (M[(r + dy) * w + x + dx]) { near = true; break; } if (near) ring.push(i); } }
  const trimLab = ring.length > 150 ? medLab(L, A, B, ring) : wl;
  // pilasters: period of the column luminance profile over wall pixels, lag a multiple (2..4) of the bay spacing
  const colL = new Array(w).fill(NaN); for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let r = 0; r < h; r++) { const y = yOf(r); if (y < gH + 0.3 || y > Htop - 0.8) continue; const i = r * w + x; if (valid[i] && !bad[i] && !M[i]) { s += L[i]; n++; } } if (n > 12) colL[x] = s / n; }
  const cLs = smooth(colL, 1), cstd = Math.sqrt(med(cLs.filter(Number.isFinite).map((v, _, ar) => (v - ar.reduce((s, q) => s + q, 0) / ar.length) ** 2))); const pp = bestPeriod(cLs, spc * 1.8, spc * 4.2, px);
  const pil = Number.isFinite(pp.period) && pp.conf > 0.5 && cstd > 2 ? Math.round(pp.period / spc) : 0;
  // bitmask: rows 0 = ground band, k = floor k; cols = bays (round(len / spc)); cell present when the opening share inside the window rectangle > 0.2 (cells with no data: present on upper floors, measured otherwise)
  const nbays = Math.max(1, Math.round(R.len / spc)), Sadj = R.len / nbays, fhA = (Htop - gH - 0.5 * co) / nF; const maskRows = [];
  for (let k = 0; k <= nF; k++) { let bits = 0; for (let c = 0; c < Math.min(nbays, 32); c++) { const xa = (c + 0.5 - ww / 2 * 0.9) * Sadj / px, xb = (c + 0.5 + ww / 2 * 0.9) * Sadj / px; let ya, yb; if (k === 0) { ya = 0.9; yb = Math.max(1.5, gH - 0.4); } else { ya = gH + (k - 1) * fhA + (wy0 + 0.1) * fhA; yb = gH + (k - 1) * fhA + (wy0 + wFrac - 0.1) * fhA; } let m = 0, v = 0, tot = 0;
      for (let r = Math.max(0, h - 1 - Math.round((yb + 0.5) / ypx)); r <= Math.min(h - 1, h - 1 - Math.round((ya + 0.5) / ypx)); r++) for (let x = Math.max(0, Math.round(xa)); x < Math.min(w, Math.round(xb)); x++) { tot++; const i = r * w + x; if (valid[i] && !bad[i]) { v++; m += M[i]; } }
      const present = v < tot * 0.3 ? (k === 0 ? 1 : 1) : (m / v > 0.2 ? 1 : 0); if (present) bits |= 1 << c; }
    maskRows.push(bits >>> 0); }
  const wallRGB = unlab(...wl), trimRGB = unlab(...trimLab);
  const sunN = R.n; return { ok: true, cover, Htop, wl, wallRGB, wallShare, trimRGB, trimLab, fh, fhConf: per.conf, fhOk, rowsFound: pk.length, nPeaks, gH, gH0, wFrac, wy0, wh: wFrac, sp: spc, spConf: perC.conf, spOk, ww, wwr, co, nF, shop, gwr, gL, sc, pil, nbays, maskRows, thr, cstd, normal: sunN, area: zone.length * px * ypx };
}
async function analyseRoof(b) {
  const f = path.join(SC, 'roof', `${b.id}.png`); if (!fs.existsSync(f)) return null; const im = await loadImg(f), { w, h, d } = im, rr = b.roof; const idx = [];
  const inside = (x, z) => { let c = false; const P = b.ring; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };
  const Ls = [], As = [], Bs = []; let tot = 0; for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) { if (!inside(rr.x0 + (x + 0.5) * rr.px, rr.z0 + (r + 0.5) * rr.px)) continue; tot++; const i = r * w + x; if (d[i * 4 + 3] < 128) continue; const [l, a, bb] = lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); const C = Math.hypot(a, bb); if (a < -8 && C > 18 && bb > 5 && l < 60 && false) continue; Ls.push(l); As.push(a); Bs.push(bb); }
  if (Ls.length < 60) return { ok: false, cover: Ls.length / Math.max(1, tot) };
  const lab0 = [med(Ls), med(As), med(Bs)]; const C = Math.hypot(lab0[1], lab0[2]), H = ((Math.atan2(lab0[2], lab0[1]) * 180) / Math.PI + 360) % 360;
  // class: 0 clay tile (red / brown / orange), 1 grey zinc / slate / tin, 2 green copper, 3 dark bitumen / membrane, 4 light (white / glass-like)
  let rc; if (H > 120 && H < 215 && C > 5 && lab0[0] > 35) rc = 2; else if (C > 9 && lab0[1] > 3.5 && lab0[2] > 3 && lab0[0] > 25) rc = 0; else if (lab0[0] < 38) rc = 3; else if (lab0[0] > 78) rc = 4; else rc = 1;
  return { ok: true, cover: Ls.length / Math.max(1, tot), lab: lab0, rgb: unlab(...lab0), rc, C, H };
}
// ---- run everything
const results = [], params = []; let nOk = 0;
for (const b of meta.buildings) {
  const rec = { id: b.id, name: b.name, hero: b.hero, x: b.x, z: b.z, h: b.h, t: b.t, runs: [] };
  for (const R of b.runs) { const a = await analyseRun(b, R); rec.runs.push({ i: R.i, len: R.len, n: R.n, a: R.a, b: R.b, d0: R.d0, cover: R.cover, pave: R.pave || null, res: a }); }
  rec.roof = await analyseRoof(b); results.push(rec);
}
// ---- global sun correction: wall luminance vs facade azimuth over all well-measured runs  (L* ~ a + b cos(az - az0)); applied as an additive L* shift to the shade-side mean
const pts = []; for (const r of results) for (const q of r.runs) if (q.res && q.res.ok && q.res.cover > 0.35 && q.len > 5) pts.push({ th: Math.atan2(q.n[1], q.n[0]), L: q.res.wl[0], w: q.len * q.res.cover, q });
let c1 = 0, s1 = 0, y1 = 0, sw = 0, cc = 0, ss = 0, cs2 = 0, cy = 0, sy = 0; { // least squares y = m + p cos + q sin
  const X = pts.map((p) => [1, Math.cos(p.th), Math.sin(p.th)]), Y = pts.map((p) => p.L), W = pts.map((p) => p.w); const ATA = Array.from({ length: 3 }, () => [0, 0, 0]), ATy = [0, 0, 0];
  X.forEach((x, i) => { for (let a = 0; a < 3; a++) { ATy[a] += W[i] * x[a] * Y[i]; for (let b = 0; b < 3; b++) ATA[a][b] += W[i] * x[a] * x[b]; } });
  const inv = (m) => { const [[a, b, c], [d, e, f], [g, h2, i]] = m; const det = a * (e * i - f * h2) - b * (d * i - f * g) + c * (d * h2 - e * g); return [[(e * i - f * h2) / det, (c * h2 - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h2 - e * g) / det, (b * g - a * h2) / det, (a * e - b * d) / det]]; };
  var coef = inv(ATA).map((r) => r.reduce((s, v, j) => s + v * ATy[j], 0)); }
const model = (th) => coef[0] + coef[1] * Math.cos(th) + coef[2] * Math.sin(th); const amp = Math.hypot(coef[1], coef[2]);
let ssRes = 0, ssTot = 0; const mL = coef[0]; for (const p of pts) { ssRes += p.w * (p.L - model(p.th)) ** 2; ssTot += p.w * (p.L - mL) ** 2; }
const sunFit = { n: pts.length, mean: coef[0], amp, azPeakDeg: (Math.atan2(coef[2], coef[1]) * 180) / Math.PI, r2: 1 - ssRes / ssTot };
console.log('sun fit (L* vs facade azimuth)', JSON.stringify(sunFit));
const SHADE = process.env.NOSHADE ? 0 : 1; // correction strength: remove (model(th) - mean) * k from L*
const shadeK = Math.min(1, Math.max(0, sunFit.r2 * 2.5)) * SHADE; // only as strong as the fit explains
// ---- illumination: the pavement in front of each facade is the reference (sun / shade / colour cast of the baked photo); wall colour = wall / pavement * global pavement, then one global exposure gain so the median wall sits at L* = TARGET_L
const lg = (rgb) => rgb.map(lin), unlin = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const paves = results.flatMap((r) => r.runs.filter((q) => q.pave && q.len > 3).map((q) => lg(q.pave))); const refPave = [0, 1, 2].map((k) => med(paves.map((p) => p[k])));
const TARGET_L = +(process.env.TARGET_L || 78); const NOILLUM = !!process.env.NOILLUM;
const illum = (q) => { if (NOILLUM || !q.pave) return [1, 1, 1]; const p = lg(q.pave); const y = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; const fy = Math.max(0.55, Math.min(2.2, y(refPave) / Math.max(1e-3, y(p)))); // brightness
  const cast = [0, 1, 2].map((k) => (refPave[k] / Math.max(1e-3, p[k])) / (y(refPave) / Math.max(1e-3, y(p)))); return cast.map((c) => fy * Math.max(0.8, Math.min(1.25, c))); };
const correct = (q, rgb) => { const f = illum(q), l = lg(rgb); return [unlin(l[0] * f[0]), unlin(l[1] * f[1]), unlin(l[2] * f[2])]; };
for (const r of results) for (const q of r.runs) if (q.res && q.res.ok) { q.res.wallRGBc = correct(q, q.res.wallRGB); q.res.trimRGBc = correct(q, q.res.trimRGB); q.res.wlc = lab(...q.res.wallRGBc); }
const Lmed = med(results.flatMap((r) => r.runs.filter((q) => q.res && q.res.ok && q.len > 4).map((q) => q.res.wlc[0])));
const yOfL = (L) => { const fy = (L + 16) / 116; return fy ** 3; }; const GAIN = Math.max(1, Math.min(2.4, yOfL(TARGET_L) / yOfL(Lmed)));
const abs = results.flatMap((r) => r.runs.filter((q) => q.res && q.res.ok && q.len > 4).map((q) => q.res.wlc)); const medA = med(abs.map((v) => v[1])), medB = med(abs.map((v) => v[2])); const WB = +(process.env.WB ?? 0.8); const dA = -WB * (medA - 1), dB = -WB * (medB - 5); // gray-world style white balance: the baked light is cool, plaster is not
const KL = +(process.env.KL || 0.9); const expo = (rgb) => { const [L, a, b] = lab(...rgb); const L2 = Math.max(28, Math.min(94, TARGET_L + KL * (L - Lmed))); return unlab(L2, (a + dA) * 1.15, (b + dB) * 1.15); };
console.log('white balance shift a,b', dA.toFixed(1), dB.toFixed(1)); for (const r of results) for (const q of r.runs) if (q.res && q.res.ok) { q.res.wallRGBc = expo(q.res.wallRGBc); q.res.trimRGBc = expo(q.res.trimRGBc); q.res.wlc = lab(...q.res.wallRGBc); }
console.log('illumination: refPave(lin)', refPave.map((v) => v.toFixed(3)).join(','), 'median wall L* after pavement ref', Lmed.toFixed(1), 'exposure gain', GAIN.toFixed(2));
// ---- per building roll-up
const clampB = (v) => Math.max(0, Math.min(255, Math.round(v)));
for (const r of results) {
  const good = r.runs.filter((q) => q.res && q.res.ok && q.res.cover > 0.2 && q.len >= 3); const rec = { id: r.id };
  const shadeAdj = (q) => (model(Math.atan2(q.n[1], q.n[0])) - mL) * shadeK;
  const wc = good.map((q) => { const lb = q.res.wlc; return { q, lab: lb, w: q.len * q.res.cover * Math.min(1, q.res.wallShare + 0.3) }; });
  let wallLab, w2Lab = null, w2r = [];
  if (wc.length) {
    const wm = (arr, k) => { const s = arr.map((c) => [c.lab[k], c.w]).sort((a, b) => a[0] - b[0]); const T = s.reduce((t, v) => t + v[1], 0); let a = 0; for (const [v, w2] of s) { a += w2; if (a >= T / 2) return v; } return s[0][0]; };
    wallLab = [wm(wc, 0), wm(wc, 1), wm(wc, 2)];
    const far = wc.filter((c) => dE(c.lab, wallLab) > 12); const farW = far.reduce((s, c) => s + c.w, 0), totW = wc.reduce((s, c) => s + c.w, 0);
    if (far.length && farW > 0.22 * totW) { w2Lab = [wm(far, 0), wm(far, 1), wm(far, 2)]; for (const c of wc) if (dE(c.lab, w2Lab) < dE(c.lab, wallLab) - 3) w2r.push(c.q.i); if (!w2r.length) w2Lab = null; else { const keep = wc.filter((c) => !w2r.includes(c.q.i)); if (keep.length) wallLab = [wm(keep, 0), wm(keep, 1), wm(keep, 2)]; } }
    rec.w = unlab(...wallLab); if (w2Lab) { rec.w2 = unlab(...w2Lab); rec.w2r = w2r; }
  }
  // rhythm from the heaviest reference run with a plausible floor period
  const ref = good.filter((q) => q.len >= 6 && q.res.cover > 0.4 && q.res.fhOk && q.res.spOk && q.res.sp < 6.5).sort((a, b) => b.len * b.res.cover * (b.res.fhOk ? 1.5 : 1) * (b.res.spOk ? 1.3 : 1) - a.len * a.res.cover * (a.res.fhOk ? 1.5 : 1) * (a.res.spOk ? 1.3 : 1))[0];
  if (ref) { const a = ref.res; Object.assign(rec, { fh: +a.fh.toFixed(2), sp: +a.sp.toFixed(2), ww: +Math.min(0.62, Math.max(0.3, a.ww)).toFixed(2), wh: +a.wh.toFixed(2), wy: +a.wy0.toFixed(2), gh: +a.gH.toFixed(1), gk: a.shop ? 1 : 0, gs: +(Math.min(1, (a.gwr || 0.4) * 2)).toFixed(2), co: +a.co.toFixed(1), sc: a.sc, pil: a.pil, nF: a.nF, trim: a.trimRGBc, ref: ref.i, wwr: +a.wwr.toFixed(2), conf: { fh: +a.fhConf.toFixed(2), sp: +a.spConf.toFixed(2), cover: +a.cover.toFixed(2), rows: a.rowsFound } });
    // per-run overrides: other runs with their own reliable spacing / bitmask
    rec.fr = {}; for (const q of good) { const a = q.res; if (a.nbays > 32 || a.nF > 15) continue; const e = { c: a.nbays, r: a.nF + 1, b: [...a.maskRows, ...new Array(16 - a.maskRows.length).fill(0)].slice(0, 16), cov: +a.cover.toFixed(2) }; if (q.i !== rec.ref && a.spOk && Math.abs(a.sp - rec.sp) / rec.sp > 0.12) e.sp = +a.sp.toFixed(2); if (q.i !== rec.ref && a.fhOk && Math.abs(a.fh - rec.fh) / rec.fh > 0.1) e.fh = +a.fh.toFixed(2); rec.fr[q.i] = e; }
  }
  if (r.roof && r.roof.ok) { const lb = r.roof.lab; const castB = r.roof.rc === 1 || r.roof.rc === 3 ? 3.5 : 0; rec.r = unlab(Math.max(46, lb[0] * 1.15 + 3), lb[1] * 1.1, castB ? lb[2] * 0.6 + castB : lb[2] * 1.15); rec.rc = r.roof.rc; } // roofs: no exposure lift (already game-like grey), a little of the sky-light blue cast removed
  if (rec.w || rec.r) params.push(rec);
}
fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify({ sunFit, results }, null, 0)); fs.writeFileSync(path.join(OUT, 'params-full.json'), JSON.stringify({ v: 1, sunFit, buildings: params }));
console.log('buildings', results.length, 'with params', params.length, 'with rhythm', params.filter((p) => p.fh).length, 'with roof', params.filter((p) => p.r).length);
