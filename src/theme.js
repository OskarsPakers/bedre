// Visual themes: day / evening (Vakars) / winter (Ziema) / 18 November (Lāčplēša diena) / Līgo dusk.
// A theme = sky + fog + hemisphere/sun colours + exposure + "night" factor + flags / snow / fireworks / glow switches.
// Selection: `?theme=` URL override > picker choice (localStorage `bedre.theme`) > automatic by the player's local date/time
// (after local sunset in Riga -> evening; 11-18 Nov -> festive; Dec-Feb -> winter; 23-24 Jun -> Līgo).
// Runtime: ThemeManager applies a theme to Lighting / renderer / shared shader uniforms (themeUniforms.js) and drives the sky dome,
// glow sprites, snow, festive flags and fireworks. `window.__theme` exposes it for tests.
import * as THREE from 'three';
import { CFG } from './config.js';
import { bus } from './events.js';
import { t, onLang } from './i18n.js';
import { themeUniforms, chainShader, GLSL_GROUND_DECL, GLSL_GROUND, GLSL_PROP_VERT_DECL, GLSL_PROP_VERT_SET, GLSL_PROP_FRAG_DECL, GLSL_PROP } from './themeUniforms.js';
import { SkyDome } from './sky.js';
import { Glow } from './glow.js';
import { Snow } from './snow.js';
import { FestiveFlags } from './flags.js';
import { Fireworks } from './fireworks.js';
import { cleanRing, bbox, pointInPoly } from './geo.js';

export { themeUniforms };

// ---- tunables --------------------------------------------------------------------------------------------
export const THEME_TUNE = {
  fireworkEvery: [40, 60],     // seconds between volleys during a round (18 Nov)
  firstVolley: 9,              // first in-round volley after round start (s)
  menuEvery: [11, 17],         // volleys behind the start / results screen
  volleyRockets: [3, 5],
  finaleRockets: 24, finaleSeconds: 9,
  flashMax: 0.75,
  sunsetOffsetMin: 20,         // evening starts this many minutes before sunset
  riga: { lat: 56.95, lon: 24.11 },
};

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

const LOOKS = {
  day: {
    night: 0, sky: null, fog: 0xcfe0ec, stars: 0, moon: false, hemi: [0xe3eefa, 0xb9a98c, 1.25], sun: [0xfff0d4, 2.5, V(-0.55, 0.78, 0.35)],
    exposure: 1.0, shadow: 1, winFrac: 0.4, glow: 0, waterTint: 0x5f86a3,
  },
  evening: {
    night: 0.9, sky: { top: 0x0d1236, mid: 0x262a6e, horizon: 0xd9774f }, fog: 0x2f3070, stars: 1, moon: true,
    hemi: [0x95a6ec, 0x5a5280, 1.7], sun: [0xb5c8ff, 1.55, V(0.52, 0.6, -0.42)],
    exposure: 1.2, shadow: 0.55, winFrac: 0.45, glow: 1, waterTint: 0x0a1334,
  },
  ligo: {
    night: 0.35, sky: { top: 0x2a2f78, mid: 0x7a5a9a, horizon: 0xffa860 }, fog: 0xb08a9a, stars: 0.25, moon: false,
    hemi: [0xffd2b0, 0x8a7a8a, 1.4], sun: [0xffb070, 2.1, V(0.8, 0.28, 0.45)],
    exposure: 1.05, shadow: 0.9, winFrac: 0.25, glow: 0.55, waterTint: 0xc07a7a,
  },
  nov18: {
    night: 0.92, sky: { top: 0x080d2e, mid: 0x1f2468, horizon: 0xc95a74 }, fog: 0x2a2a66, stars: 1, moon: true,
    hemi: [0x93a5f0, 0x5a4a80, 1.72], sun: [0xc0cdff, 1.5, V(0.52, 0.6, -0.42)],
    exposure: 1.2, shadow: 0.5, winFrac: 0.48, glow: 1, waterTint: 0x0a1334,
  },
  winterDay: {
    night: 0, sky: null, fog: 0xdde6ee, stars: 0, moon: false, hemi: [0xe6eefc, 0xc9d0dc, 1.38], sun: [0xfff4e2, 1.9, V(-0.45, 0.5, 0.5)],
    exposure: 1.02, shadow: 0.85, winFrac: 0.4, glow: 0, waterTint: 0x9fb4c8,
  },
  winterEve: {
    night: 0.85, sky: { top: 0x10183e, mid: 0x2c3a78, horizon: 0xb08aa0 }, fog: 0x343a78, stars: 0.9, moon: true,
    hemi: [0xa8b8f0, 0x6a6a90, 1.78], sun: [0xbcd0ff, 1.5, V(0.52, 0.6, -0.42)],
    exposure: 1.22, shadow: 0.5, winFrac: 0.5, glow: 1, waterTint: 0x141e48,
  },
};

