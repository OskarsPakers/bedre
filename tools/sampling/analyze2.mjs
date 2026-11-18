// SAMPLING, step 2 (node): rectified facade / roof images (tools/.cache/sampling, intermediate) -> compact per-building parameters (tools/sampling/data/params.json, NO pixels) + analysis.json (per-run numbers for the review sheets).
// usage: node analyze.mjs
import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '../..'), SC = path.join(ROOT, 'tools/.cache/sampling'), OUT = path.join(import.meta.dirname, 'data'); fs.mkdirSync(OUT, { recursive: true });
const META = process.env.META || 'meta-centrs.json', TAG = process.env.TAG || 'centrs'; const meta = JSON.parse(fs.readFileSync(path.join(SC, META), 'utf8'));
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
  // v2: brightest-lit CONSISTENT wall sample: pixels that are not openings, with L between the 60th and 92nd percentile of the wall pixels (shadowed texels and the darkest cast shadows are dropped, specular / white trim is dropped)
  const thr0 = Math.max(10, Math.min(22, wl[0] * 0.22)); const wallPx = zone.filter((i) => L[i] > wl[0] - thr0 && dE([L[i], A[i], B[i]], wl) < 30); const wLs = wallPx.map((i) => L[i]).sort((p, q) => p - q);
  let wlb = wl, shadeFrac = 0; if (wallPx.length > 150) { const lo = wLs[Math.floor(wLs.length * 0.6)], hi = wLs[Math.floor(wLs.length * 0.92)]; const br = wallPx.filter((i) => L[i] >= lo && L[i] <= hi); if (br.length > 60) wlb = medLab(L, A, B, br); shadeFrac = wallPx.filter((i) => L[i] < wlb[0] - 9).length / wallPx.length; }
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
  // prefer the smallest period consistent with the window width: if half the period has a comparable ACF value (the profile repeats at spc/2) and still >= 1.7 m, take it
  if (spOk && spc / 2 >= 1.7) { const ac = acf(cs, Math.max(2, Math.round(spc / 2 / px) - 2), Math.round(spc / 2 / px) + 2), ac1 = acf(cs, Math.max(2, Math.round(spc / px) - 2), Math.round(spc / px) + 2); const a1 = Math.max(...ac), a0 = Math.max(...ac1); if (a1 >= 0.6 * a0 && a1 > 0.15) spc = spc / 2; else if (spc / 3 >= 1.7) { const ac3 = acf(cs, Math.max(2, Math.round(spc / 3 / px) - 2), Math.round(spc / 3 / px) + 2); if (Math.max(...ac3) >= 0.6 * a0 && Math.max(...ac3) > 0.15) spc = spc / 3; } }
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
  const sunN = R.n; return { ok: true, cover, Htop, wl, wlb, shadeFrac, wallRGBb: unlab(...wlb), wallRGB, wallShare, trimRGB, trimLab, fh, fhConf: per.conf, fhOk, rowsFound: pk.length, nPeaks, gH, gH0, wFrac, wy0, wh: wFrac, sp: spc, spConf: perC.conf, spOk, ww, wwr, co, nF, shop, gwr, gL, sc, pil, nbays, maskRows, thr, cstd, normal: sunN, area: zone.length * px * ypx };
}
async function analyseRoof(b) {
  const f = path.join(SC, 'roof', `${b.id}.png`); if (!fs.existsSync(f)) return null; const im = await loadImg(f), { w, h, d } = im, rr = b.roof;
  const inside = (x, z) => { let c = false; const P = b.ring; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };
  const px = []; let tot = 0; for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) { if (!inside(rr.x0 + (x + 0.5) * rr.px, rr.z0 + (r + 0.5) * rr.px)) continue; tot++; const i = r * w + x; if (d[i * 4 + 3] < 128) continue; px.push(lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])); }
  if (px.length < 60) return { ok: false, cover: px.length / Math.max(1, tot) };
  const Ls = px.map((p) => p[0]).sort((p, q) => p - q); const P = (q) => Ls[Math.min(Ls.length - 1, Math.floor(Ls.length * q))];
  // brightest-lit consistent sample: L between P50 and P95 (sun-lit slopes; deep shade and holes dropped)
  const lit = px.filter((p) => p[0] >= P(0.5) && p[0] <= P(0.95)); const lab0 = [med(lit.map((p) => p[0])), med(lit.map((p) => p[1])), med(lit.map((p) => p[2]))]; const labAll = [med(px.map((p) => p[0])), med(px.map((p) => p[1])), med(px.map((p) => p[2]))];
  const C = (p) => Math.hypot(p[1], p[2]), H = (p) => ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
  const warm = lit.filter((p) => p[1] > 5 && p[2] > 5 && C(p) > 9).length / lit.length, green = lit.filter((p) => p[1] < -2 && H(p) > 100 && H(p) < 205 && C(p) > 4).length / lit.length;
  // MATERIAL FIRST: tile (warm red-brown) / copper (green patina) / bitumen (dark neutral) / light (pale, glass-like) / zinc (the rest)
  let rc, margin; if (green >= 0.3 && green > warm) { rc = 2; margin = green; } else if (warm >= 0.3 || (lab0[1] > 5.5 && lab0[2] > 5 && C(lab0) > 10)) { rc = 0; margin = Math.max(warm, 0.3); } else if (lab0[0] < 38 && C(lab0) < 8) { rc = 3; margin = 0.6; } else if (lab0[0] > 78 && C(lab0) < 8) { rc = 4; margin = 0.5; } else { rc = 1; margin = 1 - Math.max(warm, green); }
  return { ok: true, cover: px.length / Math.max(1, tot), lab: lab0, labAll, rgb: unlab(...lab0), rc, warm, green, margin, C: C(lab0), H: H(lab0) };
}
// ---- run everything
let results = [];
if (process.env.FROM_CACHE) { results = JSON.parse(fs.readFileSync(path.join(OUT, `analysis-${TAG}.json`), 'utf8')).results; console.log('results from cache', results.length); } else
for (const b of meta.buildings) {
  const rec = { id: b.id, name: b.name, hero: b.hero, x: b.x, z: b.z, h: b.h, t: b.t, runs: [] };
  for (const R of b.runs) { const a = await analyseRun(b, R); rec.runs.push({ i: R.i, len: R.len, n: R.n, a: R.a, b: R.b, d0: R.d0, cover: R.cover, pave: R.pave || null, paveHi: R.paveHi || null, res: a }); }
  rec.roof = await analyseRoof(b); results.push(rec);
}

