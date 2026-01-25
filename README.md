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
- 🏁 **Procedural tracks** - Generate infinite rally stages (press `N`)
- 💨 **Drift scoring** - Show off your Scandinavian flicks
- 🛠️ **Track editor** - Create custom stages (press `T`)


## The "Blind Rally" Vision (Coming Soon)

We are building a dedicated **2-player mobile app experience**. Two players, two phones, one car.

It's a high-stakes asymmetric cooperative race designed for local play:

- **The Driver** (Phone 1): The greatest driver in the world... but with the worst eyesight, seeing only 50m ahead through a thick space-fog.
- **The Navigator** (Phone 2): A tactical genius who sees everything from orbit... but has no idea how a steering wheel works and can only scream directions while manning the car's turret.
- **The Loop**: The Navigator must shout out hazards (ice! turning left!) and paint targets for the turret, while the Driver relies on pure reflex and trust in their partner's voice. 

Ideally played in the same room for maximum shouting and adrenaline. Built for **WebRTC** direct-link connectivity between mobile devices.

## Development

```bash
npm install
npm run dev
npm run build
npm test
```

## Deployment

```bash
npm run deploy
```

See `DEPLOY.md` for details.

## Tech Stack

- TypeScript
- Vite
- Canvas 2D
- Web Audio API
- Pure math (no physics engine library)

---

Built with AI assistance and vibe.