/** id -> theme definition (look + feature switches) */
export const THEMES = {
  day: { look: 'day', key: 'themeDay' },
  evening: { look: 'evening', key: 'themeEvening' },
  ligo: { look: 'ligo', key: 'themeLigo' },
  nov18: { look: 'nov18', key: 'themeNov18Name', flags: 1, candles: true, fireworks: true, festive: true },
  winter: { look: 'winterDay', key: 'themeWinterDay', snow: 1 },
  winterEve: { look: 'winterEve', key: 'themeWinterEve', snow: 1 },
};
export const PICKER = ['auto', 'day', 'evening', 'winter', 'nov18'];
const PICK_LABEL = { auto: 'themeAuto', day: 'themeDay', evening: 'themeEvening', winter: 'themeWinter', nov18: 'themeNov18' };

function build(id) {
  const d = THEMES[id], L = LOOKS[d.look];
  return {
    id, key: d.key, night: L.night,
    sky: L.sky ? { top: C(L.sky.top), mid: C(L.sky.mid), horizon: C(L.sky.horizon) } : null,
    fog: C(L.fog), stars: L.stars, moon: L.moon,
    hemi: { sky: C(L.hemi[0]), ground: C(L.hemi[1]), i: L.hemi[2] },
    sun: { color: C(L.sun[0]), i: L.sun[1], dir: L.sun[2].clone() },
    exposure: L.exposure, shadow: L.shadow, winFrac: L.winFrac, glow: L.glow, waterTint: C(L.waterTint),
    flags: d.flags || 0, snow: d.snow || 0, fireworks: !!d.fireworks, candles: !!d.candles, festive: !!d.festive,
  };
}

// ---- automatic selection ----------------------------------------------------------------------------------
/** sunrise / sunset (UTC ms) in Riga for a calendar date (NOAA approximation) */
export function sunTimes(y, m, d) {
  const { lat, lon } = THEME_TUNE.riga, rad = Math.PI / 180;
  const N = Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = (2 * Math.PI / 365) * (N - 1 + 0.0);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
  const ha = Math.acos(Math.max(-1, Math.min(1, c))) / rad;
  const base = Date.UTC(y, m, d);
  return { sunrise: base + (720 - 4 * (lon + ha) - eq) * 6e4, sunset: base + (720 - 4 * (lon - ha) - eq) * 6e4 };
}

/** the theme id the clock picks (now = Date) */
export function autoTheme(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (m === 10 && d >= 11 && d <= 18) return 'nov18';
  if (m === 5 && (d === 23 || d === 24)) return 'ligo';
  const { sunrise, sunset } = sunTimes(y, m, d);
  const ms = now.getTime();
  const dark = ms >= sunset - THEME_TUNE.sunsetOffsetMin * 6e4 || ms < sunrise;
  if (m === 11 || m === 0 || m === 1) return dark ? 'winterEve' : 'winter';
  return dark ? 'evening' : 'day';
}

/** picker value -> theme id (winter / evening follow the clock where it matters) */
export function resolvePick(pick, now = new Date()) {
  switch (pick) {
    case 'day': return 'day';
    case 'evening': return 'evening';
    case 'winter': case 'winter-day': return autoTheme(now) === 'winterEve' ? 'winterEve' : 'winter';
    case 'winter-evening': case 'winterEve': return 'winterEve';
    case 'nov18': case '18nov': return 'nov18';
    case 'ligo': return 'ligo';
    default: return autoTheme(now);
  }
}

