# Space Rally - Development Tasks

## Current Focus
- (Next) **SERVER INFRA** work (separate branch)

## Core Features ✅
- Rally physics (bicycle model, drift detection, 6-speed manual/auto)
- Procedural tracks with surfaces (tarmac/gravel/dirt/ice)
- Multi-channel audio system (engine/tires/effects)
- Water hazards beside track (off-road penalty)
- Minimap (toggle with `M`) with surface colors, START/FINISH, enemies
- Shooter mode: weapons + mobile weapon buttons + touch hold-to-fire

## Known Issues
**⚠️ Track Variety Problem** - Tracks are repetitive and safe
- See `TRACK_VARIETY_NOTES.md` for full analysis
- Root cause: Retry logic rejects interesting hairpins to avoid overlaps
- Trade-off: 100% reliable generation vs. exciting variety

**⚠️ Pacenotes Bug** - Hidden as they are not working correctly; logic needs review or removal.

## What's Next - Plan: "Blind Driver" Co-Op

**Concept**: A high-speed asymmetric multiplayer rally.
- **Player 1 (Driver)**: Excellent physics/control, but **terrible vision** (Fog of War / Blindness).
- **Player 2 (Navigator)**: Full tactical map visibility, marks hazards and shoots targets for the driver.

### Phase 1: The "Blind" Prototype (Tech Foundation)
- [ ] **Input Decoupling**: Refactor `Game` to support remote input sources.
  - Split `KeyboardInput` into `DriverInput` (Steering/Gas) and `GunnerInput` (Aim/Map).
- [ ] **WebRTC Link**: Implement P2P connection using `peerjs`.
  - Node.js "Handshake" server -> Direct Browser-to-Browser link.
- [ ] **Fog Mechanic**:
  - Implement heavy rendering fog for the Driver view (~50m visibility).
  - Ensure Navigator has clear "Satellite" view (unlimited draw distance).

### Phase 2: Navigation & Information Warfare
- [ ] **Navigator HUD**:
  - Full-screen tactical map overlay.
  - "Ping" system: Clicking map places 3D markers in Driver's view (ice, rocks, corners).
- [ ] **Shooting Integration**:
  - Navigator controls the turret to clear obstacles/enemies.
  - Driver focuses purely on survival/speed.

### Phase 3: Mobile Controls
- [ ] **Driver Layout**: Landscape. Virtual joystick steering + right-thumb pedals.
- [ ] **Navigator Layout**: Landscape. Tap-to-ping map, drag-to-aim turret.

### Backlog (P3/P4 Ideas)
- **Player 3 (Engineer)**: Manages power distribution (Shield/Engine/Weapons) and damage control.
- **Player 4 (Intel/Hacker)**: Operates a forward-scout drone to tag hazards or hack gates.
- **Weather**: Dynamic sandstorms affecting visibility.
- **Bullet Time**: Cooperative slowdown mechanics.
