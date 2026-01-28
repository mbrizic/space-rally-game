export type Surface = {
  name: "tarmac" | "gravel" | "dirt" | "ice" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

export type StageThemeKind = "temperate" | "rainforest" | "desert" | "arctic";

// Simple pseudo-random function for surface generation
function surfaceRand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function offtrackSurfaceForTheme(themeKind?: StageThemeKind): Surface {
  switch (themeKind) {
    case "desert":
      return { name: "offtrack", frictionMu: 0.66, rollingResistanceN: 300 };
    case "arctic":
      return { name: "offtrack", frictionMu: 0.38, rollingResistanceN: 260 };
    case "rainforest":
      return { name: "offtrack", frictionMu: 0.56, rollingResistanceN: 300 };
    case "temperate":
    default:
      return { name: "offtrack", frictionMu: 0.58, rollingResistanceN: 280 };
  }
}

function surfaceWeightsForTheme(themeKind?: StageThemeKind): { tarmac: number; gravel: number; dirt: number; ice: number } {
  switch (themeKind) {
    case "desert":
      return { tarmac: 0.28, gravel: 0.46, dirt: 0.26, ice: 0.0 };
    case "arctic":
      return { tarmac: 0.22, gravel: 0.22, dirt: 0.18, ice: 0.38 };
    case "rainforest":
      // Wet, earthy, but never icy.
      return { tarmac: 0.34, gravel: 0.33, dirt: 0.33, ice: 0.0 };
    case "temperate":
    default:
      // Rally-friendly default: non-tarmac is common, but allow occasional ice patches.
      // Note: dirt is currently treated as gravel (see below), so keep dirt moderate.
      return { tarmac: 0.40, gravel: 0.30, dirt: 0.20, ice: 0.10 };
  }
}

export function surfaceForTrackSM(
  totalLengthM: number,
  sM: number,
  offTrack: boolean,
  trackSeed?: number,
  themeKind?: StageThemeKind
): Surface {
  if (offTrack) {
    const off = offtrackSurfaceForTheme(themeKind);
    // If the on-road segment is icy, off-road should not magically have better grip.
    const onRoad = surfaceForTrackSM(totalLengthM, sM, false, trackSeed, themeKind);
    if (onRoad.name === "ice") {
      return {
        ...off,
        frictionMu: Math.min(off.frictionMu, onRoad.frictionMu * 0.85)
      };
    }
    return off;
  }

  const t = (sM % totalLengthM) / totalLengthM;
  const seed = trackSeed ?? 1;
  
  // Generate random surface transitions based on track seed
  // Create 8-12 surface segments with random order (more segments = shorter patches)
  const numSegments = 8 + Math.floor(surfaceRand(seed * 1.1) * 5);
  const segmentSize = 1.0 / numSegments;
  
  // Determine which segment we're in
  const segmentIdx = Math.floor(t / segmentSize);
  
  // Theme weights define the *overall mix* of surfaces.
  // We then apply a small per-track bias so some seeds are more tarmac-heavy than others,
  // but tarmac should not become the majority.
  const w0 = surfaceWeightsForTheme(themeKind);

  const tarmacBias = 0.75 + surfaceRand(seed * 12.31) * 0.70; // 0.75..1.45
  const tarmacWeight = w0.tarmac * tarmacBias;
  const gravelWeight = w0.gravel;
  const dirtWeight = w0.dirt;
  const iceWeight = w0.ice;

  const totalW0 = Math.max(1e-6, tarmacWeight + gravelWeight + dirtWeight + iceWeight);
  let tW = tarmacWeight / totalW0;
  let gW = gravelWeight / totalW0;
  let dW = dirtWeight / totalW0;
  let iW = iceWeight / totalW0;

  // Enforce: tarmac should not be the majority.
  const tarmacMax = 0.48;
  if (tW > tarmacMax) {
    const other = Math.max(1e-6, gW + dW + iW);
    const scale = (1 - tarmacMax) / other;
    tW = tarmacMax;
    gW *= scale;
    dW *= scale;
    iW *= scale;
  }

  // Guarantee at least a bit of variety for a given seed (important for gameplay + tests):
  // pick one segment index to be a non-tarmac patch.
  const forcedVarietyIdx = Math.min(numSegments - 1, Math.max(0, Math.floor(surfaceRand(seed * 9.11) * numSegments)));
  const forcedVarietySurface = (() => {
    const nonTarmacW = Math.max(0, gW + dW + (iW > 1e-6 ? iW : 0));
    if (nonTarmacW <= 1e-6) return "gravel" as const;
    const r = surfaceRand(seed * 9.71);
    const gN = gW / nonTarmacW;
    const dN = dW / nonTarmacW;
    if (r < gN) return "gravel" as const;
    if (r < gN + dN) return "dirt" as const;
    return iW > 1e-6 ? ("ice" as const) : ("gravel" as const);
  })();

  // Deterministic surface "runs": longer continuous stretches for tarmac (fun at speed)
  // without making tarmac the majority of the track.
  const expectedRunLenSeg = (name: "tarmac" | "gravel" | "dirt" | "ice"): number => {
    switch (name) {
      case "tarmac":
        return 3.0;
      case "ice":
        return 1.2;
      case "gravel":
      case "dirt":
      default:
        return 1.7;
    }
  };

  const pickSurfaceForRun = (runIdx: number): "tarmac" | "gravel" | "dirt" | "ice" => {
    // Adjust run-start probabilities so the *final* surface proportions roughly follow (tW,gW,dW,iW)
    // even though run lengths differ.
    const qt = tW / expectedRunLenSeg("tarmac");
    const qg = gW / expectedRunLenSeg("gravel");
    const qd = dW / expectedRunLenSeg("dirt");
    const qi = (iW > 1e-6 ? iW : 0) / expectedRunLenSeg("ice");
    const qSum = Math.max(1e-6, qt + qg + qd + qi);

    const r = surfaceRand(seed * 2.3 + runIdx * 7.1);
    const tQ = qt / qSum;
    const gQ = qg / qSum;
    const dQ = qd / qSum;

    if (r < tQ) return "tarmac";
    if (r < tQ + gQ) return "gravel";
    if (r < tQ + gQ + dQ) return "dirt";
    return "ice";
  };

  const runLenForSurface = (name: "tarmac" | "gravel" | "dirt" | "ice", runIdx: number): number => {
    const r = surfaceRand(seed * 4.9 + runIdx * 13.7);
    if (name === "tarmac") return 2 + Math.floor(r * 3); // 2..4 segments
    if (name === "ice") return 1; // keep ice snappy/short
    return 1 + Math.floor(r * 2); // 1..2 segments
  };

  const surfacesBySegment: ("tarmac" | "gravel" | "dirt" | "ice")[] = new Array(numSegments);
  let seg = 0;
  let runIdx = 0;
  while (seg < numSegments) {
    let name = pickSurfaceForRun(runIdx);
    if (name === "ice" && iW <= 1e-6) name = "tarmac";

    const len = Math.min(numSegments - seg, Math.max(1, runLenForSurface(name, runIdx)));
    for (let k = 0; k < len; k++) surfacesBySegment[seg + k] = name;
    seg += len;
    runIdx++;
  }

  let surfaceName: "tarmac" | "gravel" | "dirt" | "ice" = (surfacesBySegment[segmentIdx] ?? "tarmac");

  // Ensure at least one non-tarmac segment for the seed.
  if (segmentIdx === forcedVarietyIdx && surfaceName === "tarmac") surfaceName = forcedVarietySurface;
  
  // Return surface with properties
  switch (surfaceName) {
    case "tarmac":
      return { name: "tarmac", frictionMu: 1.16 + surfaceRand(seed + segmentIdx) * 0.04, rollingResistanceN: 210 + surfaceRand(seed * 1.5 + segmentIdx) * 20 };
    case "gravel":
      return { name: "gravel", frictionMu: 0.88 + surfaceRand(seed + segmentIdx) * 0.06, rollingResistanceN: 420 + surfaceRand(seed * 1.7 + segmentIdx) * 40 };
    case "dirt":
      // Treat dirt as gravel (visual + feel). This keeps surface predictability while
      // avoiding a separate "dirt" identity.
      return { name: "gravel", frictionMu: 0.88 + surfaceRand(seed + segmentIdx) * 0.06, rollingResistanceN: 420 + surfaceRand(seed * 1.7 + segmentIdx) * 40 };
    case "ice":
      // Ice: good acceleration to allow chaos, but stiffness/damping scaling makes it slidey.
      return { name: "ice", frictionMu: 0.55 + surfaceRand(seed + segmentIdx) * 0.10, rollingResistanceN: 80 + surfaceRand(seed * 2.1 + segmentIdx) * 20 };
  }
}