function readPick(params) {
  const q = params.get('theme');
  if (q) return { pick: q, url: true };
  try { const s = localStorage.getItem('bedre.theme'); if (s && PICKER.includes(s)) return { pick: s, url: false }; } catch { /* storage blocked */ }
  return { pick: 'auto', url: false };
}

// ---- river geometry (fireworks launch area, candles along 11. novembra krastmala) ---------------------------------
const OLD_TOWN = [-420, 330];
function findRiver(world) {
  const data = world.data, b = world.bounds;
  let best = null, ba = 0;
  for (const w of data.water || []) {
    const r = w._r || (w._r = cleanRing(w.p || []));
    if (r.length < 3) continue;
    let a = 0;
    for (let i = 0; i < r.length; i++) { const [x0, z0] = r[i], [x1, z1] = r[(i + 1) % r.length]; a += x0 * z1 - x1 * z0; }
    a = Math.abs(a) / 2;
    if (a > ba) { ba = a; best = r; }
  }
  const inB = (x, z) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  const anchor = inB(OLD_TOWN[0], OLD_TOWN[1]) ? OLD_TOWN : [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const out = { pts: [], shore: [], anchor };
  if (!best) return out;
  const bb = bbox(best);
  for (let x = Math.max(bb.x0, anchor[0] - 760); x <= Math.min(bb.x1, anchor[0] + 760); x += 30) {
    for (let z = Math.max(bb.z0, anchor[1] - 760); z <= Math.min(bb.z1, anchor[1] + 760); z += 30) {
      if (!pointInPoly(x, z, best) || !pointInPoly(x + 45, z, best) || !pointInPoly(x - 45, z, best) || !pointInPoly(x, z + 45, best) || !pointInPoly(x, z - 45, best)) continue;
      out.pts.push([x, z]);
    }
  }
  // promenade: sample the shore near the Old Town, 5 m inland
  const step = 3.6;
  for (let i = 0; i < best.length; i++) {
    const [x0, z0] = best[i], [x1, z1] = best[(i + 1) % best.length];
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1) continue;
    const tx = (x1 - x0) / L, tz = (z1 - z0) / L;
    for (let s = 0; s < L; s += step) {
      const px = x0 + tx * s, pz = z0 + tz * s;
      if (Math.hypot(px - anchor[0], pz - anchor[1]) > 650 || Math.abs(pz - anchor[1]) > 470) continue;
      if (Math.abs(px - b.minX) < 40 || Math.abs(px - b.maxX) < 40 || Math.abs(pz - b.minZ) < 40 || Math.abs(pz - b.maxZ) < 40) continue;
      let nx = -tz, nz = tx;
      if (pointInPoly(px + nx * 1.5, pz + nz * 1.5, best)) { nx = -nx; nz = -nz; }
      const qx = px + nx * 5, qz = pz + nz * 5;
      if (!world.blockers.free(qx, qz, 0.7)) continue;
      out.shore.push([qx, qz]);
    }
  }
  return out;
}

// ---- the manager ----------------------------------------------------------------------------------------------
export class ThemeManager {
  constructor({ renderer, scene, world, game, quality, params }) {
    this.renderer = renderer; this.scene = scene; this.world = world; this.game = game; this.quality = quality;
    this.light = game.light;
    this.params = params;
    this.time = 0;
    this.flash = 0; this.flashCol = new THREE.Color(1, 1, 1);
    this.level = quality ? quality.level : 2;
    this.id = 'day'; this.T = build('day');
    this.sky = new SkyDome(scene);
    this.glow = new Glow(scene, world);
    this.snow = new Snow(scene);
    this.fw = new Fireworks(scene);
    this.flags = null;
    this.river = null;
    this.vtimer = 0; this.finale = null; this.finaleLeft = 0;
    this.stats = { volleys: 0, finales: 0, applied: 0 };
    this._phase = game.phase;
    this._lastNow = performance.now();
    this._ground();
    this.fw.onExplode = (e) => this._onExplode(e);
    this.fw.onLaunch = (x, y, z, delay) => bus.emit('fireworkLaunch', { delay, vol: this._vol(x, z) });
    bus.on('roundEnd', () => { if (this.T.fireworks) this.playFinale(); });
    bus.on('roundStart', () => { this.vtimer = THEME_TUNE.firstVolley; this.fw.setEnabled(this.T.fireworks); });

    const sel = readPick(params);
    this.pick = sel.pick; this.urlForced = sel.url;
    this.mountPicker();
    this.apply(resolvePick(this.pick));
    // per-frame hook: wrap game.render so the theme runs exactly once per drawn frame
    const render = game.render.bind(game);
    game.render = () => { this.frame(); render(); };
  }

