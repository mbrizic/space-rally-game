# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details.

## Multiplayer

- [ ] Improve client playback smoothing / reduce drift (details: `MULTIPLAYER_PLAYBACK.md`)
- [x] Add a simple reconnect UX (detect disconnect → show "reconnect" CTA) (details: `MULTIPLAYER.md`)
- [x] Add basic network debug overlay / stats (RTT, snapshot rate, mode) (details: `MULTIPLAYER.md`)

## Co-op Mode

- [ ] Prevent/mitigate cheating vectors (e.g. resize / zoom / debug toggles) (details: `COOP_MODE.md`)

## Track / Stage Generation

- [ ] Improve track variety without breaking safety constraints (details: `TRACK_VARIETY_NOTES.md`)
- [ ] Track generator: reduce “safe/repetitive” bias from overlap-retry logic (details: `TRACK_VARIETY_NOTES.md`)

## Quick wins
- reduce debris amount/frequency on rainforest tracks by a bit
- reduce offtrack grip/traction penalty by a bit
- change size of "CHeckpoint 3/3" text to be smaller
- remove pacenotes fully from the project
- remove "Press N to play new track" and instead always display the "NEW TRACK" button, even in desktop use (on mobile, the NEW TRACK button is across the )
- make the RAIN/DEBRIS/ETC callouts on the minimal more prominent (e.g.) a marker on the map? Or a highlighted text on top of the screen (like the co-driver is seeing it in front? but current one is too big and too boring)
- bullets not as visible on ice, as they're very similar colors
- increase the minimap for the co-driver a bit
- bug: after the track is finished, controls still shown on the screen, co-driver can even shoot guns
- when you enter the join code, the phone keyboard should dismiss on its own
- bug: auto full-screen doesn't really work on iPhones

## Internet
- add option to upvote/downvote track at the end of race
    - add backend to support this and show most and least favourite tracks
- log high scores (we already have backend support) and who those high scores somewhere 

## Performance

- [ ] Rendering perf benchmark (browser): record + deterministic playback + Playwright runner (details: `PERF.md`)
- [ ] Add perf parameter sweep runner (fog/rain/particles presets → FPS + frame-time stats) (details: `PERF.md`)
- [ ] WebGPU particle system: 10x particle count, GPU compute/render (details: `WEBGPU_WASM.md`)
- [ ] WASM physics: Rust-compiled car/enemy/track simulation (details: `WEBGPU_WASM.md`)

## Feel / UX / Polish

- [x] Make finish line prominent + hard-stop/lock controls on crossing
- [x] Add deterministic road debris hazards (destabilize, no damage) + navigator callouts (~50m)
- [x] Biome tuning: rainforest denser trees + more debris; arctic less debris
- [ ] Tune surfaces + audio feel (gravel slide vs drift intensity, ice feel)
- [ ] Add better tactile feedback (haptics/vibration tied to grip/impacts)
- [ ] Manual gearbox UX on mobile

## Bigger Ideas (P3/P4, Weather, etc.)
- [x] a huge colossus boss that chases + shoots fireballs (we have him, but question is whether we want to keep him, so currently disabled)
- [] Something is after you: a sandstorm, dark clouds, something, and you need to run from it
- [ ] Player 3 (Engineer): power distribution (shield/engine/weapons) + damage control
- [ ] Player 4 (Intel/Hacker): forward-scout drone + tagging/hacking gates
- [ ] Bullet time: cooperative slowdown mechanics
- [ ] Extra co-driver cues: visual pings, callout macros, “danger” meter
- [ ] Optional idea: navigator ping/marker system (map click → driver-world marker) (details: `COOP_MODE.md`)
- [ ] Boss fights - ultra big enemy on the stage that shoots at players - they leave the car and then the game becomes a top-down shooter until they get rid of him (will need to implement completely different, Crimsonland-like gameplay)
- [ ] On-foot mode: exit vehicle → twin-stick shooter gameplay (Crimsonland-style), re-enter car to continue

## Infrastructure (P3/P4)

- [ ] Mesh networking for 3-4 players: WebRTC mesh topology (see notes below)
- [ ] VR mode (WebXR): tabletop-style VR, controller aiming
- [ ] Steering wheel / gamepad support via Gamepad API
- [ ] Input abstraction layer: unified API for keyboard/touch/gamepad/wheel/VR

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
