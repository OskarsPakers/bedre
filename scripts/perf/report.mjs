// Markdown tables from docs/perf/data/*-<label>*.json.   node scripts/perf/report.mjs <label> [label2 ...]   (two labels: before | after side by side)
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const D = path.join(root, 'docs', 'perf', 'data');
const labels = process.argv.slice(2);
const rd = (kind, label, suffix = '') => { const f = path.join(D, `${kind}-${label}${suffix}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };
const out = [];
const P = (s = '') => out.push(s);
const f1 = (x) => (x == null ? '-' : (+x).toFixed(1));
const kb = (x) => (x == null ? '-' : Math.round(x / 1024));
const s2 = (x) => (x == null ? '-' : (x / 1000).toFixed(2));
const cell = (vals, fmt) => vals.map((v) => (v == null ? '-' : fmt(v))).join(' / ');
const MAPS = ['centrs', 'agenskalns', 'mezaparks', 'purvciems'];

P('### Load: transfer (KB at ready, as served; brotli for html/js/css/json) and time to playable (s, median of runs)');
P('| profile | map | cache | ' + labels.map((l) => `${l}: KB / ready s / FCP ms / build ms`).join(' | ') + ' |'); P('|---|---|---|' + labels.map(() => '---').join('|') + '|');
for (const profile of ['desktop', 'pixel5', 'iphone13']) for (const map of MAPS) for (const cache of ['cold', 'warm']) {
  const cs = labels.map((l) => rd('load', l).find((r) => r.profile === profile && r.map === map && r.cache === cache));
  if (!cs.some(Boolean)) continue;
  P(`| ${profile} | ${map} | ${cache} | ` + cs.map((r) => (r ? `${kb(r.total)} / ${s2(r.ready)} / ${r.fcp} / ${r.buildMs}${r.runs > 1 ? '' : ' (1 run)'}` : '-')).join(' | ') + ' |');
}
P(); P('### Load: bytes after 6 s (SW background traffic), cold');
P('| profile | map | ' + labels.map((l) => `${l}: KB after 6 s`).join(' | ') + ' |'); P('|---|---|' + labels.map(() => '---').join('|') + '|');
for (const profile of ['desktop', 'pixel5']) for (const map of MAPS) { const cs = labels.map((l) => rd('load', l).find((r) => r.profile === profile && r.map === map && r.cache === 'cold')); if (cs.some(Boolean)) P(`| ${profile} | ${map} | ` + cs.map((r) => (r ? kb(r.totalAfter6s) : '-')).join(' | ') + ' |'); }
P(); P('### Per-resource transfer, centre, cold (KB)');
{
  const cs = labels.map((l) => rd('load', l).find((r) => r.profile === 'desktop' && r.map === 'centrs' && r.cache === 'cold'));
  const keys = [...new Set(cs.flatMap((r) => (r ? Object.keys(r.wire) : [])))].sort((a, b) => Math.max(...cs.map((r) => (r && r.wire[b]) || 0)) - Math.max(...cs.map((r) => (r && r.wire[a]) || 0)));
  P('| resource | ' + labels.join(' | ') + ' |'); P('|---|' + labels.map(() => '---').join('|') + '|');
  for (const k of keys) P(`| ${k} | ` + cs.map((r) => (r && r.wire[k] != null ? kb(r.wire[k]) : '-')).join(' | ') + ' |');
}
for (const [title, suffix, profiles] of [['desktop (Chromium, M-series, unthrottled)', '', ['desktop']], ['phone: Pixel 5 profile 4x CPU (Chromium) and iPhone 13 (WebKit)', '-phone', ['pixel5cpu', 'iphone13']]]) {
  P(); P(`### World build, ${title}: ms (median of 3), per map x tier`);
  const cols = ['buildMs', 'ground-total', 'ground-prep', 'ground-tiles', 'ground-skirt', 'buildings-total', 'bld-pass1', 'bld-geometry', 'bld-sights-treatment(in geometry)', 'bld-batch', 'traffic-roadnet', 'props-total', 'blockers', 'json-parse', 'longest'];
  P('| profile | map | tier | label | ' + cols.join(' | ') + ' | first frame |'); P('|---|---|---|---|' + cols.map(() => '---').join('|') + '|---|');
  for (const profile of profiles) for (const map of MAPS) for (const tier of ['low', 'medium', 'high']) for (const l of labels) {
    const r = rd('build', l, suffix).find((x) => x.profile === profile && x.map === map && x.tier === tier); if (!r) continue;
    P(`| ${profile} | ${map} | ${tier} | ${l} | ` + cols.map((c) => (c === 'buildMs' ? r.buildMs : c === 'longest' ? r.longestTask : f1(r.measures[c]))).join(' | ') + ` | ${f1(r.firstFrameMs)} |`);
  }
}
for (const [title, suffix, profiles] of [['desktop Chromium (real GPU)', '', ['desktop']], ['iPhone 13 emulation on WebKit (timer resolution 1 ms: sim / render split is noisy)', '', ['iphone13']], ['Pixel 5 profile, 4x CPU throttle', '-pixel5cpu', ['pixel5cpu']]]) {
  P(); P(`### Frame cost, ${title}: cpu ms (sim + render submit) | Mtri | draw calls, 8 holes`);
  P('| map | tier | label | intro overview | r=3 | r=30 | r=90 | max zoom-out |'); P('|---|---|---|---|---|---|---|---|');
  for (const profile of profiles) for (const map of MAPS) for (const tier of ['low', 'medium', 'high']) for (const l of labels) {
    const r = rd('frame', l, suffix).find((x) => x.profile === profile && x.map === map && x.tier === tier); if (!r) continue;
    const c = (v) => (v ? `${v.cpuMs} (${v.simMs}+${v.renderMs}) \\| ${(v.tris / 1e6).toFixed(2)} \\| ${v.calls}` : '-');
    P(`| ${map} | ${tier} | ${l} | ${c(r.view.intro)} | ${c(r.view.r3)} | ${c(r.view.r30)} | ${c(r.view.r90)} | ${c(r.view.zoomout)} |`);
  }
}
for (const [suffix, title] of [['', 'desktop Chromium'], ['-iphone', 'iPhone 13 WebKit (low)'], ['-pixel5cpu', 'Pixel 5 4x CPU (low)']]) {
  P(); P(`### 60 s autoplay trace, ${title}: frame interval ms (p50 / p95 / p99 / max), frames >33 ms, >50 ms, long tasks, cpu ms`);
  P('| map | tier | label | p50 | p95 | p99 | max | >33 | >50 | long tasks | cpu (sim+render) | end radius |'); P('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const map of MAPS) for (const l of labels) for (const r of rd('trace', l, suffix).filter((x) => x.map === map)) P(`| ${map} | ${r.tier} | ${l} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.over33} | ${r.over50} | ${r.longTasks} | ${r.cpuMs} (${r.simMs}+${r.renderMs}) | ${r.endRadius} |`);
}
P(); P('### Memory (desktop Chromium): JS heap after load -> after 3 rounds (MB); texture MB; geometry MB (computed from the scene); renderer.info counts');
P('| map | tier | label | heap MB | tex MB | geo MB | textures / geometries | parts |'); P('|---|---|---|---|---|---|---|---|');
for (const map of MAPS) for (const tier of ['low', 'medium', 'high']) for (const l of labels) { const r = rd('mem', l).find((x) => x.map === map && x.tier === tier); if (r) P(`| ${map} | ${tier} | ${l} | ${r.heapAfterLoadMB} -> ${r.heapAfter3RoundsMB} | ${r.gpu.texMB} | ${r.gpu.geoMB} | ${r.gpu.texturesCount} / ${r.gpu.geometriesCount} | ${JSON.stringify(r.gpu.parts)} |`); }
P(); P('### What a wide view costs (desktop, high): cpu ms / Mtri / calls with one class hidden');
P('| map | view | label | all | no trees | no props | no buildings | no ground | no shadow |'); P('|---|---|---|---|---|---|---|---|---|');
for (const map of MAPS) for (const v of ['intro', 'r30', 'zoomout']) for (const l of labels) { const r = rd('breakdown', l).find((x) => x.map === map); if (!r) continue; const o = r.res[v]; const c = (x) => (x ? `${x.cpuMs} / ${(x.tris / 1e6).toFixed(2)} / ${x.calls}` : '-'); P(`| ${map} | ${v} | ${l} | ${c(o.all)} | ${c(o['no-trees'])} | ${c(o['no-props'])} | ${c(o['no-buildings'])} | ${c(o['no-ground'])} | ${c(o['no-shadow'])} |`); }
console.log(out.join('\n'));
