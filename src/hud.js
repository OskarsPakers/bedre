// HTML overlay: timer, score, size bar, popups, labels, start/results panels.
import { CFG } from './config.js';
import { t, fmt, getLang, onLang, extendStrings } from './i18n.js';
import { cleanName, sanitizeName } from '../worker/lib/moderation.js';   // the same name policy as the scores API and the multiplayer server
import { bus } from './events.js';
import { PU_TYPES, PU } from './powerups.js';
import { iconCanvas, PU_COLOR } from './powerupView.js';
const $ = (id) => document.getElementById(id);
extendStrings({
  nameAs: 'Tiks rādīts kā: {n}',
  puMagnet: 'Magnēts', puSpeed: 'Ātrums', puDouble: 'Dubultpunkti', puShield: 'Vairogs',
  puMagnetHint: 'Tuvumā esošais slīd pie tevis', puSpeedHint: 'Kustība ātrāka ×1,5', puDoubleHint: 'Punkti ×2 (kopā ar kombo)', puShieldHint: 'Lielākās bedres tevi nevar norīt',
  rCombo: 'Labākais kombo', comboLbl: 'Kombo', comboLost: 'Kombo beidzies',
  aboutCombo: 'Kombo: norijot objektus ātri cits pēc cita, punkti tiek reizināti līdz ×3 (bedres izmērs no tā neaug ātrāk).',
  aboutPowerups: 'Pastiprinājumi uz kartes: Magnēts, Ātrums, Dubultpunkti, Vairogs. Virzi bedri tiem pāri, lai tos savāktu.',
}, {
  nameAs: 'Shown as: {n}',
  puMagnet: 'Magnet', puSpeed: 'Speed', puDouble: 'Double points', puShield: 'Shield',
  puMagnetHint: 'Nearby things slide towards you', puSpeedHint: 'Move 1.5x faster', puDoubleHint: 'Points x2 (stacks with the combo)', puShieldHint: 'Bigger holes cannot swallow you',
  rCombo: 'Best combo', comboLbl: 'Combo', comboLost: 'Combo lost',
  aboutCombo: 'Combos: swallow things in quick succession and your points are multiplied up to ×3 (your size does not grow faster because of it).',
  aboutPowerups: 'Power-ups on the map: Magnet, Speed, Double points, Shield. Steer the hole over one to collect it.',
});
const cap = (s0) => s0[0].toUpperCase() + s0.slice(1);
const multText = (m) => '×' + (Math.round(m * 10) % 10 === 0 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, ''));
const MULT_COL = { 1: '#ffffff', 1.2: '#ffe08a', 1.5: '#ffc84a', 2: '#ff9d3c', 2.5: '#ff7440', 3: '#ff4d3d' };

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), score: $('score'), time: $('time'), eaten: $('eaten'), timeCard: $('card-time'),
      level: $('size-level'), diam: $('size-diam'), fill: $('size-fill'), popups: $('popups'), labels: $('labels'),
      start: $('start'), eatenEl: $('eaten'), board: $('board-list'), tags: $('tags'), feed: $('feed'), sw: $('swallowed'),
      name: $('name'), results: $('results'), play: $('play'), again: $('again'),
    };
    this._last = {};
    this.tagEls = new Map();
    this.boardRows = [];
    try { const n = localStorage.getItem('bedre.name'); if (n && this.el.name) this.el.name.value = n; } catch (e) { /* storage blocked */ }
    onLang(() => { this._last = {}; this._lastRes = null; this._nameHint(); });
    this._bindName();
    this._buildFx();
  }

  // ---- combo chip + power-up badges + pickup toast (one small stack above the player's hole) -----------------------------
  _buildFx() {
    const box = document.createElement('div');
    box.id = 'fx-hud'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="fx-toast" hidden><img alt=""><div><b></b><span></span></div></div>' +
      '<div class="combo-chip" id="combo-chip" hidden><span class="cc-ring"><b class="cc-n">0</b></span><span class="cc-x">×1</span><span class="cc-l"></span></div>' +
      '<div class="fx-badges" id="fx-badges"></div>';
    document.body.appendChild(box);
    this.fxBox = box;
    this.fxToast = box.querySelector('.fx-toast');
    this.chip = box.querySelector('.combo-chip');
    this.badgeBox = box.querySelector('.fx-badges');
    this.badges = {};
    this._icon = {};
    for (const type of PU_TYPES) {
      this._icon[type] = iconCanvas(type, 64).toDataURL();
      const b = document.createElement('span');
      b.className = 'fx-badge'; b.dataset.type = type; b.hidden = true; b.style.setProperty('--c', PU_COLOR[type]);
      b.innerHTML = `<img alt=""><span class="nm"></span><b></b><i></i>`;
      b.firstChild.src = this._icon[type];
      this.badgeBox.appendChild(b);
      this.badges[type] = { el: b, t: b.querySelector('b'), bar: b.querySelector('i'), nm: b.querySelector('.nm'), last: '' };
    }
    this._cc = { shown: false, key: '', p: -1, lostT: 0 };
    bus.on('combo', (e) => {
      if (!e || !e.hole || !e.hole.isPlayer) return;
      if (e.step) { this.chip.classList.remove('step'); void this.chip.offsetWidth; this.chip.classList.add('step'); }
    });
    onLang(() => { this._cc.key = ''; for (const k of PU_TYPES) this.badges[k].last = ''; });
  }

  /** Pickup toast (name + what it does) above the hole for ~2 s. */
  puToast(type, dur) {
    const el = this.fxToast, n = cap(type);
    if (this._compact()) {   // phones / short windows: no floating toast (it would sit on a HUD lane or the hole): the badge itself names the pickup for a moment
      const B = this.badges[type]; B.nm.textContent = t('pu' + n); B.el.classList.add('new');
      clearTimeout(B.newT); B.newT = setTimeout(() => B.el.classList.remove('new'), 2300);
      return;
    }
    el.hidden = false;
    el.querySelector('img').src = this._icon[type];
    el.querySelector('b').textContent = `${t('pu' + n)} · ${dur} s`;
    el.querySelector('span').textContent = t('pu' + n + 'Hint');
    el.style.setProperty('--c', PU_COLOR[type]);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, 2300);
  }

  _compact() { return window.matchMedia('(max-width: 900px), (max-height: 520px)').matches; }

  /** Per frame (while playing): `hole` = the player's alive hole (null hides everything), `tag` = its screen item { x, y } (y = top edge of the hole on screen), `now` = round clock. */
  updateFx(hole, tag, now) {
    const box = this.fxBox, C = this._cc;
    if (!hole || !tag) { if (!box.hidden) { box.hidden = true; C.shown = false; this.chip.hidden = true; this.fxToast.hidden = true; } return; }
    const c = hole.combo, fx = hole.fx;
    // chip
    const total = Math.min(5, c.mult * fx.doubleMul);
    const live = c.count >= 3;
    if (live) {
      C.shown = true; clearTimeout(C.lostT);
      this.chip.classList.remove('lost'); this.chip.hidden = false;
      const key = `${Math.floor(c.count)}|${total}|${getLang()}`;
      if (key !== C.key) {
        C.key = key;
        this.chip.querySelector('.cc-n').textContent = String(Math.floor(c.count));
        const x = this.chip.querySelector('.cc-x'); x.textContent = multText(total);
        const col = MULT_COL[c.mult] || '#fff';
        this.chip.style.setProperty('--c', col);
        this.chip.classList.toggle('dbl', fx.doubleMul > 1);
        this.chip.querySelector('.cc-l').textContent = fx.doubleMul > 1 ? '×2' : '';
      }
      const p = Math.round(c.left(now, hole.radius) * 100);
      if (p !== C.p) { C.p = p; this.chip.style.setProperty('--p', p); }
    } else if (C.shown) {
      C.shown = false; C.key = '';
      this.chip.classList.add('lost');
      C.lostT = setTimeout(() => { if (!C.shown) this.chip.hidden = true; this.chip.classList.remove('lost'); }, 750);
    }
    // badges
    let any = false;
    for (const type of PU_TYPES) {
      const B = this.badges[type], left = fx[type];
      if (left > 0) {
        any = true;
        if (B.el.hidden) B.el.hidden = false;
        const txt = `${Math.ceil(left)}`;
        if (txt !== B.last) { B.last = txt; B.t.textContent = txt; }
        B.bar.style.transform = `scaleX(${Math.min(1, left / this._dur(type)).toFixed(3)})`;
        B.el.classList.toggle('low', left < 2);
      } else if (!B.el.hidden) { B.el.hidden = true; B.last = ''; }
    }
    const visible = !this.chip.hidden || any || !this.fxToast.hidden;
    if (box.hidden !== !visible) box.hidden = !visible;
    if (!visible) return;
    const w = window.innerWidth, vh = window.innerHeight, h = box.offsetHeight || 60;
    const x = Math.max(86, Math.min(w - 86, tag.x));
    // above the name tag when there is room under the top HUD row, otherwise (short landscape screens) just below the hole
    const SAFE_TOP = 118;
    const bottom = tag.y - 30;
    if (bottom - h < SAFE_TOP && tag.cy != null) {   // short landscape screens: no room above the hole, so the stack sits beside it (right side), centred on it
      const bw = box.offsetWidth || 90;
      if (w <= 700) {   // tiny landscape: both side lanes (feed left, achievements right) are busy: sit below the hole
        const top = Math.min(vh - 70 - h, tag.cy + (tag.pr || 30) + 8);
        box.style.transform = `translate(${Math.min(w - bw / 2 - 8, Math.max(bw / 2 + 8, tag.x)).toFixed(1)}px, ${top.toFixed(1)}px) translate(-50%, 0)`;
        return;
      }
      const sx = Math.min(w - bw / 2 - 8, tag.x + (tag.pr || 30) + 14 + bw / 2);
      box.style.transform = `translate(${sx.toFixed(1)}px, ${tag.cy.toFixed(1)}px) translate(-50%, -50%)`;
      return;
    }
    box.style.transform = `translate(${x.toFixed(1)}px, ${bottom.toFixed(1)}px) translate(-50%, -100%)`;
  }
  _dur(type) { return PU[type].dur; }

  /** Live preview of the name as the others will see it (angle brackets / invisible characters removed, filter -> "Anonīms"); on blur the field itself is normalised. */
  _bindName() {
    const inp = this.el.name;
    if (!inp || !inp.parentElement) return;
    const hint = document.createElement('div');
    hint.id = 'name-hint'; hint.className = 'name-hint'; hint.setAttribute('aria-live', 'polite');
    inp.parentElement.after(hint);
    this._hintEl = hint;
    inp.addEventListener('input', () => { this._nameHint(); this._saveName(); });
    inp.addEventListener('blur', () => { const c = cleanName(inp.value).slice(0, 14); if (c !== inp.value.trim()) inp.value = c; this._nameHint(); this._saveName(); });
    this._nameHint();
  }
  _nameHint() {
    const inp = this.el.name, hint = this._hintEl;
    if (!inp || !hint) return;
    const typed = inp.value.trim().replace(/\s+/g, ' ');
    const shown = typed ? (sanitizeName(typed.slice(0, 14)) || '') : '';
    hint.textContent = shown && shown !== typed ? t('nameAs', { n: shown }) : '';
  }
  _saveName() { try { const n = cleanName(this.el.name.value).slice(0, 14); if (n) localStorage.setItem('bedre.name', n); } catch (e) { /* ignore */ } }

  /** Player's chosen display name (remembered in localStorage). */
  getName(fallback = CFG.playerName) {
    let n = cleanName(this.el.name?.value || '').slice(0, 14);
    try { if (n) localStorage.setItem('bedre.name', n); } catch (e) { /* ignore */ }
    return n || fallback;
  }

  _set(k, text) {
    if (this._last[k] !== text) { this._last[k] = text; this.el[k].textContent = text; }
  }

  update({ score, timeLeft, eaten, level, diameter, progress }) {
    this._set('score', fmt(score));
    const secs = Math.max(0, Math.ceil(timeLeft));
    this._set('time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    this.el.timeCard.classList.toggle('low', timeLeft <= CFG.roundWarn && timeLeft > 0);
    this._set('eaten', String(eaten));
    this._set('level', t('size', { n: level }));
    this._set('diam', `Ø ${diameter < 100 ? diameter.toFixed(1) : Math.round(diameter)} m`);
    const w = `${(progress * 100).toFixed(1)}%`;
    if (this._last.fillw !== w) { this._last.fillw = w; this.el.fill.style.width = w; }
  }

  showHud(v) { this.el.hud.classList.toggle('hidden', !v); }

  popup(px, py, text, big = false, hot = false) {
    if (this.el.popups.childElementCount > 14) this.el.popups.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : '') + (hot ? ' hot' : '');   // hot: multiplied points (combo / double), warmer colour
    d.textContent = text;
    d.style.left = px + 'px'; d.style.top = py + 'px';
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  label(text, landmark = false) {
    while (this.el.labels.childElementCount >= 2) this.el.labels.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'lab' + (landmark ? ' lm' : '');
    d.innerHTML = '';
    d.append(document.createTextNode(text));
    const i = document.createElement('i'); i.textContent = '✓'; d.append(i);
    this.el.labels.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  clearTransient() {
    this.el.popups.innerHTML = ''; this.el.labels.innerHTML = ''; this.el.feed.innerHTML = '';
    if (this.fxBox) { this.fxBox.hidden = true; this.chip.hidden = true; this.fxToast.hidden = true; this._cc.shown = false; this._cc.key = ''; for (const k of PU_TYPES) { this.badges[k].el.hidden = true; this.badges[k].last = ''; } }
    this.showSwallowed(false); this.clearGo();
  }

  // ---- leaderboard (top N + the player, highlighted) -------------------------------------------
  /** Compact chip (phones): "3. · 1 240 · -180" = your rank, points and the gap to the player above (or the lead over the next one). */
  _chip(rows) {
    const i = rows.findIndex((r) => r.isPlayer);
    if (i < 0) return;
    const me = rows[i], other = rows[i - 1] || rows[i + 1];
    const gap = other ? (i > 0 ? me.score - other.score : me.score - other.score) : 0;   // negative: behind, positive: ahead
    const key = `${me.rank}|${Math.floor(me.score)}|${Math.floor(gap)}`;
    if (key === this._chipKey) return;
    this._chipKey = key;
    const k = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.floor(v)));
    const g = $('chip-gap'), chip = $('board-chip');
    const set = (short) => {
      const f = short ? k : fmt;
      $('chip-rank').textContent = me.rank === 1 ? '\u265b' : `${me.rank}.`;
      $('chip-score').textContent = f(me.score);
      g.textContent = other ? `${gap < 0 ? '\u2212' : '+'}${f(Math.abs(gap))}` : '';
    };
    set(false);
    if (chip && chip.clientWidth && chip.scrollWidth > chip.clientWidth + 1) set(true);   // narrow phones / big numbers: abbreviate instead of clipping
    g.className = gap < 0 ? 'down' : 'up';
  }

  updateBoard(rows, topN) {
    this._chip(rows);
    const show = rows.slice(0, topN);
    const me = rows.find((r) => r.isPlayer);
    if (me && me.rank > topN) show.push(me);
    const list = this.el.board;
    while (this.boardRows.length < show.length) {
      const li = document.createElement('li');
      li.innerHTML = '<b class="rk"></b><i class="dot"></i><span class="nm"></span><em class="sc"></em>';
      list.appendChild(li);
      this.boardRows.push({ li, rk: li.children[0], dot: li.children[1], nm: li.children[2], sc: li.children[3], key: '' });
    }
    for (let i = 0; i < this.boardRows.length; i++) {
      const R = this.boardRows[i], r = show[i];
      if (!r) { R.li.style.display = 'none'; R.key = ''; continue; }
      const key = `${r.rank}|${r.name}|${Math.floor(r.score)}|${r.isPlayer}|${r.color}|${r.alive}`;
      if (key === R.key) continue;
      R.key = key;
      R.li.style.display = '';
      R.li.className = (r.isPlayer ? 'me ' : '') + (r.alive ? '' : 'dead ') + (r.rank > topN ? 'gap' : '');
      R.rk.textContent = r.rank === 1 ? '♛' : r.rank;
      R.dot.style.background = r.color;
      R.nm.textContent = r.name;
      R.sc.textContent = fmt(r.score);
    }
  }

  // ---- name tags floating above holes ------------------------------------------------------------
  /** Screen rects of everything a name tag must not sit on (HUD cards, round buttons, transient banners); refreshed ~3x / s and on resize. */
  _hudRects() {
    const now = performance.now();
    if (this._hr && now - this._hrAt < 350) return this._hr;
    this._hrAt = now;
    const out = [];
    for (const el of document.querySelectorAll('#hud .card, #board-chip, #meta-pct, #meta-area, #feed > *, #swallowed, #hud-btns > button, #mp-net, #end-free, #fx-hud:not([hidden]) > *:not([hidden])')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) out.push({ l: r.left - 2, r: r.right + 2, t: r.top - 2, b: r.bottom + 2 });
    }
    return (this._hr = out);
  }

  updateTags(items) {
    // items: [{ id, name, color, x, y, visible, leader, me }]
    const rects = this._hudRects();
    for (const it of items) {
      let t = this.tagEls.get(it.id);
      if (!t) {
        const el = document.createElement('div');
        el.className = 'tag';
        el.innerHTML = '<span class="crown">♛</span><i></i><span class="n"></span>';
        this.el.tags.appendChild(el);
        t = { el, vis: true, name: '', leader: null, me: null, crown: el.children[0], dot: el.children[1], n: el.children[2] };
        this.tagEls.set(it.id, t);
      }
      if (t.name !== it.name) { t.name = it.name; t.w = 0; t.n.textContent = it.name; t.dot.style.background = it.color; }
      if (t.tg !== (it.tg || 0)) { t.tg = it.tg || 0; if (t.tg) t.el.dataset.sk = String(t.tg); else delete t.el.dataset.sk; }   // cosmetic tag look (src/meta/wardrobe.css)
      if (t.leader !== it.leader) { t.leader = it.leader; t.el.classList.toggle('leader', it.leader); }
      if (t.me !== it.me) { t.me = it.me; t.el.classList.toggle('me', it.me); }
      if (t.vis !== it.visible) { t.vis = it.visible; t.el.style.display = it.visible ? '' : 'none'; }
      if (it.visible) {
        t.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) translate(-50%, -100%)`;
        // a tag that would land on a HUD card / button fades out while it does (they are also layered below the HUD)
        const w = t.w || (t.w = t.el.offsetWidth || 80), h = t.h || (t.h = t.el.offsetHeight || 22);
        const l = it.x - w / 2, r = it.x + w / 2, tp = it.y - h, b = it.y;
        let occ = false;
        for (const q of rects) if (l < q.r && r > q.l && tp < q.b && b > q.t) { occ = true; break; }
        if (t.occ !== occ) { t.occ = occ; t.el.classList.toggle('occluded', occ); }
      }
    }
  }

  // ---- round-start overview markers (rings in each hole's colour; the player's pulses) ---------
  showMarkers(v) {
    if (!this.markerBox) { this.markerBox = document.createElement('div'); this.markerBox.id = 'markers'; document.body.appendChild(this.markerBox); this.markers = new Map(); }
    this.markerBox.style.display = v ? '' : 'none';
  }

  updateMarkers(items, holes, fade, time) {
    if (!this.markerBox) return;
    this.markerBox.style.opacity = String(Math.max(0, Math.min(1, fade)));
    for (let i = 0; i < items.length; i++) {
      const it = items[i], h = holes[i];
      let m = this.markers.get(it.id);
      if (!m) {
        m = document.createElement('div');
        m.className = 'mk' + (h.isPlayer ? ' me' : '');
        m.style.setProperty('--c', it.color);
        this.markerBox.appendChild(m);
        this.markers.set(it.id, m);
      }
      m.style.display = it.visible ? '' : 'none';
      m.style.transform = `translate(${it.x.toFixed(1)}px, ${(it.y + 4).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  /** "Resuming in 3 / 2 / 1" after a pause on phones (0 hides it). */
  showResume(n) {
    let d = this._res;
    if (!d) { d = this._res = document.createElement('div'); d.id = 'resume-count'; document.body.appendChild(d); }
    d.hidden = !n; if (n) d.textContent = String(n);
  }

  /** Ring pulse around the player's hole (px centre / px diameter). */
  ring(x, y, d, big) {
    let r = this._ring;
    if (!r) { r = this._ring = document.createElement('div'); r.id = 'hole-ring'; document.body.appendChild(r); }
    r.style.left = x.toFixed(0) + 'px'; r.style.top = y.toFixed(0) + 'px';
    r.style.setProperty('--d', Math.max(36, Math.min(Math.hypot(window.innerWidth, window.innerHeight) * 0.5, d)).toFixed(0) + 'px');
    r.classList.remove('go'); void r.offsetWidth; r.classList.toggle('big', !!big); r.classList.add('go');
  }

  clearGo() { if (this._go) { this._go.remove(); this._go = null; } }

  go(text) {
    this.clearGo();
    const d = document.createElement('div');
    d.className = 'go'; d.textContent = text;
    document.body.appendChild(d);
    this._go = d;
    setTimeout(() => d.remove(), 1100);
  }

  showTags(v) { this.el.tags.style.display = v ? '' : 'none'; }

  feedItem(html, color) {
    while (this.el.feed.childElementCount >= 3) this.el.feed.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'feed-item';
    d.append(...html);
    if (color) d.style.borderLeftColor = color;
    this.el.feed.appendChild(d);
    setTimeout(() => d.remove(), 3400);
  }

  showSwallowed(v, by, color, secs) {
    const sw = this.el.sw;
    if (!v) { sw.classList.add('hidden'); return; }
    sw.classList.remove('hidden');
    if (by !== undefined) { $('sw-by').textContent = by; $('sw-dot').style.background = color; }
    $('sw-t').textContent = String(Math.max(1, Math.ceil(secs)));
  }

  showPause(v) { $('pause').classList.toggle('hidden', !v); if (v) setTimeout(() => { try { $('resume').focus({ preventScroll: true, focusVisible: false }); } catch (e) { /* ignore */ } }, 0); }

  showStart(v) { this.el.start.classList.toggle('hidden', !v); }
  setReady(ready, text) { this.el.play.disabled = !ready; if (text) this.el.play.textContent = text; }

  /** Global-rank line on the results panel (text '' clears it). */
  setGlobal(text, muted = false) {
    const e = $('r-global');
    e.textContent = text;
    e.classList.toggle('muted', !!muted);
  }

  /** Small retry button under the global-rank line (null hides it). */
  setRetry(text) {
    const box = $('turnstile-retry'), b = $('ts-retry');
    if (!box || !b) return;
    box.hidden = !text; if (text) b.textContent = text;
  }

  showResults(v, s) {
    if (v) this.clearGo();
    if (v && s) {
      this.setGlobal(''); this.setRetry(null);
      $('r-score').textContent = fmt(s.score);
      $('r-eaten').textContent = s.eaten;
      $('r-biggest').textContent = s.biggest;
      $('r-size').textContent = s.size;
      $('r-kills').textContent = s.kills;
      const rc = $('r-combo'); if (rc) rc.textContent = s.bestCombo ? `${s.bestCombo} · ${multText(s.bestMult || 1)}` : '—';
      $('r-deaths').textContent = s.deaths;
      $('r-place').textContent = placeText(s.rank, s.total);
      $('r-place').dataset.rank = s.rank;
      const tb = $('r-table').firstElementChild;
      tb.innerHTML = '';
      for (const r of s.table) {
        const tr = document.createElement('tr');
        if (r.isPlayer) tr.className = 'me';
        const c = (t, cls) => { const td = document.createElement('td'); td.textContent = t; if (cls) td.className = cls; return td; };
        const dotTd = document.createElement('td'); const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = r.color; dotTd.append(dot);
        tr.append(c(r.rank === 1 ? '♛' : r.rank, 'rk'), dotTd, c(r.name, 'nm'), c(fmt(r.score), 'sc'));
        tb.appendChild(tr);
      }
    }
    this.el.results.classList.toggle('hidden', !v);
    if (v) setTimeout(() => { try { $('again').focus({ preventScroll: true, focusVisible: false }); } catch (e) { /* ignore */ } }, 50); // keyboard users land on Play again
  }
}

export function placeText(rank, total) {
  if (getLang() === 'lv') return t('placeOf', { n: rank, total });
  return t('placeOf', { n: ordinal(rank), total });
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
