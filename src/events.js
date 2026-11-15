// Tiny shared event emitter. Events used so far:
//   swallow(obj, hole)       world.beginFall (before hole score update)
//   landed(obj, hole)        fall animation finished
//   levelUp({hole, level})   player hole crossed a CFG.levels threshold
//   holeEaten(...), playerEaten(...), respawn(...)   reserved for gameplay (audio listens)
//   roundStart / roundEnd    emitted by life.js watching game.phase
export const bus = {
  _l: new Map(),
  on(name, fn) {
    let a = this._l.get(name);
    if (!a) this._l.set(name, (a = []));
    a.push(fn);
    return () => this.off(name, fn);
  },
  off(name, fn) {
    const a = this._l.get(name);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  },
  emit(name, a, b, c) {
    const l = this._l.get(name);
    if (!l) return;
    for (let i = 0; i < l.length; i++) {
      try { l[i](a, b, c); } catch (e) { console.warn('[bus]', name, e); }
    }
  },
};
