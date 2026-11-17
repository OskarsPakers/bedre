// Shared prototype bootstrap: builds the existing BEDRE world (ground, buildings with shapes + sights, trees, props, static movers) WITHOUT
// the hole game (no Game / holes / bots / theme manager / backend). Used by the street-level prototypes (kur/, ...).
// Everything is imported through the engine modules' existing exports; nothing here edits them.
//   const S = await bootStreetWorld({ canvas, params, onProgress });
//   S = { THREE, renderer, scene, world, data, light, sky, quality, slug, resize(w, h, camera?) , tick(camera, focusX, focusZ, dt) }
import * as THREE from 'three';
import { CFG } from '../../config.js';
import { MAPS, mapPaths } from '../../../tools/maps.mjs';
import { loadCity } from '../../data.js';
import { World } from '../../world.js';
import { Lighting } from '../../lighting.js';
import { SkyDome } from '../../sky.js';
import { Quality } from '../../quality.js';
import { themeUniforms } from '../../themeUniforms.js';
import { trackLoad } from '../../loadProgress.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const C = (h) => new THREE.Color(h);

export function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

/** Point CFG at a map's files (?map= only: unlike src/maps.js applyMap it ignores the main game's remembered district). */
export function selectMap(params) {
  const q = params.get('map');
  const m = MAPS.find((x) => x.slug === q) || MAPS[0];
  const p = mapPaths(m.slug);
  CFG.map = { slug: m.slug, lv: m.lv, en: m.en, mult: m.mult, focus: m.focus };
  CFG.dataUrl = p.data; CFG.shapesUrl = p.shapes; CFG.groundUrl = p.ground; CFG.sightsUrl = p.sights;
  return m;
}

export async function bootStreetWorld({ canvas, params = new URLSearchParams(location.search), onProgress = () => {}, onPhase = () => {}, sky: skyLook } = {}) {
  const map = selectMap(params);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.pixelRatioCap));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();

  const tracked = trackLoad((f) => onProgress(f));
  const data = await loadCity(false, (f) => { if (!tracked) onProgress(f); });
  onPhase('build');
  await nextFrame(); // let the loading screen repaint before the long synchronous build
  const world = new World(scene, data);
  world.flush();

  // day look = the Lighting defaults (== theme.js LOOKS.day); evening / winter / night need the ThemeManager (which needs a Game), not used here
  const light = new Lighting(scene);
  themeUniforms.uNight.value = 0; themeUniforms.uSnow.value = 0; themeUniforms.uWinFrac.value = 0.4;
  const sky = new SkyDome(scene);
  const look = skyLook || { top: 0x6fa3d6, mid: 0xa4c6e2, horizon: 0xcfe0ec };
  sky.setTheme({ sky: { top: C(look.top), mid: C(look.mid), horizon: C(look.horizon) }, fog: C(CFG.colors.sky), stars: 0, moon: false, sun: { dir: light.dir.clone() } });
  const quality = new Quality({ renderer, light, world, canvas });

  return {
    THREE, renderer, scene, world, data, light, sky, quality, slug: map.slug,
    /** per frame: sky follows the camera; ground close-up layer + sun shadow window follow (fx, fz); dist = nominal "camera distance" for the shadow / detail logic */
    tick(camera, fx, fz, time = 0, { detailDist = 30, shadowDist = 200, detailX = fx, detailZ = fz } = {}) {
      sky.update(camera, time, 0);
      world.ground.userData.detail.update(detailX, detailZ, detailDist);
      light.update({ x: fx, z: fz }, shadowDist);
    },
  };
}
