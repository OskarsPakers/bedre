# BEDRE — Rīga: desktop solo play-test (QA1)

Tester scope: desktop Chromium (1280x720, 1920x1080, plus resizes 640x360 to 2560x800), one pass each in Firefox and WebKit, solo only, all four maps / modes / difficulties / themes, LV + EN.
Build under test: production build of the repo as found (scripts/.dist-qa1), served by a local `wrangler dev` (port 8801, state dir scripts/.qa1-state, local D1). Nothing was submitted to the public leaderboard. On the live site (https://bedre.pakers.lv) I only loaded the page, opened Top scores / About, and rode ~10 s of Brīvā pastaiga; the only non-GET traffic was the analytics beacon `POST /api/e`.

Method: Playwright with real mouse / keyboard / wheel / clicks only. `window.__game` / `window.__life` were used only to READ state (hole position, scores, bot list, renderer.info, world objects) and to aim the mouse. Hooks that change a round were used in exactly two places, both after a suspicion existed, and both are marked below: `scripts/qa1/spot.mjs` (teleport to look at coordinates) and `mem1.mjs` (`?time=14` to make 10 rounds in one page for a leak check, unranked by design).
Scripts are in `scripts/qa1/`, screenshots in `scripts/out/qa1-*.png` (about 480 files), event log in `scripts/qa1/events.log`.

## Coverage summary
- Complete rounds, start screen to results to "Play again" (state read after the restart): 
  1. Klasika 5:00, Centrs, Grūti, evening, EN, 1280x720 (r1)
  2. Ātrā 2:00, Āgenskalns, Vidēji, winter, LV (r2)
  3. Ātrā, Purvciems, Grūti, 18 Nov, LV, 1920x1080 (r3)
  4. Ātrā, Centrs, Grūti, day, EN, idle-ish player (r4)
  5. Dienas izaicinājums 5:00, Centrs, auto theme (= 18 Nov today), LV (r5)
  6. Klasika 5:00, Mežaparks, Vidēji, day, EN, 1920x1080 (r6)
  7. Firefox: Ātrā, Centrs, Vidēji, day, EN (ff1)
  8. WebKit: Ātrā, Centrs, Vidēji, day, LV (wk1)
  9. Four more full 2:00 Ātrā rounds, one per map, Grūti, used for a bot-behaviour audit (bots1; results screen not read)
  10. Hunt script: 150 s of a Klasika round on Centrs/Grūti deliberately getting swallowed twice (partial round).
  Plus: 10 consecutive 14 s rounds in one page (leak check), 16 free-roam sessions (4 maps x 4 themes, 25 s each), several dozen partial explorations.
- Screenshots looked at: about 190 frames (roughly 25 full-size, the rest in 3x3 contact sheets at 640x360 each, plus 2 enlarged crops). I did not view each of the ~480 PNGs.
- Browsers: Chromium (GPU/Metal, not SwiftShader), Firefox, WebKit, desktop profiles.
- Maps x themes: all 16 combinations seen in free roam; Ātrā/Klasika rounds on all four maps; day, evening, winter, 18 Nov all seen mid-round.
- Panels: start screen (LV/EN, Advanced open/closed, scroll, Tab order), Top scores (all 4 mode tabs, all 4 district tabs, all period tabs, local data), About, My progress (objects + achievements), pause overlay, results (Result / Map / Progress tabs), radio popup, mute button.
- Not tested / limits: real alt-tab (headless Chromium never flips `document.hidden`; I simulated the event and a CDP lifecycle freeze, see "worked fine"), real audio output (checked state only), real radio stream (request aborted at test end only), Firefox/WebKit GPU behaviour (headless, probably software GL, so their frame times are not comparable), multiplayer and phones (out of scope), WebKit at 1920x1080, browser zoom (emulated via smaller CSS viewport + devicePixelRatio, not real browser zoom).

## Status after the fix pass (fix2)

Checks: `scripts/smoke-fix2.mjs` (QA1-02..08 + suspected), `scripts/smoke-layout.mjs` (adds 1280x720, 1024x600, 853x480, 640x360 to the generic overlap audit: HUD vs HUD, label vs HUD, HUD button vs open panel, text overflowing its pill). Screenshots `scripts/out/fix2-qa1-*.png`.

| id | status | what changed |
| --- | --- | --- |
| QA1-01 edge-pinned tags over the score card | **fixed** | `#tags` below `#hud` in z-order, and a tag whose box overlaps a HUD card / button / banner fades out while it does (`Hud.updateTags`) |
| QA1-02 share pill overflows its background | **fixed** | pill sizes to its text on wide layouts (`min-width 168 px`, nowrap); audit "overflow" check |
| QA1-03 <= 900 px: pill over score card, mute/radio over the start card | **fixed** | compact layout: pill and feed moved under the (taller) score card; `hud-guard` hides round buttons that would touch an open panel; 1024x600 / 853x480 / 640x360 in the audit |
| QA1-04 kill feed over the score card | **fixed** | feed lane starts below the score card (wide + compact) |
| QA1-05 stale % at the fly-in | **fixed** | the round state behind the HUD % widgets is reset on `introStart` (not only `roundStart`) |
| QA1-06 "King of the Pit" / "Safe and Sound" in free roam | **fixed** | rule (written in `src/meta/progress.js`): collection / swallow / size achievements count in every mode (free roam, daily practice, online); placement, survival and the "rounds played" counter need a real round = opponents on the map, not free roam, and >= min(60 s, half the round) played. Online rounds now count (they were blocked as "unranked") |
| QA1-07 no copy / share feedback | **fixed** | the button itself shows "✓ Saite nokopēta" / "✓ Attēls lejupielādēts" for 2 s (the toast lane is hidden while results are up) |
| QA1-08 copy link is the bare URL | **fixed** | `https://bedre.pakers.lv/?map=<slug>&mode=<id>` (never the name) |
| QA1-S1 18 Nov caption | **fixed** | 11-17 Nov "Lāčplēša dienas un valsts svētku nedēļa" / "Lāčplēša Day and national holiday week", 18 Nov "Latvijas Republikas proklamēšanas diena" / "Proclamation Day of the Republic of Latvia" |
| QA1-S2 WebKit preload warnings | **fixed** | no `<link rel=preload>` on WebKit (it never matched them with the later `fetch()`); the published byte sizes for the progress bar are unchanged |
| QA1-S3 `navigator.vibrate` console error | **fixed** | `buzz()` only on touch devices and only after the user has interacted (`navigator.userActivation`) |
| QA1-S4 name saved only at round start | **fixed** | saved on input and blur (also shows how the name will appear, see QA2-09) |

## Counts by severity
Confirmed: S1 0 · S2 1 · S3 8. Suspected: 4 (all S3). No crashes, no page errors, no failed requests in play (the only console messages are listed below).

## Confirmed bugs (reproduced at least twice or with hard evidence)

### QA1-01 (S2) Bot name tags pinned to the screen edge are drawn on top of the HUD score card and hide the score
- How often: every round once you are large (size 8+) and bots are off screen; seen in 5 screenshots in 3 browsers.
- Repro: Ātrā, Centrs, Vidēji, any theme; play greedily (real mouse) to size 9-11 (about 70 s in) while a bot is up and to the left of the screen. Off-screen bots get a nameplate clamped to the screen edge; the clamp area includes the top-left corner where the score card sits.
- Expected: nameplates stay below/behind HUD cards (or are clamped outside the HUD rectangles). Actual: "Baiba" pill sits over the score digits ("55,472" becomes unreadable); "Pūce" nameplate overlaps the "Rīga swallowed" pill.
- Evidence: `scripts/out/qa1-ff1-p441.png` (full size, clearest), `qa1-ff1-p245.png`, `qa1-wk1-p639.png`, `qa1-r1-p1552.png`.
- Guess: label layer (src/labels.js) z-order / edge clamp does not know the HUD rectangles.

### QA1-02 (S3) "Rīga swallowed X% · you Y%" pill overflows its own background
- How often: always at 1280x720 EN and LV once the numbers have 2+ digits or a decimal.
- Repro: any round, look at the pill under the timer. "you 11%" / "tu 0.0%" runs past the right edge of the pill; the last glyphs sit on the map with no background and are hard to read.
- Evidence: crops `scripts/out/crop-pill.png` (Rīga swallowed 20% you 11), `crop-pill2.png` (you 0.1%), also visible in `qa1-r1-p116.png`.
- Guess: fixed pill width in CSS (src/style.css, id `share` pill near `#hud`).

### QA1-03 (S3) At viewport widths up to about 900 px (= 150% browser zoom on a 1280x720 screen, or small windows) the Rīga-share pill collides with the score card
- Repro: open at 800x500, 900x600 or 853x480 (dpr 1.5, i.e. 150% zoom), start any round. The left HUD card ("SCORE 0 / Swallowed: 0 / 0.0% Rīga") is drawn under the stacked "Rīga 0.0% / You 0.0%" pill, so "0.0% Rīga" and "Riga 0.0%" overlap. At 800x500 the top row of the card is also tight to the top edge. 1024x600 and 1280x720 are fine.
- Evidence: `qa1-res-800x500.png` (full size), `qa1-res-900x600.png`, `qa1-zoom150%-play.png`.
- Also at 640x360 / 853x480 the floating mute + radio buttons overlap the right end of the start card (the "Pastaiga" mode button is partly covered): `qa1-zoom200%-menu-adv.png`, `qa1-zoom150%-menu-adv.png`.

### QA1-04 (S3) Kill-feed pill overlaps the score card
- Repro: Klasika, Centrs, Grūti; get swallowed (steer into a bigger bot at about 3:45 left). The feed line "Jānis swallowed Hunter +272" is drawn directly over the bottom line "0.1% Rīga" of the score card, both texts illegible for the 3-4 s the pill lives. Same with "Gundega swallowed Hunter +165".
- Evidence: `qa1-hunt-centrs-death1-4.png`, `-death1-0.png`, `-death2-0.png`.
- Note: this is a bot swallowing the player; the feed anchor sits at the card's lower edge.

### QA1-05 (S3) Stale HUD values during the fly-in of "Play again"
- How often: 2 of 2 checked (r1, r5; also visible in ff1/wk1 again-shots).
- Repro: finish a round with a high Rīga %, click "Play again". During the new fly-in the HUD still shows the previous round's "13% Rīga" and the share bar "Rīga swallowed 72% / you 13%" (r5: 27% / 53%). It resets to 0.0% only when "Go!" appears. Score/size/leaderboard are reset correctly (score 0, leaderboard all zeros).
- Evidence: `qa1-r1-again-0.png`, `qa1-r5-again-0.png` vs `qa1-r1-again-1.png`.
- Guess: pct widgets are refreshed in the playing state only, not on `introStart`.

### QA1-06 (S3) Achievements "Bedru karalis" (finish 1st) and "Sveiks un vesels" (finish unswallowed) unlock in Brīvā pastaiga, even with 0 points
- Repro: `?mode=free` (or start screen: Pastaiga), press Play, do nothing for 3 s, click "End / Beigt". Results show "1st of 1, 0 points, Progress (2)" and "New achievements: King of the Pit, Safe and Sound". Reproduced 2 times (one with 10 points, one with 0 points).
- Expected: free roam has no rivals, so "1st place" is meaningless; probably should not count or at least not for 0 points.
- Cause: src/meta/progress.js line ~69 deliberately lets free/practice rounds unlock things; `R.won` is true when rank is 1 of 1. (Design choice, but the two specific achievements become free.)

### QA1-07 (S3) "Copy link" gives no visible confirmation (and "Share" none on desktop)
- Repro: finish any round (free roam is quickest), click "Copy link" on the results card. The clipboard really gets `https://bedre.pakers.lv`, but no "Link copied" toast or label change is visible (screenshot 350 ms after the click; the only DOM node containing "copied" is invisible). "Share" on desktop (no `navigator.share`) falls back to a PNG download; no toast either and I did not see a download event in headless Chromium within 4 s (could be a headless limitation, so only the missing feedback is claimed).
- Evidence: `qa1-share-copy2.png`, `qa1-share-copy.png`. Reproduced in two separate runs.
- Guess: toast is created while the results panel is open and sits below it / is cleared by `clearToasts` (src/meta/progress.js ~264, `toast(... sticky:true)`).

### QA1-08 (S3) Copy link always copies the production URL (`https://bedre.pakers.lv`), also from other hosts/params
- Observed with the local server: clipboard = `https://bedre.pakers.lv`. Probably intentional (SITE constant); listed only because a map/mode/daily deep link is not shared (the share text carries no `?map=`). Low priority.

## Suspected (seen once, or only code-level evidence)
- QA1-S1 (S3) "Lāčplēša diena" is used as the name of the 18 November theme and the caption reads "Lāčplēša diena — 18. novembra svētku vakars" / "Lāčplēša Day — the 18 November festive evening". Lāčplēša Day is 11 Nov, 18 Nov is Proclamation Day. The auto window is 11-18 Nov, so the combined name is arguably deliberate, but the caption mixes the two dates. Seen in the Advanced > Theme caption (`themeNov18Cap`, src/i18n.js lines 32 / 62).
- QA1-S2 (S3) WebKit logs four "resource was preloaded using link preload but not used within a few seconds" warnings (riga-ground.png, riga-objects.bin.gz?v=..., riga-shapes.bin.gz, riga.json) on a Centrs load; seen on both loads in the WebKit run, none in Chromium or Firefox. If WebKit really refetches these (credentials / `crossorigin` mismatch on the `<link rel=preload>`), the biggest files are downloaded twice on Safari. I did not measure the transfer.
- QA1-S3 (S3) Console error "Blocked call to navigator.vibrate because user hasn't tapped on the frame" on desktop Chromium, once (Mežaparks winter, free roam started via `?autostart=1`, i.e. no user gesture). `buzz()` (src/mobile.js:68) tries to vibrate on any browser that has `navigator.vibrate`, desktop included; with a real Play click it is silent. Harmless but pollutes the console on desktop autostart.
- QA1-S4 (S3) The player name typed on the start screen is stored only when a round starts (localStorage `bedre.name` was null after typing, reloading and typing again). Typing a name, then reloading or opening a panel and reloading loses it. Max length is 14 characters, silently (the long test name was cut to "Pēteris Ķēniņš"). HTML in the name is shown as text (no injection).

## Gameplay / balance observations (subjective, with numbers)
- Growth pacing (greedy mouse player, Easy/Normal): Ātrā 2:00 ends around size 10-11, Ø 240-280 m, 50-75 k points in every map; Klasika 5:00 at Grūti ended at only size 9 / 68 k and 3rd place. The curve is very exponential: for Ātrā, about 30 s to size 4, about 60 s to size 8, and the last 30 s doubles the score (e.g. r2: 8.6 k at 28 s left, 53 k at 4 s left). Last-30-seconds score swings decide the placement; players who find the big buildings late lose by a wide margin.
- Difficulty feel: Viegli/Vidēji bots are not a threat to a competent player (Vidēji: me 76.7 k vs next bot 26.5 k in ff1; me 74 k vs 29 k in wk1; Centrs/normal/Mežaparks r6: 112.6 k vs 33.9 k). Grūti is clearly different: bots reach 80-125 k in Klasika (r1: top bot Dzeguze 125 k vs me 68 k) and bots hunt (bot modes eat/roam/flee/hunt in the log). Daily (forced Vidēji, twist "Gudrāki, ātrāki boti") gave me 139.7 k vs best bot 24.7 k: the twist did not feel harder.
- Runaway bot: in the Āgenskalns Grūti audit one bot ("Zaķis") reached r = 194 and 157,842 points with 2 kills while the other six peaked at r 64-84 (13-23 k): one bot snowballs 7x the rest. Seen once.
- In 9 rounds only the deliberate hunt got me swallowed; passive/idle play (r4) never got me eaten on Grūti in 2 minutes, even close to bots (the idle run drifted to the Centrs north edge z=-1200 and sat there). Swallow flow itself is good: "Swallowed by X, Back in 4..1", respawn at a random spot with 3 s protection, score halved (543 -> about 271, 330 -> 165), smaller hole (r 9.8 -> 6.4).
- Bot behaviour audit (4 maps, Grūti, 2 min each, 28 bots): no bot idle for even 1 s, no jitter (0-14 direction reversals in 2 min), no edge hugging (0 s within 25 m of the map bounds), all modes used. Bots behave well.
- Maps: Centrs is the richest and best-balanced (landmarks, bridges, trams). Mežaparks at size 8+ feels empty: forest + 1,870 buildings, so the final minute is mostly eating trees; the tan "outside the map" slab fills ~40-50% of the screen near the edges at large sizes on all non-Centrs maps (`qa1-r6-p1138.png`, `p1482.png`; Purvciems `qa1-r3-p440.png`). Purvciems panel blocks are huge and give great late growth. Āgenskalns has a big lake in the north-east and fine mid-game.
- The spawn point on Mežaparks and Centrs is on a road with traffic (Mežaparks: right on tram rails; trams pass over the hole in the first seconds).
- Fireworks/flags (18 Nov auto theme) are visible in daytime frames on today's date (16 Nov). Fine, just noting that "Auto" currently looks evening-lit at midday in the menu.

## Things I tried that worked fine
- Start screen LV/EN, Advanced open, internal scroll at 1280x720, Tab order (name, Play, Online, Advanced, modes, difficulty, map, themes, quality, links, LV/EN; cycles) and focus ring, Enter in the name field starts the game, Space/Enter start, Esc closes Top scores / About / Progress.
- Settings persistence across reload: mode, difficulty, theme, quality, language, mute, Advanced open state (localStorage keys bedre.*). Language switch keeps typed name.
- Daily intro banner with twist text and ISO date, "practice — not ranked" tag on the second daily attempt, daily mode locked to Centrs on other maps with an explanatory red note, difficulty locked to Vidēji in daily.
- Per-map boards: Klasika/Ātrā/Dienas tabs, 4 district tabs, period tabs and "Yesterday" for daily all return the right local data (rows tagged with the difficulty). Empty boards say "No scores yet. Be the first!".
- Local submit path: results show "Global rank: #1 all-time · #1 today" / "Dienas tabulā: #1"; free roam shows "Free roam — nothing is saved"; unranked flag stayed null for all my ranked rounds.
- Pause: Esc, 12 rapid Esc presses (ends unpaused, timer consistent), pause button, pause overlay buttons, timer frozen while paused (298.5668 -> 298.5668 after 3 s), Esc on the overlay resumes. Simulated `visibilitychange` hidden pauses the round and it stays paused on return; CDP freeze/active also leaves it paused. Window blur with D held stops the hole.
- Several keys at once (W+D+ArrowLeft), spinning the mouse in circles, parking the pointer outside the window, right/middle click, double click, ctrl+wheel, drag-select on canvas (no text selected, no page scroll), random keys during play: nothing broke.
- Zoom wheel to both extremes in Klasika (dist 30 to 130; camera and HUD stay fine). Resizes mid-round to 1024x600, 800x500, 2560x800, 600x900 and back: canvas size and HUD follow immediately, nothing off-screen (except QA1-03 overlap).
- Edge: ramming the Centrs west/south edge stops the hole at the bounds (z=-1200 / x=-2100 region) with no jitter or camera glitch.
- Memory/leaks: 10 consecutive rounds in one page: JS heap flat 188 MB, geometries 39 / textures 27 constant from round 3, DOM nodes 464 constant, movers 1076 constant, no leftover falling objects, holes 8, labels/feed/popups empty between rounds, props restored each round (`remainingProps` back to the full count at the next start).
- Audio: `AudioContext` state "running" after Play, M and the mute button toggle `muted` and `bedre.muted` (0/1), master state survives reload. No audio-related console errors.
- Performance (Chromium, real GPU): p50/p95/p99 frame time 16.7 / 16.8 / 16.8 ms in every round on all four maps and all themes at 1280x720 and 1920x1080, including size 11 views of the whole map (draw calls ~100-210, 0.45-0.9 M triangles); no frame over 100 ms during play in 10+ rounds. The only long frames (400-1270 ms) occur once at page boot while the world is built. Winter/evening/18 Nov cost only a few extra draw calls. WebKit similar (p95 20 ms, p99 29 ms). Firefox (headless) p50 16.8 ms but p95 41 ms, p99 67 ms and about ten frames of 100-234 ms at large sizes (software GL likely, not conclusive).
- Console / network: zero page errors and zero failed requests in Chromium rounds (only one `ERR_ABORTED` radio fragment when the page closed while the radio was playing, and an `/api/e` beacon cancelled on navigation). Firefox logs a one-off WebGL depth-compare warning and "WEBGL_multi_draw not supported" (three.js fallback), harmless.
- Cross-browser: Firefox and WebKit rounds looked identical to Chromium (same world, HUD, results, achievements, Play again), no visual differences found except frame cost above.
- LV/EN: all 91 + 50 string keys exist in both languages with identical placeholders (script `scripts/qa1/i18n-check.mjs`); diacritics render (Ķ, Ļ, Š, ū) in labels, results and boards; no "undefined"/"NaN"/raw ids in labels, feed or toasts across 16 free-roam sessions and the rounds. Generic building names are "ēka" (LV) / "building" (EN) when a building has no address.
- Themes: day, evening (lit windows, lamps), winter (snow on trees and roofs, flat grey roads, falling snow), 18 Nov (flags, fireworks, evening look) rendered correctly on all four maps; nothing floating or mis-coloured spotted.
- World audit (read-only scan of all four maps): props inside building footprints: 0-2 per map except 7 monuments in Centrs footprints (landmarks, expected); boats all on water; cars inside low "aux" buildings (sheds/carports) occasionally (e.g. Purvciems 4483,-910, Āgenskalns -1297,2633), not visible as a problem. Pedestrians/lamps "on water" counts in Centrs are on bridges (not verified one by one).
- Live site: loads in 1.5 s, Top scores shows real boards, free roam runs, no console errors; nothing submitted.

## Notes on the environment (not game bugs)
- The local wrangler instance was killed three times by something outside my scripts (another process on the same machine, probably another tester's cleanup); I restarted it with `scripts/qa1/server2.mjs`. Two runs (the first `misc1` zoom-200% step and one result-tab check) hit ERR_CONNECTION_REFUSED because of that; those are not game issues.
- Round scripts use `#play`, `#again`, `#end-free` and read `window.__game` for aiming only.
