// Cosmetic catalogue (PURE data: no DOM, no three.js; also imported by the Worker, which only needs SKIN_COUNTS to range-check ids).
// Three slots: rim (the coloured ring on the ground + the tint of the shaft), trail (fading marks on the ground behind the hole), tag (name-tag look).
// A skin is [rim, trail, tag] = three small ints (0 = default in every slot). Cosmetics NEVER touch scoring, size, speed or hitboxes.
// Ownership is not verifiable by the server (device-local meta layer): other players' skin ids are range-checked and relayed, nothing more.
// Unlock rules (`u`): { t:'lv', n } player level n | { t:'rw', id } a reward id | { t:'wk', tier, n } the n-th completed weekly goal of a tier
//   (every past and future ISO week counts, see src/meta/wardrobe.js) | { t:'ach', id } an achievement | { t:'alb', n } album objects collected.

export const SLOTS = ['rim', 'trail', 'tag'];

/** Rim patterns understood by the ground shader (src/holeView.js): 0 plain identity colour. */
export const PAT = { plain: 0, stripes: 1, flag: 2, dots: 3, wave: 4, checker: 5, shimmer: 6, scallop: 7, metal: 8 };
/** Trail shapes (src/holeView.js trail shader). */
export const SHAPE = { puff: 0, spark: 1, ring: 2, petal: 3, dumpling: 4, glow: 5 };

const R = (id, key, lv, en, pat, c1, c2, tint, u) => ({ id, key, lv, en, pat, c1, c2, tint, u });
const T = (id, key, lv, en, shape, c1, c2, u) => ({ id, key, lv, en, shape, c1, c2, u });
const G = (id, key, lv, en, bg, fg, frame, u) => ({ id, key, lv, en, bg, fg, frame, u });
const L = (n) => ({ t: 'lv', n });

export const SKINS = {
  rim: [
    R(0, 'classic', 'Klasika', 'Classic', PAT.plain, 0, 0, null, null),
    R(1, 'flag', 'Sarkanbaltsarkanais', 'Carmine & white', PAT.flag, 0x9e1b32, 0xffffff, 0x7a1224, L(2)),
    R(2, 'amber', 'Dzintars', 'Amber', PAT.metal, 0xffb81c, 0xb85c00, 0xb87400, L(4)),
    R(3, 'daugava', 'Daugavas viļņi', 'Daugava waves', PAT.wave, 0x1f5fa8, 0x8fd3ff, 0x1a4f86, L(6)),
    R(4, 'gold', 'Zelta mirdzums', 'Gold shimmer', PAT.shimmer, 0xffc928, 0xfff2b0, 0xc79a10, { t: 'rw', id: 'streak-30' }),
    R(5, 'jugend', 'Jūgendstils', 'Art Nouveau', PAT.scallop, 0xa9dcc4, 0xf4c2ae, 0x5f9f86, L(10)),
    R(6, 'pelmenis', 'Pelmenis', 'Pelmenis', PAT.dots, 0xf2e3c4, 0xb98a4c, 0x8a6a3a, { t: 'ach', id: 'combo2' }),
    R(7, 'jani', 'Jāņu ugunskurs', 'Midsummer fire', PAT.stripes, 0xff6a1a, 0xffd23f, 0xb8420c, { t: 'wk', tier: 'hard', n: 1 }),
    R(8, 'saha', 'Šaha galdiņš', 'Chequerboard', PAT.checker, 0x232a33, 0xf3f0e8, 0x4a5058, L(14)),
    R(9, 'aurora', 'Ziemeļblāzma', 'Aurora', PAT.shimmer, 0x7c4fd0, 0x2fe0b8, 0x5a3aa0, L(20)),
  ],
  trail: [
    T(0, 'none', 'Bez takas', 'No trail', 0, 0, 0, null),
    T(1, 'dust', 'Putekļi', 'Dust', SHAPE.puff, 0xf3eddf, 0xb9aa8a, L(3)),
    T(2, 'ribbon', 'Karmīna lente', 'Carmine ribbon', SHAPE.puff, 0xb3203a, 0xff8a9c, { t: 'rw', id: 'streak-7' }),
    T(3, 'sparks', 'Dzintara dzirksteles', 'Amber sparks', SHAPE.spark, 0xffb81c, 0xfff0a0, L(7)),
    T(4, 'bubbles', 'Daugavas burbuļi', 'Daugava bubbles', SHAPE.ring, 0x6bb6ff, 0xd9f0ff, { t: 'wk', tier: 'medium', n: 1 }),
    T(5, 'petals', 'Ziedlapiņas', 'Petals', SHAPE.petal, 0xf7b6c8, 0xffe3ea, { t: 'wk', tier: 'all', n: 1 }),
    T(6, 'pelmeni', 'Pelmeņu birums', 'Dumpling spill', SHAPE.dumpling, 0xf2e3c4, 0xc9a36a, { t: 'alb', n: 40 }),
    T(7, 'aurora', 'Ziemeļblāzmas mirdzums', 'Aurora glow', SHAPE.glow, 0x7c4fd0, 0x2fe0b8, { t: 'rw', id: 'streak-100' }),
  ],
  tag: [
    G(0, 'plain', 'Parastā', 'Plain', 0, 0, 0, null),
    G(1, 'amber', 'Dzintara birka', 'Amber tag', 0xffe2a0, 0x5a3200, 0xd9921a, L(5)),
    G(2, 'carmine', 'Karmīna rāmis', 'Carmine frame', 0xfff4f4, 0x6d0f20, 0x9e1b32, { t: 'rw', id: 'streak-3' }),
    G(3, 'daugava', 'Daugavas zilā', 'Daugava blue', 0xdcefff, 0x0d3a66, 0x1f5fa8, L(9)),
    G(4, 'gold', 'Zelta rāmis', 'Gold frame', 0xfff3c4, 0x5a4300, 0xe0a800, { t: 'rw', id: 'streak-14' }),
    G(5, 'pastel', 'Pasteļtoņi', 'Pastel', 0xf7e6ef, 0x4a3a5a, 0xa9dcc4, L(16)),
    G(6, 'night', 'Nakts', 'Night', 0x2b3a4a, 0xf6efdf, 0x7c4fd0, { t: 'wk', tier: 'hard', n: 2 }),
    G(7, 'royal', 'Karaliskā', 'Royal', 0x3b1d6b, 0xffe9a8, 0xe0a800, { t: 'rw', id: 'streak-60' }),
    G(8, 'meadow', 'Pļava', 'Meadow', 0xe3f4d2, 0x234a12, 0x6ba43a, { t: 'wk', tier: 'easy', n: 1 }),
  ],
};

