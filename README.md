# Space Rally

> I am, as kids today call it, now vibe-coding this: a simple 2D rally game with unnecessarily complex and realistic physics engine underneath it; and the game will also feature guns. These two sentences are the only thing in this project that I've written myself.

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

## Controls

- `W / ↑` - Throttle
- `S / ↓` - Brake / Reverse
- `A/D or ←/→` - Steer
- `Space` - Handbrake
- `J / K` - Shift down / up (manual mode)
- `R` - Reset
- `N` - Generate new track
- `C` - Toggle camera mode
- `T` - Track editor
- `F` - Toggle force arrows

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
