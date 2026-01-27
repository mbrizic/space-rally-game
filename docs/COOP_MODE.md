# Co-Op Mode Notes (Design)

This document contains design notes for the co-op mode so `TASKS.md` can stay as a short checklist.

## Core concept (Co-Op Rally)

Two players control one car:

- **Driver**: drives and shoots.
- **Navigator**: tactical overview, aims/shoots, calls hazards.

Note: We removed the explicit “blind mode” fog-of-war mechanic; the game already limits forward information by only rendering a limited amount of road ahead.

## Phases / Ideas

### Phase A: Network foundation (done)

See `MULTIPLAYER.md` for:
- WebRTC signaling + TURN relay
- invite links + `hostKey`
- deployment + validation

### Phase B: Navigator info tools

Candidate features:
- Optional idea: **Ping/marker system** (navigator taps minimap to place a marker in the driver’s view).
- Optional: “danger zones” and timed callouts.

### Phase C: Mobile-first layouts

- **Driver layout**: landscape, steering control + pedals, keep minimap readable.
- **Navigator layout**: landscape, aim/shoot controls + map interaction (tap/drag).

## Constraints

- Keep host authoritative.
- Minimize bandwidth (markers should be low-frequency events).
- UX should work on mobile + desktop.
