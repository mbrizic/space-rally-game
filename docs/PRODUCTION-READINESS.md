# Production Readiness

## Accepted Caveats
- 2026-10-12: Preserve all existing leaderboard times intact. The updated generator changes layouts for the same seeds, so historical times may not be directly comparable to new runs. This is accepted, not a release blocker; no score reset, migration, or leaderboard separation is requested.

- [ ] Upload recorded replays for backend run verification

## Remaining Gates
- [ ] Fix public TURN DNS/proxy routing and verify a forced relay session: after the 2026-10-12 backend migration, the new hostname's TCP 3478 times out through Cloudflare, while the origin is reachable (details: [DEPLOY.md](DEPLOY.md)).

## Verified Operations
- 2026-10-12: Backend/play link and advertised TURN URLs migrated to spacerally.hexagonflux.hr; health and both containers verified. Scores backed up on-server and the original data volume retained; shared secret unchanged.