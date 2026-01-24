import { mulberry32 } from "./rng";
import { generateCity, type City } from "./city";

// Helper function for render style selection
function getRandomRenderStyle(seed: number): "clean" | "realistic" | "day" | "night" {
  const styles = ["clean", "realistic", "day", "night"] as const;
  const rng = mulberry32(seed + 9999); // Offset seed for style selection
  const index = Math.floor(rng() * styles.length);
  return styles[index];
}

export type Vec2 = { x: number; y: number };

export type TrackCornerInfo = {
  type: "hairpin" | "sharp" | "medium" | "gentle" | "chicane";
  direction: "L" | "R";
  startSM: number; // Track position where corner starts (meters)
  endSM: number;   // Track position where corner ends (meters)
  angleChange: number; // Total angle change in radians
};

export type TrackDefinition = {
  points: Vec2[]; // Point-to-point: last point is the end
  baseWidthM: number;
  segmentWidthsM?: number[]; // optional per-segment widths (same length as points)
  startCity?: City;
  endCity?: City;
  corners?: TrackCornerInfo[]; // Planned corners for pacenotes
  meta?: { name?: string; seed?: number; source?: "default" | "procedural" | "editor" | "point-to-point" };
  renderStyle?: "clean" | "realistic" | "day" | "night";
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
  corners?: TrackCornerInfo[]; // Planned corners for pacenotes
  renderStyle?: "clean" | "realistic" | "day" | "night";
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
  track.corners = def.corners;
  track.renderStyle = def.renderStyle;
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
    const safeMeta =
      meta && (meta.name || meta.seed || meta.source)
        ? {
            name: typeof meta.name === "string" ? meta.name : undefined,
            seed: typeof meta.seed === "number" ? meta.seed : undefined,
            source: meta.source === "default" || meta.source === "procedural" || meta.source === "editor" ? meta.source : undefined
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

export function createDefaultTrackDefinition(): TrackDefinition {
  // Closed-loop rally-ish stage, specified as sparse control points in meters.
  const controlPoints: Vec2[] = [
    { x: 0, y: 0 },
    { x: 42, y: 0 },
    { x: 65, y: 12 },
    // Add chicane swerve
    { x: 72, y: 22 },
    { x: 78, y: 34 },
    { x: 70, y: 58 },
    { x: 48, y: 72 },
    { x: 22, y: 66 },
    // Tighter swerve section
    { x: 12, y: 54 },
    { x: 8, y: 46 },
    { x: -6, y: 30 },
    { x: -28, y: 22 },
    { x: -48, y: 30 },
    // Chicane
    { x: -58, y: 42 },
    { x: -62, y: 52 },
    { x: -50, y: 78 },
    { x: -20, y: 88 },
    { x: 10, y: 82 },
    { x: 34, y: 64 },
    { x: 44, y: 40 },
    // Final chicane before start
    { x: 38, y: 28 },
    { x: 30, y: 18 }
  ];
  const baseWidthM = 7.5;

  // Denser sampling makes the track smoother while keeping projection/collision simple.
  const points = sampleClosedCatmullRom(controlPoints, 10);

  // Create width variance: narrow chicanes at specific sections, wider straights.
  const segmentWidthsM: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const s = i / points.length; // normalized position [0..1]

    let widthMultiplier = 1.0;
    if ((s > 0.20 && s < 0.25) || (s > 0.45 && s < 0.50) || (s > 0.70 && s < 0.75)) {
      widthMultiplier = 0.65;
    } else if ((s > 0.10 && s < 0.15) || (s > 0.35 && s < 0.40) || (s > 0.85 && s < 0.90)) {
      widthMultiplier = 1.4;
    }

    segmentWidthsM.push(baseWidthM * widthMultiplier);
  }

  return {
    points,
    baseWidthM,
    segmentWidthsM,
    meta: { name: "Default", source: "default" }
  };
}

export function createDefaultTrack(): Track {
  return createTrackFromDefinition(createDefaultTrackDefinition());
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

  const controlCount = Math.max(8, Math.floor(opts?.controlPoints ?? 18));
  const baseRadiusM = Math.max(20, opts?.baseRadiusM ?? 60);
  const radiusJitterM = Math.max(0, opts?.radiusJitterM ?? 28);
  const baseWidthM = Math.max(6, opts?.baseWidthM ?? 7.5);
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

  // Width variance: smooth + a couple of narrow "squeeze" zones.
  const squeezeCenters = [rand(), rand(), rand()].sort((a, b) => a - b);
  const segmentWidthsM: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const s = i / points.length;

    let widthMult =
      1 +
      0.25 * Math.sin(s * Math.PI * 2 * 2 + phase1) +
      0.12 * Math.sin(s * Math.PI * 2 * 6 + phase2);
    widthMult += (rand() - 0.5) * 0.04;
    widthMult = clamp(widthMult, 0.65, 1.55);

    for (const c of squeezeCenters) {
      const d = circular01Distance(s, c);
      if (d < 0.030) widthMult *= lerp(0.62, 1, d / 0.030);
    }

    segmentWidthsM.push(baseWidthM * clamp(widthMult, 0.55, 1.65));
  }

  return {
    points,
    baseWidthM,
    segmentWidthsM,
    meta: { name: `Procedural ${seed}`, seed, source: "procedural" }
  };
}

