// Wires the "world life & feel" modules (audio, labels, quality, level-up / countdown / round events) to the game.
// Single entry point called from main.js: initLife({ renderer, scene, world, game, canvas }).
import { CFG } from './config.js';
import { bus } from './events.js';
import { AudioEngine, mountMuteButton, wireAudioEvents } from './audio.js';
import { installLabelThrottle } from './labels.js';
import { Quality } from './quality.js';
import { camShake } from './effects.js';
import { findBridges } from './ground.js';

export function initLife({ renderer, scene, world, game, canvas }) {
  const audio = new AudioEngine();
  mountMuteButton(audio);
  wireAudioEvents(audio);
  audio.player = () => game.player;
  world.holesRef = () => game.holes;
  const labelStats = installLabelThrottle(game.hud, world);
  const quality = new Quality({ renderer, light: game.light, world, canvas });

  const levelOf = (r) => {
    const L = CFG.levels;
    let i = 0;
    while (i < L.length - 1 && r >= L[i + 1]) i++;
    return i + 1;
  };
  let prevPhase = game.phase, lastLevel = 1, lastTick = -1, humT = 0;
  world.onUpdate.push((dt) => {
    const phase = game.phase;
    if (phase !== prevPhase) {
      if (phase === 'playing') { lastLevel = 1; lastTick = -1; bus.emit('roundStart'); }
      else if (phase === 'ended' && prevPhase === 'playing') bus.emit('roundEnd');
      prevPhase = phase;
    }
    if (phase !== 'playing') return;
    const lv = levelOf(game.player.targetRadius);
    if (lv > lastLevel) { lastLevel = lv; bus.emit('levelUp', { hole: game.player, level: lv }); }
    else if (lv < lastLevel) lastLevel = lv;
    const n = Math.ceil(game.timeLeft);
    if (n <= 10 && n >= 1 && n !== lastTick) { lastTick = n; bus.emit('countdown', n); }
    humT += dt;
    if (humT > 0.1) {
      humT = 0;
      const p = game.player;
      audio.setHole(p.radius, Math.min(1, Math.hypot(p.vx || 0, p.vz || 0) / Math.max(1, p.speed || 1)), true);
    }
  });
  // hum off outside rounds
  setInterval(() => { if (game.phase !== 'playing') audio.setHole(game.player.radius, 0, false); }, 500);

  window.__life = { game, bridges: () => findBridges(world.data), audio, quality, labelStats, world, fx: world.fx, traffic: world.traffic, bus, camShake, renderer };
  return window.__life;
}
