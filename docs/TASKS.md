# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details. As soon as something is done, remove it from this file, as the ideal length of this file should be zero.

## Co-op Mode

- [ ] Prevent/mitigate cheating vectors (e.g. resize / zoom / debug toggles) (details: `COOP_MODE.md`)
- post replays to backend automatically for verification

## Track / Stage Generation

- [ ] Improve track variety without breaking safety constraints (details: `TRACK_VARIETY_NOTES.md`)
- [ ] Track generator: reduce “safe/repetitive” bias from overlap-retry logic (details: `TRACK_VARIETY_NOTES.md`)

## Performance

- [ ] Rendering perf benchmark (browser): record + deterministic playback + Playwright runner (details: `PERF.md`)
- [ ] Add perf parameter sweep runner (fog/rain/particles presets → FPS + frame-time stats) (details: `PERF.md`)
- [ ] WebGPU particle system: 10x particle count, GPU compute/render (details: `WEBGPU_WASM.md`)
- [ ] WASM physics: Rust-compiled car/enemy/track simulation (details: `WEBGPU_WASM.md`)

## Backend
- HTML pages are under /api/, this should be cleaned up
- audit backend for safety, injections, etc.
- joke message when you're first one so you're automatically the fastest
- change all high score inputs to say "team name"

## Cleanups
- Tune surfaces + audio feel (gravel slide vs drift intensity, ice feel)
- audit code for abbreviations and make them cleaner (like quietZoneContainsSM)
- remove unused functions and classes
- try some code analyzer that can find bugs

- move P2 gun switcher to the left of the screen, right next to the bullet time slot
- reconnect doesnt' work reliably?
- add rivers that cross the track
- for practice runs, don't even show the submit/upvote menu
- overlapping track zones?
- night tracks?
- Expand the lore document with some funny bits how driver has a really poor eyesight and co-drivers brings a lot more gunpower than needed
- gates that you need to hack or break through (minigame with symbols they need to input)
- minefield
- shake the phone to reload
- forks in the road
- driver shouldn't see enemy health
- flying monsters that sweep from left to right
- headlights button that you need to turn on yourself, but they gather flies
- engine breaks with a partially visible code, P2 check manual (answer depends on track type)
    - press brake and gas at the same time, gas and handbrake
    - press one of the buttons: lights, coolant; but press only when something is on screen; press gas and one of the buttons, press in sequence
    - some buttons on/off toggles, some you need to hold
    - press speedometer


## Bigger Ideas (P3/P4, Weather, etc.)
- [ ] Something is after you: a sandstorm, dark clouds, something, and you need to run from it
- [ ] Player 3 (Engineer): power distribution (shield/engine/weapons) + damage control
- [ ] Player 4 (Intel/Hacker): forward-scout drone + tagging/hacking gates
- [ ] Boss fights - ultra big enemy on the stage that shoots at players - they leave the car and then the game becomes a top-down shooter until they get rid of him (will need to implement completely different, Crimsonland-like gameplay)
- [ ] Manual gearbox UX on mobile

## Infrastructure (P3/P4)

- [ ] Mesh networking for 3-4 players: WebRTC mesh topology (see notes below)

### Mesh Networking Notes

Current architecture is host-client (2 players). For 3-4 players, mesh networking is preferred:

**Why mesh over host-client for 3+ players:**
- Direct P2P between all players reduces latency (no relay through host)
- No single point of failure (host disconnect doesn't kill session)
- Natural fit for role-based authority (driver owns car state, gunner owns projectiles)

**Architecture:**
- Each player connects to every other player via WebRTC DataChannel
- Soft authority model: simulation host for physics, but each role authoritative for their actions
- Use existing signaling server for peer discovery + ICE exchange

**Complexity:**
- Need consensus on game state (or clear authority rules)
- More connections to manage (N players = N×(N-1)/2 connections)
- Bandwidth scales with player count

**Recommendation:** Only implement if P3/P4 roles become a priority. Current 2-player architecture is simpler and sufficient for driver+navigator co-op.
