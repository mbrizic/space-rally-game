import { mulberry32 } from "./rng";
import { generateCity, type City } from "./city";
import { stageMetaFromSeed, type StageThemeKind, type StageThemeRef, type TrackZone, type TrackZoneKind } from "./stage";

export type Vec2 = { x: number; y: number };

// Smooth an array of values using a simple moving average to reduce harsh transitions
function smoothWidths(widths: number[], windowSize: number = 5): number[] {
  if (widths.length < windowSize) return widths;
  const result: number[] = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < widths.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < widths.length) {
        sum += widths[idx];
        count++;
      }
    }
    result.push(sum / count);
  }
  return result;
}

export type TrackDefinition = {
  points: Vec2[]; // Point-to-point: last point is the end
  baseWidthM: number;
  segmentWidthsM?: number[]; // optional per-segment widths (same length as points)
  startCity?: City;
  endCity?: City;
  meta?: {
    name?: string;
    seed?: number;
    source?: "procedural" | "editor" | "point-to-point";
    theme?: StageThemeRef;
    zones?: TrackZone[];
  };
};

export type Track = {
  points: Vec2[];
  widthM: number; // default/base width
  segmentWidthsM?: number[]; // optional per-segment widths (same length as points)
  segmentLengthsM: number[];
  cumulativeLengthsM: number[]; // same length as points; cumulative at each point
  totalLengthM: number;
  startCity?: City;
  endCity?: City;
};

export type TrackProjection = {
  sM: number; // distance along centerline [0..totalLength)
  closest: Vec2;
  normal: Vec2; // left-hand normal of the closest segment (unit)
  segmentIndex: number;
  t: number; // [0..1] along segment
  lateralOffsetM: number; // signed distance from centerline (approx)
  distanceToCenterlineM: number;
  widthM: number; // width at this segment
};

export function createTrackFromDefinition(def: TrackDefinition): Track {
  const track = buildTrackFromPoints(def.points, def.baseWidthM, def.segmentWidthsM);
  track.startCity = def.startCity;
  track.endCity = def.endCity;
  return track;
}

export function serializeTrackDefinition(def: TrackDefinition): string {
  return JSON.stringify(def);
}

export function parseTrackDefinition(json: string): TrackDefinition | null {
  try {
    const v = JSON.parse(json) as Partial<TrackDefinition>;
    if (!v || !Array.isArray(v.points) || typeof v.baseWidthM !== "number") return null;
    const baseWidthM = v.baseWidthM;
    const points: Vec2[] = [];
    for (const p of v.points) {
      if (!p || typeof (p as any).x !== "number" || typeof (p as any).y !== "number") return null;
      points.push({ x: (p as any).x, y: (p as any).y });
    }
    const segmentWidthsM =
      Array.isArray(v.segmentWidthsM) && v.segmentWidthsM.length === points.length
        ? v.segmentWidthsM.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : baseWidthM))
        : undefined;

    const meta = v.meta && typeof v.meta === "object" ? (v.meta as any) : undefined;

    const isThemeKind = (k: any): k is StageThemeKind =>
      k === "temperate" || k === "rainforest" || k === "desert" || k === "arctic";
    const safeTheme: StageThemeRef | undefined =
      meta?.theme && typeof meta.theme === "object" && isThemeKind((meta.theme as any).kind)
        ? { kind: (meta.theme as any).kind as StageThemeKind }
        : undefined;

    const isZoneKind = (k: any): k is TrackZoneKind =>
      k === "rain" || k === "fog" || k === "eclipse" || k === "electrical" || k === "sandstorm";

    const safeZones: TrackZone[] | undefined = Array.isArray(meta?.zones)
      ? (meta.zones as any[])
          .map((z) => {
            if (!z || typeof z !== "object") return null;
            if (!isZoneKind((z as any).kind)) return null;
            const start01 = typeof (z as any).start01 === "number" ? (z as any).start01 : NaN;
            const end01 = typeof (z as any).end01 === "number" ? (z as any).end01 : NaN;
            const intensity01 = typeof (z as any).intensity01 === "number" ? (z as any).intensity01 : NaN;
            if (!Number.isFinite(start01) || !Number.isFinite(end01) || !Number.isFinite(intensity01)) return null;
            return {
              kind: (z as any).kind as TrackZoneKind,
              start01: Math.max(0, Math.min(1, start01)),
              end01: Math.max(0, Math.min(1, end01)),
              intensity01: Math.max(0, Math.min(1, intensity01))
            } satisfies TrackZone;
          })
          .filter(Boolean) as TrackZone[]
      : undefined;

    const hasAnyMeta = !!(
      meta &&
      (meta.name || meta.seed || meta.source || safeTheme || (safeZones && safeZones.length > 0))
    );

    const safeMeta = hasAnyMeta
      ? {
          name: typeof meta?.name === "string" ? meta.name : undefined,
          seed: typeof meta?.seed === "number" ? meta.seed : undefined,
          source:
            meta?.source === "procedural" || meta?.source === "editor" || meta?.source === "point-to-point"
              ? meta.source
              : undefined,
          theme: safeTheme,
          zones: safeZones
        }
      : undefined;

    return {
      points,
      baseWidthM,
      segmentWidthsM,
      meta: safeMeta
    };
  } catch {
    return null;
  }
}

