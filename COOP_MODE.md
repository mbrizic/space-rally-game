# Co-Op Mode Notes (Design)

This document contains design notes for the co-op mode so `TASKS.md` can stay as a short checklist.

## Core concept (“Blind Rally”)

Two players control one car:

- **Driver**: full physics/control, limited visibility.
- **Navigator**: tactical overview, aims/shoots, calls hazards.

## Phases / Ideas

### Phase A: Network foundation (done)

See `MULTIPLAYER.md` for:
- WebRTC signaling + TURN relay
- invite links + `hostKey`
- deployment + validation

### Phase B: Navigator info tools

Candidate features:
- **Ping/marker system**: navigator taps minimap to place a marker in the driver’s view (hazards, enemies, corners).
- Optional: “danger zones” and timed callouts.

### Phase C: Mobile-first layouts

- **Driver layout**: landscape, steering control + pedals, keep minimap readable.
- **Navigator layout**: landscape, aim/shoot controls + map interaction (tap/drag).

## Constraints

- Keep host authoritative.
- Minimize bandwidth (markers should be low-frequency events).
- UX should work on mobile + desktop.
