// Share card (1200x630 canvas, original branding only) + Web Share API (image file) with a download / copy-link fallback.
import { mt } from './strings.js';
import { drawRecapMap } from './recap.js';

const FONT = '"Avenir Next", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
export const SITE = 'https://bedre.pakers.lv';

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/** info = { name, score, rankText, sizeText, biggest, pctMe } ; rec = recap data */
export function renderCard(canvas, rec, info) {
  canvas.width = 1200; canvas.height = 630;
  const g = canvas.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 1200, 630); bg.addColorStop(0, '#3b4d60'); bg.addColorStop(1, '#1d2833');
  g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
  // faint rings around the logo hole
  g.strokeStyle = 'rgba(246,239,223,.05)'; g.lineWidth = 2;
  for (let r = 80; r < 700; r += 70) { g.beginPath(); g.arc(120, 100, r, 0, 6.2832); g.stroke(); }
  // logo
  const hole = g.createRadialGradient(94, 92, 2, 100, 100, 34); hole.addColorStop(0, '#3a2a26'); hole.addColorStop(1, '#000');
  g.beginPath(); g.arc(100, 100, 30, 0, 6.2832); g.fillStyle = hole; g.fill(); g.lineWidth = 7; g.strokeStyle = '#d9552f'; g.stroke();
  g.fillStyle = '#f6efdf'; g.font = `900 64px ${FONT}`; g.textBaseline = 'alphabetic';
  g.fillText('BEDRE', 152, 122);
  g.fillStyle = '#e8855f'; g.font = `700 22px ${FONT}`;
  g.fillText('R Ī G A', 156, 152);
  // player + score
  g.fillStyle = '#cdd7e0'; g.font = `700 34px ${FONT}`;
  let nm = info.name || ''; while (g.measureText(nm).width > 520 && nm.length > 3) nm = nm.slice(0, -2);
  g.fillText(nm + (nm !== info.name ? '…' : ''), 56, 232);
  g.fillStyle = '#9fb0c0'; g.font = `700 22px ${FONT}`; g.textAlign = 'right'; g.fillText(mt('cardScore').toUpperCase(), 600, 232); g.textAlign = 'left';
  let fs = 150; g.font = `900 ${fs}px ${FONT}`;
  while (g.measureText(String(info.score)).width > 540 && fs > 80) { fs -= 6; g.font = `900 ${fs}px ${FONT}`; }
  g.fillStyle = '#d9552f'; g.fillText(String(info.score), 52, 372);
  g.fillStyle = '#f6efdf'; g.font = `800 38px ${FONT}`; g.fillText(info.rankText, 56, 428);
  // stats
  const stat = (label, val, y) => {
    g.fillStyle = '#9fb0c0'; g.font = `700 17px ${FONT}`; g.fillText(label.toUpperCase(), 56, y);
    g.fillStyle = '#f6efdf'; g.font = `800 28px ${FONT}`;
    let v = val; while (g.measureText(v).width > 500 && v.length > 3) v = v.slice(0, -2);
    g.fillText(v + (v !== val ? '…' : ''), 56, y + 32);
  };
  stat(mt('cardBiggest'), info.biggest || '—', 472);
  g.fillStyle = '#9fb0c0'; g.font = `700 17px ${FONT}`; g.fillText(mt('cardSize').toUpperCase(), 330, 472);
  g.fillStyle = '#f6efdf'; g.font = `800 28px ${FONT}`; g.fillText(info.sizeText || '—', 330, 504);
  g.fillStyle = '#ffd9c9'; g.font = `900 40px ${FONT}`; g.fillText(`${info.pctMe}%`, 56, 566);
  const pw0 = g.measureText(`${info.pctMe}%`).width;
  g.fillStyle = '#9fb0c0'; g.font = `700 18px ${FONT}`; g.fillText(mt('cardEaten'), 56 + pw0 + 10, 566);
  g.textAlign = 'right'; g.fillStyle = '#f6efdf'; g.font = `800 26px ${FONT}`; g.fillText('bedre.pakers.lv', 1144, 604); g.textAlign = 'left';
  if (info.extra) { g.fillStyle = '#e8855f'; g.font = `800 22px ${FONT}`; g.fillText(info.extra, 56, 606); }   // streak + weekly goals, no personal data
  g.fillStyle = '#9fb0c0'; g.font = `600 15px ${FONT}`;
  // map panel
  const px = 640, py = 40, pw = 512, ph = 520;
  g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  rr(g, px, py, pw, ph, 22); g.fillStyle = '#f6efdf'; g.fill(); g.restore();
  g.save(); rr(g, px, py + ph - 8, pw, 8, 4); g.fillStyle = '#d9552f'; g.fill(); g.restore();
  const mc = document.createElement('canvas');
  drawRecapMap(mc, rec, 900);
  const inner = 14, aw = pw - inner * 2, ah = ph - inner * 2 - 8;
  const sc = Math.min(aw / mc.width, ah / mc.height), dw = mc.width * sc, dh = mc.height * sc;
  g.save(); rr(g, px + (pw - dw) / 2, py + inner + (ah - dh) / 2, dw, dh, 12); g.clip();
  g.drawImage(mc, px + (pw - dw) / 2, py + inner + (ah - dh) / 2, dw, dh); g.restore();
  g.fillStyle = '#cdd7e0'; g.font = `600 20px ${FONT}`; g.fillText(mt('cardTag'), 640, 604);
  return canvas;
}

export const toBlob = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));

export function download(blob, name = 'bedre-riga.png') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}

/** Share the card: Web Share with the image file where supported, else download the PNG. Returns 'shared' | 'downloaded' | 'cancelled'. */
export async function shareCard(canvas, text) {
  const blob = await toBlob(canvas);
  if (!blob) return 'cancelled';
  try {
    const file = new File([blob], 'bedre-riga.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: mt('shareTitle'), text: `${text} ${SITE}` });
      return 'shared';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  download(blob);
  return 'downloaded';
}

export async function copyLink(url = SITE) {
  try { await navigator.clipboard.writeText(url); return true; } catch {
    try { const i = document.createElement('input'); i.value = url; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); return true; } catch { return false; }
  }
}
