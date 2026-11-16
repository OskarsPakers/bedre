// Radio toggle next to the mute button: plays CFG.radio.stations through an <audio> element (not WebAudio: streams lack CORS for it).
// Starts only from a click, ducks the procedural ambient bed, pauses with the game / hidden tab, fails quietly, remembers station + volume.
import { CFG, LIFE } from '../config.js';
import { bus } from '../events.js';
import { mt } from './strings.js';
import { onLang } from '../i18n.js';

const KEY = 'bedre.radio';
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const CSS = `
#radio-pop{position:fixed;top:calc(var(--gap) + var(--btn) + 8px);left:calc(50% + 100px);z-index:41;background:rgba(246,239,223,.97);border-radius:12px;padding:8px 12px 9px;box-shadow:0 3px 12px rgba(0,0,0,.28);font-size:12px;font-weight:700;color:#2a2622;width:230px;pointer-events:auto}
#radio-pop[hidden]{display:none}
#radio-pop .rn{display:flex;justify-content:space-between;gap:8px;align-items:baseline}#radio-pop .rn b{font-size:13px}
#radio-pop a{color:#b8401f;text-decoration:underline;text-underline-offset:2px}#radio-pop .rs{color:#6b6258;font-weight:600;font-size:11px;min-height:1.2em}
#radio-pop .rrow{display:flex;gap:8px;align-items:center;margin-top:4px}
#radio-pop input[type=range]{flex:1;min-width:0;accent-color:#d9552f;height:18px;margin:0}
#radio-pop button{font:inherit;font-size:11px;font-weight:800;border:0;border-radius:8px;padding:5px 10px;background:#2b3a4a;color:#f6efdf;cursor:pointer;min-height:28px}
#radio-btn.err{opacity:.6}
body:has(#start:not(.hidden)) #radio-pop,body:has(#results:not(.hidden)) #radio-pop{top:auto;left:auto;right:var(--gap);bottom:calc(var(--gap) + var(--btn) + 8px)}
body:has(#scores:not(.hidden),#about:not(.hidden),#meta-panel:not(.hidden),#mp-lobby:not(.hidden),#pause:not(.hidden)) #radio-pop{visibility:hidden}
@media (max-width:900px),(max-height:520px){#radio-pop{top:auto;left:auto;right:calc(var(--gap) + var(--btn) + 8px);bottom:80px;width:200px}}
@media (max-height:520px){#radio-pop{bottom:12px}}
`;

