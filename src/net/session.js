// Online session record: lets a reloaded / evicted tab (iOS drops backgrounded tabs) rejoin the round it was in, with the same hole.
// Stored twice: sessionStorage (survives a reload of THIS tab) and localStorage (short-lived: survives iOS dropping the tab's
// sessionStorage; expires at the round's end + a margin, so a stale record can never trap anybody). No personal data beyond the
// display name the player typed; the token only works for one room that lives a few minutes.
const KEY = 'bedre.mp.session';
const TAB_KEY = 'bedre.mp.tab';
export const RESULTS_MARGIN_MS = 90000;   // room keeps the results 60 s after the end; + slack
export const OWNED_FRESH_MS = 6000;       // another tab wrote the record this recently: it is still alive

const rd = (st, k) => { try { return st.getItem(k); } catch { return null; } };
const wr = (st, k, v) => { try { if (v == null) st.removeItem(k); else st.setItem(k, v); } catch { /* private mode / quota */ } };

export function tabId() {
  let id = rd(sessionStorage, TAB_KEY);
  if (!id) { id = Math.random().toString(36).slice(2, 10); wr(sessionStorage, TAB_KEY, id); }
  return id;
}

function valid(r, now) {
  return !!r && typeof r === 'object' && typeof r.room === 'string' && /^[A-Za-z0-9]{6,24}$/.test(r.room) && typeof r.token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(r.token)
    && typeof r.exp === 'number' && r.exp > now;
}

/** The live session record (or null). Expired / malformed records are deleted. */
export function loadSession(now = Date.now()) {
  for (const st of [sessionStorage, localStorage]) {
    const raw = rd(st, KEY);
    if (!raw) continue;
    let r = null; try { r = JSON.parse(raw); } catch { /* */ }
    if (valid(r, now)) return r;
    wr(st, KEY, null);
  }
  return null;
}

export function saveSession(rec) {
  const s = JSON.stringify({ ...rec, v: 1, tab: tabId(), hb: Date.now() });
  wr(sessionStorage, KEY, s); wr(localStorage, KEY, s);
}

export function clearSession() { wr(sessionStorage, KEY, null); wr(localStorage, KEY, null); }

/** Another live tab owns this record (different tab, heartbeat fresh). */
export function ownedElsewhere(rec, now = Date.now()) { return rec.tab && rec.tab !== tabId() && now - (rec.hb || 0) < OWNED_FRESH_MS; }
