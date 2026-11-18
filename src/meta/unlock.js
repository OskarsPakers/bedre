// Which cosmetic items a device owns (PURE: tests in scripts/test-f45.mjs). Inputs are plain data read from the meta stores:
//   level (player level), rewards (reward ids of src/meta/rewards.js, every past week included), ach (achievement ids), album (objects collected).
// Weekly families: reward ids `week-YYYY-WW-easy|medium|hard|all` are counted per tier (each id is one completed week); the n-th completion of a tier
// unlocks the n-th item listed for that tier in src/skins.js (WEEK_ITEMS), so goals completed before this feature existed count too and a
// future week simply unlocks the next item (when a tier runs out the extra weeks only give XP).
import { SKINS, SLOTS } from '../skins.js';

export const key = (slot, id) => slot + ':' + id;

export function weekCounts(rewards) {
  const c = { easy: 0, medium: 0, hard: 0, all: 0 };
  for (const id of new Set(rewards || [])) { const m = /^week-\d{4}-\d{2}-(easy|medium|hard|all)$/.exec(id); if (m) c[m[1]]++; }
  return c;
}

/** Is one rule satisfied? */
export function ruleMet(u, ctx, wc) {
  if (!u) return true;
  switch (u.t) {
    case 'lv': return ctx.level >= u.n;
    case 'rw': return (ctx.rewards || []).includes(u.id);
    case 'wk': return wc[u.tier] >= u.n;
    case 'ach': return (ctx.ach || []).includes(u.id);
    case 'alb': return (ctx.album || 0) >= u.n;
    default: return false;
  }
}

/** Set of 'slot:id' keys that are unlocked. */
export function unlockedSet(ctx) {
  const wc = weekCounts(ctx.rewards), out = new Set();
  SLOTS.forEach((s, si) => { for (const it of SKINS[s]) if (ruleMet(it.u, ctx, wc)) out.add(key(si, it.id)); });
  return out;
}

/** Progress towards a locked item's rule: { have, need } (for "3 / 5" style hints); null for rules without a number. */
export function ruleProgress(u, ctx) {
  if (!u) return null;
  const wc = weekCounts(ctx.rewards);
  if (u.t === 'lv') return { have: ctx.level, need: u.n };
  if (u.t === 'wk') return { have: wc[u.tier], need: u.n };
  if (u.t === 'alb') return { have: ctx.album || 0, need: u.n };
  return null;
}

/** Equipped skin cleaned against what is owned (a locked / unknown id falls back to 0 in its slot). */
export function sanitizeEquipped(eq, owned) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) { const v = Array.isArray(eq) ? eq[i] : 0; if (Number.isInteger(v) && SKINS[SLOTS[i]][v] && owned.has(key(i, v))) out[i] = v; }
  return out;
}
