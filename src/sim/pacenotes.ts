import { pointOnTrack, type Track, type TrackCornerInfo } from "./track";

export type Pacenote = {
  direction: "L" | "R";
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  distanceM: number;
  label: string;
};

/**
 * Compute pacenote from pre-defined corner metadata
 * This is much more accurate than curvature detection!
 */
function computePacenoteFromCorners(
  corners: TrackCornerInfo[],
  currentSM: number,
  speedMS: number
): Pacenote | null {
  // Look ahead based on speed - give driver time to react
  const lookaheadStartM = 40 + clamp(speedMS, 0, 50) * 1.0; // ~40-90m
  const scanRangeM = 200; // Look up to 200m ahead
  
  // Find the next corner ahead
  let nextCorner: TrackCornerInfo | null = null;
  let cornerDistanceM = Infinity;
  
  for (const corner of corners) {
    // Is this corner ahead of us?
    if (corner.startSM > currentSM) {
      const distToCorner = corner.startSM - currentSM;
      // Is it in our scan range?
      if (distToCorner >= lookaheadStartM && distToCorner <= lookaheadStartM + scanRangeM) {
        if (distToCorner < cornerDistanceM) {
          nextCorner = corner;
          cornerDistanceM = distToCorner;
        }
      }
    }
  }
  
  if (!nextCorner) return null;
  
  // Convert corner type to pacenote grade
  const grade = gradeFromCornerType(nextCorner.type, nextCorner.angleChange);
  
  const distanceM = Math.max(0, Math.round(cornerDistanceM));
  const label = `${nextCorner.direction}${grade} in ${distanceM}m`;
  
  return {
    direction: nextCorner.direction,
    grade,
    distanceM,
    label
  };
}

/**
 * Convert corner type and angle to pacenote grade (1-6)
 */
function gradeFromCornerType(type: TrackCornerInfo["type"], angleChange: number): Pacenote["grade"] {
  // Grade based on both type and actual angle change
  // Lower number = tighter corner
  
  if (type === "hairpin") {
    return angleChange > Math.PI * 0.85 ? 1 : 2; // 1 for super tight hairpins, 2 for normal
  }
  
  if (type === "sharp") {
    return angleChange > Math.PI * 0.6 ? 2 : 3; // 2 for tight 90+, 3 for gentler sharp
  }
  
  if (type === "medium") {
    return angleChange > Math.PI * 0.4 ? 3 : 4; // 3 for tighter, 4 for gentler
  }
  
  if (type === "gentle") {
    return 5; // Always grade 5
  }
  
  if (type === "chicane") {
    return 4; // Chicanes are tricky but not super tight
  }
  
  return 6; // Shouldn't happen, but default to very gentle
}

export function computePacenote(track: Track, sM: number, speedMS: number): Pacenote | null {
  // If track has corner metadata, use it directly (much more accurate!)
  if (track.corners && track.corners.length > 0) {
    const result = computePacenoteFromCorners(track.corners, sM, speedMS);
    // Debug: Log when we find a corner
    if (result && Math.random() < 0.01) { // Log 1% of the time to avoid spam
      console.log(`Pacenote: ${result.label}, track has ${track.corners.length} corners, current pos: ${sM.toFixed(0)}m`);
    }
    return result;
  }
  
  // Fallback to curvature detection for tracks without corner metadata
  // Look ahead based on speed, with more aggressive scaling
  const lookaheadStartM = 45 + clamp(speedMS, 0, 50) * 1.2; // ~45..105m
  const scanLengthM = 180;
  const stepM = 2.5;

  const start = pointOnTrack(track, sM + lookaheadStartM);
  let prevHeading = start.headingRad;

  // Higher thresholds to only detect "real" corners, not gentle curves
  const enterCurv = 0.035; // Increased from 0.020
  const exitCurv = 0.020; // Increased from 0.012
  const minCornerLengthM = 15; // Must be at least 15m long to be a "real" corner

  let inCorner = false;
  let cornerStartDistM = 0;
  let maxAbsCurv = 0;
  let signedCurvSum = 0;
  let cornerFoundDistM = -1;

  for (let dM = stepM; dM <= scanLengthM + 1e-6; dM += stepM) {
    const h = pointOnTrack(track, sM + lookaheadStartM + dM).headingRad;
    const dh = angleDiffRad(h, prevHeading);
    const curv = dh / stepM;
    const absCurv = Math.abs(curv);

    if (!inCorner) {
      if (absCurv > enterCurv) {
        inCorner = true;
        cornerStartDistM = dM - stepM;
        maxAbsCurv = absCurv;
        signedCurvSum = curv;
      }
    } else {
      maxAbsCurv = Math.max(maxAbsCurv, absCurv);
      signedCurvSum += curv;

      // End the corner once curvature falls back under threshold
      const cornerLen = dM - cornerStartDistM;
      if (cornerLen > minCornerLengthM && absCurv < exitCurv) {
        // Found a complete corner! Stop scanning.
        cornerFoundDistM = cornerStartDistM;
        break;
      }
    }

    prevHeading = h;
  }

  // Only return if we found a complete, significant corner
  if (!inCorner || cornerFoundDistM < 0) return null;

  // Filter out very gentle curves (grade 6 = barely a corner)
  const grade = gradeFromCurvature(maxAbsCurv);
  if (grade === 6) return null; // Too gentle, ignore it

  const direction: "L" | "R" = signedCurvSum >= 0 ? "R" : "L";
  const distanceM = Math.max(0, Math.round(lookaheadStartM + cornerFoundDistM));
  const label = `${direction}${grade} in ${distanceM}m`;
  return { direction, grade, distanceM, label };
}

function gradeFromCurvature(maxAbsCurv: number): Pacenote["grade"] {
  // Higher curvature => tighter corner (lower number).
  if (maxAbsCurv > 0.14) return 1;
  if (maxAbsCurv > 0.105) return 2;
  if (maxAbsCurv > 0.08) return 3;
  if (maxAbsCurv > 0.06) return 4;
  if (maxAbsCurv > 0.042) return 5;
  return 6;
}

function angleDiffRad(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
