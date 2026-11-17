// Sights: category treatment of every important building (owner rule: "simplified is fine, but sights must differ from apartment blocks").
// Pure data + functions (no three.js), shared by the game (src/buildings.js), the data tool (tools/detail/sights.mjs) and the release gate
// (tools/detail/sights-report.mjs, `npm run check:sights`). The per-map file public/data/<map>/sights.json lists, per cadastre id,
// [category index, tier (0 A, 1 B, 2 C), lead piece (1/0), tier-A key?, feature hint?]; this module decides what each category looks like.
//
// A sight gets: a facade style (window pattern), a wall + roof colour outside the ordinary housing palette, and ONE signature feature
// (landmarks.js addDeco kinds) placed on the street-facing long side or the roof. Tier A entries (TIER_A / TREAT_A) override per building.

/** facade styles (rec.style / STYLE_WIN in src/buildings.js): 0 apartment grid ... 12 timber, new: 13 institutional, 14 blind monumental, 15 stone slits, 16 historic plaster + trim */
export const STYLE = { apt: 0, church: 1, palace: 2, plain: 3, glass: 4, roundArch: 7, wood: 8, orthodox: 9, hall: 10, brick: 11, timber: 12, inst: 13, blind: 14, slit: 15, trim: 16 };

// ordinary housing palette (the game's own: src/config.js colors.wall / roof, LIFE.palettes, src/buildings.js PANEL_WALLS / TILE / TIN / TAR)
export const HOUSING = {
  walls: [0xe9dcbc, 0xe2c78f, 0xd6a27a, 0xe8d3b0, 0xcf9c78, 0xdcc9a4, 0xc9b99a, 0xe5b99a, 0xd8d2c4, 0xc7c2b6, 0xb6bcc0, 0xdad0ba, 0xe3d3ae, 0xd9c08c, 0xcdb79a, 0xd9cfbf, 0xc9b89c,
    0xb28c74, 0xa88a77, 0x9a8f86, 0xcdbfa6, 0xbba88e, 0xdccdb0, 0xcdb89a,
    0xe4b25a, 0xcf7a4d, 0xe8d3a2, 0xd9926c, 0xc4574b, 0xe2c27a, 0xb8c9a0, 0xd8a39a, 0xbfd8c3, 0xe3b5b0, 0xc9bcd8, 0xefdca0, 0xb5cde0, 0xe9d8c4, 0xd9e2b5, 0xf0c9a8,
    0xd2cdc2, 0xc9c6bf, 0xdad4c6, 0xbfc2c3, 0xc8c0b0, 0xd6d1c8],
  roofs: [0xb55a3c, 0xa8503a, 0xc0653f, 0x9c4a35, 0xb8613c, 0x6a9484, 0x78a090, 0x8b6b5c, 0xa8452f, 0xb5523a, 0x8e3a2b,
    0x6d6f73, 0x74726e, 0x7a766f, 0x696b70, 0x7c7c7c, 0x6b6f72, 0x7b8084, 0x62676c, 0x867b71, 0x6a9484, 0x78a090, 0x5f8f7c, 0x6e7073, 0x808285, 0x77797c],
};
const hex2lab = (hx) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = lin((hx >> 16) & 255), g = lin((hx >> 8) & 255), b = lin(hx & 255);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
export const deltaE = (a, b) => { const p = hex2lab(a), q = hex2lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
/** distance (CIE76 dE) of a colour to the nearest ordinary housing colour; >= OUTSIDE counts as "outside the housing palette" */
export const OUTSIDE = 13;
export const distWall = (hx) => Math.min(...HOUSING.walls.map((c) => deltaE(hx, c)));
export const distRoof = (hx) => Math.min(...HOUSING.roofs.map((c) => deltaE(hx, c)));

// Palettes the game itself uses for ordinary buildings (src/config.js / src/buildings.js); used to estimate what the neighbours' walls look like.
const WALL_BY_T = {
  res: [0xe9dcbc, 0xe2c78f, 0xd6a27a, 0xe8d3b0, 0xcf9c78, 0xdcc9a4, 0xc9b99a, 0xe5b99a], com: [0xd8d2c4, 0xc7c2b6, 0xb6bcc0, 0xdad0ba], pub: [0xe3d3ae, 0xd9c08c, 0xcdb79a],
  rel: [0xd9cfbf, 0xc9b89c], ind: [0xb28c74, 0xa88a77, 0x9a8f86], aux: [0xcdbfa6, 0xbba88e], oth: [0xdccdb0, 0xcdb89a],
};
const OLD_WALLS = [0xe4b25a, 0xcf7a4d, 0xe8d3a2, 0xd9926c, 0xc4574b, 0xe2c27a, 0xb8c9a0, 0xd8a39a];
const CENTRE_WALLS = [0xbfd8c3, 0xe3b5b0, 0xc9bcd8, 0xefdca0, 0xb5cde0, 0xe9d8c4, 0xd9e2b5, 0xf0c9a8];
const PANEL_WALLS = [0xd2cdc2, 0xc9c6bf, 0xdad4c6, 0xbfc2c3, 0xc8c0b0, 0xd6d1c8];
const meanHex = (a) => { let r = 0, g = 0, b = 0; for (const c of a) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; } const n = a.length; return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n); };
const MEAN = { old: meanHex(OLD_WALLS), centre: meanHex(CENTRE_WALLS), panel: meanHex(PANEL_WALLS) };
for (const k of Object.keys(WALL_BY_T)) MEAN[k] = meanHex(WALL_BY_T[k]);
/** same zones as src/buildings.js zoneOf */
export function zoneOf(x, z) {
  const a = (x + 400) / 520, b = (z - 260) / 380;
  if (a * a + b * b < 1) return 'old';
  if (x > -150 && x < 700 && z > -900 && z < -60) return 'centre';
  return 'other';
}
/** expected wall colour of an ordinary building (mean of the palette the game draws it from) */
export function expectedWall(t, x, z, slug, area) {
  if (slug === 'purvciems' && area > 200 && (t === 'res' || t === 'com' || t === 'pub' || t === 'oth')) return MEAN.panel;
  const zn = zoneOf(x, z);
  if (zn === 'old' && t !== 'com' && (t === 'res' || t === 'pub' || t === 'oth')) return MEAN.old;
  if (zn === 'centre' && t !== 'com' && (t === 'res' || t === 'pub' || t === 'oth')) return MEAN.centre;
  return MEAN[t] || MEAN.oth;
}
/** area-weighted mean expected wall colour of the ~6 nearest non-sight buildings. self = {x, z}; others = [{x, z, t, area}] (non-sights only) */
export function neighbourRef(self, others, slug, k = 6) {
  // the k nearest by a partial insertion selection (was: hypot + full sort of every non-sight building per sight = 160 ms on the Centre, 670 ms on a phone); a later item at an
  // equal distance stays behind an earlier one, exactly like the stable sort did, so the result is identical
  const dd = new Float64Array(k), oo = new Array(k);
  let n = 0, worst2 = Infinity;
  for (let i = 0; i < others.length; i++) {
    const o = others[i], ex = o.x - self.x, ez = o.z - self.z;
    if (n === k && ex * ex + ez * ez > worst2) continue; // clearly farther than the current k-th (the margin keeps hypot's rounding out of it)
    const d = Math.hypot(ex, ez);
    if (n === k && d >= dd[k - 1]) continue;
    let j = n < k ? n++ : k - 1;
    while (j > 0 && dd[j - 1] > d) { dd[j] = dd[j - 1]; oo[j] = oo[j - 1]; j--; }
    dd[j] = d; oo[j] = o;
    if (n === k) worst2 = dd[k - 1] * dd[k - 1] * 1.000001 + 1e-9;
  }
  let r = 0, g = 0, b = 0, w = 0;
  for (let q = 0; q < n; q++) { const o = oo[q]; const c = expectedWall(o.t, o.x, o.z, slug, o.area), a = Math.max(20, o.area); r += ((c >> 16) & 255) * a; g += ((c >> 8) & 255) * a; b += (c & 255) * a; w += a; }
  return w ? (Math.round(r / w) << 16) | (Math.round(g / w) << 8) | Math.round(b / w) : MEAN.res;
}
/** a sight's wall must differ perceptibly from its neighbours' mean wall (CIE76 dE); the gate and the tier B pick use this */
export const WALL_DIFF = 8;

