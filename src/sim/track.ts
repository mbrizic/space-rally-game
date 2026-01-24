export type Vec2 = { x: number; y: number };

export type Track = {
  points: Vec2[]; // loop; last point implicitly connects to first
  widthM: number; // default/base width
  segmentWidthsM?: number[]; // optional per-segment widths (same length as points)
  segmentLengthsM: number[];
  cumulativeLengthsM: number[]; // same length as points; cumulative at each point
  totalLengthM: number;
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

export function createDefaultTrack(): Track {
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
  const baseWidthM = 10;

  // Denser sampling makes the track smoother while keeping projection/collision simple.
  const points = sampleClosedCatmullRom(controlPoints, 10);

  // Create width variance: narr ow chicanes at specific sections, wider straights
  const segmentWidths: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const s = i / points.length; // normalized position [0..1]

    // Define narrow sections (chicanes) and wide sections
    let widthMultiplier = 1.0;

    // Narrow sections at ~20-25%, ~45-50%, ~70-75%
    if ((s > 0.20 && s < 0.25) || (s > 0.45 && s < 0.50) || (s > 0.70 && s < 0.75)) {
      widthMultiplier = 0.65; // 35% narrower
    }
    // Wide sections at ~10-15%, ~35-40%, ~85-90%
    else if ((s > 0.10 && s < 0.15) || (s > 0.35 && s < 0.40) || (s > 0.85 && s < 0.90)) {
      widthMultiplier = 1.4; // 40% wider
    }

    segmentWidths.push(baseWidthM * widthMultiplier);
  }

  return buildTrack(points, baseWidthM, segmentWidths);
}

function buildTrack(points: Vec2[], widthM: number, segmentWidthsM?: number[]): Track {
  const segmentLengthsM: number[] = [];
  const cumulativeLengthsM: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    cumulativeLengthsM.push(total);
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    segmentLengthsM.push(len);
    total += len;
  }

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

export function projectToTrack(track: Track, p: Vec2): TrackProjection {
  let bestDist2 = Number.POSITIVE_INFINITY;
  let best: TrackProjection | null = null;

  for (let i = 0; i < track.points.length; i++) {
    const a = track.points[i];
    const b = track.points[(i + 1) % track.points.length];

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
    const sM = wrapS(track.cumulativeLengthsM[i] + segLen * t, track.totalLengthM);

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
  const headingRad = Math.atan2(b.y - a.y, b.x - a.x);

  return { p: { x, y }, headingRad };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wrapS(sM: number, totalLengthM: number): number {
  const t = sM % totalLengthM;
  return t < 0 ? t + totalLengthM : t;
}
