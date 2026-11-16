// Tiny i18n: Latvian (default when navigator.language starts with "lv") and English.
// Static DOM uses data-i18n / data-i18n-title / data-i18n-ph attributes (applied by applyDom);
// dynamic strings call t(key, vars). The choice is remembered in localStorage (bedre.lang).

const S = {
  lv: {
    score: 'Rezultāts', time: 'Laiks', swallowedLbl: 'Norīts:', leaderboard: 'Līderi',
    size: 'Izmērs {n}', yourName: 'Tavs vārds', namePh: 'Tu', defaultName: 'Tu',
    blurb: 'Vadi bedri pa Rīgu, norij visu, kas ietilpst — cilvēkus, mašīnas, veselas ēkas — un izaugsti lielāks par pretiniekiem.',
    how: 'Pele, pirksta vilkšana vai WASD / bultiņas — kustība. Ritenītis vai divu pirkstu žests — tālummaiņa.',
    play: 'Spēlēt', loadingMap: 'Ielādē karti…', topScores: 'Labākie rezultāti', about: 'Par spēli', lang: 'Valoda',
    go: 'Aiziet!', swallowedBy: 'Tevi norija', backIn: 'Atpakaļ pēc', feedVerb: 'norija',
    timeUp: 'Laiks beidzies', placeOf: '{n}. vieta no {total}', points: 'punkti',
    rEaten: 'Norīts', rKills: 'Norītas bedres', rDeaths: 'Tevi norija (reizes)', rBiggest: 'Lielākais norītais', rSize: 'Gala izmērs',
    finalSize: 'Ø {d} m (izmērs {lvl})', playAgain: 'Spēlēt vēlreiz',
    globalRank: 'Globālā vieta: #{all} visu laiku · #{day} šodien', notSaved: 'rezultāts nav saglabāts (nav savienojuma)',
    saving: 'Saglabā rezultātu…', unranked: 'Testa režīms — rezultāts netiek reitingots',
    tsTitle: 'Labākie rezultāti', tabDay: 'Šodien', tabWeek: 'Nedēļa', tabAll: 'Visu laiku',
    colRank: '#', colName: 'Vārds', colScore: 'Punkti', colSize: 'Izmērs', loading: 'Ielādē…',
    empty: 'Vēl nav rezultātu. Esi pirmais!', offline: 'Rezultātu serveris nav pieejams.', close: 'Aizvērt', you: 'tu',
    aboutTitle: 'Par spēli', aboutInspired: 'Iedvesmojies no', aboutBuildings: 'Ēku kontūras, formas un augstumi: © Rīgas valstspilsētas pašvaldība',
    mapLabel: 'Apkaime', mapOnlineNote: 'Tiešsaiste pagaidām tikai Centra kartē.', aboutGround: 'Zemes seguma klasifikācija (zāliens, koki, ielu un laukumu segums): © LĢIA ortofoto 2016–2018, CC BY 4.0, pārveidota', aboutOsm: 'Ceļi, ūdeņi, parki, koki, tramvaja sliedes, pieturas, nosaukumi un ēku daļas:', aboutBuilt: 'Veidots ar three.js.',
    aboutNote: 'Oriģināla spēle; nav saistīta ar minēto spēli vai tās autoriem.',
    footInspired: 'Iedvesmojies no Hole.io', attrib: '© OpenStreetMap · Rīgas valstspilsētas pašvaldība',
    pause: 'Pauze', resume: 'Turpināt', pauseHint: 'Esc — turpināt', pauseBtn: 'Pauze (Esc)', soundBtn: 'Skaņa ieslēgta/izslēgta (M)', soundAria: 'Ieslēgt/izslēgt skaņu',
    loadingTitle: 'Ielādē Rīgu…', loadingData: 'Ielādē kartes datus', loadingBuild: 'Būvē pilsētu', loadingReady: 'Gatavs',
    noWebgl: 'Šajā ierīcē vai pārlūkā nav pieejams WebGL, tāpēc spēle nevar startēt. Mēģini citu pārlūku vai ieslēdz aparatūras paātrinājumu.',
    bootError: 'Neizdevās ielādēt spēli. Pārlādē lapu.',
    sizeAria: 'Bedres izmērs',
    themeLbl: 'Tēma', themeAuto: 'Auto', themeDay: 'Diena', themeEvening: 'Vakars', themeWinter: 'Ziema', themeNov18: '18. nov.',
    themeWinterDay: 'Ziema', themeWinterEve: 'Ziemas vakars', themeNov18Name: 'Lāčplēša diena', themeLigo: 'Līgo vakars',
    themeNow: 'Šobrīd: {name}', themeNov18Cap: 'Lāčplēša diena — 18. novembra svētku vakars',
    optsTitle: 'Iestatījumi', aboutRadio: 'Radio (neobligāts, ieslēdz pats): Latvijas Radio 2 tiešraide no LSM', rtScore: 'Rezultāts', rtMap: 'Karte', rtAch: 'Sasniegumi', rtNone: 'Šoreiz nekā jauna.', tsMapAria: 'Karte', tsCentreOnly: 'Dienas izaicinājums un Tiešsaiste: tikai Centra karte.',
    blurbShort: 'Vadi bedri pa Rīgu, norij visu, kas ietilpst, un izaugsti lielāks par pretiniekiem.',
  },
  en: {
    score: 'Score', time: 'Time', swallowedLbl: 'Swallowed:', leaderboard: 'Leaderboard',
    size: 'Size {n}', yourName: 'Your name', namePh: 'You', defaultName: 'Tu',
    blurb: 'Steer a hole through Riga and swallow whatever fits — people, cars, whole buildings — to out-grow your rivals.',
    how: 'Mouse, touch drag or WASD / arrows to move. Wheel or two-finger pinch to zoom.',
    play: 'Play', loadingMap: 'Loading map…', topScores: 'Top scores', about: 'About', lang: 'Language',
    go: 'Go!', swallowedBy: 'Swallowed by', backIn: 'Back in', feedVerb: 'swallowed',
    timeUp: "Time's up", placeOf: '{n} of {total}', points: 'points',
    rEaten: 'Swallowed', rKills: 'Holes swallowed', rDeaths: 'Swallowed by others', rBiggest: 'Biggest thing', rSize: 'Final size',
    finalSize: 'Ø {d} m (size {lvl})', playAgain: 'Play again',
    globalRank: 'Global rank: #{all} all-time · #{day} today', notSaved: 'score not saved (offline)',
    saving: 'Saving score…', unranked: 'Debug mode — this round is unranked',
    tsTitle: 'Top scores', tabDay: 'Today', tabWeek: 'This week', tabAll: 'All time',
    colRank: '#', colName: 'Name', colScore: 'Score', colSize: 'Size', loading: 'Loading…',
    empty: 'No scores yet. Be the first!', offline: 'The score server is not reachable.', close: 'Close', you: 'you',
    aboutTitle: 'About', aboutInspired: 'Inspired by', aboutBuildings: 'Building footprints, shapes and heights: © Rīgas valstspilsētas pašvaldība',
    mapLabel: 'District', mapOnlineNote: 'Online is available on the Centre map only for now.', aboutGround: 'Ground-cover classification (lawns, trees, street and plaza surfaces): © LĢIA orthophoto 2016–2018, CC BY 4.0, modified', aboutOsm: 'Roads, water, parks, trees, tram tracks, stops, names and building parts:', aboutBuilt: 'Built with three.js.',
    aboutNote: 'An original game; not affiliated with the game above or its makers.',
    footInspired: 'Inspired by Hole.io', attrib: '© OpenStreetMap · Rīgas valstspilsētas pašvaldība',
    pause: 'Paused', resume: 'Resume', pauseHint: 'Esc to resume', pauseBtn: 'Pause (Esc)', soundBtn: 'Sound on/off (M)', soundAria: 'Toggle sound',
    loadingTitle: 'Loading Riga…', loadingData: 'Loading map data', loadingBuild: 'Building the city', loadingReady: 'Ready',
    noWebgl: 'WebGL is not available on this device or browser, so the game cannot start. Try another browser or enable hardware acceleration.',
    bootError: 'The game failed to load. Please reload the page.',
    sizeAria: 'Hole size',
    themeLbl: 'Theme', themeAuto: 'Auto', themeDay: 'Day', themeEvening: 'Evening', themeWinter: 'Winter', themeNov18: '18 Nov',
    themeWinterDay: 'Winter', themeWinterEve: 'Winter evening', themeNov18Name: 'Lāčplēša Day', themeLigo: 'Līgo dusk',
    themeNow: 'Now: {name}', themeNov18Cap: "Lāčplēša Day — the 18 November festive evening",
    optsTitle: 'Options', aboutRadio: 'Radio (optional, you switch it on): Latvijas Radio 2 live stream from LSM', rtScore: 'Result', rtMap: 'Map', rtAch: 'Progress', rtNone: 'Nothing new this time.', tsMapAria: 'Map', tsCentreOnly: 'Daily challenge and Online: Centre map only.',
    blurbShort: 'Steer a hole through Riga, swallow whatever fits and out-grow your rivals.',
  },
};