  /** chain night / snow shader edits onto the ground and prop materials created by other modules */
  _ground() {
    const gm = new Set();
    this.world.ground.traverse((o) => { if (o.isMesh && o.material) gm.add(o.material); });
    for (const m of gm) chainShader(m, 'theme-g1', (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_GROUND_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_GROUND);
    });
    const pm = this.world.propMeshes && this.world.propMeshes[0] && this.world.propMeshes[0].material;
    if (pm) chainShader(pm, 'theme-p1', (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + GLSL_PROP_VERT_DECL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GLSL_PROP_VERT_SET);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_PROP_FRAG_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_PROP);
    });
  }

  /** switch to a theme id (instant; cheap; safe to call repeatedly) */
  apply(id) {
    if (!THEMES[id]) id = 'day';
    const T = build(id);
    this.id = id; this.T = T; this.stats.applied++;
    this.light.applyTheme(T);
    this.renderer.toneMappingExposure = T.exposure;
    const u = themeUniforms;
    u.uNight.value = T.night; u.uSnow.value = T.snow; u.uWinFrac.value = T.winFrac; u.uWaterTint.value.copy(T.waterTint);
    this.sky.setTheme(T);
    this.glow.setFestive(T.festive);
    this.glow.setTheme(T.glow, this.level);
    if (T.candles) {
      if (!this.river) this.river = findRiver(this.world);
      this.glow.setCandles(this.river.shore.filter((_, i) => i % 1 === 0).slice(0, 520));
    } else this.glow.setCandles([]);
    this.snow.setActive(T.snow > 0, this.level);
    if (T.flags) {
      if (!this.flags) this.flags = new FestiveFlags(this.scene, this.world, { shore: (this.river || (this.river = findRiver(this.world))).shore });
      this.flags.setActive(true, T.flags, this.level);
    } else if (this.flags) this.flags.setActive(false);
    this.fw.setLevel(this.level);
    this.fw.setEnabled(T.fireworks);
    this.vtimer = T.fireworks ? THEME_TUNE.menuEvery[0] : 0;
    this.finale = null;
    this.flash = 0;
    document.documentElement.dataset.theme = id;
    this._updatePicker();
    bus.emit('themeChange', { id, night: T.night });
  }

  setPick(pick, store = true) {
    this.pick = pick;
    if (store) { try { localStorage.setItem('bedre.theme', pick); } catch { /* ignore */ } }
    this.apply(resolvePick(pick));
  }

  // ---- start-screen picker (injected, no index.html edit) -------------------------------------------------
  mountPicker() {
    const host = document.getElementById('opts-body');
    if (!host) return;
    const box = document.createElement('div');
    box.className = 'themesw'; box.setAttribute('role', 'group'); box.id = 'themesw';
    const lab = document.createElement('span'); lab.className = 'tl'; box.appendChild(lab);
    this.pickBtns = {};
    for (const p of PICKER) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.theme = p;
      b.addEventListener('click', () => this.setPick(p));
      box.appendChild(b); this.pickBtns[p] = b;
    }
    const cap = document.createElement('div'); cap.className = 'themecap'; cap.id = 'themecap';
    const q = document.getElementById('adv-quality');   // theme row sits before the graphics row
    if (q) q.before(box, cap); else host.append(box, cap);
    this.pickLabel = lab; this.pickCap = cap;
    onLang(() => this._updatePicker());
  }

  _updatePicker() {
    if (!this.pickBtns) return;
    this.pickLabel.textContent = t('themeLbl');
    this.pickBox = this.pickBox || document.getElementById('themesw');
    if (this.pickBox) this.pickBox.setAttribute('aria-label', t('themeLbl'));
    for (const p of PICKER) {
      const b = this.pickBtns[p];
      b.textContent = t(PICK_LABEL[p]);
      b.setAttribute('aria-pressed', String(p === this.pick));
    }
    this.pickCap.textContent = this.pick === 'auto' ? t('themeNow', { name: t(this.T.key) }) : '';
    if (this.T.festive) this.pickCap.textContent = (this.pick === 'auto' ? t(new Date().getDate() === 18 ? 'themeNov18CapDay' : 'themeNov18CapWeek') + ' · ' : '') + t('themeNov18Note');   // 11-17 Nov: Lāčplēša Day week; 18 Nov: the proclamation of the Republic
  }

  // ---- fireworks ------------------------------------------------------------------------------------------
  _vol(x, z) {
    const f = this.game.cam.focus, d = Math.hypot(x - f.x, z - f.z);
    return Math.max(0.25, Math.min(1, 1 - d / (this.game.cam.dist * 3 + 500)));
  }

  _onExplode(e) {
    this.flash = Math.min(THEME_TUNE.flashMax, this.flash + 0.14 + Math.min(0.3, e.big / 160));
    this.flashCol.setRGB(e.r, e.g, e.b);
    // make the flash tint warm-white heavy so it never turns the city into a coloured wash
    this.flashCol.lerp(this._white || (this._white = new THREE.Color(1, 1, 1)), 0.45);
    bus.emit('fireworkBoom', { vol: this._vol(e.x, e.z) * (e.vol ?? 1), big: e.big });
  }

  /** pick where a rocket goes: over the Daugava point nearest the focus, pulled into the camera's view when far away */
  _target(out, spread = 1) {
    const cam = this.game.cam, f = cam.focus, dist = cam.dist;
    if (!this.river) this.river = findRiver(this.world);
    const pts = this.river.pts;
    let bx = f.x - dist * 0.4, bz = f.z - dist * 0.3, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - f.x) ** 2 + (pts[i][1] - f.z) ** 2; if (d < bd) { bd = d; bx = pts[i][0]; bz = pts[i][1]; } }
    let D = Math.sqrt(bd);
    if (D > 1) { const push = 45 + dist * 0.12; bx += ((bx - f.x) / D) * push; bz += ((bz - f.z) / D) * push; D += push; } // out over the water, away from the shore
    const reach = Math.max(25, dist * 0.55);
    let tx = bx, tz = bz;
    if (D > reach) { tx = f.x + ((bx - f.x) / D) * reach; tz = f.z + ((bz - f.z) / D) * reach; }
    tx += (Math.random() - 0.5) * Math.min(120, 30 + dist * 0.45) * spread;
    tz += (Math.random() - 0.5) * Math.min(120, 30 + dist * 0.45) * spread;
    // height limited by what the camera can see above that spot
    const camAlt = Math.sin(cam.elev) * dist, cz = f.z + Math.cos(cam.elev) * dist;
    const Dh = Math.hypot(tx - f.x, tz - cz);
    const limit = camAlt - Dh * 0.62;
    const cap = Math.max(150, dist * 0.12);
    const apex = Math.max(14, Math.min(cap, limit * 0.62 + 6 + Math.random() * dist * 0.03));
    out.x = tx; out.z = tz; out.apex = apex; out.R = Math.max(10, Math.min(Math.max(80, dist * 0.1), apex * 0.85));
    return out;
  }

  _tmp = { x: 0, z: 0, apex: 40, R: 25 };
  _types = ['peony', 'peony', 'ring', 'willow', 'glitter', 'peony'];

  /** a short volley of rockets */
  volley(n = 0) {
    if (!this.T.fireworks) return 0;
    const [a, b] = THEME_TUNE.volleyRockets;
    n = n || Math.round(a + Math.random() * (b - a));
    for (let i = 0; i < n; i++) this._shoot(i * (0.35 + Math.random() * 0.5));
    this.stats.volleys++;
    return n;
  }

  _shoot(delay, big = 1) {
    const tg = this._target(this._tmp);
    this.fw.launch(tg.x, tg.z, tg.apex * big, tg.R * big, this._types[(Math.random() * this._types.length) | 0], this.fw.palette, delay);
  }

  playFinale() {
    if (!this.T.fireworks) return;
    this.stats.finales++;
    this.finale = { left: THEME_TUNE.finaleRockets, t: 0, every: THEME_TUNE.finaleSeconds / THEME_TUNE.finaleRockets };
    this.fw.setEnabled(true);
  }

  // ---- per-frame --------------------------------------------------------------------------------------------
  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this._lastNow) / 1000));
    this._lastNow = now;
    this.time += dt;
    const game = this.game, cam = game.cam;
    themeUniforms.uThemeTime.value = this.time;
    // quality tier changes
    const lv = this.quality ? this.quality.level : 2;
    if (lv !== this.level) {
      this.level = lv;
      this.glow.setLevel(lv); this.snow.setActive(this.T.snow > 0, lv); this.fw.setLevel(lv);
      if (this.flags && this.T.flags) this.flags.setActive(true, this.T.flags, lv);
    }
    // phase transitions: new round -> re-evaluate "auto" (clock), clear destroyed decorations
    if (game.phase !== this._phase) {
      const prev = this._phase; this._phase = game.phase;
      if (game.phase === 'intro' || (game.phase === 'menu')) {
        if (this.pick === 'auto' && !this.urlForced) { const id = resolvePick('auto'); if (id !== this.id) this.apply(id); }
        if (this.flags) this.flags.clearDead();
        if (game.phase === 'intro' && this.T.fireworks) { this.fw.setEnabled(true); this.volley(3); this.vtimer = THEME_TUNE.firstVolley; }
      }
      if (prev === 'ended' && game.phase !== 'ended') this.finale = null;
    }
    // scheduling
    if (this.T.fireworks) {
      const paused = game.paused;
      if (!paused) {
        if (this.finale) {
          const F = this.finale; F.t -= dt;
          while (F.t <= 0 && F.left > 0) { this._shoot(0, 1 + (F.left < 8 ? 0.25 : 0)); F.left--; F.t += F.every * (0.6 + Math.random() * 0.8); }
          if (F.left <= 0) this.finale = null;
        } else {
          this.vtimer -= dt;
          if (this.vtimer <= 0) {
            const playing = game.phase === 'playing';
            if (playing || game.phase === 'menu' || game.phase === 'intro') this.volley();
            const r = playing ? THEME_TUNE.fireworkEvery : THEME_TUNE.menuEvery;
            this.vtimer = r[0] + Math.random() * (r[1] - r[0]);
          }
        }
      }
      this.fw.update(dt);
    }
    // fireworks are invisible at the steep gameplay camera: while a volley is in the sky ease the pitch / zoom a little (least intrusive option;
    // the round-end finale gets a proper wide shot behind the results panel), then settle back
    {
      const ended = game.phase === 'ended' && !!this.finale || (game.phase === 'ended' && this.fw.active() > 0);
      const want = !this.T.fireworks || game.paused ? 0 : ended ? 1.6 : (this.fw.active() > 0 ? 0.55 : 0);
      cam.ease += (want - cam.ease) * (1 - Math.exp(-(want > cam.ease ? 2.2 : 0.9) * dt));
      if (Math.abs(cam.ease) < 0.002) cam.ease = 0;
    }
    // flash decay + apply to light + sky
    if (this.flash > 0.001) this.flash *= Math.exp(-4.5 * dt); else this.flash = 0;
    this.light.flash = this.flash; this.light.flashColor.copy(this.flashCol);
    this.sky.update(cam.camera, this.time, this.flash, this.flashCol);
    this.glow.update(dt, this.time);
    this.snow.update(this.time, cam.focus, cam.dist);
    if (this.flags) this.flags.update(dt, cam.dist);
  }

  /** compact status for tests */
  info() {
    return {
      id: this.id, pick: this.pick, night: themeUniforms.uNight.value, snow: themeUniforms.uSnow.value, winFrac: themeUniforms.uWinFrac.value,
      exposure: this.renderer.toneMappingExposure, fw: { ...this.fw.stats, slots: this.fw.tier.slots, verts: this.fw.stats.verts, visible: this.fw.points.visible, active: this.fw.active() },
      glowVisible: this.glow.points.visible, glowCount: this.glow.N, candles: this.glow.candleN, snowVisible: this.snow.points.visible,
      flags: this.flags ? { ...this.flags.counts, on: this.flags.on } : null, skyVisible: this.sky.mesh.visible, stats: { ...this.stats },
    };
  }
}

export function initTheme(ctx) {
  const mgr = new ThemeManager(ctx);
  window.__theme = mgr;
  return mgr;
}
