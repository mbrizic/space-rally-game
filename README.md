# Space Rally

> I am, as kids today call it, now vibe-coding this: a simple 2D rally game with unnecessarily complex and realistic physics engine underneath it; and the game will also feature guns. These two sentences are the only thing in this project that I've written myself.

> Addendum: this is working so well that a) we already have guns, and b) it's escalating to become a two-player co-op mobile multiplayer game.

**Play it here:** https://spacerally.hexagonflux.hr/

## Features

- 🏎️ **Realistic physics** - Proper tire slip angles, weight transfer, and traction circles
- ⚙️ **Automatic/Manual gearbox** - 6-speed transmission with automatic shifting (default), or toggle to manual with J/K shifting
- ❄️ **Multiple surfaces** - Tarmac, gravel, sand, and ice with different friction characteristics
- 🎮 **Two camera modes** - Fixed follow and stabilized runner mode (toggle with `C`)
- ⏱️ **Bullet time (debug)** - Hold-to-slow with a 30s per-map budget (hold `U`)
- 🎵 **Procedural audio** - Engine and tire sounds that react to your driving
- 🏁 **Procedural tracks** - Generate rally stages (press `N` for a new one)
- 💨 **Drift scoring** - Show off your Scandinavian flicks
- 🛠️ **Track editor** - Create custom stages (press `T`)
- 🪵 **Road debris hazards** - Concentrated deterministic fallen-log patches, denser in rainforest, marked D on the minimap
- 🔥 **Colossus boss (dormant)** - Boss/fireball code exists, but spawning is disabled; see [inactive features](docs/DORMANT_FEATURES.md)


## The Co-Op Mode

This will be a **2-player mobile app experience**. Two players, two phones, one car.

It's a high-stakes asymmetric cooperative race designed for local play:

- **The Driver** (Phone 1): Drives and fights.
- **The Navigator** (Phone 2): Uses the map to call hazards/corners and aims the guns.
- P2's weather-distance text stays inside the minimap. Narrow roads are read visually; debris patches use D markers, never distance callouts.
- **The Loop**: The Navigator shouts directions (ice! left! enemy!) while the Driver commits at speed.

Ideally played in the same room for maximum shouting and adrenaline.

### Multiplayer (current)

- Click **MULTIPLAYER** to create a room (you become the host/driver).
- The game copies an invite link to your clipboard; send it to Player 2.
- Player 2 opens the link and joins immediately (no start menu).
- The host simulation **waits** until Player 2 is connected and "ready".

Invite links include a private `hostKey` (used to prevent host spoofing) and should be treated as secret. Use the in-game **DISCONNECT** button to return to singleplayer.

Notes:
- The connection is **P2P WebRTC** when possible.
- For strict NAT/corporate/cellular networks, the game supports **TURN (coturn)** relay as a fallback.

Quality-of-life:
- If the connection drops, the UI offers a simple **Reconnect** action.
- The Debug panel includes basic **network stats** (RTT + snapshot rate) for troubleshooting.

See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for the full architecture + deployment notes.

## Stage Seeds (How Tracks Work)

- A “stage” is generated from an integer **seed**.
- The track generator is deterministic for a given seed (same seed → same track), which makes stages shareable.
- On game start, the client picks a random seed in the range **1..1000** and loads that stage.
- Each stage opens with a seed-derived name (such as "Road 150"), biome, and a plain-language surface mix for seven seconds, without pausing driving.
- Routes mix tight switchbacks, sharp corners, and long sweeping bends; see [track generation notes](docs/TRACK_VARIETY_NOTES.md).
- The current route name and number are shown in the in-game Debug panel (toggle with `F`).
- The `N` key / “NEW TRACK” button advances to a different stage by changing the seed (seed logic unchanged; this is just stage selection).

## Development

Coding-agent conventions and documentation links are in [AGENTS.md](AGENTS.md).

```bash
npm install
npm run dev
npm run build
npm test

# Perf harness
npm run perf:run
```

See [docs/PERF.md](docs/PERF.md) for details.
## Lore

See [docs/LORE.md](docs/LORE.md) for story tone, premise, and co-op role hooks (including volatile cargo).
You’re two contractors driving a “delivery platform” for **SCRAPS** (*Salvage Contracts & Risk-Adjusted Procurement Service*), trying to keep cargo stable and meet deadlines while the world politely falls apart.

