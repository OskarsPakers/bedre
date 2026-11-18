// "Bernu pasaule" trading centre, Matisa iela 25 / Krisjana Barona iela, Riga (OSM way 159548916, cadastre 01000330058001; NOT in the game's cadastre extract: placed from the OSM footprint).
// Photo-free parametric model, NO logo / wordmark / lettering: plain red fascia board, plain sign band. Frame: origin (1242.3,-630.0), U along the NW wall towards NE-ish (A = (0.724,-0.690)), V outward (VV = (A.z,-A.x)); model X = v, Z = u.
// Read from the reality mesh (scripts/out/tramcity/ref-bernu-*.png, reading only), OSM footprint, Commons photos (sources-bernu.json). A 1960s-70s modernist block: pale grey panel upper band with a ribbon of 15 small windows and a sign band,
// 6 m dark curtain-wall band (3 storeys of 1.8 m cells), ground floor with shop glazing under a red fascia, a mirror-glass corner tower at the NE end, taller rear block, stepped plan, flat roofs with plant.
import { builder } from './glib.js';
export const FRAME = { O: [1242.3, -630.0], th: Math.atan2(-0.690, 0.724) };
export const COVERS = { ids: [] };
export function build(opts = {}) {
  const lod = opts.lod ?? 0, b = builder(lod), { box, wall, curtain, quad, P } = b;
  const H = 21.0, GF = 5.0, CW = 12.7;     // total, ground-floor top, curtain-wall top
  const blk = (u0, u1, v0, v1, h, o = {}) => box('wall', v0, 0, u0, v1, h, u1, { tone: o.tone ?? 0, faces: o.faces || 'snwe' }) || b.roofSlab(v0, v1, u0, u1, h + 0.01);
  // ---- stepped plan (u,v) from the OSM footprint: wall faces get detail only on the NW front and the SW end
  blk(-6, 37, -50, 0, H - 0.0001, { faces: 'sn w'.replace(' ','') }); blk(37, 42, -47, 0, H - 0.5, { faces: 'snw' }); blk(42, 49, -34, 0, H - 1.0, { faces: 'snw' }); blk(49, 55, -25, 0, 18, { tone: 0, faces: 'snw' });
  blk(-6, 9, -50, -26, 25);                                                              // taller rear block (the gym floors)
  // ---- NW front (v = 0), u 0..43.6: viewer-left = larger u
  { const L = 43.6; const ops = [];
    // ground floor: shop glazing under a red fascia board, plinth below
    for (let k = 0; k < 11; k++) ops.push({ s0: 1.2 + k * 3.85, s1: 1.2 + k * 3.85 + 3.5, y0: 0.5, y1: 4.0, depth: 0.5 });
    const toneAt = (y) => y < 0.5 ? 2 : 0;
    wall([0, L], [0, 0], 0, GF, ops.map((o) => ({ ...o, s0: o.s0, s1: o.s1 })), { tone: 0, toneAt, split: [0.5], depth: 0.4 });
    box('wall', 0, 4.2, 0, 0.35, 5.2, L, { tone: 6, faces: 'est' });                      // red fascia board (plain, no lettering)
    // curtain wall 4.1 .. 10.0 : 1.8 m cells, 3 rows
    curtain([0, L], [0, 0], GF + 0.3, CW, { pitch: 1.8, rows: [[5.3, 7.4, 'glass'], [7.4, 7.6, 'spandrel'], [7.6, 10.0, 'glass'], [10.0, 10.2, 'spandrel'], [10.2, 12.7, 'glass']], spandrelTone: 5, off: 0.2 });
    // panel band 10 .. 17.2 with the ribbon of 15 small windows (pitch 2.47) and a plain sign band
    const wops = []; for (let k = 0; k < 15; k++) wops.push({ s0: 0.9 + k * 2.9, s1: 0.9 + k * 2.9 + 2.1, y0: 13.6, y1: 14.9, depth: 0.3 });
    wall([0, L], [0, 0], CW, H, wops, { tone: 0, depth: 0.3 });
    box('wall', 0, 16.6, 6, 0.3, 17.9, 16.5, { tone: 1, faces: 'e' }); box('wall', 0, 16.6, 21, 0.3, 17.9, 40, { tone: 6, faces: 'e' });  // two plain sign boards (no text)
    box('wall', 0, H, 0, 0.5, H + 0.5, L, { tone: 1, faces: 'ewnst' });                    // roof coping
  }
  wall([0, 0], [0, -6], 0, H, [], { tone: 0 }); wall([0, 37], [0, 43.6], 0, 0.01, [], { tone: 0 });  // the end of the front beyond u = 0, and a seam strip
  // mirror-glass corner tower at the NE end of the front (u 43.6..55, v -12.6..0): dark curtain wall on its NW face and NE end
  curtain([0.4, 55], [0.4, 43.6], 0.3, 18, { pitch: 1.9, rows: [[0.3, 3.5, 'glass'], [3.5, 3.7, 'spandrel'], [3.7, 18, 'glass']], spandrelTone: 5, off: 0.2 });
  box('wall', 0, 18, 43.6, 0.5, 18.6, 55, { tone: 1, faces: 'ewnst' });
  // ---- SW end wall (u = -6): plain grey panel with a few windows, a ground-floor door
  { const ops = [{ s0: 18, s1: 21, y0: 0.4, y1: 3.2, door: true, depth: 0.4 }]; for (let k = 0; k < 6; k++) for (const y of [6.5, 11, 15.5]) ops.push({ s0: 4 + k * 6.5, s1: 4 + k * 6.5 + 1.8, y0: y, y1: y + 1.6, depth: 0.25 });
    wall([0, -6.02], [-50, -6.02], 0, H, ops.filter((o) => o.s1 < 50).map((o) => ({ ...o, s0: 50 - o.s1, s1: 50 - o.s0 })), { tone: 0, depth: 0.25 }); }
  // ---- roof plant
  box('wall', -30, H + 0.01, 4, -22, H + 2.6, 20, { tone: 0, faces: 'snwet' }); box('wall', -20, H + 0.01, 24, -12, H + 1.4, 36, { tone: 5, faces: 'snwet' }); box('wall', -45, 25, -4, -38, 27.2, 6, { tone: 5, faces: 'snwet' });
  return b.finish();
}