/**
 * Categories. walls = MUTED real-material wall tones typical for the building type (tier B picks the one that differs most from the neighbours; tier C keeps its natural
 * wall, except timber houses). roof = a REAL roof material, only where the type has a typical one (flat bitumen grey for halls / stations / retail / towers); null = the
 * building keeps its natural roof (clay tile / tin / bitumen as drawn for ordinary buildings, or its hero colour). No category-coded blue / teal / violet roofs.
 */
export const CATS = [
  { id: 'church', lv: 'Dievnams', en: 'Church / prayer hall', style: STYLE.roundArch, walls: [0xe6dcc0, 0xd9c9a0, 0xcfc4b0], roof: null, dome: 0, feat: ['cote'], win: { floorH: 7.4, spacing: 4.2, frac: 0.65 } },
  { id: 'theatre', lv: 'Teātris / kultūra', en: 'Theatre / culture', style: STYLE.blind, walls: [0xd8b88c, 0xc9a88a, 0xb9a58a, 0xe3d3b0], roof: null, feat: ['fly', 'canopy'], win: { floorH: 6, spacing: 4.5, frac: 0.75 } },
  { id: 'museum', lv: 'Muzejs', en: 'Museum', style: STYLE.blind, walls: [0xe9e4d6, 0xd6cdb8, 0xc9c2b0], roof: null, feat: ['portico'], win: { floorH: 6, spacing: 4.5, frac: 0.75 } },
  { id: 'school', lv: 'Skola / augstskola', en: 'School / university', style: STYLE.inst, walls: [0xa8624a, 0xb07a58, 0xc9b48a, 0xd9cfb0], roof: null, feat: ['cupola'], win: { floorH: 3.8, spacing: 2.2, frac: 0.85 } },
  { id: 'hospital', lv: 'Slimnīca / poliklīnika', en: 'Hospital / clinic', style: STYLE.inst, walls: [0xe6e3da, 0xdcdad0, 0xd2d4cc], roof: null, feat: ['redcross'], win: { floorH: 3.8, spacing: 2.2, frac: 0.85 } },
  { id: 'gov', lv: 'Valsts iestāde / vēstniecība', en: 'Government / embassy', style: STYLE.palace, walls: [0xd6cfb8, 0xc7c0a8, 0xcfc8b4], roof: null, feat: ['flagpole'], win: { floorH: 5.4, spacing: 4.6, frac: 1 } },
  { id: 'station', lv: 'Stacija / transports', en: 'Station / transport', style: STYLE.hall, walls: [0xcfcbbf, 0xbfbcb2, 0xd6d2c6], roof: 0x9a9c9e, feat: ['clocktower'], win: { floorH: 4.6, spacing: 5.4, frac: 0.7 } },
  { id: 'market', lv: 'Tirgus / tirdzniecības centrs', en: 'Market / retail', style: STYLE.glass, walls: [0xa9b4ba, 0xb4b9bc, 0x9fb0b8], roof: 0x7c7c7c, feat: ['ridge'], win: { floorH: 3.4, spacing: 1.5, frac: 0.5 } },
  { id: 'hotel', lv: 'Viesnīca / birojs', en: 'Hotel / office tower', style: STYLE.glass, walls: [0x9fb0ba, 0xb4b9bc, 0xa9b6bd], roof: 0x7a7e82, feat: ['crown'], win: { floorH: 3.4, spacing: 1.5, frac: 0.5 } },
  { id: 'tower', lv: 'Tornis / augstceltne', en: 'Tower / high-rise', style: STYLE.glass, walls: [0xa6b4bc, 0xb4b9bc, 0x9fb0b8], roof: 0x7a7e82, feat: ['crown'], win: { floorH: 3.4, spacing: 1.5, frac: 0.5 } },
  { id: 'historic', lv: 'Vēsturisks nams / ģilde / vārti', en: 'Historic house / guild / gate', style: STYLE.trim, walls: [0xe3c98a, 0xd9a98a, 0xc8b8a0, 0xcfc09a], roof: null, feat: ['stepgable', 'pgable'], win: { floorH: 3.4, spacing: 2.8, frac: 0.95 } },
  { id: 'castle', lv: 'Pils / nocietinājums', en: 'Castle / fortification', style: STYLE.slit, walls: [0x9b958a, 0xa89f8f, 0x8f8a80], roof: null, dome: 0, feat: ['roundtowers'], win: { floorH: 5, spacing: 6, frac: 0.25 } },
  { id: 'sports', lv: 'Sports', en: 'Sports', style: STYLE.hall, walls: [0xb8b6ae, 0xc4c1b6], roof: 0xb4b8bb, feat: ['masts'], win: { floorH: 4.6, spacing: 5.4, frac: 0.7 } },
  { id: 'industrial', lv: 'Rūpniecība / skurstenis', en: 'Industrial / chimney', style: STYLE.brick, walls: [0x9a5a44, 0x8a5440, 0xa66a50], roof: 0x6d6f73, feat: ['chimney'], win: { floorH: 4.4, spacing: 3.3, frac: 0.55 } },
  { id: 'monument', lv: 'Piemineklis', en: 'Monument', style: STYLE.plain, walls: [0xbfb8a8], roof: 0x6d6f73, feat: ['tower'], win: { floorH: 4, spacing: 4, frac: 0 } },
  { id: 'public', lv: 'Sabiedriska ēka', en: 'Other public building', style: STYLE.inst, walls: [0xcdbfa0, 0xbfb8a8, 0xd6cdb4], roof: null, feat: ['canopy'], win: { floorH: 3.8, spacing: 2.2, frac: 0.85 } },
  { id: 'wooden', lv: 'Koka nams', en: 'Wooden house', style: STYLE.timber, walls: [0xa0714a, 0x7f8f62, 0xb89560, 0x9a6a58, 0xd8c9a4], roof: null, feat: ['porch'], win: { floorH: 3.0, spacing: 2.6, frac: 0.9 } },
];
export const CAT_IDX = Object.fromEntries(CATS.map((c, i) => [c.id, i]));
export const TIER_NAMES = ['A', 'B', 'C'];

