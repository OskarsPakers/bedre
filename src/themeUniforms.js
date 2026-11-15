// Shared uniforms + GLSL snippets for the theme system (evening windows, snow, water sheen). Kept dependency-free so the
// building material (buildings.js) can import it without pulling in the whole theme runtime.
import * as THREE from 'three';

export const themeUniforms = {
  uNight: { value: 0 },        // 0 = day .. 1 = full night
  uSnow: { value: 0 },         // 0 = none .. 1 = fully snowy
  uWinFrac: { value: 0.45 },   // fraction of windows lit (before per-building variation)
  uWaterTint: { value: new THREE.Color(0x203060) },
  uThemeTime: { value: 0 },
};

/** Assign the shared uniforms to a compiling shader (call from any onBeforeCompile). */
export function themeHook(shader) {
  for (const k of Object.keys(themeUniforms)) shader.uniforms[k] = themeUniforms[k];
}

// ---- building material (buildings.js) --------------------------------------------------------------
export const GLSL_BLD_VERT_DECL = 'varying float vBid;';
export const GLSL_BLD_VERT_SET = '#ifdef USE_BATCHING\nvBid = getIndirectIndex(gl_DrawID);\n#else\nvBid = 0.0;\n#endif';
export const GLSL_BLD_FRAG_DECL = 'varying float vBid;\nuniform float uNight;\nuniform float uSnow;\nuniform float uWinFrac;';
/** Inside the window block (needs: win, u, fy, vLN, diffuseColor, totalEmissiveRadiance). */
export const GLSL_BLD_WINDOWS = `
  if (uNight > 0.001 && win > 0.0) {
    vec2 wc = vec2(floor(u), floor(fy));
    float h1 = fract(sin(dot(wc, vec2(12.9898, 78.233)) + vBid * 37.719) * 43758.5453);
    float h2 = fract(sin(vBid * 91.345 + 3.7) * 43758.5453);
    float h3 = fract(h1 * 17.17 + h2 * 5.3);
    float lit = step(h1, clamp(uWinFrac + (h2 - 0.5) * 0.3, 0.05, 0.95));
    vec3 lc = h3 < 0.07 ? vec3(0.50, 0.72, 1.0) : mix(vec3(1.0, 0.64, 0.30), vec3(1.0, 0.86, 0.55), h3);
    float flick = 0.85 + 0.25 * h2;
    totalEmissiveRadiance += lc * (lit * win * uNight * 1.35 * flick);
    diffuseColor.rgb = mix(diffuseColor.rgb, lc * 0.45, 0.55 * lit * win * uNight);
  }
  if (uSnow > 0.001) {
    float roof = smoothstep(0.55, 0.9, vLN.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 1.0), uSnow * roof * 0.92);
  }`;

// ---- ground (chained onto the hole-patched material, injected right after <color_fragment>) ---------------
export const GLSL_GROUND_DECL = 'uniform float uNight;\nuniform float uSnow;\nuniform vec3 uWaterTint;';
export const GLSL_GROUND = `
{
  vec3 base = diffuseColor.rgb;
  float wm = smoothstep(0.05, 0.13, base.b - base.r);
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  float road = (1.0 - smoothstep(0.03, 0.09, sat)) * (1.0 - smoothstep(0.36, 0.5, lum));
  if (uSnow > 0.001) {
    vec3 snowCol = vec3(0.90, 0.93, 0.98);
    vec3 ice = vec3(0.60, 0.72, 0.84);
    float amt = mix(0.88, 0.5, road);
    vec3 sn = mix(base, snowCol * (0.82 + 0.18 * lum), amt);
    sn = mix(sn, ice * (0.7 + 0.5 * lum), wm * 0.8);
    diffuseColor.rgb = mix(base, sn, uSnow);
  }
  if (uNight > 0.001) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uWaterTint, wm * uNight * 0.78);
    totalEmissiveRadiance += uWaterTint * (wm * uNight * 0.12);
  }
}`;

// ---- props (shared instanced Lambert material): snow on up-facing surfaces --------------------------------
export const GLSL_PROP_VERT_DECL = 'varying float vUpness;';
export const GLSL_PROP_VERT_SET = 'vUpness = dot(normalize(transformedNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));';
export const GLSL_PROP_FRAG_DECL = 'varying float vUpness;\nuniform float uSnow;';
export const GLSL_PROP = `
if (uSnow > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), uSnow * smoothstep(0.5, 0.85, vUpness) * 0.9);`;

/**
 * Chain extra shader edits after a material's existing onBeforeCompile (the ground / prop materials are created by other
 * modules). `edit(shader)` mutates the shader; the program cache key is suffixed so the variants don't collide.
 */
export function chainShader(mat, tag, edit) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = (shader, renderer) => { if (prev) prev.call(mat, shader, renderer); themeHook(shader); edit(shader); };
  mat.customProgramCacheKey = () => prevKey() + '|' + tag;
  mat.needsUpdate = true;
}
