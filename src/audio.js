// Fully procedural WebAudio: swallow sounds scaled by size, level-up chime, countdown ticks, round-end sting, UI click,
// generative ambient city bed (noise wash, soft pad, distant church bells) and a hole hum that deepens with size.
// No asset files. Unlocks on the first user gesture. Rate / voice limited, master compressor, mute button + M key.
import { LIFE } from './config.js';
import { bus } from './events.js';
import { t, onLang } from './i18n.js';

const A = LIFE.audio;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('bedre.muted') === '1'; } catch { /* private mode */ }
    this.stats = { triggered: 0, played: 0, dropped: 0, errors: 0 };
    this.voices = [];
    this.budget = { pop: 12, big: 4, t: 0 };
    this.player = null;       // () => Hole  (for distance attenuation of other holes)
    this.humOn = false;
    this._bellT = null;
    this.onMute = [];
    this._setupGesture();
  }

  // ---- lifecycle ----------------------------------------------------------------------------------
  _setupGesture() {
    const go = () => {
      try { this.unlock(); } catch (e) { this.stats.errors++; console.warn('[audio]', e); }
      if (this.ctx && this.ctx.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) window.removeEventListener(ev, go, true);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, go, true);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : A.master;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 14; this.comp.ratio.value = 5;
      this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
      this.master.connect(this.comp); this.comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
      this.amb = ctx.createGain(); this.amb.gain.value = A.ambient; this.amb.connect(this.master);
      // noise buffers
      const n = ctx.sampleRate * 2;
      this.white = ctx.createBuffer(1, n, ctx.sampleRate);
      this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
      const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
      this._startAmbient();
      this._startHum();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem('bedre.muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : A.master, this.ctx.currentTime, 0.04);
    for (const f of this.onMute) f(this.muted);
  }
  toggleMute() { this.setMuted(!this.muted); }

  // ---- helpers --------------------------------------------------------------------------------------
  _claim(dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.voices = this.voices.filter((e) => e > t);
    if (this.voices.length >= A.maxVoices) return false;
    this.voices.push(t + dur);
    return true;
  }
  _tick(dt) {
    const b = this.budget;
    b.pop = Math.min(12, b.pop + dt * 22);
    b.big = Math.min(4, b.big + dt * 5);
  }
  _osc(type, f0, f1, t, dur, peak, dest, attack = 0.004) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(t, dur, type, f0, f1, q, peak, brown = false, attack = 0.005) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = brown ? this.brown : this.white;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  _guard(fn) {
    this.stats.triggered++;
    if (!this.running) return false;
    try { fn(); this.stats.played++; return true; } catch (e) { this.stats.errors++; console.warn('[audio]', e); return false; }
  }

  // ---- sounds ---------------------------------------------------------------------------------------
  /** small swallow: people / props. size = fit radius in metres */
  pop(size = 0.4, vol = 1, pitch = 1) {
    this.stats.triggered++;
    if (!this.running) return;
    if (this.budget.pop < 1 || !this._claim(0.3)) { this.stats.dropped++; return; }
    this.budget.pop--;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      const f0 = clamp(820 * Math.pow(0.4 / Math.max(0.3, size), 0.5) * rnd(0.93, 1.08) * pitch, 130, 2400);
      const v = 0.2 * vol * clamp(0.6 + size * 0.2, 0.6, 1.3);
      this._osc('sine', f0, f0 * 0.42, t, 0.13 + Math.min(0.12, size * 0.02), v);
      this._osc('triangle', f0 * 2, f0 * 0.9, t, 0.06, v * 0.35);
      if (size > 1) this._noise(t, 0.12, 'lowpass', 900, 200, 0.7, v * 0.5, true);
    });
  }

  /** building: whomp + rumble + debris clatter. fit radius, height */
  whomp(fit = 8, h = 12, vol = 1, pitch = 1) {
    this.stats.triggered++;
    if (!this.running) return;
    if (this.budget.big < 1 || !this._claim(1.2)) { this.stats.dropped++; return; }
    this.budget.big--;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      const k = clamp(fit / 18, 0.25, 1.6);
      const v = 0.42 * vol * clamp(0.5 + k * 0.5, 0.5, 1.2);
      const f = 95 / Math.pow(k, 0.35) * Math.sqrt(pitch);
      this._osc('sine', f * rnd(0.95, 1.05), f * 0.38, t, 0.55 + k * 0.3, v);
      this._osc('triangle', f * 1.9, f * 0.7, t, 0.3, v * 0.35);
      this._noise(t, 0.7 + k * 0.5, 'lowpass', 1100, 140, 0.8, v * 0.9, true, 0.02);
      const n = 3 + Math.round(k * 3);
      for (let i = 0; i < n; i++) {
        const tt = t + 0.08 + Math.random() * (0.35 + k * 0.2);
        this._noise(tt, 0.05 + Math.random() * 0.05, 'bandpass', rnd(1400, 4200), rnd(800, 2000), 3, v * rnd(0.12, 0.3));
      }
    });
  }

  chime(level = 1) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      const base = 523.25 * Math.pow(2, (level % 6) / 12);
      [0, 4, 7, 12].forEach((st, i) => {
        const f = base * Math.pow(2, st / 12), tt = t + i * 0.085;
        this._osc('triangle', f, f, tt, 0.55, 0.16, null, 0.008);
        this._osc('sine', f * 2, f * 2, tt, 0.4, 0.05, null, 0.008);
      });
    });
  }

  tick(secondsLeft = 5) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      const urgent = secondsLeft <= 3;
      const f = secondsLeft === 0 ? 660 : urgent ? 1320 : 990;
      this._osc('square', f, f, t, secondsLeft === 0 ? 0.45 : 0.07, urgent ? 0.07 : 0.045, null, 0.002);
      this._osc('sine', f / 2, f / 2, t, 0.1, 0.12, null, 0.002);
    });
  }

  sting(score = 0) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      const notes = [392, 329.63, 261.63, 196];
      notes.forEach((f, i) => {
        this._osc('triangle', f, f * 0.995, t + i * 0.16, 0.6, 0.17, null, 0.01);
        this._osc('sine', f / 2, f / 2, t + i * 0.16, 0.7, 0.1, null, 0.01);
      });
      [130.8, 164.8, 196].forEach((f) => this._osc('triangle', f, f, t + 0.66, 1.6, 0.1, null, 0.04));
    });
  }

  click() {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      this._osc('triangle', 1700, 650, t, 0.05, 0.13, null, 0.001);
      this._noise(t, 0.02, 'highpass', 4000, 4000, 0.7, 0.04);
    });
  }

  /** player ate another hole */
  holeEaten(size = 1) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      this._osc('sawtooth', 160, 640, t, 0.28, 0.07, null, 0.01);
      this._osc('sine', 300, 120, t + 0.12, 0.3, 0.25, null, 0.004);
      this._noise(t + 0.12, 0.4, 'lowpass', 900, 150, 0.7, 0.3, true);
      this.chime(2);
    });
  }
  /** the player got eaten */
  playerEaten() {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      this._osc('sine', 520, 70, t, 0.9, 0.3, null, 0.005);
      this._osc('sawtooth', 220, 55, t, 0.7, 0.07, null, 0.01);
      this._noise(t, 0.8, 'lowpass', 1200, 90, 0.8, 0.4, true);
    });
  }
  respawn() {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      [0, 7, 12, 16].forEach((st, i) => this._osc('triangle', 392 * Math.pow(2, st / 12), 392 * Math.pow(2, st / 12), t + i * 0.06, 0.3, 0.11, null, 0.005));
    });
  }

  /** 18 November fireworks: rising whistle (rocket) */
  fwLaunch(vol = 1, delay = 0) {
    this.stats.triggered++;
    if (!this.running || this.muted) return;
    if (this.budget.big < 1 || !this._claim(1.2)) { this.stats.dropped++; return; }
    this._guard_play(() => {
      const t = this.ctx.currentTime + delay;
      this._osc('sine', 700, 2400, t, 0.8, 0.035 * vol, null, 0.05);
      this._noise(t, 0.7, 'bandpass', 1500, 3200, 2.5, 0.03 * vol, false, 0.08);
    });
  }

  /** fireworks: boom + crackle, volume by distance (0..1); voice limited like the other big sounds */
  fwBoom(vol = 1, big = 30) {
    this.stats.triggered++;
    if (!this.running || this.muted) return;
    if (this.budget.big < 1 || !this._claim(1.6)) { this.stats.dropped++; return; }
    this.budget.big--;
    this._guard_play(() => {
      const t = this.ctx.currentTime + 0.05 + (1 - vol) * 0.25; // farther = a touch later
      const k = clamp(big / 60, 0.4, 1.4), v = 0.3 * vol;
      this._osc('sine', 120 / Math.sqrt(k), 38, t, 0.7, v, null, 0.006);
      this._noise(t, 0.55, 'lowpass', 1400, 120, 0.7, v * 0.9, true, 0.004);
      const n = 6 + Math.round(k * 6);
      for (let i = 0; i < n; i++) {
        const tt = t + 0.12 + Math.random() * 0.9;
        this._noise(tt, 0.03 + Math.random() * 0.04, 'highpass', rnd(2500, 6000), rnd(2500, 6000), 1, v * rnd(0.1, 0.32));
      }
    });
  }

  _guard_play(fn) {
    try { fn(); this.stats.played++; } catch (e) { this.stats.errors++; console.warn('[audio]', e); }
  }

  /** dispatch a swallow of `o` by `hole` */
  onSwallow(o, hole) {
    let vol = 1;
    if (!hole.isPlayer) {
      const p = this.player && this.player();
      if (!p) return;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      vol = clamp(1 - d / (40 + p.radius * 14), 0, 1) * 0.5;
      if (vol < 0.05) return;
    }
    // COMBOS: the sounds climb with the combo counter (up to an octave at 70)
    const pitch = hole.isPlayer && hole.combo ? Math.pow(2, Math.min(12, hole.combo.count * 0.17) / 12) : 1;
    if (o.isBuilding) this.whomp(o.fit, o.h, vol, pitch);
    else if (o.cls === 'monument') { this.whomp(o.fit * 2.2, o.h, vol, pitch); this.chime(3); }
    else this.pop(o.fit, vol * (o.cls === 'person' ? 0.9 : 1), pitch);
  }

  /** The combo multiplier stepped up: a short bright two-note pop, higher for higher steps. */
  comboStep(mult = 1.2) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime, base = 659.25 * Math.pow(2, clamp((mult - 1.2) / 1.8, 0, 1) * 7 / 12);
      this._osc('triangle', base, base, t, 0.22, 0.14, null, 0.004);
      this._osc('triangle', base * 1.5, base * 1.5, t + 0.07, 0.3, 0.13, null, 0.004);
      this._osc('sine', base * 3, base * 3, t + 0.07, 0.18, 0.04, null, 0.004);
    });
  }

  /** The combo ran out: a soft falling blip. */
  comboLost() {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      this._osc('sine', 420, 190, t, 0.22, 0.09, null, 0.005);
    });
  }

  /** Power-up collected: one sound per type. */
  powerup(type) {
    this.stats.triggered++;
    if (!this.running) return;
    this._guard_play(() => {
      const t = this.ctx.currentTime;
      if (type === 'magnet') {           // rising "whoop" with a tail
        this._osc('sine', 260, 980, t, 0.32, 0.2, null, 0.01);
        this._osc('triangle', 130, 490, t, 0.32, 0.12, null, 0.01);
        this._osc('sine', 1400, 700, t + 0.28, 0.25, 0.08, null, 0.01);
      } else if (type === 'speed') {     // quick ascending ticks + a whoosh
        [0, 4, 7, 12].forEach((st, i) => this._osc('square', 440 * Math.pow(2, st / 12), 440 * Math.pow(2, st / 12), t + i * 0.045, 0.06, 0.05, null, 0.002));
        this._noise(t, 0.4, 'bandpass', 600, 3800, 1.4, 0.16, false, 0.03);
      } else if (type === 'double') {    // two bright bells
        [880, 1318.5].forEach((f, i) => { this._osc('sine', f, f, t + i * 0.11, 0.7, 0.16, null, 0.004); this._osc('sine', f * 2.76, f * 2.76, t + i * 0.11, 0.35, 0.04, null, 0.004); });
      } else {                           // shield: a soft shimmering chord
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { this._osc('triangle', f, f * 1.004, t + i * 0.05, 0.9, 0.1, null, 0.02); });
        this._noise(t, 0.5, 'highpass', 5000, 7000, 0.7, 0.03, false, 0.1);
      }
    });
  }

  // ---- ambient bed + hum ------------------------------------------------------------------------------
  _loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s; }

  _startAmbient() {
    const ctx = this.ctx, t = ctx.currentTime;
    // distant city wash: brown noise through a slowly breathing lowpass
    const wash = this._loop(this.brown), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.5; g.gain.value = 0.9;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 160; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(t);
    wash.connect(lp); lp.connect(g); g.connect(this.amb); wash.start(t);
    // airy hiss (traffic / wind)
    const air = this._loop(this.white), bp = ctx.createBiquadFilter(), ag = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.6; ag.gain.value = 0.035;
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain();
    lfo2.frequency.value = 0.11; lg2.gain.value = 0.02; lfo2.connect(lg2); lg2.connect(ag.gain); lfo2.start(t);
    air.connect(bp); bp.connect(ag); ag.connect(this.amb); air.start(t);
    // soft two-note pad
    for (const [f, d] of [[110, -4], [164.81, 5], [220, 0]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.detune.value = d; og.gain.value = 0.028;
      const tl = ctx.createOscillator(), tg = ctx.createGain();
      tl.frequency.value = 0.05 + Math.random() * 0.06; tg.gain.value = 0.014; tl.connect(tg); tg.connect(og.gain); tl.start(t);
      o.connect(og); og.connect(this.amb); o.start(t);
    }
    this._scheduleBell();
  }

  _scheduleBell() {
    clearTimeout(this._bellT);
    this._bellT = setTimeout(() => {
      if (this.running && !this.muted) {
        try {
          const t = this.ctx.currentTime, base = [392, 329.63, 293.66, 440][Math.floor(Math.random() * 4)];
          const hits = Math.random() < 0.5 ? 1 : 3;
          for (let h = 0; h < hits; h++) {
            [1, 2.01, 2.76, 5.4].forEach((p, i) => {
              const f = base * p, tt = t + h * 1.1, g = this.ctx.createGain(), o = this.ctx.createOscillator();
              o.type = 'sine'; o.frequency.value = f;
              g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.05 / (1 + i * 1.3), tt + 0.01);
              g.gain.exponentialRampToValueAtTime(0.0001, tt + 3.4 / (1 + i * 0.5));
              o.connect(g); g.connect(this.amb); o.start(tt); o.stop(tt + 3.6);
            });
          }
        } catch { /* ignore */ }
      }
      this._scheduleBell();
    }, rnd(7000, 16000));
  }

  _startHum() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.hum = { g: ctx.createGain(), f: ctx.createBiquadFilter(), a: ctx.createOscillator(), b: ctx.createOscillator() };
    this.hum.g.gain.value = 0;
    this.hum.f.type = 'lowpass'; this.hum.f.frequency.value = 260; this.hum.f.Q.value = 2;
    this.hum.a.type = 'sine'; this.hum.b.type = 'sawtooth';
    this.hum.a.frequency.value = 120; this.hum.b.frequency.value = 60.3;
    const bg = ctx.createGain(); bg.gain.value = 0.35;
    this.hum.a.connect(this.hum.f); this.hum.b.connect(bg); bg.connect(this.hum.f);
    this.hum.f.connect(this.hum.g); this.hum.g.connect(this.master);
    this.hum.a.start(t); this.hum.b.start(t);
  }

  /** call each frame-ish: deepen the hum with size, fade it in while playing */
  setHole(radius, speed01, playing) {
    if (!this.ctx || !this.hum) return;
    const t = this.ctx.currentTime;
    const f = clamp(150 * Math.pow(2.2 / Math.max(2.2, radius), 0.38), 40, 150);
    this.hum.a.frequency.setTargetAtTime(f, t, 0.15);
    this.hum.b.frequency.setTargetAtTime(f * 0.5025, t, 0.15);
    this.hum.f.frequency.setTargetAtTime(160 + f * 1.1 + speed01 * 120, t, 0.2);
    this.hum.g.gain.setTargetAtTime(playing ? A.hum * (0.05 + 0.03 * clamp(Math.log2(radius / 2.2) / 5, 0, 1) + 0.02 * speed01) : 0, t, 0.3);
  }
}

