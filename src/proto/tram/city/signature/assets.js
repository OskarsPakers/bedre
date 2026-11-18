// Registry of the packed signature assets (tools/onebuilding/pack.mjs -> public/data/tram/sig/<name>.bin.gz). `ids` = cadastre ids of public/data/riga.json that the asset REPLACES (their engine / city
// geometry is not drawn while the asset is loaded; if the asset fails to load the round-4 recipes of recipes.js / curated.js still stand). frame: model X = across (v), Z = along (u), Y up (ground 0);
// world = O + u * A + v * VV with A = (cos th, sin th), VV = (A.z, -A.x) (the Opera's own frame, tools/onebuilding/frame.js).
// pal: sRGB hex per zone of gen.js (0 plaster, 1 trim, 2 stone base / plinth, 3 roof, 4 glass (shader), 5 metal / bars, 6 sculpture stone, 7 doors). dist = LOD0 / LOD1 switch distance (desktop; phones use dist * 0.65).
export const ASSETS = {
  opera: { file: 'opera', ids: [49616059, 49615783], O: [25.3, 240.4], th: Math.atan2(0.8819, 0.4715), maps: ['centrs'], dist: [125, 300], radius: 52, centre: [20.4, 30, 33], flood: true,
    pal: { 0: 0xdcd6c7, 1: 0xece8dc, 2: 0xa7a18f, 3: 0x7d9889, 4: 0x222a33, 5: 0x4a554f, 6: 0xc4bfb0, 7: 0x3b2c22 } },
  stockmann: { file: 'stockmann', ids: [49615504], O: [150, 604], th: Math.atan2(-0.5760, 0.8175), maps: ['centrs'], dist: [120, 280], radius: 75, centre: [-30, 15, 40],
    pal: { 0: 0xc3c8cc, 1: 0xe6e7e6, 2: 0x6f7276, 3: 0x62666a, 4: 0x1d252c, 5: 0x5c6165, 6: 0x9b4a35, 7: 0x23272b } },
  bernu: { file: 'bernu', ids: [], O: [1242.3, -630.0], th: Math.atan2(-0.690, 0.724), maps: ['centrs'], dist: [110, 260], radius: 45, centre: [-25, 8, 25],
    pal: { 0: 0xb9bab7, 1: 0xe4e4e0, 2: 0x7d7e7c, 3: 0x55585a, 4: 0x1c242a, 5: 0x3b4044, 6: 0xc2352c, 7: 0x23272b } },
};
