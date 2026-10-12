# Pacenotes

This document captures the pacenotes situation so `TASKS.md` can stay as a short checklist.

## Status

Pacenotes are **removed**.

Rationale:
- The intended experience is a real co-driver reading the map and calling turns.
- Pacenotes UI/logic was distracting and not robust.

Code note:
- There is no current `src/sim/pacenotes.ts` module. Navigator weather/zone distances are minimap-only, never floating P2 notifications. NARROW/DEBRIS distance labels are removed; concentrated debris patches use D markers. These are not automated turn pacenotes; the rule applies in solo, host and client roles.

## Related

- Track generation constraints and variety: `TRACK_VARIETY_NOTES.md`
