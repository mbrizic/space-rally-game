import { describe, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { createProceduralTrackDefinition, createTrackFromDefinition, pointOnTrack } from "../src/sim/track";
import { generateEnemies, stepEnemy } from "../src/sim/enemy";

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function sumDirBytes(dir: string): number {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += sumDirBytes(p);
    else if (e.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

function nsPerOp(totalNs: number, ops: number): number {
  return totalNs / Math.max(1, ops);
}

describe("perf: build + sim microbench", () => {
  it("records build time, dist size, and sim microbenchmarks", async () => {
    const repoRoot = path.resolve(__dirname, "..");
    const perfDir = path.join(repoRoot, "perf");
    const runsDir = path.join(perfDir, "runs");
    const historyPath = path.join(perfDir, "perf-history.tsv");

    fs.mkdirSync(runsDir, { recursive: true });

    const commit = sh("git", ["rev-parse", "--short", "HEAD"]);
    const dateIso = new Date().toISOString();
    const label = process.env.PERF_LABEL ?? "default";
    const node = process.version;

    // Build timing
    const buildStart = performance.now();
    const build = spawnSync("npm", ["run", "build"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const buildMs = Math.round(performance.now() - buildStart);
    if (build.status !== 0) {
      throw new Error(`build failed (${build.status})\n${build.stdout}\n${build.stderr}`);
    }

    // Dist size
    const distDir = path.join(repoRoot, "dist");
    const distBytes = fs.existsSync(distDir) ? sumDirBytes(distDir) : 0;

    // --- Sim microbenchmarks ---
    // Track projection benchmark: pointOnTrack() is used heavily for placement / AI.
    const seed = Number(process.env.PERF_SEED ?? 123);
    const def = createProceduralTrackDefinition(seed);
    const track = createTrackFromDefinition(def);

    const pointOps = 250_000;
    const sStep = Math.max(1, Math.floor(track.totalLengthM / 200));
    let s = 0;

    const t0 = performance.now();
    for (let i = 0; i < pointOps; i++) {
      // keep s in-range
      s = (s + sStep) % track.totalLengthM;
      pointOnTrack(track, s);
    }
    const t1 = performance.now();
    const pointNs = (t1 - t0) * 1e6;
    const trackPointOnTrack_nsPerCall = nsPerOp(pointNs, pointOps);

    // Enemy step benchmark: rough AI step cost.
    const enemies = generateEnemies(track, { seed: seed ^ 0x1234, count: 40 });
    const enemyOps = 40_000;
    let e = enemies[0];

    const e0 = performance.now();
    for (let i = 0; i < enemyOps; i++) {
      e = stepEnemy(e, 1 / 60, track);
    }
    const e1 = performance.now();
    const enemyNs = (e1 - e0) * 1e6;
    const enemyStep_nsPerStep = nsPerOp(enemyNs, enemyOps);

    const row = {
      dateIso,
      commit,
      label,
      node,
      buildMs,
      distBytes,
      trackPointOnTrack_nsPerCall: Math.round(trackPointOnTrack_nsPerCall),
      enemyStep_nsPerStep: Math.round(enemyStep_nsPerStep)
    };

    const tsvRow = [
      row.dateIso,
      row.commit,
      row.label,
      row.node,
      String(row.buildMs),
      String(row.distBytes),
      String(row.trackPointOnTrack_nsPerCall),
      String(row.enemyStep_nsPerStep)
    ].join("\t");

    fs.appendFileSync(historyPath, `${tsvRow}\n`, "utf8");

    const jsonPath = path.join(runsDir, `${dateIso.replace(/[:.]/g, "-")}_${commit}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(row, null, 2) + "\n", "utf8");
  });
});
