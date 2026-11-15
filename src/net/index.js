// Online mode entry point: initOnline({ game, world }) is called once from main.js. Everything else lives in src/net/*.
import { OnlineMode } from './online.js';
import { dumpTable, worldHash } from './table.js';

export function initOnline({ game, world }) {
  game.online = null;
  const online = new OnlineMode(game, world);
  window.__online = online.api();
  window.__mpDump = () => dumpTable(world, game.picker);   // used by tools/mp/build-objects.mjs
  window.__mpHash = () => worldHash(world);
  return online;
}
