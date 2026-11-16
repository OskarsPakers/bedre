# Hosting costs and budget

Written 16 November 2026. Prices are from Cloudflare's pricing pages as read that week
(Workers and Durable Objects pages last updated 13 Nov 2026, D1 30 Oct 2026, Turnstile 14 Aug 2026).
Re-check them before relying on this: pricing changes.

**Short version:** free at current traffic; about $5 a month once the game is promoted;
budget the $5 Workers Paid plan with a spending limit of about $20 a month.

## What is free regardless of plan

- Static files (the game bundle, map data, images): free and unlimited, no bandwidth charge.
- Turnstile: free, unlimited challenges (up to 20 widgets per account).

## Usage per round

These are **estimates from reading the code, not measurements.** Measure before trusting them
(the Cloudflare dashboard shows requests, D1 rows written and Durable Object duration per day).

| | Worker requests | D1 rows written | Durable Object requests | Durable Object duration |
|---|---|---|---|---|
| Solo round | about 8 | about 40 | none | none |
| Online round, per player | 1–2 | a few | about 190 | — |
| Online round, per room | — | — | — | about 42 GB-s |

How the estimates were derived:

- **Solo:** one `POST /api/rounds`, one `POST /api/scores`, a couple of leaderboard reads, about
  three analytics beacons. Rows written include index updates: a round row, the "used" update,
  a score row with its indexes, rate-limit rows, and about a dozen daily counters.
- **Online requests:** a client sends its position about 12 times a second for 300 s, which is
  about 3,600 incoming WebSocket messages. Cloudflare bills incoming messages at 20:1, so about
  180 requests, plus the connection and lobby messages. Outgoing messages are free.
- **Online duration:** a room is billed for 128 MB while its round timer runs, about 330 s
  including the lobby countdown and fly-in: 0.128 GB × 330 s ≈ 42 GB-s per room, however many
  players are in it (up to 12). Idle lobbies use the WebSocket Hibernation API and are not billed.

## Free plan limits

| Limit per day (resets 00:00 UTC) | Allows roughly |
|---|---|
| 100,000 D1 rows written | 2,500 solo rounds |
| 100,000 Durable Object requests | 520 online player-rounds |
| 13,000 GB-s Durable Object duration | 300 online rooms |
| 100,000 Worker requests | 12,500 solo rounds |
| 5 million D1 rows read | not a constraint |

When a free limit is exceeded, that part fails until the reset: scores stop saving (D1 or Worker
limit) or online play stops working (Durable Object limits). The game still loads and plays solo,
because static files do not count.

## Workers Paid plan

$5 a month minimum for the account. Included, then overage:

| | Included per month | Overage |
|---|---|---|
| Worker requests | 10 million | $0.30 per million |
| Worker CPU | 30 million ms | $0.02 per million ms |
| Durable Object requests | 1 million | $0.15 per million |
| Durable Object duration | 400,000 GB-s | $12.50 per million GB-s (rounded up to whole millions) |
| D1 rows written | 50 million | $1.00 per million |
| D1 rows read | 25 billion | $0.001 per million |
| D1 storage | 5 GB | $0.75 per GB-month |

Estimated bills:

| Monthly traffic | Estimated bill |
|---|---|
| Up to about 5,000 online player-rounds plus 1 million solo rounds | $5 |
| 100,000 online player-rounds, about 3 humans per room | about $20 |

The $20 case: $5 base + about $2.70 for Durable Object requests (19 million, 18 million over)
+ $12.50 for duration (about 33,000 rooms × 42 GB-s ≈ 1.4 million GB-s, 1 million over).

## Recommendation

1. **Now:** stay on the free plan. Traffic is far below the limits.
2. **Before promoting online play:** move to Workers Paid.
3. **Set spending limits:** a Workers spending limit and a Durable Objects spending limit,
   together about $20 a month, plus an email alert at $10.
   - Docs: `developers.cloudflare.com/workers/platform/spend-management/` and
     `developers.cloudflare.com/durable-objects/platform/spend-management/`.
   - The Workers limit blocks new invocations once reached and can interrupt **every Worker on
     the account**, not only this game.

## Ways to cut usage if needed

- Send online position updates less often (12 Hz to 8 Hz cuts Durable Object requests by a third).
- Batch analytics into one beacon per round (fewer Worker requests and D1 writes).
- Fewer indexes on `scores` and `rounds` (each index adds a row written per insert).

## Not covered

- **Durable Objects SQLite storage billing:** the pricing page says it "will be enabled in
  January 2026" without saying whether it is now active. The game stores almost nothing there
  (room metadata and the matchmaker's room list).
- **Workers Logs:** the pricing page says logs move to Cloudflare Observability pricing from
  1 December 2026. Observability logging is enabled in `wrangler.jsonc`; check what that costs.
- **Development cost:** the AI usage spent building the game is not included.
