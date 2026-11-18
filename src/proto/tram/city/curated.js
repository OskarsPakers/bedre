// Hand-set colours for landmark buildings of the tram routes (ids of public/data/riga.json). Used where the sampled colour is poor or missing.
// Values are sRGB hex, chosen by eye from the photoreal reference renders (scripts/out/realistic/*) and public knowledge of the buildings.
// wall / roof / trim; `gh` = ground band height override, `co` cornice depth override.
import { SIGNATURES } from './signature/recipes.js';
export const CURATED = {
  49616059: { name: 'Nacionālā opera', wall: 0xece7da, roof: 0x7f9a8c, trim: 0xf6f2e8, gh: 5.2, co: 1.1, portico: { cols: 6, w: 17, h: 11.5, d: 4.8, dir: [-0.88, 0.47] }, grand: { gh: 6.4 } },
  49615783: { name: 'Operas piebūve', wall: 0xe8e2d4, roof: 0x7f9a8c, trim: 0xf3efe4 },
  49614719: { name: 'Nacionālais teātris', wall: 0xe9e1cf, roof: 0x80ac94, trim: 0xf4efe2 },
  49614728: { hangar: true, name: 'Centrāltirgus: Zivju paviljons', wall: 0xcfd3cf, roof: 0xa9b0ae },
  49614778: { hangar: true, name: 'Centrāltirgus: Gastronomijas paviljons', wall: 0xcfd3cf, roof: 0xa9b0ae },
  49615303: { hangar: true, name: 'Centrāltirgus: Piena paviljons', wall: 0xcfd3cf, roof: 0xa9b0ae },
  49615403: { hangar: true, name: 'Centrāltirgus: Sakņu paviljons', wall: 0xcfd3cf, roof: 0xa9b0ae },
  ...SIGNATURES,
};
