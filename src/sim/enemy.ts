import { mulberry32 } from "./rng";
import type { QuietZone } from "./stage";
import { isQuietAtTrackDistance, quietZoneContainsTrackDistance } from "./stage";
import type { Track } from "./track";
import { pointOnTrack } from "./track";

// Temporary gameplay tuning: disable the balrog/colossus spawn.
const ENABLE_COLOSSUS = false;

export enum EnemyType {
  ZOMBIE = "zombie",
  TANK = "tank",
  COLOSSUS = "colossus"
}

export type Enemy = {
  id: number;
  type: EnemyType;
  x: number; // World position X (meters)
  y: number; // World position Y (meters)
  vx: number; // Velocity X (m/s)
  vy: number; // Velocity Y (m/s)
  health: number; // 1 to 5 depending on type
  maxHealth: number;
  radius: number; // Collision radius (meters)
  wanderAngle: number; // Current wander direction
  wanderRngState: number; // Deterministic PRNG state for wandering
  timeAlive: number; // Age in seconds
  trackSegmentHint: number; // Approximate track position for efficient queries
};

let nextEnemyId = 1;

function nextRand01(state: number): { state: number; r: number } {
  // xorshift32: tiny deterministic RNG with a 32-bit internal state.
  let x = (state >>> 0) || 0x12345678;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const s = x >>> 0;
  return { state: s, r: s / 4294967296 };
}

function wrapAngleRad(a: number): number {
  // Wrap to [-pi, pi)
  const twoPi = Math.PI * 2;
  a = ((a % twoPi) + twoPi) % twoPi;
  if (a >= Math.PI) a -= twoPi;
  return a;
}

function lerpAngleRad(from: number, to: number, t: number): number {
  const d = wrapAngleRad(to - from);
  return wrapAngleRad(from + d * t);
}

/**
 * Create a new enemy
 */
export function createEnemy(
  x: number,
  y: number,
  trackSegmentHint: number,
  type: EnemyType = EnemyType.ZOMBIE,
  opts?: { wanderAngle?: number; wanderRngState?: number; id?: number }
): Enemy {
  const isTank = type === EnemyType.TANK;
  const isColossus = type === EnemyType.COLOSSUS;
  const health = isColossus ? 42 : isTank ? 5 : 1;
  const radius = isColossus ? 4.5 : isTank ? 0.9 : 0.6;

  const id = typeof opts?.id === "number" ? Math.floor(opts.id) : nextEnemyId++;
  if (id >= nextEnemyId) nextEnemyId = id + 1;

  let wanderRngState = typeof opts?.wanderRngState === "number" ? (opts.wanderRngState >>> 0) : 0;
  if (!wanderRngState) {
    // Deterministic fallback: based on position + id. (Avoid Math.random() entirely.)
    const xi = Math.floor(x * 1000);
    const yi = Math.floor(y * 1000);
    wanderRngState = ((id * 2654435761) ^ (xi * 374761393) ^ (yi * 668265263)) >>> 0;
  }

  let wanderAngle = typeof opts?.wanderAngle === "number" ? opts.wanderAngle : NaN;
  if (!Number.isFinite(wanderAngle)) {
    const n = nextRand01(wanderRngState);
    wanderRngState = n.state;
    wanderAngle = n.r * Math.PI * 2;
  }

  return {
    id,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    health,
    maxHealth: health,
    radius,
    wanderAngle,
    wanderRngState,
    timeAlive: 0,
    trackSegmentHint
  };
}

/**
 * Update enemy AI and physics
 * Zombies wander randomly but prefer to stay on/near the road
 */
