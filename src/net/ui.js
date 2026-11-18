// DOM for the online mode: start-screen button + status line, lobby panel, connection indicator. All text via i18n; names via textContent.
import './net.css';
import { t, extendStrings, onLang } from '../i18n.js';
import { FriendsUi } from './friends.js';

extendStrings({
  mpOnline: 'Tiešsaiste', mpBeta: 'BETA', mpConnecting: 'Savienojas…', mpUnavailable: 'Tiešsaiste šobrīd nav pieejama. Viena spēlētāja režīms darbojas.',
  mpNewVersion: 'Ir pieejama jauna spēles versija.', mpReload: 'Jauna versija — pārlādēt', mpNoData: 'Tiešsaiste nav pieejama, kamēr nav ielādēti pilsētas dati. Viena spēlētāja režīms darbojas.', mpLobbyTitle: 'Tiešsaistes istaba', mpWaiting: 'Gaida spēlētājus…',
  mpStartsIn: 'Kārta sākas pēc {n} s', mpNextIn: 'Nākamā kārta sākas pēc {n} s', mpFillBots: 'Visi sāk vienlaikus. Pretinieku bedres (AI) aizpildīs istabu līdz {n} bedrēm.',
  mpPlayers: 'Spēlētāji {n}/{max}', mpYou: 'tu', mpLeave: 'Atgriezties', mpRunning: 'Notiek kārta · atlikušas {t}', mpRunningHint: 'Pievienoties var tikai nākamajai kārtai. Pa to laiku vari skatīties līderus.',
  mpReconnecting: 'Savienojums pārtrūka — atjauno…', mpOtherTab: 'Šī kārta ir atvērta citā cilnē — spēle turpinās tur.',
  mpRejoinRun: 'Tava tiešsaistes kārta vēl notiek · atlikušas {t}', mpRejoinEnded: 'Tava tiešsaistes kārta ir beigusies. Skatīt rezultātus?', mpRejoinOther: 'Šī kārta ir atvērta citā cilnē.',
  mpRejoinYes: 'Atgriezties kārtā', mpRejoinResults: 'Skatīt rezultātus', mpRejoinTake: 'Pārņemt šeit', mpRejoinNo: 'Nē, paldies',
  mpLeft: 'Tu biji atvienots pārāk ilgi — kārta turpinās bez tevis.', mpOver: 'Kārta jau beigusies, istaba ir aizvērta.', mpOverLast: 'Kārta beigusies. Pēdējais zināmais rezultāts: {score} punkti, {rank}. vieta no {total}.', mpLost: 'Savienojums zaudēts.', mpSaved: 'Rezultāts saglabāts tiešsaistes tabulā.', mpSaving: 'Saglabā rezultātu…',
  mpNotSaved: 'Rezultāts netika saglabāts.', mpMenu: 'Uz izvēlni', mpGone: 'Istaba ir aizvērta. Mēģini vēlreiz.', mpStarted: 'Kārta jau notiek. Mēģini vēlreiz.', mpFull: 'Istaba ir pilna. Mēģini vēlreiz.',
  mpPing: '{n} ms', mpAi: 'AI',
  mpRejoinBusy: 'Tev ir tiešsaistes kārta, kas vēl notiek · atlikušas {t}', mpRejoinLeaveGo: 'Pamest to un turpināt',
}, {
  mpOnline: 'Online', mpBeta: 'BETA', mpConnecting: 'Connecting…', mpUnavailable: 'Online play is not available right now. Single-player still works.',
  mpNewVersion: 'A new game version is available.', mpReload: 'New version — reload', mpNoData: 'Online play is unavailable until the city data has loaded. Single-player still works.', mpLobbyTitle: 'Online room', mpWaiting: 'Waiting for players…',
  mpStartsIn: 'Round starts in {n} s', mpNextIn: 'Next round starts in {n} s', mpFillBots: 'Everybody starts together. AI holes fill the room up to {n} holes.',
  mpPlayers: 'Players {n}/{max}', mpYou: 'you', mpLeave: 'Leave', mpRunning: 'Round in progress · {t} left', mpRunningHint: 'You can only join the next round. Meanwhile, watch the leaderboard.',
  mpReconnecting: 'Connection lost — reconnecting…', mpOtherTab: 'This round is open in another tab — the game continues there.',
  mpRejoinRun: 'Your online round is still running · {t} left', mpRejoinEnded: 'Your online round has finished. See the results?', mpRejoinOther: 'This round is open in another tab.',
  mpRejoinYes: 'Rejoin round', mpRejoinResults: 'See results', mpRejoinTake: 'Take over here', mpRejoinNo: 'No thanks',
  mpLeft: 'You were disconnected for too long — the round goes on without you.', mpOver: 'The round is already over and the room has closed.', mpOverLast: 'Round over. Last known result: {score} points, place {rank} of {total}.', mpLost: 'Connection lost.', mpSaved: 'Result saved to the online leaderboard.', mpSaving: 'Saving result…',
  mpNotSaved: 'Result was not saved.', mpMenu: 'Back to menu', mpGone: 'The room has closed. Please try again.', mpStarted: 'The round has already started. Please try again.', mpFull: 'The room is full. Please try again.',
  mpPing: '{n} ms', mpAi: 'AI',
  mpRejoinBusy: 'You are in an online round that is still running · {t} left', mpRejoinLeaveGo: 'Leave it and continue',
});

