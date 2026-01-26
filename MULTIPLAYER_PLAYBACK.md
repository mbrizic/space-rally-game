# Multiplayer Playback / Client Smoothing

The current multiplayer model is:

- **Host authoritative** simulation.
- Client is primarily **render-only** and receives snapshots.

This document captures the remaining “client feels wonky / slight drift” issue so `TASKS.md` can stay slim.

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
- Position: lerp.
- Heading: shortest-arc lerp.
- Velocity: lerp + clamp spikes.

4) **Hard snap thresholds**
- If error exceeds a threshold (teleport / huge correction), snap immediately.

## Notes

This is separate from “refresh to connect” reliability issues, which are covered in `MULTIPLAYER.md`.
