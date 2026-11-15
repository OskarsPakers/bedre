// "Rīgas objekti": collectible list of the map's notable things. Auto-generated from the loaded world (named landmarks, OSM-named
// buildings, hero props), so it adapts when the map data changes. Curated order + one-line facts (LV/EN) for the known hero objects.
import { load, save } from './store.js';
import { lname, mt } from './strings.js';
import { getLang } from '../i18n.js';

const nm = (re) => (o) => !!o.name && re.test(o.name);
const kind = (k) => (o) => o.kind === k;
// id, names, type (icon), matcher, facts. Order = album order.
const RULES = [
  ['freedom', 'Brīvības piemineklis', 'Freedom Monument', 'monument', kind('freedom'), 'Celts 1935. gadā par ziedotu naudu; Milda tur trīs zvaigznes.', 'Unveiled in 1935, paid for by donations; Milda holds up three stars.'],
  ['peter', 'Svētā Pētera baznīca', "St Peter's Church", 'church', nm(/^Svētā Pētera baznīca/), 'Tornis ap 123 m augsts, augšā var uzbraukt ar liftu.', 'A spire of about 123 m; a lift takes you to the viewing platform.'],
  ['dome', 'Rīgas Doms', 'Riga Cathedral', 'church', nm(/^Rīgas Doms$/), 'Lielākā viduslaiku baznīca Baltijā, dibināta 1211. gadā.', 'The largest medieval church in the Baltics, founded in 1211.'],
  ['nativity', 'Kristus Piedzimšanas katedrāle', 'Nativity Cathedral', 'dome', nm(/Piedzimšanas/), 'Zelta kupoli un 1876.-1883. gadā celta pareizticīgo katedrāle.', 'Gold domes on the Orthodox cathedral built in 1876-1883.'],
  ['opera', 'Nacionālā opera', 'National Opera', 'opera', nm(/^Nacionālā opera/), 'Operas nams pie kanāla; pašreizējā ēka no 1887. gada.', 'The opera house by the canal; the present building dates from 1887.'],
  ['castle', 'Rīgas pils', 'Riga Castle', 'castle', nm(/^Rīgas pils/), 'Pamati likti 1330. gadā; tagad Valsts prezidenta rezidence.', 'Founded in 1330; today the residence of the President.'],
  ['powder', 'Pulvertornis', 'Powder Tower', 'tower', nm(/^Pulvertornis/), 'Vecpilsētas mūra tornis, kurā mīt Kara muzejs.', 'A tower of the old city wall that houses the War Museum.'],
  ['blackheads', 'Melngalvju nams', 'House of the Blackheads', 'gable', nm(/Melngalvju/), 'Pēc kara sagrauts, atjaunots 1999. gadā.', 'Destroyed in the war, rebuilt in 1999.'],
  ['cat', 'Kaķu nams', 'Cat House', 'cat', nm(/^Kaķu nams/), 'Melnie kaķi uz torņiem ir pagriezti ar asti pret Lielo ģildi.', 'The black cats on the turrets famously face their tails at the Great Guild.'],
  ['market', 'Centrāltirgus paviljoni', 'Central Market pavilions', 'market', (o) => o.kind === 'vault' || (!!o.name && /paviljons/i.test(o.name)), 'Pieci bijušie cepelīnu angāri - viens no Eiropas lielākajiem tirgiem.', 'Five former zeppelin hangars - one of the biggest markets in Europe.'],
  ['academy', 'Zinātņu akadēmija', 'Academy of Sciences', 'skyscraper', nm(/Zinātņu akadēmija/), 'Iesauka "Staļina torte"; 17. stāvā ir skatu laukums.', 'Nicknamed "Stalin\'s birthday cake"; a viewing deck sits on the 17th floor.'],
  ['library', 'Nacionālā bibliotēka', 'National Library', 'skyscraper', nm(/Nacionālā bibliotēka|Gaismas pils/), 'Gaismas pils, atvērta 2014. gadā.', 'The "Castle of Light", opened in 2014.'],
  ['laima', 'Laimas pulkstenis', 'Laima Clock', 'clock', kind('laima'), 'Satikšanās vieta kopš 1924. gada.', 'Riga\'s favourite meeting spot since 1924.'],
  ['pylon', 'Vanšu tilta pilons', 'Cable-stayed bridge pylon', 'pylon', kind('pylon'), 'Troses notur tiltu pāri Daugavai.', 'Steel cables carry the bridge across the Daugava.'],
  ['railarch', 'Dzelzceļa tilta loks', 'Railway-bridge arch', 'arch', kind('railarch'), 'Dzelzceļa tilts pāri Daugavai.', 'The railway bridge over the Daugava.'],
  ['brothers', 'Trīs brāļi', 'Three Brothers', 'gable', nm(/^(Trīs brāļi|Jaunākais brālis|Vidējais brālis|Vecākais brālis)/), 'Vecākie dzīvojamie nami Rīgā, 15.-17. gadsimts.', 'The oldest residential houses in Riga, 15th-17th century.'],
  ['jekab', 'Svētā Jēkaba katedrāle', "St James's Cathedral", 'church', nm(/Jēkaba katedrāle/), 'Katoļu katedrāle ar Latvijas augstāko zvanu.', 'The Catholic cathedral of Latvia.'],
  ['jani', 'Svētā Jāņa baznīca', "St John's Church", 'church', nm(/^Svētā Jāņa baznīca/), 'Sienā iemūrēti divi dzīvi cilvēki - tā vēsta leģenda.', 'Legend says two living monks were walled into its wall.'],
  ['swedish', 'Zviedru vārti', 'Swedish Gate', 'arch', nm(/^Zviedru vārti/), 'Vienīgie saglabājušies Vecrīgas vārti no 1698. gada.', 'The only surviving gate of the Old Town wall, from 1698.'],
  ['ratsnams', 'Rīgas Rātsnams', 'Riga City Hall', 'building', nm(/Rātsnams/), 'Pilsētas valdes nams Rātslaukumā.', 'The city council seat on Town Hall Square.'],
  ['theatre', 'Nacionālais teātris', 'National Theatre', 'building', nm(/Nacionālais teātris/), 'Šeit 1918. gada 18. novembrī pasludināta Latvijas valsts.', 'Latvia was proclaimed here on 18 November 1918.'],
  ['dailes', 'Dailes teātris', 'Daile Theatre', 'building', nm(/Dailes teātris/), 'Moderns teātris Brīvības ielā.', 'A modern theatre on Brīvības iela.'],
  ['art', 'Mākslas akadēmija', 'Academy of Art', 'building', nm(/Mākslas akadēmija/), 'Studentu darbi stāv uz katra stūra.', 'Student sculptures turn up on every corner.'],
  ['radio', 'Latvijas Radio', 'Latvian Radio', 'building', nm(/^Latvijas Radio$/), 'Šeit skan arī Latvijas Radio 2.', 'Home of the stations including Latvijas Radio 2.'],
  ['circus', 'Rīgas cirks', 'Riga Circus', 'market', nm(/Rīgas cirks/), 'Viena no vecākajām cirka ēkām Eiropā (1889).', 'One of the oldest circus buildings in Europe (1889).'],
  ['splendid', 'Splendid Palace', 'Splendid Palace', 'building', nm(/Splendid Palace/), 'Kinoteātris no 1923. gada.', 'A cinema since 1923.'],
  ['lbn', 'Latviešu biedrības nams', 'Latvian Society House', 'building', nm(/Latviešu biedrības nams/), '19. gadsimta latviešu kultūras centrs.', 'A 19th-century hub of Latvian culture.'],
  ['guilds', 'Lielā un Mazā Ģilde', 'Great and Small Guild', 'gable', nm(/(Lielā|Mazā) Ģilde/), 'Tirgotāju un amatnieku ģildes.', 'The guild halls of merchants and craftsmen.'],
  ['univlib', 'LU Akadēmiskā bibliotēka', 'University Library', 'building', nm(/Akadēmiskā bibliotēka|LU bibliotēka/), '', ''],
  ['spikeri', 'Spīķeri', 'Spīķeri', 'market', nm(/Spiķeru|Spīķer/), '', ''],
  ['radisson', 'Radisson Blu Latvija', 'Radisson Blu', 'skyscraper', nm(/^Radisson Blu$/), '', ''],
  ['tram', 'Tramvajs', 'Tram', 'tram', kind('tram'), 'Rīgas tramvajs brauc kopš 1882. gada.', 'Trams have run in Riga since 1882.'],
  ['ferry', 'Prāmis', 'Ferry', 'ferry', kind('ferry'), 'Daugavas prāmji vēl joprojām kursē.', 'Ferries still cross the Daugava.'],
];
const AUTO_RE = /baznīca|katedrāle|tornis|vārti|piemineklis|nams\b|teātr|muzej|bibliotēk|pils\b|sinagoga|akadēmija|koncertzāle|villa|skola|tirgus|tirdzniecības|korpuss|kvartāls|estrāde|zoo|māja\b|arena|centrs\b|draudze|klubs|ratas|rats\b/i; // (iteration 6: district maps list schools, villas, markets, ...)
const MAX = 40;

