// Freedom Monument protection ("it takes the monument under its coat"): in the 18 November theme (solo) and in online rooms during 11-18 Nov (the server
// decides: `fm: 1` in the start / resume frame, src/net/online.js) the monument cannot be swallowed by ANY hole. Mechanism: its `fit` is infinite, so the
// swallow loop, the Magnēts, the bots' food search and the server's claim check all skip it. A hole big enough to eat it that passes over it gets a golden
// shimmer, a toast (at most once per 20 s) and, once per round, the album entry (flagged "honour", it does not unlock the swallow achievement).
// Solo rule: theme id 'nov18' AND not the ranked daily challenge (everybody plays the same setup there). The trace carries `fm: 1` for such rounds.
import { CFG } from './config.js';
import { bus } from './events.js';
import { t, extendStrings } from './i18n.js';

extendStrings({
  fmToast: 'Brīvības piemineklis paliek savā vietā.', fmToastShort: 'Brīvības piemineklis paliek savā vietā.',
}, {
  fmToast: 'The Freedom Monument stays where it is.', fmToastShort: 'The Freedom Monument stays where it is.',
});

const COOLDOWN = 20;   // seconds of play between two toasts

export function initFreedom({ game, world }) {
  const fm = world.objects.find((o) => o.kind === 'freedom');
  const api = { get on() { return !!fm && fm.fit > 1e8; } };
  if (!fm) return api;
  const fitReal = fm.fit;
  let lastToast = -99, honoured = false, glow = 0;
  const set = (v) => { fm.fit = v ? 1e9 : fitReal; game.fmProtected = !!v; };
  const themeId = () => (window.__theme && window.__theme.id) || null;
  bus.on('roundGo', () => {   // (solo: also fires without the fly-in)
    if (!game.online) { const m = window.__modes ? window.__modes.state : {}; set(themeId() === 'nov18' && !(m.id === 'daily' && m.ranked)); }
    lastToast = -99; honoured = false; glow = 0;
  });
  bus.on('fmSet', (v) => { set(v); lastToast = -99; honoured = false; });   // online: the server's rule for the room
  bus.on('menu', () => set(false));
  world.onUpdate.push((dt) => {
    if (!game.fmProtected) return;
    const p = game.player;
    if (glow > 0) {   // golden shimmer around the figure and its three stars
      glow -= dt;
      const n = Math.min(6, Math.ceil(dt * 90));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, r = 1 + Math.random() * 4, y = 22 + Math.random() * 24;
        world.fx.emit(fm.x + Math.cos(a) * r, y, fm.z + Math.sin(a) * r, Math.cos(a) * 0.6, 1.2 + Math.random() * 1.5, Math.sin(a) * 0.6, 0.6 + Math.random() * 0.8, 2.6 + Math.random() * 2, 0.9 + Math.random() * 0.7, 0.85, 1, 1, 0.82, 0.3, 0, 0.5);
      }
    }
    if (game.phase !== 'playing' || !p.alive || p.dying) return;
    if (p.radius * CFG.swallow.fitRatio < fitReal) return;                       // too small to have eaten it anyway: nothing new
    if (Math.hypot(p.x - fm.x, p.z - fm.z) > p.radius * CFG.swallow.reach) return;
    glow = Math.max(glow, 1.4);
    if (game.playT - lastToast >= COOLDOWN) {
      lastToast = game.playT;
      const short = window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 520px)').matches;
      if (window.__metaToast) window.__metaToast('🇱🇻', t(short ? 'fmToastShort' : 'fmToast'), { ms: 4200 });
      game.hud.ring(innerWidth / 2, innerHeight / 2, 90, true);
    }
    if (!honoured) { honoured = true; bus.emit('freedomPass', fm); }
  });
  window.__freedom = { get protected() { return !!game.fmProtected; }, fm };
  return api;
}
