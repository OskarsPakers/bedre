// Cosmetic reward ids. A reward is recorded ONCE per device in the global store and announced on the bus as `rewardUnlocked`(id, info).
// Ids: 'streak-3|7|14|30|60|100'; 'week-YYYY-WW-easy|medium|hard'; 'week-YYYY-WW-all' (all three goals of an ISO week).
// A later feature maps ids to hole skins; for now the progress panel lists them as badges.
import { bus } from '../events.js';
import { loadG, saveG } from './store.js';
import { today } from './clock.js';
import { mt } from './strings.js';

export function grantReward(id, src = '') {
  const g = loadG();
  if (g.rewards[id]) return false;
  g.rewards[id] = { d: today(), s: src };
  saveG();
  bus.emit('rewardUnlocked', id, { src, day: g.rewards[id].d });
  return true;
}
export const hasReward = (id) => !!loadG().rewards[id];
export const rewardIds = () => Object.keys(loadG().rewards);

/** Display info for an id: { icon, name } (LV/EN). Unknown ids still render (their id is the name). */
export function rewardInfo(id) {
  let m = /^streak-(\d+)$/.exec(id);
  if (m) return { icon: '🔥', name: mt('rwStreak', { n: m[1] }) };
  m = /^week-(\d{4})-(\d{2})-(easy|medium|hard|all)$/.exec(id);
  if (m) return { icon: m[3] === 'all' ? '★' : '◆', name: m[3] === 'all' ? mt('rwAll', { w: +m[2] }) : mt('rwWeek', { tier: mt('tier_' + m[3]).toLowerCase(), w: +m[2] }) };
  return { icon: '◆', name: id };
}

export function renderBadges(root) {
  const ids = rewardIds().sort();
  const box = document.createElement('div'); box.className = 'rt-badges'; box.dataset.rewards = ids.join(' ');
  if (!ids.length) { const p = document.createElement('p'); p.className = 'rt-empty'; p.textContent = mt('rwNone'); root.append(p); return; }
  for (const id of ids) {
    const i = rewardInfo(id); const b = document.createElement('span'); b.className = 'rt-badge'; b.dataset.id = id;
    const ic = document.createElement('i'); ic.textContent = i.icon; b.append(ic, document.createTextNode(i.name)); box.append(b);
  }
  root.append(box);
}
