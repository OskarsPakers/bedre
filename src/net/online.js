// Online mode ("Tiešsaiste"): glue between the room server (worker/mp) and the existing Game.
//
// While `game.online` is set, Game.update() hands the frame to OnlineMode.update(): the local hole is simulated here as usual
// (responsive), every other hole (humans AND server-simulated bots) is a plain Hole object whose x/z/radius/score come from
// interpolated server snapshots, so the ground shader, minimap, leaderboard, name tags and kill feed work unchanged.
// The server is authoritative for score / radius / kills / clock / ranking; the client only predicts its own eats (score shown =
// server score + not-yet-acknowledged claims) and gets corrected by acks and snapshots.
import * as THREE from 'three';
import { CFG, radiusFromScore } from '../config.js';
import { Hole, updateSwallow, pullObjects, restoreMoved } from '../holes.js';
import { PU, PU_TYPES, pickRadius } from '../powerups.js';
import { comboRound, resetComboRound } from '../combo.js';
import { bus } from '../events.js';
import { t, kindName } from '../i18n.js';
import { MpClient, fetchStatus } from './client.js';
import { expectedHash } from '../placements.js';
import { OnlineUi } from './ui.js';
import { loadSession, saveSession, clearSession, ownedElsewhere, RESULTS_MARGIN_MS } from './session.js';
import { MP, validCode, normCode, PROTOCOL_VERSION as MP_VERSION } from '../../worker/mp/protocol.js';
import { equippedSkin } from '../meta/wardrobe.js';
import { SKINS } from '../skins.js';

export const MP_COLORS = [...CFG.holeColors, 0x2fa0b5, 0xff8a5c, 0x6c7be0, 0xb0a02f];
const INTERP_MS = 130;       // remote holes are drawn this far in the past (smooth between 10 Hz snapshots)
const SEND_MS = 80;          // ~12 Hz position + claims
const RECONNECT_GIVE_UP_MS = 42000;   // just under the server's grace period (MP.removeAfterMs = 45 s): after that the hole is gone anyway
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexOf = (n) => '#' + n.toString(16).padStart(6, '0');
const r1 = (v) => Math.round(v * 10) / 10;

/** Reload that really fetches the new release: drop the service worker + every cache first (the shell and /data/* are cached by public/sw.js). */
export async function hardReload() {
  try { const regs = (navigator.serviceWorker && (await navigator.serviceWorker.getRegistrations())) || []; for (const r of regs) await r.unregister(); } catch { /* ignore */ }
  try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
  location.reload();
}

