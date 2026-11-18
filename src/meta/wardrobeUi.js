// Wardrobe tab (progress panel), the level badge (start screen "My progress" button, results), the XP / level-up block on the results screen and the
// CSS of the cosmetic name tags. All text via mt(); item names come from the catalogue (src/skins.js).
import { bus } from '../events.js';
import { getLang } from '../i18n.js';
import { CFG } from '../config.js';
import { mt } from './strings.js';
import { SKINS, SLOTS } from '../skins.js';
import { level, equipped, equip, unlocked, isNew, markSeen, ctx, newCount } from './wardrobe.js';
import { ruleProgress, key } from './unlock.js';
import { drawHole, drawItem } from './skinArt.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const NS = 'http://www.w3.org/2000/svg';
const nm = (it) => (getLang() === 'lv' ? it.lv : it.en);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const tagCss = SKINS.tag.filter((g) => g.id > 0).map((g) =>
  `.tag[data-sk="${g.id}"]{background:${hex(g.bg)};color:${hex(g.fg)};box-shadow:0 0 0 2px ${hex(g.frame)},0 2px 6px rgba(0,0,0,.3)}` +
  `.tag.me[data-sk="${g.id}"]{box-shadow:0 0 0 2px ${hex(g.frame)},0 0 0 4px var(--terra),0 2px 6px rgba(0,0,0,.3)}` +
  `.tag.leader[data-sk="${g.id}"]{background:${hex(g.bg)}}`).join('\n');

const CSS = `${tagCss}
.lv-badge{display:inline-block;width:26px;height:26px;vertical-align:-7px;margin-right:6px;flex:none}.lv-badge circle.t{fill:#fff;stroke:var(--cream2);stroke-width:3.2}.lv-badge circle.p{fill:none;stroke:var(--terra);stroke-width:3.2;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
.lv-badge text{font:900 17px system-ui,sans-serif;fill:var(--ink);text-anchor:middle}
#open-progress .lv-new{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--terra);margin-left:5px;vertical-align:2px}
.wd-top{display:flex;gap:12px;align-items:center;background:#fff;border-radius:12px;padding:9px 12px;box-shadow:inset 0 0 0 2px var(--cream2);margin-bottom:10px}
.wd-top .lv-badge{width:52px;height:52px;margin:0}.wd-top .lv-badge text{font-size:16px}
.wd-lv{font-size:15px;font-weight:900}.wd-xp{font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:5px}.wd-top .mp-bar{margin-bottom:0;height:8px}
.wd-prev{display:block;width:100%;height:128px;border-radius:12px;box-shadow:inset 0 0 0 2px var(--cream2);margin-bottom:6px}
.wd-note{font-size:11.5px;color:var(--ink2);font-weight:600;line-height:1.3;margin:0 0 8px}
.wd-h{font-size:13px;font-weight:900;margin:10px 0 6px;color:var(--ink)}
.wd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.wd-card{position:relative;font:inherit;text-align:center;background:#fff;border:0;border-radius:12px;padding:5px 5px 7px;box-shadow:inset 0 0 0 2px var(--cream2);cursor:pointer;min-width:0;color:var(--ink)}
.wd-card.eq{box-shadow:inset 0 0 0 3px var(--terra)}.wd-card.sel{box-shadow:inset 0 0 0 3px var(--slate)}.wd-card.eq.sel{box-shadow:inset 0 0 0 3px var(--terra)}
.wd-card canvas{display:block;width:100%;height:56px;border-radius:8px}
.wd-card.lock canvas{filter:grayscale(.85) brightness(.9);opacity:.75}
.wd-n{font-weight:800;font-size:12px;line-height:1.15;margin-top:4px;overflow-wrap:anywhere}
.wd-s{font-size:10.5px;font-weight:700;color:var(--ink2);line-height:1.25;margin-top:2px;overflow-wrap:anywhere}.wd-card.eq .wd-s{color:var(--terra2)}
.wd-new{position:absolute;top:3px;right:3px;font-size:9px;font-weight:900;letter-spacing:.06em;background:var(--terra);color:#fff;border-radius:999px;padding:1px 6px}
.wd-lock{position:absolute;top:6px;left:7px;font-size:12px;opacity:.85}
@media (max-width:560px){.wd-grid{grid-template-columns:repeat(2,1fr)}}
#wd-xp-block{margin:4px 0 0;text-align:center}
.wd-xpline{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:900;color:var(--terra2)}
.wd-xpline .lv-badge{margin:0}
#wd-xp-block small{display:block;font-size:12px;color:var(--ink2);font-weight:700;margin-top:2px}
#wd-xp-block .mp-bar{max-width:240px;margin:4px auto 0;height:6px}
#wd-xp-block.up .lv-badge{animation:wdpop .9s ease-out 2}
#wd-xp-block .wd-up{font-weight:900;color:var(--verd)}
#wd-xp-extra{margin:0 0 10px}.wd-xpd{font-size:12px;font-weight:700;color:var(--ink2);margin:0 0 4px}.wd-unl{font-size:13px;font-weight:800;color:var(--ink);margin:2px 0}
.wd-open{font:inherit;font-size:13px;font-weight:800;color:var(--terra2);background:none;border:0;text-decoration:underline;cursor:pointer;padding:6px 8px;min-height:44px}
@keyframes wdpop{0%{transform:scale(.6)}45%{transform:scale(1.35)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){#wd-xp-block.up .lv-badge{animation:none}}
`;

