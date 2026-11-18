// Geometry accumulator of the tram city. full = lo layout (position, normal, colour, uvw, aA, aB); else hi layout (position, normal, colour).
import * as THREE from 'three';
const by = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
const Z4 = [0, 0, 0, 0];
export class Acc {
  constructor(full) { this.full = full; this.pos = []; this.nor = []; this.col = []; this.uvw = []; this.a = []; this.b = []; this.idx = []; this.n = 0; }
  vert(x, y, z, n, c, k, uvw, A, B) {
    this.pos.push(x, y, z); this.nor.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127), 0);
    this.col.push(by(c[0] * k), by(c[1] * k), by(c[2] * k), 255);
    if (this.full) { this.uvw.push(uvw ? uvw[0] : 0, uvw ? uvw[1] : 0, uvw ? uvw[2] : 0, uvw ? uvw[3] : 0); this.a.push(A[0], A[1], A[2], A[3]); this.b.push(B[0], B[1], B[2], B[3]); }
    return this.n++;
  }
  /** P: 4 corners [x,y,z]; n outward normal; c colour; sh 4 shade factors; UV 4 uvw arrays (lo only) */
  quad(P, n, c, sh, UV, A = Z4, B = Z4) {
    const e1x = P[1][0] - P[0][0], e1y = P[1][1] - P[0][1], e1z = P[1][2] - P[0][2], e2x = P[2][0] - P[0][0], e2y = P[2][1] - P[0][1], e2z = P[2][2] - P[0][2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-12) return;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const i = [0, 1, 2, 3].map((k) => this.vert(P[k][0], P[k][1], P[k][2], n, c, sh ? sh[k] : 1, UV ? UV[k] : null, A, B));
    if (flip) this.idx.push(i[0], i[2], i[1], i[0], i[3], i[2]); else this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }
  tri(P, n, c, k, A = Z4, B = Z4) {
    const e1x = P[1][0] - P[0][0], e1y = P[1][1] - P[0][1], e1z = P[1][2] - P[0][2], e2x = P[2][0] - P[0][0], e2y = P[2][1] - P[0][1], e2z = P[2][2] - P[0][2];
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-12) return;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const i = [0, 1, 2].map((q) => this.vert(P[q][0], P[q][1], P[q][2], n, c, k, null, A, B));
    if (flip) this.idx.push(i[0], i[2], i[1]); else this.idx.push(i[0], i[1], i[2]);
  }
  /** raw pass-through vertex (engine geometry, colour already final 0..1) */
  raw(x, y, z, nx, ny, nz, c, A, B) { return this.vert(x, y, z, [nx, ny, nz], c, 1, null, A, B); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(this.nor), 4, true));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true));
    if (this.full) {
      g.setAttribute('uvw', new THREE.Float32BufferAttribute(this.uvw, 4));
      g.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(this.a), 4, true));
      g.setAttribute('aB', new THREE.BufferAttribute(new Uint8Array(this.b), 4, true));
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
