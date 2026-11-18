// Procedural sound for the tram (no recordings, no speech): motor hum + whine following speed / power, rail rumble, wheel clatter over switches, brake squeal,
// door chimes, bell, stop-announcement chime, alerts. One WebAudio graph (a few dozen nodes); created in the first user gesture (iOS needs that), resumed on every
// gesture and when the tab becomes visible again (iOS also moves a context to "interrupted"), silent where WebAudio is missing. Mute is remembered on the device.
const KEY = 'tramvajs.mute';
const rd = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const wr = (m) => { try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* storage blocked */ } };

export class TramAudio {
  constructor() {
    this.ctx = null; this.muted = rd(); this.ok = true; this.listeners = [];
    const g = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, g, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resume(); else if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); });
    window.addEventListener('pageshow', () => this.resume());
  }
  get state() { return this.ctx ? this.ctx.state : 'none'; }
  onChange(f) { this.listeners.push(f); }
  resume() { if (this.ctx && this.ctx.state !== 'running') { try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } }
  unlock() {
    if (!this.ok) return;
    if (this.ctx) { this.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { this.ok = false; return; }
      const c = this.ctx = new AC();
      c.onstatechange = () => this.listeners.forEach((f) => f(c.state));
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.55;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; this.master.connect(comp); comp.connect(c.destination);
      // motor: two detuned saws + a whine (triangle, 3x) through a low-pass
      this.motor = c.createGain(); this.motor.gain.value = 0; const lp = this.lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      this.o1 = c.createOscillator(); this.o2 = c.createOscillator(); this.o3 = c.createOscillator();
      this.o1.type = 'sawtooth'; this.o2.type = 'sawtooth'; this.o3.type = 'triangle';
      this.whine = c.createGain(); this.whine.gain.value = 0;
      this.o1.connect(lp); this.o2.connect(lp); this.o3.connect(this.whine); this.whine.connect(lp); lp.connect(this.motor); this.motor.connect(this.master);
      this.o1.start(); this.o2.start(); this.o3.start();
      // noise source (2 s loop) for rumble + squeal
      const buf = this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
      const nl = c.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.value = 380; this.rum = c.createGain(); this.rum.gain.value = 0; n.connect(nl); nl.connect(this.rum); this.rum.connect(this.master);
      const sq = c.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 2600; sq.Q.value = 14; this.sq = sq; this.squeal = c.createGain(); this.squeal.gain.value = 0; n.connect(sq); sq.connect(this.squeal); this.squeal.connect(this.master);
      n.start();
      this.listeners.forEach((f) => f(c.state));
    } catch { this.ok = false; }
  }
  setMuted(m) { this.muted = m; wr(m); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03); }
  /** per frame: v m/s, lever -1..1 */
  update(v, lever, dt = 0.016) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, f = 52 + v * 8.5, pw = Math.max(0, lever);
    this.o1.frequency.setTargetAtTime(f, t, 0.1); this.o2.frequency.setTargetAtTime(f * 1.012, t, 0.1); this.o3.frequency.setTargetAtTime(f * 3 + v * 14, t, 0.1);
    this.motor.gain.setTargetAtTime(Math.min(0.1, (v > 0.2 ? 0.015 : 0) + v * 0.004 + pw * 0.03), t, 0.15);
    this.whine.gain.setTargetAtTime(Math.min(0.5, v * 0.03 + pw * 0.2), t, 0.2);
    this.lp.frequency.setTargetAtTime(300 + v * 60 + pw * 260, t, 0.2);
    this.rum.gain.setTargetAtTime(Math.min(0.3, v * 0.022), t, 0.15);
    // brake squeal: braking hard at low speed (and a short chirp when the last metres are crawled)
    const br = Math.max(0, -lever), sqv = br > 0.35 && v > 0.6 && v < 5.5 ? (br - 0.3) * 0.045 * Math.min(1, v / 1.5) : 0;
    this.squeal.gain.setTargetAtTime(sqv, t, 0.05); this.sq.frequency.setTargetAtTime(2200 + (5.5 - Math.min(v, 5.5)) * 220, t, 0.08);
  }
  _tone(freq, dur, type = 'sine', gain = 0.3, when = 0, freq2 = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (freq2) o.frequency.linearRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  _tick(when = 0, gain = 0.35, freq = 900) {   // one rail "tack": a few ms of band-passed noise
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5, 0.09);
  }
  /** wheel clatter over a switch: the four bogies hit the frogs one after another (gaps = bogie spacing / speed) */
  clatter(v) { if (!this.ctx || v < 0.5) return; const gaps = [0, 6.3 / v, 12.6 / v, 19.8 / v]; gaps.forEach((g, i) => { this._tick(g, 0.45 - i * 0.04, 700 + i * 140); this._tick(g + 0.045, 0.3, 1100); }); }
  bell() { for (const w of [0, 0.2]) { this._tone(1318, 0.55, 'sine', 0.3, w); this._tone(2637, 0.4, 'sine', 0.12, w); this._tone(1760, 0.5, 'sine', 0.16, w); } }
  chime(up = true) { this._tone(up ? 660 : 880, 0.25, 'triangle', 0.25); this._tone(up ? 880 : 660, 0.35, 'triangle', 0.25, 0.16); }
  /** doors: warning beeps while closing, a soft two-tone when opening */
  doorBeep(closing) { if (closing) for (let i = 0; i < 3; i++) this._tone(1480, 0.12, 'square', 0.07, i * 0.22); else this.chime(true); }
  /** stop announcement chime (three rising notes) */
  announce() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.45, 'sine', 0.22, i * 0.2)); }
  good() { this._tone(784, 0.2, 'triangle', 0.25); this._tone(1047, 0.35, 'triangle', 0.25, 0.12); }
  bad() { this._tone(180, 0.35, 'sawtooth', 0.15); }
  alert() { for (let i = 0; i < 4; i++) this._tone(1000, 0.1, 'square', 0.1, i * 0.16); }
  /** quick "ready" blip for the departure bell prompt */
  ready() { this._tone(990, 0.12, 'sine', 0.2); }
}
