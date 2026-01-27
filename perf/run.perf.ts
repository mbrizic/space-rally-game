import { describe, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import zlib from "node:zlib";

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

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFilesRecursive(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function gzipBytesOfFile(filePath: string): number {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf, { level: 9 }).byteLength;
}

function resolveEntryJsFromDist(distDir: string): string | null {
  const htmlPath = path.join(distDir, "index.html");
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf8");
    const m = html.match(/<script[^>]+src="([^"]+)"[^>]*>\s*<\/script>/i);
    if (m?.[1]) {
      const src = m[1].replace(/^\//, "");
      const p = path.join(distDir, src);
      if (fs.existsSync(p)) return p;
    }
  }

  const assetsDir = path.join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) return null;
  const files = fs.readdirSync(assetsDir);
  const js = files
    .filter((f) => f.endsWith(".js") && !f.endsWith(".map"))
    .map((f) => path.join(assetsDir, f));
  if (js.length === 0) return null;
  // Heuristic: main chunk is usually the largest JS file.
  js.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return js[0] ?? null;
}

function nsPerOp(totalNs: number, ops: number): number {
  return totalNs / Math.max(1, ops);
}

const MIN_COLUMNS = [
  "dateIso",
  "commit",
  "label",
  "node",
  "buildMs",
  "distBytes",
  "trackPointOnTrack_nsPerCall",
  "enemyStep_nsPerStep"
] as const;

const BASE_COLUMNS = [
  ...MIN_COLUMNS,
  "distGzipBytes",
  "entryJsGzipBytes"
] as const;

const PCT_COLUMNS = [
  "buildMs_pct",
  "distBytes_pct",
  "distGzipBytes_pct",
  "entryJsGzipBytes_pct",
  "trackPointOnTrack_nsPerCall_pct",
  "enemyStep_nsPerStep_pct"
] as const;

const ALL_COLUMNS = [...BASE_COLUMNS, ...PCT_COLUMNS] as const;

type BaseRow = Record<(typeof BASE_COLUMNS)[number], string>;
type FullRow = Record<(typeof ALL_COLUMNS)[number], string>;

function pctChange(curr: number, prev: number): string {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return "";
  return (((curr - prev) / prev) * 100).toFixed(1);
}

function parseHistory(tsv: string): { preambleLines: string[]; headerCols: string[]; rows: string[][] } {
  const lines = tsv.split(/\r?\n/);
  const preambleLines: string[] = [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      preambleLines.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      preambleLines.push(line);
      continue;
    }
    headerIdx = i;
    break;
  }

  const headerLine = headerIdx >= 0 ? lines[headerIdx] : "";
  const headerCols = headerLine ? headerLine.split("\t").map((s) => s.trim()) : [];
  const rows: string[][] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    rows.push(line.split("\t"));
  }

  return { preambleLines, headerCols, rows };
}

function padRow(cols: string[], row: string[]): string[] {
  const out = new Array(cols.length).fill("");
  for (let i = 0; i < Math.min(cols.length, row.length); i++) out[i] = row[i] ?? "";
  return out;
}

function headerPreambleWithColumns(preambleLines: string[]): string[] {
  const columnsLine = "# " + ALL_COLUMNS.join("\t");
  let replaced = false;
  const out = preambleLines.map((l) => {
    if (l.startsWith("# ") && l.includes("dateIso") && l.includes("commit") && l.includes("buildMs")) {
      replaced = true;
      return columnsLine;
    }
    return l;
  });
  if (!replaced) {
    // Keep file readable if it didn't previously have a columns line.
    out.push("# Columns:");
    out.push(columnsLine);
  }
  return out;
}

