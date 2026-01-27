# WebGPU & WASM Implementation Plan

This doc covers the technical approach for migrating performance-critical systems to WebGPU (rendering) and WebAssembly (simulation). Both are **optional upgrades** — the game runs fine on Canvas2D + vanilla JS — but they unlock:

- 10x+ particle counts (WebGPU)
- More enemies/projectiles without frame drops (WASM)
- Future-proofing for more complex effects

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Main Thread                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │  Input   │→ │  Physics │→ │  Renderer (Canvas2D) │  │
│  │  (JS)    │  │  (JS)    │  │  - Car, track, UI    │  │
│  └──────────┘  └──────────┘  │  - Particles (CPU)   │  │
│                              │  - Enemies, props    │  │
│                              └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Bottlenecks identified:**
- Particle update/render (CPU-bound, scales poorly past ~10k)
- Physics stepping (fast, but blocks main thread)
- Track projection lookups (called many times per frame)

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Main Thread                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │  Input   │→ │  Physics │→ │  Renderer (Canvas2D) │  │
│  │  (JS)    │  │  (WASM)  │  │  - Car, track, UI    │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│                                        │               │
│                              ┌─────────▼─────────┐     │
│                              │  GPU Particles    │     │
│                              │  (WebGPU overlay) │     │
│                              └───────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 0: Baseline Measurements (DO THIS FIRST)

Before changing anything, establish performance baselines. Without these, you can't prove improvements.

### 0.1 Add Particle-Specific Timing

Add instrumentation to `src/runtime/game.ts`:

```typescript
// Near the top of the file
const perfTimings = {
  particleUpdateMs: 0,
  particleRenderMs: 0,
  physicsStepMs: 0,
  trackProjectionMs: 0,
  enemyUpdateMs: 0,
  frameTimeMs: 0,
  particleCount: 0,
};

// Make accessible for debugging
(window as any).__perfTimings = perfTimings;
```

Wrap the relevant calls in the game loop:

```typescript
// Particle update
const t0 = performance.now();
this.particlePool.update(dt);
perfTimings.particleUpdateMs = performance.now() - t0;
perfTimings.particleCount = this.particlePool.activeCount;

// Particle render
const t1 = performance.now();
this.particlePool.render(ctx, camera);
perfTimings.particleRenderMs = performance.now() - t1;

// Physics step
const t2 = performance.now();
stepCar(this.car, input, surface, dt);
perfTimings.physicsStepMs = performance.now() - t2;
```

### 0.2 Create Stress Test Scenarios

Add to `perf/particle-stress.perf.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ParticlePool } from "../src/runtime/particles";

describe("Particle Performance Baselines", () => {
  const scenarios = [
    { count: 1000, label: "light" },
    { count: 5000, label: "normal" },
    { count: 10000, label: "heavy" },
    { count: 25000, label: "stress" },
    { count: 50000, label: "extreme" },
  ];

  for (const { count, label } of scenarios) {
    it(`${label}: ${count} particles update time`, () => {
      const pool = new ParticlePool(count);
      
      // Emit all particles
      for (let i = 0; i < count; i++) {
        pool.emit({
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          vx: (Math.random() - 0.5) * 10,
          vy: (Math.random() - 0.5) * 10,
          lifetime: 2,
          sizeM: 0.5,
          color: "#ff0000",
        });
      }

      // Measure update over 100 frames
      const times: number[] = [];
      for (let frame = 0; frame < 100; frame++) {
        const t0 = performance.now();
        pool.update(1 / 60);
        times.push(performance.now() - t0);
      }

      const avg = times.reduce((a, b) => a + b) / times.length;
      const p99 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.99)];

      console.log(`[${label}] avg=${avg.toFixed(2)}ms p99=${p99.toFixed(2)}ms`);
      
      // Record to file for tracking
      // (integrate with existing perf harness)
    });
  }
});
```

### 0.3 Browser FPS Benchmark

Extend the `?perf=1` mode (mentioned in PERF.md) to include particle stress:

```typescript
// In game init, check for perf mode
const url = new URL(window.location.href);
if (url.searchParams.get("perf") === "particles") {
  // Spawn 20k particles continuously
  setInterval(() => {
    for (let i = 0; i < 500; i++) {
      this.particlePool.emit({ /* explosion config */ });
    }
  }, 100);
}
```

### 0.4 Baseline Targets

Before proceeding, record these numbers:

| Metric | Current (estimate) | Target (WebGPU) | Target (WASM) |
|--------|-------------------|-----------------|---------------|
| Max particles @ 60fps | ~10,000 | 100,000+ | N/A |
| Particle update (10k) | ~3-5ms | <0.5ms | N/A |
| Particle render (10k) | ~5-10ms | <1ms | N/A |
| Physics step | ~0.1-0.3ms | N/A | <0.05ms |
| Track projection (1k calls) | ~1ms | N/A | <0.3ms |
| Enemy step (100 enemies) | ~0.5ms | N/A | <0.15ms |

---

## Phase 1: WebGPU Particle System

### 1.1 Architecture

Keep Canvas2D for game objects. Add a transparent WebGPU canvas on top for particles only.

```html
<!-- index.html -->
<div id="game-container" style="position: relative;">
  <canvas id="game"></canvas>
  <canvas id="particles-gpu" style="position: absolute; top: 0; left: 0; pointer-events: none;"></canvas>
</div>
```

### 1.2 New Files

```
src/runtime/
  particles.ts          # Current CPU implementation (keep as fallback)
  particles-gpu.ts      # New WebGPU implementation
  webgpu-utils.ts       # Shader loading, device init, etc.
```

### 1.3 Implementation Sketch

```typescript
// src/runtime/particles-gpu.ts

export class GPUParticlePool {
  private device: GPUDevice | null = null;
  private particleBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  
  private maxParticles: number;
  private activeCount = 0;
  private stagingData: Float32Array;
  
  // Particle data layout (per particle):
  // [x, y, vx, vy, lifetime, maxLifetime, size, colorR, colorG, colorB, colorA, _pad]
  // = 12 floats = 48 bytes per particle
  private static FLOATS_PER_PARTICLE = 12;
  
  constructor(maxParticles: number) {
    this.maxParticles = maxParticles;
    this.stagingData = new Float32Array(maxParticles * GPUParticlePool.FLOATS_PER_PARTICLE);
  }
  
  async init(canvas: HTMLCanvasElement): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn("WebGPU not supported, falling back to CPU particles");
      return false;
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    
    this.device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) return false;
    
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device: this.device,
      format,
      alphaMode: "premultiplied", // Transparent overlay
    });
    
    // Create particle buffer (GPU-side storage)
    this.particleBuffer = this.device.createBuffer({
      size: this.stagingData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
    });
    
    // Create compute pipeline for physics update
    this.computePipeline = await this.createComputePipeline();
    
    // Create render pipeline
    this.renderPipeline = await this.createRenderPipeline(format);
    
    return true;
  }
  
  private async createComputePipeline(): Promise<GPUComputePipeline> {
    const shaderCode = `
      struct Particle {
        x: f32, y: f32, vx: f32, vy: f32,
        lifetime: f32, maxLifetime: f32, size: f32,
        r: f32, g: f32, b: f32, a: f32,
        _pad: f32,
      };
      
      struct Uniforms {
        dt: f32,
        gravity: f32,
        drag: f32,
        _pad: f32,
      };
      
      @group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
      @group(0) @binding(1) var<uniform> uniforms: Uniforms;
      
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        if (i >= arrayLength(&particles)) { return; }
        
        var p = particles[i];
        if (p.lifetime <= 0.0) { return; }
        
        // Physics update
        p.vy += uniforms.gravity * uniforms.dt;
        p.vx *= (1.0 - uniforms.drag * uniforms.dt);
        p.vy *= (1.0 - uniforms.drag * uniforms.dt);
        p.x += p.vx * uniforms.dt;
        p.y += p.vy * uniforms.dt;
        p.lifetime -= uniforms.dt;
        
        // Fade out
        let t = p.lifetime / p.maxLifetime;
        p.a = t;
        
        particles[i] = p;
      }
    `;
    
    const module = this.device!.createShaderModule({ code: shaderCode });
    
    return this.device!.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }
  
  emit(opts: ParticleEmitOptions): void {
    // Write to staging buffer, will be uploaded before next update
    // ... (similar to current CPU emit, but writes to Float32Array)
  }
  
  update(dt: number): void {
    if (!this.device || !this.computePipeline) return;
    
    // Upload any new particles from staging buffer
    this.device.queue.writeBuffer(this.particleBuffer!, 0, this.stagingData);
    
    // Dispatch compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.computePipeline);
    passEncoder.setBindGroup(0, this.computeBindGroup!);
    passEncoder.dispatchWorkgroups(Math.ceil(this.maxParticles / 64));
    passEncoder.end();
    
    this.device.queue.submit([commandEncoder.finish()]);
  }
  
  render(cameraX: number, cameraY: number, zoom: number): void {
    // Single draw call for all particles (instanced or point sprites)
    // ... render pipeline execution
  }
}
```

### 1.4 Fallback Strategy

