// Online mode ("Tiešsaiste"): glue between the room server (worker/mp) and the existing Game.
//
// While `game.online` is set, Game.update() hands the frame to OnlineMode.update(): the local hole is simulated here as usual
// (responsive), every other hole (humans AND server-simulated bots) is a plain Hole object whose x/z/radius/score come from
// interpolated server snapshots, so the ground shader, minimap, leaderboard, name tags and kill feed work unchanged.
// The server is authoritative for score / radius / kills / clock / ranking; the client only predicts its own eats (score shown =
// server score + not-yet-acknowledged claims) and gets corrected by acks and snapshots.
import * as THREE from 'three';
import { CFG, radiusFromScore } from '../config.js';
import { Hole, updateSwallow } from '../holes.js';
import { bus } from '../events.js';
import { t, kindName } from '../i18n.js';
import { MpClient, fetchStatus } from './client.js';
import { worldHash } from './table.js';
import { OnlineUi } from './ui.js';
import { MP } from '../../worker/mp/protocol.js';

export const MP_COLORS = [...CFG.holeColors, 0x2fa0b5, 0xff8a5c, 0x6c7be0, 0xb0a02f];
const INTERP_MS = 130;       // remote holes are drawn this far in the past (smooth between 10 Hz snapshots)
const SEND_MS = 80;          // ~12 Hz position + claims
const RECONNECT_GIVE_UP_MS = 14000;
const hexOf = (n) => '#' + n.toString(16).padStart(6, '0');
const r1 = (v) => Math.round(v * 10) / 10;

