// Ground floor of the portico end: (1) reality-mesh orthophoto, (2) open street-level photo (Commons, CC BY-SA 4.0, Captain Raju), (3) our model close-up
import sharp from 'sharp'; const W = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/', O = '/Users/oskars/projects/holeio/scripts/out/onebuilding/';
const ortho = await sharp(W + 'work/ortho-n.png').extract({ left: 150, top: 1050, width: 1700, height: 398 }).resize(1200).toBuffer();
const photo = await sharp(W + 'ref/Latvian_National_Opera_in_2019.01.jpg').extract({ left: 100, top: 880, width: 1700, height: 480 }).resize(1200).toBuffer();
const txt = (t) => Buffer.from(`<svg width="1200" height="26" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="18" font-family="Helvetica" font-size="15" fill="#fff">${t}</text></svg>`);
const model = await sharp(O + 'r-c0-orbit0.png').extract({ left: 380, top: 560, width: 800, height: 280 }).resize(1200).toBuffer();
const h1 = (await sharp(ortho).metadata()).height, h2 = (await sharp(photo).metadata()).height, h3 = (await sharp(model).metadata()).height;
await sharp({ create: { width: 1200, height: h1 + h2 + h3 + 78, channels: 3, background: '#111' } }).composite([{ input: txt('1. reality-mesh orthophoto, ground floor + portico podium (municipal data): smeared, doors/openings melted'), top: 0, left: 0 }, { input: ortho, top: 26, left: 0 },
  { input: txt('2. open street-level photograph (Wikimedia Commons, CAPTAIN RAJU, CC BY-SA 4.0): crisp openings, stairs, rustication, door frames'), top: 26 + h1, left: 0 }, { input: photo, top: 52 + h1, left: 0 },
  { input: txt('3. our model (hybrid LOD0) at the same place: geometry openings + reveals from the grammar; textures still from (1)'), top: 52 + h1 + h2, left: 0 }, { input: model, top: 78 + h1 + h2, left: 0 }]).jpeg({ quality: 88 }).toFile(O + 'street-level-compare.jpg');
