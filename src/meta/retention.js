// Retention glue: daily streak + weekly goals + rewards. Called once from progress.js (initMeta) and driven by the event bus.
//   * start screen: two small chips beside "My progress" (streak flame + number + today tick; "Goals n/3")
//   * results screen: a streak line (when today's round extended the streak) and the goals the round advanced
//   * progress panel tab "Week": streak facts, the weekly goals card (progress bars, time left), reward badges
//   * share card: one optional line (streak + goals done), no personal data
// Everything is device-local (src/meta/store.js global key). Rewards are ids on the bus (`rewardUnlocked`); see rewards.js.
import { bus } from '../events.js';
import { onLang, getLang } from '../i18n.js';
import { loadG, saveG } from './store.js';
import { today } from './clock.js';
import { mt } from './strings.js';
import { applyDay, viewStreak, lvDays, MILESTONES } from './streak.js';
import { grantReward, renderBadges } from './rewards.js';
import { initGoals } from './goals.js';
import { POOL, pickGoals, weekKey } from './goalPool.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const NS = 'http://www.w3.org/2000/svg';
function flame() {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'rt-flame');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M12 2C12 6.2 7 8.6 7 14.2a5 5 0 0 0 10 0c0-2.3-1-3.9-2.1-5.2-.3 1.7-1.2 2.5-2.3 2.5C13.7 9 13.5 5 12 2z');
  s.append(p); return s;
}

const CSS = `
.rt-chip{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:800;line-height:1;color:var(--ink2);background:#fff;border:0;border-radius:999px;padding:0 10px;min-height:30px;min-width:44px;justify-content:center;white-space:nowrap;cursor:pointer;box-shadow:inset 0 0 0 2px var(--cream2);flex:none}
.rt-chip:hover{box-shadow:inset 0 0 0 2px var(--terra)}.rt-chip b{color:var(--ink);font-variant-numeric:tabular-nums}
.rt-flame{width:13px;height:13px;fill:#b7ad9a;flex:none}.rt-chip[data-alive="1"] .rt-flame{fill:var(--terra)}
.rt-seg{display:inline-flex;align-items:center;gap:4px}.rt-sep{width:1px;height:14px;background:var(--cream2)}
@media (max-width:340px){.rt-gl{display:none}.start-foot .linkrow{column-gap:6px}}
.rt-chip .rt-st{font-size:11px;font-weight:900;color:var(--ink2)}.rt-chip[data-state="done"] .rt-st{color:var(--verd)}
.rt-chip[data-state="open"] .rt-st{width:7px;height:7px;border-radius:50%;box-shadow:inset 0 0 0 2px #b7ad9a;display:inline-block}
.start-foot .linkrow .rt-chip{margin:0}
body.touch .panel .rt-chip{min-height:44px}
#rt-goalind{position:absolute;top:122px;left:50%;transform:translateX(-50%);width:168px;display:flex;gap:4px;pointer-events:none;opacity:.9}
#rt-goalind .pip{flex:1;height:4px;border-radius:3px;background:rgba(246,239,223,.55);box-shadow:0 0 0 1px rgba(43,34,24,.18);overflow:hidden;position:relative;transition:transform .2s}
#rt-goalind .pip i{position:absolute;left:0;top:0;bottom:0;background:var(--terra);display:block;transition:width .3s}
#rt-goalind .pip.done i{background:var(--verd)}
#rt-goalind .pip.tick{animation:rttick .6s ease-out}
@keyframes rttick{40%{transform:scaleY(2.6);filter:brightness(1.3)}}
body.mode-free #rt-goalind{display:none}
.rt-streakline{margin:0 0 4px;font-size:14px;font-weight:800;color:var(--terra2);min-height:0}.rt-streakline:empty{display:none}
.rt-streakline small{display:block;font-size:12px;color:var(--ink2);font-weight:700}
.rt-sec{margin:0 0 12px}.rt-sec h3{margin:0 0 6px;font-size:14px;font-weight:900;color:var(--ink)}
.rt-streakbox{display:flex;gap:10px;align-items:center;background:#fff;border-radius:12px;padding:9px 12px;box-shadow:inset 0 0 0 2px var(--cream2)}
.rt-streakbox .rt-flame{width:30px;height:30px}.rt-streakbox.alive .rt-flame{fill:var(--terra)}.rt-sb-n{font-size:15px;font-weight:900}.rt-sb-s{font-size:12px;font-weight:700;color:var(--ink2);line-height:1.35}
.rt-card{background:#fff;border-radius:12px;padding:9px 12px 10px;box-shadow:inset 0 0 0 2px var(--cream2);margin-bottom:12px}
.rt-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}.rt-head h3{margin:0;font-size:14px;font-weight:900}.rt-left{font-size:12px;font-weight:700;color:var(--ink2);white-space:nowrap}
.rt-goal{padding:6px 0;border-top:1px solid var(--cream2)}.rt-goal:first-of-type{border-top:0}.rt-gtop{display:flex;gap:8px;align-items:baseline}
.rt-tier{font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:2px 7px;background:var(--cream2);color:var(--ink2);flex:none}
.rt-tier.t-medium{background:#f3dcc0;color:#8a5a1c}.rt-tier.t-hard{background:#f1c9bb;color:#9a3a1b}
.rt-gname{font-size:13.5px;font-weight:800;min-width:0;overflow-wrap:anywhere}.rt-goal.done .rt-gname{color:var(--verd)}
.rt-gprog{display:flex;gap:8px;align-items:center;margin-top:4px;font-size:11px;font-weight:700;color:var(--ink2)}.rt-goal.done .mp-bar i{background:var(--verd)}
.rt-gval{white-space:nowrap;min-width:64px;text-align:right}
.rt-badges{display:flex;flex-wrap:wrap;gap:6px}.rt-badge{display:inline-flex;align-items:center;gap:6px;background:#fff;border-radius:999px;padding:4px 11px 4px 8px;font-size:12px;font-weight:800;box-shadow:inset 0 0 0 2px #d9a52f}.rt-badge i{font-style:normal;font-size:14px}
.rt-empty{font-size:12.5px;font-weight:600;color:var(--ink2);margin:0}
.rc-chip.rt-done{box-shadow:inset 0 0 0 2px var(--verd)}
#rt-round-goals .rc-chip{display:inline-block;max-width:100%;white-space:normal;border-radius:14px}
@media (max-width:560px){#rt-goalind{top:calc(env(safe-area-inset-top,0px) + 3px);width:120px}}
`;

