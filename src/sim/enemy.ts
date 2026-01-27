import { mulberry32 } from "./rng";
import type { Track } from "./track";
import { pointOnTrack } from "./track";

export enum EnemyType {
  ZOMBIE = "zombie",
  TANK = "tank"
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
  timeAlive: number; // Age in seconds
  trackSegmentHint: number; // Approximate track position for efficient queries
};

let nextEnemyId = 1;

/**
 * Create a new enemy
 */
export function createEnemy(
  x: number,
  y: number,
  trackSegmentHint: number,
  type: EnemyType = EnemyType.ZOMBIE,
  opts?: { wanderAngle?: number }
): Enemy {
  const isTank = type === EnemyType.TANK;
  const health = isTank ? 5 : 1;
  const radius = isTank ? 0.9 : 0.6;

  return {
    id: nextEnemyId++,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    health,
    maxHealth: health,
    radius,
    wanderAngle: typeof opts?.wanderAngle === "number" ? opts.wanderAngle : Math.random() * Math.PI * 2,
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

  // Faster zombies, slower tanks
  const speed = enemy.type === EnemyType.ZOMBIE ? 2.8 : 0.8;

  // Find nearest point on track to bias movement toward road
  const searchStart = Math.max(0, enemy.trackSegmentHint - 20);
  const searchEnd = Math.min(track.totalLengthM, enemy.trackSegmentHint + 20);
  let closestDist = Infinity;
  let closestS = enemy.trackSegmentHint;

  // Simple search for nearest track point (could be optimized)
  for (let s = searchStart; s < searchEnd; s += 5) {
    const { p } = pointOnTrack(track, s);
    const dist = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    if (dist < closestDist) {
      closestDist = dist;
      closestS = s;
    }
  }

  const { p: trackPoint } = pointOnTrack(track, closestS);

  // Calculate direction to road
  const toRoadX = trackPoint.x - enemy.x;
  const toRoadY = trackPoint.y - enemy.y;
  const distToRoad = Math.hypot(toRoadX, toRoadY);

  // Bias toward road if we're far from it
  let roadBias = 0;
  const roadHalfWidth = track.widthM * 0.5;
  if (distToRoad > roadHalfWidth + 2) {
    // Far from road - strong bias to return
    roadBias = 0.7;
  } else if (distToRoad > roadHalfWidth * 0.5) {
    // Getting off road - medium bias
    roadBias = 0.4;
  } else {
    // On road - weak bias (more random)
    roadBias = 0.15;
  }

  const roadAngle = Math.atan2(toRoadY, toRoadX);

  // Random wander component
  const wanderChange = (Math.random() - 0.5) * 0.5;
  const wanderAngle = enemy.wanderAngle + wanderChange;

  // Blend road bias with wander
  const targetAngle = roadAngle * roadBias + wanderAngle * (1 - roadBias);

  const vx = Math.cos(targetAngle) * speed;
  const vy = Math.sin(targetAngle) * speed;

  return {
    ...enemy,
    x: enemy.x + vx * dtSeconds,
    y: enemy.y + vy * dtSeconds,
    vx,
    vy,
    wanderAngle: targetAngle,
    timeAlive: enemy.timeAlive + dtSeconds,
    trackSegmentHint: closestS
  };
}

/**
 * Generate enemies along the track
 */
export function generateEnemies(track: Track, opts?: { seed?: number; count?: number }): Enemy[] {
  const seed = opts?.seed ?? 6666;
  const rand = mulberry32(seed);

  const enemies: Enemy[] = [];
  const roadHalfWidthM = track.widthM * 0.5;

  // Place enemies at uneven intervals along the track.
  // NOTE: This is deterministic via the seeded RNG (mulberry32).
  // TODO: Ensure enemy generation remains deterministic and seed-driven across multiplayer clients.
  const minSpacing = 14; // allow clusters
  const maxSpacing = 52; // allow gaps
  const desiredCount = opts?.count ?? Math.floor(track.totalLengthM / 25); // ~1 per 25m (4x more than original)

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
      enemies.push(createEnemy(x, y, nextEnemyAt, enemyType, { wanderAngle: rand() * Math.PI * 2 }));
    }

    // Schedule next enemy
    nextEnemyAt += sampleSpacing();
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
