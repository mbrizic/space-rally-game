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
- Optional: danger-zone annotations and timed warnings inside the minimap, not floating P2 callouts.

### Phase C: Mobile-first layouts

- **Driver layout**: landscape, steering control + pedals, keep minimap readable.
- **Navigator layout**: landscape, aim/shoot controls + map interaction (tap/drag).
- P1 sits slightly below its earlier position with unchanged zoom. P2 is vertically centred, still zoomed out relative to P1, with weapon/ammo controls beside Slow on the left.

## Constraints

- Keep host authoritative.
- UX should work on mobile + desktop.
- P2 reads weather-distance warnings only inside the minimap, never as floating notifications, in solo/host/client modes. No NARROW/DEBRIS distance labels: read narrow roads visually and mark each surviving debris patch with D. Checkpoint/finish/bullet-time notices remain separate; GO is suppressed while the route description is visible.
- Debris is concentrated into a few seeded short patches with clear gaps, more logs in rainforest than other biomes, and no placement in cities/quiet stretches. P2 waits for the host/driver to request the next job after finishing.

## Idea Audit (2026-10-12)

These are design candidates, not implementation commitments. Pending work is indexed in [TASKS.md](TASKS.md).

| Idea | Code status | Backlog status / remaining work |
| --- | --- | --- |
| Rain | Active: generated zones, grip changes, visuals and audio. | Already implemented; tune rather than rebuild. |
| Darkness / solar eclipse | Active: eclipse zones darken the scene and limit visibility. | Darkness and eclipse currently share one mechanism; full night stages and manual headlights remain separate ideas. |
| Sandstorm | Partial: zone serialization, grip/drag modifiers and minimap support; generation is disabled in every biome. | Chasing sandstorms were already proposed; enable/tune static storms and complete their presentation separately. |
| Heat wave | No heat-wave zone or thermal system. | New explicit event; heat haze, overheating and coolant leaks already appear as lore/design hooks. |
| P3 engineer | No third-player role; basic vehicle damage exists, but not repairable subsystems or collision-induced alignment faults. | Engineer/power management is already an idea; lights, radar, AC and wheel-alignment diagnosis extend it. Sequel scope. |
| P4 passenger / music | No fourth-player role, generative music, confetti command or pet interaction. | New role concept. Dynamic music was already an audio TODO; preserve the older Intel/Hacker concept as an alternative. Sequel scope. |
| Persistent pursuer | No stage-wide advancing threat; current enemies wander near roads, and the disabled Colossus travels along the route. | Chase events were already proposed; an original shadow/smoke entity is a new presentation option. |
| Rocky road | Gravel handling and fallen-log debris exist, but not sustained small-rock roughness. | New terrain behaviour, distinct from loose-surface grip and individual obstacles. |
| Wide roadless sand | Variable road widths and sand surfaces exist, but the road remains drawn. | New navigator-only route-reading mechanic, not just a larger road width. |
| Replay | Recording, state/input playback, storage and export/import exist; UI entry points are removed. | Reactivate the existing system; automatic backend replay verification was already pending. |
| Alien / magician P2 | Guns are the only player weapon types; electrical weather and boss fireballs are not player spells. | New alternate loadout with lightning/fire, using the same navigator aiming role. |
| Bazooka | Handgun, rifle, AK-47 and shotgun exist; no rocket weapon. | New weapon, including explosion damage rules rather than only explosion visuals. |
| Story / tutorial / time trial / endurance | Time Trial and Driving Practice are playable; other modes have no mode implementation. | Story/contracts already have lore foundations; guided tutorial and endurance are new explicit modes. Practice is not a tutorial. |

Sources: [stage generation](../src/sim/stage.ts), [runtime](../src/runtime/game.ts), [weapons](../src/sim/weapons.ts), [enemy behaviour](../src/sim/enemy.ts), [dormant features](DORMANT_FEATURES.md), [lore](LORE.md), and [audio plans](../src/audio/README.md).

## Current Two-Player Candidates

### Events And Terrain

- Rain, fog, electrical storms and eclipse darkness already work. Preserve surface-to-road colour mapping and use deterministic zones for new events.
- Sandstorms need normal desert generation, readable wind/dust presentation and navigator warnings. A moving storm that pursues the car is a different mechanic from a fixed storm zone.
- Heat waves could add heat haze first; overheating, AC and cooling management need explicit thermal state and fairness rules before affecting handling.
- Rocky sections should produce small deterministic suspension/yaw disturbances over a stretch, not random damage on every frame. Keep them visually distinct from gravel and fallen logs.
- Wide sand crossings should retain a hidden simulation route/checkpoints, while the driver sees open terrain and the navigator sees the continuation. Apply the same information rules on desktop and mobile; avoid minimap/debug/zoom revealing the answer. Provide readable entry/exit landmarks and a recoverable wrong-turn path.
- A pursuit event needs advance warning, a visible threat-distance indicator, a stage-progress model that survives hairpins, and rules for stopping, catching the car, finish lines and practice mode. Use an original pursuer design rather than copying an existing television character.

