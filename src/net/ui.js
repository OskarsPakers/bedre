// DOM for the online mode: start-screen button + status line, lobby panel, connection indicator. All text via i18n; names via textContent.
import './net.css';
import { t, extendStrings, onLang } from '../i18n.js';

extendStrings({
  mpOnline: 'Tiešsaiste', mpBeta: 'BETA', mpConnecting: 'Savienojas…', mpUnavailable: 'Tiešsaiste šobrīd nav pieejama. Viena spēlētāja režīms darbojas.',
  mpVersion: 'Tiešsaiste šajā pārlūkā pagaidām nedarbojas (Safari, iPhone, Firefox) — labojums ir ceļā. Spēle vienam darbojas: spied “Spēlēt”.', mpLobbyTitle: 'Tiešsaistes istaba', mpWaiting: 'Gaida spēlētājus…',
  mpStartsIn: 'Kārta sākas pēc {n} s', mpNextIn: 'Nākamā kārta sākas pēc {n} s', mpFillBots: 'Visi sāk vienlaikus. Pretinieku bedres (AI) aizpildīs istabu līdz {n} bedrēm.',
  mpPlayers: 'Spēlētāji {n}/{max}', mpYou: 'tu', mpLeave: 'Atstāt', mpRunning: 'Notiek kārta · atlikušas {t}', mpRunningHint: 'Pievienoties var tikai nākamajai kārtai. Pa to laiku vari skatīties līderus.',
  mpReconnecting: 'Savienojums pārtrūka. Atjauno…', mpLost: 'Savienojums zaudēts.', mpSaved: 'Rezultāts saglabāts tiešsaistes tabulā.', mpSaving: 'Saglabā rezultātu…',
  mpNotSaved: 'Rezultāts netika saglabāts.', mpMenu: 'Uz izvēlni', mpGone: 'Istaba ir aizvērta. Mēģini vēlreiz.', mpStarted: 'Kārta jau notiek. Mēģini vēlreiz.', mpFull: 'Istaba ir pilna. Mēģini vēlreiz.',
  mpPing: '{n} ms', mpAi: 'AI',
}, {
  mpOnline: 'Online', mpBeta: 'BETA', mpConnecting: 'Connecting…', mpUnavailable: 'Online play is not available right now. Single-player still works.',
  mpVersion: 'Online play does not work in this browser yet (Safari, iPhone, Firefox) — a fix is on the way. Single-player works: press “Play”.', mpLobbyTitle: 'Online room', mpWaiting: 'Waiting for players…',
  mpStartsIn: 'Round starts in {n} s', mpNextIn: 'Next round starts in {n} s', mpFillBots: 'Everybody starts together. AI holes fill the room up to {n} holes.',
  mpPlayers: 'Players {n}/{max}', mpYou: 'you', mpLeave: 'Leave', mpRunning: 'Round in progress · {t} left', mpRunningHint: 'You can only join the next round. Meanwhile, watch the leaderboard.',
  mpReconnecting: 'Connection lost. Reconnecting…', mpLost: 'Connection lost.', mpSaved: 'Result saved to the online leaderboard.', mpSaving: 'Saving result…',
  mpNotSaved: 'Result was not saved.', mpMenu: 'Back to menu', mpGone: 'The room has closed. Please try again.', mpStarted: 'The round has already started. Please try again.', mpFull: 'The room is full. Please try again.',
  mpPing: '{n} ms', mpAi: 'AI',
});

