# Play-test: phones (real WebKit + Android profile) and online multiplayer

Tester: QA2. Build under test: production `vite build` into `scripts/.dist-qa2`, served by a local `wrangler dev` (port 8802, state `scripts/.qa2-state`, no public data touched). Full-length server (20 s lobby, 5:00 round) for the two full online rounds; a short-round server (4 s lobby, 70 s round) for the edge-case scripts. Live site: only page loads, lobby join then leave (3 engines).
My scripts: `scripts/qa2/` (`lib.mjs`, `round.mjs`, `online.mjs`, `edge.mjs`, `edge2.mjs`, `misc.mjs`, `live.mjs`, `montage.mjs`, `server.mjs`). Evidence: `scripts/out/qa2-*.png` (344 files) plus contact sheets `scripts/out/m1..m11.png`.

## Honest coverage numbers (read first)

- Phone solo rounds played to the end: **5** (wk = real WebKit, px = Chromium Pixel 5 profile):
  1. iPhone 13 WebKit, Quick 2:00, Centrs, thumb joystick, rotated to landscape and back mid-round
  2. Pixel 5, Quick, Agenskalns, joystick, rotated mid-round
  3. iPhone SE WebKit, Quick, Mezaparks, finger-follow, rotated mid-round
  4. iPhone 14 Pro Max WebKit, Quick, Purvciems, joystick, rotated mid-round
  5. iPhone 13 WebKit, Classic 5:00, Mezaparks, finger-follow, rotated mid-round
  No page reload / crash on any of them (`nav` 1, `crash` 0, no console/page errors).
- Online: **2 full 5:00 rounds with 5 simultaneous clients** (Chromium desktop, WebKit iPhone 13, Firefox desktop, Chromium Pixel 5, WebKit iPhone SE) plus one 70 s round with 2 clients (one with 350 ms each way injected) and several short-server edge runs. That is 3 completed rounds, not the 4 requested.
- Screenshots: 344 PNGs taken. **I actually looked at about 55 of them** (single views plus montage sheets of up to 6). The 150-viewed target was NOT met; unviewed frames were only used through the numeric state logs.
- Phone input: WebKit touch = real `page.touchscreen.tap` for taps, synthesised `PointerEvent` sequences (pointerType touch) for joystick/pinch (no multi-touch API); Chromium = CDP `Input.dispatchTouchEvent`. Desktop clients steered with real `mouse.move`. Hooks were only read (`__game`, `__life`, `__online`), plus `__online.drop()` / `__online.leave()` and `__game.skipIntro()` for setup in the edge scripts (noted where used). The first probe used `skipIntro()` only to save time.
- The headless WebKit here is not a real iPhone GPU: frame-time numbers (some 0.5-2 s hitches) are indicative only, I did not record them as bugs.

## Status after the fix pass (fix2)

Automated evidence: `scripts/smoke-resume.mjs` (reload / app switch / two tabs / outages / 12 clients / duel, real WebKit + Chromium, local `wrangler dev` behind a TCP proxy that really cuts the network), `scripts/smoke-layout.mjs` (generic overlap audit on 12 viewports x LV/EN x menu / panels / play / results), `scripts/smoke-fix2.mjs`, `scripts/test-mp-sim.mjs`, `scripts/smoke-api.mjs`, `scripts/spawn-check-online.mjs`. Screenshots `scripts/out/fix2-*.png` (before = the `qa2-*` files named under each bug).

