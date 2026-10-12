# Space Rally Agent Guide

## Architecture
- TypeScript/Vite game using Canvas 2D, Web Audio, and custom physics; see [README.md](README.md).
- `src/main.ts` wires the UI; `src/runtime/` owns the game loop, rendering, input, snapshots, and replay.
- `src/sim/` owns physics and procedural stages. Preserve seeded generation, serialization compatibility, and track safety constraints; use the existing RNG and colocated tests.
- `src/audio/` owns procedural sound; preserve browser audio-unlock behavior. See [audio notes](src/audio/README.md).
- `src/net/` owns WebRTC sessions and backend calls. The driver/host is authoritative; the navigator is a client.
- `server/` is a separate Bun/SQLite backend; `turn/` runs signaling and coturn via Docker Compose.

## Workflow
- Keep changes scoped and preserve the existing module boundaries; do not introduce a new physics engine or framework without agreement.
- P2 weather-distance callouts belong only inside the minimap, never in floating notifications. Do not show NARROW/DEBRIS distance labels anywhere; show concentrated debris patches as D markers. Enforce this in solo/host/client modes.
- Do not commit or push automatically. Wait for manual feature acceptance, then commit/push only when the user explicitly asks.
- Install with `npm install`; develop with `npm run dev`.
- After code changes, run `npx tsc --noEmit` and `npm test`; use nearby `*.test.ts` tests for focused checks.
- For routine gameplay/UI tuning, use basic automated checks and hand off for user playtesting; do not run OCR/browser visual checks unless requested.
- `npm run build` typechecks and bundles the frontend. Root typecheck/tests do not cover `server/src/`.
- Use `npm run perf:run` for performance changes; see [performance notes](docs/PERF.md).
- Do not hand-edit generated `dist/`, `coverage/`, dependencies, or build metadata.
- Keep [the backlog](docs/TASKS.md) to pending one-liners; remove completed items and add a short task entry to the README project log.

## Deployment
- Never deploy unless explicitly requested. Frontend `npm run deploy` defaults to **test**; production requires an explicit production request.
- Backend `./deploy-server.sh prod` is **production-only** and restarts signaling and TURN; do not treat it as a test deploy or run it with `test`.
- Follow [deployment instructions](docs/DEPLOY.md) and [backend setup](server/README.md); scripts define actual behavior if docs drift.
- Keep invite `hostKey` values, TURN shared secrets, credentials, and database contents out of logs and commits.

## Detailed Docs
- [Multiplayer architecture](docs/MULTIPLAYER.md), [snapshot playback](docs/MULTIPLAYER_PLAYBACK.md), [co-op design](docs/COOP_MODE.md).
- [Track variety and safety](docs/TRACK_VARIETY_NOTES.md), [pacenotes](docs/PACENOTES.md).
- [Backend API](server/API.md), [dormant features](docs/DORMANT_FEATURES.md).
- [Lore](docs/LORE.md), [future WebGPU/WASM work](docs/WEBGPU_WASM.md).