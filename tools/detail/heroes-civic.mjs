// Civic / secular landmarks (owner: civic agent). Two exports:
//   CIVIC_SHOTS  review cameras for scripts/civic-shots.mjs (ids or a world point or a prop kind; cam overrides as in heroes.mjs)
//   CIVIC        hero entries (same schema as heroes.mjs); merged into HEROES by mergeCivic() (entries with an existing slug replace it)
export const CIVIC_SHOTS = [
  // map defaults to centrs
  { slug: 'station', pt: [390, 515], dist: 250, el: 27, a: 195, b: 330, y: 8, r: 24, name: 'Centrālā stacija' },
  { slug: 'platforms', pt: [450, 590], dist: 140, el: 24, a: 200, b: 330, y: 4, r: 14, name: 'Perona nojumes' },
  { slug: 'market', pt: [75, 870], dist: 330, el: 30, a: 35, b: 215, y: 6, r: 28, name: 'Centrāltirgus' },
  { slug: 'opera', ids: [49616059, 49615786, 49615783], name: 'Nacionālā opera' },
  { slug: 'theatre', ids: [49614719], name: 'Nacionālais teātris' },
  { slug: 'daile', ids: [49621082, 49612595], name: 'Dailes teātris' },
  { slug: 'splendid', ids: [49619824], name: 'Splendid Palace' },
  { slug: 'university', ids: [49616039, 49616004], name: 'LU galvenā ēka' },
  { slug: 'congress', ids: [49616534], name: 'Kongresu nams' },
  { slug: 'townhall', ids: [49614687], name: 'Rātsnams' },
  { slug: 'blackheads', ids: [49614347, 49614380], name: 'Melngalvju nams' },
  { slug: 'guilds', ids: [49616381, 49616364], name: 'Lielā un Mazā ģilde' },
  { slug: 'brothers', ids: [49614971, 49614596, 49615271], name: 'Trīs brāļi' },
  { slug: 'cathouse', ids: [49614702], name: 'Kaķu nams' },
  { slug: 'castle', ids: [49615051, 49614975], name: 'Rīgas pils' },
  { slug: 'saeima', ids: [49614901], name: 'Saeima' },
  { slug: 'freedom', kind: 'freedom', dist: 90, el: 22, y: 20, name: 'Brīvības piemineklis' },
  { slug: 'laima', kind: 'laima', dist: 45, el: 20, y: 8, name: 'Laimas pulkstenis' },
  { slug: 'powder', ids: [49615275, 49615127], name: 'Pulvertornis' },
  { slug: 'swedish', ids: [49615193, 49614979], name: 'Zviedru vārti' },
  { slug: 'circus', ids: [49615676], name: 'Rīgas cirks' },
  { slug: 'radio', ids: [49616468], name: 'Latvijas Radio' },
  { slug: 'academy', ids: [49628422], name: 'Zinātņu akadēmija' },
  { slug: 'hotel', ids: [49619752], name: 'Hotel Latvija' },
  { slug: 'saulesakmens', ids: [49639844], name: 'Saules akmens' },
  { slug: 'ztowers', ids: [49637749], name: 'Z-Towers' },
  { slug: 'presesnams', ids: [49639106, 49613231], name: 'Preses nams' },
  { slug: 'library', ids: [49629679], name: 'Nacionālā bibliotēka' },
  { slug: 'galerija', ids: [49614491, 49614512], name: 'Galerija Centrs' },
  { slug: 'pylon', kind: 'pylon', dist: 190, el: 22, y: 40, name: 'Vanšu tilta pilons' },
  { slug: 'railarch', kind: 'railarch', dist: 120, el: 20, y: 8, name: 'Dzelzceļa tilts' },
  { slug: 'railmuseum', ids: [49629670], name: 'Dzelzceļa vēstures muzejs' },
  { map: 'agenskalns', slug: 'ag-market', ids: [49634808], name: 'Āgenskalna tirgus' },
  { map: 'agenskalns', slug: 'ag-wooden', ids: [49636186], name: 'Koka nami' },
  { map: 'mezaparks', slug: 'estrade', ids: [49673065, 49673070], dist: 260, el: 32, name: 'Lielā estrāde' },
  { map: 'mezaparks', slug: 'mz-tropu', ids: [49672040], name: 'Tropu māja' },
  { map: 'mezaparks', slug: 'mz-wasa', ids: [49665210], name: "Villa 'Wasa'" },
  { map: 'purvciems', slug: 'pv-slab-1', ids: [49645710, 49646937, 49648832], name: 'Plātņu nams' },
];
export const CIVIC = [
  { slug: 'opera', name: 'Nacionālā opera', ids: [49616059, 49615786, 49615783], source: 'auto', features: 'opera', style: 2, wall: 0xf1ede2, roof: 0x6f9486, dome: 0x6f9486,
    note: 'white neo-classical opera: columned portico with pediment (added feature), tall stage tower, green roofs' },
  // --- Centrālā stacija: head building + clock tower, main hall, east wing (three objects; the old 'station' hero covered the two cadastre pieces of hall + wing only)
  { slug: 'station', name: 'Centrālā stacija', ids: [49614666], source: 'mesh', curated: 'stationhall', style: 10, wall: 0xd6d0c4, roof: 0x8e9a98, dome: 0x8e9a98, accent: 0xf4f0dd,
    note: 'modernist main hall: long and low, big glazed south front, roof lanterns' },
  { slug: 'station-wing', name: 'Centrālā stacija (austrumu spārns)', ids: [49615281], source: 'mesh', curated: 'stationwing', style: 10, wall: 0xd6d0c4, roof: 0x8e9a98, dome: 0x8e9a98, accent: 0xf4f0dd,
    note: 'east wing with the glazed front towards the square' },
  { slug: 'station-tower', name: 'Centrālā stacija (pulksteņa tornis)', ids: [49614810], source: 'mesh', curated: 'stationhead', style: 10, wall: 0xd6d0c4, roof: 0x8e9a98, dome: 0x8e9a98, accent: 0xf4f0dd,
    note: 'head building on the square with the slim 50 m clock tower (clock faces on four sides)' },
  // --- Centrāltirgus: four parallel zeppelin-hangar vaults with glazed gables + ridge lanterns
  { slug: 'market', name: 'Centrāltirgus (Zivju paviljons)', ids: [49614728], source: 'mesh', curated: 'marketvault', style: 11, wall: 0xd9d2c0, roof: 0xaebbb2, dome: 0xaebbb2, note: 'zeppelin-hangar pavilion' },
  { slug: 'market-2', name: 'Centrāltirgus (Sakņu paviljons)', ids: [49615403], source: 'mesh', curated: 'marketvault', style: 11, wall: 0xd9d2c0, roof: 0xaebbb2, dome: 0xaebbb2, note: 'zeppelin-hangar pavilion' },
  { slug: 'market-3', name: 'Centrāltirgus (Gastronomijas paviljons)', ids: [49614778], source: 'mesh', curated: 'marketvault', style: 11, wall: 0xd9d2c0, roof: 0xaebbb2, dome: 0xaebbb2, note: 'zeppelin-hangar pavilion' },
  { slug: 'market-4', name: 'Centrāltirgus (Piena paviljons)', ids: [49615303], source: 'mesh', curated: 'marketvault', style: 11, wall: 0xd9d2c0, roof: 0xaebbb2, dome: 0xaebbb2, note: 'zeppelin-hangar pavilion' },
];
/** replace-or-append civic hero entries into the base list (entry with an existing slug replaces it in place) */
export function mergeCivic(base) {
  const out = base.slice();
  for (const h of CIVIC) {
    const i = out.findIndex((x) => x.slug === h.slug);
    if (i >= 0) out[i] = h; else out.push(h);
  }
  return out;
}
