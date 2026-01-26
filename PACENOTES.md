# Pacenotes

This document captures the pacenotes situation so `TASKS.md` can stay as a short checklist.

## Current state

- Pacenotes exist in code (`src/sim/pacenotes.ts`) but are currently not behaving well and are effectively disabled/hidden.

## Decision needed

Pick one:

1) **Fix + re-enable**
- Define the desired UX (where notes appear, timing, formatting).
- Make the generation deterministic and stable across track seeds.
- Verify notes align with the actual track geometry after smoothing.

2) **Remove**
- Delete the pacenotes system and any UI hooks.
- Keep the co-op “Navigator” as the primary source of guidance.

## Related

- Track generation constraints and variety: `TRACK_VARIETY_NOTES.md`