export function buildAlbum(world) {
  const entries = [], byObj = new Map();
  const objs = world.objects;
  const used = new Set();
  const pos = (list) => { let b = list[0]; for (const o of list) if (o.fit > b.fit) b = o; return b; };
  const add = (e, list) => {
    e.objs = list.map((o) => o.id);
    const p = pos(list); e.x = p.x; e.z = p.z;
    e.idx = entries.length;
    entries.push(e);
    for (const o of list) { byObj.set(o.id, e); used.add(o.id); }
  };
  for (const [id, lv, en, type, fn, fl, fe] of RULES) {
    const list = objs.filter((o) => !used.has(o.id) && fn(o));
    if (!list.length) continue;
    add({ id, lv, en, type, factLv: fl, factEn: fe, curated: true }, list);
  }
  // auto: remaining landmarks / named notable buildings (grouped by name), biggest first
  const groups = new Map();
  for (const o of objs) {
    if (used.has(o.id) || !o.name || !(o.landmark || (o.isBuilding && AUTO_RE.test(o.name) && !/\d/.test(o.name)))) continue;
    if (!AUTO_RE.test(o.name)) continue;
    (groups.get(o.name) || groups.set(o.name, []).get(o.name)).push(o);
  }
  const auto = [...groups.entries()].sort((a, b) => Math.max(...b[1].map((o) => o.value)) - Math.max(...a[1].map((o) => o.value)));
  for (const [name, list] of auto) {
    if (entries.length >= MAX) break;
    const type = /baznīca|katedrāle|Doms/.test(name) ? 'church' : /tornis|vārti/.test(name) ? 'tower' : /piemineklis/.test(name) ? 'monument' : 'building';
    add({ id: 'o-' + name.toLowerCase().replace(/[^a-z0-9āčēģīķļņšūž]+/g, '-'), lv: name, en: name, type, factLv: '', factEn: '', curated: false }, list);
  }
  return { entries, byObj };
}

