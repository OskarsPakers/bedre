// Own tiny string table (LV default for lv browsers, EN otherwise). Not shared with the main game's i18n.
const S = {
  lv: {
    title: 'Kur es esmu?', tagline: 'Tevi nometa nezināmā Rīgas ielā. Apskaties apkārt, atrodi vietu kartē un uzmini.',
    how: '5 raundi · velc, lai skatītos apkārt · atver karti un uzliec adatu',
    play: 'Spēlēt', again: 'Spēlēt vēlreiz', back: 'Atpakaļ uz BEDRE', mainLink: 'BEDRE — Rīga',
    diff: 'Grūtība', easy: 'Viegli', normal: 'Parasti', hard: 'Grūti',
    easyHint: 'tuvumā ir pazīstama vieta, kartē redzami apkaimju nosaukumi', normalHint: 'nejauša ielu vieta', hardHint: 'parastas ielas, bez nosaukumiem kartē',
    timer: '60 s uz raundu', lang: 'Valoda', seedLbl: 'Spēles kods',
    loading: 'Ielādē Rīgu', loadingBuild: 'Būvē pilsētu', noWebgl: 'Šai ierīcei nav WebGL — spēle nedarbojas.', bootError: 'Neizdevās ielādēt karti.',
    round: 'Raunds {n}/5', map: 'Karte', closeMap: 'Aizvērt', placePin: 'Pieskaries kartei, lai uzliktu adatu', confirm: 'Apstiprināt', zoomIn: 'Pietuvināt', zoomOut: 'Attālināt',
    fwd: 'Uz priekšu', bwd: 'Atpakaļ', fwdFar: 'Tālāk nevar', lookHint: 'Velc, lai skatītos apkārt', stepsHint: 'Vari paiet pa ielu (▲ / W)', compass: 'Ziemeļi',
    distance: 'Attālums', points: 'punkti', nearTo: 'Pie', area: 'Apkaime', perfect: 'Precīzi!', next: 'Nākamais', finish: 'Rezultāti', youWere: 'Tu biji šeit', yourGuess: 'Tava adata',
    noGuess: 'Laiks beidzies — adatas nav', hereWas: 'Patiesā vieta', 
    summary: 'Rezultāts', total: 'Kopā', of: 'no', bestGuess: 'Labākā ieraudzīšana', round1: 'Raunds', share: 'Kopīgot rezultātu', copied: 'Nokopēts!', shareFail: 'Nevar nokopēt — atver sīkrīku',
    metres: 'm', km: 'km', footer: 'Prototips', credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA (CC BY 4.0)',
    shareText: 'Kur es esmu? {total}/{max} punkti. Mēģini pats: {url}', sightNear: 'Redzama vieta: {name}',
  },
  en: {
    title: 'Kur es esmu?', tagline: 'You are dropped on an unknown street in Riga. Look around, find the spot on the map and guess.',
    how: '5 rounds · drag to look around · open the map and drop a pin',
    play: 'Play', again: 'Play again', back: 'Back to BEDRE', mainLink: 'BEDRE — Rīga',
    diff: 'Difficulty', easy: 'Easy', normal: 'Normal', hard: 'Hard',
    easyHint: 'a recognisable sight is nearby, neighbourhood names on the map', normalHint: 'a random street spot', hardHint: 'plain streets, no names on the map',
    timer: '60 s per round', lang: 'Language', seedLbl: 'Game code',
    loading: 'Loading Riga', loadingBuild: 'Building the city', noWebgl: 'This device has no WebGL, the game cannot run.', bootError: 'Could not load the map.',
    round: 'Round {n}/5', map: 'Map', closeMap: 'Close', placePin: 'Tap the map to drop your pin', confirm: 'Confirm guess', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    fwd: 'Step forward', bwd: 'Step back', fwdFar: 'Cannot go further', lookHint: 'Drag to look around', stepsHint: 'You can walk along the street (▲ / W)', compass: 'North',
    distance: 'Distance', points: 'points', nearTo: 'Near', area: 'Neighbourhood', perfect: 'Spot on!', next: 'Next round', finish: 'See results', youWere: 'You were here', yourGuess: 'Your pin',
    noGuess: 'Time is up — no pin placed', hereWas: 'The real spot',
    summary: 'Result', total: 'Total', of: 'of', bestGuess: 'Best guess', round1: 'Round', share: 'Share result', copied: 'Copied!', shareFail: 'Could not copy',
    metres: 'm', km: 'km', footer: 'Prototype', credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA (CC BY 4.0)',
    shareText: 'Kur es esmu? {total}/{max} points. Try it yourself: {url}', sightNear: 'Sight in view: {name}',
  },
};
let lang = 'en';
try {
  const saved = localStorage.getItem('kur.lang');
  lang = saved === 'lv' || saved === 'en' ? saved : String(navigator.language || '').toLowerCase().startsWith('lv') ? 'lv' : 'en';
} catch { lang = String(navigator.language || '').toLowerCase().startsWith('lv') ? 'lv' : 'en'; }
const listeners = [];
export const getLang = () => lang;
export function t(key, vars) {
  let s = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
  return s;
}
export function setLang(l) {
  if (l !== 'lv' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem('kur.lang', l); } catch { /* storage blocked */ }
  applyDom();
  for (const f of listeners) f(lang);
}
export const onLang = (f) => { listeners.push(f); };
export function applyDom(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) { const v = t(el.dataset.i18nTitle); el.title = v; el.setAttribute('aria-label', v); }
  for (const b of root.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}
/** distance label: 842 m / 1.4 km */
export function fmtDist(m) { return m < 1000 ? `${Math.round(m)} ${t('metres')}` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', lang === 'lv' ? ',' : '.')} ${t('km')}`; }
export const fmtNum = (n) => Math.round(n).toLocaleString(lang === 'lv' ? 'lv-LV' : 'en-US');