function toNumber(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function computePctColumns(curr: BaseRow, prev: BaseRow | null): Pick<FullRow, (typeof PCT_COLUMNS)[number]> {
  const buildMs = toNumber(curr.buildMs);
  const distBytes = toNumber(curr.distBytes);
  const distGzipBytes = toNumber(curr.distGzipBytes);
  const entryJsGzipBytes = toNumber(curr.entryJsGzipBytes);
  const trackNs = toNumber(curr.trackPointOnTrack_nsPerCall);
  const enemyNs = toNumber(curr.enemyStep_nsPerStep);

  const prevBuildMs = prev ? toNumber(prev.buildMs) : NaN;
  const prevDistBytes = prev ? toNumber(prev.distBytes) : NaN;
  const prevDistGzipBytes = prev ? toNumber(prev.distGzipBytes) : NaN;
  const prevEntryJsGzipBytes = prev ? toNumber(prev.entryJsGzipBytes) : NaN;
  const prevTrackNs = prev ? toNumber(prev.trackPointOnTrack_nsPerCall) : NaN;
  const prevEnemyNs = prev ? toNumber(prev.enemyStep_nsPerStep) : NaN;

  return {
    buildMs_pct: pctChange(buildMs, prevBuildMs),
    distBytes_pct: pctChange(distBytes, prevDistBytes),
    distGzipBytes_pct: pctChange(distGzipBytes, prevDistGzipBytes),
    entryJsGzipBytes_pct: pctChange(entryJsGzipBytes, prevEntryJsGzipBytes),
    trackPointOnTrack_nsPerCall_pct: pctChange(trackNs, prevTrackNs),
    enemyStep_nsPerStep_pct: pctChange(enemyNs, prevEnemyNs)
  };
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

    // Gzip sizes (exclude sourcemaps)
    const distFiles = fs.existsSync(distDir) ? listFilesRecursive(distDir) : [];
    const distGzipBytes = distFiles
      .filter((p) => !p.endsWith(".map"))
      .reduce((sum, p) => sum + gzipBytesOfFile(p), 0);

    const entryJs = fs.existsSync(distDir) ? resolveEntryJsFromDist(distDir) : null;
    const entryJsGzipBytes = entryJs ? gzipBytesOfFile(entryJs) : 0;

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

    const baseRow: BaseRow = {
      dateIso,
      commit,
      label,
      node,
      buildMs: String(buildMs),
      distBytes: String(distBytes),
      distGzipBytes: String(distGzipBytes),
      entryJsGzipBytes: String(entryJsGzipBytes),
      trackPointOnTrack_nsPerCall: String(Math.round(trackPointOnTrack_nsPerCall)),
      enemyStep_nsPerStep: String(Math.round(enemyStep_nsPerStep))
    };

    // Load + (if needed) migrate history to include pct columns.
    const existingText = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, "utf8") : "";
    const parsed = parseHistory(existingText);

    const baseHeaderOk = MIN_COLUMNS.every((c) => parsed.headerCols.includes(c));
    if (!baseHeaderOk && parsed.rows.length > 0) {
      throw new Error(`perf history header is missing required columns: ${MIN_COLUMNS.join(", ")}`);
    }

    // Convert existing rows into base rows using the existing header.
    const headerCols = parsed.headerCols.length > 0 ? parsed.headerCols : [...BASE_COLUMNS];
    const baseRows: BaseRow[] = parsed.rows.map((r) => {
      const padded = padRow(headerCols, r);
      const out: any = {};
      for (const c of BASE_COLUMNS) {
        const idx = headerCols.indexOf(c);
        out[c] = idx >= 0 ? (padded[idx] ?? "") : "";
      }
      return out as BaseRow;
    });

    // If file doesn't already have pct columns, rewrite existing rows with pct computed.
    const hasPctCols = PCT_COLUMNS.every((c) => headerCols.includes(c));
    const preamble = headerPreambleWithColumns(parsed.preambleLines);

    const fullRows: FullRow[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const prev = i > 0 ? baseRows[i - 1] : null;
      const pct = computePctColumns(baseRows[i], prev);
      fullRows.push({ ...baseRows[i], ...pct } as FullRow);
    }

    const prevForCurrent = baseRows.length > 0 ? baseRows[baseRows.length - 1] : null;
    const currentPct = computePctColumns(baseRow, prevForCurrent);
    const currentFull: FullRow = { ...baseRow, ...currentPct } as FullRow;
    fullRows.push(currentFull);

    // Write back the whole file (preserving preamble) so columns stay consistent.
    const outputLines = [
      ...preamble,
      "",
      ALL_COLUMNS.join("\t"),
      ...fullRows.map((r) => ALL_COLUMNS.map((c) => r[c] ?? "").join("\t"))
    ];
    fs.writeFileSync(historyPath, outputLines.join("\n") + "\n", "utf8");

    const jsonPath = path.join(runsDir, `${dateIso.replace(/[:.]/g, "-")}_${commit}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(currentFull, null, 2) + "\n", "utf8");
  });
});
