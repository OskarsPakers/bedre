// Time of day / season for the tram game WITHOUT the engine's ThemeManager (which needs the hole game): the same looks as src/theme.js (day, evening, winter), applied
// through the engine's own public pieces -- Lighting.applyTheme, SkyDome.setTheme, the shared theme uniforms and the same shader chain onto the ground / prop materials.
// Nothing in the engine is edited (see docs/proto/tram.md for what a Game-free ThemeManager would save).
import * as THREE from 'three';
import { themeUniforms, chainShader, GLSL_GROUND_DECL, GLSL_GROUND, GLSL_PROP_VERT_DECL, GLSL_PROP_VERT_SET, GLSL_PROP_FRAG_DECL, GLSL_PROP } from '../../themeUniforms.js';
import { Snow } from '../../snow.js';

const C = (h) => new THREE.Color(h);
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const LOOKS = {   // = theme.js LOOKS (day / evening / winterDay) -- copied values, so the picture matches the main game's themes
  day: { night: 0, sky: null, fog: 0xcfe0ec, stars: 0, moon: false, hemi: [0xe3eefa, 0xb9a98c, 1.25], sun: [0xfff0d4, 2.5, V(-0.55, 0.78, 0.35)], exposure: 1.0, shadow: 1, winFrac: 0.4, waterTint: 0x5f86a3, snow: 0 },
  evening: { night: 0.9, sky: { top: 0x0d1236, mid: 0x262a6e, horizon: 0xd9774f }, fog: 0x2f3070, stars: 1, moon: true, hemi: [0x95a6ec, 0x5a5280, 1.7], sun: [0xb5c8ff, 1.55, V(0.52, 0.6, -0.42)], exposure: 1.2, shadow: 0.55, winFrac: 0.45, waterTint: 0x0a1334, snow: 0 },
  winter: { night: 0, sky: null, fog: 0xdde6ee, stars: 0, moon: false, hemi: [0xe6eefc, 0xc9d0dc, 1.38], sun: [0xfff4e2, 1.9, V(-0.45, 0.5, 0.5)], exposure: 1.02, shadow: 0.85, winFrac: 0.4, waterTint: 0x9fb4c8, snow: 1 },
};
export const THEME_IDS = ['day', 'evening', 'winter'];
const DAY_SKY = { top: 0x6fa3d6, mid: 0xa4c6e2, horizon: 0xcfe0ec };

export class Env {
  /** S = bootStreetWorld result */
  constructor(S) {
    this.S = S; this.id = 'day'; this.snow = new Snow(S.scene); this.listeners = [];
    const gm = new Set();
    S.world.ground.traverse((o) => { if (o.isMesh && o.material) gm.add(o.material); });
    for (const m of gm) chainShader(m, 'theme-g1', (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_GROUND_DECL).replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_GROUND);
    });
    const pm = S.world.propMeshes && S.world.propMeshes[0] && S.world.propMeshes[0].material;
    if (pm) chainShader(pm, 'theme-p1', (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_PROP_VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GLSL_PROP_VERT_SET);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_PROP_FRAG_DECL).replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_PROP);
    });
  }
  get night() { return this.id === 'evening'; }
  onChange(f) { this.listeners.push(f); }
  apply(id) {
    const L = LOOKS[id] || LOOKS.day; this.id = LOOKS[id] ? id : 'day';
    const S = this.S;
    const T = {
      night: L.night, sky: L.sky ? { top: C(L.sky.top), mid: C(L.sky.mid), horizon: C(L.sky.horizon) } : { top: C(DAY_SKY.top), mid: C(DAY_SKY.mid), horizon: C(DAY_SKY.horizon) },
      fog: C(L.fog), stars: L.stars, moon: L.moon, hemi: { sky: C(L.hemi[0]), ground: C(L.hemi[1]), i: L.hemi[2] }, sun: { color: C(L.sun[0]), i: L.sun[1], dir: L.sun[2].clone() },
      shadow: L.shadow,
    };
    S.light.applyTheme(T);
    S.renderer.toneMappingExposure = L.exposure;
    const u = themeUniforms; u.uNight.value = L.night; u.uSnow.value = L.snow; u.uWinFrac.value = L.winFrac; u.uWaterTint.value.copy(C(L.waterTint));
    S.sky.setTheme(T);
    S.sky.mesh.visible = true;
    this.snow.setActive(L.snow > 0, S.quality && S.quality.rung > 0 ? 1 : 2);
    this.listeners.forEach((f) => f(this.id));
  }
  frame(time, focus, dist = 30) { themeUniforms.uThemeTime.value = time; if (this.snow.points.visible) this.snow.update(time, focus, dist); }
}