export function createProceduralTrack(seed: number, opts?: ProceduralTrackOptions): Track {
  return createTrackFromDefinition(createProceduralTrackDefinition(seed, opts));
}

// Corner type definitions - predefined turning patterns
type CornerType = "gentle" | "medium" | "sharp" | "hairpin" | "chicane";

interface Corner {
  type: CornerType;
  angleChange: number; // Total angle change for this corner
  controlPointsNeeded: number; // How many control points to spread this across
  direction: 1 | -1; // Left or right turn
}

function createCorner(type: CornerType, direction: 1 | -1): Corner {
  switch (type) {
    case "hairpin":
      return { type, angleChange: Math.PI * 0.99 * direction, controlPointsNeeded: 6, direction }; // ~178 degrees - TIGHT HAIRPIN!
    case "sharp":
      return { type, angleChange: Math.PI * 0.5 * direction, controlPointsNeeded: 3, direction }; // ~90 degrees
    case "medium":
      return { type, angleChange: Math.PI * 0.35 * direction, controlPointsNeeded: 2, direction }; // ~63 degrees
    case "gentle":
      return { type, angleChange: Math.PI * 0.2 * direction, controlPointsNeeded: 2, direction }; // ~36 degrees
    case "chicane":
      // Chicane is a quick left-right or right-left
      return { type, angleChange: 0, controlPointsNeeded: 4, direction }; // Returns to original angle
  }
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
  // HACK/TODO: Retry logic to avoid self-intersections and straights
  // 
  // PROBLEM: This makes tracks samey and boring! Hairpins often cause loops,
  // so they get rejected. We end up with only "safe" boring tracks.
  //
  // BETTER SOLUTION NEEDED:
  // - Smarter hairpin placement (check if they'll loop BEFORE placing)
  // - Better "turn away" logic that preserves corner types
  // - Or: Accept some visual overlaps if they're not driveable intersections
  //
  // For now, this ensures NO broken tracks, but at the cost of variety.
  
  const maxAttempts = 15; // More attempts for stricter criteria
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = seed + attempt * 1000;
    const result = tryCreatePointToPointTrackDefinition(attemptSeed);
    
    // Check if this track meets quality standards
    const hasIntersection = hasTrackSelfIntersection(result.points);
    const hasStraights = hasLongStraightSection(result.points, 100);
    
    if (!hasIntersection && !hasStraights) {
      return result; // Success! Good track
    }
  }
  
  // If all attempts failed, return the best one we can find
  console.warn(`Track generation: All ${maxAttempts} attempts failed quality checks for seed ${seed}`);
  return tryCreatePointToPointTrackDefinition(seed + (maxAttempts - 1) * 1000);
}