/** SVG level badge with a progress ring. */
export function badge(lv, frac, size) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 40 40'); s.setAttribute('class', 'lv-badge'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', mt('wdBadge', { n: lv }));
  if (size) { s.style.width = s.style.height = size + 'px'; }
  const r = 16, C = 2 * Math.PI * r;
  const t = document.createElementNS(NS, 'circle'); t.setAttribute('class', 't'); t.setAttribute('cx', 20); t.setAttribute('cy', 20); t.setAttribute('r', r);
  const p = document.createElementNS(NS, 'circle'); p.setAttribute('class', 'p'); p.setAttribute('cx', 20); p.setAttribute('cy', 20); p.setAttribute('r', r);
  p.setAttribute('stroke-dasharray', `${(C * Math.max(0.02, Math.min(1, frac))).toFixed(1)} ${C.toFixed(1)}`);
  const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', 20); tx.setAttribute('y', 25.6); tx.textContent = String(lv);
  s.append(t, p, tx);
  return s;
}

export function unlockText(it, slot) {
  const u = it.u, c = ctx();
  if (!u) return '';
  const pr = ruleProgress(u, c);
  switch (u.t) {
    case 'lv': return mt('wdLvUnlock', { n: u.n, have: c.level });
    case 'rw': { const m = /^streak-(\d+)$/.exec(u.id); return m ? mt('wdStreakUnlock', { n: m[1] }) : u.id; }
    case 'wk': return mt('wdWeekUnlock', { tier: mt('tier_' + u.tier).toLowerCase(), have: pr.have, need: pr.need });
    case 'ach': { const d = (window.__meta && window.__meta.defs || []).find((x) => x.id === u.id); return mt('wdAchUnlock', { name: d ? (getLang() === 'lv' ? d.lv : d.en) : u.id }); }
    case 'alb': return mt('wdAlbUnlock', { have: pr.have, need: pr.need });
    default: return '';
  }
}