export function initRetention({ game, world, album, areaAt, toast, openPanel, eligibleNow, eligibleEnd }) {
  const style = document.createElement('style'); style.id = 'retention-style'; style.textContent = CSS; document.head.appendChild(style);
  const goals = initGoals({ game, world, album, areaAt, toast, eligibleNow, eligibleEnd });
  let last = null, deferred = [];      // last = what today's round did to the streak (for the results line), deferred = toasts for the next round

  // ---- streak ------------------------------------------------------------------------------------------------------------------
  const view = () => viewStreak(loadG().streak, today());
  const bucket = (n) => (n >= 30 ? '30+' : n >= 14 ? '14-29' : n >= 7 ? '7-13' : n >= 3 ? '3-6' : String(n));
  /** An eligible round ended (the round counts for the Riga day it ENDS on). */
  function recordStreak() {
    const g = loadG(), r = applyDay(g.streak, today());
    if (!r.changed) { last = null; return null; }
    saveG();
    if (r.milestone) {
      grantReward('streak-' + r.milestone, 'streak');
      deferred.push({ icon: '🔥', text: mt('streakMile', { n: r.milestone }) });
    }
    bus.emit('track', 'streak:' + bucket(r.cur));
    last = r;
    return r;
  }

  // ---- start screen: ONE compact chip beside "My progress" (streak flame + number + today tick | goals n/3) ------------------------
  // The start card is already full at 320x568 (two link rows), so the two chips are folded into one that sits on the "My progress" row;
  // the label word "Goals" is dropped on very narrow phones (CSS).
  const chip = el('button', 'rt-chip'); chip.type = 'button'; chip.id = 'rt-chip';
  const sFlame = flame(), sNum = el('b'), sSt = el('span', 'rt-st'), sep = el('span', 'rt-sep'), gLbl = el('span', 'rt-gl'), gNum = el('b');
  sep.setAttribute('aria-hidden', 'true');
  const seg1 = el('span', 'rt-seg'), seg2 = el('span', 'rt-seg');
  seg1.append(sFlame, sNum, sSt); seg2.append(gLbl, gNum);
  chip.append(seg1, sep, seg2);
  chip.addEventListener('click', () => openPanel('week'));
  const prog = document.getElementById('open-progress');
  if (prog && prog.parentNode) prog.after(chip);
  function drawChips() {
    const v = view(), n = goals.doneCount();
    sNum.textContent = String(v.cur);
    chip.dataset.alive = v.alive ? '1' : '0'; chip.dataset.state = v.doneToday ? 'done' : 'open'; chip.dataset.done = String(n);
    sSt.textContent = v.doneToday ? '✓' : '';
    gLbl.textContent = mt('goalsLbl'); gNum.textContent = `${n}/3`;
    const label = `${mt('streakAria', { n: v.cur, today: v.doneToday ? mt('streakDone') : mt('streakOpen') })} · ${mt('goalsAria', { n })}`;
    chip.setAttribute('aria-label', label); chip.title = `${label} · ${goals.timeLeft()}`;
    if (window.__ui && window.__ui.summary) try { window.__ui.summary(); } catch { /* ignore */ }   // keeps the daily dot in step with the chip
  }

  // ---- results screen ------------------------------------------------------------------------------------------------------
  let line = null;
  function ensureLine() {
    if (line && line.isConnected) return line;
    const head = document.querySelector('#results .r-head'); if (!head) return null;
    line = el('p', 'rt-streakline'); line.id = 'rt-streak-line'; line.setAttribute('aria-live', 'polite');
    const gr = document.getElementById('r-global'); if (gr && gr.parentNode === head) gr.after(line); else head.append(line);
    return line;
  }
  function drawLine() {
    const l = ensureLine(); if (!l) return;
    l.replaceChildren();
    if (!last) return;
    const r = last;
    l.append(document.createTextNode((r.milestone ? '🔥 ' : '') + (r.cur === 1 ? mt('streakStart') : mt('streakExt', { n: r.cur, days: getLang() === 'lv' ? lvDays(r.cur) : 'days' }))));
    const extra = [];
    if (r.froze) extra.push('❄ ' + mt('freezeUsed'));
    if (r.freezeEarned) extra.push('❄ ' + mt('freezeEarned'));
    if (extra.length) l.append(el('small', '', extra.join(' ')));
  }

  // ---- progress panel tab ----------------------------------------------------------------------------------------------------
  function renderWeek(root) {
    root.replaceChildren();
    const v = view(), g = loadG().streak;
    const s1 = el('section', 'rt-sec'); s1.id = 'rt-streak-sec';
    s1.append(el('h3', '', mt('streakTitle')));
    const box = el('div', 'rt-streakbox' + (v.alive ? ' alive' : '')); box.append(flame());
    const tx = el('div'); tx.append(el('div', 'rt-sb-n', v.cur > 0 ? mt('streakNow', { n: v.cur, days: getLang() === 'lv' ? lvDays(v.cur) : v.cur === 1 ? 'day' : 'days' }) : mt('streakNone')));
    tx.append(el('div', 'rt-sb-s', [v.cur > 0 ? (v.doneToday ? mt('streakDone') : mt('streakOpen')) : '', mt('streakBest', { n: v.best }), mt('freezes', { n: v.freezes })].filter(Boolean).join(' · ')));
    tx.append(el('div', 'rt-sb-s', mt('freezeHint')));
    box.append(tx); s1.append(box);
    box.dataset.cur = String(v.cur); box.dataset.freezes = String(g.freezes || 0);
    root.append(s1);
    goals.renderCard(root);
    const s3 = el('section', 'rt-sec'); s3.id = 'rt-rewards-sec'; s3.append(el('h3', '', mt('rwTitle')));
    renderBadges(s3); root.append(s3);
  }

  // ---- events ------------------------------------------------------------------------------------------------------------------
  /** progress.js calls this on roundEnd, before the recap is built. */
  function onRoundEnd(res) {
    last = null;
    const eligible = eligibleEnd();
    if (eligible) recordStreak();
    goals.commit(res);
    drawChips(); drawLine();
  }
  // toasts that cannot show over the results panel (streak milestones) come out when the next round starts (with or without the fly-in)
  const flushDeferred = () => { if (deferred.length) { const d = deferred.splice(0); setTimeout(() => d.forEach((x) => toast(x.icon, x.text, { ms: 4200 })), 900); } };
  bus.on('introStart', () => { last = null; drawLine(); drawChips(); flushDeferred(); });
  bus.on('roundGo', flushDeferred);
  onLang(() => { drawChips(); drawLine(); });
  setInterval(drawChips, 30000);                       // a midnight / Monday rollover while the start screen is open
  window.addEventListener('focus', drawChips); document.addEventListener('visibilitychange', () => { if (!document.hidden) drawChips(); });
  drawChips();

  /** One optional line for the share card (no personal data): streak + goals completed. */
  const cardExtra = () => {
    const v = view(), n = goals.doneCount(), parts = [];
    if (v.cur >= 2) parts.push(mt('cardStreak', { n: v.cur }));
    if (n > 0) parts.push(mt('cardGoals', { n }));
    return parts.join(' · ');
  };

  return {
    goals, view, renderWeek, onRoundEnd, drawChips, drawLine, cardExtra, recordStreak,
    recapExtra: (root) => goals.renderRound(root),
    recapCount: () => goals.advancedCount(),
    lastStreak: () => last, MILESTONES,
    // test hooks (scripts/smoke-meta.mjs): the pool, the pick for any day, and pinning this week's goals to chosen templates
    POOL, pickGoals, weekKey, today,
    pickFor: (day, salt = '') => pickGoals(day, { available: goals.available, salt }).map((t) => t.id),
    setGoals: (ids) => { const g = loadG().goals; g.week = weekKey(today()); g.ids = ids; g.prog = {}; g.done = {}; g.all = false; saveG(); goals.drawIndicator(); drawChips(); },
  };
}
