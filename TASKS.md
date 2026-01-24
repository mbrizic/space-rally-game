# Space Rally - Development Tasks

## Core Features ✅
- Rally physics (bicycle model, drift detection, 6-speed manual/auto)
- Procedural tracks with surfaces (tarmac/gravel/dirt/ice)
- Multi-channel audio system (engine/tires/effects ready for guns)
- Water hazards beside track (off-road penalty)
- Minimap (toggle with M), pacenotes, checkpoints

## Known Issues
**⚠️ Track Variety Problem** - Tracks are repetitive and safe
- See `TRACK_VARIETY_NOTES.md` for full analysis
- Root cause: Retry logic rejects interesting hairpins to avoid overlaps
- Trade-off: 100% reliable generation vs. exciting variety

## What's Next - Plan

### Phase 1: Shooting Mechanics (New Gameplay)
**Goal**: Add weapons to make rally combat mode fun
- [ ] Gun system (player shoots from car)
  - Basic weapon (machine gun or similar)
  - Ammo/reload mechanics
  - Recoil/accuracy
- [ ] Targets on track
  - Aliens/zombies/obstacles to shoot
  - Spawning logic (distance-based)
  - Hit detection and destruction
- [ ] Scoring system
  - Points for targets hit
  - Time bonuses
  - Combo multipliers

### Phase 2: Combat Polish
- [ ] Visual effects for shooting (muzzle flash, impacts)
- [ ] Better audio effects (gunshots already synthesized in effects channel)
- [ ] HUD improvements (ammo counter, score display)
- [ ] Target variety (different types, speeds, values)

### Phase 3: Track Variety (Revisit)
- [ ] Fix track generation to allow more hairpins
  - Try "zoned layout" approach from notes
  - OR accept some visual overlaps with warnings
- [ ] Add elevation changes / jumps

### Phase 4: Multiplayer
- [ ] One drives, one shoots
- [ ] Network sync basics

## Backlog
- Weather effects
- Mobile controls