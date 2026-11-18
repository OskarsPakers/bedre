// street-detail close-up near the Opera (kerb, setts, parked cars, trees): node tools/tramcity/street-detail.mjs out.png [s=1330] [theme]
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
import { buildTrack } from '../../src/proto/tram/track.js';
const [out, s = '1330', theme = 'day'] = process.argv.slice(2);
const T = buildTrack(JSON.parse(fs.readFileSync('src/proto/tram/routes/centrs-3.json', 'utf8'))); const p = {}, q = {};
T.at(+s, p); T.at(+s + 25, q); const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
const a = [p.x + rx * 4.5, 1.9, p.z + rz * 4.5], b = [q.x + rx * 5.5, 0.6, q.z + rz * 5.5];
execFileSync('node', ['tools/tramcity/cam.mjs', out, ...a, ...b, '70', 'centrs-3', theme], { stdio: 'inherit' });