export const isCollected = (e) => !!load().album[e.id];
export const collectedCount = (album) => album.entries.filter(isCollected).length;

/** Collect an entry (first time only). Returns true when new. */
export function collect(album, e, round) {
  const st = load();
  if (st.album[e.id]) return false;
  st.album[e.id] = { d: new Date().toISOString().slice(0, 10), r: round || 0 };
  save();
  return true;
}

// ---- icons: tiny generated silhouettes ------------------------------------------------------------------------------
const ICONS = {
  monument(g) { g.fillRect(24, 40, 16, 4); g.fillRect(27, 33, 10, 7); g.fillRect(30, 8, 4, 25); g.beginPath(); g.arc(32, 8, 3, 0, 7); g.fill(); g.fillRect(22, 5, 20, 2); },
  church(g) { g.fillRect(8, 28, 32, 16); g.fillRect(40, 20, 8, 24); g.beginPath(); g.moveTo(40, 20); g.lineTo(44, 3); g.lineTo(48, 20); g.fill(); g.beginPath(); g.moveTo(8, 28); g.lineTo(24, 18); g.lineTo(40, 28); g.fill(); },
  dome(g) { g.fillRect(10, 30, 44, 14); for (const [x, r] of [[32, 8], [18, 5], [46, 5]]) { g.beginPath(); g.arc(x, 30 - r * 0.6, r, Math.PI, 0); g.lineTo(x, 30 - r * 2.3); g.fill(); g.fillRect(x - r * 0.7, 28, r * 1.4, 3); } },
  opera(g) { g.fillRect(10, 36, 44, 8); g.fillRect(14, 20, 36, 16); g.beginPath(); g.moveTo(10, 22); g.lineTo(32, 8); g.lineTo(54, 22); g.fill(); },
  castle(g) { g.fillRect(8, 24, 48, 20); for (const x of [8, 44]) { g.fillRect(x, 10, 12, 34); g.beginPath(); g.moveTo(x - 1, 10); g.lineTo(x + 6, 2); g.lineTo(x + 13, 10); g.fill(); } },
  tower(g) { g.fillRect(20, 14, 24, 30); g.beginPath(); g.moveTo(17, 14); g.lineTo(32, 2); g.lineTo(47, 14); g.fill(); },
  gable(g) { g.fillRect(14, 20, 36, 24); g.beginPath(); g.moveTo(14, 20); g.lineTo(20, 14); g.lineTo(20, 10); g.lineTo(26, 10); g.lineTo(26, 6); g.lineTo(32, 6); g.lineTo(32, 4); g.lineTo(38, 6); g.lineTo(38, 10); g.lineTo(44, 10); g.lineTo(44, 14); g.lineTo(50, 20); g.fill(); },
  cat(g) { g.fillRect(14, 22, 36, 22); g.fillRect(16, 12, 7, 11); g.fillRect(41, 12, 7, 11); for (const x of [19.5, 44.5]) { g.beginPath(); g.moveTo(x - 4, 12); g.lineTo(x, 2); g.lineTo(x + 4, 12); g.fill(); g.beginPath(); g.arc(x, 8, 4.5, 0, 7); g.fill(); } },
  market(g) { g.fillRect(6, 34, 52, 10); for (const x of [6, 22, 38]) { g.beginPath(); g.moveTo(x, 34); g.quadraticCurveTo(x + 8, 10, x + 16, 34); g.fill(); } },
  skyscraper(g) { g.fillRect(20, 20, 24, 24); g.fillRect(25, 10, 14, 10); g.fillRect(29, 4, 6, 6); g.fillRect(31, 0, 2, 4); g.fillRect(12, 30, 40, 14); },
  clock(g) { g.fillRect(30, 18, 4, 26); g.beginPath(); g.arc(32, 14, 10, 0, 7); g.fill(); g.fillRect(24, 42, 16, 3); },
  pylon(g) { g.beginPath(); g.moveTo(24, 44); g.lineTo(30, 4); g.lineTo(34, 4); g.lineTo(40, 44); g.lineTo(36, 44); g.lineTo(32, 16); g.lineTo(28, 44); g.fill(); g.lineWidth = 1.5; g.strokeStyle = g.fillStyle; g.beginPath(); for (const k of [0, 1, 2, 3]) { g.moveTo(32, 6 + k * 3); g.lineTo(2, 40); g.moveTo(32, 6 + k * 3); g.lineTo(62, 40); } g.stroke(); },
  arch(g) { g.beginPath(); g.moveTo(8, 44); g.lineTo(8, 30); g.quadraticCurveTo(32, -8, 56, 30); g.lineTo(56, 44); g.lineTo(46, 44); g.lineTo(46, 32); g.quadraticCurveTo(32, 8, 18, 32); g.lineTo(18, 44); g.fill(); },
  tram(g) { g.fillRect(6, 18, 52, 20); g.fillRect(30, 6, 2, 12); g.fillRect(24, 5, 14, 2); g.beginPath(); g.arc(16, 40, 3, 0, 7); g.arc(48, 40, 3, 0, 7); g.fill(); },
  ferry(g) { g.beginPath(); g.moveTo(4, 32); g.lineTo(60, 32); g.lineTo(52, 42); g.lineTo(12, 42); g.fill(); g.fillRect(18, 20, 28, 12); g.fillRect(36, 10, 6, 10); },
  building(g) { g.fillRect(12, 12, 40, 32); g.fillRect(8, 20, 6, 24); g.fillRect(50, 24, 6, 20); },
};
export function drawIcon(canvas, type, got) {
  const g = canvas.getContext('2d');
  g.setTransform(canvas.width / 64, 0, 0, canvas.height / 48, 0, 0);
  g.clearRect(0, 0, 64, 48);
  g.fillStyle = got ? '#c4572f' : '#b7ad9a';
  (ICONS[type] || ICONS.building)(g);
  g.fillStyle = got ? '#2b3a4a' : '#9e947f';
  g.fillRect(2, 44, 60, 2);
  if (got) { // window dots in cream
    g.fillStyle = 'rgba(246,239,223,.75)';
    for (let i = 0; i < 3; i++) g.fillRect(22 + i * 8, 33 + (i % 2) * 3, 3, 3);
  }
}