/** darken a roof colour step by step (same hue) until it is outside the housing palette; 0 / undefined when it never gets there */
export function pushRoof(hx) {
  const r = (hx >> 16) & 255, g = (hx >> 8) & 255, b = hx & 255;
  for (let k = 1; k <= 9; k++) {
    const f = 1 - 0.08 * k, r2 = Math.round(r * f), g2 = Math.round(g * f), b2 = Math.round(b * f), c = (r2 << 16) | (g2 << 8) | b2;
    if ((Math.max(r2, g2, b2) + Math.min(r2, g2, b2)) / 510 < 0.3) break; // roofs never render near-black (src/buildings.js)
    if (distRoof(c) >= OUTSIDE + 1) return c;
  }
  return 0;
}

/** hash of a position -> stable pick */
export const pick = (arr, x, z, salt = 0) => arr[Math.abs(((x * 7.31 + z * 3.17 + salt * 11.9) | 0)) % arr.length];

/**
 * Tier A sights (city icons). `ids` / `re` (name regexp over cadastre names) / `pt` (nearest building to a point) pick the pieces; the first id is the lead piece
 * (features go there) unless `lead` is given. map defaults to centrs. album = id of src/meta/album.js entry.
 */
export const TIER_A = [
  { key: 'castle', lv: 'Rīgas pils', en: 'Riga Castle', cat: 'castle', ids: [49615051, 49614975], album: 'castle' },
  { key: 'blackheads', lv: 'Melngalvju nams', en: 'House of the Blackheads', cat: 'historic', ids: [49614347], album: 'blackheads' },
  { key: 'townhall', lv: 'Rīgas Rātsnams', en: 'Riga City Hall', cat: 'gov', ids: [49614687], album: 'ratsnams' },
  { key: 'brothers', lv: 'Trīs brāļi', en: 'Three Brothers', cat: 'historic', ids: [49614971, 49614596, 49615271, 49614187, 49612599, 49612635, 49612661], album: 'brothers' },
  { key: 'guild-great', lv: 'Lielā Ģilde', en: 'Great Guild', cat: 'historic', ids: [49616381], album: 'guilds' },
  { key: 'guild-small', lv: 'Mazā Ģilde', en: 'Small Guild', cat: 'historic', ids: [49616364], album: 'guilds' },
  { key: 'cathouse', lv: 'Kaķu nams', en: 'Cat House', cat: 'historic', ids: [49616370, 49616429], album: 'cat' },
  { key: 'swedish', lv: 'Zviedru vārti', en: 'Swedish Gate', cat: 'castle', ids: [49615193, 49614979], album: 'swedish' },
  { key: 'powder', lv: 'Pulvertornis', en: 'Powder Tower', cat: 'castle', ids: [49615275], album: 'powder' },
  { key: 'university', lv: 'Latvijas Universitāte', en: 'University of Latvia', cat: 'school', ids: [49616039, 49616004] },
  { key: 'theatre', lv: 'Nacionālais teātris', en: 'National Theatre', cat: 'theatre', ids: [49614719], album: 'theatre' },
  { key: 'daile', lv: 'Dailes teātris', en: 'Daile Theatre', cat: 'theatre', ids: [49621082, 49612595], album: 'dailes' },
  { key: 'artmuseum', lv: 'Latvijas Nacionālais mākslas muzejs', en: 'National Museum of Art', cat: 'museum', ids: [49615452] },
  { key: 'artacademy', lv: 'Latvijas Mākslas akadēmija', en: 'Academy of Art', cat: 'school', ids: [49615853, 49615877], album: 'art' },
  { key: 'circus', lv: 'Rīgas cirks', en: 'Riga Circus', cat: 'theatre', ids: [49615676], album: 'circus' },
  { key: 'splendid', lv: 'Splendid Palace', en: 'Splendid Palace', cat: 'theatre', ids: [49619824], album: 'splendid' },
  { key: 'congress', lv: 'Rīgas Kongresu nams', en: 'Riga Congress House', cat: 'theatre', ids: [49616534] },
  { key: 'nevsky', lv: 'Sv. Aleksandra Ņevska baznīca', en: 'St Alexander Nevsky Church', cat: 'church', ids: [49619857, 49619931] },
  { key: 'radisson-daugava', lv: 'Radisson Blu Daugava', en: 'Radisson Blu Daugava', cat: 'hotel', ids: [49629591] },
  { key: 'saeima', lv: 'Saeima', en: 'Saeima (Parliament)', cat: 'gov', ids: [49614901] },
  { key: 'bank', lv: 'Latvijas Banka', en: 'Bank of Latvia', cat: 'gov', ids: [49615814] },
  { key: 'occupation', lv: 'Okupācijas muzejs', en: 'Occupation Museum', cat: 'museum', ids: [49614381] },
  { key: 'radio', lv: 'Latvijas Radio', en: 'Latvian Radio', cat: 'gov', ids: [49616468], album: 'radio' },
  { key: 'library', lv: 'Nacionālā bibliotēka', en: 'National Library', cat: 'theatre', ids: [49629679], album: 'library' },
  { key: 'academy', lv: 'Zinātņu akadēmija', en: 'Academy of Sciences', cat: 'tower', ids: [49628422], album: 'academy' },
  { key: 'hotel-latvija', lv: 'Radisson Blu Latvija', en: 'Radisson Blu Latvija', cat: 'hotel', ids: [49619752] },
  { key: 'saulesakmens', lv: 'Saules akmens', en: 'Saules akmens', cat: 'tower', ids: [49639844], album: 'saules' },
  { key: 'ztowers', lv: 'Z-Towers', en: 'Z-Towers', cat: 'tower', ids: [49637749], album: 'ztowers' },
  { key: 'presesnams', lv: 'Preses nams', en: 'Press House', cat: 'tower', ids: [49639106], album: 'presesnams' },
  { key: 'origo', lv: 'Origo', en: 'Origo', cat: 'market', ids: [49611992, 49614964] },
  { key: 'stockmann', lv: 'Stockmann', en: 'Stockmann', cat: 'market', ids: [49615917] },
  { key: 'galerija', lv: 'Galerija Centrs', en: 'Galerija Centrs', cat: 'market', ids: [49614491, 49614512] },
  { key: 'market', lv: 'Centrāltirgus', en: 'Central Market', cat: 'market', ids: [49614728, 49614778, 49615303, 49615403], album: 'market' },
  { key: 'market-meat', lv: 'Centrāltirgus (Gaļas paviljons)', en: 'Central Market (meat pavilion)', cat: 'market', ids: [49615202] },
  { key: 'station', lv: 'Centrālā stacija', en: 'Central Station', cat: 'station', ids: [49614666, 49615281, 49614810, 49614921] },
  { key: 'spikeri', lv: 'Spīķeri', en: 'Spīķeri warehouses', cat: 'industrial', ids: [49612972, 49615217, 49615466, 49614933], album: 'spikeri' },
  { key: 'ferry', lv: 'Rīgas pasažieru osta', en: 'Riga passenger terminal', cat: 'station', ids: [49615997] },
  { key: 'peter', lv: 'Svētā Pētera baznīca', en: "St Peter's Church", cat: 'church', ids: [49614351], album: 'peter' },
  { key: 'dome', lv: 'Rīgas Doms', en: 'Riga Cathedral', cat: 'church', ids: [49614755], album: 'dome' },
  { key: 'nativity', lv: 'Kristus Piedzimšanas katedrāle', en: 'Nativity Cathedral', cat: 'church', ids: [49615771], album: 'nativity' },
  { key: 'jekab', lv: 'Svētā Jēkaba katedrāle', en: "St James's Cathedral", cat: 'church', ids: [49614946], album: 'jekab' },
  { key: 'jani', lv: 'Svētā Jāņa baznīca', en: "St John's Church", cat: 'church', ids: [49614438], album: 'jani' },
  { key: 'lbn', lv: 'Latviešu biedrības nams', en: 'Latvian Society House', cat: 'theatre', ids: [49615638], album: 'lbn' },
  { key: 'opera', lv: 'Nacionālā opera', en: 'National Opera', cat: 'theatre', ids: [49616059, 49615786, 49615783], album: 'opera' },
  // districts
  { map: 'agenskalns', key: 'ag-market', lv: 'Āgenskalna tirgus', en: 'Āgenskalns Market', cat: 'market', ids: [49634808], album: 'agmarket' },
  { map: 'agenskalns', key: 'ag-wooden', lv: 'Kalnciema kvartāls (koka nami)', en: 'Kalnciema quarter (wooden houses)', cat: 'wooden', ids: [49636186] },
  { map: 'mezaparks', key: 'estrade', lv: 'Lielā estrāde', en: 'Great Song Festival Stage', cat: 'sports', ids: [49673065, 49673070], album: 'estrade' },
  { map: 'mezaparks', key: 'tropu', lv: 'Tropu māja', en: 'Tropical House', cat: 'public', ids: [49672040], album: 'tropu' },
];

