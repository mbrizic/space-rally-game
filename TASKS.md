# Space Rally - Development Tasks

## Completed Core Features ✅
- Physics simulation (bicycle model, slip angles, traction circle, weight transfer)
- Drift detection and particle system (surface-specific smoke/dust)
- Engine simulation with 6-speed transmission (auto/manual with J/K)
- Audio system (engine and tire sounds)
- Point-to-point racing with procedural cities
- Pacenotes system (corner warnings)
- Track editor (press T)
- Deployment to production

## Recent Work ✅

### Visual Feedback & Surfaces
- [x] Distinct surface colors (tarmac, gravel, dirt, ice) with 35-50% opacity
- [x] Surface-specific shoulders and bright particles
- [x] Randomized surface patterns per track (not fixed order)

### Transmission & Controls  
- [x] 6-speed manual/automatic transmission (J/K to shift)
- [x] Rev limiter (power drops to 5% at max RPM)
- [x] Checkpoint notifications ("GO!", "Checkpoint 1/3", "FINISH!")
- [x] Larger RPM meter and gear display (60px)

### Track Generation & Quality 
- [x] Corner-based system: hairpin (~178°), sharp (~90°), medium, gentle, chicane
- [x] Strict unit tests: zero self-intersections, no long straights (>100m)
- [x] Retry logic: 15 attempts to find "good" track (see TRACK_VARIETY_NOTES.md)
- [x] Collision avoidance: "turn away" strategy, 70m separation
- [x] Trees/buildings check entire track (not just local segment)
- [x] Pacenotes use corner metadata (not curvature detection)
- [x] Minimap (toggle with 'M')

**⚠️ KNOWN ISSUE**: Retry logic rejects interesting hairpins → tracks are samey
- See TRACK_VARIETY_NOTES.md for full details of what we tried
- Trade-off: 100% reliable vs. variety/excitement
- Need: Smarter hairpin placement OR accept some visual overlaps

## Recent Work ✅ (continued)

### Visual Polish
- [x] Fixed visible circles on track (switched to filled polygons instead of stroked lines)
- [x] Fixed canvas clearing on retina displays
- [x] Made buildings and trees fully opaque (no grid bleeding through)

## Next Priority
- [ ] **FIX TRACK VARIETY** - See TRACK_VARIETY_NOTES.md for full context
  - Current: Retry logic rejects interesting hairpins (safe but boring)
  - Options: Zoned layout, outward spiral, accept visual overlaps, relaxed quality
- [ ] More track variety (jumps, elevation changes)

## Backlog
- [ ] Weather effects
- [ ] Mobile phone controls
- [ ] Multiplayer (one drives, one shoots)
- [ ] Shooting mechanics (aliens/zombies on track)