// The Opera's own frame: origin O (cadastre vertex 0 of 49616059), U along the long axis (towards SSE), V across (towards ENE), y up. Used by every script.
export const O = [25.3, 240.4], TH = Math.atan2(0.8819, 0.4715), A = [Math.cos(TH), Math.sin(TH)], VV = [A[1], -A[0]];
export const toWorld = (u, v, y = 0) => [O[0] + u * A[0] + v * VV[0], y, O[1] + u * A[1] + v * VV[1]];
export const toUV = (x, z) => [(x - O[0]) * A[0] + (z - O[1]) * A[1], (x - O[0]) * VV[0] + (z - O[1]) * VV[1]];