// Human-readable names for every swallowable kind: [nominative LV, EN].
const KINDS = {
  person: ['gājējs', 'pedestrian'], car: ['automašīna', 'car'], van: ['furgons', 'van'], taxi: ['taksometrs', 'taxi'],
  bus: ['autobuss', 'bus'], trolleybus: ['trolejbuss', 'trolleybus'], tram: ['tramvajs', 'tram'],
  shelter: ['pieturas nojume', 'bus shelter'], flag: ['karogs', 'flag'], parasol: ['saulessargs', 'café parasol'],
  stall: ['tirgus galdiņš', 'market stall'], bike: ['velosipēds', 'bicycle'], scooter: ['skrejritenis', 'e-scooter'],
  lantern: ['laterna', 'street lantern'], boat: ['laiva', 'boat'], ferry: ['prāmis', 'ferry'], swan: ['gulbis', 'swan'],
  pigeon: ['balodis', 'pigeon'], laima: ['Laimas pulkstenis', 'Laima clock'], pylon: ['tilta pilons', 'bridge pylon'],
  railarch: ['dzelzceļa tilta loks', 'railway-bridge arch'], tree: ['koks', 'tree'], bench: ['sols', 'bench'],
  lamp: ['ielas lukturis', 'street lamp'], bin: ['atkritumu tvertne', 'bin'], kiosk: ['kiosks', 'kiosk'],
  cafeset: ['kafejnīcas galdiņš', 'café table'],
  monument: ['piemineklis', 'monument'], freedom: ['Brīvības piemineklis', 'Freedom Monument'], building: ['ēka', 'building'],
};

