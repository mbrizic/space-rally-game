# Tasks / Backlog

This file is the **master list of all things we might want** (tasks + ideas). Keep it compact: one-liners only, link out for details. As soon as something is done, remove it from this file, as the ideal length of this file should be zero.

Navigator UI rule: weather distances are minimap-only in every network mode. No NARROW/DEBRIS distance labels; debris patches use D markers and narrow roads are read visually.

## Co-op Mode

- [ ] Prevent information/cheating leaks via resize, zoom and debug toggles (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Improve navigator map interactions/annotations while keeping P2 hazard distances strictly minimap-only (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Investigate reconnect reliability and add regression coverage (details: [MULTIPLAYER.md](MULTIPLAYER.md)).
- [ ] Validate client drift/twitch under jitter; evaluate buffered playback, timebase and large-correction handling (details: [MULTIPLAYER_PLAYBACK.md](MULTIPLAYER_PLAYBACK.md)).

## Track / Stage Generation

- [ ] Add rocky-road stretches with deterministic small-rock handling disturbances (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add wide roadless sand crossings where only the navigator sees the route continuation (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add rivers that cross the track, distinct from existing off-road water bodies.
- [ ] Add route forks with clear navigation and checkpoint rules.
- [ ] Add minefields and flying enemies that sweep across the route.

## Events

- [ ] Enable/tune generated desert sandstorms and complete their presentation (details: [DORMANT_FEATURES.md](DORMANT_FEATURES.md), [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add heat-wave events; decide whether heat haze alone or thermal/cooling mechanics are in scope (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add full night stages and manual headlights with the optional fly-attraction effect, distinct from existing eclipse zones.
- [ ] Add a warned persistent pursuit event with a storm/cloud or original shadow-monster presentation (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Review weather-zone overlap/readability without replacing the existing non-overlap generation rule.

## Weapons / Interactions

- [ ] Add a bazooka with projectile, ammo and area-damage rules (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add an alternate alien/magician navigator loadout with lightning and fire (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Add navigator-assisted hacking/breaking gates and engine-fault manual/code puzzles (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Evaluate reactivating the existing Colossus boss separately from new on-foot boss fights (details: [DORMANT_FEATURES.md](DORMANT_FEATURES.md)).

## Modes / Progression

- [ ] Add a guided driving/co-op tutorial using practice-mode foundations (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Design story contracts and campaign progression/save rules (details: [COOP_MODE.md](COOP_MODE.md), [LORE.md](LORE.md)).
- [ ] Add endurance mode with chained stages, carryover resources and survival scoring (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Restore replay watch/export/import UI using the existing recording/playback system (details: [DORMANT_FEATURES.md](DORMANT_FEATURES.md)).
- [ ] Add volatile cargo stability, delivery deadlines and optional contract clauses (details: [LORE.md](LORE.md)).
- [ ] Explore faction reputation and black-market vehicle/weapon mods (details: [LORE.md](LORE.md)).

## Performance

- [ ] Add a fixed-scene browser FPS/frame-time benchmark and Playwright runner, reusing existing replay recording/playback (details: [PERF.md](PERF.md)).
- [ ] Add fog/rain/particle preset sweeps with frame-time history (details: [PERF.md](PERF.md)).
- [ ] Extend existing render timings with particle update/render, physics, projection and enemy timing/counts (details: [WEBGPU_WASM.md](WEBGPU_WASM.md)).
- [ ] Add seeded particle stress tests and a browser particle-stress mode; record measured baselines (details: [WEBGPU_WASM.md](WEBGPU_WASM.md)).
- [ ] Profile per-frame allocations before changing renderer/physics technology (details: [PERF.md](PERF.md)).
- [ ] Evaluate an optional accelerated renderer only if browser baselines show Canvas2D is the bottleneck (details: [PERF.md](PERF.md)).
- [ ] Explore WebGPU particles with CPU fallback, visual parity and bounded memory (details: [WEBGPU_WASM.md](WEBGPU_WASM.md)).
- [ ] Explore WASM car/track/enemy hot paths with JS fallback and deterministic parity tests (details: [WEBGPU_WASM.md](WEBGPU_WASM.md)).
- [ ] Evaluate a physics worker, WASM/JS boundary overhead and optional SharedArrayBuffer after baseline measurements (details: [WEBGPU_WASM.md](WEBGPU_WASM.md)).

## Audio / Presentation

- [ ] Build generative/dynamic music tooling and hazard-safe mixing
- [ ] Add speed-based wind and biome ambience (details: [../src/audio/README.md](../src/audio/README.md)).
- [ ] Explore Doppler/positional effects and tunnel/canyon reverb (details: [../src/audio/README.md](../src/audio/README.md)).
- [ ] Add audio-mix visualization for debugging (details: [../src/audio/README.md](../src/audio/README.md)).
- [ ] Evaluate optional tutorial/accessibility voice callouts without restoring automatic turn pacenotes by default (details: [PACENOTES.md](PACENOTES.md), [../src/audio/README.md](../src/audio/README.md)).

## Backend

- [ ] Move HTML pages out of the /api/ namespace.
- [ ] Audit backend input validation, injection risks and score/hit authority boundaries.

## Cleanups

- [ ] Tune surface/audio feel, especially gravel sliding and ice.
- [ ] Audit abbreviations, unused functions/classes and static-analysis options.
- [ ] Hide score submission as well as voting for practice finishes; voting is already hidden.
- [ ] Restrict enemy-health information to the intended role, including desktop views.
- [ ] Improve manual gearbox UX on mobile.
- [ ] Expand driver-poor-eyesight and navigator-excessive-firepower lore.

## Sequel / Deferred Extra Players

- [ ] Explore optional P3 engineer diagnostics/repairs for lights, radar, AC/cooling, alignment, power and cargo (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Prototype an optional P4 passenger/music role with confetti and a pettable dog after generative music tooling (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Preserve Intel/Hacker as an alternative specialist role with scouting, tagging and gate hacking (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Design 3-4-player room/role schemas and missing-role fallbacks; compare host-client and mesh before choosing (details: [COOP_MODE.md](COOP_MODE.md)).
- [ ] Explore on-foot top-down boss encounters as a separate mode/expansion, not merely re-enabling Colossus.

## Discarded ideas

- shake the phone to reload gun

## Deployment

- [ ] Make the TURN hostname DNS-only (or approve a separate DNS-only relay host) and verify a forced TURN session; backend/play-link/URL migration is complete (details: [DEPLOY.md](DEPLOY.md)).