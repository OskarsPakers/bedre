// Wardrobe + player level state (device-local, one versioned key, every access in try/catch; no accounts, nothing leaves the device except the
// three small skin ids a player sends in the online hello). Pure logic lives in level.js / unlock.js; this file is the storage + glue.
//   { v:1, xp, eq:[rim,trail,tag], seen:['slot:id'..], ach:[achievement ids], alb: most album objects seen on any map, rounds }
import { bus } from '../events.js';
import { loadG } from './store.js';
import { levelOf, roundXp } from './level.js';
import { unlockedSet, sanitizeEquipped, key } from './unlock.js';
import { SKINS, SLOTS, DEFAULT_SKIN } from '../skins.js';

export const WKEY = 'bedre.wardrobe.v1';
const blank = () => ({ v: 1, xp: 0, eq: [0, 0, 0], seen: [], ach: [], alb: 0, rounds: 0 });
let st = null;

export function load() {
  if (st) return st;
  st = blank();
  try {
    const o = JSON.parse(localStorage.getItem(WKEY) || 'null');
    if (o && o.v === 1) st = { ...blank(), ...o, xp: Math.max(0, Math.floor(+o.xp || 0)), eq: Array.isArray(o.eq) ? o.eq.slice(0, 3) : [0, 0, 0], seen: Array.isArray(o.seen) ? o.seen : [], ach: Array.isArray(o.ach) ? o.ach : [] };
  } catch { /* corrupt or blocked: start empty */ }
  return st;
}
export function save() { try { localStorage.setItem(WKEY, JSON.stringify(st || blank())); } catch { /* ignore */ } }
export const reload = () => { st = null; return load(); };

export const level = () => levelOf(load().xp);
const rewards = () => { try { return Object.keys(loadG().rewards || {}); } catch { return []; } };
export const ctx = () => ({ level: level().level, rewards: rewards(), ach: load().ach, album: load().alb });
export const unlocked = () => unlockedSet(ctx());
export const isUnlocked = (slot, id) => unlocked().has(key(slot, id));
/** The skin that is worn: stored choice cleaned against what is owned. */
export const equipped = () => sanitizeEquipped(load().eq, unlocked());

export function equip(slot, id) {
  if (!(slot >= 0 && slot < 3) || !SKINS[SLOTS[slot]][id] || !isUnlocked(slot, id)) return false;
  const s = load(), eq = equipped(); eq[slot] = id; s.eq = eq; save();
  bus.emit('skinChange', eq);
  return true;
}

export const isNew = (slot, id) => id > 0 && isUnlocked(slot, id) && !load().seen.includes(key(slot, id));
export const newCount = () => { let n = 0; SLOTS.forEach((s, si) => { for (const it of SKINS[s]) if (isNew(si, it.id)) n++; }); return n; };
export function markSeen() {
  const s = load(), u = unlocked(); const seen = new Set(s.seen);
  for (const k of u) seen.add(k);
  s.seen = [...seen]; save();
}

/** Remember achievements / album progress from the (per-map) meta store: they unlock a couple of items on every map. */
export function noteMeta({ ach, album }) {
  const s = load(); let ch = false;
  if (Array.isArray(ach)) for (const a of ach) if (!s.ach.includes(a)) { s.ach.push(a); ch = true; }
  if (Number.isFinite(album) && album > s.alb) { s.alb = album; ch = true; }
  if (ch) save();
}

/**
 * XP for a finished round (eligibility is decided by the caller, the same rule as the streak). Returns the breakdown + level before / after + the items
 * this round unlocked. Free roam / debug rounds: eligible = false -> nothing happens.
 */
export function awardRound(info) {
  const s = load(), before = level(), uBefore = unlocked();
  const xp = roundXp(info);
  if (xp.total > 0) { s.xp += xp.total; s.rounds++; save(); }
  const after = level(), uAfter = unlocked();
  const items = [];
  SLOTS.forEach((sl, si) => { for (const it of SKINS[sl]) { const k = key(si, it.id); if (uAfter.has(k) && !uBefore.has(k)) items.push([si, it.id]); } });
  const out = { ...xp, before, after, levelUp: after.level > before.level, items };
  bus.emit('xpAward', out);
  return out;
}

/** The skin ids sent in the online hello (cleaned; locked choices are never sent). */
export const equippedSkin = () => { try { return equipped(); } catch { return DEFAULT_SKIN.slice(); } };
