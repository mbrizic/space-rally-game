import { mulberry32 } from "./rng";
import { isQuietAtTrackDistance, quietZoneContainsTrackDistance } from "./stage";
import type { QuietZone, StageThemeKind } from "./stage";
import type { Track, Vec2 } from "./track";

export type CircleObstacle = {
  id: number;
  kind: "tree";
  x: number;
  y: number;
  r: number;
};

export type DebrisObstacle = {
  id: number;
  kind: "debris";
  // Approx track position for warnings and deterministic placement.
  sM: number;
  x: number;
  y: number;
  lengthM: number;
  widthM: number;
  rotationRad: number;
  // 1 = intact, 0 = destroyed (used for visuals + collision size).
  integrity01: number;
  vx: number;
  vy: number;
  angularVelRadS: number;
  isDynamic: boolean;
};

export type WaterBody = {
  id: number;
  x: number;
  y: number;
  radiusX: number; // Ellipse semi-axis X
  radiusY: number; // Ellipse semi-axis Y
  rotation: number; // Radians
};

export function generateTrees(track: Track, opts?: { seed?: number; themeKind?: StageThemeKind }): CircleObstacle[] {
  const seed = opts?.seed ?? 1337;
  const rand = mulberry32(seed);

  const themeKind: StageThemeKind = opts?.themeKind ?? "temperate";

  const trees: CircleObstacle[] = [];
  const spacingM = themeKind === "rainforest" ? 8 : (themeKind === "arctic" ? 14 : 12);
  const roadHalfWidthM = track.widthM * 0.5;
  const minOffsetM = roadHalfWidthM + (themeKind === "rainforest" ? 1.0 : 1.2);
  const maxOffsetM = roadHalfWidthM + (themeKind === "rainforest" ? 5.2 : 4.2);
  
  // Minimum distance from tree to ANY track segment (not just local one)
  const minDistanceToAnyRoad = roadHalfWidthM + (themeKind === "rainforest" ? 2.6 : 3.0);

  let id = 1;
  for (let s = 0; s < track.totalLengthM; s += spacingM) {
    const { p, normal } = pointAndNormalOnTrack(track, s);

    // Don't place too close to start.
    if (s < 18) continue;

    const sideCount = themeKind === "rainforest" ? 4 : 2;
    for (let side = 0; side < sideCount; side++) {
      const sign = sideCount === 4 ? (side < 2 ? -1 : 1) : (side === 0 ? -1 : 1);
      const row = sideCount === 4 ? (side % 2) : 0; // rainforest: inner/outer row per side
      const jitterAlong = (rand() - 0.5) * 10;
      const jitterOut = (rand() - 0.5) * 1.2;
      const rowBoost = row === 1 ? (roadHalfWidthM * 0.45 + 1.2) : 0;
      const offset = clamp(minOffsetM + rand() * (maxOffsetM - minOffsetM) + rowBoost + jitterOut, minOffsetM, maxOffsetM + rowBoost);

      const tx = -normal.y;
      const ty = normal.x;
      const x = p.x + normal.x * sign * offset + tx * jitterAlong;
      const y = p.y + normal.y * sign * offset + ty * jitterAlong;
      const r = (themeKind === "rainforest" ? 1.0 : 0.9) + rand() * (themeKind === "rainforest" ? 0.8 : 0.6);

      // CHECK AGAINST ENTIRE TRACK: Ensure tree isn't too close to any other road segment
      let tooCloseToRoad = false;
      for (let i = 0; i < track.points.length - 1; i++) {
        const a = track.points[i];
        const b = track.points[i + 1];
        const distToSegment = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
        
        if (distToSegment < minDistanceToAnyRoad) {
          tooCloseToRoad = true;
          break;
        }
      }
      
      // Only add tree if it's safe (not overlapping any part of the track)
      if (!tooCloseToRoad) {
        trees.push({ id: id++, kind: "tree", x, y, r });
      }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calculate the shortest distance from a point (px, py) to a line segment (ax, ay) -> (bx, by)
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  
  // Degenerate case: segment is a point
  if (lengthSq < 1e-10) {
    return Math.hypot(px - ax, py - ay);
  }
  
  // Calculate projection parameter t (clamped to [0, 1])
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  
  // Find closest point on segment
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  
  // Return distance to closest point
  return Math.hypot(px - closestX, py - closestY);
}

/**
 * Generate water bodies near the track - dangerous hazards that slow the car significantly
 */
export function generateWaterBodies(track: Track, opts?: { seed?: number; quietZones?: QuietZone[] }): WaterBody[] {
  const seed = opts?.seed ?? 4242;
  const rand = mulberry32(seed);

  const quietZones: QuietZone[] = opts?.quietZones ?? [];

  const waterBodies: WaterBody[] = [];
  const roadHalfWidthM = track.widthM * 0.5;
  
  // Place water at strategic intervals (every 150-300m of track)
  const minSpacing = 150;
  const maxSpacing = 300;
  
  let nextWaterAt = minSpacing + rand() * (maxSpacing - minSpacing);
  let id = 1;
  
  for (let s = nextWaterAt; s < track.totalLengthM - 100; s = nextWaterAt) {
    // Quiet stretches: avoid water hazards.
    if (quietZones.length > 0 && isQuietAtTrackDistance(track.totalLengthM, s, quietZones)) {
      const z = quietZones.find((q) => quietZoneContainsTrackDistance(track.totalLengthM, s, q));
      if (z) {
        nextWaterAt = Math.max(s + minSpacing, z.end01 * track.totalLengthM + minSpacing);
        continue;
      }
    }

    const { p, normal } = pointAndNormalOnTrack(track, s);
    
    // Skip if too close to start or end
    if (s < 80 || s > track.totalLengthM - 80) {
      nextWaterAt = s + minSpacing;
      continue;
    }
    
    // Decide which side (or both for a crossing hazard)
    const sideChoice = rand();
    const sides: number[] = sideChoice < 0.3 ? [-1] : sideChoice < 0.6 ? [1] : [-1, 1];
    
    for (const sign of sides) {
      // Bigger water bodies - more visible and dangerous
      const baseRadius = 6 + rand() * 8; // 6-14m base
      const radiusX = baseRadius * (0.8 + rand() * 0.4);
      const radiusY = baseRadius * (0.8 + rand() * 0.4);
      const maxRadius = Math.max(radiusX, radiusY);
      
      // Place water BESIDE the track - center must be far enough that water doesn't touch road
      // Water center offset = road edge + water radius + safety gap
      const safetyGap = 3; // Guaranteed minimum gap from road edge
      const minOffset = roadHalfWidthM + maxRadius + safetyGap;
      const offset = minOffset + rand() * 6; // Plus some extra randomness
      
      const jitterAlong = (rand() - 0.5) * 8; // Reduced jitter to avoid hitting other segments
      const tx = -normal.y;
      const ty = normal.x;
      
      const x = p.x + normal.x * sign * offset + tx * jitterAlong;
      const y = p.y + normal.y * sign * offset + ty * jitterAlong;
      const rotation = rand() * Math.PI;
      
      // Validate: check that water doesn't overlap with ANY track segment
      let overlapsTrack = false;
      for (let i = 0; i < track.points.length - 1; i++) {
        const a = track.points[i];
        const b = track.points[i + 1];
        const dist = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
        
        // Water overlaps if center minus radius is within road bounds
        if (dist - maxRadius < roadHalfWidthM) {
          overlapsTrack = true;
          break;
        }
      }
      
      if (!overlapsTrack) {
        waterBodies.push({ id: id++, x, y, radiusX, radiusY, rotation });
      }
    }
    
    // Schedule next water body
    nextWaterAt = s + minSpacing + rand() * (maxSpacing - minSpacing);
  }

  return waterBodies;
}

/**
 * Generate debris (fallen logs) on the road.
 * These do not deal damage, but destabilize the car if hit at speed.
 */
export function generateDebris(track: Track, opts?: { seed?: number; themeKind?: StageThemeKind; quietZones?: QuietZone[] }): DebrisObstacle[] {
  const seed = opts?.seed ?? 9090;
  const rand = mulberry32(seed);

  const quietZones: QuietZone[] = opts?.quietZones ?? [];

  const themeKind: StageThemeKind = opts?.themeKind ?? "temperate";

  const debris: DebrisObstacle[] = [];
  const roadHalfWidthM = track.widthM * 0.5;

  // Place debris clusters with biome tuning.
  // Rainforest: more debris. Arctic: less debris.
  // Slightly reduced rainforest density to keep it spicy but less spammy.
  const minSpacing = themeKind === "rainforest" ? 95 : (themeKind === "arctic" ? 180 : 120);
  const maxSpacing = themeKind === "rainforest" ? 190 : (themeKind === "arctic" ? 320 : 220);
  let nextAt = 100 + rand() * 80;
  let id = 1;

  for (let s = nextAt; s < track.totalLengthM - 140; s = nextAt) {
    // Quiet stretches: avoid debris hazards.
    if (quietZones.length > 0 && isQuietAtTrackDistance(track.totalLengthM, s, quietZones)) {
      const z = quietZones.find((q) => quietZoneContainsTrackDistance(track.totalLengthM, s, q));
      if (z) {
        nextAt = Math.max(s + minSpacing, z.end01 * track.totalLengthM + minSpacing);
        continue;
      }
    }

    // Skip near start/end.
    if (s < 120 || s > track.totalLengthM - 180) {
      nextAt = s + minSpacing;
      continue;
    }

    const { p, normal } = pointAndNormalOnTrack(track, s);
    const tx = -normal.y;
    const ty = normal.x;

    // Logs per cluster.
    const count = themeKind === "rainforest"
      ? (2 + Math.floor(rand() * 5))
      : (themeKind === "arctic" ? (1 + Math.floor(rand() * 3)) : (2 + Math.floor(rand() * 5)));

    const tangentAngle = Math.atan2(ty, tx);

    // Occasionally place a true "blocker" log roughly across the road, near center.
    // Keep these rarer so they feel like events, not spam.
    const hasBlocker = rand() < 0.16;

    for (let i = 0; i < count; i++) {
      const isBlocker = hasBlocker && i === 0;

      // Keep mostly on-road, but with variation.
      const lateral = isBlocker
        ? (rand() * 2 - 1) * (roadHalfWidthM * 0.10)
        : (rand() * 2 - 1) * (roadHalfWidthM * 0.65);
      const along = isBlocker ? (rand() - 0.5) * 6 : (rand() - 0.5) * 18;

      const x = p.x + normal.x * lateral + tx * along;
      const y = p.y + normal.y * lateral + ty * along;

      // Rotation styles: along-road, diagonal, and (rarer) across-road.
      const styleRoll = rand();
      const crossish = isBlocker || styleRoll < 0.10;
      const diagonal = !crossish && styleRoll < 0.42;

      let rotationRad = tangentAngle;
      if (crossish) {
        // Avoid the "perfect 90°" look; bias to across-road but with noticeable tilt.
        rotationRad = tangentAngle + Math.PI / 2 + (rand() - 0.5) * 0.55;
      } else if (diagonal) {
        const sign = rand() < 0.5 ? -1 : 1;
        rotationRad = tangentAngle + sign * (Math.PI / 4);
      }

      // Jitter (smaller for blockers so they read as deliberate road blocks).
      const jitter = (rand() - 0.5) * (crossish ? 0.25 : 0.95);
      rotationRad += jitter;

      // Size.
      const shortLog = !isBlocker && rand() < 0.35;
      const lengthM = isBlocker
        ? (track.widthM * (0.70 + rand() * 0.55))
        : (shortLog ? (1.0 + rand() * 1.6) : (2.2 + rand() * 4.2));
      const widthM = isBlocker
        ? (0.28 + rand() * 0.32)
        : (0.22 + rand() * 0.30); // 0.22-0.52m

      debris.push({
        id: id++,
        kind: "debris",
        sM: s,
        x,
        y,
        lengthM,
        widthM,
        rotationRad,
        integrity01: 1,
        vx: 0,
        vy: 0,
        angularVelRadS: 0,
        isDynamic: false
      });
    }

    nextAt = s + minSpacing + rand() * (maxSpacing - minSpacing);
  }

  return debris;
}
