// User Timing helper: `span('name', t0)` records performance.measure('bd:name') from t0 (performance.now()) to now.
// Read by scripts/perf-pass.mjs (world-build breakdown); costs nothing noticeable.
export function span(name, t0) { try { performance.measure('bd:' + name, { start: t0, end: performance.now() }); } catch { /* ignore */ } }
