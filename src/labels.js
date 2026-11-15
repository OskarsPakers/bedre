// Label throttling: decides WHEN a swallowed object's name may be shown (hud.label is wrapped, no edits to hud/game needed).
// Notable: landmarks + OSM-named (non-address) buildings that matter at the hole's size; plain street addresses only for
// buildings that are large relative to the hole. Max 1 new label per `minGap` s, queue of at most 2.
import { LIFE } from './config.js';
import { bus } from './events.js';
import { isAddressName } from './buildings.js';

export function installLabelThrottle(hud, world) {
  const L = LIFE.labels;
  const recent = new Map();
  const queue = [];
  const stats = { requested: 0, shown: 0, dropped: 0 };
  let now = 0, last = -99;
  bus.on('swallow', (o, hole) => {
    if (!o.name) return;
    recent.set(o.name, { o, hole });
    if (recent.size > 64) recent.delete(recent.keys().next().value);
  });
  const orig = hud.label.bind(hud);
  hud.label = (text, landmark) => {
    stats.requested++;
    const r = recent.get(text);
    recent.delete(text);
    const o = r && r.o, hole = r && r.hole;
    let ok = !!landmark;
    if (!ok && o && hole) {
      if (isAddressName(text)) ok = o.fit > hole.radius * L.addressFitFrac && o.value >= 30;
      else ok = o.fit > hole.radius * L.namedFitFrac || o.value >= 40;
    }
    if (!ok) { stats.dropped++; return; }
    const item = { text, landmark: !!landmark, t: now };
    if (queue.length >= 2) {
      const i = queue.findIndex((q) => !q.landmark);
      if (landmark && i >= 0) queue.splice(i, 1);
      else if (landmark) queue.shift();
      else { stats.dropped++; return; }
    }
    queue.push(item);
    pump();
  };
  function pump() {
    if (!queue.length) return;
    const gap = queue[0].landmark ? L.minGap * 0.5 : L.minGap;
    if (now - last < gap) return;
    const it = queue.shift();
    last = now; stats.shown++;
    orig(it.text, it.landmark);
  }
  world.onUpdate.push((dt) => {
    now += dt;
    for (let i = queue.length - 1; i >= 0; i--) if (now - queue[i].t > 6) queue.splice(i, 1); // stale
    pump();
  });
  bus.on('roundStart', () => { queue.length = 0; last = -99; });
  return stats;
}
