// Map (district) definitions. ONE shared projection for every map (origin = Freedom Monument, x east, z south), so that the
// centre-specific code keyed to local coordinates (Old Town zone, themes' anchors, landmark rules) stays geographically right
// and a district is just another bounds rectangle in the same frame. Imported by the build tools AND by the browser (src/maps.js).
//   slug      url / folder name; 'centrs' keeps the legacy paths (public/data/riga.json ...)
//   bounds    local metres (minX, maxX, minZ, maxZ)
//   focus     [lat, lon, label] a well-known landmark in the middle of the map (start camera, thumbnails, notes)
//   mult      per-map balance multipliers (props: prop/mover density, value: building value divisor scale, trees: tree budget,
//             people: extra pedestrians (small food at the spawn), bots: bot difficulty scale,
//             botSpeed: bot speed cap (default 1.04; the sparse forest map needs faster bots to keep up with a perfect player),
//             botGain: growth-handicap scale per difficulty ({ easy, normal, hard } or a number; calibrated with scripts/balance-diff.mjs so the best bot holds the same share of a casual player's score on every map)). Tuned with `MAP=<slug> node scripts/balance.mjs`: a 5:00 round should pace like the centre
//             (greedy final radius ~120-160 m, best bot 50-75 % of greedy, >= 80 edible objects within 60 m of every player spawn).
export const ORIGIN = { lat: 56.9515, lon: 24.1133 };
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
export const toLocal = (lat, lon) => [Math.round((lon - ORIGIN.lon) * M_LON), Math.round(-(lat - ORIGIN.lat) * M_LAT)];
const around = ([lat, lon], hx, hz) => { const [x, z] = toLocal(lat, lon); return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz }; };

export const MAPS = [
  {
    slug: 'centrs', lv: 'Centrs', en: 'Centre', focus: [56.9515, 24.1133, 'Brīvības piemineklis'],
    bounds: { minX: -2100, maxX: 1200, minZ: -1200, maxZ: 1500 }, mult: { props: 1, value: 1, trees: 1 },
    notes: 'Old Town, boulevard ring, Central Market, Daugava with its three bridges and the left bank (Library, Ķīpsala).',
  },
  {
    slug: 'agenskalns', lv: 'Āgenskalns', en: 'Āgenskalns', focus: [56.9357, 24.0710, 'Āgenskalna tirgus'],
    bounds: around([56.9357, 24.0710], 1300, 1300), mult: { props: 1.3, value: 0.34, trees: 1, people: 1.25, botGain: { easy: 0.93, normal: 0.89 } },
    notes: 'Wooden-house quarter west of the Daugava: Āgenskalna tirgus, Kalnciema kvartāls, Māras dīķis, Torņakalns edge, Uzvaras parks.',
  },
  {
    slug: 'mezaparks', lv: 'Mežaparks', en: 'Mežaparks', focus: [57.0040, 24.1540, 'Mežaparks'],
    bounds: around([57.0040, 24.1540], 1300, 1300), mult: { props: 1.7, value: 0.14, trees: 2.0, bots: 2.0, botSpeed: 1.1, people: 1.25, botGain: { easy: 0.9, normal: 0.95 } },
    notes: 'Garden city of villas in pine forest, Lielā estrāde, Rīgas zoo edge, Ķīšezers shore.',
  },
  {
    slug: 'purvciems', lv: 'Purvciems', en: 'Purvciems', focus: [56.9579, 24.1872, 'Arcada Purvciems'],
    bounds: around([56.9579, 24.1872], 1300, 1300), mult: { props: 2.6, value: 0.36, trees: 1, people: 1.3, botGain: { easy: 0.92, normal: 0.9 } },
    notes: 'Soviet-era panel-block estate (5/9/12/16 floors): big slabs, courtyards, wide streets.',
  },
];
/** Allow-list of map slugs shared by the client, the build tools and the Worker (POST /api/rounds, /api/scores, GET /api/scores). */
export const MAP_SLUGS = MAPS.map((m) => m.slug);
export const DEFAULT_MAP = 'centrs';
export const isMapSlug = (s) => typeof s === 'string' && MAP_SLUGS.includes(s);
export const mapBySlug = (s) => MAPS.find((m) => m.slug === s) || MAPS[0];
/** URLs of a map's files (the centre keeps the legacy flat paths). */
export function mapPaths(slug) {
  const d = slug === 'centrs' ? '/data/' : `/data/${slug}/`;
  return { data: d + 'riga.json', shapes: d + 'riga-shapes.bin.gz', ground: d + 'riga-ground.png', objects: d + 'riga-objects.bin.gz', thumb: d + 'thumb.png', areas: '/data/riga-areas.json' };
}

/** Per-map shapes file URL (convention for the shapes agent: public/data/<slug>/riga-shapes.bin.gz; the centre keeps the flat path). */
export const shapesUrlFor = (slug) => mapPaths(slug).shapes;
