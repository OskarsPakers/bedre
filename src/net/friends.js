// DOM for FRIEND ROOMS (private online rooms): the "friends" entry beside the Online button, the create / join panel, the private lobby
// (code + link + Copy / Share, who is in, host settings, Start) and the late-arrival view. No game logic: online.js drives it. Names via textContent only.
import { t, extendStrings, onLang } from '../i18n.js';
import { copyLink } from '../meta/share.js';
import { itemOf } from '../skins.js';

extendStrings({
  mpFriends: 'Draugiem', mpFriendsFull: 'Spēlēt ar draugiem', mpFriendsHint: 'Izveido privātu istabu un nosūti saiti — vai ievadi drauga kodu.', mpCreate: 'Izveidot istabu', mpJoin: 'Pievienoties', mpCodePh: 'KODS', mpCodeLbl: 'Istabas kods',
  mpBadCode: 'Kodam jābūt 6 simboliem.', mpNoRoom: 'Šī istaba vairs nav aktīva.', mpNoRoomHint: 'Saite ir novecojusi vai istaba ir aizvērta.', mpCreateNew: 'Izveidot jaunu istabu', mpTooMany: 'Pārāk daudz mēģinājumu. Pamēģini vēlāk.', mpClose: 'Aizvērt',
  mpPrivTitle: 'Privāta istaba', mpCode: 'Kods', mpCopy: 'Kopēt saiti', mpCopied: 'Saite nokopēta', mpCopyFail: 'Neizdevās nokopēt', mpShare: 'Dalīties', mpShared: 'Kopīgots',
  mpShareText: 'Pievienojies manai BEDRE istabai Rīgā!', mpHost: 'saimnieks', mpYouTag: 'tu', mpWaitHost: 'Gaida, kad saimnieks sāks kārtu…', mpStart: 'Sākt kārtu', mpLenLbl: 'Kārtas garums', mpBotsLbl: 'Aizpildīt ar botiem līdz {n}',
  mpRanked: 'Šī kārta tiks ierakstīta tiešsaistes tabulā.', mpUnrankedBots: 'Ārpus tabulas: vajag vismaz 2 spēlētājus kārtas beigās.', mpUnrankedLen: 'Ārpus tabulas: tikai 5:00 kārtas tiek ierakstītas.', mpUnrankedBoth: 'Ārpus tabulas: vajag 5:00 kārtu un vismaz 2 spēlētājus.',
  mpPrivPlayers: 'Istabā {n}/{max}', mpPrivWait: 'Tu pievienojies kārtas laikā — nākamajā kārtā būsi ar visiem.', mpRematch: 'Atkārtot ar draugiem', mpRematchHint: 'Visi atgriežas tajā pašā istabā.', mpPrivGone: 'Istaba vairs nav aktīva.', mpPrivEndedWait: 'Kārta beigusies — gaidi atkārtojumu.',
  mpPrivRankedSaved: 'Rezultāts ierakstīts tiešsaistes tabulā.', mpPrivUnranked: 'Privāta kārta — ārpus tabulas.', mpPrivRoomTag: 'Istaba {code}', mpHostMigrated: 'Tu tagad esi saimnieks.',
}, {
  mpFriends: 'Friends', mpFriendsFull: 'Play with friends', mpFriendsHint: 'Create a private room and share the link — or enter a friend’s code.', mpCreate: 'Create a room', mpJoin: 'Join', mpCodePh: 'CODE', mpCodeLbl: 'Room code',
  mpBadCode: 'The code has 6 characters.', mpNoRoom: 'This room is no longer active.', mpNoRoomHint: 'The link is out of date or the room has closed.', mpCreateNew: 'Create a new room', mpTooMany: 'Too many attempts. Try again later.', mpClose: 'Close',
  mpPrivTitle: 'Private room', mpCode: 'Code', mpCopy: 'Copy link', mpCopied: 'Link copied', mpCopyFail: 'Could not copy', mpShare: 'Share', mpShared: 'Shared',
  mpShareText: 'Join my BEDRE room in Rīga!', mpHost: 'host', mpYouTag: 'you', mpWaitHost: 'Waiting for the host to start…', mpStart: 'Start round', mpLenLbl: 'Round length', mpBotsLbl: 'Fill with bots up to {n}',
  mpRanked: 'This round will be written to the online leaderboard.', mpUnrankedBots: 'Unranked: needs at least 2 players at the end.', mpUnrankedLen: 'Unranked: only 5:00 rounds are ranked.', mpUnrankedBoth: 'Unranked: needs a 5:00 round and at least 2 players.',
  mpPrivPlayers: 'In the room {n}/{max}', mpPrivWait: 'You joined during a round — you will be in the next one.', mpRematch: 'Rematch with friends', mpRematchHint: 'Everybody returns to the same room.', mpPrivGone: 'The room is no longer active.', mpPrivEndedWait: 'The round is over — waiting for a rematch.',
  mpPrivRankedSaved: 'Result saved to the online leaderboard.', mpPrivUnranked: 'Private round — not on the leaderboard.', mpPrivRoomTag: 'Room {code}', mpHostMigrated: 'You are the host now.',
});

