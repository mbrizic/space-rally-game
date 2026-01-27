# Performance Benchmarks

This repo includes a lightweight performance harness to track changes over time (by day + commit).

## Quick Start

Run:

```bash
npm run perf:run
```

Optional knobs:

```bash
PERF_LABEL=baseline PERF_SEED=123 npm run perf:run
```

- `PERF_LABEL` is a free-form string that helps you group runs (e.g. `baseline`, `fog-tweak`, `after-refactor`).
- `PERF_SEED` controls the procedural track seed so runs are comparable.

## What Gets Measured

The harness currently records:

- Build time (`npm run build`) in milliseconds
- Build size: total bytes of the `dist/` folder
- Bundle gzip sizes:
   - Entry JS gzip bytes (main JS)
   - Total `dist/` gzip bytes (excluding sourcemaps)
- Simulation microbenchmarks (CPU):
  - `pointOnTrack()` cost (ns/call)
  - `stepEnemy()` cost (ns/step)

These are intentionally stable, deterministic-ish, and easy to run in CI.

## Where Results Are Stored

- Append-only history: [perf/perf-history.tsv](perf/perf-history.tsv)
- Per-run JSON snapshots: `perf/runs/*.json` (gitignored)

### Percent Change Columns

The TSV includes `_pct` columns showing percent change relative to the immediately previous row:

- Positive is slower/larger (regression)
- Negative is faster/smaller (improvement)

Note: the first row has empty `_pct` values because there is no prior baseline.

## Planned: Rendering / FPS Bench (Browser)

We want an “official” rendering perf test that can answer:

- “Did FPS get worse after changing fog/rain/particles?”
- “How does p95 frame time move over time?”

### Recommended Approach: Record + Deterministic Playback

1. Add a `?perf=1` mode in the client that locks down a stable scene:
   - Fixed seed / fixed stage
   - Fixed graphics settings
   - Optional invincibility / disable enemy damage to avoid diverging outcomes

2. Add a run recorder:
   - Records input state per tick (driver + navigator)
   - Captures initial seed + settings

3. Add playback:
   - Feeds the recorded input stream at a fixed tick rate
   - Outputs frame stats (avg FPS, p50/p95 frame time, worst frame time)
   - Exposes a final summary via `window.__perfResults`

4. Automate with Playwright:
   - Launch Chromium
   - Load `/?perf=1&fog=...&rain=...`
   - Start playback
   - Read `window.__perfResults`
   - Append a row to a history file (TSV/JSON)

This is more reliable than an AI driver and is much closer to real gameplay.

## Options Beyond JS/Canvas2D

In rough “cost/benefit” order:

- Reduce per-frame allocations in hot loops (avoid repeated `.map/.filter` in the frame loop, reuse arrays)
- Move CPU-heavy sim work off the main thread (Web Worker)
- Add an optional WebGL renderer path (Canvas2D can become CPU-bound with lots of particles)

### WASM + WebGPU

See **[WEBGPU_WASM.md](WEBGPU_WASM.md)** for detailed implementation plans covering:

- **WebGPU particle system**: Move particles to GPU compute/render for 10x+ capacity
- **WASM physics**: Compile car/enemy/track simulation to Rust for 2-3x speedup

Key principle: establish baselines first (this harness + browser FPS bench), then measure improvements.

**Quick summary of best candidates for WASM:**
- Physics stepping (`stepCar`)
- Track projection / geometry helpers (`projectToTrack`)
- Enemy AI batched updates (`stepEnemy` × N)

**WebGPU is best for:**
- Particle simulation (compute shader)
- Particle rendering (instanced draw calls)
- Future: full 2D renderer with batching