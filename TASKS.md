# Space Rally - Development Tasks

## Phase 1: Core Physics ✅
- [x] Scaffold Vite + Canvas2D
- [x] Fixed-timestep loop + keyboard input
- [x] Grid + HUD debug overlay
- [x] Placeholder car movement + draw
- [x] Vehicle dynamics v1 (bicycle model + slip angles)
- [x] Pedal steering core (traction circle + weight transfer)
- [x] Handbrake turns
- [x] Track (polyline ribbon) + checkpoints + timer
- [x] Smooth track (spline sampling)
- [x] Surfaces (tarmac/gravel/dirt) + off-track penalties
- [x] Hard track-edge collisions
- [x] Start countdown + GO

## Phase 2: Drift & Feedback ✅
- [x] Drift detection + HUD indicator (slip/saturation-based)
- [x] Particle system (pooled) + drift smoke/dust by surface
- [x] Track width variance by s (narrow/wide sections)
- [x] Add swerve/chicane sections to the track layout
- [x] Update off-track + collisions/rendering to respect varying width
- [x] Feedback polish: collision punch, clearer damage + surface cues

## Phase 3: Audio & Engine ✅
- [x] Engine simulation (engine.ts) with RPM and power curves
- [x] Modular audio system (audio-engine.ts, audio-slide.ts)
- [x] Surface-dependent sliding sounds
- [x] RPM Meter HUD and gear indicator
- [x] Composable architecture for sim/audio components
- [x] Procedural track generation
- [x] Pacenotes (corner warnings)
- [x] Runner camera mode
- [x] Track editor (add/move/delete points)
- [x] Save/load custom tracks

## Phase 4: Polish & Deployment ✅
- [x] Smoothed camera rotation for runner mode (reduced motion sickness)
- [x] Increased brake power (42000N) and handbrake (16000N)
- [x] Increased engine power (32000N)
- [x] Narrower tracks (7.5m) and tighter turns (60m radius)
- [x] Ice surface patches with low friction (0.35μ)
- [x] Force arrows hidden by default
- [x] Deployment script and documentation (deploy.sh, DEPLOY.md)
- [x] Security audit for public repository
- [x] Comprehensive test suite (39 tests covering 5 modules)
  - Engine simulation tests (11 tests)
  - Surface type tests (4 tests)
  - Track generation tests (12 tests)
  - Drift detection tests (6 tests)
  - Car physics tests (6 tests)
- [x] Bug fix: Division by zero in rpmFraction
- [x] Updated README with vibe-coding quote and hosting info
- [x] Deployed to https://spacerally.supercollider.hr/

## Phase 5: Point-to-Point Racing & Cities ✅
- [x] Convert from lap-based to point-to-point racing system
- [x] Procedural city generation with grid-based building layout
- [x] Cities with 20m road corridors (prevent building/road collisions)
- [x] Removed isLoop system - all tracks are point-to-point
- [x] Fixed track rendering (no wraparound segments)
- [x] Proper race timing with start/finish lines
- [x] Cities positioned BEFORE start/finish lines
- [x] Building collision detection with proper hitboxes
- [x] Runner camera mode as default
- [x] Camera positioned lower to see more ahead (3m offset)
- [x] Massively increased particle effects (gravel: 120/s, dirt: 100/s)
- [x] Fixed handbrake particle triggering

## Phase 6: Track Variety & Feedback ✅
- [x] Hairpin turns (0-2 per track, ~180-degree turns with 25-40m radius)
- [x] 90-degree sharp corners (0-2 per track, 30-50m radius)
- [x] Improved track variety with mixed corner types
- [x] Wheelspin detection and visual feedback
- [x] Wheelspin particles when full throttle exceeds grip (especially on low-grip surfaces)
- [x] Fixed pacenotes to only call out real corners (higher thresholds, minimum 15m length)
- [x] Pacenotes ignore grade-6 (very gentle) curves
- [x] Speed-scaled lookahead (45-105m based on speed)
- [x] Reduced wheelspin intensity (especially on tarmac)

## Phase 7: Surface Visual Feedback ✅
- [x] Distinct colors for each surface type (35-50% opacity instead of 10-14%)
  - Tarmac: Dark gray (70,75,85) - asphalt look
  - Gravel: Tan/beige (180,155,110) - gravel look
  - Dirt: Brown (140,100,70) - dirt look
  - Ice: Light blue (180,220,245) - ice look
  - Offtrack: Green-gray (100,130,90) - grass look
- [x] Surface-specific shoulder colors (darker variants of each surface)
- [x] Wider, more visible shoulders (1.40x track width)
- [x] Brighter road borders (white 15% opacity, thicker)
- [x] More visible centerline (20% opacity, longer dashes)
- [x] Improved overall visual clarity for different surfaces
- [x] Enhanced particle prominence
  - 30-52% bigger particles (gravel up to 0.42m)
  - 70-85% opacity (much brighter colors)
  - Longer lifetimes (particles linger more)
  - Added subtle glow effect with shadow blur