export function stepEnemy(enemy: Enemy, dtSeconds: number, track: Track): Enemy {
  if (enemy.health <= 0) return enemy;

  if (enemy.type === EnemyType.COLOSSUS) {
    // The colossus is a road-blocking mini-boss. It crawls along the road toward the start.
    const prevX = enemy.x;
    const prevY = enemy.y;

    const speed = 1.3; // m/s (slower, more avoidable)
    const L = track.totalLengthM;
    let s = enemy.trackSegmentHint - speed * dtSeconds;
    while (s < 0) s += L;
    while (s >= L) s -= L;

    const { p, headingRad } = pointOnTrack(track, s);
    const normal = { x: -Math.sin(headingRad), y: Math.cos(headingRad) };

    // Small deterministic sway for a "living" feel.
    const sway = Math.sin(enemy.timeAlive * 0.7) * (track.widthM * 0.06);
    const x = p.x + normal.x * sway;
    const y = p.y + normal.y * sway;

    const vx = (x - prevX) / Math.max(1e-6, dtSeconds);
    const vy = (y - prevY) / Math.max(1e-6, dtSeconds);

    // Facing: towards movement direction (towards start = reverse track heading).
    const face = headingRad + Math.PI;

    return {
      ...enemy,
      x,
      y,
      vx,
      vy,
      wanderAngle: face,
      timeAlive: enemy.timeAlive + dtSeconds,
      trackSegmentHint: s
    };
  }

  // Faster zombies, slower tanks
  const speed = enemy.type === EnemyType.ZOMBIE ? 2.8 : 0.8;

  // Find nearest point on track to bias movement toward road.
  // IMPORTANT: the track is effectively a loop (pointOnTrack wraps), so this search must also wrap
  // or enemies can "lose" the road near the seam and wander forever.
  const L = track.totalLengthM;
  const hint = ((enemy.trackSegmentHint % L) + L) % L;
  const searchWindowM = 60;
  const stepM = 5;
  let closestDist = Infinity;
  let closestS = hint;

  for (let off = -searchWindowM; off <= searchWindowM; off += stepM) {
    const s = ((hint + off) % L + L) % L;
    const { p } = pointOnTrack(track, s);
    const dist = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    if (dist < closestDist) {
      closestDist = dist;
      closestS = s;
    }
  }

  const { p: trackPoint, headingRad: trackHeadingRad } = pointOnTrack(track, closestS);

  // Calculate direction to road
  const toRoadX = trackPoint.x - enemy.x;
  const toRoadY = trackPoint.y - enemy.y;
  const distToRoad = Math.hypot(toRoadX, toRoadY);

  // When on the road, steer mostly along the road (tangent), not straight toward the centerline.
  // When near/off the edge, bias back toward the road center.
  const roadHalfWidth = track.widthM * 0.5;
  const toCenterAngle = Math.atan2(toRoadY, toRoadX);

  const tangentF = wrapAngleRad(trackHeadingRad);
  const tangentB = wrapAngleRad(trackHeadingRad + Math.PI);
  const dF = Math.abs(wrapAngleRad(tangentF - enemy.wanderAngle));
  const dB = Math.abs(wrapAngleRad(tangentB - enemy.wanderAngle));
  const tangentAngle = dF <= dB ? tangentF : tangentB;

  // 0 when comfortably on-road, 1 when off-road.
  const edgeStart = roadHalfWidth * 0.75;
  const return01 = Math.max(0, Math.min(1, (distToRoad - edgeStart) / 4.5));

  // Random wander (deterministic). Strongest near the road center.
  const n = nextRand01(enemy.wanderRngState);
  const wanderStrength = 0.85 * (1 - 0.88 * return01);
  const wanderChange = (n.r - 0.5) * wanderStrength;
  let wanderAngle = wrapAngleRad(enemy.wanderAngle + wanderChange);
  // Keep wander roughly aligned with the road direction.
  wanderAngle = lerpAngleRad(wanderAngle, tangentAngle, 0.38);

  const returnBias = 0.94 * return01;
  const targetAngle = lerpAngleRad(wanderAngle, toCenterAngle, returnBias);

  const vx = Math.cos(targetAngle) * speed;
  const vy = Math.sin(targetAngle) * speed;

  return {
    ...enemy,
    x: enemy.x + vx * dtSeconds,
    y: enemy.y + vy * dtSeconds,
    vx,
    vy,
    wanderAngle: targetAngle,
    wanderRngState: n.state,
    timeAlive: enemy.timeAlive + dtSeconds,
    trackSegmentHint: closestS
  };
}

/**
 * Generate enemies along the track
 */