export function initRadio() {
  const C = CFG.radio;
  const q = new URLSearchParams(location.search).get('radio');
  const enabled = q === '0' ? false : (q === '1' ? true : !!(C && C.enabled));
  if (!enabled || !C || !C.stations || !C.stations.length) return null;

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ station: station.id, vol })); } catch { /* ignore */ } };
  let station = C.stations.find((s) => s.id === saved.station) || C.stations[0];
  let vol = typeof saved.vol === 'number' ? Math.min(1, Math.max(0, saved.vol)) : 0.6;

  const css = document.createElement('style'); css.textContent = CSS; document.head.appendChild(css);
  const audio = new Audio(); audio.preload = 'none'; audio.volume = vol; audio.id = 'radio-audio';
  audio.style.display = 'none'; document.body.appendChild(audio);
  const btn = el('button'); btn.id = 'radio-btn'; btn.type = 'button'; btn.textContent = '📻'; btn.setAttribute('aria-pressed', 'false');
  const pop = el('div'); pop.id = 'radio-pop'; pop.hidden = true;
  const rn = el('div', 'rn'); const nameB = el('b'); const link = el('a'); link.target = '_blank'; link.rel = 'noopener noreferrer'; rn.append(nameB, link);
  const status = el('div', 'rs'); const slider = el('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.02'; slider.value = String(vol);
  const stopBtn = el('button'); stopBtn.id = 'radio-stop'; stopBtn.type = 'button';
  const rrow = el('div', 'rrow'); rrow.append(slider, stopBtn);
  pop.append(rn, status, rrow);
  (document.getElementById('hud-btns') || document.body).append(btn); document.body.append(pop);

  let on = false, hls = null, pausedByGame = false, ducked = false, errTimer = 0, popTimer = 0;
  const showPop = (v, autoHide = 0) => { pop.hidden = !v; clearTimeout(popTimer); if (v && autoHide) popTimer = setTimeout(() => { pop.hidden = true; }, autoHide); };
  const A = LIFE.audio;

  const label = () => {
    btn.title = on ? mt('radioStop') : `${mt('radioBtn')}: ${station.name}`; btn.setAttribute('aria-label', btn.title);
    nameB.textContent = station.name; link.textContent = station.linkLabel || station.link; link.href = station.link;
    slider.setAttribute('aria-label', mt('radioVol')); stopBtn.textContent = '■ ' + mt('radioStopLbl');
  };
  label(); onLang(label);

  function duck(v) { // lower the procedural ambient bed (WebAudio) while the radio plays
    const eng = window.__life && window.__life.audio;
    if (!eng || !eng.amb || !eng.ctx) return;
    try { eng.amb.gain.setTargetAtTime(v ? A.ambient * 0.12 : A.ambient, eng.ctx.currentTime, 0.25); ducked = v; } catch { /* ignore */ }
  }
  setInterval(() => { if (on && !ducked) duck(true); }, 1000);

  const setStatus = (s) => { status.textContent = s || ''; };
  function fail() {
    btn.classList.add('err'); setStatus(mt('radioErr'));
    clearTimeout(errTimer); errTimer = setTimeout(() => { if (on) stop(true); }, 4000);
  }

  // hls.js is a bundled dependency (the light build: audio HLS only), loaded with a dynamic import on the first click only where the
  // browser has no native HLS (Chrome / Firefox). It stays out of the main chunk and no third-party script is ever fetched.
  const loadHls = () => import('hls.js/dist/hls.light.mjs').then((m) => m.default || m.Hls);

  async function start() {
    on = true; pausedByGame = false; btn.classList.remove('err');
    btn.setAttribute('aria-pressed', 'true'); showPop(true, 7000); setStatus(mt('radioLoading')); label();
    audio.dataset.station = station.id; audio.dataset.src = station.url;
    try {
      const forceJs = new URLSearchParams(location.search).get('hlsjs') === '1'; // test hook: exercise the bundled hls.js path even where HLS is native
      const native = forceJs ? '' : audio.canPlayType('application/vnd.apple.mpegurl');
      if (station.type === 'hls' && !native) {
        const Hls = await loadHls();
        if (!on) return;
        if (!Hls.isSupported()) throw new Error('no MSE');
        hls = new Hls({ lowLatencyMode: false, maxBufferLength: 20 });
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) fail(); });
        hls.loadSource(station.url); hls.attachMedia(audio);
      } else audio.src = station.url;
      await audio.play();
      setStatus(mt('radioBy')); duck(true);
    } catch { if (on) fail(); }
  }
  function stop(quiet) {
    on = false; clearTimeout(errTimer);
    try { audio.pause(); } catch { /* ignore */ }
    if (hls) { try { hls.destroy(); } catch { /* ignore */ } hls = null; }
    audio.removeAttribute('src'); try { audio.load(); } catch { /* ignore */ }
    btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('err'); showPop(false); setStatus(''); label(); duck(false);
    if (!quiet) persist();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); btn.blur(); if (!on) { start(); persist(); } else showPop(pop.hidden, 7000); }); // playing: the button toggles the station card; stopping is its Stop button
  stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stop(); });
  slider.addEventListener('input', () => { vol = +slider.value; audio.volume = vol; persist(); showPop(true, 7000); });
  audio.addEventListener('error', () => { if (on && audio.error) fail(); });
  audio.addEventListener('playing', () => { btn.classList.remove('err'); clearTimeout(errTimer); setStatus(mt('radioBy')); });

  bus.on('pause', () => { if (on && !audio.paused) { audio.pause(); pausedByGame = true; } });
  bus.on('resume', () => { if (on && pausedByGame) { pausedByGame = false; audio.play().catch(() => fail()); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && on && !audio.paused) { audio.pause(); pausedByGame = true; } });

  const api = { audio, btn, pop, get on() { return on; }, station: () => station };
  window.__radio = api;
  return api;
}
