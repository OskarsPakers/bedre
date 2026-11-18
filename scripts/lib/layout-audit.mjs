// Generic layout audit, evaluated inside the page (Playwright page.evaluate(auditLayout, {touch})). Returns a list of violations:
//   * hud-vs-panel : a HUD control (round buttons, ping badge, End button) overlaps an interactive element / text block of an open panel
//   * label-vs-hud : a world-space name tag that is visible overlaps a HUD card (score, time, leaderboard, minimap, size bar, % chip, kill feed)
//   * target       : (touch layouts) an interactive element of an open panel is smaller than 44 px in height (links: height only) or width
//   * panel        : an open panel's card leaves the viewport / overflows horizontally
//   * toast        : a toast / banner sits over the hole or a joystick zone (only while playing)
//   * results      : results table shows < 5 rows on a small phone, tabs wrap, Play again not visible
// Nothing in here is specific to an object id / count.
export function auditLayout(opts) {
  const touch = !!opts.touch;
  const out = [];
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
      if (e.hidden) return false;
    }
    return true;
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const hit = (a, b, pad = 0) => a.l < b.r - pad && a.r > b.l + pad && a.t < b.b - pad && a.b > b.t + pad;
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')) + (el.textContent ? `"${el.textContent.trim().slice(0, 18)}"` : '');
  const panels = [...document.querySelectorAll('.panel:not(.hidden)')].filter((p) => vis(p) && !p.closest('#loading'));
  const vw = innerWidth, vh = innerHeight;

  // --- HUD controls vs the open panels' interactive elements + text
  const hudCtl = [...document.querySelectorAll('#hud-btns > button, #mp-net, #end-free, #pause-btn, #install-hint-fab')].filter(vis);
  for (const p of panels) {
    const inner = p.querySelector('.panel-inner') || p;
    const items = [...inner.querySelectorAll('button, a[href], input, select, summary, [role=button], [role=tab], p, h1, h2, .sub, .how, td, th')].filter(vis);
    for (const c of hudCtl) {
      const cr = rect(c);
      // scrolled-out content of the panel's own scroller is clipped, only count what is really on screen
      for (const it of items) {
        const ir = rect(it);
        let clipped = false;
        for (let e = it.parentElement; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (/(auto|scroll|hidden)/.test(cs.overflowY)) { const er = rect(e); if (ir.b <= er.t || ir.t >= er.b) { clipped = true; break; } } }
        if (clipped) continue;
        if (hit(cr, ir, 1)) out.push({ kind: 'hud-vs-panel', msg: `${name(c)} over ${name(it)} in ${name(p)}` });
      }
    }
    const pr = rect(inner);
    if (pr.l < -0.5 || pr.r > vw + 0.5 || pr.t < -0.5 || pr.b > vh + 0.5) out.push({ kind: 'panel', msg: `${name(p)} card outside the viewport ${JSON.stringify([pr.l, pr.t, pr.r, pr.b].map(Math.round))} in ${vw}x${vh}` });
    if (inner.scrollWidth > inner.clientWidth + 1 && getComputedStyle(inner).overflowX !== 'auto') out.push({ kind: 'panel', msg: `${name(p)} overflows horizontally (${inner.scrollWidth} > ${inner.clientWidth})` });
    if (touch) {
      for (const it of [...inner.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, [role=button], [role=tab]')].filter(vis)) {
        const r = rect(it);
        let clipped = false;
        for (let e = it.parentElement; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) { const er = rect(e); if (r.b <= er.t || r.t >= er.b) { clipped = true; break; } } }
        if (clipped) continue;
        const tiny = r.h < 43.5 || (it.tagName !== 'A' && r.w < 43.5);
        if (tiny) out.push({ kind: 'target', msg: `${name(it)} is ${Math.round(r.w)}x${Math.round(r.h)} in ${name(p)}` });
      }
    }
  }
  // the ping badge never sits on a results / lobby panel's text
  // --- world-space labels vs HUD cards
  const cards = [...document.querySelectorAll('#hud .card, #meta-pct, #meta-area, #feed > *, #swallowed:not(.hidden), #hud-btns > button, #mp-net, #end-free')].filter(vis);
  const hudOn = vis(document.getElementById('hud'));
  if (hudOn) {
    for (const tg of document.querySelectorAll('#tags .tag')) {
      if (!vis(tg)) continue;
      const tr = rect(tg);
      for (const c of cards) if (hit(tr, rect(c), 1)) out.push({ kind: 'label-vs-hud', msg: `tag ${name(tg)} over ${name(c)}` });
    }
  }
  // --- HUD pieces vs each other + text overflowing its own pill
  if (hudOn && !panels.length) {
    const parts = [...document.querySelectorAll('#card-score, #card-time, #board, #minimap-box, #sizebox, #meta-pct, #feed > *, #hud-btns > button, #end-free, #mp-net, #swallowed:not(.hidden), #fx-hud .combo-chip, #fx-hud .fx-badges, #fx-hud .fx-toast')].filter(vis);   // (+ the combo chip / power-up badges / pickup toast that float above the hole)
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
      if (hit(rect(parts[i]), rect(parts[j]), 1)) out.push({ kind: 'hud-vs-hud', msg: `${name(parts[i])} overlaps ${name(parts[j])}` });
    }
    for (const el of document.querySelectorAll('#meta-pct, #card-score, #card-time, #sizebox, #board')) {
      if (!vis(el)) continue;
      for (const ch of [...el.querySelectorAll('.pl, .pl > span, .big, .subline, .size-row')].filter(vis)) { const cr = rect(ch), er = rect(el); if (cr.r > er.r + 0.5 || cr.l < er.l - 0.5) { out.push({ kind: 'overflow', msg: `${name(ch)} sticks out of ${name(el)} (${Math.round(cr.r - er.r)} px)` }); break; } }
    }
  }
  // --- toasts vs hole + joystick
  const g = window.__life && window.__life.game;
  if (g && g.phase === 'playing') {
    g._v.set(g.player.x, 0, g.player.z).project(g.cam.camera);
    const hx = (g._v.x * 0.5 + 0.5) * vw, hy = (-g._v.y * 0.5 + 0.5) * vh, hr = Math.max(28, 0.5 * Math.min(vw, vh) * 0.12);
    const hole = { l: hx - hr, r: hx + hr, t: hy - hr, b: hy + hr };
    for (const el of document.querySelectorAll('#meta-toasts > *, #meta-area, .lab, #daily-intro')) {   // (the combo chip is checked separately below: it must not cover the hole either)
      if (!vis(el)) continue;
      if (hit(rect(el), hole, 0)) out.push({ kind: 'toast', msg: `${name(el)} over the hole at ${Math.round(hx)},${Math.round(hy)}` });
    }
  }
  // --- the combo chip / badges / toast never sit on the player's hole or on the banner lanes (toasts, area banner, daily intro)
  if (g && g.phase === 'playing') {
    const fx = [...document.querySelectorAll('#fx-hud .combo-chip, #fx-hud .fx-badges, #fx-hud .fx-toast')].filter(vis);
    if (fx.length) {
      g._v.set(g.player.x, 0, g.player.z).project(g.cam.camera);
      const q = g._v.clone(); q.set(g.player.x + g.player.radius, 0, g.player.z).project(g.cam.camera);
      const hx = (g._v.x * 0.5 + 0.5) * vw, hy = (-g._v.y * 0.5 + 0.5) * vh, hr = Math.abs((q.x - g._v.x) * 0.5 * vw) * 0.8;
      const hole = { l: hx - hr, r: hx + hr, t: hy - hr, b: hy + hr };
      for (const el of fx) {
        if (hit(rect(el), hole, 2)) out.push({ kind: 'fx-vs-hole', msg: `${name(el)} over the hole` });
        for (const lane of document.querySelectorAll('#meta-toasts > *, #meta-area, .lab, #daily-intro')) if (vis(lane) && hit(rect(el), rect(lane), 1)) out.push({ kind: 'fx-vs-lane', msg: `${name(el)} over ${name(lane)}` });
      }
    }
  }
  // --- results panel on small phones
  const res = document.getElementById('results');
  if (res && vis(res)) {
    const again = document.getElementById('again');
    if (!vis(again) || rect(again).b > vh + 0.5) out.push({ kind: 'results', msg: 'Play again not fully visible' });
    const tabs = [...res.querySelectorAll('[role=tab], .tabs button')].filter(vis);
    if (tabs.length > 1) { const tops = new Set(tabs.map((b) => Math.round(rect(b).t))); if (tops.size > 1) out.push({ kind: 'results', msg: 'tab row wraps to a second line' }); }
    const tbl = res.querySelector('#r-table');
    if (tbl && vis(tbl) && Math.min(vw, vh) < 700 && vh >= vw) {
      let sc = tbl.parentElement; while (sc && sc !== res && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      const area = sc && sc !== res ? rect(sc) : rect(tbl);
      const rows = [...tbl.querySelectorAll('tr')].filter((tr) => { const r = rect(tr); return r.h > 4 && r.t >= area.t - 1 && r.b <= area.b + 1; });
      if (rows.length < Math.min(5, tbl.querySelectorAll('tr').length)) out.push({ kind: 'results', msg: `only ${rows.length} table rows visible (area ${Math.round(area.h)} px)` });
    }
  }
  return out;
}