```typescript
// src/runtime/particles-factory.ts

import { ParticlePool } from "./particles";
import { GPUParticlePool } from "./particles-gpu";

export type AnyParticlePool = ParticlePool | GPUParticlePool;

export async function createParticlePool(
  maxParticles: number,
  gpuCanvas?: HTMLCanvasElement
): Promise<AnyParticlePool> {
  if (gpuCanvas) {
    const gpu = new GPUParticlePool(maxParticles);
    const ok = await gpu.init(gpuCanvas);
    if (ok) {
      console.log("Using WebGPU particle system");
      return gpu;
    }
  }
  
  console.log("Using CPU particle system (fallback)");
  return new ParticlePool(maxParticles);
}
```

### 1.5 Success Criteria

- [ ] 50,000 particles at stable 60fps
- [ ] No visual regression (particles look the same)
- [ ] Graceful fallback on unsupported browsers
- [ ] Memory usage doesn't grow unbounded

---

## Phase 2: WASM Physics

### 2.1 Toolchain

**Recommended: Rust + wasm-pack**

```bash
# Install
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# New crate
cd src
wasm-pack new sim-wasm
```

**Alternative: AssemblyScript** (TypeScript-like, easier migration)

```bash
npm install --save-dev assemblyscript
npx asinit .
```

Rust is faster; AssemblyScript is more familiar. For physics, Rust's ~20% speed advantage matters.

### 2.2 What to Port

Start with hot paths identified in profiling:

1. **Car physics step** (`src/sim/car.ts` → `stepCar`)
   - Tire slip angles, traction circle, weight transfer
   - Called once per frame, but complex math

2. **Track projection** (`src/sim/track.ts` → `projectToTrack`)
   - Called many times per frame (car, enemies, projectiles)
   - Geometry-heavy

3. **Enemy AI step** (`src/sim/enemy.ts` → `stepEnemy`)
   - Called N times per frame (N = enemy count)
   - Scales with enemy count

### 2.3 Implementation Approach

**Keep JS↔WASM boundary coarse-grained.** Don't call WASM per-enemy; batch them.

```rust
// src/sim-wasm/src/lib.rs

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CarState {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub heading: f64,
    pub yaw_rate: f64,
    pub steer_angle: f64,
    // ... rest of car state
}

#[wasm_bindgen]
pub struct InputState {
    pub steer: f64,
    pub throttle: f64,
    pub brake: f64,
    pub handbrake: f64,
}

#[wasm_bindgen]
pub struct Surface {
    pub friction_mu: f64,
    pub rolling_resistance: f64,
}

#[wasm_bindgen]
impl CarState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> CarState {
        CarState {
            x: 0.0, y: 0.0, vx: 0.0, vy: 0.0,
            heading: 0.0, yaw_rate: 0.0, steer_angle: 0.0,
        }
    }
    
    /// Step physics for dt seconds. Returns telemetry packed as [slipF, slipR, load, ...]
    pub fn step(&mut self, input: &InputState, surface: &Surface, dt: f64) -> Vec<f64> {
        // All the tire physics from car.ts, ported to Rust
        // ...
        
        // Return telemetry as flat array (avoids object allocation overhead)
        vec![slip_front, slip_rear, load_front, load_rear]
    }
}

// Batch enemy update for efficiency
#[wasm_bindgen]
pub fn step_enemies(
    // Flat arrays: [x0, y0, vx0, vy0, x1, y1, vx1, vy1, ...]
    positions: &mut [f64],
    velocities: &mut [f64],
    target_x: f64,
    target_y: f64,
    dt: f64,
    count: usize,
) {
    for i in 0..count {
        let idx = i * 2;
        let x = positions[idx];
        let y = positions[idx + 1];
        
        // Simple chase AI
        let dx = target_x - x;
        let dy = target_y - y;
        let dist = (dx * dx + dy * dy).sqrt();
        
        if dist > 0.1 {
            let speed = 5.0; // m/s
            velocities[idx] = (dx / dist) * speed;
            velocities[idx + 1] = (dy / dist) * speed;
        }
        
        positions[idx] += velocities[idx] * dt;
        positions[idx + 1] += velocities[idx + 1] * dt;
    }
}
```

### 2.4 JS Integration

