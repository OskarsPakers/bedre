// Orthographic elevation / plan renders of the dense reality mesh in the Opera frame -> PNG. node ortho.mjs  (writes into scripts/out/onebuilding/ortho-*.png)
import { withPage } from './shot.mjs'; import fs from 'node:fs';
const W = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/work/';
await withPage(async pg => {
  await pg.goto('http://localhost:5196/dense.html?x0=-20&x1=140&z0=160&z1=345'); await pg.waitForFunction('window.__d?.ready', null, { timeout: 240000 });
  await pg.addScriptTag({ type: 'module', content: `
    import { toWorld } from '/frame.js'; const D = window.__d, T = D.THREE;
    window.__ortho = (view, o) => { // view: top|sw|ne|n|se ; o: {a0,a1 (horizontal range), b0,b1 (vertical range, y for elevations / v for top), pad (px/m), clip (m in front of plane kept), off (plane offset)}
      const w = Math.round((o.a1 - o.a0) * o.ppm), h = Math.round((o.b1 - o.b0) * o.ppm); D.renderer.setSize(w, h); D.scene.background = new T.Color(0xffffff);
      const cam = new T.OrthographicCamera(-(o.a1 - o.a0) / 2, (o.a1 - o.a0) / 2, (o.b1 - o.b0) / 2, -(o.b1 - o.b0) / 2, 0.01, 400); let P, L, up;
      const ac = (o.a0 + o.a1) / 2, bc = (o.b0 + o.b1) / 2;
      if (view === 'top') { P = toWorld(ac, bc, 150); L = toWorld(ac, bc, 0); up = new T.Vector3(...toWorld(1, 0, 0)).sub(new T.Vector3(...toWorld(0, 0, 0))); cam.far = 400; cam.rotation.order = 'YXZ'; }
      else { // elevations: horizontal axis a = u or v, vertical = y ; plane at offset 'off' along the view axis; camera at 100 m out
        const sgn = { sw: [1, 0, -1], ne: [-1, 0, 1], n: [0, 1, -1], se: [0, -1, 1] }[view]; // [horizontal axis sign along u, along v, depth direction sign]
        const hu = view === 'sw' ? [1, 0] : view === 'ne' ? [-1, 0] : view === 'n' ? [0, -1] : [0, 1], dv = view === 'sw' ? [0, 1] : view === 'ne' ? [0, -1] : view === 'n' ? [1, 0] : [-1, 0]; // view direction in (u,v)
        const cu = hu[0] ? ac * hu[0] * 0 : 0; // placeholder
        // camera position in (u,v): at plane offset minus 100 along view dir
        const cen = hu[0] ? [ac * Math.abs(hu[0]), 0] : [0, ac * Math.abs(hu[1])]; // not used
        const pu = (hu[0] ? hu[0] * ac * hu[0] : 0), pv = 0; void pu; void pv; void cu; void cen;
        const base = dv[0] ? [o.off, 0] : [0, o.off]; // a point on the wall plane
        const hpos = hu[0] ? [ac, 0] : [0, ac]; // horizontal coordinate in (u,v) at centre
        const pos = [base[0] * Math.abs(dv[0]) + hpos[0], base[1] * Math.abs(dv[1]) + hpos[1]]; // plane point at the horizontal centre
        const camUV = [pos[0] - dv[0] * 100, pos[1] - dv[1] * 100]; P = toWorld(camUV[0], camUV[1], bc); L = toWorld(pos[0], pos[1], bc);
        const R = hu; // horizontal right-vector in (u,v) -> world
        const rw = new T.Vector3(...toWorld(R[0], R[1], 0)).sub(new T.Vector3(...toWorld(0, 0, 0))); cam.userData.right = rw;
        cam.position.set(...P); cam.up.set(0, 1, 0); cam.lookAt(...L); // lookAt makes right = dir x up; verify sign below
        const dir = new T.Vector3().subVectors(new T.Vector3(...L), new T.Vector3(...P)).normalize(); const right = new T.Vector3().crossVectors(dir, cam.up);
        if (right.dot(rw) < 0) cam.scale.x = -1; // mirror if needed (flip handled by using negative left/right)
        cam.near = 100 - (o.clip ?? 2); cam.far = cam.near + (o.range ?? 16); cam.updateProjectionMatrix(); D.renderer.render(D.scene, cam); const color = D.renderer.domElement.toDataURL('image/png');
        D.scene.background = new T.Color(0x0000ff); D.scene.overrideMaterial = new T.ShaderMaterial({ side: T.DoubleSide, vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'void main(){float z=gl_FragCoord.z*255.;gl_FragColor=vec4(floor(z)/255.,fract(z),0.,1.);}' }); D.renderer.render(D.scene, cam); D.scene.overrideMaterial = null; D.scene.background = new T.Color(0xffffff);
        return [color, D.renderer.domElement.toDataURL('image/png')]; }
      cam.position.set(...P); cam.up.copy(up.normalize()); cam.lookAt(...L); cam.updateProjectionMatrix(); D.renderer.render(D.scene, cam); return D.renderer.domElement.toDataURL('image/png'); };` });
  const G = 0.8, TOP = 37.0; // ground of the mesh in world y ; model y = world y - G
  const jobs = { sw: { a0: -15, a1: 95, b0: G, b1: TOP, ppm: 40, off: -0.4, clip: 1.4 }, ne: { a0: -15, a1: 95, b0: G, b1: TOP, ppm: 40, off: 40.4, clip: 1.4 }, n: { a0: -5, a1: 45, b0: G, b1: TOP, ppm: 40, off: -14.4, clip: 1.0 }, nloggia: { a0: -5, a1: 45, b0: G, b1: TOP, ppm: 40, off: -9.4, clip: 0.4 }, nall: { a0: -5, a1: 45, b0: G, b1: TOP, ppm: 40, off: -14.4, clip: 8 }, swall: { a0: -15, a1: 95, b0: G, b1: TOP, ppm: 30, off: 0, clip: 3 } };
  const view = { sw: 'sw', ne: 'ne', n: 'n', nloggia: 'n', nall: 'n', swall: 'sw' };
  for (const [k, o] of Object.entries(jobs)) { const [c, d] = await pg.evaluate(([k, o]) => { const r = window.__ortho(k, o); return r; }, [view[k], o]).then(r => r); fs.writeFileSync(W + `ortho-${k}.png`, Buffer.from(c.split(',')[1], 'base64')); fs.writeFileSync(W + `depth-${k}.png`, Buffer.from(d.split(',')[1], 'base64')); console.log(k); }
});
