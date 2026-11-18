// Weekly goals: the template pool + deterministic weekly picking. Pure data/functions (no DOM, no storage), importable from Node.
//
// A template measures one number per ROUND from the live round context `c`:
//   sw(o, entry, c) -> n   : counted for every object the player swallows (o = world object, entry = album entry or undefined)
//   rd(c)           -> n   : read from the round context (level, kills, banks crossed, distance, ...); `end:true` = only valid once the round ended
// `type`: 'sum' (added up over the week), 'best' (best single round), 'days' (distinct days on which the round metric was > 0).
// `maps` / `modes` restrict WHERE it counts (omitted = anywhere); `special` = needs a non-default map or an online match (at most one per week);
// `needs` = gated on an event the game may not emit yet ('comboBest', 'powerupPicked'): offered only once seen on the device or CFG.features says so.
// Round context c: { map, mode ('classic'|'quick'|'daily'|'online'), kills, level, score, banks, dist(m), combo, picks, won, ended, rank, acc{}, sets{} }.
import { hashSeed, shiftDay } from '../rules.js';
import { mulberry32 } from '../rng.js';

export const TIERS = ['easy', 'medium', 'hard'];
export const kindOf = (o) => String(o.kind || '').replace(/^person\d+$/, 'person');
export const isChurch = (o) => !!o.isBuilding && /baznīca|katedrāle|\bDoms\b/i.test(o.name || '');
const kinds = (...ks) => { const s = new Set(ks); return (o) => (s.has(kindOf(o)) ? 1 : 0); };
const cls = (k) => (o) => (o.cls === k ? 1 : 0);
/** counts each album entry once per round (per template) */
const distinctSights = (id) => (o, e, c) => { if (!e) return 0; const set = (c.sets[id] ||= new Set()); if (set.has(e.id)) return 0; set.add(e.id); return 1; };
const G = (id, tier, lv, en, target, type, def) => ({ id, tier, lv, en, target, type, ...def });

export const POOL = [
  // ---- easy ------------------------------------------------------------------------------------------------------
  G('people300', 'easy', 'Norij {n} cilvēkus', 'Swallow {n} people', 300, 'sum', { sw: kinds('person') }),
  G('cars100', 'easy', 'Norij {n} automašīnas', 'Swallow {n} cars', 100, 'sum', { sw: kinds('car', 'van', 'taxi') }),
  G('churches2', 'easy', 'Norij {n} baznīcas', 'Swallow {n} churches', 2, 'sum', { sw: (o) => (isChurch(o) ? 1 : 0) }),
  G('trees600', 'easy', 'Norij {n} kokus', 'Swallow {n} trees', 600, 'sum', { sw: cls('tree') }),
  G('pigeons25', 'easy', 'Norij {n} baložus', 'Swallow {n} pigeons', 25, 'sum', { sw: kinds('pigeon') }),
  G('rounds3', 'easy', 'Nospēlē {n} kārtas', 'Play {n} rounds', 3, 'sum', { rd: (c) => (c.ended ? 1 : 0), end: true }),
  G('quick2', 'easy', 'Pabeidz {n} Ātrās kārtas', 'Finish {n} Quick rounds', 2, 'sum', { modes: ['quick'], rd: (c) => (c.ended ? 1 : 0), end: true }),
  G('sights4', 'easy', 'Savāc {n} Rīgas objektus', 'Collect {n} Rīga album objects', 4, 'sum', { sw: distinctSights('sights4') }),
  G('picks3', 'easy', 'Paņem {n} pastiprinājumus vienā kārtā', 'Pick up {n} power-ups in one round', 3, 'best', { needs: 'powerupPicked', rd: (c) => c.picks }),
  // ---- medium ----------------------------------------------------------------------------------------------------
  G('transit30', 'medium', 'Norij {n} tramvajus un autobusus', 'Swallow {n} trams and buses', 30, 'sum', { sw: kinds('tram', 'bus', 'trolleybus') }),
  G('win1', 'medium', 'Uzvari kārtu', 'Win a round', 1, 'sum', { rd: (c) => (c.won ? 1 : 0), end: true }),
  G('winAgen', 'medium', 'Uzvari kārtu Āgenskalnā', 'Win a round in Āgenskalns', 1, 'sum', { maps: ['agenskalns'], special: true, rd: (c) => (c.won ? 1 : 0), end: true }),
  G('level6', 'medium', 'Sasniedz {n}. izmēru', 'Reach size {n}', 6, 'best', { rd: (c) => c.level }),
  G('kills5', 'medium', 'Norij citu bedri {n} reizes', 'Swallow rival holes {n} times', 5, 'sum', { rd: (c) => c.kills }),
  G('online3', 'medium', 'Nospēlē {n} tiešsaistes kārtas', 'Play {n} online rounds', 3, 'sum', { modes: ['online'], special: true, rd: (c) => (c.ended ? 1 : 0), end: true }),
  G('bridge3', 'medium', 'Norij {n} tiltu balstus', 'Swallow {n} bridge supports', 3, 'sum', { maps: ['centrs'], sw: kinds('pylon', 'railarch') }),
  G('buildings250', 'medium', 'Norij {n} ēkas', 'Swallow {n} buildings', 250, 'sum', { sw: (o) => (o.isBuilding ? 1 : 0) }),
  G('dist6', 'medium', 'Nobrauc {n} km', 'Travel {n} km', 6000, 'sum', { scale: 1000, unit: 'km', rd: (c) => c.dist }),
  G('daily3', 'medium', 'Pabeidz dienas izaicinājumu {n} dienas', 'Finish the daily challenge on {n} days', 3, 'days', { maps: ['centrs'], modes: ['daily'], rd: (c) => (c.ended ? 1 : 0), end: true }),
  G('picks5', 'medium', 'Paņem {n} pastiprinājumus', 'Pick up {n} power-ups', 5, 'sum', { needs: 'powerupPicked', rd: (c) => c.picks }),
  // ---- hard (never "hard difficulty": all of these are fine on the default Easy bots) --------------------------------
  G('quickLevel7', 'hard', 'Sasniedz {n}. izmēru Ātrajā režīmā', 'Reach size {n} in Quick mode', 7, 'best', { modes: ['quick'], rd: (c) => c.level }),
  G('daugava4', 'hard', 'Šķērso Daugavu {n} reizes vienā kārtā', 'Cross the Daugava {n} times in one round', 4, 'best', { maps: ['centrs'], rd: (c) => c.banks }),
  G('win3', 'hard', 'Uzvari {n} kārtas', 'Win {n} rounds', 3, 'sum', { rd: (c) => (c.won ? 1 : 0), end: true }),
  G('trees2000Meza', 'hard', 'Norij {n} kokus Mežaparkā', 'Swallow {n} trees in Mežaparks', 2000, 'sum', { maps: ['mezaparks'], special: true, sw: cls('tree') }),
  G('sights12', 'hard', 'Savāc {n} Rīgas objektus', 'Collect {n} Rīga album objects', 12, 'sum', { sw: distinctSights('sights12') }),
  G('kills3round', 'hard', 'Norij {n} pretiniekus vienā kārtā', 'Swallow {n} rivals in one round', 3, 'best', { rd: (c) => c.kills }),
  G('score3000', 'hard', 'Sasniedz {n} punktus vienā kārtā', 'Score {n} points in one round', 3000, 'best', { rd: (c) => c.score }),
  // the combo counter needs 70 for the top x3 multiplier (a casual round reaches ~x1.5-x2, i.e. a counter of 12-45): hard but fair
  G('combo70', 'hard', 'Savieno {n} objektus kombo ķēdē (×3)', 'Chain {n} swallows in a row (×3 combo)', 70, 'best', { needs: 'comboBest', rd: (c) => c.combo }),
];
export const byId = (id) => POOL.find((g) => g.id === id) || null;

