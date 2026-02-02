import { mulberry32 } from "./rng";
import { isQuietAtTrackDistance, quietZoneContainsTrackDistance } from "./stage";
import type { QuietZone, StageThemeKind } from "./stage";
import { surfaceForTrackSM } from "./surface";
import type { Track, Vec2 } from "./track";

export type CircleObstacle = {
  id: number;
  kind: "tree" | "rock";
  x: number;
  y: number;
  r: number;
  // Optional explicit collision radius (meters). If absent, callers derive from `r`.
  collR?: number;
  rotationRad?: number;
  // For rocks: convex polygon in local space (meters), centered around (0,0).
  poly?: Vec2[];
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

export function generateEdgeRocks(track: Track, opts?: { seed?: number; themeKind?: StageThemeKind; trackSeed?: number }): CircleObstacle[] {
  const seed = opts?.seed ?? 232323;
  const rand = mulberry32((Math.floor(seed) ^ 0x7f4a7c15) >>> 0);

  const themeKind: StageThemeKind = opts?.themeKind ?? "temperate";
  // Requested: allow temperate, rainforest, arctic. Never spawn on desert.
  if (themeKind === "desert") return [];

  const rocks: CircleObstacle[] = [];

  const trackSeed = opts?.trackSeed ?? opts?.seed ?? 1;

  const baseWidth = track.widthM;
  const narrowThreshold = baseWidth * 0.64;

  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  // Safety margin beyond the road edge. Smaller = rocks hug the edge more.
  // We still validate against every segment using the polygon extent.
  const safetyGapM = 0.38;

  // --- Build a few deterministic clump centers biased toward narrow and/or gravel sections.
  const candidates: { sM: number; w: number }[] = [];
  const sampleStepM = 28;
  for (let s = 0; s < track.totalLengthM; s += sampleStepM) {
    if (s < 70 || s > track.totalLengthM - 70) continue;
    const { widthM } = pointNormalWidthAndSegmentOnTrack(track, s);
    const surface = surfaceForTrackSM(track.totalLengthM, s, false, trackSeed, themeKind);
    const gravel01 = surface.name === "gravel" || surface.name === "sand" ? 1 : 0;
    const narrowness01 = clamp01((narrowThreshold - widthM) / Math.max(1e-6, narrowThreshold));
    // Lore: narrow parts are rockier. Bias clumps heavily towards narrowness.
    const w = 0.10 + 2.9 * (narrowness01 * narrowness01) + 1.0 * gravel01;
    if (w > 0.25) candidates.push({ sM: s, w });
  }

  const pickWeighted = (): number => {
    if (candidates.length === 0) return rand() * track.totalLengthM;
    let total = 0;
    for (const c of candidates) total += c.w;
    let r = rand() * total;
    for (const c of candidates) {
      r -= c.w;
      if (r <= 0) return c.sM;
    }
    return candidates[candidates.length - 1].sM;
  };

  const clumpCount = 4 + Math.floor(rand() * 4); // 4..7
  const clumps: { centerM: number; radiusM: number; strength: number }[] = [];
  for (let i = 0; i < clumpCount; i++) {
    const centerM = pickWeighted();
    const radiusM = 65 + rand() * 115; // 65..180
    const strength = 0.55 + rand() * 0.75; // 0.55..1.30
    clumps.push({ centerM, radiusM, strength });
  }

  const wrapDelta = (a: number, b: number): number => {
    // shortest signed delta along the loop [-(L/2)..(L/2)]
    const L = track.totalLengthM;
    let d = (a - b) % L;
    if (d > L * 0.5) d -= L;
    if (d < -L * 0.5) d += L;
    return d;
  };

  const clumpBoostAt = (sM: number): number => {
    let best = 0;
    for (const c of clumps) {
      const d = Math.abs(wrapDelta(sM, c.centerM));
      const t = d / Math.max(1e-6, c.radiusM);
      const w = Math.exp(-t * t * 2.2) * c.strength;
      if (w > best) best = w;
    }
    return clamp01(best);
  };

  const gutterWidthM = themeKind === "rainforest" ? 3.2 : (themeKind === "arctic" ? 2.9 : 2.7);

  const clamp01Hash = (x: number): number => {
    // Deterministic hash -> [0..1)
    let v = (x ^ (trackSeed * 2654435761)) >>> 0;
    v ^= v << 13;
    v ^= v >>> 17;
    v ^= v << 5;
    return ((v >>> 0) % 1_000_000) / 1_000_000;
  };

  const zoneSizeM = 150;
  const zoneFactorAt = (sM: number): number => {
    const idx = Math.floor(sM / zoneSizeM);
    const a = clamp01Hash(idx ^ 0x51a3);
    const b = clamp01Hash((idx + 1) ^ 0x51a3);
    const t = clamp01((sM - idx * zoneSizeM) / zoneSizeM);
    const smooth = t * t * (3 - 2 * t);
    const v = a * (1 - smooth) + b * smooth;

    // Create long-ish no-rock stretches and occasional heavy zones.
    if (v < 0.30) return 0;
    if (v < 0.55) return 0.85;
    if (v < 0.80) return 1.60;
    return 3.00;
  };

  const convexHull = (pts: Vec2[]): Vec2[] => {
    if (pts.length <= 3) return pts.slice();
    const sorted = pts
      .slice()
      .sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
    const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Vec2[] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: Vec2[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  };

  const makeRockPoly = (seedId: number, baseR: number): { poly: Vec2[]; extentR: number; rotationRad: number } => {
    let s = (seedId ^ 0x9e3779b9) >>> 0;
    const rand01 = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 10_000) / 10_000;
    };

    const rotationRad = rand01() * Math.PI * 2;
    const sides = 4 + Math.floor(rand01() * 5); // 4..8
    const irregular = 0.12 + rand01() * 0.14; // keep convex-ish
    const baseAng = -Math.PI / 2 + (rand01() - 0.5) * 0.18;

    const pts: Vec2[] = [];
    for (let i = 0; i < sides; i++) {
      const a = baseAng + (i / sides) * Math.PI * 2 + (rand01() - 0.5) * 0.09;
      const rr = baseR * (1 - irregular + rand01() * (irregular * 2));
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }

    const poly = convexHull(pts);
    let extentR = 0;
    for (const p of poly) extentR = Math.max(extentR, Math.hypot(p.x, p.y));
    return { poly, extentR, rotationRad };
  };

  let id = 50_000;
  let s = 0;
  while (s < track.totalLengthM) {
    const zone01 = zoneFactorAt(s);
    // Non-uniform stepping keeps distribution from looking "placed on a grid".
    // Make empty zones sparser (fewer attempts).
    const baseStep = themeKind === "rainforest" ? 7.5 : (themeKind === "arctic" ? 9.0 : 8.5);
    const zoneStepScale = zone01 <= 1e-6 ? 2.2 : (zone01 < 1.0 ? 1.00 : 0.55);
    const step = baseStep * zoneStepScale * (0.55 + rand() * 1.00);
    s += step;
    if (s < 70 || s > track.totalLengthM - 70) continue;

    const { p, normal, widthM } = pointNormalWidthAndSegmentOnTrack(track, s);
    const surface = surfaceForTrackSM(track.totalLengthM, s, false, trackSeed, themeKind);

    const narrowness01 = clamp01((narrowThreshold - widthM) / Math.max(1e-6, narrowThreshold));
    const gravel01 = surface.name === "gravel" || surface.name === "sand" ? 1 : 0;
    const feature01 = clamp01(0.72 * narrowness01 + 0.55 * gravel01);
    const clump01 = clumpBoostAt(s);

    // Big-scale variation: whole stretches with none / some / lots.
    if (zone01 <= 1e-6) continue;

    // Expected count per step: clumpy near narrow/gravel, lighter elsewhere.
    // (We keep this fairly high, but placement is constrained to the gutter.)
    const narrowBoost = 1 + 1.15 * (narrowness01 * narrowness01);
    const expected = (0.22 + 1.55 * clump01 + 1.05 * feature01) * zone01 * narrowBoost;
    let count = Math.floor(expected);
    if (rand() < (expected - count)) count++;
    // Occasionally sprinkle extra even on "boring" parts.
    if (count === 0 && rand() < 0.10 * zone01) count = 1;
    if (count <= 0) continue;
    // Cap to avoid absurd piles.
    count = Math.min(count, 12);

    // In very narrow squeezes, often add both-side edge hazards.
    const veryNarrow = widthM < narrowThreshold * 0.92;

    for (let n = 0; n < count; n++) {
      // Size: larger in clumps/features, with variety.
      let r = lerp(0.55, 1.45, clamp01(0.18 + 0.60 * clump01 + 0.65 * feature01 + 0.35 * narrowness01)) * (0.78 + rand() * 0.55);
      // Occasionally spawn large / huge rocks, especially in narrow rocky clumps.
      const bigChance = clamp01(0.05 + 0.18 * clump01 + 0.10 * zone01 + 0.10 * narrowness01);
      const hugeChance = clamp01(0.008 + 0.035 * clump01 + 0.020 * narrowness01);
      if (rand() < hugeChance) r *= 2.2 + rand() * 1.1;
      else if (rand() < bigChance) r *= 1.35 + rand() * 0.75;

      const shape = makeRockPoly(id ^ Math.floor(s * 17) ^ (n * 1013), r);
      const poly = shape.poly;
      const extentR = Math.max(0.15, shape.extentR);

      const sides: number[] = (veryNarrow && rand() < 0.85)
        ? [-1, 1]
        : [rand() < 0.5 ? -1 : 1];

      for (const sign of sides) {
        const roadHalfWidthM = widthM * 0.5;

        // Allow some rocks to be further from the road center in high-density zones.
        const far01 = clamp01(0.10 + 0.60 * zone01 + 0.45 * clump01 + 0.35 * feature01);
        const farBandM = lerp(gutterWidthM, 16.0, Math.max(0, far01 - 0.65) / 0.35);

        const minOffset = roadHalfWidthM + extentR + safetyGapM;
        const maxOffset = roadHalfWidthM + extentR + farBandM;
        if (maxOffset <= minOffset) continue;

        const extra = lerp(0.95, 0.35, feature01);
        const offset = clamp(minOffset + rand() * (maxOffset - minOffset) * extra, minOffset, maxOffset);

        const jitterAlong = (rand() - 0.5) * lerp(11.0, 2.8, feature01);
        const jitterOut = (rand() - 0.5) * 0.55;

        const tx = -normal.y;
        const ty = normal.x;
        const x = p.x + normal.x * sign * (offset + jitterOut) + tx * jitterAlong;
        const y = p.y + normal.y * sign * (offset + jitterOut) + ty * jitterAlong;
        const rotationRad = shape.rotationRad;

        // Validate against the entire track (avoid overlaps with any road segment).
        let overlapsRoad = false;
        for (let i = 0; i < track.points.length - 1; i++) {
          const a = track.points[i];
          const b = track.points[i + 1];
          const dist = pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y);
          const segW = track.segmentWidthsM ? (track.segmentWidthsM[i] ?? track.widthM) : track.widthM;
          const segHalf = segW * 0.5;
          if (dist < segHalf + extentR + safetyGapM) {
            overlapsRoad = true;
            break;
          }
        }

        if (!overlapsRoad) {
          // Keep a conservative circle radius for quick checks, but collisions should use `poly`.
          rocks.push({ id: id++, kind: "rock", x, y, r: extentR, collR: extentR, rotationRad, poly });
        }
      }
    }
  }

  return rocks;
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

function pointNormalWidthAndSegmentOnTrack(track: Track, sM: number): { p: Vec2; normal: Vec2; widthM: number } {
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

  const widthM = (track.segmentWidthsM && track.segmentWidthsM.length === track.points.length)
    ? (track.segmentWidthsM[segmentIndex] ?? track.widthM)
    : track.widthM;

  return { p: { x, y }, normal: { x: nx, y: ny }, widthM };
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
  // Reduce overall density to make debris feel like events, not constant spam.
  const minSpacing = themeKind === "rainforest" ? 150 : (themeKind === "arctic" ? 240 : 185);
  const maxSpacing = themeKind === "rainforest" ? 300 : (themeKind === "arctic" ? 430 : 340);
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
      ? (1 + Math.floor(rand() * 3))
      : (themeKind === "arctic" ? (1 + Math.floor(rand() * 2)) : (1 + Math.floor(rand() * 3)));

    const tangentAngle = Math.atan2(ty, tx);

    // Occasionally place a true "blocker" log roughly across the road, near center.
    // Keep these rarer so they feel like events, not spam.
    const hasBlocker = rand() < 0.10;

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