### Weapons And Alternate P2

- Bazooka: slow projectile, limited ammunition/reload, explosion radius and damage falloff. Decide self/friendly damage, destructible-prop interactions and co-op hit authority; existing explosion particles are not an area-damage system.
- Alien/magician navigator: keep map reading and aiming, replace the gun inventory with lightning and fire abilities. Candidate tradeoff: precise short bursts versus sustained area control, limited by energy/heat rather than bullets. This should remain an alternate loadout, not require P3/P4.

### Modes

- Time Trial: existing baseline; keep seeded stages and current leaderboards.
- Tutorial: short safe segments introducing steering/braking, surfaces, recovery, then the two-player navigator role. Driving Practice can supply the sandbox, but needs guided objectives and completion feedback.
- Story: town-to-town contracts, cargo/optional clauses and lightweight progression using the existing [lore](LORE.md); do not assume a campaign/save system already exists.
- Endurance: chained seeded stages, cumulative damage/ammunition and survival/distance scoring. Decide repairs between stages, failure/retry rules and multiplayer reconnect/resume policy.
- Replay: restore entry points for the existing recorder/player before adding new formats. Keep watching/downloading runs separate from server-side anti-cheat verification.

### Repair / Gate Interaction Ideas

Preserve the earlier two-player puzzle idea: an engine fault shows only part of a code to the driver, while the navigator consults a track-dependent manual. Possible inputs include gas+brake or gas+handbrake, lights/coolant buttons, held versus toggled controls, timed sequences and the speedometer. Hacking/breaking gates can reuse this communication loop; neither system is implemented.

## Sequel / Optional Extra Players

These roles are not required for the current two-player game. Disabled/missing roles must not make a contract unwinnable.

### P3: Engineer

Purpose: turn damage into diagnosis and coordinated field repairs rather than just another gunner.

- Engineer-only panel: lights, cooling/AC, wheel alignment, power allocation and optional cargo stability. Radar reports vehicle/system hazards; it should complement, not replace, P2's route map.
- Collisions can accumulate bounded faults in alignment/suspension. Only P3 sees the detailed diagnosis; P1 feels the pull or steering instability and reports symptoms. Avoid changing geometry after every tiny brush or creating permanently undriveable cars.
- Repair loop: identify the affected part, choose a repair, then coordinate a short safe window with P1/P2. Examples: request reduced speed for alignment, turn off lights before rewiring, or divert cooling while AC is unavailable.
- Balance with cooldowns, spare parts/power and a capped repair queue; keep driving the main action. Missing/disconnected P3 needs an automatic fallback or simpler two-player rules.
- Existing power/shield and [cargo-handler](LORE.md#p3-role-concept-cargo-tech--handler) ideas remain optional extensions; shields, thermal faults and cargo stability are not current systems.

### P4: Passenger / Music

Purpose: a welcoming, low-pressure role for a child, partner or anyone who prefers participation without precision driving/combat. The controls should not be gender- or relationship-specific.

- Music controls: choose mood/intensity and bring generative layers in/out, changing on musical boundaries rather than abrupt cuts. Build the generative music engine/tooling first; protect engine, hazard and voice audibility.
- Confetti: a small celebration action with bounded effects and a cooldown. It must not obscure the driver's view or trigger gameplay penalties.
- Pet the dog: a visible companion with gentle, repeatable reactions and no neglect/failure meter. Character assets/animation and this interaction are new work.
- Participation is optional, with no timing pressure or ability to make the team lose. Solo/two-player sessions get automatic music; late join/disconnect should be harmless.
- Previous P4 Intel/Hacker remains an alternative advanced role: scout drone, enemy tagging and hacking gates. It is not the same role as Passenger and is not selected for implementation.

### Networking Prerequisites (Deferred)

- Additional roles need room capacity, role selection, join/leave handling, input schemas and role-specific snapshots/UI.
- Keep driving/stage authority on the host; do not assume adding mesh removes host failure or simulation-authority problems.
- Evaluate extending the existing host-client star versus mesh only when extra players are actually scheduled. Engineer/passenger commands may need little bandwidth; mesh and consensus are not prerequisites by default.
- Define reconnect and missing-role fallbacks before adding mechanics that depend on a specialist.
