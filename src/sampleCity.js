// Procedural fallback city in the same schema as public/data/riga.json.
import { mulberry32 } from './rng.js';

const STREETS = ['Torņa', 'Kalpaka', 'Elizabetes', 'Dzirnavu', 'Marijas', 'Stabu', 'Lāčplēša', 'Barona', 'Ausekļa', 'Citadeles', 'Skolas', 'Kr. Valdemāra'];

export function generateSampleCity(seed = 7) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const city = {
    meta: {
      name: 'Sample city', origin: { lat: 56.9515, lon: 24.1133 },
      bounds: { minX: -700, maxX: 700, minZ: -700, maxZ: 700 }, sample: true,
    },
    buildings: [], roads: [], water: [], parks: [], trees: [], landmarks: [],
  };
  let id = 1;
  const riverZ = (x) => -450 + 28 * Math.sin(x / 140);
  const riverHalf = 48;

  // river polygon
  const top = [], bot = [];
  for (let x = -760; x <= 760; x += 40) { top.push([x, riverZ(x) - riverHalf]); bot.push([x, riverZ(x) + riverHalf]); }
  city.water.push({ p: [...top, ...bot.reverse()] });

  const inRiver = (z0, z1) => z1 > -450 - riverHalf - 36 && z0 < -450 + riverHalf + 36;

  // roads
  const bridgesX = [-300, 0, 300];
  for (let i = -7; i <= 7; i++) {
    const v = i * 100;
    const major = i % 3 === 0;
    const k = major ? 'primary' : (i % 2 === 0 ? 'secondary' : 'residential');
    const w = major ? 18 : (k === 'secondary' ? 12 : 8);
    // vertical streets (constant x)
    if (Math.abs(v) <= 700) {
      if (bridgesX.includes(v)) city.roads.push({ p: [[v, -700], [v, 700]], w, k });
      else {
        city.roads.push({ p: [[v, -700], [v, riverZ(v) - riverHalf - 4]], w, k });
        city.roads.push({ p: [[v, riverZ(v) + riverHalf + 4], [v, 700]], w, k });
      }
    }
    // horizontal streets (constant z), skip those inside the river
    if (Math.abs(v) <= 700 && !inRiver(v - 8, v + 8)) {
      city.roads.push({ p: [[-700, v], [700, v]], w, k: major ? 'primary' : k });
    }
  }
  // embankment road + pedestrian diagonals + footpaths
  const emb = []; for (let x = -700; x <= 700; x += 50) emb.push([x, riverZ(x) + riverHalf + 14]);
  city.roads.push({ p: emb, w: 10, k: 'secondary' });
  city.roads.push({ p: [[-300, 200], [-100, 400], [150, 560]], w: 5, k: 'pedestrian' });
  city.roads.push({ p: [[120, 130], [260, 230], [380, 150]], w: 3, k: 'footway' });
  city.roads.push({ p: [[-700, 650], [0, 650], [700, 650]], w: 8, k: 'rail' });

  const types = ['res', 'res', 'res', 'res', 'res', 'res', 'com', 'com', 'pub', 'aux'];
  const names = () => `${pick(STREETS)} iela ${Math.floor(R(1, 60))}`;

  const addRect = (x0, z0, x1, z1, h, t, extra) => {
    const p = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    // occasional chamfer / L notch
    const r = rng();
    let poly = p;
    if (r < 0.2 && x1 - x0 > 12 && z1 - z0 > 12) {
      const cx = Math.min(8, (x1 - x0) * 0.4), cz = Math.min(8, (z1 - z0) * 0.4);
      poly = [[x0, z0], [x1, z0], [x1, z1 - cz], [x1 - cx, z1 - cz], [x1 - cx, z1], [x0, z1]];
    } else if (r < 0.3) {
      poly = [[x0 + 3, z0], [x1 - 3, z0], [x1, z0 + 3], [x1, z1 - 3], [x1 - 3, z1], [x0 + 3, z1], [x0, z1 - 3], [x0, z0 + 3]];
    }
    const b = { id: id++, p: poly, h: Math.round(h * 10) / 10, t };
    if (rng() < 0.35 && t !== 'aux') b.n = names();
    Object.assign(b, extra);
    city.buildings.push(b);
  };

  for (let gx = -7; gx < 7; gx++) {
    for (let gz = -7; gz < 7; gz++) {
      const x0 = gx * 100 + 10, x1 = gx * 100 + 90, z0 = gz * 100 + 10, z1 = gz * 100 + 90;
      if (inRiver(z0, z1) || z1 > 600 || x0 < -690 || x1 > 690) continue;
      if (gx === -1 && gz === 0) { // plaza
        for (let i = 0; i < 14; i++) city.trees.push([R(x0 + 4, x1 - 4), R(z0 + 4, z1 - 4)]);
        continue;
      }
      if (gx === 2 && gz === 1) { // park
        city.parks.push({ p: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
        for (let i = 0; i < 70; i++) city.trees.push([R(x0 + 3, x1 - 3), R(z0 + 3, z1 - 3)]);
        continue;
      }
      if (gx === 0 && gz === 0) { // big public block
        addRect(x0 + 6, z0 + 6, x1 - 6, z1 - 30, 24, 'pub', { n: 'Kongresu nams' });
        continue;
      }
      const tallBlock = (gx * 7 + gz * 3) % 11 === 0;
      const d = 16;
      // north & south sides
      for (const side of [0, 1]) {
        let x = x0;
        while (x < x1 - 10) {
          const w = Math.min(R(14, 32), x1 - x);
          if (w < 8) break;
          const t = pick(types);
          const h = t === 'com' ? R(18, tallBlock ? 60 : 38) : t === 'pub' ? R(14, 26) : t === 'aux' ? R(3, 6) : R(13, 27);
          const zA = side === 0 ? z0 : z1 - d, zB = side === 0 ? z0 + d : z1;
          addRect(x, zA, x + w - 0.8, zB, h, t);
          x += w;
        }
      }
      // west & east sides
      for (const side of [0, 1]) {
        let z = z0 + d;
        while (z < z1 - d - 8) {
          const w = Math.min(R(14, 30), z1 - d - z);
          if (w < 8) break;
          const t = pick(types);
          const h = t === 'com' ? R(18, 40) : t === 'aux' ? R(3, 6) : R(13, 27);
          const xA = side === 0 ? x0 : x1 - d, xB = side === 0 ? x0 + d : x1;
          addRect(xA, z, xB, z + w - 0.8, h, t);
          z += w;
        }
      }
      // courtyard clutter
      for (let i = 0; i < 3; i++) {
        if (rng() < 0.6) {
          const cx = R(x0 + 24, x1 - 30), cz = R(z0 + 24, z1 - 30);
          addRect(cx, cz, cx + R(5, 10), cz + R(5, 9), R(3, 7), 'aux');
        }
      }
      if (gx === 1 && gz === -1) addRect(x0 + 34, z0 + 34, x0 + 42, z0 + 42, 38, 'rel', { n: 'Sv. Pētera baznīca' });
    }
  }

  // street trees
  for (let i = -7; i <= 7; i++) {
    for (let t = -690; t <= 690; t += 24) {
      for (const s of [-1, 1]) {
        const off = i * 100 + s * 9.5;
        if (Math.abs(i % 3) === 0 && rng() < 0.4) continue;
        if (!inRiver(t - 4, t + 4)) city.trees.push([off + R(-0.6, 0.6), t + R(-3, 3)]);
      }
    }
  }
  // drop trees inside buildings is handled by consumer; keep schema simple.
  city.landmarks.push({ n: 'Brīvības piemineklis', x: -50, z: 50, h: 42 });
  return city;
}
