# Space Rally - Development Tasks

## Current Focus
- **SERVER INFRA** (current, `server-infra` branch)

### Status (as of now)
- ✅ Bun WebSocket signaling server (`server/`) for WebRTC SDP/ICE relay
- ✅ In-game pairing panel (“LINK”) + room codes + copy link
- ✅ WebRTC DataChannel connected host/client prototype
- ✅ Host-authoritative simulation → client receives snapshots (car/enemies/projectiles)
- ✅ Client sends Navigator inputs → host applies aim/shoot/weapon
- ✅ Particle effects replicated via lightweight “particle events”
- ✅ Prod deployment script works reliably with non-interactive SSH (explicit Bun + PM2 paths)
- ✅ Client blood/death particles now replicate for car-impact enemy kills (host emits `enemyDeath` event)
- ✅ Tanks feel less “immovable” + car has more collision HP (tuning pass)
- ⚠️ Client playback smoothing still needs another pass (small residual drift / “wonky” feel under fast motion)

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

**⚠️ Multiplayer Playback (Client) - Slight Drift / Wonky**
- Current approach is smoothing + a small predictive lookahead.
- Remaining issue: client can slowly bias left/right even while driving straight; also occasional twitch on big corrections.
- Likely needs: render-time interpolation buffer (render slightly behind), better timestamp alignment, and/or more principled reconciliation.

**⚠️ Pacenotes Bug** - Hidden as they are not working correctly; logic needs review or removal.

## What's Next - Plan: "Blind Driver" Co-Op

**Concept**: A high-speed asymmetric multiplayer rally.
- **Player 1 (Driver)**: Excellent physics/control, but **terrible vision** (Fog of War / Blindness).
- **Player 2 (Navigator)**: Full tactical map visibility, marks hazards and shoots targets for the driver.

### Phase 1: The "Blind" Prototype (Tech Foundation) ✅
- [x] **WebRTC Link (Prototype)**: P2P DataChannel + Bun signaling (no `peerjs` yet).
- [x] **Input Decoupling**: Driver remote controls (steer/throttle/brake/handbrake) + authority rules.
- [ ] **TURN Fallback**: Add `coturn` + credentials for hard NAT/cellular networks.
- [x] **Reconnect / Resume**: Handle tab refresh + persistent roles (`host=1` param) + auto-reconnect.
- [x] **Fog Mechanic**: Heavy rendering fog for Driver (~45m visibility); clear "Satellite" view for Navigator. (Currently disabled while tuning.)

### Infra Notes (Where things stand)
- Signaling endpoints: client resolves to `/api/ws` by default (no forced localhost); dev server proxies `/api`.
- Prod deploy: `deploy-server.sh` assumes Bun at `~/.bun/bin/bun` and PM2 installed in the configured Node/NVM path on the host.

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

## Notes / Known Limitations (Server Infra Prototype)
- Client is “render-only” (does not simulate), so the experience depends on snapshot rate + smoothing.
- Audio is not synced.
- Particles are synced as events (not full particle state), to keep bandwidth reasonable.

### Backlog (P3/P4 Ideas)
- **Player 3 (Engineer)**: Manages power distribution (Shield/Engine/Weapons) and damage control.
- **Player 4 (Intel/Hacker)**: Operates a forward-scout drone to tag hazards or hack gates.
- **Weather**: Dynamic sandstorms affecting visibility, rain affecting traction, electrical storms affecting electronics like a minimap.
- **Bullet Time**: Cooperative slowdown mechanics.