export type ProceduralTrackOptions = {
  controlPoints?: number;
  baseRadiusM?: number;
  radiusJitterM?: number;
  baseWidthM?: number;
  samplesPerSegment?: number;
};

export function createProceduralTrackDefinition(seed: number, opts?: ProceduralTrackOptions): TrackDefinition {
  const rand = mulberry32(Math.floor(seed) || 1);

  const stageMeta = stageMetaFromSeed(seed);

  const controlCount = Math.max(8, Math.floor(opts?.controlPoints ?? 18));
  const baseRadiusM = Math.max(20, opts?.baseRadiusM ?? 60);
  const radiusJitterM = Math.max(0, opts?.radiusJitterM ?? 28);
  const baseWidthM = Math.max(6, opts?.baseWidthM ?? 7.0);
  const samplesPerSegment = Math.max(6, Math.floor(opts?.samplesPerSegment ?? 9));

  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;

  const controlPoints: Vec2[] = [];
  for (let i = 0; i < controlCount; i++) {
    const t = i / controlCount;
    const angle = t * Math.PI * 2;

    const smoothNoise =
      0.55 * Math.sin(angle * 2 + phase1) +
      0.25 * Math.sin(angle * 5 + phase2) +
      (rand() - 0.5) * 0.25;
    const r = baseRadiusM + smoothNoise * radiusJitterM;

    controlPoints.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  const points = sampleClosedCatmullRom(controlPoints, samplesPerSegment);

  // Width variance: smooth sinusoidal + a couple of narrow "squeeze" zones.
  const squeezeCenters = [rand(), rand(), rand()].sort((a, b) => a - b);
  const rawWidthsM: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const s = i / points.length;

    // Reduced amplitude and slower frequency for smoother transitions
    let widthMult =
      1 +
      0.18 * Math.sin(s * Math.PI * 2 * 2 + phase1) +
      0.08 * Math.sin(s * Math.PI * 2 * 4 + phase2);
    widthMult += (rand() - 0.5) * 0.02;
    widthMult = clamp(widthMult, 0.68, 1.28);

    for (const c of squeezeCenters) {
      const d = circular01Distance(s, c);
      if (d < 0.030) widthMult *= lerp(0.66, 1, d / 0.030);
    }

    rawWidthsM.push(baseWidthM * clamp(widthMult, 0.58, 1.32));
  }
  // Smooth the widths to avoid jarring transitions
  const segmentWidthsM = smoothWidths(rawWidthsM, 7);

  return {
    points,
    baseWidthM,
    segmentWidthsM,
    meta: { name: `Procedural ${seed}`, seed, source: "procedural", theme: stageMeta.theme, zones: stageMeta.zones }
  };
}

export function createProceduralTrack(seed: number, opts?: ProceduralTrackOptions): Track {
  return createTrackFromDefinition(createProceduralTrackDefinition(seed, opts));
}

