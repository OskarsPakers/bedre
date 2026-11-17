// Tiny procedural sound for the tram: motor hum + rail rumble that follow speed / power, bell, door chime. Own WebAudio graph (a handful of
// nodes); created on the first user gesture, muted by the M key / the sound button, and silent where WebAudio is missing.
export class TramAudio {
  constructor() { this.ctx = null; this.muted = false; this.ok = true; }
  unlock() {
    if (this.ctx || !this.ok) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { this.ok = false; return; }
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.5; this.master.connect(c.destination);
      // motor: two detuned saws through a low-pass; rumble: looped noise through a low-pass
      this.motor = c.createGain(); this.motor.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; this.lp = lp;
      this.o1 = c.createOscillator(); this.o2 = c.createOscillator(); this.o1.type = 'sawtooth'; this.o2.type = 'sawtooth';
      this.o1.connect(lp); this.o2.connect(lp); lp.connect(this.motor); this.motor.connect(this.master); this.o1.start(); this.o2.start();
      const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = c.createBufferSource(); n.buffer = buf; n.loop = true; const nl = c.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.value = 380;
      this.rum = c.createGain(); this.rum.gain.value = 0; n.connect(nl); nl.connect(this.rum); this.rum.connect(this.master); n.start();
    } catch { this.ok = false; }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  update(v, lever) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = 55 + v * 9, pw = Math.max(0, lever);
    this.o1.frequency.setTargetAtTime(f, t, 0.1); this.o2.frequency.setTargetAtTime(f * 1.012, t, 0.1);
    this.motor.gain.setTargetAtTime(Math.min(0.1, (v > 0.2 ? 0.015 : 0) + v * 0.004 + pw * 0.03), t, 0.15);
    this.lp.frequency.setTargetAtTime(300 + v * 60 + pw * 200, t, 0.2);
    this.rum.gain.setTargetAtTime(Math.min(0.3, v * 0.022), t, 0.15);
  }
  _tone(freq, dur, type = 'sine', gain = 0.3, when = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  bell() { this._tone(1318, 0.5, 'sine', 0.35); this._tone(1760, 0.5, 'sine', 0.2); this._tone(1318, 0.5, 'sine', 0.35, 0.18); this._tone(1760, 0.5, 'sine', 0.2, 0.18); }
  chime(up = true) { this._tone(up ? 660 : 880, 0.25, 'triangle', 0.25); this._tone(up ? 880 : 660, 0.35, 'triangle', 0.25, 0.16); }
  good() { this._tone(784, 0.2, 'triangle', 0.25); this._tone(1047, 0.35, 'triangle', 0.25, 0.12); }
  bad() { this._tone(180, 0.35, 'sawtooth', 0.15); }
}