function tryCreatePointToPointTrackDefinition(seed: number): TrackDefinition {
  const rand = mulberry32(Math.floor(seed) || 1);
  
  // Track layout:
  // 0-50m: Starting city
  // 50m: START LINE (exit of starting city)
  // 50m to end-50m: The race route
  // end-50m: FINISH LINE (entrance to ending city)
  // end-50m to end: Ending city
  
  const cityLength = 50; // Length of road through each city
  const minDistance = 1000; // LONGER: 1000-1600m for more space
  const maxDistance = 1600;
  const distance = minDistance + rand() * (maxDistance - minDistance);
  const angle = rand() * Math.PI * 2;
  
  // CORNER-BASED APPROACH: Plan out corners first, then generate between them
  // FEWER corners = more space = less overlap
  const numCorners = 5 + Math.floor(rand() * 3); // 5-7 corners (reduced from 6-9)
  const corners: Corner[] = [];
  
  for (let i = 0; i < numCorners; i++) {
    const r = rand();
    const direction = rand() > 0.5 ? 1 : -1;
    
    let cornerType: CornerType;
    // Reduce hairpins to avoid self-intersections
    if (r < 0.20) {
      cornerType = "hairpin";   // 20% - Some hairpins for excitement
    } else if (r < 0.45) {
      cornerType = "sharp";     // 25%
    } else if (r < 0.70) {
      cornerType = "medium";    // 25%
    } else if (r < 0.85) {
      cornerType = "gentle";    // 15%
    } else {
      cornerType = "chicane";   // 15%
    }
    
    corners.push(createCorner(cornerType, direction as 1 | -1));
  }
  
  // Calculate total control points needed
  const totalControlPointsForCorners = corners.reduce((sum, c) => sum + c.controlPointsNeeded, 0);
  const controlPointsForStraights = Math.max(5, Math.floor(totalControlPointsForCorners * 0.3)); // 30% for straights
  const totalControlPoints = totalControlPointsForCorners + controlPointsForStraights;
  
  const segmentLength = distance / totalControlPoints;
  
  // Generate control points
  const controlPoints: Vec2[] = [];
  let currentX = 0;
  let currentY = 0;
  let currentAngle = angle;
  
  // Track corner positions (control point indices)
  const cornerPositions: Array<{ cornerIndex: number; startControlPoint: number; endControlPoint: number }> = [];
  
  // Generate track with planned corners
  let cornerIndex = 0;
  let controlPointsUntilNextCorner = Math.floor(controlPointsForStraights / (corners.length + 1));
  let currentCornerStart = -1;
  
  for (let i = 0; i < totalControlPoints; i++) {
    controlPoints.push({ x: currentX, y: currentY });
    
    // Determine if we're in a corner or on a straight
    let angleChange = 0;
    
    if (controlPointsUntilNextCorner <= 0 && cornerIndex < corners.length) {
      // We're inside a corner
      const corner = corners[cornerIndex];
      const cornerProgress = Math.abs(controlPointsUntilNextCorner); // How many points into this corner
      
      // Mark corner start
      if (currentCornerStart === -1) {
        currentCornerStart = i;
      }
      
      if (corner.type === "chicane") {
        // Chicane: quick alternating turns
        const chicaneHalf = corner.controlPointsNeeded / 2;
        if (cornerProgress < chicaneHalf) {
          angleChange = (Math.PI * 0.3 * corner.direction) / chicaneHalf; // Turn one way
        } else {
          angleChange = -(Math.PI * 0.3 * corner.direction) / chicaneHalf; // Turn back
        }
      } else {
        // Regular corner: distribute angle change evenly across control points
        angleChange = corner.angleChange / corner.controlPointsNeeded;
      }
      
      controlPointsUntilNextCorner--;
      
      // Check if corner is complete
      if (Math.abs(controlPointsUntilNextCorner) >= corner.controlPointsNeeded) {
        // Record corner position
        cornerPositions.push({
          cornerIndex,
          startControlPoint: currentCornerStart,
          endControlPoint: i
        });
        currentCornerStart = -1;
        
        cornerIndex++;
        if (cornerIndex < corners.length) {
          // Calculate straight section length until next corner
          controlPointsUntilNextCorner = Math.floor(controlPointsForStraights / (corners.length - cornerIndex + 1));
        }
      }
    } else {
      // Straight section - add gentle meandering
      angleChange = (rand() - 0.5) * 0.2; // ±5 degrees gentle wander
      controlPointsUntilNextCorner--;
    }
    
    // AGGRESSIVE COLLISION AVOIDANCE: Turn AWAY from old track sections
    // This prevents both loops AND straight sections
    if (controlPoints.length > 8) {
      const testX = currentX + Math.cos(currentAngle + angleChange) * segmentLength;
      const testY = currentY + Math.sin(currentAngle + angleChange) * segmentLength;
      
      const checkRadiusM = 180; // Check within 180m radius (wider search)
      const minSeparationM = 70; // Minimum 70m between segments (more separation)
      
      let closestOldPoint: Vec2 | null = null;
      let closestDist = Infinity;
      
      // Find the closest old point
      for (let checkIdx = 0; checkIdx < controlPoints.length - 8; checkIdx++) {
        const oldPoint = controlPoints[checkIdx];
        const roughDist = Math.hypot(currentX - oldPoint.x, currentY - oldPoint.y);
        if (roughDist > checkRadiusM) continue;
        
        const distToOld = Math.hypot(testX - oldPoint.x, testY - oldPoint.y);
        if (distToOld < closestDist) {
          closestDist = distToOld;
          closestOldPoint = oldPoint;
        }
      }
      
      if (closestOldPoint && closestDist < minSeparationM) {
        // We're too close! Calculate angle AWAY from the closest old point
        const angleToOldPoint = Math.atan2(closestOldPoint.y - currentY, closestOldPoint.x - currentX);
        const angleAwayFromOldPoint = angleToOldPoint + Math.PI; // Opposite direction
        
        // Adjust our current angle to point away
        let targetAngle = angleAwayFromOldPoint;
        
        // Normalize angle difference
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        // Turn AWAY AGGRESSIVELY - override the planned corner!
        // The closer we are, the more we turn away
        const urgency = Math.max(0, 1 - (closestDist / minSeparationM)); // 0-1, higher = more urgent
        angleChange = angleDiff * (0.5 + urgency * 0.5); // 50-100% turn away based on urgency
      }
    }
    
    // Apply angle change and move to next position
    currentAngle += angleChange;
    currentX += Math.cos(currentAngle) * segmentLength;
    currentY += Math.sin(currentAngle) * segmentLength;
  }
  
  // Remove any control points that are too close together (can happen with aggressive angle dampening)
  const filteredControlPoints: Vec2[] = [controlPoints[0]];
  for (let i = 1; i < controlPoints.length; i++) {
    const prev = filteredControlPoints[filteredControlPoints.length - 1];
    const curr = controlPoints[i];
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (dist > 5) { // Minimum 5m between control points
      filteredControlPoints.push(curr);
    }
  }
  
  // Sample the main route - fewer samples to preserve angles better
  const routePoints = sampleOpenCatmullRom(filteredControlPoints, 3);
  
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
  
    const baseWidthM = 7.5;
    
    // Width variance
    const segmentWidthsM: number[] = [];
    for (let i = 0; i < allPoints.length; i++) {
      const t = i / allPoints.length;
      let widthMult = 1 + 0.2 * Math.sin(t * Math.PI * 4) + (rand() - 0.5) * 0.1;
      widthMult = clamp(widthMult, 0.7, 1.3);
      segmentWidthsM.push(baseWidthM * widthMult);
    }
    
    // Create track structure for collision checking (cities need to check against full track)
    const trackForCollisionCheck = { points: allPoints, widthM: baseWidthM };
    
    // Build a temporary track to calculate corner positions in meters
    const tempTrack = buildTrackFromPoints(allPoints, baseWidthM, segmentWidthsM);
    
    // Convert corner positions from control point indices to track meters
    const cornerInfos: TrackCornerInfo[] = cornerPositions.map(cp => {
      const corner = corners[cp.cornerIndex];
      
      // Find track position for start and end control points
      const samplingRate = 2; // From sampleOpenCatmullRom steps parameter
      const startSegmentIdx = Math.min(cp.startControlPoint * samplingRate, tempTrack.cumulativeLengthsM.length - 1);
      const endSegmentIdx = Math.min(cp.endControlPoint * samplingRate, tempTrack.cumulativeLengthsM.length - 1);
      
      const startSM = tempTrack.cumulativeLengthsM[startSegmentIdx] || 0;
      const endSM = tempTrack.cumulativeLengthsM[endSegmentIdx] || tempTrack.totalLengthM;
      
      return {
        type: corner.type,
        direction: corner.direction > 0 ? "R" as const : "L" as const,
        startSM,
        endSM,
        angleChange: Math.abs(corner.angleChange)
      };
    });
  
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
    
    // Assign random render style based on seed
    const renderStyle = getRandomRenderStyle(seed);
    
    return {
      points: allPoints,
      baseWidthM,
      segmentWidthsM,
      startCity,
      endCity,
      corners: cornerInfos,
      renderStyle,
      meta: { name: `Route ${seed}`, seed, source: "point-to-point" }
    };
  }
  
  const startRoadAngle = Math.atan2(startDirNorm.y, startDirNorm.x);
  const endRoadAngle = Math.atan2(endDirNorm.y, endDirNorm.x);
  
  const baseWidthM = 7.5;
  
  // Width variance
  const segmentWidthsM: number[] = [];
  for (let i = 0; i < allPoints.length; i++) {
    const t = i / allPoints.length;
    let widthMult = 1 + 0.2 * Math.sin(t * Math.PI * 4) + (rand() - 0.5) * 0.1;
    widthMult = clamp(widthMult, 0.7, 1.3);
    segmentWidthsM.push(baseWidthM * widthMult);
  }
  
  // Build a temporary track to calculate corner positions in meters
  const tempTrack = buildTrackFromPoints(allPoints, baseWidthM, segmentWidthsM);
  
  // Convert corner positions from control point indices to track meters
  const cornerInfos: TrackCornerInfo[] = cornerPositions.map(cp => {
    const corner = corners[cp.cornerIndex];
    
    // Find track position for start and end control points
    // Control points were sampled at 'steps' intervals, so we need to map back
    const samplingRate = 2; // From sampleOpenCatmullRom steps parameter
    const startSegmentIdx = Math.min(cp.startControlPoint * samplingRate, tempTrack.cumulativeLengthsM.length - 1);
    const endSegmentIdx = Math.min(cp.endControlPoint * samplingRate, tempTrack.cumulativeLengthsM.length - 1);
    
    const startSM = tempTrack.cumulativeLengthsM[startSegmentIdx] || 0;
    const endSM = tempTrack.cumulativeLengthsM[endSegmentIdx] || tempTrack.totalLengthM;
    
    return {
      type: corner.type,
      direction: corner.direction > 0 ? "R" as const : "L" as const,
      startSM,
      endSM,
      angleChange: Math.abs(corner.angleChange)
    };
  });
  
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
  
  // Assign random render style based on seed
  const renderStyle = getRandomRenderStyle(seed);
  
  return {
    points: allPoints,
    baseWidthM,
    segmentWidthsM,
    startCity,
    endCity,
    corners: cornerInfos,
    renderStyle,
    meta: { name: `Route ${seed}`, seed, source: "point-to-point" }
  };
}

// Sample Catmull-Rom spline for OPEN paths (not closed loops)
function sampleOpenCatmullRom(control: Vec2[], steps: number): Vec2[] {
  if (control.length < 2) return control;
  
  const out: Vec2[] = [];
  
  for (let i = 0; i < control.length - 1; i++) {
    // For open paths, we need to handle endpoints differently
    const p0 = i === 0 ? control[0] : control[i - 1];
    const p1 = control[i];
    const p2 = control[i + 1];
    const p3 = i === control.length - 2 ? control[i + 1] : control[i + 2];
    
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  
  // Add final point
  out.push(control[control.length - 1]);
  
  return out;
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