export class OnlineMode {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.client = new MpClient();
    this.ui = new OnlineUi();
    this.state = 'idle';   // idle | matching | connecting | rejoining | lobby | intro | playing | ended | error
    this.room = null; this.me = -1;
    this.byId = new Map();            // server hole id -> Hole (player + remotes)
    this.remotes = [];
    this.serverScore = 0; this.serverMass = 0; this.optimistic = 0; this.optPts = 0;   // points / growth mass: server value + not-yet-acknowledged local swallows
    this.pendC = []; this.pendM = []; this.pendP = []; this.pickAsked = new Map(); this.inflight = new Map(); this.seq = 0; this.sendAt = 0;
    this.serverEaten = new Set();
    this.mine = new Set();            // object ids this client claimed and has not seen confirmed
    this.lobby = null; this.status = null; this.statusT = null; this.lobbyTimer = null;
    this.rec = null;                  // reconnect state
    this.drive = null;                // test hook: steer the local hole to a point (still validated by the server)
    this.finalRank = null;
    this.log = [];                    // recent control messages (tests / debugging)
    this.saved = null;
    this._hash = world.placements ? world.placements.hash : null; // content id of the placement file the world was built from (null = fallback world)
    this.client.onMessage = (m) => this._onMessage(m);
    this.client.onClose = (info) => this._onClose(info);
    this.ui.mountButton(() => this.begin(), () => this.openFriends());
    this.ui.onLeave(() => this.leave());
    this._menuBtn = null;
    this.priv = null;                 // {code} while in a private (friend) room
    this.mySk = null;                 // the skin ids sent in the hello (cosmetic, client-trusted)
    this.privEnd = null;
    this.ui.friends.onFriends({ create: () => this._guard(() => this.createPrivate()), join: (c) => this._guard(() => this.joinPrivate(c)) });
    this.ui.friends.onPriv({
      leave: () => this.leave(), start: () => this.client.send({ t: 'go' }),
      cfg: (p) => { const c = (this.lobby && this.lobby.cfg) || { len: 300, bots: true }; this.client.send({ t: 'cfg', len: p.len ?? c.len, bots: p.bots ?? c.bots }); },
      rematch: () => this.rematch(),
    });
    if (!this._hash && !(CFG.map && CFG.map.slug !== 'centrs')) this.ui.setStatus(t('mpNoData')); // fallback world (placement file missing / stale): solo only, no blame
    this._hbT = null; this._rejoinRec = null;
    setTimeout(() => { if (!this._linkRoom()) this.checkSession(); }, 0);
  }

  // ---- friend rooms: entry points ---------------------------------------------------------------------------------------------
  _mySkin() { this.mySk = equippedSkin(); this.game.player.skin = this.mySk; return this.mySk; }
  _connect(room, name) { return this.client.connect(room, { name, hash: this._hash, sk: this.mySk || this._mySkin(), priv: this.priv ? true : undefined }); }

  /** A live session record of ANOTHER room (a running round) is never silently dropped: offer to go back to it or to leave it for the new action. */
  _guard(next, code = null) {
    const rec = loadSession();
    if (!rec || (code && rec.room === code)) { if (rec && code) return this.rejoin(rec); return next(); }
    if (this.state !== 'idle' && this.state !== 'error') return;
    this.ui.friends.showFriends(false);
    const left = rec.endAt ? Math.max(0, Math.round((rec.endAt - Date.now()) / 1000)) : 0;
    const ended = !!rec.ended || (rec.endAt && left <= 0);
    this.ui.showRejoin({
      text: ended ? t('mpRejoinEnded') : t('mpRejoinBusy', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }),
      label: ended ? t('mpRejoinResults') : t('mpRejoinYes'), no: t('mpRejoinLeaveGo'), auto: 0, alive: () => true,
      onYes: () => this.rejoin(rec), onNo: () => { clearSession(); next(); },
    });
  }

  openFriends() {
    if (this.state !== 'idle' && this.state !== 'error') return;
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return; }
    this.ui.friends.showFriends(true);
  }

  /** `?room=CODE` in the address: join that private room's lobby directly (the code stays in the URL, so a reload of the lobby comes back to it). */
  _linkRoom() {
    let code = null;
    try { const q = new URLSearchParams(location.search).get('room'); if (q) code = normCode(q); } catch { /* */ }
    if (!code) return false;
    if (!validCode(code)) { this.ui.friends.showNoRoom(true, { onNew: () => this._guard(() => this.createPrivate()), onClose: () => this._dropLinkParam() }); return true; }
    if (CFG.map && CFG.map.slug !== 'centrs') { const u = new URL(location.href); u.searchParams.set('map', 'centrs'); location.replace(u.toString()); return true; }   // online is centre-only
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return true; }
    this._guard(() => this.joinPrivate(code), code);
    return true;
  }
  _dropLinkParam() { try { const u = new URL(location.href); if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } } catch { /* */ } }

  async createPrivate() {
    if (this.state !== 'idle' && this.state !== 'error') return;
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return; }
    const f = this.ui.friends;
    f.friendsBusy(true);
    let j = null;
    try { j = await this.client.createRoom(); }
    catch (e) { f.friendsBusy(false); f.showFriends(true, t(e && e.status === 429 ? 'mpTooMany' : 'mpUnavailable')); return; }
    f.friendsBusy(false); f.showFriends(false);
    if (!j || !validCode(j.code)) { this.ui.setStatus(t('mpUnavailable')); return; }
    await this._enterPrivate(j.code);
  }

  async joinPrivate(codeRaw) {
    if (this.state !== 'idle' && this.state !== 'error') return;
    const code = normCode(codeRaw), f = this.ui.friends;
    if (!validCode(code)) { f.showFriends(true, t('mpBadCode')); return; }
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return; }
    f.friendsBusy(true);
    try { await this.client.roomInfo(code); }
    catch (e) {
      f.friendsBusy(false);
      if (e && e.status === 404) { f.showFriends(false); this._dropLinkParam(); f.showNoRoom(true, { onNew: () => this._guard(() => this.createPrivate()) }); }
      else if (e && e.status === 429) f.showFriends(true, t('mpTooMany'));
      else f.showFriends(true, t('mpUnavailable'));
      return;
    }
    f.friendsBusy(false); f.showFriends(false);
    await this._enterPrivate(code);
  }

  async _enterPrivate(code) {
    const g = this.game;
    this._enterOnline();
    this.priv = { code };
    this.room = code;
    this.state = 'connecting';
    this.ui.setStatus(t('mpConnecting'), true);
    try { const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch { /* */ }
    try { await this._connect(code, g.hud.getName(CFG.playerName)); }
    catch { if (this.state === 'connecting') this._fail('mpUnavailable'); }
  }

  /** At the results of a private round: everybody still connected goes back to the same lobby (one tap). */
  async rematch() {
    if (!this.priv) return;
    if (this.client.open) { this.client.send({ t: 'rematch' }); return; }
    const code = this.priv.code;
    this._removeMenuBtn(); this.game.hud.showResults(false);
    this.state = 'idle'; this.client.close(true);
    await this.joinPrivate(code);
  }

  // ---- session record (reload / evicted tab -> back into the running round) ---------------------------------------------
  _persist() {
    if (!this.room || this.state === 'idle' || this.state === 'matching' || this.state === 'lobby' || this.state === 'connecting') return;
    const g = this.game, rows = g.rows || [], me = rows.find((r) => r.isPlayer);
    const endAt = this.round ? this.round.endAt : (this._rejoinRec ? this._rejoinRec.endAt : 0);
    saveSession({
      room: this.room, priv: !!this.priv, token: this.client.token, name: g.player.name, hash: this._hash, id: this.me, endAt, ended: this.state === 'ended',
      exp: endAt - this.client.offset + RESULTS_MARGIN_MS,   // round end (local clock) + the room's results time + slack
      last: { score: Math.round(g.player.score), rank: me ? me.rank : 0, total: rows.length },
    });
  }
  _startBeat() { clearInterval(this._hbT); this._hbT = setInterval(() => this._persist(), 2000); }

  /** Page load: a live session record -> offer (and after ~3 s do) the rejoin. */
  checkSession() {
    const rec = loadSession();
    if (!rec || !this._hash || this.state !== 'idle' || this.game.phase !== 'menu') return;
    this._prompt(rec);
  }

  _prompt(rec) {
    const owned = ownedElsewhere(rec);
    const left = rec.endAt ? Math.max(0, Math.round((rec.endAt - Date.now()) / 1000)) : 0;
    const ended = !!rec.ended || (rec.endAt && left <= 0);
    const text = owned ? t('mpRejoinOther') : ended ? t('mpRejoinEnded') : t('mpRejoinRun', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
    this.ui.showRejoin({
      text, label: owned ? t('mpRejoinTake') : ended ? t('mpRejoinResults') : t('mpRejoinYes'), no: t('mpRejoinNo'), auto: owned ? 0 : 3,
      alive: () => this.state === 'idle' && this.game.phase === 'menu',
      onYes: () => this.rejoin(rec), onNo: () => clearSession(),
    });
  }

  get active() { return this.state !== 'idle'; }

  // ---- entering / leaving -----------------------------------------------------------------------------------------
  async begin() {
    if (this.state !== 'idle' && this.state !== 'error') return;
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return; } // world not built from the canonical placement file: online would desync
    const rec = loadSession();
    if (rec) return this.rejoin(rec);   // a round of ours is still running (or just ended): back into it, never into the next lobby
    const g = this.game;
    this._enterOnline();
    this.ui.setStatus(t('mpConnecting'), true);
    this.state = 'matching';
    try {
      const j = await this.client.matchmake(this._badRoom);
      this._badRoom = null;
      if (this.state !== 'matching') return;
      if (!j || !j.room) throw new Error('matchmake');
      this.room = j.room;
      this.state = 'connecting';
      await this._connect(this.room, g.hud.getName(CFG.playerName));
      // the server answers with {t:'lobby'} (or {t:'err'})
    } catch (e) {
      if (this.state === 'matching' || this.state === 'connecting') this._fail('mpUnavailable');
    }
  }

  _enterOnline() {
    const g = this.game;
    if (!this._enter) {
      this._enter = true;
      this._solo = { holes: g.holes, k: CFG.growth.k, id: g.player.id, color: g.player.color, name: g.player.name };
      CFG.growth.k = 16; // online rooms always use the classic growth curve (the server's numbers)
    }
    g.online = this;
    document.body.classList.add('mp-online');
    this.ui.setButtonBusy(true);
  }

  /** Rejoin the round of a stored session (same token -> the server hands back the same hole and its score). */
  async rejoin(rec) {
    if (this.state !== 'idle' && this.state !== 'error') return;
    if (!this._hash) { this.ui.setStatus(t('mpNoData')); return; }
    this.ui.hideRejoin();
    this._enterOnline();
    this._rejoinRec = rec;
    this.priv = rec.priv ? { code: rec.room } : null;
    this.client.setToken(rec.token);
    this.room = rec.room;
    this.state = 'rejoining';
    this.ui.setStatus(t('mpConnecting'), true);
    for (let i = 0; i < 3 && this.state === 'rejoining'; i++) {
      try { await this._connect(rec.room, rec.name || this.game.hud.getName(CFG.playerName)); return; } // answered by {t:'resume'} / {t:'left'} / {t:'err'}
      catch { if (this.state === 'rejoining') await sleep(1200); }
    }
    if (this.state !== 'rejoining') return;
    if (navigator.onLine === false) return this._fail('mpUnavailable', true);   // no network: keep the record, try again later
    this._rejoinOver('room');
  }

  /** The stored round cannot be rejoined: say why (with the last known result when we have one), drop the record. */
  _rejoinOver(kind) {
    const rec = this._rejoinRec; this._rejoinRec = null;
    const last = rec && rec.last;
    const text = kind === 'left' ? t('mpLeft') : last && last.rank ? t('mpOverLast', { score: last.score, rank: last.rank, total: last.total }) : t('mpOver');
    this.leave();
    this.ui.setStatus(text);
  }

  /** Back to the single-player menu (also used after errors). keepSession: leave the stored session record alone (connection lost, other tab). */
  leave(keepSession = false) {
    if (!keepSession) clearSession();
    clearInterval(this._hbT); this._hbT = null; this._rejoinRec = null;
    const g = this.game;
    try { this.client.send({ t: 'bye' }); } catch { /* */ }
    this.client.close(true);
    clearInterval(this.lobbyTimer); clearInterval(this.statusT);
    this.rec = null;
    this.state = 'idle';
    this.ui.showLobby(false);
    this.ui.friends.showPriv(false);
    this.ui.setButtonBusy(false);
    this.ui.setStatus('');
    document.body.classList.remove('mp-online');
    this._removeMenuBtn();
    this._againLabel(false);
    if (this.priv) this._dropLinkParam();
    this.priv = null; this.privEnd = null; this.lobby = null;
    if (this._enter) {
      this._enter = false;
      const s = this._solo;
      CFG.growth.k = s.k;
      g.puView.clear();
      this._clearHoles();
      g.holes = s.holes;
      g.player.id = s.id; g.player.color = s.color; g.player.name = s.name; g.player.isBot = undefined;
      g.online = null;
      g.phase = 'menu'; g.intro = null; g.paused = false;
      g.world.reset(); restoreMoved(g.world);
      g._placeAll();
      g.hud.clearTransient();
      g.hud.showResults(false); g.hud.showHud(false); g.hud.showTags(false); g.hud.showMarkers(false); g.hud.showStart(true);
      g.cam.snap(g.player);
      g._syncVisuals(0);
    }
    g.online = null;
  }

  /** Game.start() hook: Play again / Enter / Space while in online mode. */
  onStart() {
    if (this.state === 'ended') { if (this.priv) this.rematch(); else this.playAgain(); }
  }

  /** The results button of a private round says "Rematch with friends" (everybody goes back to the same lobby). */
  _againLabel(on) {
    const again = document.getElementById('again'); if (!again) return;
    if (on) { if (!again.dataset.label) again.dataset.label = again.textContent; again.textContent = t('mpRematch'); }
    else if (again.dataset.label) { again.textContent = again.dataset.label; delete again.dataset.label; }
  }

  async playAgain() {
    clearSession();
    this.client.close(true);
    this.saved = null;
    this._removeMenuBtn();
    this.game.hud.showResults(false);
    this.state = 'idle';
    this.ui.setStatus('');
    await this.begin();
  }

  _fail(key, keepSession = false) {
    this.client.close(true);
    clearInterval(this.lobbyTimer); clearInterval(this.statusT);
    this.ui.showLobby(false);
    const wasGame = this.game.phase === 'intro' || this.game.phase === 'playing';
    const text = t(key);
    this.leave(keepSession);
    this.ui.setStatus(text);
    this.state = 'idle';
    if (wasGame) this.game.hud.clearTransient();
  }

  // ---- messages -----------------------------------------------------------------------------------------------------
  _onMessage(m) {
    switch (m.t) {
      case 'lobby': return this._onLobby(m);
      case 'start': return this._onStart(m);
      case 'resume': return this._onResume(m);
      case 'left': { // rejoined after the grace period, round already over: only the final ranking follows
        if (this.state !== 'rejoining') return;
        const g = this.game;
        this.me = m.you; this._rejoinRec = null; this.round = { startAt: 0, playAt: 0, endAt: 0, holes: [] };
        g.hud.showStart(false); g.hud.showResults(false); g.holes = [g.player]; this._clearHoles(); this._overviewCam();
        return;
      }
      case 's': return this._onSnapshot(m);
      case 'a': return this._onAck(m);
      case 'rb': {
        this._note(m);
        const p = this.game.player;
        if (p.alive && !p.dying) { p.x = m.x; p.z = m.z; p.vx = p.vz = 0; this.game.cam.snap(p); }
        return;
      }
      case 'wait': { if (this.lobby) { this.lobby.running = { timeLeft: m.timeLeft, top: m.top, phase: m.phase }; this._lobbyTick(); } return; }
      case 'end': return this._onEnd(m);
      case 'saved': this.saved = m.ok; this._note(m); this._showSaved(); return;
      case 'err': this._note(m); return this._onErr(m);
      default: this._note(m);
    }
  }

  _note(m) { this.log.push({ ...m, at: Date.now() }); if (this.log.length > 60) this.log.shift(); }

  _onErr(m) {
    if (m.code === 'version') return this._versionRefused(m);
    if (this.priv && this.state !== 'rejoining') {   // private rooms never retry through public matchmaking
      if (m.code === 'full') return this._fail('mpFull');
      if (m.code === 'ratelimit' || m.code === 'name') return this._fail('mpUnavailable');
      if (m.code === 'left') return this._fail('mpLeft');
      this.leave(); this.ui.friends.showNoRoom(true, { onNew: () => this._guard(() => this.createPrivate()) }); return;   // closed / gone / unknown: the friendly dialog
    }
    if (this.state === 'rejoining') return this._rejoinOver(m.code === 'left' || m.code === 'started' ? 'left' : 'room');
    const inRound = this.state === 'intro' || this.state === 'playing';
    const map = { left: 'mpLeft', started: inRound ? 'mpLeft' : 'mpStarted', full: 'mpFull', room: 'mpGone', gone: 'mpGone', name: 'mpUnavailable', ratelimit: 'mpUnavailable' };
    const retry = m.code === 'full' || m.code === 'started' || m.code === 'gone' || (m.code === 'room' && this.state !== 'intro' && this.state !== 'playing');
    if (retry && (this._retries = (this._retries || 0) + 1) <= 3 && (this.state === 'connecting' || this.state === 'lobby' || this.state === 'matching')) {
      this._badRoom = this.room; this.state = 'idle'; setTimeout(() => this.begin(), 400); return;
    }
    this._retries = 0;
    this._fail(map[m.code] || 'mpUnavailable');
  }

  /** The server expects another placement file than ours. Only a genuinely stale tab gets a reload offer: re-fetch the (never cached) manifest and compare with what this code was released with. */
  async _versionRefused(m) {
    this._retries = 0;
    this._fail('mpUnavailable');          // back to the menu with the plain, blame-free message first
    let fresh = false;
    try {
      const slug = CFG.map ? CFG.map.slug : 'centrs';
      const r = await fetch('/data/placements.json?_=' + Date.now(), { cache: 'no-store' });
      const man = r.ok ? await r.json() : null;
      const h = man && man.maps && man.maps[slug] && man.maps[slug].hash;
      fresh = !!h && h !== expectedHash(slug);
    } catch { /* offline / blocked: keep the plain message */ }
    if (m && m.sv && m.sv !== MP_VERSION) fresh = true;    // the server speaks another protocol version than this (stale) tab: a reload is the fix
    if (fresh && this.state === 'idle') this.ui.setStatus(t('mpNewVersion'), false, { label: t('mpReload'), run: () => hardReload() });
  }

  _onClose(info) {
    if (info && info.code === 4001 && this.state !== 'idle') return this._fail('mpOtherTab', true);   // the same session joined from another tab: the newer one wins
    if (this.state === 'rejoining') return;
    if (this.state === 'intro' || this.state === 'playing') return this._startReconnect();
    if (this.state === 'lobby' && this.priv) return this._privReconnect();   // a friend lobby survives a dropped socket (the server keeps the host role for a few seconds)
    if (this.state === 'lobby' || this.state === 'connecting') return this._fail('mpUnavailable');
    // ended / idle: nothing to do (the server closes the room after the results)
  }

  // ---- lobby ---------------------------------------------------------------------------------------------------------------
  _onLobby(m) {
    this._retries = 0;
    const g = this.game;
    this.me = m.you; this.room = m.room || this.room;
    const prev = this.lobby;
    this.lobby = m;
    if (m.priv && !this.priv) this.priv = { code: m.code };
    if (this.state !== 'lobby') {
      const fromRound = this.state === 'ended' || this.state === 'playing' || this.state === 'intro';
      this.state = 'lobby';
      this.ui.setStatus('');
      if (fromRound) {   // rematch: back to a clean city, the results are gone
        clearSession(); clearInterval(this._hbT); this._hbT = null;
        g.world.reset(); restoreMoved(g.world); g.puView.clear(); g.holeViews.clearTrails(); this._removeMenuBtn(); this._againLabel(false); this.saved = null; this.privEnd = null; g.hud.clearTransient(); this.rec = null;
      }
      g.hud.showStart(false); g.hud.showResults(false); g.hud.showHud(false); g.hud.showTags(false);
      this._clearHoles();
      g.holes = [g.player];
      g.phase = 'menu';
      this._overviewCam();
      clearInterval(this.lobbyTimer); clearInterval(this.statusT);
      this.lobbyTimer = setInterval(() => this._lobbyTick(), 500);
      if (m.priv) { this.ui.showLobby(false); this.ui.friends.showPriv(true); }
      else {
        this.ui.showLobby(true);
        this._pollStatus();
        this.statusT = setInterval(() => this._pollStatus(), 2500);
      }
    }
    if (m.priv && prev && prev.host !== m.you && m.host === m.you && prev.you === m.you && window.__metaToast) window.__metaToast('★', t('mpHostMigrated'), { ms: 3200 });
    this._lobbyTick();
  }

  async _pollStatus() {
    const s = await fetchStatus();
    if (s) { this.status = s; if (this.state === 'lobby') this._lobbyTick(); }
  }

  _lobbyTick() {
    const m = this.lobby;
    if (!m || this.state !== 'lobby') return;
    if (m.priv) {
      this.ui.friends.privUpdate({
        code: m.code, me: this.me, host: m.host, max: m.max, cfg: m.cfg, ranked: m.ranked, botsTo: MP.totalHoles, wait: !!m.wait, running: m.running || null,
        players: m.players.map((p) => ({ id: p.id, name: p.name, color: MP_COLORS[p.slot % MP_COLORS.length], sk: p.sk })),
      });
      return;
    }
    const startsIn = m.startsAt == null ? null : Math.ceil((m.startsAt - this.client.serverNow()) / 1000);
    const run = this.status && this.status.running && this.status.running[0];
    this.ui.lobbyUpdate({
      players: m.players.map((p) => ({ id: p.id, name: p.name, color: MP_COLORS[p.slot % MP_COLORS.length] })),
      me: this.me, startsIn, max: m.max, bots: MP.totalHoles,
      running: run ? { timeLeft: run.timeLeft, top: run.top } : null, late: !!run,
    });
  }

  _overviewCam() {
    const g = this.game;
    g.overviewDist = g._overviewDist();
    g.cam.focus.set(g.overviewFocus.x, 0, g.overviewFocus.z);
    g.cam.dist = g.overviewDist; g.cam.lead.set(0, 0, 0); g.cam.apply();
  }

  // ---- round start / resume ---------------------------------------------------------------------------------------------
  _clearHoles() {
    const hud = this.game.hud;
    for (const [, tg] of hud.tagEls) tg.el.remove();
    hud.tagEls.clear();
    if (hud.markers) { hud.markers.clear(); if (hud.markerBox) hud.markerBox.textContent = ''; }
    this.byId.clear(); this.remotes = [];
  }

  _makeHoles(m) {
    const g = this.game;
    this._clearHoles();
    const holes = [g.player];
    for (const h of m.holes) {
      let hole;
      if (h.id === m.you) {
        hole = g.player; hole.id = h.id; hole.name = h.name; hole.color = new THREE.Color(MP_COLORS[h.slot % MP_COLORS.length]); hole.isBot = false;
        hole.skin = h.sk || this.mySk; hole.reset(h.x, h.z);
      } else {
        hole = new Hole({ id: h.id, name: h.name, color: MP_COLORS[h.slot % MP_COLORS.length], x: h.x, z: h.z });
        hole.isBot = !!h.bot; hole.remote = true; hole.skin = h.sk || null; hole.buf = [{ T: m.startAt, x: h.x, z: h.z, r: CFG.hole.startRadius }];
        hole.srvState = 0;
        holes.push(hole); this.remotes.push(hole);
      }
      this.byId.set(h.id, hole);
    }
    g.holes = holes;
  }

  _onStart(m) {
    const g = this.game;
    this.me = m.you; this.room = m.room || this.room;
    this.round = m;
    clearInterval(this.lobbyTimer); clearInterval(this.statusT);
    this.ui.showLobby(false); this.ui.friends.showPriv(false);
    g.world.reset(); restoreMoved(g.world);
    bus.emit('fmSet', !!m.fm);        // the server's Freedom Monument rule for this room (11-18 Nov)
    this.drive = null;
    this.serverEaten.clear(); this.mine.clear();
    this.pendC.length = 0; this.pendM.length = 0; this.pendP.length = 0; this.pickAsked.clear(); this.inflight.clear(); this.optimistic = 0; this.optPts = 0; this.serverScore = 0; this.serverMass = 0; this.saved = null;
    resetComboRound();
    g.puView.clear(); for (const [slot, ty, x, z] of m.pu || []) g.puView.spawn({ slot, type: PU_TYPES[ty], x, z });
    this._makeHoles(m);
    g.player.control = { mode: 'none', x: 0, z: 0 };
    g.killer = null;
    g.hud.clearTransient();
    g.paused = false; g.hud.showPause(false);
    g.unranked = 'online'; g.modeUnranked = 'online'; g._global = null;
    g.roundSeconds = (m.endAt - m.playAt) / 1000; g.timeLeft = g.roundSeconds;
    g.playT = 0; g.elapsed = 0;
    g.phase = 'intro';
    g.intro = { t: Math.max(0, (this.client.serverNow() - m.startAt) / 1000) };
    this._overviewCam();
    g.hud.showStart(false); g.hud.showResults(false); g.hud.showHud(true); g.hud.showTags(true);
    g.input.enabled = true;
    g._rank(); g._hudSync();
    g.hud.showMarkers(true);
    this.state = 'intro';
    this._persist(); this._startBeat();
    this.sendAt = 0;
    this.ui.net('ok', t('mpPing', { n: Math.round(this.client.rtt) }));
    bus.emit('introStart');
  }

  _go() {
    const g = this.game;
    this.state = 'playing';
    g.phase = 'playing'; g.intro = null;
    g.cam.snap(g.player);
    g.hud.showMarkers(false);
    g.hud.go(t('go'));
    g.playT = 0;
    bus.emit('roundGo');
  }

  _onResume(m) {
    const g = this.game;
    if (this.state === 'rejoining') { this._rejoinRec = null; this.ui.setStatus(''); this._onStart(m); }   // fresh page: build the round from the server's picture
    this.rec = null;
    this.me = m.you;
    // objects eaten so far (by anybody): hide the ones this client still shows; claims the server never saw are restored
    const eatenNow = new Set(m.eaten);
    for (const id of this.mine) if (!eatenNow.has(id)) { const o = this.world.objects[id]; if (o) this._restore(o); }
    this.mine.clear(); this.pendC.length = 0; this.pendM.length = 0; this.pendP.length = 0; this.pickAsked.clear(); this.inflight.clear(); this.optimistic = 0; this.optPts = 0;
    g.puView.clear(); for (const [slot, ty, x, z] of m.pu || []) g.puView.spawn({ slot, type: PU_TYPES[ty], x, z });
    for (const id of m.eaten) {
      this.serverEaten.add(id);
      const o = this.world.objects[id];
      if (o && o.state === 0) this._hideNow(o);
    }
    this.serverScore = m.me.score; this.serverMass = m.me.mass ?? m.me.score;
    const p = g.player;
    this._setFx(m.me.fx);
    p.combo.drop();
    p.score = m.me.score; p.mass = this.serverMass; p.targetRadius = radiusFromScore(p.mass);
    if (m.me.state === 0 && (!p.alive || p.dying)) { p.alive = true; p.dying = null; }
    // remote holes may have changed (left / respawned): rebuild the missing ones, then apply the snapshot
    for (const h of m.holes) {
      if (h.id !== m.you && !this.byId.has(h.id)) {
        const hole = new Hole({ id: h.id, name: h.name, color: MP_COLORS[h.slot % MP_COLORS.length], x: h.x, z: h.z });
        hole.isBot = !!h.bot; hole.remote = true; hole.skin = h.sk || null; hole.buf = []; hole.srvState = 0;
        g.holes.push(hole); this.remotes.push(hole); this.byId.set(h.id, hole);
      }
    }
    if (m.snap) this._onSnapshot(m.snap, true);
    this.ui.net('ok', t('mpPing', { n: Math.round(this.client.rtt) }));
    this._note({ t: 'resume', eaten: m.eaten.length, score: m.me.score });
  }

  /** Private lobby: the socket dropped (phone sleep, network): reconnect with the same session token a few times, then give up quietly. */
  async _privReconnect() {
    if (this._prc || !this.priv) return;
    this._prc = true;
    const code = this.priv.code;
    for (let i = 0; i < 8 && this.state === 'lobby' && this.priv; i++) {
      try { await this._connect(code, this.game.player.name || this.game.hud.getName(CFG.playerName)); this._prc = false; return; }   // answered by a lobby frame (or an error)
      catch { await sleep(1000); }
    }
    this._prc = false;
    if (this.state === 'lobby' && this.priv) this._fail('mpUnavailable');
  }

  /** Back in the foreground (phone: app switch, call, screen lock): if the socket died meanwhile, say "reconnecting" at once and rejoin. */
  onForeground() {
    if (this.state === 'lobby' && this.priv && (!this.client.open || !this.client.checkAlive(3500))) { this._privReconnect(); return; }
    if (this.state !== 'intro' && this.state !== 'playing') return;
    if (this.rec) return;
    if (!this.client.open || !this.client.checkAlive(3500)) this._startReconnect();   // (a socket that looks open but has been silent for seconds is dead)
  }

  _startReconnect() {
    if (this.rec) return;
    this.rec = { t0: Date.now(), tries: 0 };
    this.ui.net('bad', t('mpReconnecting'));
    const attempt = async () => {
      if (!this.rec) return;
      if (Date.now() - this.rec.t0 > RECONNECT_GIVE_UP_MS) { this.rec = null; this._fail('mpLost', true); return; }
      this.rec.tries++;
      try { await this._connect(this.room, this.game.player.name); }
      catch { setTimeout(attempt, 900); return; }
      // a successful hello is answered by {t:'resume'} (-> this.rec = null) or {t:'err'}
      setTimeout(() => { if (this.rec && !this.client.open) attempt(); }, 2500);
    };
    setTimeout(attempt, 400);
  }

  // ---- snapshots ----------------------------------------------------------------------------------------------------------
  _onSnapshot(m, silent = false) {
    const g = this.game;
    const seen = new Set();
    for (const row of m.h) {
      const [id, x, z, r, score, st, mask] = row;
      seen.add(id);
      if (id === this.me) {
        this.serverScore = score;
        this._applyScore();
        continue;
      }
      const h = this.byId.get(id);
      if (!h) continue;
      h.score = score; h.srvState = st;
      for (const ty of PU_TYPES) { const on = (mask & (1 << PU_TYPES.indexOf(ty))) !== 0; h.fx[ty] = on ? Math.max(h.fx[ty], 5) : 0; }   // others: only whether an effect runs (shield ring, aura)
      h.buf.push({ T: m.T, x, z, r });
      if (h.buf.length > 240) h.buf.shift();
      if (st === 0 && !h.alive && !h.dying && !h._respawnPending) { h.alive = true; h.buf.length = 0; h.buf.push({ T: m.T, x, z, r }); }
    }
    if (m.d) for (const id of m.d) this._removeHole(id);
    if (m.e) for (const [oid, hid] of m.e) this._remoteEat(oid, hid);
    if (m.k) for (const [a, v, gain] of m.k) this._onKill(a, v, gain);
    if (m.r) for (const [id, x, z, score, mass] of m.r) this._onRespawn(id, x, z, score, m.T, mass);
    if (m.ps) for (const [slot, ty, x, z] of m.ps) g.puView.spawn({ slot, type: PU_TYPES[ty], x, z });
    if (m.px) for (const slot of m.px) { g.puView.remove(slot, false); this.pickAsked.delete(slot); }
    if (m.pp) for (const [slot, hid, ty, ms] of m.pp) this._onPickup(slot, hid, PU_TYPES[ty], ms);
    if (silent) return;
    this._netBadge();
  }

  _netBadge() {
    const rtt = Math.round(this.client.rtt);
    this.ui.net(rtt > 400 ? 'bad' : rtt > 180 ? 'warn' : 'ok', t('mpPing', { n: rtt }));
  }

  _applyScore() {
    const p = this.game.player;
    p.score = Math.max(0, this.serverScore + this.optPts);
    p.mass = Math.max(0, this.serverMass + this.optimistic);       // the size follows the growth mass, never the multiplied points
    p.targetRadius = radiusFromScore(p.mass);
  }

  /** Effects of the local hole from the server's remaining milliseconds (PU_TYPES order). */
  _setFx(arr) {
    const p = this.game.player;
    if (!Array.isArray(arr)) return;
    PU_TYPES.forEach((ty, i) => { const v = Math.max(0, +arr[i] || 0) / 1000; if (v > 0 || p.fx[ty] > 0) p.fx[ty] = v; });
  }

  /** The server says hole `hid` collected pickup `slot`: first valid claim wins. */
  _onPickup(slot, hid, type, ms) {
    const g = this.game, h = this.byId.get(hid);
    this.pickAsked.delete(slot);
    g.puView.remove(slot, true, h || null);
    if (!h) return;
    if (h === g.player) {
      h.pick(type); if (ms > 0) h.fx[type] = ms / 1000;   // (the server's duration; the fx list of the next ack keeps it in step)
      comboRound.picked.add(type); g.hud.puToast(type, PU[type].dur); bus.emit('powerupPicked', { type });
    }
    bus.emit('powerup', { type, hole: h, slot });
  }

  _removeHole(id) {
    const h = this.byId.get(id);
    if (!h || h === this.game.player) return;
    this.byId.delete(id);
    this.remotes.splice(this.remotes.indexOf(h), 1);
    const gi = this.game.holes.indexOf(h); if (gi >= 0) this.game.holes.splice(gi, 1);
    const tg = this.game.hud.tagEls.get(id); if (tg) { tg.el.remove(); this.game.hud.tagEls.delete(id); }
  }

  /** Object eaten by someone else (human or bot): play the fall towards that hole. */
  _remoteEat(oid, hid) {
    this.serverEaten.add(oid);
    this.mine.delete(oid);
    const o = this.world.objects[oid];
    if (!o || o.state !== 0 || hid === this.me) return;
    const h = this.byId.get(hid);
    if (!h) { this._hideNow(o); return; }
    if (o.mover) { // movers are simulated per client: bring it to the eater so the fall looks right
      const a = Math.random() * 6.283, d = Math.random() * h.radius * 0.5;
      this.world.moveObject(o, h.x + Math.cos(a) * d, h.z + Math.sin(a) * d);
    }
    this.world.beginFall(o, h);
  }

  _hideNow(o) {
    const w = this.world;
    w.falling.delete(o); w.wobbling.delete(o);
    if (o.state === 0) { if (o.isBuilding) w.counts.remainingBuildings--; else w.counts.remainingProps--; }
    o.state = 2; w._hide(o);
  }

  /** The server rejected (or never saw) a claim: bring the object back. */
  _restore(o) {
    const w = this.world;
    if (o.state === 0 || this.serverEaten.has(o.id)) return;
    w.falling.delete(o);
    o.state = 0; o.t = 0; o.hole = null;
    w._write(o, o.x, 0, o.z, null, o.s);
    if (o.isBuilding) { w.buildingMesh.setVisibleAt(o.batchId, true); w.counts.remainingBuildings++; } else w.counts.remainingProps++;
    this.game.player.eaten = Math.max(0, this.game.player.eaten - 1);
  }

  _onAck(m) {
    this._note(m);
    const b = this.inflight.get(m.q);
    if (b) {
      this.inflight.delete(m.q);
      this.optimistic = Math.max(0, this.optimistic - b.value);
      this.optPts = Math.max(0, this.optPts - b.pts);
      for (const id of b.ids) this.mine.delete(id);
    }
    this.serverScore = m.s; if (m.m != null) this.serverMass = m.m;
    this._setFx(m.fx);
    if (m.pb) for (const slot of m.pb) this.pickAsked.delete(slot);
    if (m.b && m.b.length) for (const id of m.b) { const o = this.world.objects[id]; if (o) this._restore(o); }
    this._applyScore();
  }

  // ---- hole vs hole ---------------------------------------------------------------------------------------------------------
  _onKill(eid, vid, gain) {
    const g = this.game, eater = this.byId.get(eid), victim = this.byId.get(vid);
    if (!eater || !victim || victim.dying || !victim.alive) return;
    const D = CFG.duel;
    victim.dying = { by: eater, t: 0, r0: victim.radius, rx: victim.x - eater.x, rz: victim.z - eater.z, spin: (Math.random() < 0.5 ? -1 : 1) * 2.4 };
    victim.vx = victim.vz = 0; victim._respawnPending = true;
    victim.deaths++; eater.kills++;
    bus.emit('holeEaten', { eater, victim, gain });
    const isMe = victim === g.player;
    if (isMe) bus.emit('playerEaten', { eater, victim });
    const span = (txt, c) => { const e = document.createElement('span'); e.textContent = txt; if (c) e.style.color = c; return e; };
    const col = (h) => '#' + h.color.getHexString();
    g.hud.feedItem([span(eater.name, col(eater)), span(` ${t('feedVerb')} `), span(victim.name, col(victim)), span(` +${Math.round(gain)}`)], col(eater));
    if (isMe) { g.killer = eater; g.hud.showSwallowed(true, eater.name, col(eater), D.dyingTime + D.respawnDelay); }
    if (eater === g.player) {
      g._v.set(victim.x, 2, victim.z).project(g.cam.camera);
      g.hud.popup((g._v.x * 0.5 + 0.5) * g.canvas.clientWidth, (-g._v.y * 0.5 + 0.5) * g.canvas.clientHeight, `+${Math.round(gain)}`, true);
    }
  }

  _onRespawn(id, x, z, score, T, mass) {
    const g = this.game, h = this.byId.get(id);
    if (!h) return;
    h._respawnPending = false;
    h.score = score; h.mass = mass ?? score;
    h.respawn(x, z, 1, CFG.duel.protect);
    if (h === g.player) {
      this.serverScore = score; this.serverMass = mass ?? score; this.optimistic = 0; this.optPts = 0; this._applyScore();
      h.radius = h.targetRadius;
      g.killer = null; g.hud.showSwallowed(false); g.cam.snap(h);
    } else { h.buf.length = 0; h.buf.push({ T, x, z, r: h.radius }); }
    bus.emit('respawn', h);
    h.control.mode = 'none';
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------
  /** Game.update() replacement while online. */
  update(dt, quiet) {
    const g = this.game;
    dt = Math.min(dt, 0.1);
    g.elapsed += dt;
    const st = this.state;
    if (st !== 'intro' && st !== 'playing' && st !== 'ended') { this._idleView(dt); return; }
    const now = this.client.serverNow();
    const round = this.round;
    if (st === 'intro') {
      g.intro.t = Math.max(0, (now - round.startAt) / 1000);
      if (now >= round.playAt) this._go();
    }
    const playing = this.state === 'playing';
    if (playing) {
      g.timeLeft = Math.max(0, (round.endAt - now) / 1000);
      g.playT += dt;
      const p = g.player;
      p.control = !(p.alive && !p.dying) ? { mode: 'none', x: 0, z: 0 } : this.drive ? { mode: 'target', x: this.drive.x, z: this.drive.z } : g.input.getControl(g.cam.camera);
    }
    // local hole
    const p = g.player;
    if (p.dying) g._advanceDying(p, dt);
    else if (!p.alive) p.respawnT = Math.max(0.5, p.respawnT - dt); // waits for the server's respawn
    else {
      if (playing) { p.fx.tick(dt); p.boost = p.fx.speedMul; }
      p.update(dt, this.world.bounds);
      if (p.protectT > 0) p.protectT = Math.max(0, p.protectT - dt);
      if (playing) {
        if (p.fx.magnet > 0) pullObjects(this.world, p, dt);
        updateSwallow(this.world, p, (hh, o, res) => { g._onSwallow(hh, o, res); this._claim(o, res); }, g.playT);
        this._touchPickups(p);
        const lost = p.combo.tick(g.playT);
        if (lost) bus.emit('comboLost', { count: lost, hole: p });
      }
    }
    // remote holes: interpolated from snapshots
    const rt = now - INTERP_MS;
    for (const h of this.remotes) {
      if (h.dying) { g._advanceDying(h, dt); continue; }
      if (!h.alive) continue;
      if (h.protectT > 0) h.protectT = Math.max(0, h.protectT - dt);
      this._interp(h, rt);
    }
    if (playing) this._flush();
    this.world.update(dt, g.elapsed);
    g._syncVisuals(dt);
    if (!quiet) { g._flushPopup(dt); g._overlay(dt); this._marks(); g._hudSync(); }
  }

  _idleView(dt) {
    const g = this.game;
    this.world.update(dt, g.elapsed);
    g.world.ground.userData.detail.update(g.cam.focus.x, g.cam.focus.z, g.cam.dist);
    g.world.setViewDistance(g.cam.dist);
    g.light.update(g.cam.focus, g.cam.dist);
    g.holeViews.update([]);
  }

  _interp(h, rt) {
    const b = h.buf;
    if (!b.length) return;
    let i = 0;
    while (i + 1 < b.length && b[i + 1].T <= rt) i++;
    if (i > 0 && b.length > 3) b.splice(0, Math.min(i - 1, b.length - 3));
    i = Math.min(i, b.length - 1);
    const a = b[i], c = b[i + 1];
    let x, z, r, vx = 0, vz = 0;
    if (c && rt >= a.T) {
      const k = Math.min(1, (rt - a.T) / Math.max(1, c.T - a.T));
      x = a.x + (c.x - a.x) * k; z = a.z + (c.z - a.z) * k; r = a.r + (c.r - a.r) * k;
      const dtS = Math.max(0.001, (c.T - a.T) / 1000); vx = (c.x - a.x) / dtS; vz = (c.z - a.z) / dtS;
    } else {
      // past the newest sample: extrapolate briefly along the last velocity, then hold
      const q = b.length > 1 ? b[b.length - 2] : a, last = b[b.length - 1];
      const dtS = Math.max(0.001, (last.T - q.T) / 1000);
      vx = (last.x - q.x) / dtS; vz = (last.z - q.z) / dtS;
      const ex = Math.max(0, Math.min(150, rt - last.T)) / 1000;
      x = last.x + vx * ex; z = last.z + vz * ex; r = last.r;
    }
    h.x = x; h.z = z; h.vx = vx; h.vz = vz; h.radius = r; h.targetRadius = r;
  }

  // ---- outgoing --------------------------------------------------------------------------------------------------------------
  _claim(o, res) {
    const mass = res ? res.mass : o.value, pts = res ? res.pts : o.value;
    this.optimistic += mass; this.optPts += pts;
    this.mine.add(o.id);
    if (o.mover) this.pendM.push([o.id, r1(o.x), r1(o.z), mass, pts]);
    else this.pendC.push([o.id, mass, pts]);
  }

  /** The local hole touches a pickup: ask the server for it (it validates distance + existence; the first valid claim wins). */
  _touchPickups(p) {
    const R = pickRadius(p.radius), now = performance.now();
    for (const it of this.game.puView.items.values()) {
      if (Math.hypot(it.x - p.x, it.z - p.z) > R) continue;
      const at = this.pickAsked.get(it.slot);
      if (at && now - at < 900) continue;
      this.pickAsked.set(it.slot, now);
      this.pendP.push(it.slot);
    }
  }

  _flush() {
    const now = performance.now();
    if (now - this.sendAt < SEND_MS) return;
    this.sendAt = now;
    const p = this.game.player;
    if (!p.alive || p.dying) { this.pendC.length = 0; this.pendM.length = 0; this.pendP.length = 0; return; }
    const msg = { t: 'u', q: ++this.seq, x: r1(p.x), z: r1(p.z), ct: Math.round(this.client.serverNow()) };   // ct: our clock estimate (the server's combo timing uses it)
    let value = 0, pts = 0; const ids = [];
    if (this.pendC.length) { const take = this.pendC.splice(0, MP.maxClaimIds); msg.c = take.map((e) => { value += e[1]; pts += e[2]; ids.push(e[0]); return e[0]; }); }
    if (this.pendM.length) { const take = this.pendM.splice(0, MP.maxClaimMovers); msg.m = take.map((e) => { value += e[3]; pts += e[4]; ids.push(e[0]); return [e[0], e[1], e[2]]; }); }
    if (this.pendP.length) msg.p = this.pendP.splice(0, MP.maxPickClaims);
    if (ids.length) this.inflight.set(msg.q, { value, pts, ids });
    this.client.send(msg);
  }

  // ---- overlay marks ------------------------------------------------------------------------------------------------------------
  /** Subtle "AI" mark for server bots on tags / leaderboard rows; run after Game._overlay(). */
  _marks() {
    const g = this.game, hud = g.hud;
    for (const h of g.holes) {
      const tg = hud.tagEls.get(h.id);
      if (tg && tg.bot !== !!h.isBot) { tg.bot = !!h.isBot; tg.el.classList.toggle('bot', tg.bot); }
    }
    const rows = g.rows || [], top = rows.slice(0, 5), me = rows.find((r) => r.isPlayer);
    if (me && me.rank > 5) top.push(me);
    for (let i = 0; i < hud.boardRows.length; i++) hud.boardRows[i].li.classList.toggle('bot', !!(top[i] && top[i].isBot));
  }

  // ---- end of round ------------------------------------------------------------------------------------------------------------
  _onEnd(m) {
    const g = this.game;
    if (this.state === 'ended') return;
    this.state = 'ended';
    this._note({ t: 'end', n: m.rank.length });
    this.finalRank = m.rank;
    this.privEnd = m.priv || null;
    this.rec = null;
    g.phase = 'ended'; g.timeLeft = 0; g.input.enabled = false; g.player.control = { mode: 'none', x: 0, z: 0 };
    g.hud.showSwallowed(false); g.hud.showTags(false);
    const rows = m.rank.map((r) => ({
      rank: r.rank, id: r.id, name: r.name, score: r.score, radius: r.radius, isPlayer: r.id === this.me, isBot: r.bot, alive: true,
      color: hexOf(MP_COLORS[r.slot % MP_COLORS.length]),
    }));
    g.rows = rows;
    const mine = m.rank.find((r) => r.id === this.me) || { rank: rows.length, score: g.player.score, eaten: g.player.eaten, kills: 0, deaths: 0, radius: g.player.radius };
    const p = g.player;
    p.score = mine.score; p.targetRadius = mine.radius ? mine.radius : p.targetRadius;
    g._res = { score: mine.score, bestCombo: mine.bestCombo || Math.round(p.combo.best), bestMult: mine.bestMult || p.combo.bestMult, picks: { ...p.picks }, eaten: mine.eaten, kills: mine.kills, deaths: mine.deaths, radius: mine.radius, level: g._level().level,
      biggest: p.biggest, rank: mine.rank, total: rows.length, table: rows, online: true };
    g._showResults();
    this._markResults(rows);
    this._showSaved(true);
    g._hudSync();
    this._addMenuBtn();
    if (this.priv) this._againLabel(true);
    this._persist(); this._startBeat();
    this.ui.net('ok', t('mpPing', { n: Math.round(this.client.rtt) }));
  }

  _markResults(rows) {
    const trs = document.querySelectorAll('#r-table tr');
    trs.forEach((tr, i) => { const r = rows[i]; if (!r) return; tr.classList.toggle('bot', !!r.isBot); tr.classList.toggle('human', !r.isBot); });
  }

  _showSaved(initial = false) {
    if (this.state !== 'ended') return;
    const g = this.game;
    if (this.priv) {   // private round: say whether it counts for the online board (>= 2 humans + the standard length)
      const ranked = !!(this.privEnd && this.privEnd.ranked);
      g.hud.setGlobal(t(!ranked ? 'mpPrivUnranked' : this.saved === true ? 'mpPrivRankedSaved' : this.saved === false ? 'mpNotSaved' : 'mpSaving'), true);
      return;
    }
    g.hud.setGlobal(t(initial ? (this.saved === true ? 'mpSaved' : this.saved === false ? 'mpNotSaved' : 'mpSaving') : this.saved ? 'mpSaved' : 'mpNotSaved'), true);
  }

  _addMenuBtn() {
    if (this._menuBtn) return;
    const again = document.getElementById('again');
    if (!again) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'mp-menu'; b.className = 'link'; b.textContent = t('mpMenu');
    b.addEventListener('click', () => this.leave());
    again.after(b);
    this._menuBtn = b;
  }

  _removeMenuBtn() { if (this._menuBtn) { this._menuBtn.remove(); this._menuBtn = null; } }

  // ---- test / debug API -----------------------------------------------------------------------------------------------------
  api() {
    const o = this;
    return {
      get state() { return o.state; },
      get me() { return o.me; },
      get room() { return o.room; },
      get rtt() { return o.client.rtt; },
      get socket() { return o.client.ws ? o.client.ws.readyState : -1; },
      get stats() { return { ...o.client.stats }; },
      get serverScore() { return o.serverScore; },
      get serverMass() { return o.serverMass; },
      get pending() { return { inflight: o.inflight.size, seq: o.seq, pendC: o.pendC.length, mine: o.mine.size }; },
      get combo() { const c = o.game.player.combo; return { count: c.count, mult: c.mult, best: c.best }; },
      get fx() { return { ...o.game.player.fx }; },
      get powerups() { return o.game.puView.list(); },
      get picks() { return { ...o.game.player.picks }; },
      get optimistic() { return o.optimistic; },
      get log() { return o.log.slice(); },
      get lobby() { return o.lobby; },
      get round() { return o.round; },
      get saved() { return o.saved; },
      get final() { return o.finalRank; },
      get self() { const p = o.game.player; return { id: p.id, x: p.x, z: p.z, radius: p.radius, score: p.score, mass: p.mass, alive: p.alive, dying: !!p.dying, protectT: p.protectT, kills: p.kills, deaths: p.deaths, eaten: p.eaten }; },
      drive: (x, z) => { o.drive = x == null ? null : { x, z }; },
      get reconnecting() { return !!o.rec; },
      get token() { return o.client.token; },
      forceHash: (h) => { o._hash = h; },   // test hook: pretend to be another client version
      get session() { return loadSession(); },
      get alive() { return o.client.checkAlive(1e9); },
      get lastRxAge() { return performance.now() - o.client.lastRx; },
      remotes: () => o.remotes.map((h) => ({ id: h.id, skin: h.skin, name: h.name, x: h.x, z: h.z, radius: h.radius, score: h.score, fx: { ...h.fx }, isBot: !!h.isBot, alive: h.alive, dying: !!h.dying })),
      send: (m) => o.client.send(m),
      drop: () => o.client.dropForTest(),
      serverNow: () => o.client.serverNow(),
      eatenIds: () => [...o.serverEaten],
      get ui() { return o.ui; },   // tests: the layout suite drives the panels with fake data
      get priv() { return o.priv; },
      get privEnd() { return o.privEnd; },
      get mySkin() { return o.mySk; },
      rimInfo: (id) => o.game.holeViews.rimInfo(id),
      holeIds: () => o.game.holes.map((h) => ({ id: h.id, bot: !!h.isBot, skin: h.skin, name: h.name })),
      createPrivate: () => o.createPrivate(),
      joinPrivate: (c) => o.joinPrivate(c),
      rematch: () => o.rematch(),
      begin: () => o.begin(),
      leave: () => o.leave(),
      playAgain: () => o.playAgain(),
    };
  }
}
