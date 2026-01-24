import { pointOnTrack, type Track } from "./track";

export type Pacenote = {
  direction: "L" | "R";
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  distanceM: number;
  label: string;
};

export function computePacenote(track: Track, sM: number, speedMS: number): Pacenote | null {
  // Look a bit beyond the visible area; scale with speed so it feels "rally-ish".
  const lookaheadStartM = 38 + clamp(speedMS, 0, 40) * 0.8; // ~38..70m
  const scanLengthM = 140;
  const stepM = 2.5;

  const start = pointOnTrack(track, sM + lookaheadStartM);
  let prevHeading = start.headingRad;

  const enterCurv = 0.020;
  const exitCurv = 0.012;

  let inCorner = false;
  let cornerStartDistM = 0;
  let maxAbsCurv = 0;
  let signedCurvSum = 0;

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

      // End the corner once curvature falls back under threshold for a bit.
      const cornerLen = dM - cornerStartDistM;
      if (cornerLen > 10 && absCurv < exitCurv) break;
    }

    prevHeading = h;
  }

  if (!inCorner) return null;

  const direction: "L" | "R" = signedCurvSum >= 0 ? "R" : "L";
  const grade = gradeFromCurvature(maxAbsCurv);
  const distanceM = Math.max(0, Math.round(lookaheadStartM + cornerStartDistM));
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