| id | status | what changed |
| --- | --- | --- |
| QA2-01 reload orphans the hole | **fixed** | session record (sessionStorage + short-lived localStorage), "Atgriezties kārtā" prompt with 3 s auto-rejoin, same hole + score via the resume path, Online with a live record rejoins, results after a round that ended while away, other-tab / stale-token / version cases, grace 15 s -> 45 s, dead-socket detection (5 s), absent players ranked with their score (see README 5.5) |
| QA2-02 SE results squeezed | **fixed** | compact one-line head, tabs on one line (badge as a corner dot), >= 5 rows with internal scroll, Play again always visible; round buttons hidden on that panel |
| QA2-03 Advanced pill wraps | **fixed** | one line + ellipsis; when the list does not fit it shows a count ("3 izmaiņas") and, on the narrowest width, just the number (full list = tooltip / aria-label) |
| QA2-04 mute button over the start panel | **fixed** | generic `hud-guard`: any round button / ping badge that would touch an open panel is hidden while it does; audit check on every viewport |
| QA2-05 ping badge over results text | **fixed** | the badge is not shown while start / lobby / results / any panel is open |
| QA2-06 name tag over rank chip / timer | **fixed** | tags are layered below the HUD (z-index) and fade out while their box overlaps a HUD card / button / banner (`hud.updateTags`) |
| QA2-07 About links 15-19 px | **fixed** | inline links get a >= 44 px hit area (vertical padding on the inline box), `.link` buttons >= 44 x 44, audit "target" check in every panel on touch layouts |
| QA2-08 achievement toast over the hole | **fixed** | landscape: toasts live in the left lane beside the minimap chip (right lane on desktop-compact), feed right of centre; audit "toast" check against the hole position |
| QA2-09 `<>&"` stripped silently | **fixed** | one policy for client + scores API + multiplayer (`cleanName` in `worker/lib/moderation.js`): only `<` `>` and control / zero-width / bidi characters are removed (names also reach logs / CSV / admin tools), `& " ' \` are kept; the name field shows "Tiks rādīts kā: ..." live and normalises on blur; API tests extended |
| QA2-S1 minimap pale (Agenskalns, Purvciems) | **not a bug** | full-resolution render of all four maps (`scripts/out/mini-*.png`) shows a normal basemap; the phone minimap is a 52 px circular crop of the map centre, and those two districts have little water / parkland there, so it reads beige |
| QA2-S2 pinch range differs by engine | **not a bug** | clamp (`CFG.camera.zoomMin/Max`) and pinch maths are engine-independent JS; the tester's numbers are camera distances reached with a synthetic gesture sequence; `smoke:mobile` checks the pinch limits at three hole sizes on WebKit iPhone 13 / SE and Chromium Pixel 5 |
| QA2-S3 score spread between identical drivers | **real (spawn fairness), fixed** | the old "densest first" start points gave a richest / poorest food ratio of 2.4x (2 humans) to 4.7x (12 humans); `RoomSim.pickHumanSpawns` picks equally rich, spread-out points (<= 1.08x up to 5 humans, 2.3x with 12 on the current map). The rest of the spread is play skill / software rendering |

Gaps from "Could not test": offline toggling (now tested for real, see below), full room of 12 (done: 10 protocol bots + 2 browsers, identical 12-row ranking), hole-vs-hole kill between humans (two protocol-bot humans, identical kill + respawn events), mover claimed by two clients (first claim wins, second gets `b:[id]`, no ghost in the browser), notch layouts online (iPhone 13 `?inset=47,0,34,0`, portrait + landscape), service-worker update with a stored session (`smoke-engines` stale stage). Still NOT testable here: a real iPhone keyboard / real Safari tab eviction / real `orientationchange` (Playwright WebKit can only resize the viewport; the tests also dispatch a synthetic `orientationchange`) / wake lock / haptics / thermal behaviour.

What the real network cut revealed (TCP proxy: `cut` = RST, `stall` = dead network without FIN): (1) the old client noticed a stalled socket only when TCP gave up (minutes) - now a 1 Hz watchdog drops a socket that was silent for 5 s; (2) the old reconnect window (14 s) was shorter than any useful outage and the server removed the hole after 15 s - now 42 s client / 45 s server grace; (3) a socket that goes silent on the server side (frozen / evicted tab) never started the grace period - now 10 s of silence does; (4) after a stall longer than the silence limit the old socket's flushed bytes could arrive after the new hello: the session-token takeover closes the old socket (`4001`) and ignores its late close, verified.

## Ranked bug list

### Confirmed

**QA2-01 — Reloading the page mid-round abandons the hole; Online then drops you into a new lobby (S2)**
- Frequency: 3/3 (WebKit iPhone 13 in `edge.mjs`; Chromium Pixel 5 in both full rounds). Engines: WebKit iPhone 13, Chromium Pixel 5; portrait.
- Steps: join online with another client, round starts, reload the page (iOS does this itself when a backgrounded tab is evicted) -> start screen -> tap Online.
- Expected: the server supports resuming with the session token (`worker/mp/room.js`: "a round is running: only the same player (token) may come back", token kept in `sessionStorage`), so the player should be put back into the running round, or at least be told it is still running.
- Actual: after reload `__online.state` = `idle`; tapping Online goes to a different room in "Next round starts in N s" with the running-round panel (room `qw7bj48bp7` vs original `kze2f98zfc`). The old hole idles then is removed; on the full round the Pixel player (score 5397 at the time) is missing from the final ranking on all other clients (7 rows instead of 8). Resume only works for socket drops (`__online.drop()` resumed fine: same hole, score kept).
- Evidence: `qa2-wk13-s1-afterreload.png`, `qa2-wk13-s1-afterOnline.png`, `.qa2-on1.log` (D "idle" from T+197), `.qa2-on2.log`.
- Cause/area: `src/net/online.js` has no resume-on-load path; matchmaker (`/api/mp/join`) does not route a token with a live hole back to its room.

**QA2-02 — iPhone SE portrait: results leaderboard is squeezed to about one visible row (S2)**
- Frequency: always on 320x568 (solo Quick LV, finished round, and online results EN). Engine: WebKit iPhone SE. Not seen on 390x664 and larger.
- Steps: finish any round on iPhone SE portrait.
- Actual: the Result tab shows the table cut after ~1.3 rows between the tabs and the orange "Play again" button; the tab row also wraps ("Sasniegumi 7" drops to a second line in LV). Player cannot see their rank list without finding the inner scroll. In the online results on SE only 2 of 7 rows are visible.
- Evidence: `qa2-wkse-quick-mezaparks-finger-results.png`, `qa2-wkse-quick-mezaparks-finger-res-ach.png`, `qa2-E-se-on1-end.png`.
- Cause: panel height budget (fixed buttons block + share row) leaves too little for the scroll pane at 568 px.

**QA2-03 — Start screen "Advanced" summary pill wraps into three squashed lines (S3)**
- Frequency: always in LV on iPhone SE (portrait and landscape). In landscape the pill is also clipped ("Ātrā / · / Zem").
- Evidence: `qa2-wkse-m-se-port-start.png`, `qa2-wkse-L-m-se-land-start.png`.
- Cause: `#opts-val` chip has no `white-space: nowrap` / shrinking at 320 px with the long LV caption.