export function generateEnemies(track: Track, opts?: { seed?: number; count?: number; quietZones?: QuietZone[] }): Enemy[] {
  const seed = opts?.seed ?? 6666;
  const rand = mulberry32(seed);

  const quietZones: QuietZone[] = opts?.quietZones ?? [];

  const enemies: Enemy[] = [];
  const roadHalfWidthM = track.widthM * 0.5;

  // Place enemies at uneven intervals along the track.
  // NOTE: This is deterministic via the seeded RNG (mulberry32).
  const minSpacing = 14; // allow clusters
  const maxSpacing = 52; // allow gaps
  // Previous baseline (cap): ~1 per 25m.
  const maxCount = Math.floor(track.totalLengthM / 25);
  // Reduce overall density and vary per-stage deterministically, never exceeding the old baseline.
  const densityScale = 0.45 + 0.40 * rand(); // 0.45..0.85
  const desiredCountRaw = opts?.count ?? Math.floor(maxCount * densityScale);
  const desiredCount = Math.max(0, Math.min(maxCount, desiredCountRaw));

  const sampleSpacing = (): number => {
    // Biased distribution: more small spacings than large ones, plus occasional big gaps.
    const r = rand();
    const biased = r * r; // 0..1, biased toward 0
    let spacing = minSpacing + biased * (maxSpacing - minSpacing);
    if (rand() < 0.16) spacing += 35 + rand() * 65; // occasional larger gap
    return spacing;
  };

  let nextEnemyAt = sampleSpacing();

  for (let i = 0; i < desiredCount && nextEnemyAt < track.totalLengthM - 100; i++) {
    // Quiet stretches: avoid enemies so the player can focus on driving.
    if (quietZones.length > 0 && isQuietAtTrackDistance(track.totalLengthM, nextEnemyAt, quietZones)) {
      const z = quietZones.find((q) => quietZoneContainsTrackDistance(track.totalLengthM, nextEnemyAt, q));
      if (z) {
        nextEnemyAt = Math.max(nextEnemyAt + minSpacing, z.end01 * track.totalLengthM + minSpacing);
        continue;
      }
    }

    const { p, headingRad } = pointOnTrack(track, nextEnemyAt);

    // Skip if too close to start or end
    if (nextEnemyAt < 80 || nextEnemyAt > track.totalLengthM - 80) {
      nextEnemyAt += sampleSpacing();
      continue;
    }

    // Calculate normal from heading (perpendicular to track direction)
    const normal = {
      x: -Math.sin(headingRad),
      y: Math.cos(headingRad)
    };

    // Place enemy on or near the road (makes them a threat)
    const side = rand() < 0.5 ? -1 : 1;
    const offset = (rand() * roadHalfWidthM) + (rand() * 4); // On road or just off it

    const x = p.x + normal.x * side * offset;
    const y = p.y + normal.y * side * offset;

    // Check it's not on top of other enemies
    let tooClose = false;
    for (const existing of enemies) {
      const dist = Math.hypot(x - existing.x, y - existing.y);
      if (dist < 10) { // Keep 10m apart
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      const enemyType = rand() < 0.2 ? EnemyType.TANK : EnemyType.ZOMBIE;
      const wanderRngState = Math.floor(rand() * 0xffffffff) >>> 0;
      const idBase = (seed >>> 0) * 1000;
      const id = idBase + enemies.length;
      enemies.push(createEnemy(x, y, nextEnemyAt, enemyType, { id, wanderRngState, wanderAngle: rand() * Math.PI * 2 }));
    }

    // Schedule next enemy
    nextEnemyAt += sampleSpacing();
  }

  // Add a single road-blocking colossus (mini-boss) per stage.
  // Deterministic position/shape via the seeded RNG.
  if (ENABLE_COLOSSUS) {
    const idBase = (seed >>> 0) * 1000;
    const bossId = idBase + 999;
    const sMin = 220;
    const sMax = Math.max(sMin + 1, track.totalLengthM - 260);
    let sBoss = sMin + rand() * (sMax - sMin);
    // Prefer later in the stage.
    sBoss = Math.min(sMax, Math.max(sMin, sBoss * 0.85 + (track.totalLengthM * 0.55) * 0.15));

    const { p } = pointOnTrack(track, sBoss);
    const boss = createEnemy(p.x, p.y, sBoss, EnemyType.COLOSSUS, { id: bossId, wanderRngState: Math.floor(rand() * 0xffffffff) >>> 0 });
    // Make it fill the road width.
    boss.radius = track.widthM * 0.55;
    boss.maxHealth = 42;
    boss.health = 42;
    enemies.push(boss);
  }

  return enemies;
}

/**
 * Pool of active enemies
 */
export class EnemyPool {
  private enemies: Enemy[] = [];

  spawn(x: number, y: number, trackSegmentHint: number = 0, type: EnemyType = EnemyType.ZOMBIE): void {
    this.enemies.push(createEnemy(x, y, trackSegmentHint, type));
  }

  setEnemies(enemies: Enemy[]): void {
    this.enemies = enemies;
  }

  update(dtSeconds: number, track: Track): void {
    this.enemies = this.enemies.map(e => stepEnemy(e, dtSeconds, track));
  }

  getActive(): Enemy[] {
    return this.enemies.filter(e => e.health > 0);
  }

  getAll(): Enemy[] {
    return this.enemies;
  }

  damage(id: number, amount: number): Enemy | null {
    const enemy = this.enemies.find(e => e.id === id);
    if (!enemy) return null;

    enemy.health = Math.max(0, enemy.health - amount);
    return enemy;
  }

  remove(id: number): void {
    this.enemies = this.enemies.filter(e => e.id !== id);
  }

  clear(): void {
    this.enemies = [];
  }

  getCount(): number {
    return this.getActive().length;
  }
}
