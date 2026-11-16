// Every religious building of the four maps (audit: tools/detail/audit-churches.md) and the curated church treatments.
//   CHURCH_LIST   all religious buildings, for the audit and the review shots (scripts/church-shots.mjs): { map, slug, name, ids }
//   CHURCH_HEROES hero entries (same schema as heroes.mjs) with a `church:` option consumed by build-meshes.mjs -> curated-churches.mjs
// heroes.mjs merges CHURCH_HEROES (replacing earlier entries with the same slug).
export const CHURCH_LIST = [
  // --- centre
  { slug: 'stpeter', name: 'Svētā Pētera baznīca', ids: [49614351] },
  { slug: 'dome', name: 'Rīgas Doms', ids: [49614755] },
  { slug: 'stjacob', name: 'Svētā Jēkaba katedrāle', ids: [49614946] },
  { slug: 'stjohn', name: 'Svētā Jāņa baznīca', ids: [49614438] },
  { slug: 'magdalene', name: 'Svētās Marijas Magdalēnas baznīca', ids: [49615201] },
  { slug: 'reformed', name: 'Reformātu baznīca', ids: [49614561] },
  { slug: 'anglican', name: 'Anglikāņu baznīca', ids: [49614911] },
  { slug: 'sorrows', name: 'Sāpju Dievmātes baznīca', ids: [49615077] },
  { slug: 'peterpaul', name: 'Svētā Pētera un Pāvila baznīca', ids: [49614698] },
  { slug: 'vilande', name: 'Baptistu Vīlandes draudze', ids: [49614999] },
  { slug: 'synagogue', name: 'Peitavas sinagoga', ids: [49614645] },
  { slug: 'nativity', name: 'Kristus Piedzimšanas pareizticīgo katedrāle', ids: [49615771] },
  { slug: 'nevsky', name: 'Svētā Aleksandra Ņevska pareizticīgo baznīca', ids: [49619857, 49619931] },
  { slug: 'oldgertrude', name: 'Vecā Ģertrūdes baznīca', ids: [49619142] },
  { slug: 'jesus', name: 'Jēzus baznīca', ids: [49628050] },
  { slug: 'annunciation', name: 'Vissvētās Dievmātes pasludināšanas baznīca', ids: [49627799] },
  { slug: 'habad', name: 'Ebreju draudze Habad Ļubavič', ids: [49627789] },
  { slug: 'lds', name: 'Pēdējo Dienu Svēto baznīca', ids: [49622396] },
  { slug: 'methodist', name: 'Apvienotā metodistu baznīca', ids: [49620098] },
  { slug: 'baptistunion', name: 'Baptistu savienības nams (Lāčplēša 37)', ids: [49622206] },
  { slug: 'krishna', name: 'Hare Krišnas centrs', ids: [49622020] },
  { slug: 'adventist', name: 'Septītās dienas adventistu baznīca', ids: [49619726] },
  { slug: 'salvation', name: 'Pestīšanas armija', ids: [49620030] },
  { slug: 'atklasme', name: 'Atklāsme', ids: [49628191] },
  { slug: 'enkura', name: 'Enkura iela 9', ids: [49639713] },
  { slug: 'alksnaja', name: 'Alksnāja iela 3', ids: [49614623] },
  { slug: 'klostera4', name: 'Klostera iela 4', ids: [49615014, 49616572] },
  { slug: 'mazapils4', name: 'Mazā Pils iela 4', ids: [49615243] },
  { slug: 'janasetas7', name: 'Jāņa sēta 7', ids: [49614454] },
  { slug: 'brunin43', name: 'Bruņinieku iela 43', ids: [49623839] },
  { slug: 'trijadiba', name: 'Svētās Trijādības pareizticīgo baznīca', ids: [49636436] },
  // --- Āgenskalns
  { map: 'agenskalns', slug: 'ag-baptist', name: 'Āgenskalna baptistu baznīca', ids: [49635717] },
  { map: 'agenskalns', slug: 'ag-albert', name: 'Svētā Alberta baznīca', ids: [49635756] },
  { map: 'agenskalns', slug: 'ag-nometnu', name: 'Nometņu iela 31', ids: [49638180] },
  { map: 'agenskalns', slug: 'ag-terese', name: 'Svētās Terēzes baznīca', ids: [49631730, 49632133] },
  { map: 'agenskalns', slug: 'ag-methodist', name: 'Apvienotā metodistu baznīca (Āgenskalns)', ids: [49637556] },
  { map: 'agenskalns', slug: 'ag-trijadiba', name: 'Svētās Trijādības pareizticīgo baznīca', ids: [49636436] },
  { map: 'agenskalns', slug: 'ag-luter', name: 'Lutera draudzes nams', ids: [49632390] },
  { map: 'agenskalns', slug: 'ag-tornakalns', name: 'Torņakalna baznīca', ids: [49632471] },
  // --- Mežaparks
  { map: 'mezaparks', slug: 'mz-church', name: 'Mežaparka baznīca', ids: [49665685] },
  { map: 'mezaparks', slug: 'mz-orth', name: 'Kunga Apskaidrošanās pareizticīgo baznīca', ids: [49666459] },
  { map: 'mezaparks', slug: 'mz-kristus', name: 'Kristus Karaļa katoļu draudze', ids: [49668667] },
  { map: 'mezaparks', slug: 'mz-meza11', name: 'Meža prospekts 11A', ids: [49668655] },
  { map: 'mezaparks', slug: 'mz-nesaules', name: 'Nesaules iela 7', ids: [49668590] },
  // --- Purvciems
  { map: 'purvciems', slug: 'pv-lugsanu', name: 'Lūgšanu nams', ids: [49667084] },
  { map: 'purvciems', slug: 'pv-trisvienibas', name: 'Svētās Trīsvienības katoļu baznīca', ids: [49646403] },
  { map: 'purvciems', slug: 'pv-church', name: 'Labā Vēsts', ids: [49645108] },
  { map: 'purvciems', slug: 'pv-jehova', name: 'Jehovas liecinieku valstības zāle', ids: [49646794] },
  { map: 'purvciems', slug: 'pv-jaunapust', name: 'Jaunapustuliskā baznīca', ids: [49645566] },
];