// =====================================  illumination: albedo = wall / pavement x albedo(pavement)
const CLO = +(process.env.CLO || 0.8), CHI = +(process.env.CHI || 1.25); const GLOBALMODE = !!process.env.GLOBAL; const ALB = +(process.env.ALB || 0.32), NOILLUM = !!process.env.NOILLUM, NEIGH = +(process.env.NEIGH || 0.5);
const Yv = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2], lg = (rgb) => rgb.map(lin), unlin = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const allRuns = []; for (const r of results) for (const q of r.runs) { q.bid = r.id; q.mx = (q.a[0] + q.b[0]) / 2 + r.x; q.mz = (q.a[1] + q.b[1]) / 2 + r.z; if (q.paveHi) { q.pl = lg(q.paveHi); q.py = Yv(q.pl); } allRuns.push(q); }
const globalY = med(allRuns.filter((q) => q.py).map((q) => q.py));
const GRID = new Map(); for (const o of allRuns) if (o.py) { const k = Math.floor(o.mx / 70) + ',' + Math.floor(o.mz / 70); (GRID.get(k) || GRID.set(k, []).get(k)).push(o); }
const near = (q) => { const gx = Math.floor(q.mx / 70), gz = Math.floor(q.mz / 70), out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of GRID.get((gx + i) + ',' + (gz + j)) || []) if (Math.hypot(o.mx - q.mx, o.mz - q.mz) < 70 && o.n[0] * q.n[0] + o.n[1] * q.n[1] > 0.7) out.push(o); return out; };
const gCast = [0, 1, 2].map((k) => Math.max(0.8, Math.min(1.25, med(allRuns.filter((o) => o.pl).map((o) => o.pl[k] / o.py)))));
for (const q of allRuns) { if (!q.res || !q.res.ok) continue; const nb = near(q); const nY = nb.length >= 3 ? med(nb.map((o) => o.py)) : globalY;
  const ownY = q.py || nY; if (GLOBALMODE) { q.refY = globalY; q.cast = gCast; continue; } q.refY = Math.exp(NEIGH * Math.log(nY) + (1 - NEIGH) * Math.log(ownY)); const own = q.pl || null; const nbc = nb.length >= 3 ? [0, 1, 2].map((k) => med(nb.map((o) => o.pl[k] / o.py))) : [1, 1, 1]; const oc = own ? own.map((v) => v / q.py) : nbc; q.cast = [0, 1, 2].map((k) => Math.max(CLO, Math.min(CHI, (NEIGH * nbc[k] + (1 - NEIGH) * oc[k])))); }
