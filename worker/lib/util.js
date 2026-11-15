// Small shared helpers for the Worker. No dependencies.
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
export const err = (status, message, extra = {}) => json({ error: message, ...extra }, status);

export const now = () => Math.floor(Date.now() / 1000);

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Salt is a constant: it only avoids storing raw IPs. Anyone with the source could brute-force the IPv4 space
// against a leaked hash, so this is pseudonymisation, not anonymisation. Hashes include the UTC date, and the
// rows that hold them are cleared after a couple of days (see db.js purgeStale).
const IP_SALT = 'bedre-riga-v1';

/** Salted hash of (client IP + UTC date). Never store or log the IP itself. */
export async function ipHashOf(request, t = now()) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  return sha256Hex(`${IP_SALT}|${ip}|${day}`);
}

export async function readJson(request, { maxBytes = 8192, anyType = false } = {}) {
  const ct = request.headers.get('content-type') || '';
  // sendBeacon(text/plain) is accepted for the analytics endpoint only (anyType)
  if (!ct.toLowerCase().includes('application/json') && !(anyType && ct.toLowerCase().includes('text/plain'))) {
    return { error: err(415, 'content-type must be application/json') };
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: err(413, 'body too large') };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return { error: err(413, 'body too large') };
  try {
    const v = JSON.parse(new TextDecoder().decode(buf));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: err(400, 'expected JSON object') };
    return { body: v };
  } catch {
    return { error: err(400, 'invalid JSON') };
  }
}

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const intIn = (v, min, max) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Fixed-window counter in D1 (key should already contain a hash, never a raw IP). Returns true while within `limit`. */
export async function rateHit(env, key, limit, ttlSec) {
  const t = now();
  await env.DB.prepare(
    'INSERT INTO rate_limits (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET ' +
    'n = CASE WHEN exp <= ?3 THEN 1 ELSE n + 1 END, exp = CASE WHEN exp <= ?3 THEN excluded.exp ELSE exp END',
  ).bind(key, t + ttlSec, t).run();
  const row = await env.DB.prepare('SELECT n FROM rate_limits WHERE k = ?').bind(key).first();
  return !row || row.n <= limit;
}
