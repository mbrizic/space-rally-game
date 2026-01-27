# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details.

## Recently Completed

- [x] Fog rendering: Increased radius, fixed visible box edges with circular clipping
- [x] Fog performance: Reduced gradient stops to improve FPS
- [x] Road width variance: Smoothed with 7-point moving average to reduce jarring transitions
- [x] P2 engine/skid audio: Synced audio state via snapshot so client hears their car
- [x] P2 shooting responsiveness: Client-authoritative shooting (client spawns/renders/detects hits locally)
- [x] Host sees client bullets: Projectile positions synced from client to host for rendering

## Multiplayer

- [ ] Improve client playback smoothing / reduce drift (details: `MULTIPLAYER_PLAYBACK.md`)
- [ ] Add a simple reconnect UX (detect disconnect → show "reconnect" CTA) (details: `MULTIPLAYER.md`)
- [ ] Add basic network debug overlay / stats (RTT, snapshot rate, mode) (details: `MULTIPLAYER.md`)
- [x] Audio strategy for multiplayer: Client plays local engine/skid audio based on host-synced state

## Co-op Mode

- [ ] Prevent/mitigate cheating vectors (e.g. resize / zoom / debug toggles) (details: `COOP_MODE.md`)

## Track / Stage Generation

- [ ] Improve track variety without breaking safety constraints (details: `TRACK_VARIETY_NOTES.md`)
- [ ] Track generator: reduce “safe/repetitive” bias from overlap-retry logic (details: `TRACK_VARIETY_NOTES.md`)

## Determinism / Simulation

- [ ] Ensure enemy placement remains deterministic and purely seed-driven (esp. clusters/gaps) (details: `MULTIPLAYER.md`)

## Feel / UX / Polish

- [ ] Tune surfaces + audio feel (gravel slide vs drift intensity, ice feel)
- [ ] Add better tactile feedback (haptics/vibration tied to grip/impacts)
- [ ] Manual gearbox UX on mobile

## Bugs I noticed
- "offtrack" seems to have better grip than ice itself
- minimap (or on-screen hint) should somehow indicate: upcoming narrow strips or road, incoming rain

## Bigger Ideas (P3/P4, Weather, etc.)

- [ ] Player 3 (Engineer): power distribution (shield/engine/weapons) + damage control
- [ ] Player 4 (Intel/Hacker): forward-scout drone + tagging/hacking gates
- [ ] Weather: sandstorms (visibility), rain (traction), electrical storms (electronics/minimap), in progress
- [ ] Bullet time: cooperative slowdown mechanics
- [ ] Extra co-driver cues: visual pings, callout macros, “danger” meter
- [ ] Optional idea: navigator ping/marker system (map click → driver-world marker) (details: `COOP_MODE.md`)