export function initWardrobeUi({ game, openPanel }) {
  const style = document.createElement('style'); style.id = 'wardrobe-style'; style.textContent = CSS; document.head.appendChild(style);
  let preview = null, sel = null;     // sel = [slot, id] being previewed (not worn)

  const applyWorn = () => { game.player.skin = equipped(); };
  applyWorn();
  bus.on('skinChange', applyWorn);

  // ---- level badge on the start screen's "My progress" button ------------------------------------------------------------------
  function decorate(btn) {
    if (!btn) return;
    const lv = level();
    btn.textContent = '';
    btn.append(badge(lv.level, lv.frac), document.createTextNode(mt('myProgress')));
    if (newCount() > 0) btn.append(el('i', 'lv-new'));
    btn.dataset.level = String(lv.level);
  }
  const refreshAll = () => { for (const b of document.querySelectorAll('[data-meta-open]')) decorate(b); };

  // ---- the tab -------------------------------------------------------------------------------------------------------------------
  function renderTab(root) {
    root.replaceChildren();
    const lv = level(), un = unlocked(), eq = equipped();
    const top = el('div', 'wd-top'); top.id = 'wd-top';
    top.append(badge(lv.level, lv.frac));
    const tx = el('div'); tx.style.flex = '1'; tx.style.minWidth = '0';
    tx.append(el('div', 'wd-lv', mt('wdLevel', { n: lv.level })), el('div', 'wd-xp', lv.max ? mt('wdMax') : mt('wdXp', { a: lv.into.toLocaleString('en').replace(/,/g, ' '), b: lv.need.toLocaleString('en').replace(/,/g, ' ') })));
    const bar = el('div', 'mp-bar'); const f = el('i'); f.style.width = `${Math.round(100 * lv.frac)}%`; bar.append(f); tx.append(bar);
    top.append(tx); root.append(top);
    preview = el('canvas', 'wd-prev'); preview.id = 'wd-preview'; preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', mt('wdPreview'));
    root.append(preview, el('p', 'wd-note', mt('wdHint') + ' ' + mt('wdHintOnline')));
    root.dataset.level = String(lv.level); root.dataset.equipped = eq.join(',');
    const draw = () => {
      const sk = eq.slice(); if (sel) sk[sel[0]] = sel[1];
      drawHole(preview, { rim: sk[0], trail: sk[1], tag: sk[2], ident: game.player.color.getHex(), name: game.player.name || 'Tu', withTag: true });
    };
    const cards = [];
    SLOTS.forEach((slot, si) => {
      root.append(el('div', 'wd-h', mt('wdGroup' + slot[0].toUpperCase() + slot.slice(1))));
      const grid = el('div', 'wd-grid'); grid.dataset.slot = slot;
      for (const it of SKINS[slot]) {
        const owned = un.has(key(si, it.id)), worn = eq[si] === it.id;
        const c = el('button', 'wd-card' + (worn ? ' eq' : '') + (owned ? '' : ' lock')); c.type = 'button'; c.dataset.slot = String(si); c.dataset.id = String(it.id); c.dataset.state = worn ? 'worn' : owned ? 'owned' : 'locked';
        const cv = el('canvas'); c.append(cv);
        c.append(el('div', 'wd-n', nm(it)));
        c.append(el('div', 'wd-s', worn ? '✓ ' + mt('wdEquipped') : owned ? '' : unlockText(it, si)));
        if (!owned) c.append(el('span', 'wd-lock', '🔒'));
        if (isNew(si, it.id)) c.append(el('span', 'wd-new', mt('wdNew')));
        c.setAttribute('aria-label', nm(it) + (worn ? ', ' + mt('wdEquipped') : owned ? '' : ', ' + unlockText(it, si)));
        c.addEventListener('click', () => {
          if (owned) { if (equip(si, it.id)) { sel = null; markSeen(); renderTab(root); refreshAll(); } }
          else { sel = [si, it.id]; draw(); for (const o of cards) o.classList.toggle('sel', o === c); }
        });
        grid.append(c); cards.push(c);
        requestAnimationFrame(() => drawItem(cv, si, it.id, game.player.color.getHex()));
      }
      root.append(grid);
    });
    root.append(el('p', 'wd-note', mt('wdTrailLow')));
    requestAnimationFrame(draw);
    markSeen();
    setTimeout(refreshAll, 0);
  }

  // ---- results: XP / level-up block (compact line in the header; the details + unlocked items live in the Progress tab) -----------------------------------
  let lastAward = null;
  function showAward(a) {
    lastAward = a;
    const head = document.querySelector('#results .r-head'); if (!head) return;
    let b = document.getElementById('wd-xp-block');
    if (!b) { b = el('div'); b.id = 'wd-xp-block'; b.setAttribute('aria-live', 'polite'); const sl = document.getElementById('rt-streak-line'); if (sl && sl.parentNode === head) sl.after(b); else head.append(b); }
    b.replaceChildren(); b.className = a && a.levelUp ? 'up' : '';
    if (!a || a.total <= 0) { b.append(el('small', '', mt('xpNone'))); b.dataset.xp = '0'; return; }
    b.dataset.xp = String(a.total); b.dataset.level = String(a.after.level);
    const line = el('div', 'wd-xpline'); line.append(badge(a.after.level, a.after.frac), el('span', '', mt('xpGain', { n: a.total })));
    if (a.levelUp) line.append(el('span', 'wd-up', '· ' + mt('lvUp', { n: a.after.level })));
    b.append(line);
    const bar = el('div', 'mp-bar'); const f = el('i'); f.style.width = `${Math.round(100 * (a.levelUp ? 1 : a.after.frac))}%`; bar.append(f); b.append(bar);
    if (a.levelUp) requestAnimationFrame(() => { f.style.transition = 'width .6s ease-out'; f.style.width = `${Math.round(100 * a.after.frac)}%`; });
  }
  /** Progress tab of the results: how the XP was made up + the items this round unlocked (called after the recap built the pane). */
  function extras(root) {
    const a = lastAward; if (!root || !a || a.total <= 0) return 0;
    const sec = el('section', 'wd-xp-extra'); sec.id = 'wd-xp-extra';
    sec.append(el('div', 'rc-sec', mt('xpGain', { n: a.total }) + ' · ' + mt('wdLevel', { n: a.after.level })), el('div', 'wd-xpd', mt('xpDetail', { base: a.base, place: a.place, score: a.score, goals: a.goals, streak: a.streak })));
    if (a.items.length) {
      sec.append(el('div', 'wd-unl', mt('lvUnlocked', { names: a.items.map(([s, id]) => nm(SKINS[SLOTS[s]][id])).join(', ') })));
      const o = el('button', 'wd-open', mt('lvWardrobe')); o.type = 'button'; o.addEventListener('click', () => openPanel('wardrobe')); sec.append(o);
    }
    root.prepend(sec);
    return a.items.length;
  }
  const clearAward = () => { lastAward = null; const b = document.getElementById('wd-xp-block'); if (b) b.replaceChildren(); };

  return { renderTab, decorate, refreshAll, showAward, extras, clearAward, newCount };
}
