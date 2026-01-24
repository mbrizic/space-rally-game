import { pointOnTrack, type Track } from "./track";

export type Pacenote = {
  direction: "L" | "R";
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  distanceM: number;
  label: string;
};

export function computePacenote(track: Track, sM: number, speedMS: number): Pacenote | null {
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