/** Does a template count in this round? (map / mode restrictions) */
export const applies = (tpl, c) => (!tpl.maps || tpl.maps.includes(c.map)) && (!tpl.modes || tpl.modes.includes(c.mode));

/** Round value of a template for the round context c (0 when it does not apply or the round has not ended yet for `end` metrics). */
export function roundValue(tpl, c) {
  if (!applies(tpl, c)) return 0;
  if (tpl.sw) return c.acc[tpl.id] || 0;
  if (tpl.end && !c.ended) return 0;
  return tpl.rd ? Math.max(0, +tpl.rd(c) || 0) : 0;
}

export const fmtNum = (n, lang) => {
  const s = String(Math.round(n)); if (s.length < 4) return s;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'lv' ? ' ' : ',');
};
/** Localised text of a template ({n} = the target in display units). */
export function goalText(tpl, lang) {
  const n = tpl.target / (tpl.scale || 1);
  return (lang === 'lv' ? tpl.lv : tpl.en).replace('{n}', fmtNum(n, lang));
}

// ---- ISO weeks (Monday-based) on Riga calendar day strings ---------------------------------------------------------------
const dowMon = (day) => (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;      // Monday = 0
export const weekStart = (day) => shiftDay(day, -dowMon(day));                   // the Monday of that week
/** ISO week id 'YYYY-WW' (ISO year, zero padded week). */
export function weekKey(day) {
  const thu = new Date(shiftDay(day, 3 - dowMon(day)) + 'T00:00:00Z');
  const year = thu.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const wk = 1 + Math.floor((thu.getTime() - jan1) / 864e5 / 7);
  return `${year}-${String(wk).padStart(2, '0')}`;
}
/** Weeks since Monday 1970-01-05. */
export const weekIndex = (day) => Math.floor(Math.round((Date.parse(weekStart(day) + 'T00:00:00Z') - Date.parse('1970-01-05T00:00:00Z')) / 864e5) / 7);

/**
 * The week's goals: [easy, medium, hard] templates for the week containing `day`. Deterministic: depends only on the week (and the
 * optional test `salt`) and on which gated templates are available, never on the player. Each tier walks a seeded permutation of its
 * templates (gated ones only when available), one step per week (so a template does not come back within a cycle); a template that would
 * make a second "special" goal (a non-default map / online) is skipped. Hard first, so the special slot goes to the hardest tier it fits.
 */
export function pickGoals(day, { available = () => true, salt = '' } = {}) {
  const wi = weekIndex(day);
  const picks = {}; let special = 0;
  for (const tier of ['hard', 'medium', 'easy']) {
    const list = POOL.filter((g) => g.tier === tier && available(g));
    const cycle = Math.floor(wi / list.length), pos = wi % list.length;
    const rnd = mulberry32(hashSeed(`bedre-goals|${tier}|${cycle}|${salt}`));
    const perm = list.map((g) => g.id);
    for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let j = 0; j < perm.length; j++) {
      const g = byId(perm[(pos + j) % perm.length]);
      if (g.special && special) continue;
      picks[tier] = g; if (g.special) special++;
      break;
    }
  }
  return TIERS.map((t) => picks[t]).filter(Boolean);
}