// treatment table: slug -> { style, wall, roof, dome, kit (church-kit options; omit = plane-fitted mesh), note }.  Ids / names come from CHURCH_LIST (first id only for the kit).
//   style 6 gothic brick | 7 plastered baroque / classicist (round-arched tall windows) | 8 wooden | 9 Orthodox | 1 church (old) | 3 plain
const GREY = 0x7a808a, GREEN = 0x6a8a7c, TILE = 0x9c4a35;
export const TREAT = {
  stpeter: { style: 6, wall: 0xc9b9a0, roof: 0x74797f, dome: GREEN, kit: { helm: [[0.02, 0.95], [0.12, 0.62], [0.16, 0.78], [0.2, 0.74], [0.3, 0.46], [0.34, 0.56], [0.4, 0.3], [0.55, 0.22], [0.8, 0.12]] }, note: 'brick gothic hall church, 123 m three-tier baroque copper steeple (square shaft, galleries, lantern)' },
  dome: { style: 7, wall: 0xcdb38c, roof: 0xb0553b, dome: GREEN, kit: { helm: [[0.03, 1.1], [0.1, 0.9], [0.22, 0.95], [0.34, 0.78], [0.42, 0.5], [0.5, 0.34], [0.56, 0.36], [0.66, 0.24], [0.8, 0.13]] }, note: 'Dome cathedral: long nave under a steep red-tile roof, west tower with baroque copper cupola, polygonal apse, cloister wing' },
  stjacob: { style: 6, wall: 0xd8c8a0, roof: 0x7a808a, dome: GREEN, kit: {}, note: 'Catholic cathedral: yellowish stucco, slim gothic needle spire, steep nave roof' },
  stjohn: { style: 6, wall: 0xc9a79a, roof: 0x8c4632, dome: GREEN, kit: {}, note: 'small gothic brick church squeezed in a block' },
  magdalene: { style: 7, wall: 0xe0cf9a, roof: 0x7d838c, dome: GREEN, kit: {}, note: 'Catholic church with a west tower' },
  reformed: { style: 7, wall: 0xe8dfc8, roof: 0x7a8a82, dome: GREEN, kit: {}, note: 'classicist church, cream walls, west tower with spire' },
  anglican: { style: 6, wall: 0xb3583f, roof: 0x7d838c, dome: GREEN, kit: {}, note: 'neo-gothic red-brick church with a tall slim tower' },
  sorrows: { style: 7, wall: 0xe3d3a0, roof: TILE, dome: GREEN, kit: {}, note: 'baroque Catholic church' },
  peterpaul: { style: 6, wall: 0xb4573e, roof: 0x6f747c, dome: GREEN, kit: {}, note: 'neo-gothic brick church with a spire' },
  vilande: { style: 7, wall: 0xd8cba8, roof: GREY, dome: GREY, kit: {}, note: 'Baptist church, plain plastered hall' },
  synagogue: { style: 7, wall: 0xe6dcb8, roof: GREY, dome: GREY, kit: {}, note: 'Peitav-Shul synagogue, pale plastered hall' },
  nevsky: { style: 9, wall: 0xe0d2b4, roof: 0x5f7a6c, dome: 0x49705f, kit: { towerMargin: 2.5, crosses: true }, note: 'Orthodox church with a dome and bell tower' },
  oldgertrude: { style: 6, wall: 0xb0553b, roof: 0x7a808a, dome: 0x6b747e, kit: {}, note: 'red-brick neo-gothic church, one tall slim spire' },
  jesus: { style: 8, wall: 0xd9d0a6, roof: 0x6e7f78, dome: 0x6e7f78, kit: {}, note: 'large octagonal wooden hall church, painted pale, steep octagonal roof with a lantern' },
  annunciation: { style: 7, wall: 0xe0c4a8, roof: GREY, dome: GREEN, kit: {}, note: 'church with a tower' },
  habad: { style: 7, wall: 0xe5d29a, roof: TILE, dome: TILE, note: 'Chabad house / synagogue, yellow plaster, hipped roof' },
  lds: { style: 7, wall: 0xcdb999, roof: 0x7a6e66, dome: GREY, kit: {}, note: 'LDS chapel' },
  methodist: { style: 7, wall: 0xd8caa8, roof: GREY, dome: GREY, kit: {}, note: 'Methodist church' },
  baptistunion: { style: 6, wall: 0xc7ba9a, roof: 0x6f747c, dome: GREY, kit: {}, note: 'Baptist Union chapel, grey stone' },
  krishna: { style: 7, wall: 0xe3c7a0, roof: TILE, dome: TILE, note: 'Hare Krishna centre' },
  adventist: { style: 7, wall: 0xd9cdb0, roof: 0x6f8f80, dome: GREEN, note: 'adventist church within a block' },
  salvation: { style: 3, wall: 0xb9a48f, roof: 0x8a6f5c, dome: 0x8a6f5c, note: 'Salvation Army temple, brown plaster' },
  atklasme: { style: 7, wall: 0xd7cdb4, roof: GREY, dome: GREY, note: 'congregation hall' },
  trijadiba: { style: 6, wall: 0xb0553b, roof: 0x7a808a, dome: 0x6b747e, kit: {}, note: 'red-brick neo-gothic church with a tall spire (Pārdaugava)' },
  'ag-baptist': { style: 7, wall: 0xd8cdb2, roof: GREY, dome: GREY, kit: {}, note: 'Baptist church with a tower' },
  'ag-albert': { style: 6, wall: 0xb9ad9a, roof: GREY, dome: GREY, kit: {}, note: 'St Albert: neo-gothic stone church with tall tower' },
  'ag-terese': { style: 7, wall: 0xe0d6b8, roof: GREY, dome: GREY, kit: {}, note: 'small Catholic church' },
  'ag-methodist': { style: 7, wall: 0xd8caa8, roof: GREY, dome: GREY, kit: {}, note: 'Methodist church' },
  'ag-luter': { style: 7, wall: 0xd7cba9, roof: GREY, dome: GREY, note: 'parish hall' },
  'ag-tornakalns': { style: 6, wall: 0xa9553f, roof: 0x4f5a64, dome: 0x4f5a64, kit: {}, note: 'Torņakalns: red-brick neo-gothic church, slim tower with a tall spire' },
  // no height grid (outside the reality mesh): the kit runs on a grid synthesised from the footprint (curated-churches.mjs synthChurchGrid)
  'mz-orth': { style: 9, wall: 0xe3d8bd, roof: 0x5f7a6c, dome: 0xe3b53c, kit: { crosses: true, towerMargin: 2, synth: { eave: 5.5, rise: 2.8, dome: { top: 17, r: 3.4 } } }, note: 'Orthodox church with a gilded central onion dome' },
  'mz-kristus': { style: 7, wall: 0xe0d6b8, roof: 0x6f7a74, dome: 0x6f7a74, kit: { synth: { eave: 7, rise: 4, tower: { top: 25, side: 2.4, end: 1, kind: 'pyramid', shaft: 15 } } }, note: 'Catholic church with a west tower and pyramid spire' },
  'mz-meza11': { style: 8, wall: 0xc9b58a, roof: 0x6a5a4c, dome: 0x6a5a4c, kit: { synth: { eave: 4.5, rise: 2.5 } }, note: 'small timber chapel' },
  'pv-trisvienibas': { style: 7, wall: 0xd8d2c4, roof: 0x6f8f80, dome: 0x6f8f80, kit: { synth: { eave: 8, rise: 3, tower: { top: 25, side: 2.2, end: -1, kind: 'pyramid', shaft: 16 } } }, note: 'Catholic church with a slim tower' },
  'pv-jaunapust': { style: 7, wall: 0xd5cdbb, roof: 0x777a7e, dome: 0x777a7e, kit: { synth: { eave: 6, rise: 3, tower: { top: 18, side: 1.8, end: 1, kind: 'pyramid', shaft: 11 } } }, note: 'New Apostolic church with a small tower' },
  'pv-jehova': { style: 7, wall: 0xd9d2c0, roof: 0x7a7d80, dome: 0x7a7d80, kit: { synth: { eave: 5, rise: 2 } }, note: 'Kingdom hall' },
  'pv-church': { style: 3, wall: 0xcfc8b6, roof: 0x80736a, dome: 0x80736a, kit: { synth: { eave: 7, rise: 2 } }, note: 'Labā Vēsts: large congregation hall' },
  'mz-church': { style: 8, wall: 0xc9b58a, roof: 0x6a5a4c, dome: 0x6a5a4c, kit: {}, note: 'small wooden church' },
};

export const CHURCH_HEROES = Object.entries(TREAT).map(([slug, t]) => {
  const c = CHURCH_LIST.find((x) => x.slug === slug);
  return { map: c.map, slug, name: c.name, ids: [c.ids[0]], source: 'mesh', style: t.style, wall: t.wall, roof: t.roof, dome: t.dome, church: t.kit, crosses: !!(t.kit && t.kit.crosses), note: t.note };
}).map((h) => { if (!h.map) delete h.map; if (!h.church) delete h.church; return h; });

/** merge into the hero list: entries with an existing slug replace it, new ones are appended (before the civic merge result is used by heroById) */
export function mergeChurches(list) {
  for (const c of CHURCH_HEROES) { const i = list.findIndex((h) => h.slug === c.slug); if (i >= 0) list[i] = c; else list.push(c); }
  return list;
}
