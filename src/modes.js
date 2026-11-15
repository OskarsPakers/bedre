// Game modes: Classic (5:00 vs bots), Quick (2:00, faster growth), Free roam (no timer / bots / ranking) and the
// Daily challenge (a fixed, date-seeded setup per Riga day). Mode rules live in src/rules.js (shared with the Worker);
// this file picks the mode (start-screen selector), applies it to the Game on every round start via the `modeSetup`
// bus event (emitted by Game.start) and tells src/scores.js what kind of server round to ask for.
import { CFG } from './config.js';
import { bus } from './events.js';
import { MODES } from './rules.js';
import { mulberry32 } from './rng.js';
import { t, extendStrings, onLang, getLang } from './i18n.js';
import { TWISTS, dailyInfo, dailyUsed, markDailyUsed, todayRiga } from './daily.js';
import './modes.css';

extendStrings({
  modeClassic: 'Klasika', modeQuick: 'Ātrā', modeDaily: 'Dienas', modeFree: 'Pastaiga', modeOnline: 'Tiešsaiste', modesAria: 'Spēles režīms',
  modeDescClassic: '5:00 pret 7 botiem.',
  modeDescQuick: '2:00 sprints, ātrāka izaugsme.',
  modeDescFree: 'Bez taimera, botiem un reitinga.',
  modeDescDaily: '{twist}. Viens reitinga mēģinājums dienā.',
  modeDescDailyUsed: '{twist}. Reitinga mēģinājums izmantots — treniņš.',
  dailyIntroTitle: 'Dienas izaicinājums', twistLbl: 'Šodienas īpatnība', practiceTag: 'treniņš — nereitingots',
  twistoldtown: 'Starts Vecrīgā', twistcentre: 'Starts pie Brīvības pieminekļa', twistbots9: '9 boti', twistquiet: 'Tikai 3 boti',
  twisttough: 'Gudrāki, ātrāki boti', twistcrowd: '9 boti un starts Vecrīgā',
  endBtn: 'Beigt', freeEnded: 'Pastaiga beigusies',
  practiceNote: 'Treniņš — šodienas reitinga mēģinājums jau izmantots', freeNote: 'Brīvā pastaiga — rezultāts netiek saglabāts',
  globalRankDaily: 'Dienas tabulā: #{n}',
  tabYesterday: 'Vakar', tsTwist: 'Īpatnība: {twist}', tsDaily: 'Diena {day}',
  aboutPrivacy: 'Privātums: spēle neizmanto sīkdatnes un trešo pušu skriptus. Tiek skaitīti tikai anonīmi dienas kopskaiti (lapas skatījumi, sākti/pabeigti raundi pa režīmiem, ierīces klase, valoda, kvalitāte, kļūdas) — bez identifikatoriem un IP adresēm. Neskaita, ja pārlūkā ieslēgts Do Not Track / GPC. Serverī tiek glabāts tikai tavs izvēlētais vārds un rezultāts.',
}, {
  modeClassic: 'Classic', modeQuick: 'Quick', modeDaily: 'Daily', modeFree: 'Free roam', modeOnline: 'Online', modesAria: 'Game mode',
  modeDescClassic: '5:00 against 7 bots.',
  modeDescQuick: '2:00 sprint, faster growth.',
  modeDescFree: 'No timer, no bots, no ranking.',
  modeDescDaily: '{twist}. One ranked attempt per day.',
  modeDescDailyUsed: '{twist}. Ranked attempt used — practice.',
  dailyIntroTitle: 'Daily challenge', twistLbl: "Today's twist", practiceTag: 'practice — not ranked',
  twistoldtown: 'Start in the Old Town', twistcentre: 'Start by the Freedom Monument', twistbots9: '9 bots', twistquiet: 'Only 3 bots',
  twisttough: 'Smarter, faster bots', twistcrowd: '9 bots and an Old Town start',
  endBtn: 'End', freeEnded: 'Walk finished',
  practiceNote: "Practice — today's ranked attempt is already used", freeNote: 'Free roam — nothing is saved',
  globalRankDaily: 'Daily board: #{n}',
  tabYesterday: 'Yesterday', tsTwist: 'Twist: {twist}', tsDaily: 'Day {day}',
  aboutPrivacy: 'Privacy: the game uses no cookies and no third-party scripts. Only anonymous daily totals are counted (page views, rounds started/finished per mode, device class, language, quality, errors) — no identifiers, no IP addresses. Nothing is counted if your browser sends Do Not Track / GPC. The server stores only the name you choose and your score.',
});

