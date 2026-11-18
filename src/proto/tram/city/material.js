// Materials of the tram city (own copy of the idea of src/buildings.js makeBuildingMaterial, rewritten for the tram game's facade attributes).
//  lo  = walls with the SHADER window grid (all buildings, always drawn): glass with a sky-tinted fresnel term, shop glazing, lit windows at night, snow on up-facing faces.
//  hi  = plain vertex-coloured relief geometry (frames, sills, balconies, shop piers, awnings, dormers ...): only drawn near the camera.
import * as THREE from 'three';
import { themeHook } from '../../../themeUniforms.js';

const DECL = 'uniform float uNight;\nuniform float uSnow;\nuniform float uWinFrac;\n';
const SNOW = `
  if (uSnow > 0.001) { float up = smoothstep(0.55, 0.9, vNy); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 1.0), uSnow * up * 0.92); }`;

export function makeLoMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    themeHook(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 uvw;\nattribute vec4 aA;\nattribute vec4 aB;\nvarying vec4 vUvw;\nvarying vec4 vA;\nvarying vec4 vB;\nvarying float vNy;\nvarying vec3 vNv;\nvarying vec3 vVp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvw = uvw; vA = aA; vB = aB; vNy = normal.y; vNv = normalize(normalMatrix * normal);')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvVp = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vUvw;\nvarying vec4 vA;\nvarying vec4 vB;\nvarying float vNy;\nvarying vec3 vNv;\nvarying vec3 vVp;\n' + DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float winEm = 0.0; vec3 winLc = vec3(1.0);
  if (vA.x > 0.3 && vA.x < 0.75) { // measured / generic glass quad
    float h1 = fract(sin(vUvw.x * 12.9898 + 78.233) * 43758.5453);
    float shop = step(0.5, vB.x), hb = vB.w;
    float fres = pow(1.0 - clamp(dot(normalize(vNv), normalize(-vVp)), 0.0, 1.0), 2.0);
    vec3 sky = vec3(0.50, 0.64, 0.80) * (1.0 - 0.75 * uNight);
    vec3 glass = vec3(0.10, 0.145, 0.20) * (0.8 + 0.45 * h1);
    glass = mix(glass, sky, 0.12 + 0.5 * fres);
    glass = mix(glass, vec3(0.22, 0.2, 0.17), shop * 0.35);
    diffuseColor.rgb = glass;
    if (uNight > 0.001) {
      float h3 = fract(h1 * 17.17 + hb * 5.3);
      float lit = shop > 0.5 ? step(h1, 0.75) : step(h1, clamp(uWinFrac + (hb - 0.5) * 0.3, 0.05, 0.95));
      winLc = h3 < 0.07 ? vec3(0.50, 0.72, 1.0) : mix(vec3(1.0, 0.64, 0.30), vec3(1.0, 0.86, 0.55), h3);
      winEm = lit * uNight * (shop > 0.5 ? 1.5 : 1.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, winLc * 0.45, 0.55 * lit * uNight);
    }
  }
  if (vA.x > 0.75 && abs(vNy) < 0.3) {
    float fh = max(vA.y * 6.0, 1.0), ww = vA.w, wh = vB.x, wy = vB.y, gh = vB.z * 8.0, hb = vB.w;
    float cell = floor(vUvw.x), bu = fract(vUvw.x);
    float mask = 0.0, shop = 0.0, fl = 0.0;
    if (vUvw.y >= 0.0) {
      fl = floor(vUvw.y); float fy = fract(vUvw.y);
      float wx = step(0.5 - ww * 0.5, bu) * step(bu, 0.5 + ww * 0.5);
      float wyy = step(wy, fy) * step(fy, wy + wh);
      mask = wx * wyy * step((1.0 - fy) * fh + 0.3, vUvw.z);
    } else if (gh > 0.8) {
      float gw = 0.82; float wx = step(0.5 - gw * 0.5, bu) * step(bu, 0.5 + gw * 0.5);
      mask = wx * step(0.5, vUvw.w) * step(vUvw.w, gh - 0.5); shop = 1.0; fl = -1.0;
    }
    float h1 = fract(sin(dot(vec2(cell, fl), vec2(12.9898, 78.233)) + hb * 37.719) * 43758.5453);
    float fres = pow(1.0 - clamp(dot(normalize(vNv), normalize(-vVp)), 0.0, 1.0), 2.0);
    vec3 sky = vec3(0.50, 0.64, 0.80) * (1.0 - 0.75 * uNight);
    vec3 glass = vec3(0.10, 0.145, 0.20) * (0.8 + 0.45 * h1);
    glass = mix(glass, sky, 0.10 + 0.5 * fres);
    glass = mix(glass, vec3(0.22, 0.2, 0.17), shop * 0.35); // shop interior
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, 0.9 * mask);
    if (uNight > 0.001 && mask > 0.5) {
      float h3 = fract(h1 * 17.17 + hb * 5.3);
      float lit = shop > 0.5 ? step(h1, 0.75) : step(h1, clamp(uWinFrac + (hb - 0.5) * 0.3, 0.05, 0.95));
      winLc = h3 < 0.07 ? vec3(0.50, 0.72, 1.0) : mix(vec3(1.0, 0.64, 0.30), vec3(1.0, 0.86, 0.55), h3);
      winEm = lit * uNight * (shop > 0.5 ? 1.5 : 1.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, winLc * 0.45, 0.55 * lit * uNight);
    }
  }
  ${SNOW}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winLc * winEm + diffuseColor.rgb * (0.16 * (1.0 - uNight) * (1.0 - smoothstep(0.6, 0.95, vNy)));');
  };
  mat.customProgramCacheKey = () => 'tramcity-lo3';
  return mat;
}

export function makeHiMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    themeHook(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvNy = normal.y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNy;\n' + DECL).replace('#include <color_fragment>', '#include <color_fragment>' + SNOW).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.16 * (1.0 - uNight) * (1.0 - smoothstep(0.6, 0.95, vNy)));');
  };
  mat.customProgramCacheKey = () => 'tramcity-hi2';
  return mat;
}
