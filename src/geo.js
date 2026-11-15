// 2D polygon helpers. Polygons are arrays of [x, z].
export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % n];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Remove closing duplicate / consecutive duplicates, force signedArea > 0. */
export function cleanRing(p) {
  const out = [];
  for (const q of p) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - q[0]) > 0.01 || Math.abs(l[1] - q[1]) > 0.01) out.push([q[0], q[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 0.01 &&
         Math.abs(out[0][1] - out[out.length - 1][1]) < 0.01) out.pop();
  if (out.length >= 3 && signedArea(out) < 0) out.reverse();
  return out;
}

export function centroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % n];
    const c = x0 * z1 - x1 * z0;
    a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sz = 0;
    for (const q of p) { sx += q[0]; sz += q[1]; }
    return [sx / p.length, sz / p.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Approximate minimum-area oriented bounding box (edge-aligned candidates). */
export function minBox(p) {
  let best = null;
  const n = p.length;
  const step = n > 80 ? Math.ceil(n / 80) : 1;
  for (let i = 0; i < n; i += step) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % n];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of p) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, L: maxU - minU, W: maxV - minV, ux, uz, cu: (minU + maxU) / 2, cv: (minV + maxV) / 2 };
  }
  if (!best) { const b = bbox(p); return { area: 0, L: b.x1 - b.x0, W: b.z1 - b.z0 }; }
  if (best.W > best.L) { const t = best.L; best.L = best.W; best.W = t; const ux = best.ux; best.ux = -best.uz; best.uz = ux; const cu = best.cu; best.cu = best.cv; best.cv = -cu; }
  return best;
}

/** Walk along a polyline, returning points at jittered spacing. */
export function sampleAlong(poly, spacing, rng, startFrac = 0.5) {
  const out = [];
  let next = spacing * startFrac * rng();
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const tx = dx / len, tz = dz / len;
    while (acc + len >= next) {
      const d = next - acc;
      out.push({ x: x0 + tx * d, z: z0 + tz * d, tx, tz });
      next += spacing * (0.6 + 0.8 * rng());
    }
    acc += len;
  }
  return out;
}
