// Game state machine: round timer, holes, swallow loop, HUD sync, dev hooks.
import * as THREE from 'three';
import { CFG, scoreFromRadius, radiusFromScore } from './config.js';
import { Hole, updateSwallow } from './holes.js';
import { HoleViews } from './holeView.js';
import { FollowCamera } from './camera.js';
import { Lighting } from './lighting.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { holeUniforms } from './holeView.js';
import { SpawnPicker } from './spawn.js';
import { Bots } from './bots.js';
import { Minimap } from './minimap.js';
import { bus } from './events.js';
import { t, kindName, fmt, onLang } from './i18n.js';
import { startRound, submitScore, retrySubmit, hasPending, lastFailure } from './scores.js';
import { placeText } from './hud.js';
import { isTouchUi, prefs } from './mobile.js';

export class Game {
  constructor({ renderer, scene, world, canvas, botCount = CFG.bots.count }) {
    this.renderer = renderer;
    this.scene = scene;
    this.world = world;
    this.canvas = canvas;
    this.cam = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.light = new Lighting(scene);
    this.holeViews = new HoleViews(scene);
    this.input = new Input(canvas);
    this.input.onZoom = (f) => { if (this.phase !== 'intro') this.cam.zoomBy(f); };
    this.input.onDoubleTap = () => { if (this.phase === 'playing') this.cam.toggleWide(); };
    document.getElementById('ts-retry')?.addEventListener('click', () => this.retrySave());
    this.resumeT = 0;               // seconds left of the "resuming" countdown after a pause (phones)
    this._ringT = 0;
    this.hud = new Hud();
    this.holes = [];
    this.roundSeconds = CFG.roundSeconds;
    this.phase = 'menu';
    this.timeLeft = this.roundSeconds;
    this.elapsed = 0;
    this.pop = { sum: 0, x: 0, z: 0, n: 0, t: 0, big: false };
    this._v = new THREE.Vector3();
    this.quiet = false;
    this._boardT = 0;
    this.rows = [];
    this.leader = null;
    this.killer = null;
    this.introEnabled = true;
    this.intro = null;
    this._goT = 0;
    this.paused = false;
    this.playT = 0;                 // seconds of the round actually played (not paused)
    this.unranked = null;           // reason string once a debug hook / URL override touched the round
    this.timeOverride = false;      // ?time= used: local round length, never submitted
    this.urlUnranked = null;        // ?sample / ?bots / ?time: whole session unranked
    this._roundToken = null;

    this.picker = new SpawnPicker(world);
    this.player = new Hole({ id: 0, name: CFG.playerName, color: CFG.holeColors[0], isPlayer: true });
    this.bots = new Bots(world, this.picker, Math.max(0, Math.min(botCount, CFG.hole.maxHoles - 1)));
    this.holes.push(this.player, ...this.bots.holes);
    this.minimap = new Minimap(document.getElementById('minimap'), world.data);
    this._placeAll();
    this.cam.snap(this.player);
    this._syncVisuals(0);
    this.hud.showHud(false);
    this.hud.showTags(false);
    const skip = () => { if (this.phase === 'intro' && this.intro && this.intro.t > 0.35) this.skipIntro(); };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
  }

  /** Bots spread over the map first, then the human gets a good street away from them. */
  _placeAll() {
    this.bots.placeAll({ x: 1e9, z: 1e9, radius: 0 });
    const [x, z] = this.picker.player(this.bots.holes);
    this.spawn = [x, z];
    this.player.reset(x, z);
  }

  start() {
    if (this.online) return this.online.onStart(); // multiplayer (src/net): Play again = rejoin the lobby
    this.world.reset();
    this.modeUnranked = null;
    bus.emit('modeSetup', this); // src/modes.js: round length, bot count, growth, daily seeds; may set this.modeUnranked
    this.player.name = this.hud.getName(CFG.playerName);
    this.killer = null;
    this._placeAll();
    this.hud.clearTransient();
    this.paused = false; this.hud.showPause(false);
    this.unranked = this.urlUnranked || this.modeUnranked || null;
    this._global = null;
    this.playT = 0;
    this._roundToken = null;
    this.phase = 'intro';
    this.timeLeft = this.roundSeconds;
    this.elapsed = 0;
    this.intro = { t: 0 };
    this.overviewDist = this._overviewDist();
    this.cam.focus.set(this.overviewFocus.x, 0, this.overviewFocus.z);
    this.cam.dist = this.overviewDist; this.cam.lead.set(0, 0, 0); this.cam.apply();
    this.hud.showStart(false);
    this.hud.showResults(false);
    this.hud.showHud(true);
    this.hud.showTags(true);
    this.input.enabled = true;
    this._rank();
    this._hudSync();
    this.hud.showMarkers(true);
    if (!this.introEnabled) this.skipIntro();
    else bus.emit('introStart');
  }

