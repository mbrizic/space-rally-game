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
      return { name: "offtrack", frictionMu: 0.62, rollingResistanceN: 320 };
    case "arctic":
      return { name: "offtrack", frictionMu: 0.35, rollingResistanceN: 280 };
    case "rainforest":
      return { name: "offtrack", frictionMu: 0.52, rollingResistanceN: 320 };
    case "temperate":
    default:
      return { name: "offtrack", frictionMu: 0.55, rollingResistanceN: 300 };
  }
}

function surfaceWeightsForTheme(themeKind?: StageThemeKind): { tarmac: number; gravel: number; dirt: number; ice: number } {
  switch (themeKind) {
    case "desert":
      return { tarmac: 0.36, gravel: 0.40, dirt: 0.24, ice: 0.0 };
    case "arctic":
      return { tarmac: 0.26, gravel: 0.22, dirt: 0.18, ice: 0.34 };
    case "rainforest":
      // Wet, earthy, but never icy.
      return { tarmac: 0.42, gravel: 0.28, dirt: 0.30, ice: 0.0 };
    case "temperate":
    default:
      // Temperate is more dirt/rock than rainforest. Allow occasional ice patches.
      // Note: dirt is currently treated as gravel (see below), so keep dirt moderate.
      return { tarmac: 0.52, gravel: 0.22, dirt: 0.16, ice: 0.10 };
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
        frictionMu: Math.min(off.frictionMu, onRoad.frictionMu * 0.75)
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
  
  // Randomly pick surface type for this segment based on seed + segment index
  const surfaceRandom = surfaceRand(seed * 2.3 + segmentIdx * 7.1);
  
  const w = surfaceWeightsForTheme(themeKind);
  const totalW = Math.max(1e-6, w.tarmac + w.gravel + w.dirt + w.ice);
  const tW = w.tarmac / totalW;
  const gW = w.gravel / totalW;
  const dW = w.dirt / totalW;
  const iW = w.ice / totalW;

  let surfaceName: "tarmac" | "gravel" | "dirt" | "ice";
  if (surfaceRandom < tW) {
    surfaceName = "tarmac";
  } else if (surfaceRandom < tW + gW) {
    surfaceName = "gravel";
  } else if (surfaceRandom < tW + gW + dW) {
    surfaceName = "dirt";
  } else {
    // Ice patches are shorter: if we're in an ice segment, further subdivide it.
    if (iW <= 1e-6) {
      surfaceName = "tarmac";
    } else {
      const iceSubRandom = surfaceRand(seed * 3.7 + segmentIdx * 11.3);
      surfaceName = iceSubRandom < 0.5 ? "ice" : "tarmac";
    }
  }
  
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