const $ = (id) => document.getElementById(id);
const mk = (tag, id, cls, text) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class OnlineUi {
  constructor() {
    this.btn = null;
    this.lobby = null;
    this._last = null;
    onLang(() => this._relabel());
  }

  /** "Online (beta)" button under the Play button + a status line. */
  mountButton(onClick) {
    const play = $('play');
    if (!play || $('play-online')) return;
    const b = mk('button', 'play-online', 'btn');
    b.type = 'button';
    this.btn = b;
    this._relabel();
    b.addEventListener('click', onClick);
    const st = mk('p', 'mp-status', '');
    st.setAttribute('role', 'status');
    play.after(b, st);
    if (!('WebSocket' in window)) { b.disabled = true; }
  }

  _relabel() {
    if (this.btn) { this.btn.textContent = ''; this.btn.append(t('mpOnline'), mk('span', null, 'mp-beta', t('mpBeta'))); }
    if (this._last) this.lobbyUpdate(this._last);
  }

  setButtonBusy(v) { if (this.btn) this.btn.disabled = v || !('WebSocket' in window); }
  setStatus(text, ok = false) { const s = $('mp-status'); if (s) { s.textContent = text || ''; s.classList.toggle('ok', !!ok); } }

  _build() {
    if (this.lobby) return;
    const p = mk('div', 'mp-lobby', 'panel hidden');
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    const inner = mk('div', null, 'panel-inner');
    const sub = mk('div', null, 'sub'); sub.id = 'mp-title';
    const count = mk('div', 'mp-count', '');
    const hint = mk('p', 'mp-sub', '');
    hint.id = 'mp-sub';
    const list = mk('ul', 'mp-players');
    const run = mk('div', 'mp-running', ''); run.classList.add('hidden');
    const note = mk('p', 'mp-note', ''); note.className = 'how'; 
    const leave = mk('button', 'mp-leave', 'btn small'); leave.type = 'button';
    inner.append(sub, count, hint, list, run, note, leave);
    p.append(inner);
    document.body.append(p);
    this.lobby = p;
    this.leaveBtn = leave;
    // Esc = Leave (like the other panels' Esc = close); the lobby is a modal panel
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.classList.contains('hidden')) { e.stopPropagation(); leave.click(); } }, true);
  }

  onLeave(fn) { this._build(); this.leaveBtn.addEventListener('click', fn); }

  /** s: {players:[{id,name,color}], me, startsIn (s or null), max, bots, running:{timeLeft, top} | null, late} */
  lobbyUpdate(s) {
    this._build();
    this._last = s;
    $('mp-title').textContent = t('mpLobbyTitle');
    this.leaveBtn.textContent = t('mpLeave');
    const secs = s.startsIn;
    $('mp-count').textContent = secs == null ? t('mpWaiting') : t(s.late ? 'mpNextIn' : 'mpStartsIn', { n: Math.max(0, secs) });
    $('mp-sub').textContent = `${t('mpPlayers', { n: s.players.length, max: s.max })} · ${t('mpFillBots', { n: s.bots })}`;
    const ul = $('mp-players');
    ul.textContent = '';
    for (const p of s.players) {
      const li = mk('li', null, p.id === s.me ? 'me' : '');
      const dot = mk('i'); dot.style.background = hex(p.color);
      li.append(dot, mk('span', null, '', p.name));
      if (p.id === s.me) li.append(mk('em', null, '', t('mpYou')));
      ul.append(li);
    }
    const run = $('mp-running');
    if (s.running) {
      run.classList.remove('hidden');
      run.textContent = '';
      const m = Math.floor((s.running.timeLeft || 0) / 60), sec = (s.running.timeLeft || 0) % 60;
      run.append(mk('b', null, '', t('mpRunning', { t: `${m}:${String(sec).padStart(2, '0')}` })));
      const ol = mk('ol');
      for (const r of s.running.top) { const li = mk('li', null, r.b ? 'bot' : ''); li.append(mk('span', null, '', r.n + (r.b ? ' · ' + t('mpAi') : '')), mk('span', null, '', String(r.s))); ol.append(li); }
      run.append(ol);
      $('mp-note').textContent = t('mpRunningHint');
    } else { run.classList.add('hidden'); $('mp-note').textContent = ''; }
  }

  showLobby(v) { this._build(); this.lobby.classList.toggle('hidden', !v); if (!v) this._last = null; else this.leaveBtn.focus({ preventScroll: true, focusVisible: false }); }

  /** Connection indicator (in-game): state 'ok' | 'warn' | 'bad'. */
  net(state, text) {
    let el = $('mp-net');
    if (!el) { el = mk('div', 'mp-net'); el.append(mk('i'), mk('span')); document.body.append(el); }
    el.className = state === 'ok' ? '' : state;
    el.lastChild.textContent = text;
  }
}