**QA2-04 — Round mute button floats over the start panel in landscape and covers content (S3)**
- iPhone SE landscape (568x320, LV): the speaker button sits over the bottom-right of the panel, on top of the "Add to Home Screen" hint's dismiss button and the lower controls; the hint text is also cut by the panel edge.
- Evidence: `qa2-wkse-L-m-se-land-start.png`.

**QA2-05 — Ping badge ("2 ms") overlaps the results panel text on iPhone SE (S3)**
- Online results on SE: the badge sits at the panel's left edge and hides the first letters of "Result saved to the online leaderboard." (reads "ult saved ..."). Same badge touches the panel edge on iPhone 13.
- Evidence: `qa2-E-se-on1-end.png`, `qa2-B-wk13-on1-end.png`. (Badge size on its own is sane: 81x24 px at 704 ms.)

**QA2-06 — A leader's floating name tag is drawn over the HUD rank chip and timer (S3)**
- iPhone SE portrait, online: when the leading hole is near the top of the screen its name tag ("Cēsu Jānis") overlaps the leaderboard chip (hides "6. . 2,870") and the timer.
- Evidence: `qa2-E-se-on1-t205.png`. World tags render above the HUD cards.

**QA2-07 — Small tap targets in the About panel and footer links (S3)**
- All phone profiles: links Hole.io, georiga.eu, OpenStreetMap, LĢIA, CC BY 4.0, lr2.lsm.lv are 15-19 px tall (rule: >= 44). Start-screen OpenStreetMap link is 15 px on SE portrait.
- Evidence: `misc.mjs` output (`small#about`), `qa2-wkse-m-se-port-about.png`.

**QA2-08 — "Achievement" toast is centred on top of the hole in landscape (S3)**
- iPhone SE landscape and iPhone 14 Pro Max landscape: "Sasniegums: ..." / "Achievement: ..." toast sits over the hole's position for ~3 s, hiding the thing you are steering (portrait is fine).
- Evidence: `qa2-wkse-quick-mezaparks-finger-rot-land.png`, `qa2-wk13-quick-centrs-stick-rot-land.png`, `qa2-wkpm-quick-purvciems-stick-p6.png`.

