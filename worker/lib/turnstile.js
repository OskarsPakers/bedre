// Cloudflare Turnstile (OFF unless configured). Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//   POST https://challenges.cloudflare.com/turnstile/v0/siteverify  (form or JSON: secret, response, remoteip?, idempotency_key?)
//   -> { success, 'error-codes': [...], challenge_ts, hostname, ... }; a token is valid 300 s and single-use.
// Enabled only when BOTH env.TURNSTILE_SECRET (wrangler secret) and env.TURNSTILE_SITE_KEY (public var) are set.
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstileEnabled = (env) => !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);

/** Public site key for the client, or null when the feature is off. */
export const turnstileSiteKey = (env) => (turnstileEnabled(env) ? String(env.TURNSTILE_SITE_KEY) : null);

/**
 * @returns {Promise<{ok:boolean, codes:string[]}>}
 * Network / Cloudflare errors fail CLOSED (ok:false) because the owner turned the check on deliberately.
 * `env.TURNSTILE_VERIFY_URL` exists for tests only (never set it in wrangler.jsonc).
 */
export async function verifyTurnstile(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, codes: ['missing-input-response'] };
  const body = new URLSearchParams({ secret: String(env.TURNSTILE_SECRET), response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  body.set('idempotency_key', crypto.randomUUID());
  try {
    const res = await fetch(env.TURNSTILE_VERIFY_URL || SITEVERIFY, { method: 'POST', body });
    const j = await res.json();
    return { ok: !!j.success, codes: Array.isArray(j['error-codes']) ? j['error-codes'].slice(0, 5).map(String) : [] };
  } catch {
    return { ok: false, codes: ['verify-unreachable'] };
  }
}