function createSeparatedRoute(rand: () => number, distanceM: number, rotation: number): Vec2[] {
  const cornerCount = 5 + Math.floor(rand() * 3);
  const entryHeading = 0.10;
  const hairpinChance = rand() < 0.25 ? 0.12 : 0.45;
  const corners = Array.from({ length: cornerCount }, () => {
    const roll = rand();
    const angle = roll < hairpinChance ? Math.PI - entryHeading * 2 : roll < 0.65 ? 1.65 + rand() * 0.40 : 2.25 + rand() * 0.50;
    const radiusM = roll < 0.65 ? 20 + rand() * 12 : 80 + rand() * 18;
    return { angle, radiusM, lengthM: radiusM * angle };
  });
  if (corners.every(corner => corner.radiusM > 32)) {
    const corner = corners[Math.floor(rand() * cornerCount)];
    corner.radiusM = 24;
    corner.lengthM = corner.radiusM * corner.angle;
  }
  const cornerLengthM = corners.reduce((sum, corner) => sum + corner.lengthM, 0);
  const scale = Math.min(1, distanceM * 0.72 / cornerLengthM);
  const connectingLengthM = (distanceM - cornerLengthM * scale) / (cornerCount + 1);
  const route: Vec2[] = [{ x: 0, y: 0 }];
  let position = { x: 0, y: 0 };
  let heading = entryHeading;

  const appendArc = (angleChange: number, radiusM: number): void => {
    const direction = Math.sign(angleChange);
    const arcLengthM = Math.abs(angleChange) * radiusM;
    const steps = Math.max(2, Math.ceil(arcLengthM / 12));
    const origin = position;
    const initialHeading = heading;
    for (let step = 1; step <= steps; step++) {
      const nextHeading = initialHeading + angleChange * step / steps;
      position = {
        x: origin.x + radiusM * direction * (Math.sin(nextHeading) - Math.sin(initialHeading)),
        y: origin.y + radiusM * direction * (Math.cos(initialHeading) - Math.cos(nextHeading))
      };
      route.push(position);
    }
    heading += angleChange;
  };

  for (let index = 0; index <= cornerCount; index++) {
    const direction = index % 2 === 0 ? 1 : -1;
    const corner = corners[index];
    const nextHeading = corner ? Math.PI / 2 - direction * corner.angle / 2 : heading;
    const meanderAngle = 0.35 + rand() * 0.20;
    const middleHeading = direction > 0 ? Math.max(heading, nextHeading) + meanderAngle : Math.min(heading, nextHeading) - meanderAngle;
    const entryAngle = middleHeading - heading;
    const exitAngle = nextHeading - middleHeading;
    const meanderRadiusM = connectingLengthM / (Math.abs(entryAngle) + Math.abs(exitAngle));
    appendArc(entryAngle, meanderRadiusM);
    appendArc(exitAngle, meanderRadiusM);
    if (corner) appendArc(corner.angle * direction, corner.radiusM * scale);
  }

  const mirror = rand() < 0.5 ? -1 : 1;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return route.map(point => ({
    x: point.x * cosine - point.y * mirror * sine,
    y: point.x * sine + point.y * mirror * cosine
  }));
}

/**
 * Check if a track has any self-intersections
 */