export function mountMuteButton(audio) {
  const b = document.createElement('button');
  b.id = 'mute-btn'; b.type = 'button';
  const lab = () => { b.title = t('soundBtn'); b.setAttribute('aria-label', t('soundAria')); };
  lab(); onLang(lab);
  const sync = (m) => { b.textContent = m ? '🔇' : '🔊'; b.setAttribute('aria-pressed', String(m)); };
  sync(audio.muted);
  audio.onMute.push(sync);
  b.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); audio.toggleMute(); b.blur(); });
  (document.getElementById('hud-btns') || document.body).appendChild(b);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) audio.toggleMute();
  });
  return b;
}

/** Wire the engine to the shared event bus (swallow, levelUp, holeEaten, playerEaten, respawn, round events, UI clicks). */
export function wireAudioEvents(audio) {
  bus.on('swallow', (o, hole) => audio.onSwallow(o, hole));
  bus.on('levelUp', ({ level }) => audio.chime(level));
  bus.on('combo', (e) => { if (e && e.step && e.hole && e.hole.isPlayer) audio.comboStep(e.mult); });
  bus.on('comboLost', (e) => { if (e && e.count >= 5) audio.comboLost(); });
  bus.on('powerup', (e) => { if (e && e.hole && e.hole.isPlayer) audio.powerup(e.type); });
  bus.on('holeEaten', (ev) => audio.holeEaten(ev && ev.size));
  bus.on('playerEaten', () => audio.playerEaten());
  bus.on('respawn', () => audio.respawn());
  bus.on('countdown', (n) => audio.tick(n));
  bus.on('roundEnd', () => audio.sting());
  bus.on('fireworkLaunch', (e) => audio.fwLaunch(e && e.vol, e && e.delay));
  bus.on('fireworkBoom', (e) => audio.fwBoom(e && e.vol, e && e.big));
  bus.on('pause', () => { if (audio.ctx && audio.ctx.state === 'running') audio.ctx.suspend().catch(() => {}); });
  bus.on('resume', () => { if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {}); });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('button') && !t.closest('#mute-btn')) audio.click();
  }, true);
}
