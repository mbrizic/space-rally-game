# Multiplayer Playback / Client Smoothing

The current multiplayer model is:

- **Host authoritative** simulation.
- Client receives authoritative vehicle/stage snapshots, but navigator projectiles/hit detection are locally simulated (see [MULTIPLAYER.md](MULTIPLAYER.md)).
- Navigator weather distances stay inside the minimap, with D debris-patch markers instead of NARROW/DEBRIS distance labels; smoothing, replay or role changes must not reintroduce floating P2 callouts or duplicate network zoom scaling.

This document captures the remaining “client feels wonky / slight drift” issue so `TASKS.md` can stay slim.

Status audit (2026-10-12): component position/heading/velocity smoothing and forward prediction already exist in the runtime. The symptom below is a historical report, not a newly reproduced failure. Reproduce under controlled jitter before changing smoothing; evaluate a snapshot queue, stable timebase and correction policy rather than re-adding component interpolation.

## Symptom

- Client view can slowly bias left/right while driving straight.
- Occasional twitch on large corrections.

## Likely causes

- Timestamp alignment / clock drift between peers.
- Smoothing that blends states without a stable interpolation buffer.
- Applying corrections in world-space without preserving heading/velocity coherence.

## Candidate fixes

1) **Render behind with a snapshot buffer**
- Keep a short queue of snapshots (e.g. 100–150ms).
- Render interpolated state at `now - bufferDelay`.

2) **Better timebase**
- Include a monotonically increasing host tick/time with each snapshot.
- Use that to drive interpolation instead of local `Date.now()`.

3) **Interpolation by state components**
- Already implemented in the runtime; validate and tune rather than rebuild.
- Position: lerp.
- Heading: shortest-arc lerp.
- Velocity: lerp + clamp spikes.

4) **Hard snap thresholds**
- If error exceeds a threshold (teleport / huge correction), snap immediately.

## Notes

This is separate from “refresh to connect” reliability issues, which are covered in `MULTIPLAYER.md`.
