import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["perf/**/*.perf.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Benchmarks should be deterministic and not run in parallel by default.
    // (Vitest may still shard in CI; keep each test self-contained.)
    pool: "forks"
  }
});
