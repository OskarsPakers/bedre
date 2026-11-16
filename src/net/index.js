// Online mode entry point: initOnline({ game, world }) is called once from main.js. Everything else lives in src/net/*.
import { OnlineMode } from './online.js';
import { dumpPlacements } from '../placements.js';

export function initOnline({ game, world }) {
  game.online = null;
  const online = new OnlineMode(game, world);
  window.__online = online.api();
  window.__placementsDump = () => dumpPlacements(world, game.picker);   // used by tools/mp/build-objects.mjs (?placements=generate)
  window.__mpHash = () => world.placements.hash;                         // content id of the placement file this world was built from (null in the fallback)
  return online;
}