Tagline vibe: “Space is hard. Shipping shouldn’t be.”

More story tone + future hooks live in [docs/LORE.md](docs/LORE.md).
## Deployment

```bash
npm run deploy        # defaults to test
npm run deploy:prod   # only when explicitly requested
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for details and [production readiness](docs/PRODUCTION-READINESS.md) for accepted caveats.

Note: the production build is configured to work from subfolders (e.g. `/test/`) via `vite.config.ts`.

## Tech Stack

- TypeScript
- Vite
- Canvas 2D
- Web Audio API
- Pure math (no physics engine library)

---

Built with AI assistance and vibe.

## Project Log

- 2026-10-11: Added [AGENTS.md](AGENTS.md) and corrected [deployment docs](docs/DEPLOY.md). Frontend deployed to test and server file hashes verified; typecheck, build, and 99 tests passed. Public access remains blocked by hostname DNS/test routing; production backend and TURN were not redeployed.
- 2026-10-11: Frontend also [deployed to production](docs/DEPLOY.md); build/typecheck passed and server file hashes match the local build. Domain change and public access verification remain pending; backend and TURN unchanged.
- 2026-10-11: Confirmed the game at https://spacerally.hexagonflux.hr/; production, test, and backend health return HTTP 200. Updated code/docs to the new domain; typecheck and 99 tests passed. Redeployment and live TURN hostname migration remain pending; see [deployment notes](docs/DEPLOY.md).
- 2026-10-11: Diagnosed singleplayer's unresponsive menu as a stalled CDN-cached JavaScript download; redeployed the frontend to production/test with a fresh asset fingerprint. Live browser checks passed for both solo modes, test startup, and mobile-landscape rendering/animation with no JavaScript errors. See [CDN troubleshooting](docs/DEPLOY.md#troubleshooting); backend/TURN migration remains pending.
- 2026-10-12: Added factual level/biome/surface intros and separated arc-based routes with compact hairpins and broad bends. Geometry checks cover all 1,000 selectable seeds; desktop/mobile intro checks pass. Ready for manual driving review; no commit, push, or deployment. See [track notes](docs/TRACK_VARIETY_NOTES.md).
- 2026-10-12: Confirmed existing leaderboard times will remain intact; recorded the accepted old/new-layout comparability caveat in [production readiness](docs/PRODUCTION-READINESS.md).
- 2026-10-12: Audited feature ideas against code and design notes, deduplicated [pending tasks](docs/TASKS.md), and expanded [co-op/sequel concepts](docs/COOP_MODE.md), including engineer and optional passenger/music roles. Corrected stale dormant-feature and performance status notes; documentation only.
- 2026-10-12: Unified seed-derived route names and qualitative surface copy; reworked the finish modal for landscape, zoomed P2 out without changing P1, subdued checkpoint/bullet-time notices, and slightly increased small-hit reaction, headlight width and steering. Automated checks precede user playtesting; no commit, push or deployment.
- 2026-10-12: Corrected actual steering curvature, lowered P1/centred P2 framing, moved weapons left, added first-finisher humour/team-name input, and enforced minimap-only P2 hazard distances. Typecheck and 119 tests passed. Backend/TURN redeployed with scores backed up/preserved; public TURN routing still needs DNS-only configuration. Frontend changes remain local for playtesting; see [readiness](docs/PRODUCTION-READINESS.md).
- 2026-10-12: Separated failure/retry and intro/GO overlays, replaced Street with humorous seeded route names, removed duplicate client zoom scaling, added P2 dispatch-wait copy, and concentrated debris into D-marked patches without narrow/debris distances. Increased engine force and tuned livelier steering; ready for manual playtesting, with no commit/push/deployment.
- 2026-10-12: Simplified the seeded route-name rotation to Road, Passage, Detour, Salvage Run and Trail; naming tests and [track notes](docs/TRACK_VARIETY_NOTES.md) updated.
- 2026-10-12: User accepted the track/UI/handling batch for commit and push; removed its completed playtest task. Typecheck and 127 tests passed; public TURN DNS/relay routing remains pending in [readiness](docs/PRODUCTION-READINESS.md).
