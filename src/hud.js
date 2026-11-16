// HTML overlay: timer, score, size bar, popups, labels, start/results panels.
import { CFG } from './config.js';
import { t, fmt, getLang, onLang } from './i18n.js';
const $ = (id) => document.getElementById(id);

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
    onLang(() => { this._last = {}; this._lastRes = null; });
  }

  /** Player's chosen display name (remembered in localStorage). */
  getName(fallback = CFG.playerName) {
    let n = (this.el.name?.value || '').trim().replace(/\s+/g, ' ').slice(0, 14);
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

  popup(px, py, text, big = false) {
    if (this.el.popups.childElementCount > 14) this.el.popups.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : '');
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
    setTimeout(() => d.remove(), 2300);
  }

  clearTransient() {
    this.el.popups.innerHTML = ''; this.el.labels.innerHTML = ''; this.el.feed.innerHTML = '';
    this.showSwallowed(false); this.clearGo();
  }

  // ---- leaderboard (top N + the player, highlighted) -------------------------------------------
  updateBoard(rows, topN) {
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
  updateTags(items) {
    // items: [{ id, name, color, x, y, visible, leader, me }]
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
      if (t.name !== it.name) { t.name = it.name; t.n.textContent = it.name; t.dot.style.background = it.color; }
      if (t.leader !== it.leader) { t.leader = it.leader; t.el.classList.toggle('leader', it.leader); }
      if (t.me !== it.me) { t.me = it.me; t.el.classList.toggle('me', it.me); }
      if (t.vis !== it.visible) { t.vis = it.visible; t.el.style.display = it.visible ? '' : 'none'; }
      if (it.visible) t.el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) translate(-50%, -100%)`;
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

  showResults(v, s) {
    if (v) this.clearGo();
    if (v && s) {
      this.setGlobal('');
      $('r-score').textContent = fmt(s.score);
      $('r-eaten').textContent = s.eaten;
      $('r-biggest').textContent = s.biggest;
      $('r-size').textContent = s.size;
      $('r-kills').textContent = s.kills;
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
