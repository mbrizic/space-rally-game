export type Surface = {
  name: "tarmac" | "gravel" | "dirt" | "ice" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

// Simple pseudo-random function for surface generation
function surfaceRand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function surfaceForTrackSM(totalLengthM: number, sM: number, offTrack: boolean, trackSeed?: number): Surface {
  if (offTrack) {
    return { name: "offtrack", frictionMu: 0.55, rollingResistanceN: 950 };
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
  
  // Weight the probabilities: more tarmac and gravel, less ice
  let surfaceName: "tarmac" | "gravel" | "dirt" | "ice";
  if (surfaceRandom < 0.35) {
    surfaceName = "tarmac";
  } else if (surfaceRandom < 0.65) {
    surfaceName = "gravel";
  } else if (surfaceRandom < 0.85) {
    surfaceName = "dirt";
  } else {
    // Ice patches are shorter: if we're in an ice segment, further subdivide it
    // and only make it ice for the first half of the subdivision
    const iceSubRandom = surfaceRand(seed * 3.7 + segmentIdx * 11.3);
    if (iceSubRandom < 0.5) {
      surfaceName = "ice";
    } else {
      // Fallback to tarmac if the ice patch is "skipped" for brevity
      surfaceName = "tarmac";
    }
  }
  
  // Return surface with properties
  switch (surfaceName) {
    case "tarmac":
      return { name: "tarmac", frictionMu: 1.16 + surfaceRand(seed + segmentIdx) * 0.04, rollingResistanceN: 210 + surfaceRand(seed * 1.5 + segmentIdx) * 20 };
    case "gravel":
      return { name: "gravel", frictionMu: 0.88 + surfaceRand(seed + segmentIdx) * 0.06, rollingResistanceN: 420 + surfaceRand(seed * 1.7 + segmentIdx) * 40 };
    case "dirt":
      return { name: "dirt", frictionMu: 0.78 + surfaceRand(seed + segmentIdx) * 0.08, rollingResistanceN: 500 + surfaceRand(seed * 1.9 + segmentIdx) * 40 };
    case "ice":
      return { name: "ice", frictionMu: 0.32 + surfaceRand(seed + segmentIdx) * 0.06, rollingResistanceN: 140 + surfaceRand(seed * 2.1 + segmentIdx) * 20 };
  }
}
