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

## Future Ideas
- [ ] Guns (as mentioned in README)
- [ ] Multiplayer/ghost racing
- [ ] More track variety (jumps, elevation)
- [ ] Weather effects
- [ ] Car customization
