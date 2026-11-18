// Persistent local progress (album, achievements, counters). One versioned key; every access is try/catch'd (private mode, blocked storage).
// album / achievements progress is per map: the centre keeps the legacy key
const MAPSLUG = (() => { try { return new URLSearchParams(location.search).get('map') || localStorage.getItem('bedre.map') || 'centrs'; } catch { return 'centrs'; } })();
const KEY = MAPSLUG === 'centrs' || !/^[a-z0-9-]+$/.test(MAPSLUG) ? 'bedre.meta.v1' : 'bedre.meta.v1.' + MAPSLUG;
const blank = () => ({ v: 1, album: {}, ach: {}, ctr: { pigeons: 0, rounds: 0, wins: 0, cars: 0 }, best: {} });
let state = null, timer = 0;

export function load() {
  if (state) return state;
  state = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.v === 1) state = { ...blank(), ...o, ctr: { ...blank().ctr, ...(o.ctr || {}) } };
    }
  } catch { /* corrupt or blocked: start empty */ }
  return state;
}
export function save() {
  clearTimeout(timer); timer = 0;
  try { localStorage.setItem(KEY, JSON.stringify(state || blank())); } catch { /* ignore */ }
}
export function saveSoon() { if (!timer) timer = setTimeout(save, 1500); }
export function reloadFromDisk() { state = null; return load(); }
window.addEventListener('pagehide', () => { if (timer) save(); });

// ---- global (NOT per map) retention state: daily streak, weekly goals, rewards. One versioned key for the whole device. ----------------
// { v:1, streak:{cur,best,last,freezes,frozen[]}, goals:{week,ids[],prog{},done{},all}, rewards:{id:{d,s}}, seen:{event:1} }
export const GKEY = 'bedre.meta.global.v1';
const gblank = () => ({
  v: 1,
  streak: { cur: 0, best: 0, last: '', freezes: 0, frozen: [] },
  goals: { week: '', ids: [], prog: {}, done: {}, all: false },
  rewards: {}, seen: {},
});
let gstate = null, gtimer = 0;
export function loadG() {
  if (gstate) return gstate;
  gstate = gblank();
  try {
    const raw = localStorage.getItem(GKEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.v === 1) {
        const b = gblank();
        gstate = { ...b, ...o, streak: { ...b.streak, ...(o.streak || {}) }, goals: { ...b.goals, ...(o.goals || {}) }, rewards: o.rewards || {}, seen: o.seen || {} };
      }
    }
  } catch { /* corrupt or blocked: start empty */ }
  return gstate;
}
export function saveG() {
  clearTimeout(gtimer); gtimer = 0;
  try { localStorage.setItem(GKEY, JSON.stringify(gstate || gblank())); } catch { /* ignore */ }
}
export function saveGSoon() { if (!gtimer) gtimer = setTimeout(saveG, 1500); }
export function reloadG() { gstate = null; return loadG(); }
window.addEventListener('pagehide', () => { if (gtimer) saveG(); });
