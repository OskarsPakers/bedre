# Turnstile status

**State: OFF on the live site** (16 November 2026).

The code supports Cloudflare Turnstile on score submission. It is active only when both
the Worker secret `TURNSTILE_SECRET` and the public var `TURNSTILE_SITE_KEY` are set.
The secret is uploaded; the site key var was removed again after the check below failed.

## What happened when it was switched on

One real quick round was played on the live site in an automated (headless) Chrome:

- `POST /api/rounds` returned the site key, so the client tried to run the widget.
- A request to `challenges.cloudflare.com` returned **HTTP 400**.
- The page logged `[Cloudflare Turnstile] Nothing to reset found for provided container.`
- No `POST /api/scores` was sent; the results screen said "not saved (offline)".

With the site key removed and redeployed, the same test saved its score normally.

## What is not known

The failure has two possible causes and the test cannot tell them apart:

1. **Widget configuration:** the widget in the Cloudflare dashboard may not list
   `bedre.pakers.lv` as an allowed hostname, or the site key may belong to another widget.
   A 400 from the challenge endpoint is typical for that.
2. **Automation:** Turnstile exists to stop automated browsers, so a headless test may be
   refused even when the widget is configured correctly.

A second, code-level issue was certain regardless of the cause: **when the widget failed,
the score was silently dropped.** **Fixed in the client (16 November 2026, `src/scores.js`):**
a widget that fails to load, errors, times out or throws now leaves the round pending
(nothing is sent unverified, the round id stays valid on the server), the results panel shows
a small "Neizdevās pārbaudīt — mēģināt vēlreiz" button, the same result is re-sent through a fresh
widget when it is pressed, and every step swallows its own exceptions (the `Nothing to reset found`
console message came from `turnstile.remove()` on a container that was already gone; it is now
only called while the container is attached, inside a try/catch). Covered by `scripts/smoke-mobile.mjs`
(group `turnstile`: blocked script, erroring widget with a throwing `remove()`, then a working widget) and,
server side, by the mocked-verify path in `scripts/smoke-api.mjs`.

## To enable it

1. In the Cloudflare dashboard, open the Turnstile widget and confirm `bedre.pakers.lv`
   is in its hostname list and the site key matches `.secrets/turnstile`.
2. ~~Fix the client so a widget error shows a retry and never drops the score silently.~~ Done (see above).
3. Add to `wrangler.jsonc`: `"vars": { "TURNSTILE_SITE_KEY": "<site key>" }` and deploy.
4. Play one round on a **real phone or desktop browser** and confirm the results screen
   shows a global rank. If it says "not saved", remove the var and redeploy.