/**
 * Tier A overrides, by key (true-to-life colours of real icons; REAL roof materials only). style / wall / roof / dome (hex) / feats (addDeco / addSightFeature kinds) / `pieces` =
 * per-piece [wall, roof] for multi-piece sights. Curated heroes (tools/detail/heroes*.mjs: churches, Art Museum, Art Academy, castle, town hall ... ) keep their approved
 * wall / roof colours: an override only applies to a field the hero record does not set.
 */
const SLATE = 0x4f5358, COPPER_ROOF = 0x5f8f7c, TILE_RED = 0xa8503a, TILE_DARK = 0x9c4a35, TIN = 0x7b8084, TAR = 0x6d6f73;
export const TREAT_A = {
  castle: { feats: [{ kind: 'castle' }] },
  blackheads: { feats: [{ kind: 'gabletrim' }] },
  townhall: { feats: [{ kind: 'clocktower', h: 17, cap: 0x3f8a76 }, { kind: 'flagpole' }] },
  brothers: { pieces: [[0xe8c27a, TILE_RED], [0xd9917a, TILE_DARK], [0x9fc0a4, TILE_RED]], feats: [{ kind: 'pgable', w: 5.5 }] },
  'guild-great': { wall: 0xe0bf72, roof: SLATE, feats: [{ kind: 'stepgable' }, { kind: 'turret1' }] },
  'guild-small': { wall: 0xcfcabc, roof: SLATE, feats: [{ kind: 'pgable', w: 9 }, { kind: 'turret1' }] },
  cathouse: { wall: 0xe8c040, roof: COPPER_ROOF, feats: [{ kind: 'cat2' }] },
  swedish: { wall: 0xe0c27a, roof: TILE_DARK, feats: [{ kind: 'gatearch' }] },
  powder: { feats: [] },
  university: { feats: [{ kind: 'portico', w: 16 }] }, // review M-22: the invented blue dome is gone
  theatre: { feats: [{ kind: 'fly' }, { kind: 'portico', w: 12 }] },
  daile: { wall: 0x8a6a54, roof: TAR, feats: [{ kind: 'fly', big: true }, { kind: 'canopy' }] },
  artmuseum: { feats: [] },
  artacademy: { feats: [] },
  circus: { wall: 0xd8c9a4, roof: TIN, dome: 0x7d9488, feats: [] }, // review M-11: one dome (the measured one), not two
  splendid: { wall: 0xcfb08a, roof: TIN, feats: [{ kind: 'portico', w: 10 }, { kind: 'cornice' }] },
  congress: { wall: 0xb7b2a6, roof: TAR, feats: [{ kind: 'canopy', w: 18 }, { kind: 'flagpole' }] },
  saeima: { roof: TIN, feats: [{ kind: 'flagpole' }] }, // review M-22: no invented clock tower
  bank: { wall: 0xcfc6b0, roof: 0x6aa08a, feats: [{ kind: 'portico', w: 10 }, { kind: 'flagpole' }] },
  occupation: { wall: 0x2f3236, roof: 0x4a4c50, style: STYLE.blind, feats: [{ kind: 'cornice', dark: true }], dark: true },
  radio: { wall: 0xb8c0c4, roof: TAR, feats: [{ kind: 'mast' }, { kind: 'canopy' }] },
  library: { feats: [{ kind: 'crown', glass: true }] },
  academy: { feats: [] }, 'hotel-latvija': { feats: [] }, saulesakmens: { feats: [] }, ztowers: { feats: [] }, presesnams: { wall: 0xb9c4cc, style: STYLE.glass, feats: [{ kind: 'crown' }] },
  origo: { wall: 0xa9b4ba, roof: 0x7c7c7c, feats: [{ kind: 'ridge' }, { kind: 'canopy', w: 16 }] },
  stockmann: { wall: 0xa9b4ba, roof: 0x7c7c7c, feats: [{ kind: 'ridge' }, { kind: 'canopy', w: 16 }] },
  galerija: { wall: 0xa9b4ba, roof: 0x7c7c7c, feats: [{ kind: 'ridge' }, { kind: 'canopy', w: 16 }] },
  market: { feats: [] },
  'market-meat': { feats: [] },
  station: { feats: [] },
  spikeri: { wall: 0x9a4a38, roof: TILE_DARK, style: STYLE.brick, feats: [{ kind: 'pgable', w: 6 }] },
  ferry: { wall: 0xcfd4d6, roof: TAR, feats: [{ kind: 'clocktower', h: 10 }, { kind: 'canopy', w: 16 }] },
  peter: { feats: [] }, dome: { feats: [] }, nativity: { feats: [] }, jekab: { feats: [] }, jani: { feats: [] },
  lbn: { wall: 0xd9c9a4, roof: TIN, feats: [{ kind: 'portico', w: 10 }] },
  opera: { feats: [] },
  'ag-market': { feats: [{ kind: 'ridge', long: true }] },
  'ag-wooden': { feats: [{ kind: 'porch' }] },
  estrade: { feats: [{ kind: 'wave' }] },
  tropu: { wall: 0xc8dcc6, roof: TIN, feats: [{ kind: 'tent', col: 0xb5523a }] }, // review M-14: low red conical tent roof
  nevsky: { feats: [{ kind: 'dome', R: 7.4, col: 0x4f8a6c, drum: 0xe6cf80, cross: true }] }, // review M-10: one large green dome
  'radisson-daugava': { feats: [] }, // review M-09: no +13 m lantern; the body is the measured 8-10 floor slab
};

