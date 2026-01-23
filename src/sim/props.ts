import { mulberry32 } from "./rng";
import type { Track, Vec2 } from "./track";

export type CircleObstacle = {
  id: number;
  kind: "tree";
  x: number;
  y: number;
  r: number;
};

export function generateTrees(track: Track, opts?: { seed?: number }): CircleObstacle[] {
  const seed = opts?.seed ?? 1337;
  const rand = mulberry32(seed);

  const trees: CircleObstacle[] = [];
  const spacingM = 14;
  const baseOffsetM = track.widthM * 0.75;

  let id = 1;
  for (let s = 0; s < track.totalLengthM; s += spacingM) {
    const { p, normal } = pointAndNormalOnTrack(track, s);

    // Don’t place too close to start.
    if (s < 18) continue;

    const sideCount = 2;
    for (let side = 0; side < sideCount; side++) {
      const sign = side === 0 ? -1 : 1;
      const jitterAlong = (rand() - 0.5) * 8;
      const jitterOut = (rand() - 0.5) * 6;
      const offset = baseOffsetM + 3 + rand() * 7 + jitterOut;

      const x = p.x + normal.x * sign * offset + normal.x * 0 + jitterAlong * (-normal.y);
      const y = p.y + normal.y * sign * offset + normal.y * 0 + jitterAlong * (normal.x);
      const r = 0.9 + rand() * 0.6;

      trees.push({ id: id++, kind: "tree", x, y, r });
    }
  }

  return trees;
}

function pointAndNormalOnTrack(track: Track, sM: number): { p: Vec2; normal: Vec2 } {
  const s = wrapS(sM, track.totalLengthM);

  let segmentIndex = 0;
  for (let i = 0; i < track.segmentLengthsM.length; i++) {
    const start = track.cumulativeLengthsM[i];
    const end = start + track.segmentLengthsM[i];
    if (s >= start && s < end) {
      segmentIndex = i;
      break;
    }
  }

  const a = track.points[segmentIndex];
  const b = track.points[(segmentIndex + 1) % track.points.length];
  const segLen = track.segmentLengthsM[segmentIndex];
  const t = segLen > 1e-9 ? (s - track.cumulativeLengthsM[segmentIndex]) / segLen : 0;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1e-6, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;

  return { p: { x, y }, normal: { x: nx, y: ny } };
}

function wrapS(sM: number, totalLengthM: number): number {
  const t = sM % totalLengthM;
  return t < 0 ? t + totalLengthM : t;
}