- [x] Fixed track generation bug and restored exciting features
  - **Track Length**: MUCH LONGER! 800-1400m routes (was 400-600m)
    - Total track length: 900-1600m (was 500-700m)  
    - Races now take 40-60 seconds (was too short at 25 seconds)
  - **REAL HAIRPINS RESTORED**: 85-90° × 2 = proper ~180° hairpins!
  - **Sharp 90-degree corners**: 77-99° turns for exciting gameplay
  - **Balanced angle limits**: 200° total turning (was overly strict 108°)
  - **Randomized surfaces**: No longer fixed order!
    - 6-10 random segments per track based on seed
    - Weighted probabilities: 35% tarmac, 30% gravel, 20% dirt, 15% ice
    - Slight friction/resistance variance for variety
  - Minimum 350m city separation still enforced
  - **STRESS TESTED**: 5 comprehensive unit tests over **1000+ track generations**
    - 500 tracks: ✅ 100% cities 350m-1355m apart
    - 200 tracks: ✅ Max individual angle 116° (proper hairpins!)
    - 200 tracks: ✅ Min straight-line ratio 24.6% (allows technical sections)
    - 200 tracks: ✅ Max reverse 179.9° (real hairpins!)
    - 200 tracks: ✅ Lengths 895-1597m
  - Zero failures - hairpins work perfectly without cities overlapping!

## Phase 8: Manual Gearbox ✅
- [x] Automatic transmission as DEFAULT mode
- [x] J/K keys for gear shifting (downshift/upshift)
- [x] Toggle option in tuning panel to switch to manual
- [x] Engine respects manual mode (no auto-shifting)
- [x] PROMINENT gear display (60px bold, bright blue)
- [x] Added "GEAR" label for clarity
- [x] Updated controls: T for editor (was E), J/K for shifting
- [x] Editor save/load changed to 1/2 keys

## Phase 9: Track Generation Quality & Corner System ✅
- [x] **Corner-Based Track Generation**
  - Predefined corner types: hairpin (~178°), sharp (~90°), medium (~63°), gentle (~36°), chicane
  - 5-7 corners per track (was 8-13) for better spacing
  - 20% hairpins, 25% sharp, 25% medium, 15% gentle, 15% chicanes
  - Longer tracks: 1000-1600m (increased from 800-1400m)
- [x] **Zero-Tolerance Unit Tests**
  - Self-intersection test: ZERO crossing segments allowed (strict)
  - Straightness test: No segments > 100m straight anywhere
  - 500-track stress test: 100% must pass quality checks
  - All tests passing: 7/7 self-intersection + 3/3 straightness ✅
- [x] **Retry Logic for Quality Guarantee**
  - Up to 15 attempts per track to meet quality standards
  - Checks for self-intersections AND long straights
  - Returns only tracks that pass both checks
  - Result: 100% tracks meet standards (0/500 failures)
- [x] **Improved Collision Avoidance**
  - "Turn Away" strategy: actively avoids previous track sections
  - 180m search radius (was 100m)
  - 70m minimum separation (was 50m)
  - Urgency-based turning: 50-100% turn based on proximity
- [x] **Increased Obstacle Clearances**
  - Buildings: 5m from track (was 2m) - no more city blocks on road!
  - Trees: 3m from track (was 1.5m)
  - All obstacles check against ENTIRE track, not just local segment
- [x] **Pacenotes Integration with Corner Metadata**
  - Track generation records all planned corners (type, position, angle)
  - Pacenotes use actual corner data instead of detecting curvature
  - Accurate grading: Hairpins show as "L1/R1", sharp as "L2/R2", etc.
  - Fixed scan logic: properly finds corners 40-240m ahead
  - Debug logging (1% of calls) for troubleshooting
- [x] **Minimap Feature**
  - Toggleable with 'M' key
  - Shows full track, cities, and car position
  - Top-right corner placement with auto-scaling
  - Semi-transparent background

### Known Issues / TODO:
⚠️ **MAJOR: Tracks are samey and boring!**
- Retry logic rejects most interesting tracks (hairpins often cause loops)
- Trade-off: 100% reliable tracks vs. variety/excitement
- **Need better solution:**
  - Predict loops BEFORE placing hairpins
  - Smarter "turn away" that preserves corner types
  - Or accept visual overlaps if not driveable intersections
  - Current approach: safe but dull (documented in track.ts)

## Future Ideas
- [ ] **FIX TRACK VARIETY** (Priority #1 after today's session!)
  - Smarter hairpin placement without retry rejection
  - More varied track layouts while maintaining quality
- [ ] Better looking tracks - maybe with few different renderers, so each stage can be rendered in different style
- [ ] More track variety (jumps, elevation changes)
- [ ] Weather effects
- [ ] Mobile phone controls

## Long-term crazy ideas (that I still want to have)
- [ ] The ability to shoot from the car, to kill enemy aliens/zombies who spawn across the track
- [ ] Multiplayer - one player drives, the other shoots
- [ ] Gravity simulation and dynamic changing of it