export const SKIN_COUNTS = SLOTS.map((s) => SKINS[s].length);   // [10, 8, 9]: the server only checks 0 <= id < count
export const DEFAULT_SKIN = [0, 0, 0];
export const ITEM_TOTAL = SKIN_COUNTS.reduce((a, b) => a + b, 0) - SLOTS.length;   // without the three defaults

/** Weekly-goal families -> items, in the order the n-th completion unlocks them. */
export const WEEK_ITEMS = (() => {
  const m = { easy: [], medium: [], hard: [], all: [] };
  SLOTS.forEach((slot, si) => { for (const it of SKINS[slot]) if (it.u && it.u.t === 'wk') m[it.u.tier][it.u.n - 1] = [si, it.id]; });
  for (const k of Object.keys(m)) m[k] = m[k].filter(Boolean);
  return m;
})();

/** Clean a skin array from anywhere (hello frame, storage): three ints inside the known ranges, anything else -> 0 in that slot. */
export function cleanSkin(sk) {
  const out = [0, 0, 0];
  if (Array.isArray(sk)) for (let i = 0; i < 3; i++) { const v = sk[i]; if (Number.isInteger(v) && v >= 0 && v < SKIN_COUNTS[i]) out[i] = v; }
  return out;
}
/** Is every id of a client-sent skin array valid? (the server answers with the cleaned array either way; tests use this) */
export const skinValid = (sk) => Array.isArray(sk) && sk.length === 3 && sk.every((v, i) => Number.isInteger(v) && v >= 0 && v < SKIN_COUNTS[i]);

export const itemOf = (slot, id) => SKINS[SLOTS[slot]][id] || SKINS[SLOTS[slot]][0];

/** A little variety for bots (solo and server): mostly classic, sometimes one of the early rims. Deterministic from the hole id. */
export function botSkin(id, salt = 0) {
  const h = (Math.imul((id + 1) * 2654435761 + salt * 40503, 2246822519) >>> 0) % 100;
  const rim = h < 55 ? 0 : h < 70 ? 1 : h < 82 ? 2 : h < 92 ? 3 : 5;
  return [rim, 0, 0];
}

export const hexRgb = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
