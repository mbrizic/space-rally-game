# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details.

## Multiplayer

- [ ] Improve client playback smoothing / reduce drift (details: `MULTIPLAYER_PLAYBACK.md`)
- [ ] Add a simple reconnect UX (detect disconnect → show "reconnect" CTA) (details: `MULTIPLAYER.md`)
- [ ] Add basic network debug overlay / stats (RTT, snapshot rate, mode) (details: `MULTIPLAYER.md`)

## Co-op Mode

- [ ] Prevent/mitigate cheating vectors (e.g. resize / zoom / debug toggles) (details: `COOP_MODE.md`)

## Track / Stage Generation

- [ ] Improve track variety without breaking safety constraints (details: `TRACK_VARIETY_NOTES.md`)
- [ ] Track generator: reduce “safe/repetitive” bias from overlap-retry logic (details: `TRACK_VARIETY_NOTES.md`)

## Performance

- [ ] Rendering perf benchmark (browser): record + deterministic playback + Playwright runner (details: `PERF.md`)
- [ ] Add perf parameter sweep runner (fog/rain/particles presets → FPS + frame-time stats) (details: `PERF.md`)

## Feel / UX / Polish

- [ ] Tune surfaces + audio feel (gravel slide vs drift intensity, ice feel)
- [ ] Add better tactile feedback (haptics/vibration tied to grip/impacts)
- [ ] Manual gearbox UX on mobile

## Bigger Ideas (P3/P4, Weather, etc.)

- [ ] Player 3 (Engineer): power distribution (shield/engine/weapons) + damage control
- [ ] Player 4 (Intel/Hacker): forward-scout drone + tagging/hacking gates
- [ ] Bullet time: cooperative slowdown mechanics
- [ ] Extra co-driver cues: visual pings, callout macros, “danger” meter
- [ ] Optional idea: navigator ping/marker system (map click → driver-world marker) (details: `COOP_MODE.md`)
- [ ] Boss fights - ultra big enemy on the stage that shoots at players - they leave the car and then the game becomes a top-down shooter until they get rid of him (will need to implement completely different, Crimsonland-like gameplay)