let lang = 'en';
try {
  const saved = localStorage.getItem('bedre.lang');
  if (saved === 'lv' || saved === 'en') lang = saved;
  else lang = String(navigator.language || '').toLowerCase().startsWith('lv') ? 'lv' : 'en';
} catch { lang = String(navigator.language || '').toLowerCase().startsWith('lv') ? 'lv' : 'en'; }
const listeners = [];

export const getLang = () => lang;
export const locale = () => (lang === 'lv' ? 'lv-LV' : 'en-US');
export const fmt = (n) => Math.floor(n).toLocaleString(locale());

export function t(key, vars) {
  let s = S[lang][key] ?? S.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
  return s;
}

/** Name of a swallowable kind ('person3' -> person); falls back to the raw kind. */
export function kindName(kind, l = lang) {
  const k = String(kind || '').replace(/^person\d+$/, 'person');
  const e = KINDS[k];
  return e ? e[l === 'lv' ? 0 : 1] : k;
}
export const allKinds = () => Object.keys(KINDS);

export function applyDom(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) { const v = t(el.dataset.i18nTitle); el.title = v; el.setAttribute('aria-label', v); }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

export function setLang(l) {
  if (l !== 'lv' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem('bedre.lang', l); } catch { /* storage blocked */ }
  applyDom();
  for (const f of listeners) f(lang);
}
export const onLang = (f) => { listeners.push(f); };
/** Feature modules add their own strings (modes, analytics note, ...) without touching the tables above. */
export function extendStrings(lv, en) { Object.assign(S.lv, lv); Object.assign(S.en, en); }