/** Bots constructed by main.js so any mode / twist (up to 9) can use them; modes activate a subset. */
export const BOT_CAPACITY = 9;
/** Test hook (window.__modes.setDay): the daily setup of another day. The server only accepts today's day, so this cannot be used to rank. */
let dayOverride = null;
const gameDay = () => dayOverride || todayRiga();
export const twistName = (twist) => t('twist' + twist.id);

const KEY = 'bedre.mode';
const ids = ['classic', 'quick', 'daily', 'free'];
const state = { id: 'classic', daily: null, practice: false, ranked: true, bots: CFG.bots.count };
let game = null, params = null, baseDifficulty = CFG.bots.difficulty, touched = false, savedNames = null;

try { const v = localStorage.getItem(KEY); if (ids.includes(v)) state.id = v; } catch { /* storage blocked */ }

export const getMode = () => state.id;
export const modeState = () => ({ ...state });
export function setMode(id) {
  if (!ids.includes(id)) return;
  state.id = id;
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  refreshUi();
  bus.emit('modeChange', id);
}

/** What src/scores.js should ask the server for: null = no server round (free roam, daily practice). */
export function roundRequest() {
  if (state.id === 'free' || !state.ranked) return null;
  return state.id === 'daily' ? { mode: 'daily', day: state.daily.day } : { mode: state.id };
}