const SAT = +(process.env.SAT || 1);
const satur = (rgb) => { if (SAT === 1) return rgb; const [L, aa, bb] = lab(...rgb); return unlab(L, aa * SAT, bb * SAT); };
const BLUEK = +(process.env.BLUEK ?? 0.2), AMAX = +(process.env.AMAX || 0.72), GMAX = +(process.env.GMAX || 6);
// plaster prior: a shaded wall sampled against a sunlit pavement (or vice versa) keeps a blue cast; real Riga plaster is hardly ever bluer than b* = -3 -> soft clip below that; albedo of plaster <= ~0.72 (L* ~ 88)
const prior = (rgb) => { const [L, aa, bb] = lab(...rgb); const b2 = bb > -3 ? bb : -3 + (bb + 3) * BLUEK; return unlab(L, aa, b2); };
const albedo = (q, rgb) => { if (NOILLUM || !q.refY) return prior(satur(rgb)); const g = Math.min(GMAX, ALB / Math.max(0.01, q.refY)); const l = lg(rgb); const c3 = [0, 1, 2].map((k) => l[k] * g / q.cast[k]); const mx = Math.max(...c3), sc = mx > AMAX ? AMAX / mx : 1; return prior(satur(c3.map((v) => unlin(v * sc)))); };
for (const q of allRuns) if (q.res && q.res.ok) { q.res.alb = albedo(q, q.res.wallRGBb); q.res.albLab = lab(...q.res.alb); q.res.trimAlb = albedo(q, q.res.trimRGB); q.res.v1Lab = q.res.wl; q.res.noIllumLab = q.res.wlb; }
// ---- validation 1: same building, different facade orientation => same paint (residual dE between runs)
const resid = { v1: [], bright: [], full: [] };
for (const r of results) { const g = r.runs.filter((q) => q.res && q.res.ok && q.res.cover > 0.4 && q.len >= 5 && q.res.shadeFrac < 0.6); for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) { if (Math.abs(g[i].n[0] * g[j].n[0] + g[i].n[1] * g[j].n[1]) > 0.85) continue; resid.v1.push(dE(g[i].res.v1Lab, g[j].res.v1Lab)); resid.bright.push(dE(g[i].res.noIllumLab, g[j].res.noIllumLab)); resid.full.push(dE(g[i].res.albLab, g[j].res.albLab)); } }
const stat = (a) => ({ n: a.length, median: +med(a).toFixed(1), mean: +(a.reduce((s, v) => s + v, 0) / (a.length || 1)).toFixed(1), p80: +(a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.8)] || 0).toFixed(1) });
const residual = { v1_median_of_60pct: stat(resid.v1), bright_lit_sample_only: stat(resid.bright), bright_plus_pavement_illumination: stat(resid.full) }; console.log('residual dE between facades of one building (different orientation)', JSON.stringify(residual));
// =====================================  per-building roll-up
const clampB = (v) => Math.max(0, Math.min(255, Math.round(v))); const params = [];
// Old Town zone prior (owner guidance: tile roofs, light warm walls): same ellipse as buildings.js zoneOf
const zoneOld = (x, z) => { const a = (x + 400) / 520, b = (z - 260) / 380; return a * a + b * b < 1; };
const OLDW = +(process.env.OLDW ?? 0.0001);
const TILE_PAL = { L: [38, 52], a: [16, 30], b: [14, 30], def: [46, 24, 24] }, ZINC = { L: [48, 66] }, COPPER = { L: [52, 70], a: [-20, -6], b: [-2, 8], def: [60, -12, 3] }, BIT = { L: [34, 46] };
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
function roofColour(R, old) { // class first, colour from the class range using the sample
  let rc = R.rc; const s = R.lab;
  if (old && rc === 1 && R.warm >= OLDW && R.green < 0.1) rc = 0; // Old Town: ambiguous dull roofs with any warm texels = tile (owner prior; evidence-only threshold 0.12 gives 43 %)
  let L = s[0], a = s[1], b = s[2];
  if (rc === 0) { const warm = a > 5 && b > 5; L = clamp(L * 1.05 + 2, TILE_PAL.L); a = clamp(warm ? a * 1.25 : TILE_PAL.def[1], TILE_PAL.a); b = clamp(warm ? b * 1.2 : TILE_PAL.def[2], TILE_PAL.b); }
  else if (rc === 2) { L = clamp(L * 1.1 + 4, COPPER.L); a = clamp(a < -2 ? a * 1.4 : COPPER.def[1], COPPER.a); b = clamp(b > -2 ? b : COPPER.def[2], COPPER.b); }
  else if (rc === 3) { L = clamp(L + 4, BIT.L); a *= 0.6; b *= 0.6; }
  else if (rc === 4) { L = Math.min(88, L + 4); a *= 0.8; b *= 0.8; }
  else { L = clamp(L * 1.12 + 4, ZINC.L); a = clamp(a * 0.9, [-3, 3]); b = clamp(b * 0.5 + 2.5, [-3, 5]); } // zinc / slate: neutral, the baked sky-blue cast removed
  return { rc, rgb: unlab(L, a, b) };
}
const wmed = (arr, k) => { const s = arr.map((c) => [c.lab[k], c.w]).sort((a, b) => a[0] - b[0]); const T = s.reduce((t, v) => t + v[1], 0); let a = 0; for (const [v] of s) { a += s.find((x) => x[0] === v)[1]; if (a >= T / 2) return v; } return s[0][0]; };
const wmedian = (arr, k) => { const s = arr.map((c) => [c.lab[k], c.w]).sort((x, y) => x[0] - y[0]); const T = s.reduce((t, v) => t + v[1], 0); let a = 0; for (const [v, w] of s) { a += w; if (a >= T / 2) return v; } return s[0][0]; };
for (const r of results) {
  const rec = { id: r.id }; const good = r.runs.filter((q) => q.res && q.res.ok && q.res.cover > 0.25 && q.len >= 3);
  const wc = good.map((q) => ({ q, lab: q.res.albLab, w: q.len * q.res.cover * Math.min(1, q.res.wallShare + 0.3) * (1 - 0.5 * q.res.shadeFrac) }));
  let cw = 0;
  if (wc.length) {
    const wallLab = [0, 1, 2].map((k) => wmedian(wc, k)); rec.w = unlab(...wallLab);
    const totW = wc.reduce((s, c) => s + c.w, 0), totLen = good.reduce((s, q) => s + q.len * q.res.cover, 0);
    cw = good.some((q) => q.len >= 6 && q.res.cover > 0.4) ? 2 : 1; if (cw === 2 && wc.length >= 2 && wc.filter((c) => dE(c.lab, wallLab) < 10).length >= 2) cw = 3; // 3: two runs agree
    // second colour: strict -- groups differ clearly (dE > 18 after correction), each >= 25 % of the weight AND >= 8 m of well measured wall
    const far = wc.filter((c) => dE(c.lab, wallLab) > 18 && c.q.res.cover > 0.4 && c.q.res.shadeFrac < 0.5); const farW = far.reduce((s, c) => s + c.w, 0), farLen = far.reduce((s, c) => s + c.q.len, 0);
    if (far.length && farW > 0.25 * totW && farLen >= 8 && wc.length - far.length >= 1) { const w2l = [0, 1, 2].map((k) => wmedian(far, k)); const r2 = wc.filter((c) => dE(c.lab, w2l) < dE(c.lab, wallLab) - 6).map((c) => c.q.i); if (r2.length) { rec.w2 = unlab(...w2l); rec.w2r = r2; } }
  }
  const GATE = !process.env.NOGATE; const gateOk = (a) => !GATE || (a.rowsFound >= 2 && a.wwr >= 0.08 && a.fh >= 2.8 && a.fh <= 5.6 && Math.abs(a.nPeaks - a.nF) <= 1 && a.spConf > 0.25); // extra gates added after the hand check of 40 random facades
  const ref = good.filter((q) => q.len >= 6 && q.res.cover > 0.4 && q.res.fhOk && q.res.spOk && q.res.sp < 6.5 && gateOk(q.res)).sort((a, b) => b.len * b.res.cover * (b.res.fhOk ? 1.5 : 1) - a.len * a.res.cover * (a.res.fhOk ? 1.5 : 1))[0]; let cr = 0;
  if (ref) { const a = ref.res; cr = a.fhConf > 0.5 && a.spConf > 0.5 ? 3 : a.fhConf > 0.3 && a.spConf > 0.3 ? 2 : 1;
    Object.assign(rec, { fh: +a.fh.toFixed(2), sp: +a.sp.toFixed(2), ww: +Math.min(0.62, Math.max(0.3, a.ww)).toFixed(2), wh: +a.wh.toFixed(2), wy: +a.wy0.toFixed(2), gh: +a.gH.toFixed(1), gk: a.shop ? 1 : 0, gs: +(Math.min(1, (a.gwr || 0.4) * 2)).toFixed(2), co: +a.co.toFixed(1), sc: a.sc, pil: a.pil, nF: a.nF, ref: ref.i, wwr: +a.wwr.toFixed(2) });
    const t = a.trimAlb ? lab(...a.trimAlb) : null, wl = a.albLab; rec.trim = t && t[0] >= wl[0] - 10 ? a.trimAlb : unlab(wl[0] + 4, wl[1], wl[2]); }
  let cf = 0; if (r.roof && r.roof.ok) { const R = r.roof; const rcol = roofColour(R, zoneOld(r.x, r.z)); rec.r = rcol.rgb; rec.rc = rcol.rc; cf = R.cover > 0.5 && R.margin > 0.5 ? 3 : R.cover > 0.3 ? 2 : 1; rec.rm = +R.margin.toFixed(2); }
  rec.q = [cw, cr, cf]; if (rec.w || rec.r) params.push({ ...rec, name: r.name, hero: r.hero, x: Math.round(r.x), z: Math.round(r.z), h: +r.h.toFixed(1), area: Math.round(r.area || 0) });
}
// per-run override block for the facade bays (spacing only; no L3 masks in the shipped set)
fs.writeFileSync(path.join(OUT, `analysis-${TAG}.json`), JSON.stringify({ residual, params: { ALB, NEIGH }, results })); fs.writeFileSync(path.join(OUT, `params-${TAG}.full.json`), JSON.stringify({ v: 2, residual, buildings: params }));
const n = params.length; const cnt = (f) => params.filter(f).length; console.log(`buildings analysed ${results.length}, with params ${n}: wall conf>=2 ${cnt((p) => p.q[0] >= 2)}, roof conf>=2 ${cnt((p) => p.q[2] >= 2)}, rhythm conf>=2 ${cnt((p) => p.q[1] >= 2)}, second colour ${cnt((p) => p.w2)}`);
const rcs = {}; for (const p of params) if (p.rc != null) rcs[p.rc] = (rcs[p.rc] || 0) + 1; console.log('roof classes', JSON.stringify(rcs));
