import { mulberry32 } from "./rng";
import { generateCity, type City } from "./city";

export type Vec2 = { x: number; y: number };

export type TrackDefinition = {
  points: Vec2[]; // Point-to-point: last point is the end
  baseWidthM: number;
  segmentWidthsM?: number[]; // optional per-segment widths (same length as points)
  startCity?: City;
  endCity?: City;
  meta?: { name?: string; seed?: number; source?: "default" | "procedural" | "editor" | "point-to-point" };
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

export function createPointToPointTrackDefinition(seed: number): TrackDefinition {
  const rand = mulberry32(Math.floor(seed) || 1);
  
  // Track layout:
  // 0-50m: Starting city
  // 50m: START LINE (exit of starting city)
  // 50m to end-50m: The race route
  // end-50m: FINISH LINE (entrance to ending city)
  // end-50m to end: Ending city
  
  const cityLength = 50; // Length of road through each city
  const distance = 300 + rand() * 200; // Distance for the main route
  const angle = rand() * Math.PI * 2;
  
  // Create control points for the MAIN ROUTE (between cities)
  // This will be from position cityLength to position cityLength+distance
  const numControlPoints = 12 + Math.floor(rand() * 6);
  const controlPoints: Vec2[] = [];
  
  for (let i = 0; i < numControlPoints; i++) {
    const t = i / (numControlPoints - 1);
    // Base interpolation along the angle
    const distAlong = t * distance;
    const baseX = Math.cos(angle) * distAlong;
    const baseY = Math.sin(angle) * distAlong;
    
    // Add perpendicular noise for winding (more in the middle)
    const perpAngle = angle + Math.PI / 2;
    const noiseAmount = (Math.sin(t * Math.PI) * 0.5 + 0.5) * 80;
    const noise = (rand() - 0.5) * noiseAmount;
    
    controlPoints.push({
      x: baseX + Math.cos(perpAngle) * noise,
      y: baseY + Math.sin(perpAngle) * noise
    });
  }
  
  // Sample the main route
  const routePoints = sampleOpenCatmullRom(controlPoints, 10);
  
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
  
  const startRoadAngle = Math.atan2(startDirNorm.y, startDirNorm.x);
  const endRoadAngle = Math.atan2(endDirNorm.y, endDirNorm.x);
  
  // Generate cities with road angle information
  const startCity = generateCity(startCityX, startCityY, seed, { 
    numStores: 4, 
    numDecorations: 6,
    roadAngle: startRoadAngle 
  });
  const endCity = generateCity(endCityX, endCityY, seed + 1000, { 
    numStores: 4, 
    numDecorations: 6,
    roadAngle: endRoadAngle 
  });
  
  const baseWidthM = 7.5;
  
  // Width variance
  const segmentWidthsM: number[] = [];
  for (let i = 0; i < allPoints.length; i++) {
    const t = i / allPoints.length;
    let widthMult = 1 + 0.2 * Math.sin(t * Math.PI * 4) + (rand() - 0.5) * 0.1;
    widthMult = clamp(widthMult, 0.7, 1.3);
    segmentWidthsM.push(baseWidthM * widthMult);
  }
  
  return {
    points: allPoints,
    baseWidthM,
    segmentWidthsM,
    startCity,
    endCity,
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