const $ = (id) => document.getElementById(id);
const mk = (tag, id, cls, text) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; else if (id) e.className = id; if (text !== undefined) e.textContent = text; return e; };   // (an element without a class gets its id as class: the CSS uses .mpp-*)
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
export const roomUrl = (code) => `${location.origin}/?room=${code}`;
const fmtLen = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export class FriendsUi {
  constructor() {
    this.entry = null; this.fp = null; this.pp = null; this._last = null;
    onLang(() => { this._relabel(); if (this._last) this.privUpdate(this._last); if (this._noroom) this.showNoRoom(true); });
  }

  /** The friends control beside the Online button: one compact secondary button (the start screen stays calm). */
  mountEntry(onlineBtn, onClick) {
    if (!onlineBtn || $('play-friends')) return;
    const row = mk('div', 'mp-row');
    onlineBtn.before(row);
    const b = mk('button', 'play-friends', 'btn'); b.id = 'play-friends'; b.type = 'button';
    row.append(onlineBtn, b);
    this.entry = b;
    b.addEventListener('click', onClick);
    this._relabel();
    if (!('WebSocket' in window)) b.disabled = true;
  }
  setBusy(v) { if (this.entry) this.entry.disabled = v || !('WebSocket' in window); }
  _relabel() {
    if (this.entry) { this.entry.textContent = t('mpFriends'); this.entry.title = t('mpFriendsFull'); this.entry.setAttribute('aria-label', t('mpFriendsFull')); }
    if (this.fp) this._labelFriends();
  }

  // ---- create / join panel ---------------------------------------------------------------------------------------------
  _buildFriends() {
    if (this.fp) return;
    const p = mk('div', 'mp-friends', 'panel hidden'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    const inner = mk('div', null, 'panel-inner');
    const title = mk('div', 'mpf-title', 'sub');
    const hint = mk('p', 'mpf-hint', 'how');
    const create = mk('button', 'mpf-create', 'btn small'); create.type = 'button';
    const row = mk('div', null, 'mpf-join');
    const inp = mk('input', 'mpf-code'); inp.type = 'text'; inp.maxLength = 9; inp.autocomplete = 'off'; inp.spellcheck = false; inp.autocapitalize = 'characters'; inp.inputMode = 'text';
    const join = mk('button', 'mpf-join-btn', 'btn alt'); join.type = 'button';
    row.append(inp, join);
    const err = mk('p', 'mpf-err', 'how'); err.setAttribute('role', 'status');
    const close = mk('button', 'mpf-close', 'link'); close.type = 'button';
    inner.append(title, hint, create, row, err, close);
    p.append(inner); document.body.append(p);
    this.fp = p; this.fCreate = create; this.fJoin = join; this.fInp = inp; this.fClose = close; this.fErr = err;
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); err.textContent = ''; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') join.click(); });
    close.addEventListener('click', () => this.showFriends(false));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.classList.contains('hidden')) { e.stopPropagation(); this.showFriends(false); } }, true);
    this._labelFriends();
  }
  _labelFriends() {
    $('mpf-title').textContent = t('mpFriendsFull'); $('mpf-hint').textContent = t('mpFriendsHint');
    this.fCreate.textContent = t('mpCreate'); this.fJoin.textContent = t('mpJoin'); this.fInp.placeholder = t('mpCodePh'); this.fInp.setAttribute('aria-label', t('mpCodeLbl')); this.fClose.textContent = t('mpClose');
  }
  onFriends({ create, join }) {
    this._buildFriends();
    this.fCreate.addEventListener('click', () => create());
    this.fJoin.addEventListener('click', () => join(this.fInp.value));
  }
  showFriends(v, msg = '') {
    this._buildFriends();
    this.fp.classList.toggle('hidden', !v);
    this.fErr.textContent = msg;
    if (v) { this.fCreate.focus({ preventScroll: true, focusVisible: false }); }
  }
  friendsError(msg) { this._buildFriends(); this.fErr.textContent = msg; }
  friendsBusy(v) { this._buildFriends(); this.fCreate.disabled = this.fJoin.disabled = v; }

  // ---- "room is not active" offer ---------------------------------------------------------------------------------------
  showNoRoom(v, { onNew, onClose } = {}) {
    this._noroom = v;
    let p = $('mp-noroom');
    if (!v) { if (p) p.classList.add('hidden'); return; }
    if (!p) {
      p = mk('div', 'mp-noroom', 'panel hidden'); p.setAttribute('role', 'alertdialog'); p.setAttribute('aria-modal', 'true');
      const inner = mk('div', null, 'panel-inner small');
      inner.append(mk('div', 'mpn-title', 'sub'), mk('p', 'mpn-text', 'how'));
      const nw = mk('button', 'mpn-new', 'btn small'); nw.type = 'button';
      const cl = mk('button', 'mpn-close', 'link'); cl.type = 'button';
      inner.append(nw, cl); p.append(inner); document.body.append(p);
    }
    $('mpn-title').textContent = t('mpNoRoom'); $('mpn-text').textContent = t('mpNoRoomHint');
    const nw = $('mpn-new'), cl = $('mpn-close');
    nw.textContent = t('mpCreateNew'); cl.textContent = t('mpClose');
    if (onNew) { nw.onclick = () => { p.classList.add('hidden'); this._noroom = false; onNew(); }; cl.onclick = () => { p.classList.add('hidden'); this._noroom = false; onClose && onClose(); }; }
    p.classList.remove('hidden');
    nw.focus({ preventScroll: true, focusVisible: false });
  }

  // ---- the private lobby -------------------------------------------------------------------------------------------------
  _buildPriv() {
    if (this.pp) return;
    const p = mk('div', 'mp-priv', 'panel hidden'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    const inner = mk('div', null, 'panel-inner');
    const title = mk('div', 'mpp-title', 'sub');
    const code = mk('div', 'mpp-code'); code.setAttribute('aria-live', 'off');
    const url = mk('div', 'mpp-url');
    const acts = mk('div', 'mpp-acts');
    const copy = mk('button', 'mpp-copy', 'btn alt'); copy.type = 'button';
    const share = mk('button', 'mpp-share', 'btn alt'); share.type = 'button';
    acts.append(copy, share);
    const count = mk('div', 'mpp-count');
    const list = mk('ul', 'mpp-players'); list.id = 'mpp-players';
    const set = mk('div', 'mpp-settings');
    const len = mk('div', null, 'mpp-len'); len.setAttribute('role', 'radiogroup');
    const l1 = mk('button', 'mpp-len120', null, '2:00'), l2 = mk('button', 'mpp-len300', null, '5:00');
    for (const b of [l1, l2]) { b.type = 'button'; b.setAttribute('role', 'radio'); }
    len.append(l1, l2);
    const lenLbl = mk('span', 'mpp-lenlbl', 'adv-lbl');
    const bots = mk('div', 'mpp-botsrow'); const bcb = mk('button', 'mpp-bots', 'mpp-switch'); bcb.type = 'button'; bcb.setAttribute('role', 'switch'); bcb.setAttribute('aria-checked', 'true'); bcb.append(mk('i')); const bl = mk('span', 'mpp-botslbl');
    bl.addEventListener('click', () => { if (!bcb.disabled) bcb.click(); });
    bots.append(bcb, bl);
    set.append(lenLbl, len, bots);
    const rank = mk('p', 'mpp-rank', 'how');
    const run = mk('div', 'mpp-running', ''); run.classList.add('hidden');
    const start = mk('button', 'mpp-start', 'btn small'); start.type = 'button';
    const wait = mk('p', 'mpp-wait', 'how');
    const rem = mk('button', 'mpp-rematch', 'btn small hidden'); rem.type = 'button';
    const leave = mk('button', 'mpp-leave', 'link'); leave.type = 'button';
    inner.append(title, code, url, acts, count, list, set, rank, run, start, wait, rem, leave);
    p.append(inner); document.body.append(p);
    Object.assign(this, { pp: p, pCode: code, pUrl: url, pCopy: copy, pShare: share, pLen: [l1, l2], pBots: bcb, pStart: start, pLeave: leave, pRem: rem });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !p.classList.contains('hidden')) { e.stopPropagation(); leave.click(); } }, true);
    copy.addEventListener('click', async () => {
      const ok = await copyLink(roomUrl(this._last ? this._last.code : ''));
      this.flash(copy, ok ? '✓ ' + t('mpCopied') : t('mpCopyFail'));
    });
    if (typeof navigator.share === 'function') {
      share.addEventListener('click', async () => {
        try { await navigator.share({ title: 'BEDRE — Rīga', text: t('mpShareText'), url: roomUrl(this._last.code) }); this.flash(share, '✓ ' + t('mpShared')); } catch { /* cancelled */ }
      });
    } else share.hidden = true;
  }
  flash(btn, text) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = text; btn.classList.add('done'); btn.setAttribute('role', 'status');
    clearTimeout(btn._ft); btn._ft = setTimeout(() => { btn.textContent = btn.dataset.label; delete btn.dataset.label; btn.classList.remove('done'); btn.removeAttribute('role'); }, 2200);
  }
  onPriv({ leave, start, cfg, rematch }) {
    this._buildPriv();
    this.pLeave.addEventListener('click', leave);
    this.pStart.addEventListener('click', start);
    this.pRem.addEventListener('click', rematch);
    this.pLen[0].addEventListener('click', () => cfg({ len: 120 }));
    this.pLen[1].addEventListener('click', () => cfg({ len: 300 }));
    this.pBots.addEventListener('click', () => cfg({ bots: this.pBots.getAttribute('aria-checked') !== 'true' }));
  }

  /** s: { code, players:[{id,name,color,sk}], me, host (id), max, cfg:{len,bots}, ranked, botsTo, wait, running, phase } */
  privUpdate(s) {
    this._buildPriv();
    this._last = s;
    const amHost = s.host === s.me && !s.wait;
    $('mpp-title').textContent = t('mpPrivTitle');
    this.pCode.textContent = s.code;
    this.pCode.setAttribute('aria-label', `${t('mpCodeLbl')} ${s.code.split('').join(' ')}`);
    this.pUrl.textContent = roomUrl(s.code).replace(/^https?:\/\//, '');
    this.pCopy.dataset.label || (this.pCopy.textContent = t('mpCopy'));
    this.pShare.dataset.label || (this.pShare.textContent = t('mpShare'));
    $('mpp-count') && ($('mpp-count').textContent = t('mpPrivPlayers', { n: s.players.length, max: s.max }));
    const ul = $('mpp-players'); ul.textContent = '';
    for (const p of s.players) {
      const li = mk('li', null, p.id === s.me ? 'me' : '');
      const dot = mk('i'); dot.style.background = hex(p.color);
      const rim = p.sk && p.sk[0] ? itemOf(0, p.sk[0]) : null;
      if (rim && rim.pat) dot.style.boxShadow = `0 0 0 2px ${hex(rim.c1)}, 0 0 0 3.5px ${hex(rim.c2)}`;
      li.append(dot, mk('span', null, '', p.name));
      if (p.id === s.host) li.append(mk('em', null, 'host', t('mpHost')));
      if (p.id === s.me) li.append(mk('em', null, '', t('mpYouTag')));
      ul.append(li);
    }
    const set = this.pp.querySelector('.mpp-settings');
    set.hidden = !!s.wait;
    $('mpp-lenlbl').textContent = t('mpLenLbl');
    this.pLen.forEach((b, i) => { const v = i ? 300 : 120; b.setAttribute('aria-checked', String(s.cfg.len === v)); b.disabled = !amHost; });
    this.pBots.setAttribute('aria-checked', String(!!s.cfg.bots)); this.pBots.disabled = !amHost;
    $('mpp-botslbl').textContent = t('mpBotsLbl', { n: s.botsTo });
    const rk = $('mpp-rank');
    rk.hidden = !!s.wait;
    const shortLen = s.cfg.len !== 300, solo = s.players.length < 2;
    rk.textContent = s.ranked ? t('mpRanked') : shortLen && solo ? t('mpUnrankedBoth') : shortLen ? t('mpUnrankedLen') : t('mpUnrankedBots');
    rk.classList.toggle('ok', !!s.ranked);
    this.pStart.textContent = t('mpStart'); this.pStart.hidden = !amHost;
    const wt = $('mpp-wait');
    wt.textContent = s.wait ? t('mpPrivWait') : amHost ? '' : t('mpWaitHost');
    wt.hidden = !wt.textContent;
    const run = $('mpp-running');
    if (s.wait && s.running) {
      run.classList.remove('hidden'); run.textContent = '';
      const tl = s.running.timeLeft || 0;
      run.append(mk('b', null, '', s.running.phase === 'ended' ? t('mpPrivEndedWait') : t('mpRunning', { t: `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` })));
      const ol = mk('ol');
      for (const r of s.running.top || []) { const li = mk('li', null, r.b ? 'bot' : ''); li.append(mk('span', null, '', r.n + (r.b ? ' · ' + t('mpAi') : '')), mk('span', null, '', String(r.s))); ol.append(li); }
      run.append(ol);
    } else run.classList.add('hidden');
    this.pRem.textContent = t('mpRematch');
    this.pRem.classList.toggle('hidden', !(s.wait && s.running && s.running.phase === 'ended'));
    this.pLeave.textContent = t('mpLeave');
  }
  showPriv(v) {
    this._buildPriv();
    this.pp.classList.toggle('hidden', !v);
    if (!v) this._last = null; else this.pLeave.focus({ preventScroll: true, focusVisible: false });
  }
  /** Host-only: the host changed (migration) -> the guest's start button appears by itself; this only announces it. */
  fmtLen(s) { return fmtLen(s); }
}
