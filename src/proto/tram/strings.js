// Own small string table (LV default for lv browsers, EN otherwise). {n}-style placeholders. The choice is remembered (localStorage, own key).
const S = {
  lv: {
    title: 'Tramvaja vadītājs', loading: 'Ielādē karti…', building: 'Būvē pilsētu…', ready: 'Gatavs',
    how: 'Svira: W / ↑ — vilkme, S / ↓ — bremze, atstarpe — avārijas bremze, B — zvans, E — durvis. Piestāj ar priekšējām durvīm pie dzeltenās līnijas, ievēro signālus un grafiku.',
    howTouch: 'Velc sviru augšup — vilkme, lejup — bremze. Piestāj ar priekšējām durvīm pie dzeltenās līnijas, ievēro signālus un grafiku.',
    play: 'Braukt', again: 'Braukt vēlreiz', back: 'BEDRE — Rīga', proto: 'Prototips', menu: 'Izvēlne', restart: 'No jauna', ok: 'Skaidrs', share: 'Dalīties', howto: 'Kā braukt',
    noWebgl: 'Šajā ierīcē nav WebGL — spēle nevar startēt.', bootError: 'Neizdevās ielādēt spēli. Pārlādē lapu.',
    credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA', creditsMore: 'Tramvaji bez operatora zīmoliem. Prototips.',
    next: 'Nākamā pietura', due: 'pēc', late: 'kavē', terminus: 'Galapunkts', doors: 'Durvis', bell: 'Zvans', cab: 'Kabīne', chase: 'Ārpus', eb: 'Avārija', pause: 'Pauze', resume: 'Turpināt', sound: 'Skaņa',
    limit: 'Limits', power: 'Vilkme', brake: 'Bremze', doorsOpen: 'Durvis atvērtas', doorsLocked: 'Durvis atvērtas — vilkme bloķēta',
    boarding: 'Pasažieri ierodas…', go: 'Durvis aizvērtas', zoneHint: 'Piestāj pie dzeltenās līnijas', ringBell: 'Zvani — brauc!', waitDepart: 'Gaidi atiešanas laiku', readyGo: 'Zvans nozvanīts — brauc',
    tooFast: 'Pārāk ātri!', curveFast: 'Pārāk ātri līkumā!', missed: 'Pietura nokavēta!', perfect: 'Ideāli!', good: 'Labi', fair: 'Pieņemami', poor: 'Tālu no atzīmes',
    acc: 'Precizitāte', timing: 'Laiks', smooth: 'Maigums', speed: 'Ātrums', pts: 'p.', early: 'agri', onTime: 'laikā', lateS: 'vēlu', short: 'pirms', over: 'pāri', m: 'm',
    punctual: 'Laikā', earlyBy: 'Agrāk {s} s', lateBy: 'Vēlāk {s} s',
    comfort: 'Komforts', passengers: 'Pasažieri', waiting: 'gaida', wait: 'Gaidi', blocked: 'Ceļš aizņemts — gaidi', redSig: 'Sarkans — gaidi', passedRed: 'Sarkanais signāls! −{p}', atpMsg: 'Šķērslis! Avārijas bremzēšana −{p}', pedMsg: 'Gājēji uz sliedēm — zvani!', hurry: 'Zvans — gājēji steidzas',
    sigBlock: 'bloks', sigRoad: 'luksofors',
    resTitle: 'Brauciens pabeigts', stops: 'Pieturas', points: 'Punkti', total: 'Kopā', missedN: 'Nokavētas pieturas', time: 'Brauciena laiks', stopCol: 'Pietura',
    stars3: 'Paraugvadītājs!', stars2: 'Tīrs brauciens', stars1: 'Brauciens izturēts', lang: 'Valoda', kmh: 'km/h', paused: 'Pauze',
    catPrecision: 'Piestāšanās precizitāte', catPunctuality: 'Punktualitāte', catComfort: 'Pasažieru komforts', catRules: 'Noteikumi un drošība', happy: 'apmierināti pasažieri',
    pbNew: 'Jauns personīgais rekords!', pbBest: 'Personīgais rekords: {p}', pbNone: 'Pirmais brauciens šajā maršrutā', penalties: 'Soda punkti: {p}',
    runShort: 'Īss', runFull: 'Pilns', runInfo: '{n} pieturas · {km} km · ≈ {min} min', routeInfo: '{n} pieturas · {km} km · grafiks ≈ {min} min · vidēji {kmh} km/h',
    themeDay: 'Diena', themeEvening: 'Vakars', themeWinter: 'Ziema', setSound: 'Skaņa', setLeft: 'Svira kreisajā pusē', setCab: 'Kabīnes skats', best: 'Rekords',
    how1: 'Nozvani zvanu (B vai poga) — tā tiek dots atiešanas signāls. Durvīm jābūt aizvērtām.', how2: 'Velc sviru uz augšu, lai braucot paātrinātu; uz leju — bremzēt. Seko ātruma ierobežojumiem un zīmēm.',
    how3: 'Pirms pieturas redzēsi tabulas 100 / 50 / 20 m. Bremzē maigi — pasažieri to jūt.', how4: 'Piestāj tā, lai pirmās durvis ir pie dzeltenās līnijas. Durvis atveras pašas; pēc iekāpšanas nozvani zvanu.',
    how5: 'Sarkans signāls — stāvi; gājējiem uz pārejas zvani. Aiz sarkanā pabraukt nedrīkst; stāvēšana pie sarkanā netiek skaitīta kā kavēšanās.',
    coachBell: 'Nozvani zvanu', coachBellS: 'B vai 🔔 — atiešanas signāls', coachPower: 'Velc sviru uz augšu', coachPowerS: 'W / ↑ vai velc sviru — paātrini līdz ~40 km/h', coachBrake: 'Tuvojas pietura', coachBrakeS: 'Bremzē pie tabulām 100 / 50 / 20 m', coachStop: 'Piestāj pie dzeltenās līnijas', coachStopS: 'Pirmās durvis pie zaļās atzīmes; zemāk redzi joslu',
    sStarMsg: '{n} zvaigznes',
    shareText: '{route} ({run}): {stars} {pts}/{max}, {happy}% apmierināti pasažieri. Tramvaja vadītājs — ',
    copied: 'Teksts nokopēts', dirOut: 'Mežaparks', dirIn: 'Centrs',
  },
  en: {
    title: 'Tram Driver', loading: 'Loading the map…', building: 'Building the city…', ready: 'Ready',
    how: 'Lever: W / ↑ power, S / ↓ brake, space emergency brake, B bell, E doors. Stop with the front door on the yellow line, obey the signals and keep to the timetable.',
    howTouch: 'Drag the lever up for power, down to brake. Stop with the front door on the yellow line, obey the signals and keep to the timetable.',
    play: 'Drive', again: 'Drive again', back: 'BEDRE — Rīga', proto: 'Prototype', menu: 'Menu', restart: 'Restart', ok: 'Got it', share: 'Share', howto: 'How to drive',
    noWebgl: 'WebGL is not available on this device, so the game cannot start.', bootError: 'The game failed to load. Please reload the page.',
    credits: '© OpenStreetMap contributors · Rīgas valstspilsētas pašvaldība · LĢIA', creditsMore: 'Trams carry no operator branding. Prototype.',
    next: 'Next stop', due: 'due in', late: 'late', terminus: 'Terminus', doors: 'Doors', bell: 'Bell', cab: 'Cab', chase: 'Chase', eb: 'Emerg.', pause: 'Pause', resume: 'Resume', sound: 'Sound',
    limit: 'Limit', power: 'Power', brake: 'Brake', doorsOpen: 'Doors open', doorsLocked: 'Doors open — traction locked',
    boarding: 'Passengers boarding…', go: 'Doors closed', zoneHint: 'Stop at the yellow line', ringBell: 'Ring the bell — then go', waitDepart: 'Waiting for the departure time', readyGo: 'Bell rung — go',
    tooFast: 'Too fast!', curveFast: 'Too fast in the curve!', missed: 'Stop missed!', perfect: 'Perfect!', good: 'Good', fair: 'Fair', poor: 'Far from the mark',
    acc: 'Accuracy', timing: 'Timing', smooth: 'Smoothness', speed: 'Speed', pts: 'pts', early: 'early', onTime: 'on time', lateS: 'late', short: 'short', over: 'over', m: 'm',
    punctual: 'On time', earlyBy: '{s} s early', lateBy: '{s} s late',
    comfort: 'Comfort', passengers: 'Passengers', waiting: 'waiting', wait: 'Wait', blocked: 'Line occupied — wait', redSig: 'Red — wait', passedRed: 'Passed a red signal! −{p}', atpMsg: 'Obstruction! Emergency braking −{p}', pedMsg: 'People on the track — ring the bell!', hurry: 'Bell — people hurry',
    sigBlock: 'block', sigRoad: 'traffic light',
    resTitle: 'Run complete', stops: 'Stops', points: 'Points', total: 'Total', missedN: 'Missed stops', time: 'Run time', stopCol: 'Stop',
    stars3: 'Model driver!', stars2: 'Clean run', stars1: 'Run completed', lang: 'Language', kmh: 'km/h', paused: 'Paused',
    catPrecision: 'Stopping accuracy', catPunctuality: 'Punctuality', catComfort: 'Passenger comfort', catRules: 'Rules & safety', happy: 'happy passengers',
    pbNew: 'New personal best!', pbBest: 'Personal best: {p}', pbNone: 'First run on this route', penalties: 'Penalty points: {p}',
    runShort: 'Short', runFull: 'Full', runInfo: '{n} stops · {km} km · ≈ {min} min', routeInfo: '{n} stops · {km} km · timetable ≈ {min} min · avg {kmh} km/h',
    themeDay: 'Day', themeEvening: 'Evening', themeWinter: 'Winter', setSound: 'Sound', setLeft: 'Lever on the left', setCab: 'Cab view', best: 'Best',
    how1: 'Ring the bell (B or the button) — that is the departure signal. The doors must be closed.', how2: 'Push the lever up to accelerate, down to brake. Keep to the speed limits and signs.',
    how3: 'Before a stop you pass 100 / 50 / 20 m boards. Brake smoothly — the passengers feel it.', how4: 'Stop with the first door at the yellow line. The doors open by themselves; after boarding ring the bell.',
    how5: 'A red signal means stop; ring the bell for people on a crossing. Passing a red is penalised; standing at a red does not count as being late.',
    coachBell: 'Ring the bell', coachBellS: 'B or 🔔 — the departure signal', coachPower: 'Push the lever up', coachPowerS: 'W / ↑ or drag the lever — accelerate to ~40 km/h', coachBrake: 'A stop is coming', coachBrakeS: 'Brake at the 100 / 50 / 20 m boards', coachStop: 'Stop at the yellow line', coachStopS: 'First door on the green mark; watch the bar below',
    sStarMsg: '{n} stars',
    shareText: '{route} ({run}): {stars} {pts}/{max}, {happy}% happy passengers. Tram Driver — ',
    copied: 'Text copied', dirOut: 'Mežaparks', dirIn: 'Centre',
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