function hasTrackSelfIntersection(points: Vec2[]): boolean {
  // Simple check for crossing segments
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    
    for (let j = i + 3; j < points.length - 1; j++) {
      const p3 = points[j];
      const p4 = points[j + 1];
      
      if (segmentsIntersect(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a track has long straight sections
 */
function hasLongStraightSection(points: Vec2[], maxLengthM: number = 100): boolean {
  if (points.length < 4) return false;
  
  const curvatureThreshold = 0.01; // Very low curvature = straight
  let currentStraightLength = 0;
  
  for (let i = 0; i < points.length - 2; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2];
    
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    
    let angleChange = angle2 - angle1;
    while (angleChange > Math.PI) angleChange -= Math.PI * 2;
    while (angleChange < -Math.PI) angleChange += Math.PI * 2;
    
    const segmentLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    
    if (Math.abs(angleChange) < curvatureThreshold) {
      currentStraightLength += segmentLength;
      if (currentStraightLength > maxLengthM) {
        return true; // Found a long straight!
      }
    } else {
      currentStraightLength = 0; // Reset
    }
  }
  
  return false;
}

function segmentsIntersect(
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  p4x: number, p4y: number
): boolean {
  const d1x = p2x - p1x;
  const d1y = p2y - p1y;
  const d2x = p4x - p3x;
  const d2y = p4y - p3y;
  
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-10) return false;
  
  const t1 = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / denominator;
  const t2 = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / denominator;
  
  const epsilon = 0.01;
  return t1 > epsilon && t1 < (1 - epsilon) && t2 > epsilon && t2 < (1 - epsilon);
}

export function createPointToPointTrackDefinition(seed: number): TrackDefinition {
  const maxAttempts = 15; // More attempts for stricter criteria
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = seed + attempt * 1000;
    const result = tryCreatePointToPointTrackDefinition(attemptSeed);
    
    // Check if this track meets quality standards
    const hasIntersection = hasTrackSelfIntersection(result.points);
    const hasStraights = hasLongStraightSection(result.points, 100);
    
    if (!hasIntersection && !hasStraights) {
      // Success! Keep the retry seed internal; present the base seed to UI/serialization.
      const meta = result.meta ?? {};
      return {
        ...result,
        meta: {
          ...meta,
          seed,
          name: `Route ${seed}`
        }
      };
    }
  }
  
  // If all attempts failed, return the best one we can find
  console.warn(`Track generation: All ${maxAttempts} attempts failed quality checks for seed ${seed}`);
  const result = tryCreatePointToPointTrackDefinition(seed + (maxAttempts - 1) * 1000);
  const meta = result.meta ?? {};
  return {
    ...result,
    meta: {
      ...meta,
      seed,
      name: `Route ${seed}`
    }
  };
}

function tryCreatePointToPointTrackDefinition(seed: number): TrackDefinition {
  const rand = mulberry32(Math.floor(seed) || 1);

  const stageMeta = stageMetaFromSeed(seed);
  
  // Track layout:
  // 0-50m: Starting city
  // 50m: START LINE (exit of starting city)
  // 50m to end-50m: The race route
  // end-50m: FINISH LINE (entrance to ending city)
  // end-50m to end: Ending city
  
  const cityLength = 50; // Length of road through each city
  const minDistance = 1100; // LONGER: more room for fun fast segments
  const maxDistance = 1800;
  const distance = minDistance + rand() * (maxDistance - minDistance);
  const angle = rand() * Math.PI * 2;
  
  const routePoints = createSeparatedRoute(rand, distance, angle);
  
  // Calculate direction at start and end of route
  const startDir = { 
    x: routePoints[1].x - routePoints[0].x, 
    y: routePoints[1].y - routePoints[0].y 
  };
  const startLen = Math.hypot(startDir.x, startDir.y);
  const startDirNorm = { 
    x: startDir.x / startLen, 
    y: startDir.y / startLen 
  };
  
  const endDir = { 
    x: routePoints[routePoints.length - 1].x - routePoints[routePoints.length - 2].x,
    y: routePoints[routePoints.length - 1].y - routePoints[routePoints.length - 2].y
  };
  const endLen = Math.hypot(endDir.x, endDir.y);
  const endDirNorm = { 
    x: endDir.x / endLen, 
    y: endDir.y / endLen 
  };
  
  // Build complete track: city -> route -> city
  const allPoints: Vec2[] = [];
  
  // Add starting city section (backwards from route start)
  for (let i = 5; i > 0; i--) {
    const dist = cityLength * i / 5;
    allPoints.push({
      x: routePoints[0].x - startDirNorm.x * dist,
      y: routePoints[0].y - startDirNorm.y * dist
    });
  }
  
  // Add main route
  allPoints.push(...routePoints);
  
  // Add ending city section (forwards from route end)
  for (let i = 1; i <= 5; i++) {
    const dist = cityLength * i / 5;
    allPoints.push({
      x: routePoints[routePoints.length - 1].x + endDirNorm.x * dist,
      y: routePoints[routePoints.length - 1].y + endDirNorm.y * dist
    });
  }
  
  // Place cities at the midpoints of their sections
  const startCityX = routePoints[0].x - startDirNorm.x * (cityLength / 2);
  const startCityY = routePoints[0].y - startDirNorm.y * (cityLength / 2);
  const endCityX = routePoints[routePoints.length - 1].x + endDirNorm.x * (cityLength / 2);
  const endCityY = routePoints[routePoints.length - 1].y + endDirNorm.y * (cityLength / 2);
  
  // Ensure cities are FAR apart (minimum 350m straight-line distance)
  const cityDistance = Math.hypot(endCityX - startCityX, endCityY - startCityY);
  const minCityDistance = 350; // MUCH stricter minimum
  
  if (cityDistance < minCityDistance) {
    // Cities are too close! Push the end city away
    const pushDirection = {
      x: (endCityX - startCityX) / cityDistance,
      y: (endCityY - startCityY) / cityDistance
    };
    const pushAmount = minCityDistance - cityDistance;
    
    // Move the end city and the end of the route
    const adjustedEndCityX = endCityX + pushDirection.x * pushAmount;
    const adjustedEndCityY = endCityY + pushDirection.y * pushAmount;
    
    // Adjust the last few route points to smooth the transition
    const adjustPoints = Math.min(5, Math.floor(routePoints.length * 0.3));
    for (let i = routePoints.length - adjustPoints; i < routePoints.length; i++) {
      const t = (i - (routePoints.length - adjustPoints)) / adjustPoints;
      const smoothT = t * t * (3 - 2 * t); // Smooth step
      routePoints[i].x += pushDirection.x * pushAmount * smoothT;
      routePoints[i].y += pushDirection.y * pushAmount * smoothT;
    }
    
    // Update allPoints that were already added
    const routeStartIdx = 5; // After the starting city section
    for (let i = 0; i < routePoints.length; i++) {
      allPoints[routeStartIdx + i] = routePoints[i];
    }
    
    // Recalculate ending city section
    const newEndDir = {
      x: routePoints[routePoints.length - 1].x - routePoints[routePoints.length - 2].x,
      y: routePoints[routePoints.length - 1].y - routePoints[routePoints.length - 2].y
    };
    const newEndLen = Math.hypot(newEndDir.x, newEndDir.y);
    const newEndDirNorm = {
      x: newEndDir.x / newEndLen,
      y: newEndDir.y / newEndLen
    };
    
    // Replace ending city section points
    allPoints.length = routeStartIdx + routePoints.length; // Trim old ending city
    for (let i = 1; i <= 5; i++) {
      const dist = cityLength * i / 5;
      allPoints.push({
        x: routePoints[routePoints.length - 1].x + newEndDirNorm.x * dist,
        y: routePoints[routePoints.length - 1].y + newEndDirNorm.y * dist
      });
    }
    
    // Use adjusted positions for cities
    const startRoadAngle = Math.atan2(startDirNorm.y, startDirNorm.x);
    const endRoadAngle = Math.atan2(newEndDirNorm.y, newEndDirNorm.x);
  
    const baseWidthM = 7.0;
    
    // Width variance - smooth sinusoidal change with minimal per-segment noise
    const rawWidthsM: number[] = [];
    for (let i = 0; i < allPoints.length; i++) {
      const t = i / allPoints.length;
      // Slower sine wave for gradual transitions, reduced random noise
      let widthMult = 1 + 0.15 * Math.sin(t * Math.PI * 3) + (rand() - 0.5) * 0.04;
      widthMult = clamp(widthMult, 0.72, 1.20);
      rawWidthsM.push(baseWidthM * widthMult);
    }
    // Smooth the widths to avoid sudden jumps
    const segmentWidthsM = smoothWidths(rawWidthsM, 7);
    
    // Create track structure for collision checking (cities need to check against full track)
    const trackForCollisionCheck = { points: allPoints, widthM: baseWidthM };
    
    // Generate cities with adjusted positions AND the full track for collision checking
    const startCity = generateCity(startCityX, startCityY, seed, { 
      numStores: 4, 
      numDecorations: 6,
      roadAngle: startRoadAngle,
      track: trackForCollisionCheck
    });
    const endCity = generateCity(adjustedEndCityX, adjustedEndCityY, seed + 1000, { 
      numStores: 4, 
      numDecorations: 6,
      roadAngle: endRoadAngle,
      track: trackForCollisionCheck
    });
    
    return {
      points: allPoints,
      baseWidthM,
      segmentWidthsM,
      startCity,
      endCity,
      meta: { name: `Route ${seed}`, seed, source: "point-to-point", theme: stageMeta.theme, zones: stageMeta.zones }
    };
  }
  
  const startRoadAngle = Math.atan2(startDirNorm.y, startDirNorm.x);
  const endRoadAngle = Math.atan2(endDirNorm.y, endDirNorm.x);
  
  const baseWidthM = 7.0;
  
  // Width variance - smooth sinusoidal change with minimal per-segment noise
  const rawWidthsM: number[] = [];
  for (let i = 0; i < allPoints.length; i++) {
    const t = i / allPoints.length;
    // Slower sine wave for gradual transitions, reduced random noise
    let widthMult = 1 + 0.15 * Math.sin(t * Math.PI * 3) + (rand() - 0.5) * 0.04;
    widthMult = clamp(widthMult, 0.72, 1.20);
    rawWidthsM.push(baseWidthM * widthMult);
  }
  // Smooth the widths to avoid sudden jumps
  const segmentWidthsM = smoothWidths(rawWidthsM, 7);
  
  // Create track structure for collision checking (cities need to check against full track)
  const trackForCollisionCheck = { points: allPoints, widthM: baseWidthM };
  
  // Generate cities with road angle information AND the full track for collision checking
  const startCity = generateCity(startCityX, startCityY, seed, { 
    numStores: 4, 
    numDecorations: 6,
    roadAngle: startRoadAngle,
    track: trackForCollisionCheck
  });
  const endCity = generateCity(endCityX, endCityY, seed + 1000, { 
    numStores: 4, 
    numDecorations: 6,
    roadAngle: endRoadAngle,
    track: trackForCollisionCheck
  });
  
  return {
    points: allPoints,
    baseWidthM,
    segmentWidthsM,
    startCity,
    endCity,
    meta: { name: `Route ${seed}`, seed, source: "point-to-point", theme: stageMeta.theme, zones: stageMeta.zones }
  };
}

function buildTrackFromPoints(points: Vec2[], widthM: number, segmentWidthsM?: number[]): Track {
  const segmentLengthsM: number[] = [];
  const cumulativeLengthsM: number[] = [];
  let total = 0;
  
  const numSegments = points.length - 1;
  
  for (let i = 0; i < numSegments; i++) {
    cumulativeLengthsM.push(total);
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    segmentLengthsM.push(len);
    total += len;
  }
  
  // Add a final cumulative length entry
  cumulativeLengthsM.push(total);
  segmentLengthsM.push(0); // No segment after last point

  return {
    points,
    widthM,
    segmentWidthsM,
    segmentLengthsM,
    cumulativeLengthsM,
    totalLengthM: total
  };
}

function sampleClosedCatmullRom(control: Vec2[], samplesPerSegment: number): Vec2[] {
  if (control.length < 4) return control.slice();
  const steps = Math.max(2, Math.floor(samplesPerSegment));

  const out: Vec2[] = [];
  for (let i = 0; i < control.length; i++) {
    const p0 = control[(i - 1 + control.length) % control.length];
    const p1 = control[i];
    const p2 = control[(i + 1) % control.length];
    const p3 = control[(i + 2) % control.length];

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  return out;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  // Uniform Catmull-Rom spline (centripetal would be nicer, but uniform is fine for now).
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    ((2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    ((2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function circular01Distance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

export function projectToTrack(track: Track, p: Vec2): TrackProjection {
  let bestDist2 = Number.POSITIVE_INFINITY;
  let best: TrackProjection | null = null;

  const numSegments = track.points.length - 1;

  for (let i = 0; i < numSegments; i++) {
    const a = track.points[i];
    const b = track.points[i + 1];

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;

    const abLen2 = abx * abx + aby * aby;
    const t = abLen2 > 1e-9 ? clamp01((apx * abx + apy * aby) / abLen2) : 0;
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;

    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= bestDist2) continue;

    const segLen = track.segmentLengthsM[i];
    const sM = track.cumulativeLengthsM[i] + segLen * t;

    // Signed lateral offset using segment normal (left-hand normal).
    const segLenSafe = Math.max(1e-6, Math.hypot(abx, aby));
    const nx = -aby / segLenSafe;
    const ny = abx / segLenSafe;
    const lateral = dx * nx + dy * ny;

    // Get width for this segment
    const widthM = track.segmentWidthsM ? track.segmentWidthsM[i] : track.widthM;

    bestDist2 = dist2;
    best = {
      sM,
      closest: { x: cx, y: cy },
      normal: { x: nx, y: ny },
      segmentIndex: i,
      t,
      lateralOffsetM: lateral,
      distanceToCenterlineM: Math.sqrt(dist2),
      widthM
    };
  }

  if (!best) {
    return {
      sM: 0,
      closest: { x: 0, y: 0 },
      normal: { x: 0, y: 1 },
      segmentIndex: 0,
      t: 0,
      lateralOffsetM: 0,
      distanceToCenterlineM: 0,
      widthM: track.widthM
    };
  }

  return best;
}

export function pointOnTrack(track: Track, sM: number): { p: Vec2; headingRad: number } {
  const s = clamp(sM, 0, track.totalLengthM);

  let segmentIndex = 0;
  for (let i = 0; i < track.segmentLengthsM.length - 1; i++) {
    const start = track.cumulativeLengthsM[i];
    const end = start + track.segmentLengthsM[i];
    if (s >= start && s < end) {
      segmentIndex = i;
      break;
    }
  }

  const a = track.points[segmentIndex];
  const b = track.points[segmentIndex + 1];
  const segLen = track.segmentLengthsM[segmentIndex];
  const t = segLen > 1e-9 ? (s - track.cumulativeLengthsM[segmentIndex]) / segLen : 0;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const headingRad = Math.atan2(b.y - a.y, b.x - a.x);

  return { p: { x, y }, headingRad };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
