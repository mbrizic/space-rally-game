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

## Future Ideas
- [ ] Better looking tracks - maybe with few different renderers, so each stage can be rendered in different style
- [ ] More track variety (jumps, elevation changes)
- [ ] Weather effects
- [ ] Manual gearbox
- [ ] Mobile phone controls

## Long-term crazy ideas (that I still want to have)
- [ ] The ability to shoot from the car, to kill enemy aliens/zombies who spawn across the track
- [ ] Multiplayer - one player drives, the other shoots
- [ ] Gravity simulation and dynamic changing of it