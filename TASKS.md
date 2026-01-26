# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details.

## Multiplayer

- [ ] Improve client playback smoothing / reduce drift (details: `MULTIPLAYER_PLAYBACK.md`)
- [ ] Add a simple reconnect UX (detect disconnect → show “reconnect” CTA) (details: `MULTIPLAYER.md`)
- [ ] Add basic network debug overlay / stats (RTT, snapshot rate, mode) (details: `MULTIPLAYER.md`)
- [ ] Audio strategy for multiplayer (host-only? local-only? synced events?)

## Co-op Mode

- [ ] Re-enable/tune Driver fog mechanic + Navigator satellite view (details: `COOP_MODE.md`) (or remove this mechanism)
- [ ] Navigator ping/marker system (map click → driver-world marker) (details: `COOP_MODE.md`) (or maybe don't do this)
- [ ] Mobile control layouts (driver + navigator) (details: `COOP_MODE.md`)
- [ ] Prevent/mitigate cheating vectors (e.g. resize / zoom / debug toggles) (details: `COOP_MODE.md`)

## Track / Stage Generation

- [ ] Improve track variety without breaking safety constraints (details: `TRACK_VARIETY_NOTES.md`)
- [ ] Track generator: reduce “safe/repetitive” bias from overlap-retry logic (details: `TRACK_VARIETY_NOTES.md`)

## Pacenotes

- [ ] Decide pacenotes direction: fix + re-enable vs remove fully (details: `PACENOTES.md`)

## Determinism / Simulation

- [ ] Ensure enemy placement remains deterministic and purely seed-driven (esp. clusters/gaps) (details: `MULTIPLAYER.md`)

## Feel / UX / Polish

- [ ] Tune surfaces + audio feel (gravel slide vs drift intensity, ice feel)
- [ ] Add better tactile feedback (haptics/vibration tied to grip/impacts)
- [ ] Manual gearbox UX on mobile

## Bigger Ideas (P3/P4, Weather, etc.)

- [ ] Player 3 (Engineer): power distribution (shield/engine/weapons) + damage control
- [ ] Player 4 (Intel/Hacker): forward-scout drone + tagging/hacking gates
- [ ] Weather: sandstorms (visibility), rain (traction), electrical storms (electronics/minimap), in progress
- [ ] Bullet time: cooperative slowdown mechanics
- [ ] Extra co-driver cues: visual pings, callout macros, “danger” meter