const $ = (id) => document.getElementById(id);
const mk = (tag, id, cls, text) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class OnlineUi {
  constructor() {
    this.btn = null;
    this.lobby = null;
    this._last = null;
    this.friends = new FriendsUi();   // private (friend) rooms: src/net/friends.js
    onLang(() => this._relabel());
  }

  /** "Online (beta)" button under the Play button + a status line. */
  mountButton(onClick, onFriends) {
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
    if (onFriends) this.friends.mountEntry(b, onFriends);   // one compact secondary button beside Online
    if (!('WebSocket' in window)) { b.disabled = true; }
  }

  _relabel() {
    if (this.btn) { this.btn.textContent = ''; this.btn.append(t('mpOnline'), mk('span', null, 'mp-beta', t('mpBeta'))); }
    if (this._last) this.lobbyUpdate(this._last);
  }

  setButtonBusy(v) { if (this.btn) this.btn.disabled = v || !('WebSocket' in window); this.friends.setBusy(v); }
  /** Status line under the buttons; `action` = { label, run } adds a small button after the text (e.g. the reload offer). */
  setStatus(text, ok = false, action = null) {
    const s = $('mp-status');
    if (!s) return;
    s.textContent = text || '';
    s.classList.toggle('ok', !!ok);
    if (action) {
      const b = mk('button', 'mp-status-act', 'btn small', action.label);
      b.type = 'button';
      b.addEventListener('click', () => { b.disabled = true; action.run(); });
      s.append(' ', b);
    }
  }

  /** Start-screen card "your round is still running": [Rejoin] counts down `auto` seconds (0 = no auto), [No thanks] dismisses. */
  showRejoin({ text, label, no, auto, alive, onYes, onNo }) {
    this.hideRejoin();
    const st = $('mp-status'); if (!st) return;
    const card = mk('div', 'mp-rejoin', '');
    card.setAttribute('role', 'alert');
    const p = mk('p', null, '', text);
    const row = mk('div', null, 'row');
    const yes = mk('button', 'mp-rejoin-yes', 'btn small'); yes.type = 'button';
    const nob = mk('button', 'mp-rejoin-no', 'btn small ghost', no); nob.type = 'button';
    row.append(yes, nob); card.append(p, row);
    st.after(card);
    let n = auto;
    const paint = () => { yes.textContent = n > 0 ? `${label} (${n})` : label; };
    paint();
    const done = () => { clearInterval(this._rejoinT); this._rejoinT = null; };
    yes.addEventListener('click', () => { done(); onYes(); });
    nob.addEventListener('click', () => { done(); this.hideRejoin(); onNo(); });
    if (auto > 0) {
      this._rejoinT = setInterval(() => {
        if (!alive()) { done(); this.hideRejoin(); onNo(); return; }   // started a solo round meanwhile: drop the offer
        if (document.hidden) return;
        if (--n <= 0) { done(); onYes(); } else paint();
      }, 1000);
    }
  }
  hideRejoin() { clearInterval(this._rejoinT); this._rejoinT = null; const c = $('mp-rejoin'); if (c) c.remove(); }

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
