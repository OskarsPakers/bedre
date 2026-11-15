// Curated treatment of the landmark ("hero") buildings. Read by build-meshes.mjs (source / palette / overrides) and scripts/detail-shots.mjs (cameras).
//
//   ids        riga.json building id(s) (the first one is the camera target; all get the same treatment)
//   source     'auto' (OSM parts when they validate against the mesh, else the plane-fitted mesh) | 'parts' (OSM parts, force) | 'mesh' (plane-fitted mesh, never OSM)
//   style      facade style flag stored in the shapes file: 0 apartment windows (default) | 1 church (tall narrow windows) | 2 palace (large tall windows + bands)
//              | 3 plain stone (no windows) | 4 glass curtain wall (cool tinted horizontal bands)
//   wall/roof/dome/accent   0xRRGGBB palette: walls, ordinary pitched roofs, domes + spires (material class 3), accent (gold, class 5 = OSM parts tagged 'gold')
//   fit        mesh-fit tuning ({ tol, minArea, lathe:false, … }), see planar.mjs
//   cam        { dist, el, a, b, y } override for the review shots (a, b = azimuths in degrees, y = look-at height)
//   note       one line: what the real building looks like
export const HEROES = [
  { slug: 'nativity', name: 'Kristus Piedzimšanas pareizticīgo katedrāle', ids: [49615771], source: 'parts', style: 1, crosses: true, wall: 0xe6dcc0, roof: 0x66727e, dome: 0xe3b53c, accent: 0xe3b53c,
    note: 'neo-Byzantine cathedral: cream/ochre walls, a large gilded central dome and four gilded corner domes on drums, apse to the east' },
  { slug: 'artmuseum', name: 'Latvijas Nacionālais mākslas muzejs', ids: [49615452], source: 'mesh', style: 2, ortho: true, ringTol: 0.9, opts: { contourTol: 0.9 }, fit: { minArea: 14, weld: 1.1 }, wall: 0xe4d8bd, roof: 0x6f9c8a, dome: 0x6f9c8a,
    note: 'neo-baroque palace (Rozentāls square): pale sandstone, long symmetric wings, central block with a high copper-green mansard / dome' },
  { slug: 'oldgertrude', name: 'Vecā Ģertrūdes baznīca', ids: [49619142], source: 'mesh', style: 1, wall: 0xb0553b, roof: 0x7a808a, dome: 0x6b747e,
    note: 'red-brick neo-gothic church: nave with steep roof, one tall slim spire' },
  { slug: 'stpeter', name: 'Svētā Pētera baznīca', ids: [49614351], source: 'mesh', style: 1, wall: 0xc9b9a0, roof: 0x7a808a, dome: 0x6a8a7c,
    note: 'gothic hall church with the 123 m copper-green steeple, brick body' },
  { slug: 'dome', name: 'Rīgas Doms', ids: [49614755], source: 'auto', style: 1, wall: 0xcdb38c, roof: 0xb0553b, dome: 0x6a8a7c,
    note: 'Dome cathedral: large nave with a steep tile roof, tall tower with a baroque copper-green cupola, apse and low aisles' },
  { slug: 'stjacob', name: 'Svētā Jēkaba katedrāle', ids: [49614946], source: 'auto', style: 1, wall: 0xd8c8a0, roof: 0x7a808a, dome: 0x6a8a7c,
    note: 'Catholic cathedral: yellowish stucco, one slim tower with a spire, steep nave roof' },
  { slug: 'stjohn', name: 'Svētā Jāņa baznīca', ids: [49614438], source: 'auto', style: 1, wall: 0xc9a79a, roof: 0x8c4632, dome: 0x6a8a7c,
    note: 'small gothic brick church squeezed in a block, steep gabled roof, little turret' },
  { slug: 'anglican', name: 'Anglikāņu baznīca', ids: [49614911], source: 'mesh', style: 1, wall: 0xd9cdb0, roof: 0x7d838c,
    note: 'small neo-gothic church with a tall slim tower' },
  { slug: 'opera', name: 'Nacionālā opera', ids: [49616059, 49615786, 49615783], source: 'auto', style: 2, wall: 0xf1ede2, roof: 0x6f9486, dome: 0x6f9486,
    note: 'white neo-classical opera: columned portico towards the Freedom Monument, a very tall stage tower behind, green roofs' },
  { slug: 'castle', name: 'Rīgas pils', ids: [49615051, 49614975], source: 'mesh', style: 2, wall: 0xe0c27a, roof: 0x8c3f2c, dome: 0x6a8a7c,
    note: 'Riga Castle: ochre-yellow walls, round corner towers with conical roofs (Lead Tower, Three Star Tower), tile roofs round a courtyard' },
  { slug: 'powder', name: 'Pulvertornis', ids: [49615275], source: 'mesh', style: 3, wall: 0x6e5d50, roof: 0x8c3f2c, dome: 0x8c3f2c,
    note: 'dark round Powder Tower with a conical red-brown roof' },
  { slug: 'blackheads', name: 'Melngalvju nams', ids: [49614347], stepGable: true, source: 'mesh', style: 2, wall: 0xb04a34, roof: 0x9c4a35, dome: 0x9c4a35,
    note: 'red-brick stepped-gable guild house with ornate gable' },
  { slug: 'townhall', name: 'Rātsnams', ids: [49614687], source: 'auto', style: 2, wall: 0xe8d8b8, roof: 0x8c4632,
    note: 'rebuilt town hall on the square: pale walls, red tile roof with a small tower' },
  { slug: 'cathouse', name: 'Kaķu nams', ids: [49614702], source: 'mesh', style: 0, wall: 0xd7b089, roof: 0x5f9d89,
    note: 'Art Nouveau corner house with a round turret and two cats on top' },
  { slug: 'university', name: 'Latvijas Universitātes galvenā ēka', ids: [49616039, 49616004], source: 'mesh', style: 2, ortho: true, ringTol: 0.9, opts: { contourTol: 0.9, openMin: 90 }, fit: { minArea: 20, weld: 1.2, tol: 0.5 }, wall: 0xe7dcc4, roof: 0x6f9486, dome: 0x6f9486,
    note: 'neo-baroque university palace: long pale facade, central pediment block with a low dome' },
  { slug: 'theatre', name: 'Nacionālais teātris', ids: [49614719], source: 'mesh', style: 2, wall: 0xe8d8b8, roof: 0x6f9486,
    note: 'neo-baroque theatre on the canal, pale yellow, green roof' },
  { slug: 'station', name: 'Centrālā stacija', ids: [49615281, 49614666], source: 'mesh', style: 3, wall: 0xcfc9bd, roof: 0xaeb8b0,
    note: 'five barrel-vault train halls and the station building' },
  { slug: 'market', name: 'Centrāltirgus paviljoni', ids: [49614728, 49614778, 49615303, 49615403], barrel: true, source: 'mesh', style: 3, wall: 0xd9d2c0, roof: 0xaebbb2,
    note: 'former zeppelin hangars: long barrel-vault pavilions in a row' },
  { slug: 'academy', name: 'Zinātņu akadēmija', ids: [49628422], source: 'auto', style: 2, wall: 0xc9bca6, roof: 0x707070,
    note: 'Stalinist skyscraper with stepped tower and a spire topped by a star, 108 m' },
  { slug: 'hotel', name: 'Radisson Blu Latvija', ids: [49619752], source: 'auto', style: 0, wall: 0xc7c3bb, roof: 0x707070,
    note: '1970s concrete slab hotel tower' },
  { slug: 'saeima', name: 'Saeima', ids: [49614901], source: 'mesh', style: 2, ortho: true, ringTol: 0.7, wall: 0xd8c9a8, roof: 0x8c4632,
    note: 'baroque palace with red roofs and a small tower' },
  { slug: 'library', name: 'Latvijas Nacionālā bibliotēka', ids: [49629679], source: 'mesh', style: 4, wall: 0xb6c8d6, roof: 0xa9bccb, dome: 0xa9bccb,
    note: 'Gaismas pils: asymmetric glass mountain, a long ridge rising to a sharp ~68 m peak at one end' },
  // --- map extension (left bank of the Daugava)
  { slug: 'saulesakmens', name: 'Saules akmens', ids: [49639844], source: 'mesh', style: 4, wall: 0xb4c6d4, roof: 0x9db0be,
    note: 'tall slim glass office tower on Pārdaugava, ~123 m (Balasta dambis 15; the 78 m neighbour 49639106 is Preses nams)' },
  { slug: 'presesnams', name: 'Preses nams', ids: [49639106], source: 'mesh', style: 0, wall: 0xb9b3a6, roof: 0x8f8f8f,
    note: 'Soviet-era press house, ~66-78 m (landmark Preses nams)' },
  { slug: 'ztowers', name: 'Z-Towers', ids: [49637749], source: 'mesh', style: 4, wall: 0xaebfcc, roof: 0x93a6b4,
    note: 'two glass towers (~123 m / 90 m) on a podium on Ķīpsala' },
  // --- districts (map: slug; ids are cadastre ids of public/data/<slug>/riga.json)
  { map: 'agenskalns', slug: 'ag-market', name: 'Āgenskalna tirgus', ids: [49634808], source: 'mesh', style: 2, wall: 0xd9c9a4, roof: 0xa8503a,
    note: 'brick market hall with a tall pitched roof' },
  { map: 'agenskalns', slug: 'ag-baptist', name: 'Āgenskalna baptistu baznīca', ids: [49635717], source: 'mesh', style: 1, wall: 0xd8cdb2, roof: 0x7a808a, note: 'church' },
  { map: 'agenskalns', slug: 'ag-albert', name: 'Svētā Alberta baznīca', ids: [49635756], source: 'mesh', style: 1, wall: 0xc9bca6, roof: 0x7a808a, note: 'church' },
  { map: 'agenskalns', slug: 'ag-wooden', name: 'Koka nami (Kalnciema iela)', ids: [49636186], source: 'mesh', style: 0, note: 'wooden-house quarter sample' },
  { map: 'mezaparks', slug: 'estrade', name: 'Lielā estrāde', ids: [49673065, 49673070], source: 'mesh', style: 3, wall: 0xcfcac0, roof: 0x9aa0a4, dome: 0x9aa0a4,
    note: 'the big song-festival stage: a long concrete shell over the stage with a tiered seating bowl in front' },
  { map: 'mezaparks', slug: 'mz-church', name: 'Mežaparka baznīca', ids: [49665685], source: 'mesh', style: 1, note: 'small wooden church' },
  { map: 'mezaparks', slug: 'mz-wasa', name: "Villa 'Wasa'", ids: [49665210], source: 'mesh', style: 0, note: 'garden-city villa' },
  { map: 'mezaparks', slug: 'mz-tropu', name: 'Rīgas zoo Tropu māja', ids: [49672040], source: 'mesh', style: 3, note: 'zoo tropical house' },
  { map: 'purvciems', slug: 'pv-slab-1', name: 'Plātņu nams (34 m)', ids: [49645710, 49646937, 49648832], source: 'mesh', style: 0, note: 'row of 9-12 floor slabs' },
  { map: 'purvciems', slug: 'pv-slab-2', name: 'Plātņu nams (30 m)', ids: [49644482, 49644483], source: 'mesh', style: 0, note: '9 floor slabs' },
  { map: 'purvciems', slug: 'pv-church', name: 'Labā Vēsts', ids: [49645108], source: 'mesh', style: 3, note: 'church / congregation hall' },
];

/** 6 fixed ordinary shaped blocks for before/after comparisons (seeded pick from the notable + relief set) */
export const BLOCK_IDS = [49615326, 49615322, 49615688, 49618849, 49622179, 49613620];

export const heroById = new Map();
for (const h of HEROES) for (const id of h.ids) heroById.set(id, h);
/** extra review blocks per district (typical ordinary buildings) */
export const DISTRICT_BLOCKS = { agenskalns: [49636753, 49636792, 49613072], mezaparks: [], purvciems: [49644473, 49643947, 49644283] };