export class OnlineMode {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.client = new MpClient();
    this.ui = new OnlineUi();
    this.state = 'idle';   // idle | matching | connecting | lobby | intro | playing | ended | error
    this.room = null; this.me = -1;
    this.byId = new Map();            // server hole id -> Hole (player + remotes)
    this.remotes = [];
    this.serverScore = 0; this.optimistic = 0;
    this.pendC = []; this.pendM = []; this.inflight = new Map(); this.seq = 0; this.sendAt = 0;
    this.serverEaten = new Set();
    this.mine = new Set();            // object ids this client claimed and has not seen confirmed
    this.lobby = null; this.status = null; this.statusT = null; this.lobbyTimer = null;
    this.rec = null;                  // reconnect state
    this.drive = null;                // test hook: steer the local hole to a point (still validated by the server)
    this.finalRank = null;
    this.log = [];                    // recent control messages (tests / debugging)
    this.saved = null;
    this._hash = null;
    this.client.onMessage = (m) => this._onMessage(m);
    this.client.onClose = (info) => this._onClose(info);
    this.ui.mountButton(() => this.begin());
    this.ui.onLeave(() => this.leave());
    this._menuBtn = null;
  }

  get active() { return this.state !== 'idle'; }

  // ---- entering / leaving -----------------------------------------------------------------------------------------
  async begin() {
    if (this.state !== 'idle' && this.state !== 'error') return;
    const g = this.game;
    if (!this._enter) {
      this._enter = true;
      this._solo = { holes: g.holes, k: CFG.growth.k, id: g.player.id, color: g.player.color, name: g.player.name };
      CFG.growth.k = 16; // online rooms always use the classic growth curve (the server's numbers)
    }
    g.online = this;
    document.body.classList.add('mp-online');
    this.ui.setButtonBusy(true);
    this.ui.setStatus(t('mpConnecting'), true);
    this.state = 'matching';
    try {
      this._hash = this._hash || worldHash(this.world);
      const j = await this.client.matchmake(this._badRoom);
      this._badRoom = null;
      if (this.state !== 'matching') return;
      if (!j || !j.room) throw new Error('matchmake');
      this.room = j.room;
      this.state = 'connecting';
      await this.client.connect(this.room, { name: g.hud.getName(CFG.playerName), hash: this._hash });
      // the server answers with {t:'lobby'} (or {t:'err'})
    } catch (e) {
      if (this.state === 'matching' || this.state === 'connecting') this._fail('mpUnavailable');
    }
  }

  /** Back to the single-player menu (also used after errors). */
  leave() {
    const g = this.game;
    try { this.client.send({ t: 'bye' }); } catch { /* */ }
    this.client.close(true);
    clearInterval(this.lobbyTimer); clearInterval(this.statusT);
    this.rec = null;
    this.state = 'idle';
    this.ui.showLobby(false);
    this.ui.setButtonBusy(false);
    this.ui.setStatus('');
    document.body.classList.remove('mp-online');
    this._removeMenuBtn();
    if (this._enter) {
      this._enter = false;
      const s = this._solo;
      CFG.growth.k = s.k;
      this._clearHoles();
      g.holes = s.holes;
      g.player.id = s.id; g.player.color = s.color; g.player.name = s.name; g.player.isBot = undefined;
      g.online = null;
      g.phase = 'menu'; g.intro = null; g.paused = false;
      g.world.reset();
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
    if (this.state === 'ended') this.playAgain();
  }

  async playAgain() {
    this.client.close(true);
    this.saved = null;
    this._removeMenuBtn();
    this.game.hud.showResults(false);
    this.state = 'idle';
    this.ui.setStatus('');
    await this.begin();
  }

  _fail(key, ms) {
    this.client.close(true);
    clearInterval(this.lobbyTimer); clearInterval(this.statusT);
    this.ui.showLobby(false);
    const wasGame = this.game.phase === 'intro' || this.game.phase === 'playing';
    const text = t(key);
    this.leave();
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
      case 's': return this._onSnapshot(m);
      case 'a': return this._onAck(m);
      case 'rb': {
        this._note(m);
        const p = this.game.player;
        if (p.alive && !p.dying) { p.x = m.x; p.z = m.z; p.vx = p.vz = 0; this.game.cam.snap(p); }
        return;
      }
      case 'end': return this._onEnd(m);
      case 'saved': this.saved = m.ok; this._note(m); this._showSaved(); return;
      case 'err': this._note(m); return this._onErr(m);
      default: this._note(m);
    }
  }

  _note(m) { this.log.push({ ...m, at: Date.now() }); if (this.log.length > 60) this.log.shift(); }

  _onErr(m) {
    const map = { version: 'mpVersion', started: 'mpStarted', full: 'mpFull', room: 'mpGone', gone: 'mpGone', name: 'mpUnavailable', ratelimit: 'mpUnavailable' };
    const retry = m.code === 'full' || m.code === 'started' || m.code === 'gone' || (m.code === 'room' && this.state !== 'intro' && this.state !== 'playing');
    if (retry && (this._retries = (this._retries || 0) + 1) <= 3 && (this.state === 'connecting' || this.state === 'lobby' || this.state === 'matching')) {
      this._badRoom = this.room; this.state = 'idle'; setTimeout(() => this.begin(), 400); return;
    }
    this._retries = 0;
    this._fail(map[m.code] || 'mpUnavailable');
  }

  _onClose(info) {
    if (this.state === 'intro' || this.state === 'playing') return this._startReconnect();
    if (this.state === 'lobby' || this.state === 'connecting') return this._fail('mpUnavailable');
    // ended / idle: nothing to do (the server closes the room after the results)
  }

  // ---- lobby ---------------------------------------------------------------------------------------------------------------
  _onLobby(m) {
    this._retries = 0;
    const g = this.game;
    this.me = m.you; this.room = m.room || this.room;
    this.lobby = m;
    if (this.state !== 'lobby') {
      this.state = 'lobby';
      this.ui.setStatus('');
      g.hud.showStart(false); g.hud.showResults(false); g.hud.showHud(false); g.hud.showTags(false);
      this._clearHoles();
      g.holes = [g.player];
      g.phase = 'menu';
      this._overviewCam();
      this.ui.showLobby(true);
      clearInterval(this.lobbyTimer); clearInterval(this.statusT);
      this.lobbyTimer = setInterval(() => this._lobbyTick(), 500);
      this._pollStatus();
      this.statusT = setInterval(() => this._pollStatus(), 2500);
    }
    this._lobbyTick();
  }

  async _pollStatus() {
    const s = await fetchStatus();
    if (s) { this.status = s; if (this.state === 'lobby') this._lobbyTick(); }
  }

  _lobbyTick() {
    const m = this.lobby;
    if (!m || this.state !== 'lobby') return;
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
        hole.reset(h.x, h.z);
      } else {
        hole = new Hole({ id: h.id, name: h.name, color: MP_COLORS[h.slot % MP_COLORS.length], x: h.x, z: h.z });
        hole.isBot = !!h.bot; hole.remote = true; hole.buf = [{ T: m.startAt, x: h.x, z: h.z, r: CFG.hole.startRadius }];
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
    this.ui.showLobby(false);
    g.world.reset();
    this.drive = null;
    this.serverEaten.clear(); this.mine.clear();
    this.pendC.length = 0; this.pendM.length = 0; this.inflight.clear(); this.optimistic = 0; this.serverScore = 0; this.saved = null;
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
    this.rec = null;
    this.me = m.you;
    // objects eaten so far (by anybody): hide the ones this client still shows; claims the server never saw are restored
    const eatenNow = new Set(m.eaten);
    for (const id of this.mine) if (!eatenNow.has(id)) { const o = this.world.objects[id]; if (o) this._restore(o); }
    this.mine.clear(); this.pendC.length = 0; this.pendM.length = 0; this.inflight.clear(); this.optimistic = 0;
    for (const id of m.eaten) {
      this.serverEaten.add(id);
      const o = this.world.objects[id];
      if (o && o.state === 0) this._hideNow(o);
    }
    this.serverScore = m.me.score;
    const p = g.player;
    p.score = m.me.score; p.targetRadius = radiusFromScore(p.score);
    if (m.me.state === 0 && (!p.alive || p.dying)) { p.alive = true; p.dying = null; }
    // remote holes may have changed (left / respawned): rebuild the missing ones, then apply the snapshot
    for (const h of m.holes) {
      if (h.id !== m.you && !this.byId.has(h.id)) {
        const hole = new Hole({ id: h.id, name: h.name, color: MP_COLORS[h.slot % MP_COLORS.length], x: h.x, z: h.z });
        hole.isBot = !!h.bot; hole.remote = true; hole.buf = []; hole.srvState = 0;
        g.holes.push(hole); this.remotes.push(hole); this.byId.set(h.id, hole);
      }
    }
    if (m.snap) this._onSnapshot(m.snap, true);
    this.ui.net('ok', t('mpPing', { n: Math.round(this.client.rtt) }));
    this._note({ t: 'resume', eaten: m.eaten.length, score: m.me.score });
  }

  _startReconnect() {
    if (this.rec) return;
    this.rec = { t0: Date.now(), tries: 0 };
    this.ui.net('bad', t('mpReconnecting'));
    const attempt = async () => {
      if (!this.rec) return;
      if (Date.now() - this.rec.t0 > RECONNECT_GIVE_UP_MS) { this.rec = null; this._fail('mpLost'); return; }
      this.rec.tries++;
      try { await this.client.connect(this.room, { name: this.game.player.name, hash: this._hash }); }
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
      const [id, x, z, r, score, st] = row;
      seen.add(id);
      if (id === this.me) {
        this.serverScore = score;
        this._applyScore();
        continue;
      }
      const h = this.byId.get(id);
      if (!h) continue;
      h.score = score; h.srvState = st;
      h.buf.push({ T: m.T, x, z, r });
      if (h.buf.length > 240) h.buf.shift();
      if (st === 0 && !h.alive && !h.dying && !h._respawnPending) { h.alive = true; h.buf.length = 0; h.buf.push({ T: m.T, x, z, r }); }
    }
    if (m.d) for (const id of m.d) this._removeHole(id);
    if (m.e) for (const [oid, hid] of m.e) this._remoteEat(oid, hid);
    if (m.k) for (const [a, v, gain] of m.k) this._onKill(a, v, gain);
    if (m.r) for (const [id, x, z, score] of m.r) this._onRespawn(id, x, z, score, m.T);
    if (silent) return;
    this._netBadge();
  }

  _netBadge() {
    const rtt = Math.round(this.client.rtt);
    this.ui.net(rtt > 400 ? 'bad' : rtt > 180 ? 'warn' : 'ok', t('mpPing', { n: rtt }));
  }

  _applyScore() {
    const p = this.game.player;
    p.score = Math.max(0, this.serverScore + this.optimistic);
    p.targetRadius = radiusFromScore(p.score);
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
      for (const id of b.ids) this.mine.delete(id);
    }
    this.serverScore = m.s;
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

  _onRespawn(id, x, z, score, T) {
    const g = this.game, h = this.byId.get(id);
    if (!h) return;
    h._respawnPending = false;
    h.score = score;
    h.respawn(x, z, 1, CFG.duel.protect);
    if (h === g.player) {
      this.serverScore = score; this.optimistic = 0; this._applyScore();
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
      p.update(dt, this.world.bounds);
      if (p.protectT > 0) p.protectT = Math.max(0, p.protectT - dt);
      if (playing) updateSwallow(this.world, p, (hh, o) => { g._onSwallow(hh, o); this._claim(o); });
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
  _claim(o) {
    this.optimistic += o.value;
    this.mine.add(o.id);
    if (o.mover) this.pendM.push([o.id, r1(o.x), r1(o.z), o.value]);
    else this.pendC.push([o.id, o.value]);
  }

  _flush() {
    const now = performance.now();
    if (now - this.sendAt < SEND_MS) return;
    this.sendAt = now;
    const p = this.game.player;
    if (!p.alive || p.dying) { this.pendC.length = 0; this.pendM.length = 0; return; }
    const msg = { t: 'u', q: ++this.seq, x: r1(p.x), z: r1(p.z) };
    let value = 0; const ids = [];
    if (this.pendC.length) { const take = this.pendC.splice(0, MP.maxClaimIds); msg.c = take.map((e) => { value += e[1]; ids.push(e[0]); return e[0]; }); }
    if (this.pendM.length) { const take = this.pendM.splice(0, MP.maxClaimMovers); msg.m = take.map((e) => { value += e[3]; ids.push(e[0]); return [e[0], e[1], e[2]]; }); }
    if (ids.length) this.inflight.set(msg.q, { value, ids });
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
    g.phase = 'ended'; g.timeLeft = 0; g.input.enabled = false; g.player.control = { mode: 'none', x: 0, z: 0 };
    g.hud.showSwallowed(false); g.hud.showTags(false);
    const rows = m.rank.map((r) => ({
      rank: r.rank, id: r.id, name: r.name, score: r.score, radius: r.radius, isPlayer: r.id === this.me, isBot: r.bot, alive: true,
      color: hexOf(MP_COLORS[r.slot % MP_COLORS.length]),
    }));
    g.rows = rows;
    const mine = m.rank.find((r) => r.id === this.me) || { rank: rows.length, score: g.player.score, eaten: g.player.eaten, kills: 0, deaths: 0, radius: g.player.radius };
    const p = g.player;
    p.score = mine.score; p.targetRadius = radiusFromScore(p.score);
    g._res = { score: mine.score, eaten: mine.eaten, kills: mine.kills, deaths: mine.deaths, radius: mine.radius, level: g._level().level,
      biggest: p.biggest, rank: mine.rank, total: rows.length, table: rows, online: true };
    g._showResults();
    this._markResults(rows);
    g.hud.setGlobal(t(this.saved === true ? 'mpSaved' : this.saved === false ? 'mpNotSaved' : 'mpSaving'), true);
    g._hudSync();
    this._addMenuBtn();
    this.ui.net('ok', t('mpPing', { n: Math.round(this.client.rtt) }));
  }

  _markResults(rows) {
    const trs = document.querySelectorAll('#r-table tr');
    trs.forEach((tr, i) => { const r = rows[i]; if (!r) return; tr.classList.toggle('bot', !!r.isBot); tr.classList.toggle('human', !r.isBot); });
  }

  _showSaved() {
    if (this.state !== 'ended') return;
    this.game.hud.setGlobal(t(this.saved ? 'mpSaved' : 'mpNotSaved'), true);
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
      get optimistic() { return o.optimistic; },
      get log() { return o.log.slice(); },
      get lobby() { return o.lobby; },
      get round() { return o.round; },
      get saved() { return o.saved; },
      get final() { return o.finalRank; },
      get self() { const p = o.game.player; return { id: p.id, x: p.x, z: p.z, radius: p.radius, score: p.score, alive: p.alive, dying: !!p.dying, protectT: p.protectT, kills: p.kills, deaths: p.deaths, eaten: p.eaten }; },
      drive: (x, z) => { o.drive = x == null ? null : { x, z }; },
      get reconnecting() { return !!o.rec; },
      remotes: () => o.remotes.map((h) => ({ id: h.id, name: h.name, x: h.x, z: h.z, radius: h.radius, score: h.score, isBot: !!h.isBot, alive: h.alive, dying: !!h.dying })),
      send: (m) => o.client.send(m),
      drop: () => o.client.dropForTest(),
      serverNow: () => o.client.serverNow(),
      eatenIds: () => [...o.serverEaten],
      begin: () => o.begin(),
      leave: () => o.leave(),
      playAgain: () => o.playAgain(),
    };
  }
}