/** feature hints from OSM tags (client file 5th element): water towers and chimneys */
export const FEAT_HINT = ['watertower', 'chimney', 'tower', 'masts', 'flagpole'];

/** scale the brightness of a wall colour until it differs from `ref` by WALL_DIFF (+0.5); the original when nothing within +-30 % does */
export function nudgeWall(hx, ref) {
  for (const f of [0.88, 1.1, 0.8, 1.16, 0.72, 1.22]) {
    const r = Math.min(255, Math.round(((hx >> 16) & 255) * f)), g = Math.min(255, Math.round(((hx >> 8) & 255) * f)), b = Math.min(255, Math.round((hx & 255) * f)), c = (r << 16) | (g << 8) | b;
    if (deltaE(c, ref) >= WALL_DIFF + 0.5) return c;
  }
  return hx;
}

/** small, cheap features for tier C (no fly towers, crowns, round towers, big porticos): the sight stays subtle */
const C_FEAT = { church: 'cote', hospital: 'redcross', gov: 'flagpole', industrial: 'chimney', wooden: 'porch', school: 'cupola' };
const GLASS_STYLES = new Set([STYLE.glass]);

/**
 * Effective treatment of one building. s = [cat, tier, lead, key|null, hint|null, pieceIdx] from sights.json, rec = shapes record (or null), x / z = position,
 * ref = expected wall colour of the neighbourhood (neighbourRef) used by tier B to pick the wall tone that differs most from it.
 * Returns { cat, tier, style, wall|null, roof|null, dome, feats[], win, dark, key }; null wall / roof = keep the building's natural colour.
 * Tier A: true-to-life override colours; tier B: muted material wall tone + category facade + feature; tier C: facade style + a small feature, natural colours (timber houses keep timber tones).
 * Curated heroes always keep their own approved wall / roof / dome colours.
 */