**QA2-09 — Name characters `< > & "` are silently removed (S3)**
- Typed `<b>Ann</b>&"x`, other players saw `bAnn/bx` (also in the player's own results row). Safe, but the player is not told; lookalike confusion possible. Emoji (😀), diacritics and a 40-char paste (cut to 14 by `maxlength`) all joined fine. A name of three spaces was accepted by the lobby (displayed name not checked).
- Evidence: `qa2-A-chr-on1-lobby.png`.

### Suspected (seen once or not isolated)

- **QA2-S1 Minimap looks blank/pale on Agenskalns and Purvciems on phones** (Pixel 5, Pro Max frames) while Centrs/Mezaparks minimaps show a basemap. Seen in `qa2-px5-quick-agenskalns-stick-p12.png`, `qa2-wkpm-quick-purvciems-stick-rot-land.png`. Not verified at full res.
- **QA2-S2 Pinch limits differ by engine.** Same synthetic gesture sequence (6 large pinch-outs / pinch-ins) ends at camera `zoom` 49-58 on WebKit but 29-127 on Pixel Chromium. My WebKit events are dispatched through `page.evaluate`, so this may be my harness; cap behaviour on a real phone unknown.
- **QA2-S3 Large score spread between identical drivers in one room.** Round 2: Firefox 55.8k vs 2.8-3.0k for the other four clients using the same steering logic; round 1 was 57k/46k/36k/4.7k. iPhone SE client was lowest in both (could be slow software rendering or spawn). Possible uneven start-area richness; not isolated.

### Feel / balance observations

- Humans are far ahead of server bots: online round 1: humans 36-57k, best bot 9.5k; round 2: best bots 19-21k vs the human leader 55.8k. A simple "nearest edible" driver took 1st of 8 on Centrs solo (25k vs 11k) but 8th of 8 on Agenskalns (2.0k) and 5th on Mezaparks, so map richness varies a lot.
- 700 ms RTT (350 ms injected each way, Chromium) is fully playable: 0 rubber-bands, 0 rejected claims over 56 s, optimistic pending score stays <= 20; the lagging client even outscored the fast one (843 vs 634). Nothing unfair noticed.
- Joystick base is large on SE; thumb sits well below the hole, hole never covered. Second finger landing during a drag moved the hole 1.0-1.1 m total (no jump).

### Worked fine

- Real-WebKit boot on iPhone SE / 13 / 14 Pro Max, Pixel 5: no console errors, failed requests or page crashes in 5 solo rounds + 3 online (ERRS empty except my own latency-shim artefacts).
- Start, results tabs (Result/Map/Progress), top scores, about, advanced, online lobby all fit in both orientations, no horizontal page scroll, no page zoom or scroll during play (`scrollY` 0, `visualViewport.scale` 1 after pinch).
- Touch targets >= 44 px on the start screen controls and results tabs (all profiles).
- Rotation mid-round (portrait->landscape->portrait) on WebKit and Android (CDP metrics override): HUD re-laid out, play continued, score kept. Note: WebKit rotation was `setViewportSize`, not a real orientationchange.
- Visibility-hidden (spoofed event) pauses and shows the Pause panel; timer frozen; on show the panel waits for Resume.
- Online: 5 clients on 3 engines in one room, countdown text agreed, serverNow differs < 40 ms between clients; start sizes equal (2.2) and score 0; all clients ended with identical ranking and "saved: true" in both full rounds; 8 holes with bots tagged "AI"; bot count shrinks to 3 with 4 humans, ranking shows 7 holes after one human left.
- `drop()` (real socket close) -> "reconnecting" -> same hole, score and eaten set resumed on Pixel; late joiner goes to a separate next lobby with the running round's time left and bot leaderboard; two tabs in one browser context got separate rooms/slots; everyone leaving the lobby leaves an empty open lobby; last humans leaving mid-round: room reported with humans for ~2.5 s, gone within 17 s.
- Live site (bedre.pakers.lv): lobby handshake works on WebKit iPhone 13, Firefox and Pixel 5 (joined, "Round starts in 17-18 s", left via `__online.leave()` before the countdown ended).
- Looking at gameplay screenshots: low quality tier looked acceptable (buildings, trees, roads; no blank boxes seen in viewed frames).

### Could not test (needs a physical phone or more time)

- Real iOS keyboard for the name field (viewport shrink), safe-area with a real notch (`?inset=` not exercised by me), real rotation events, wake lock, audio resume after background, real Safari tab eviction, haptics, real GPU performance and thermal behaviour, PWA install / service-worker update toast after a rebuild, home-indicator overlap.
- Offline toggling: `context.setOffline` did not close the already-open WebSocket on WebKit/Chromium/Firefox in my runs (no reconnect triggered, `rb`=0), so 3/12/20 s outage results are INVALID; only the `drop()` hook and reload cases are real.
- Latency via real network throttling, full room of 12 humans, hole-vs-hole kills between humans, movers (cars/trams) being eaten by two players, building collapse sync, themes/qualities per client, mixed-language lobby (only LV for Firefox, EN for the rest was observed), daily mode, the full list of per-map phone rounds (3 of 4 maps used, never as 2nd online map since online is Centrs only).
