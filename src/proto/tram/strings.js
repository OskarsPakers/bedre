// Own small string table (LV default for lv browsers, EN otherwise). {n}-style placeholders. The choice is remembered (localStorage, own key).
const S = {
  lv: {
    title: 'Tramvaja vadītājs', sub: 'Līnija 11 · Mežaparka gals', route: 'Hamburgas iela → Mežaparka aplis → atpakaļ',
    how: 'Sviras maiņa: W / ↑ — vilkme, S / ↓ — bremze, atstarpe — avārijas bremze. Piestāj ar priekšējām durvīm pie dzeltenās līnijas un ievēro grafiku.',
    howTouch: 'Velc sviru augšup — vilkme, lejup — bremze. Piestāj ar priekšējām durvīm pie dzeltenās līnijas un ievēro grafiku.',
    play: 'Braukt', again: 'Braukt vēlreiz', back: 'BEDRE — Rīga', proto: 'Prototips', loading: 'Ielādē Mežaparku…', building: 'Būvē pilsētu…', ready: 'Gatavs',
    noWebgl: 'Šajā ierīcē nav WebGL — spēle nevar startēt.', bootError: 'Neizdevās ielādēt spēli. Pārlādē lapu.',
    credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA',
    next: 'Nākamā pietura', due: 'pēc', late: 'kavē', terminus: 'Galapunkts', doors: 'Durvis', bell: 'Zvans', cab: 'Kabīne', chase: 'Ārpus', eb: 'Avārija', pause: 'Pauze', resume: 'Turpināt',
    limit: 'Limits', power: 'Vilkme', brake: 'Bremze', ebrake: 'Avārijas bremze', doorsOpen: 'Durvis atvērtas', doorsLocked: 'Durvis atvērtas — vilkme bloķēta',
    boarding: 'Pasažieri ierodas…', go: 'Durvis aizvērtas — var braukt', zoneHint: 'Piestāj pie dzeltenās līnijas',
    tooFast: 'Pārāk ātri!', curveFast: 'Pārāk ātri līkumā!', missed: 'Pietura nokavēta!', perfect: 'Ideāli!', good: 'Labi', fair: 'Pieņemami', poor: 'Tālu no atzīmes',
    acc: 'Precizitāte', timing: 'Laiks', smooth: 'Maigums', speed: 'Ātrums', pts: 'p.', early: 'agri', onTime: 'laikā', lateS: 'vēlu', short: 'pirms', over: 'pāri', m: 'm',
    resTitle: 'Brauciens pabeigts', stops: 'Pieturas', points: 'Punkti', total: 'Kopā', missedN: 'Nokavētas pieturas', time: 'Brauciena laiks', stopCol: 'Pietura',
    stars3: 'Paraugvadītājs!', stars2: 'Tīrs brauciens', stars1: 'Brauciens izturēts', lang: 'Valoda', kmh: 'km/h', paused: 'Pauze',
    dirOut: 'Mežaparks', dirIn: 'Stacijas laukums', credit1: 'Prototips · ', leverHint: 'Svira',
    runShort: 'Īss · {n} pieturas', runFull: 'Pilns aplis · {n} pieturas', routeInfo: '{n} pieturas · {km} km · grafiks ≈ {min} min · vidēji {kmh} km/h', gearPaused: '',
  },
  en: {
    title: 'Tram Driver', sub: 'Line 11 · Mežaparks end', route: 'Hamburgas iela → Mežaparks loop → and back',
    how: 'Lever: W / ↑ power, S / ↓ brake, space emergency brake. Stop with the front door on the yellow line and keep to the timetable.',
    howTouch: 'Drag the lever up for power, down to brake. Stop with the front door on the yellow line and keep to the timetable.',
    play: 'Drive', again: 'Drive again', back: 'BEDRE — Rīga', proto: 'Prototype', loading: 'Loading Mežaparks…', building: 'Building the city…', ready: 'Ready',
    noWebgl: 'WebGL is not available on this device, so the game cannot start.', bootError: 'The game failed to load. Please reload the page.',
    credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA',
    next: 'Next stop', due: 'due in', late: 'late', terminus: 'Terminus', doors: 'Doors', bell: 'Bell', cab: 'Cab', chase: 'Chase', eb: 'Emerg.', pause: 'Pause', resume: 'Resume',
    limit: 'Limit', power: 'Power', brake: 'Brake', ebrake: 'Emergency brake', doorsOpen: 'Doors open', doorsLocked: 'Doors open — traction locked',
    boarding: 'Passengers boarding…', go: 'Doors closed — ready to go', zoneHint: 'Stop at the yellow line',
    tooFast: 'Too fast!', curveFast: 'Too fast in the curve!', missed: 'Stop missed!', perfect: 'Perfect!', good: 'Good', fair: 'Fair', poor: 'Far from the mark',
    acc: 'Accuracy', timing: 'Timing', smooth: 'Smoothness', speed: 'Speed', pts: 'pts', early: 'early', onTime: 'on time', lateS: 'late', short: 'short', over: 'over', m: 'm',
    resTitle: 'Run complete', stops: 'Stops', points: 'Points', total: 'Total', missedN: 'Missed stops', time: 'Run time', stopCol: 'Stop',
    stars3: 'Model driver!', stars2: 'Clean run', stars1: 'Run completed', lang: 'Language', kmh: 'km/h', paused: 'Paused',
    dirOut: 'Mežaparks', dirIn: 'Stacijas laukums', credit1: 'Prototype · ', leverHint: 'Lever',
    runShort: 'Short · {n} stops', runFull: 'Full circuit · {n} stops', routeInfo: '{n} stops · {km} km · timetable ≈ {min} min · avg {kmh} km/h', gearPaused: '',
  },
};
const KEY = 'tramvajs.lang';
let lang = (() => {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'lv' || q === 'en') return q; } catch { /* ignore */ }
  try { const v = localStorage.getItem(KEY); if (v === 'lv' || v === 'en') return v; } catch { /* storage blocked */ }
  try { return /^lv/i.test(navigator.language || '') ? 'lv' : 'en'; } catch { return 'en'; }
})();
const subs = [];
export const getLang = () => lang;
export function setLang(l) { if (l !== 'lv' && l !== 'en') return; lang = l; try { localStorage.setItem(KEY, l); } catch { /* ignore */ } document.documentElement.lang = l; for (const f of subs) f(); }
export const onLang = (f) => subs.push(f);
export function t(key, vars) {
  let s = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
/** fill [data-i18n] (textContent) and [data-i18n-aria] (aria-label) */
export function applyDom(root = document) {
  document.documentElement.lang = lang;
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of root.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria));
}