export function treatmentFor(s, rec, x, z, ref = 0) {
  const cat = CATS[s[0]], pieceIdx = s[5] || 0;
  const tier = s[1], lead = !!s[2], key = s[3] || null, hint = s[4] != null && s[4] >= 0 ? FEAT_HINT[s[4]] : null;
  const A = key ? TREAT_A[key] : null;
  let style = A && A.style != null ? A.style : cat.style;
  if (tier === 2 && !A && GLASS_STYLES.has(style)) style = STYLE.inst; // minor buildings never get a glass curtain wall
  let wall = null, roof = cat.roof, dome = cat.dome || 0;
  if (tier <= 1 && !A) { let best = -1; for (const c of cat.walls) { const d = ref ? deltaE(c, ref) : 0; if (d > best) { best = d; wall = c; } } }
  else if (cat.id === 'wooden') wall = pick(cat.walls, x, z);
  if (A) { if (A.wall != null) wall = A.wall; if (A.roof != null) roof = A.roof; if (A.dome != null) dome = A.dome; if (A.pieces) { const p = A.pieces[pieceIdx % A.pieces.length]; wall = p[0]; roof = p[1]; } }
  const hasHero = !!(rec && (rec.wallRGB || rec.style));
  if (hasHero) {
    if (rec.style && !(A && A.style != null)) style = rec.style;
    if (rec.wallRGB) wall = rec.wallRGB;
    if (rec.roofRGB) roof = rec.roofRGB;
    if (rec.domeRGB) dome = rec.domeRGB;
  }
  if (tier <= 1 && ref && wall != null && deltaE(wall, ref) < WALL_DIFF) wall = nudgeWall(wall, ref); // a wall too close to its neighbours' mean is shifted a little in lightness (same material hue)
  let feats = A && A.feats ? A.feats : (hint ? [{ kind: hint }] : cat.feat.slice(0, 1).map((k) => ({ kind: k })));
  if (tier === 2 && !A && !hint) feats = [{ kind: C_FEAT[cat.id] || 'canopy' }];
  if (!lead && !(A && A.pieces)) feats = []; // one signature feature per sight, on the lead piece
  return { cat: cat.id, tier, style, wall, roof, dome, feats, win: cat.win, dark: !!(A && A.dark), key };
}
