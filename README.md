# Space Rally

> I am, as kids today call it, now vibe-coding this: a simple 2D rally game with unnecessarily complex and realistic physics engine underneath it; and the game will also feature guns. These two sentences are the only thing in this project that I've written myself.

> Addendum: this is working so well that a) we already have guns, and b) it's escalating to become a two-player co-op mobile multiplayer game.

**Play it here:** https://spacerally.supercollider.hr/

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
- 🪵 **Road debris hazards** - Deterministic fallen logs that destabilize (no damage) + navigator callouts when close
- 🔥 **Colossus boss** - A huge enemy that chases you and shoots fireballs


## The Co-Op Mode

This will be a **2-player mobile app experience**. Two players, two phones, one car.

It's a high-stakes asymmetric cooperative race designed for local play:

- **The Driver** (Phone 1): Drives and fights.
- **The Navigator** (Phone 2): Uses the map to call hazards/corners and aims the guns.
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
- The current stage seed is shown in the in-game Debug panel (toggle with `F`).
- The `N` key / “NEW TRACK” button advances to a different stage by changing the seed (seed logic unchanged; this is just stage selection).

## Development

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

See [docs/DEPLOY.md](docs/DEPLOY.md) for details.

Note: the production build is configured to work from subfolders (e.g. `/test/`) via `vite.config.ts`.

## Tech Stack

- TypeScript
- Vite
- Canvas 2D
- Web Audio API
- Pure math (no physics engine library)

---

Built with AI assistance and vibe.