  /** Camera distance (and centre) at which the whole map bounds fit on screen, vertically re-centred. */
  _overviewDist() {
    const b = this.world.bounds, cam = this.cam;
    const v = new THREE.Vector3();
    const save = { d: cam.dist, f: cam.focus.clone() };
    const corners = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]];
    this.overviewFocus = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    let d = 1200;
    for (let i = 0; i < 60; i++) {
      cam.focus.set(this.overviewFocus.x, 0, this.overviewFocus.z);
      cam.dist = d; cam.lead.set(0, 0, 0); cam.apply();
      cam.camera.updateMatrixWorld(true);
      let mx = 0, y0 = 9, y1 = -9;
      for (const [x, z] of corners) {
        v.set(x, 0, z).project(cam.camera); mx = Math.max(mx, Math.abs(v.x)); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const mid = (y0 + y1) / 2;
      this.overviewFocus.z -= mid * d * 0.45;   // pull the map towards the vertical middle of the screen
      const fits = Math.max(mx, (y1 - y0) / 2 + 0.04) < 0.88;
      if (fits && Math.abs(mid) < 0.03) break;
      if (!fits && Math.abs(mid) < 0.05) d *= 1.04;
    }
    cam.dist = save.d; cam.focus.copy(save.f);
    return d;
  }

  /** End the round-start fly-in: hand over to the follow camera, start the round clock and the bots. */
  skipIntro() {
    if (this.online || this.phase !== 'intro') return; // online: the intro is paced by the server clock

    this.phase = 'playing';
    this.intro = null;
    this.cam.snap(this.player);
    this.hud.showMarkers(false);
    this.hud.go(t('go'));
    this.playT = 0;
    this._beginRound();
    bus.emit('roundGo');
  }

  /** Timer just started: ask the server for a round id (it validates round age at submit) and its round length. */
  _beginRound() {
    const token = this._roundToken = {};
    startRound().then((res) => {
      if (!res || token !== this._roundToken) return;
      const rs = +res.roundSeconds;
      // the server is the source of truth for round length (never overridden by ?time=, which makes the round unranked)
      if (!this.timeOverride && rs > 0 && Math.abs(rs - this.roundSeconds) > 0.01) {
        this.roundSeconds = rs;
        this.timeLeft = Math.max(0.001, rs - this.playT);
      }
    });
  }

  /** A debug / test hook touched this round: it will not be submitted. */
  markUnranked(why) { if (!this.unranked) this.unranked = why; }

  // ---- pause ----------------------------------------------------------------------------------------------
  pause(v = true, opts = {}) {
    if (this.online) return; // online rounds never pause (the server clock runs on)
    if (v && this.resumeT > 0) { this.resumeT = 0; this.hud.showResume(0); this.hud.showPause(true); this.input.releaseTouches(); return; } // paused again during the countdown
    if (v === this.paused) return;
    if (v && this.phase !== 'playing' && this.phase !== 'intro') return;
    if (!v && opts.countdown && this.phase === 'playing') {   // phones: a 3-2-1 before the world moves again (stays paused meanwhile)
      this.resumeT = 3; this.hud.showPause(false); this.hud.showResume(3); this.input.releaseTouches();
      return;
    }
    this.paused = v;
    this.hud.showPause(v);
    if (v) { this.input.keys.clear(); this.input.releaseTouches(); }
    bus.emit(v ? 'pause' : 'resume');
  }

  _introStep(dt) {
    const I = this.intro, IN = CFG.intro;
    I.t += dt;
    if (I.t >= IN.hold + IN.glide) return this.skipIntro();
  }

  _introCam() {
    const IN = CFG.intro, t = this.intro.t;
    const u = Math.min(1, Math.max(0, (t - IN.hold) / IN.glide));
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // easeInOutCubic
    const p = this.player;
    const cx = this.overviewFocus.x, cz = this.overviewFocus.z;
    const d1 = this.cam.targetDist(p.radius);
    this.cam.focus.set(cx + (p.x - cx) * e, 0, cz + (p.z - cz) * e);
    this.cam.dist = Math.exp(Math.log(this.overviewDist) * (1 - e) + Math.log(d1) * e);
    this.cam.lead.set(0, 0, 0);
    this.cam.apply();
    this.introFade = 1 - Math.min(1, e * 1.6);
  }

  end() {
    this.phase = 'ended';
    this.timeLeft = 0;
    this.input.enabled = false;
    this.player.control.mode = 'none';
    this.hud.showSwallowed(false);
    this.hud.showTags(false);
    this._rank();
    const p = this.player;
    const b = p.biggest;
    const biggest = b ? (b.name ? `${b.name}` : kindName(b.kind)) : '—';
    const me = this.rows.find((r) => r.isPlayer);
    this._res = { score: p.score, eaten: p.eaten, kills: p.kills, deaths: p.deaths, radius: p.radius, level: this._level().level,
      biggest: b, rank: me.rank, total: this.rows.length, table: this.rows };
    this._showResults();
    this._hudSync();
    this._submitResult(me, b);
  }

  _showResults() {
    const r = this._res;
    if (!r) return;
    this.hud.showResults(true, {
      score: r.score, eaten: r.eaten, kills: r.kills, deaths: r.deaths,
      biggest: r.biggest ? (r.biggest.name || kindName(r.biggest.kind)) : '—',
      size: t('finalSize', { d: (r.radius * 2).toFixed(1), lvl: r.level }),
      rank: r.rank, total: r.total, table: r.table,
    });
    this._showGlobal();
  }

  _showGlobal() {
    const g = this._global;
    if (!g) return;
    if (g.state === 'ok') this.hud.setGlobal(g.res.mode === 'daily' ? t('globalRankDaily', { n: g.res.rankToday }) : t('globalRank', { all: g.res.rankAllTime, day: g.res.rankToday }));
    else if (g.state === 'wait') this.hud.setGlobal(t('saving'), true);
    else if (g.state === 'unranked') this.hud.setGlobal(t(this.unranked === 'practice' ? 'practiceNote' : this.unranked === 'free' ? 'freeNote' : 'unranked'), true);
    else { this.hud.setGlobal(t('notSaved'), true); this.hud.setRetry(hasPending() && this.phase === 'ended' ? (lastFailure === 'verify' ? t('tsFail') : t('saveFail')) : null); }
    if (g.state !== 'offline') this.hud.setRetry(null);
  }

  /** Submit the player's result once per round; never throws. */
  async _submitResult(me, biggest) {
    if (this.unranked) { this._global = { state: 'unranked' }; this._showGlobal(); return; }
    this._global = { state: 'wait' };
    this._showGlobal();
    this._roundToken = null; // a round is submitted at most once
    const p = this.player;
    const res = await submitScore({
      name: p.name, score: p.score, eaten: p.eaten, radius: Math.round(p.radius * 100) / 100, rank: me.rank,
      biggest: biggest ? (biggest.name || kindName(biggest.kind, 'en')) : undefined,
    });
    this._submitDone(res);
  }

  _submitDone(res) {
    if (this.phase !== 'ended' || !this._global || this._global.state !== 'wait') return; // next round already began
    this._global = res ? { state: 'ok', res } : { state: 'offline' };
    this._showGlobal();
  }

  /** Results panel "retry" (Turnstile widget failure / network): same result, same round, never lost while the panel is open. */
  async retrySave() {
    if (this.phase !== 'ended' || !hasPending()) return;
    this._global = { state: 'wait' };
    this._showGlobal();
    this._submitDone(await retrySubmit());
  }

  /** Sorted ranking of every hole (alive or not). */
  _rank() {
    const hs = this.holes.slice().sort((a, b) => b.score - a.score || a.id - b.id);
    this.rows = hs.map((h, i) => ({
      rank: i + 1, id: h.id, name: h.name, score: h.score, radius: h.radius, isPlayer: h.isPlayer,
      isBot: h.isBot !== undefined ? !!h.isBot : !h.isPlayer, alive: h.alive, color: '#' + h.color.getHexString(),
    }));
    this.leader = hs[0] && hs[0].score > 0 ? hs[0] : null;
    return this.rows;
  }

  _level() {
    const L = CFG.levels;
    const r = this.player.targetRadius;
    let i = 0;
    while (i < L.length - 1 && r >= L[i + 1]) i++;
    if (i >= L.length - 1) return { level: L.length, progress: 1 };
    const s0 = scoreFromRadius(L[i]), s1 = scoreFromRadius(L[i + 1]);
    return { level: i + 1, progress: Math.min(1, Math.max(0, (this.player.score - s0) / (s1 - s0))) };
  }

  _hudSync() {
    const { level, progress } = this._level();
    this.hud.update({
      score: this.player.score, timeLeft: this.timeLeft, eaten: this.player.eaten,
      level, diameter: this.player.radius * 2, progress,
    });
  }

  _onSwallow(hole, o) {
    if (!hole.isPlayer) return;
    const p = this.pop;
    if (p.n === 0) { p.x = o.x; p.z = o.z; p.t = 0; }
    p.sum += o.value; p.n++;
    if (o.value >= 40) p.big = true;
    if (o.name) this.hud.label(o.name, o.landmark);
    this._ring(hole, o);
  }

  /** Soft ring on the hole's rim when the player swallows something (the visual stand-in for haptics on iOS). Cheap: one reused element. */
  _ring(hole, o) {
    if (!prefs.haptics || !document.body.classList.contains('touch')) return;
    const now = performance.now();
    if (now - this._ringT < (o.isBuilding ? 100 : 170)) return;
    this._ringT = now;
    const a = this._v.set(hole.x, 0, hole.z).project(this.cam.camera);
    const b = new THREE.Vector3(hole.x + hole.radius, 0, hole.z).project(this.cam.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const px = (a.x * 0.5 + 0.5) * w, py = (-a.y * 0.5 + 0.5) * h, pr = Math.abs((b.x - a.x) * 0.5 * w);
    this.hud.ring(px, py, pr * 2.1, o.isBuilding);
  }

  _flushPopup(dt) {
    const p = this.pop;
    if (p.n === 0) return;
    p.t += dt;
    if (p.t < 0.12) return;
    this._v.set(p.x, 2, p.z).project(this.cam.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.hud.popup((this._v.x * 0.5 + 0.5) * w, (-this._v.y * 0.5 + 0.5) * h, `+${p.sum}`, p.big || p.sum >= 40);
    p.sum = 0; p.n = 0; p.big = false;
  }

  /** Advance simulation by dt seconds (no rendering). */
  update(dt, quiet = this.quiet) {
    if (this.online) return this.online.update(dt, quiet); // multiplayer: src/net/online.js
    if (this.resumeT > 0) {
      this.resumeT -= Math.min(dt, 0.1);
      if (this.resumeT <= 0) { this.resumeT = 0; this.hud.showResume(0); this.paused = false; this.hud.showPause(false); bus.emit('resume'); }
      else this.hud.showResume(Math.ceil(this.resumeT));
      return;
    }
    if (this.paused) return;
    dt = Math.min(dt, 0.1);
    if (this.phase === 'intro') dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    if (this.phase === 'intro') this._introStep(dt);
    const playing = this.phase === 'playing';
    if (playing) {
      this.timeLeft -= dt; this.playT += dt;
      if (!this.autopilot) this.player.control = this.player.alive && !this.player.dying ? this.input.getControl(this.cam.camera) : { mode: 'none', x: 0, z: 0 };
      this.bots.update(this.elapsed, this.holes);
    }
    for (const h of this.holes) {
      if (h.dying) { this._advanceDying(h, dt); continue; }
      if (!h.alive) {
        if (playing) { h.respawnT -= dt; if (h.respawnT <= 0) this._respawn(h); }
        continue;
      }
      h.update(dt, this.world.bounds);
      if (h.protectT > 0) h.protectT = Math.max(0, h.protectT - dt);
      if (playing) updateSwallow(this.world, h, (hh, o) => this._onSwallow(hh, o));
    }
    if (playing) this._duels();
    this.world.update(dt, this.elapsed);
    this._syncVisuals(dt);
    if (!quiet) { this._flushPopup(dt); this._overlay(dt); this._hudSync(); }
    if (playing && this.timeLeft <= 0) this.end();
  }

  // ---- hole vs hole -------------------------------------------------------------------------------------
  _duels() {
    const D = CFG.duel, hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      if (!a.alive || a.dying || a.protectT > 0) continue;
      for (let j = 0; j < hs.length; j++) {
        const b = hs[j];
        if (i === j || !b.alive || b.dying || b.protectT > 0) continue;
        if (a.radius < b.radius * D.ratio) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.radius * D.reach) this._eatHole(a, b);
      }
    }
  }

  _eatHole(eater, victim) {
    const D = CFG.duel;
    const gain = victim.score * D.gain;
    victim.dying = { by: eater, t: 0, r0: victim.radius, rx: victim.x - eater.x, rz: victim.z - eater.z, spin: (Math.random() < 0.5 ? -1 : 1) * 2.4 };
    victim.vx = victim.vz = 0;
    victim.deaths++; eater.kills++;
    eater.addScore(gain);
    bus.emit('holeEaten', { eater, victim, gain });
    if (victim.isPlayer) bus.emit('playerEaten', { eater, victim });
    const span = (txt, c) => { const e = document.createElement('span'); e.textContent = txt; if (c) e.style.color = c; return e; };
    this.hud.feedItem([span(eater.name, '#' + eater.color.getHexString()), span(` ${t('feedVerb')} `), span(victim.name, '#' + victim.color.getHexString()), span(` +${Math.round(gain)}`)],
      '#' + eater.color.getHexString());
    if (victim.isPlayer) {
      this.killer = eater;
      this.hud.showSwallowed(true, eater.name, '#' + eater.color.getHexString(), D.dyingTime + D.respawnDelay);
    }
    if (eater.isPlayer) {
      this._v.set(victim.x, 2, victim.z).project(this.cam.camera);
      this.hud.popup((this._v.x * 0.5 + 0.5) * this.canvas.clientWidth, (-this._v.y * 0.5 + 0.5) * this.canvas.clientHeight, `+${Math.round(gain)}`, true);
    }
  }

  _advanceDying(h, dt) {
    const d = h.dying, D = CFG.duel;
    d.t += dt / D.dyingTime;
    const t = Math.min(1, d.t);
    const e = t * t * (3 - 2 * t);
    const a = d.spin * t, c = Math.cos(a), s = Math.sin(a);
    const k = 1 - e;
    h.x = d.by.x + (d.rx * c - d.rz * s) * k;
    h.z = d.by.z + (d.rx * s + d.rz * c) * k;
    h.radius = Math.max(0.05, d.r0 * (1 - t * 0.9));
    if (t >= 1) {
      h.dying = null; h.alive = false; h.respawnT = D.respawnDelay;
    }
  }

  _respawn(h) {
    const D = CFG.duel;
    const others = this.holes.filter((o) => o !== h && o.alive);
    // the human's keepScore / protect come from the difficulty (easy: 65 % + 4.5 s); bots always play by the classic numbers
    const keep = h.isPlayer ? D.keepScore : D.botKeepScore, protect = h.isPlayer ? D.protect : D.botProtect;
    const [x, z] = this.picker.spread(others, { samples: 90, minDist: D.minRespawnDist, radius: radiusFromScore(h.score * keep) });
    h.respawn(x, z, keep, protect);
    h.respawnedAt = this.elapsed;
    bus.emit('respawn', h);
    h.control.mode = 'none';
    if (h.isPlayer) { this.killer = null; this.hud.showSwallowed(false); this.cam.snap(h); }
    else this.bots.onRespawn(h, this.elapsed);
  }

  /** Per-frame overlay work: swallowed countdown, name tags, leaderboard (4 Hz), minimap. */
  _overlay(dt) {
    const p = this.player;
    if (this.phase === 'playing' && !p.dying && !p.alive) this.hud.showSwallowed(true, undefined, undefined, p.respawnT);
    this._boardT -= dt;
    if (this._boardT <= 0) {
      this._boardT = 0.25;
      this._rank();
      this.hud.updateBoard(this.rows, 5);
    }
    if (this.phase !== 'playing' && this.phase !== 'intro') return;
    const cam = this.cam.camera, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const items = this._tagItems || (this._tagItems = []);
    items.length = 0;
    for (const o of this.holes) {
      this._v.set(o.x, 0, o.z - o.radius * 0.95).project(cam);
      const vis = o.alive && this._v.z < 1 && Math.abs(this._v.x) < 1.08 && this._v.y > -1.05 && this._v.y < 1.1;
      items.push({ id: o.id, name: o.name, color: '#' + o.color.getHexString(), x: (this._v.x * 0.5 + 0.5) * w, y: (-this._v.y * 0.5 + 0.5) * h - 4,
        visible: vis, leader: o === this.leader, me: o.isPlayer });
    }
    this.hud.updateTags(items);
    if (this.phase === 'intro') this.hud.updateMarkers(items, this.holes, this.introFade ?? 1, this.elapsed);
    this.minimap.draw(this.holes, this.player, cam, this.leader, this.elapsed);
  }

  /** Hole the camera follows: the player, or whoever swallowed the player while waiting to respawn. */
  get camHole() {
    const p = this.player;
    if (p.alive && !p.dying) return p;
    return (p.dying && p.dying.by) || this.killer || p;
  }

  _syncVisuals(dt) {
    const ch = this.camHole;
    if (this.phase === 'intro' && this.intro) this._introCam();
    else {
      this.cam.update(dt || 0.0001, ch);
      if (!dt) this.cam.snap(ch);
    }
    this.world.ground.userData.detail.update(this.cam.focus.x, this.cam.focus.z, this.cam.dist);
    this.light.update(this.cam.focus, this.cam.dist);
    this.holeViews.update(this.holes);
    holeUniforms.uDetail.value = THREE.MathUtils.clamp(1.4 - this.cam.dist / 120, 0, 1);
  }

  render() { this.renderer.render(this.scene, this.cam.camera); }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.cam.resize(w / h, isTouchUi());
    if (w !== this._w || h !== this._h) { this._w = w; this._h = h; this.input.releaseTouches(); }   // orientation flip / real resize: no steering on stale coordinates (a no-change resize event must not drop a finger)
  }

  // ---- dev / test hooks -------------------------------------------------
  step(seconds) {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) this.update(1 / 60, i < n - 1);
    this._flushPopup(0.2); this._overlay(0.3); this._hudSync();
  }

  teleport(x, z) {
    const p = this.player;
    p.x = x; p.z = z; p.vx = p.vz = 0;
    this.cam.snap(p);
  }

  setRadius(r) { this.player.setRadius(r); this.cam.snap(this.player); }

  /** Test helpers for any hole index. */
  teleportHole(i, x, z) {
    const h = this.holes[i]; h.x = x; h.z = z; h.vx = h.vz = 0;
    if (h === this.player) this.cam.snap(h);
  }
  setHoleRadius(i, r) { const h = this.holes[i]; h.setRadius(r); h.protectT = 0; if (h === this.player) this.cam.snap(h); }
  holeList() {
    return this.holes.map((h, i) => ({
      index: i, name: h.name, x: h.x, z: h.z, radius: h.radius, score: h.score, isBot: !h.isPlayer, alive: h.alive,
      dying: !!h.dying, protectT: h.protectT, kills: h.kills, deaths: h.deaths, eaten: h.eaten,
      mode: this.bots.brains.find((b) => b.hole === h)?.mode || null,
    }));
  }

  /** Greedy bot for balance testing: eat the best nearby thing. Not an opponent. */
  autoplay(seconds, { tick = 0.2 } = {}) {
    const p = this.player;
    let t = 0;
    const jitter = (i) => Math.sin(i * 12.9898) * 0.5;
    let iter = 0;
    this.skipIntro();
    this.autopilot = true;
    while (t < seconds && this.phase === 'playing') {
      let best = null, bs = -1;
      const R = Math.max(25, p.radius * 9);
      this.world.query(p.x, p.z, R, (o, d) => {
        if (o.state !== 0 || o.fit >= p.radius * CFG.swallow.fitRatio) return;
        const s = o.value / (d + p.radius * 1.5 + 4);
        if (s > bs) { bs = s; best = o; }
      });
      let threat = null;
      for (const o of this.holes) if (o !== p && o.alive && !o.dying && o.radius >= p.radius * CFG.duel.ratio * 0.92 && Math.hypot(o.x - p.x, o.z - p.z) < o.radius * 3.2 + 14) threat = o;
      if (threat) { const ax = p.x - threat.x, az = p.z - threat.z, l = Math.hypot(ax, az) || 1; p.control = { mode: 'target', x: p.x + (ax / l) * 60, z: p.z + (az / l) * 60 }; }
      else if (best) p.control = { mode: 'target', x: best.x, z: best.z };
      else p.control = { mode: 'target', x: p.x + jitter(iter) * 200, z: p.z + jitter(iter + 7) * 200 };
      iter++;
      const n = Math.round(tick * 60);
      for (let i = 0; i < n && this.phase === 'playing'; i++) { this.update(1 / 60, true); t += 1 / 60; }
    }
    this.autopilot = false;
    this._syncVisuals(0.016);
    this._flushPopup(0.2); this._overlay(0.3); this._hudSync();
  }

  nearest(kind, minFit = 0) {
    const p = this.player;
    let best = null, bd = Infinity;
    for (const o of this.world.objects) {
      if (o.state !== 0 || (kind && o.kind !== kind && o.cls !== kind) || o.fit < minFit) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best ? { x: best.x, z: best.z, fit: best.fit, value: best.value, kind: best.kind, name: best.name } : null;
  }

  api() {
    const g = this;
    return {
      get state() { return { phase: g.phase, score: g.player.score, timeLeft: g.timeLeft, eaten: g.player.eaten }; },
      get hole() { return { x: g.player.x, z: g.player.z, radius: g.player.radius, targetRadius: g.player.targetRadius }; },
      get counts() { return { ...g.world.counts, falling: g.world.falling.size }; },
      get spawn() { return g.spawn; },
      get isSample() { return !!g.world.data.meta.sample; },
      start: () => g.start(),
      skipIntro: () => g.skipIntro(),
      get intro() { return g.intro ? { t: g.intro.t, dist: g.cam.dist, overviewDist: g.overviewDist } : null; },
      teleport: (x, z) => { g.markUnranked('teleport'); return g.teleport(x, z); },
      setRadius: (r) => { g.markUnranked('setRadius'); return g.setRadius(r); },
      step: (s) => { g.markUnranked('step'); return g.step(s); },
      render: () => g.render(),
      autoplay: (s, o) => { g.markUnranked('autoplay'); return g.autoplay(s, o); },
      nearest: (k, m) => g.nearest(k, m),
      setTarget: (x, z) => { g.markUnranked('setTarget'); g.player.control = { mode: 'target', x, z }; },
      get holes() { return g.holeList(); },
      leaderboard: () => g._rank().map((r) => ({ rank: r.rank, name: r.name, score: r.score, isPlayer: r.isPlayer, alive: r.alive })),
      teleportHole: (i, x, z) => { g.markUnranked('teleportHole'); return g.teleportHole(i, x, z); },
      setHoleRadius: (i, r) => { g.markUnranked('setHoleRadius'); return g.setHoleRadius(i, r); },
      get unranked() { return g.unranked; },
      get paused() { return g.paused; },
      pause: (v) => g.pause(v),
      get cam() { return { focus: { x: g.cam.focus.x, z: g.cam.focus.z }, dist: g.cam.dist, zoom: g.cam.zoom }; },
      zoomBy: (f) => g.cam.zoomBy(f),
      get botCount() { return g.bots.holes.length; },
      get overlay() { return { swallowedVisible: !document.getElementById('swallowed').classList.contains('hidden'), by: document.getElementById('sw-by').textContent, t: document.getElementById('sw-t').textContent }; },
    };
  }
}