export function renderAlbum(root, album) {
  root.replaceChildren();
  const st = load();
  const n = collectedCount(album);
  const head = document.createElement('div'); head.className = 'mp-count'; head.textContent = mt('albumCount', { n, total: album.entries.length });
  const bar = document.createElement('div'); bar.className = 'mp-bar'; const fill = document.createElement('i'); fill.style.width = `${(100 * n) / Math.max(1, album.entries.length)}%`; bar.append(fill);
  const grid = document.createElement('div'); grid.className = 'mp-grid'; grid.setAttribute('data-album-grid', '');
  for (const e of album.entries) {
    const rec = st.album[e.id];
    const card = document.createElement('div'); card.className = 'mp-card' + (rec ? ' got' : ''); card.dataset.id = e.id;
    const c = document.createElement('canvas'); c.width = 128; c.height = 96; drawIcon(c, e.type, !!rec);
    const name = document.createElement('div'); name.className = 'mp-name'; name.textContent = rec || getLang() ? lname(e) : '';
    const sub = document.createElement('div'); sub.className = 'mp-sub';
    const fact = getLang() === 'lv' ? e.factLv : e.factEn;
    sub.textContent = rec ? `${mt('collectedOn', { d: rec.d })}${fact ? ' · ' + fact : ''}` : mt('notYet');
    card.append(c, name, sub);
    grid.append(card);
  }
  root.append(head, bar, grid);
}
