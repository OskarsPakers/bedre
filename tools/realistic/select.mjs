// Isomorphic (node + browser) LOD cut selection over a route index (see index.mjs). Node-switching LOD: a selected node replaces its parent, so a cut never contains
// a node together with an ancestor.
export const PRESETS = {
  // F0 + F1 * d = target vertex spacing (m); caps = [[maxFutureDistance, maxTexels], ...] by the DISTANCE THE TRAM WILL HAVE TO THE NODE when it passes; budgetMB = decoded texture memory;
  // ahead = look-ahead seconds / min / max metres of track whose flanking nodes are kept loaded at final detail
  balanced: { F0: 0.12, F1: 0.03, budgetMB: 1100, caps: [[35, 4e6], [80, 1048576], [150, 262144], [1e9, 65536]], aheadS: 25, aheadMin: 400, aheadMax: 650, label: 'Balanced' },
  high: { F0: 0.07, F1: 0.018, budgetMB: 1500, caps: [[50, 4e6], [110, 2097152], [200, 524288], [1e9, 131072]], aheadS: 30, aheadMin: 500, aheadMax: 800, label: 'High' },
  ultra: { F0: 0.045, F1: 0.012, budgetMB: 3200, caps: [[130, 4e6], [250, 1048576], [1e9, 262144]], aheadS: 35, aheadMin: 650, aheadMax: 1000, label: 'Ultra (16 GB+ unified memory)' },
};
export const DMAX = 600;   // beyond this (effective) distance from the tram nothing is drawn (fog hides the cut)
/** effective distance from point (cx,cz) heading (fx,fz) to the node box bb=[x0,z0,x1,z1]: ahead counts less than behind (the driver looks ahead); iso = true for free look */
export function dEff(bb, cx, cz, fx, fz, iso) {
  const px = cx < bb[0] ? bb[0] : cx > bb[2] ? bb[2] : cx, pz = cz < bb[1] ? bb[1] : cz > bb[3] ? bb[3] : cz, dx = px - cx, dz = pz - cz;
  if (iso) return Math.hypot(dx, dz);
  const a = dx * fx + dz * fz, l = -dx * fz + dz * fx;
  return Math.hypot(a >= 0 ? a * 0.7 : -a * 2.2, l);
}
/** the cut: indices of nodes to draw. dScale < 1 gives the (finer, earlier) cut used for loading. nodes = index.nodes (with .ch, .bb, .sp, .vc), roots = index.roots */
export function selectCut(idx, cx, cz, fx, fz, P, iso = false, dScale = 1, out = []) {
  out.length = 0; const N = idx.nodes, st = [...idx.roots];
  while (st.length) {
    const i = st.pop(), n = N[i], d = dEff(n.bb, cx, cz, fx, fz, iso) * dScale;
    if (d > DMAX) continue;
    if (!n.vc) { for (const c of n.ch) st.push(c); continue; }
    if (!n.ch.length || n.sp <= P.F0 + P.F1 * d) out.push(i); else for (const c of n.ch) st.push(c);
  }
  return out;
}
/** texel cap of a node's texture from the smallest distance the tram will have to it on its way (not the current distance) */
export function texCap(P, d) { for (const [m, t] of P.caps) if (d < m) return t; return 65536; }