```typescript
// src/sim/car-wasm.ts

import init, { CarState, InputState, Surface } from "../sim-wasm/pkg";

let wasmReady = false;
let wasmCar: CarState | null = null;

export async function initWasmPhysics(): Promise<boolean> {
  try {
    await init();
    wasmReady = true;
    return true;
  } catch (e) {
    console.warn("WASM physics unavailable, using JS fallback");
    return false;
  }
}

export function createWasmCarState(): CarState | null {
  if (!wasmReady) return null;
  return new CarState();
}

// Wrapper that matches existing JS API
export function stepCarWasm(
  car: CarState,
  input: { steer: number; throttle: number; brake: number; handbrake: number },
  surface: { frictionMu: number; rollingResistanceN: number },
  dt: number
): { slipFront: number; slipRear: number } {
  const wasmInput = new InputState();
  wasmInput.steer = input.steer;
  wasmInput.throttle = input.throttle;
  wasmInput.brake = input.brake;
  wasmInput.handbrake = input.handbrake;
  
  const wasmSurface = new Surface();
  wasmSurface.friction_mu = surface.frictionMu;
  wasmSurface.rolling_resistance = surface.rollingResistanceN;
  
  const telemetry = car.step(wasmInput, wasmSurface, dt);
  
  return {
    slipFront: telemetry[0],
    slipRear: telemetry[1],
  };
}
```

### 2.5 Build Integration

```json
// package.json
{
  "scripts": {
    "build:wasm": "cd src/sim-wasm && wasm-pack build --target web --out-dir ../sim-wasm-pkg",
    "build": "npm run build:wasm && tsc -b && vite build"
  }
}
```

### 2.6 Success Criteria

- [ ] Physics step time reduced by 50%+
- [ ] No simulation divergence (same inputs → same outputs as JS)
- [ ] Clean fallback to JS if WASM fails to load
- [ ] Bundle size increase < 100KB gzipped

---

## Phase 3: Combined Optimizations

After both WebGPU and WASM are working:

### 3.1 Move Physics to Web Worker

```typescript
// src/workers/physics-worker.ts
import init, { CarState, step_enemies } from "../sim-wasm-pkg";

let car: CarState;

self.onmessage = async (e) => {
  const { type, data } = e.data;
  
  switch (type) {
    case "init":
      await init();
      car = new CarState();
      self.postMessage({ type: "ready" });
      break;
      
    case "step":
      const { input, surface, enemies, dt } = data;
      car.step(input, surface, dt);
      step_enemies(enemies.positions, enemies.velocities, car.x, car.y, dt, enemies.count);
      
      self.postMessage({
        type: "state",
        car: { x: car.x, y: car.y, heading: car.heading, /* ... */ },
        enemies: enemies.positions,
      });
      break;
  }
};
```

### 3.2 SharedArrayBuffer for Zero-Copy

If you need even lower latency:

```typescript
// Main thread and worker share memory
const sharedBuffer = new SharedArrayBuffer(1024 * 1024); // 1MB
const carState = new Float64Array(sharedBuffer, 0, 16);  // First 128 bytes
const enemyPositions = new Float64Array(sharedBuffer, 128, 1000); // Next 8KB

// Worker writes directly, main thread reads directly
// No postMessage overhead
```

---

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WebGPU | 113+ | 🚧 Nightly | 17+ (flag), 26+ (default) | 113+ |
| WASM | ✅ All | ✅ All | ✅ All | ✅ All |
| SharedArrayBuffer | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ✅ (COOP/COEP) |

**Recommendation:** Ship WASM first (universal support), WebGPU second (progressive enhancement).

---

## Checklist

### Phase 0 (Baselines)
- [ ] Add `perfTimings` instrumentation to game loop
- [ ] Create particle stress test in perf harness
- [ ] Add `?perf=particles` stress mode
- [ ] Record baseline numbers in this doc
- [ ] Set up browser FPS benchmark with Playwright

### Phase 1 (WebGPU)
- [ ] Create `particles-gpu.ts` with WebGPU init
- [ ] Implement compute shader for particle physics
- [ ] Implement render pipeline for particle drawing
- [ ] Add transparent canvas overlay
- [ ] Create factory with fallback logic
- [ ] Verify visual parity with CPU particles
- [ ] Benchmark: confirm 5x+ particle capacity

### Phase 2 (WASM)
- [ ] Set up Rust + wasm-pack toolchain
- [ ] Port `stepCar` to Rust
- [ ] Port `projectToTrack` to Rust
- [ ] Port `stepEnemy` to Rust (batched)
- [ ] Create JS wrapper with same API
- [ ] Add fallback to JS implementation
- [ ] Benchmark: confirm 2x+ speedup

### Phase 3 (Advanced)
- [ ] Move physics to Web Worker
- [ ] Evaluate SharedArrayBuffer for latency
- [ ] Profile and optimize WASM↔JS boundary

---

## References

- [WebGPU Fundamentals](https://webgpufundamentals.org/)
- [wasm-bindgen Guide](https://rustwasm.github.io/docs/wasm-bindgen/)
- [WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)
- [Raw WebGPU Tutorial](https://alain.xyz/blog/raw-webgpu)