// ---- UI ----------------------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function refreshUi() {
  const d = dailyInfo(gameDay());
  for (const b of document.querySelectorAll('#modesw [data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === state.id));
  document.body.classList.remove(...ids.map((i) => 'mode-' + i));
  document.body.classList.add('mode-' + state.id);
  const el = $('mode-desc');
  if (!el) return;
  const key = state.id === 'daily' ? (dailyUsed(d.day) ? 'modeDescDailyUsed' : 'modeDescDaily')
    : 'modeDesc' + state.id[0].toUpperCase() + state.id.slice(1);
  el.textContent = t(key, { day: d.day, twist: twistName(d.twist) });
}

function showDailyIntro(info, practice) {
  let el = $('daily-intro');
  if (!el) { el = document.createElement('div'); el.id = 'daily-intro'; document.body.appendChild(el); }
  el.replaceChildren();
  const mk = (cls, txt) => { const e = document.createElement('div'); e.className = cls; e.textContent = txt; el.append(e); };
  mk('di-title', `${t('dailyIntroTitle')} · ${info.day}`);
  mk('di-twist', `${t('twistLbl')}: ${twistName(info.twist)}`);
  if (practice) mk('di-prac', t('practiceTag'));
  el.className = 'show';
  clearTimeout(showDailyIntro.timer);
  showDailyIntro.timer = setTimeout(() => { el.className = ''; }, 5200);
}

// ---- applying a mode to the Game ------------------------------------------------------------------------------
function setBots(g, n) {
  const dropped = g.bots.setActive(n);
  g.holes = [g.player, ...g.bots.holes];
  for (const h of dropped) {
    const tag = g.hud.tagEls.get(h.id); if (tag) { tag.el.remove(); g.hud.tagEls.delete(h.id); }
    const mk = g.hud.markers && g.hud.markers.get(h.id); if (mk) { mk.remove(); g.hud.markers.delete(h.id); }
  }
}

/** Street spawn nearest to a landmark (or fixed fallback), preferring food-rich spots; installed on the picker instance for one round. */
function pinSpawn(g, which) {
  const lm = (re, fb) => { const l = (g.world.data.landmarks || []).find((q) => re.test(q.n || '')); return l ? [l.x, l.z] : fb; };
  const [tx, tz] = which === 'centre' ? lm(/Brīvības piemineklis/i, [3, -1]) : lm(/Melngalvju nams/i, [-380, 470]);
  const picker = g.picker;
  picker.player = function (avoid = []) {
    const res = this.reserved;
    if (res && avoid.every((a) => Math.hypot(res.x - a.x, res.z - a.z) > 150)) return [res.x, res.z];
    const near = this.pts.map((c) => [Math.hypot(c.x - tx, c.z - tz), c]).filter(([d]) => d < 260).sort((a, b) => a[0] - b[0]);
    const pool = (near.length ? near : this.pts.map((c) => [Math.hypot(c.x - tx, c.z - tz), c]).sort((a, b) => a[0] - b[0]).slice(0, 20));
    let best = pool[0][1], bs = -Infinity;
    for (const [d, c] of pool) {
      let s = Math.min(this._density(c), 120) - d * 0.12;
      for (const a of avoid) s -= Math.max(0, 200 - Math.hypot(c.x - a.x, c.z - a.z)) * 0.5;
      if (s > bs) { bs = s; best = c; }
    }
    return [best.x, best.z];
  };
}

function setup(g) {
  const id = state.id, M = MODES[id];
  state.practice = false; state.ranked = M.ranked;
  CFG.growth.k = M.growthK;
  if (!g.timeOverride) g.roundSeconds = id === 'free' ? 1e9 : M.seconds;   // the server's answer (POST /api/rounds) wins at the timer start
  if (id === 'free') g.modeUnranked = 'free';

  const daily = id === 'daily' ? dailyInfo(gameDay()) : null;
  state.daily = daily || dailyInfo(gameDay());
  const tw = daily ? daily.twist : null;
  if (daily) {
    state.practice = dailyUsed(daily.day);
    if (state.practice) { g.modeUnranked = 'practice'; state.ranked = false; }
  }

  const urlBots = params.has('bots');
  if (!urlBots) setBots(g, id === 'free' ? 0 : (tw && tw.bots) || M.bots);

  // deterministic bots + spawns for the daily challenge; back to normal afterwards
  const wantDifficulty = tw && tw.difficulty ? tw.difficulty : baseDifficulty;
  const special = !!daily || touched || CFG.bots.difficulty !== wantDifficulty;
  if (special) {
    CFG.bots.difficulty = wantDifficulty;
    g.bots.reseed(daily ? daily.seed : null);
    g.picker.rng = mulberry32(daily ? (daily.seed ^ 0x9e3779b9) >>> 0 : (Math.random() * 4294967296) >>> 0);
    touched = !!daily;
  }
  delete g.picker.player;                                  // drop a previous pinned spawn
  if (tw && tw.spawn) pinSpawn(g, tw.spawn);

  const sub = document.querySelector('#results .sub');   // results title: "Time's up" / "Walk finished" (results are hidden now)
  if (sub) { sub.dataset.i18n = id === 'free' ? 'freeEnded' : 'timeUp'; sub.textContent = t(sub.dataset.i18n); }
  document.body.classList.toggle('mode-practice', state.practice);
  if (daily) showDailyIntro(daily, state.practice);
  else { const el = $('daily-intro'); if (el) el.className = ''; }
  refreshUi();
}

export function initModes(g, { params: p = new URLSearchParams(location.search) } = {}) {
  game = g; params = p;
  baseDifficulty = CFG.bots.difficulty;
  const urlMode = p.get('mode');
  if (ids.includes(urlMode)) state.id = urlMode;
  if (!p.has('bots')) setBots(g, CFG.bots.count);          // main.js builds BOT_CAPACITY bots; classic uses the usual 7
  bus.on('modeSetup', setup);
  bus.on('roundGo', () => { if (state.id === 'daily' && state.ranked) markDailyUsed(state.daily.day); });
  for (const b of document.querySelectorAll('#modesw [data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
  const end = $('end-free');
  if (end) end.addEventListener('click', () => { if (g.phase === 'playing') g.end(); });
  onLang(refreshUi);
  refreshUi();
  window.__modes = { get state() { return modeState(); }, setMode, setDay: (d) => { dayOverride = d || null; refreshUi(); }, daily: () => dailyInfo(gameDay()), TWISTS };
}
