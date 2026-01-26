# Space Rally

> I am, as kids today call it, now vibe-coding this: a simple 2D rally game with unnecessarily complex and realistic physics engine underneath it; and the game will also feature guns. These two sentences are the only thing in this project that I've written myself.

> Addendum: this is working so well that a) we already have guns, and b) it's escalating to become a two-player co-op mobile multiplayer game.

**Play it here:** https://spacerally.supercollider.hr/

## Features

- 🏎️ **Realistic physics** - Proper tire slip angles, weight transfer, and traction circles
- ⚙️ **Automatic/Manual gearbox** - 6-speed transmission with automatic shifting (default), or toggle to manual with J/K shifting
- ❄️ **Multiple surfaces** - Tarmac, gravel, dirt, and ice with different friction characteristics
- 🎮 **Two camera modes** - Fixed follow and stabilized runner mode (toggle with `C`)
- 🎵 **Procedural audio** - Engine and tire sounds that react to your driving
- 🏁 **Procedural tracks** - Generate rally stages (press `N` for a new one)
- 💨 **Drift scoring** - Show off your Scandinavian flicks
- 🛠️ **Track editor** - Create custom stages (press `T`)


## The "Blind Rally" Co-Op Mode (Under Construction)

This will be a **2-player mobile app experience**. Two players, two phones, one car.

It's a high-stakes asymmetric cooperative race designed for local play:

- **The Driver** (Phone 1): The greatest driver in the world... but with the worst eyesight, seeing only 50m ahead through.
- **The Navigator** (Phone 2): A tactical genius who sees everything... but has no idea how a steering wheel works and can only scream directions while manning the car's guns.
- **The Loop**: The Navigator must shout out hazards (ice! turning left! enemy!), while the Driver relies on pure reflex and trust in their partner's voice. 

Ideally played in the same room for maximum shouting and adrenaline.

### Multiplayer (current prototype)

- Click **MULTIPLAYER** to create a room (you become the host/driver).
- The game copies an invite link to your clipboard; send it to Player 2.
- Player 2 opens the link and joins immediately (no start menu).
- The host simulation **waits** until Player 2 is connected and "ready".

Host links include a private `hostKey` and should not be shared; use the in-game **DISCONNECT** button to return to singleplayer.

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
```

## Deployment

```bash
npm run deploy        # defaults to test
npm run deploy:prod   # only when explicitly requested
```

See `DEPLOY.md` for details.

Note: the production build is configured to work from subfolders (e.g. `/test/`) via `vite.config.ts`.

## Tech Stack

- TypeScript
- Vite
- Canvas 2D
- Web Audio API
- Pure math (no physics engine library)

---

Built with AI assistance and vibe.
