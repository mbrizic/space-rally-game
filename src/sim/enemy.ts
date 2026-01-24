/**
 * Enemy/zombie system for shooting mechanics
 */

import { mulberry32 } from "./rng";
import type { Track } from "./track";
import { pointOnTrack } from "./track";

export type Enemy = {
  id: number;
  x: number; // World position X (meters)
  y: number; // World position Y (meters)
  vx: number; // Velocity X (m/s) - slow wandering
  vy: number; // Velocity Y (m/s)
  health: number; // 1 = alive, 0 = dead
  radius: number; // Collision radius (meters)
  wanderAngle: number; // Current wander direction
  timeAlive: number; // Age in seconds
};

let nextEnemyId = 1;

/**
 * Create a new enemy/zombie
 */
export function createEnemy(x: number, y: number): Enemy {
  return {
    id: nextEnemyId++,
    x,
    y,
    vx: 0,
    vy: 0,
    health: 1,
    radius: 0.6, // About human-sized
    wanderAngle: Math.random() * Math.PI * 2,
    timeAlive: 0
  };
}

/**
 * Update enemy AI and physics
 */
export function stepEnemy(enemy: Enemy, dtSeconds: number): Enemy {
  if (enemy.health <= 0) return enemy;
  
  const speed = 1.5; // Slow zombie walk: 1.5 m/s (~3.4 mph)
  
  // Slow random wander
  const wanderChange = (Math.random() - 0.5) * 0.3;
  const newWanderAngle = enemy.wanderAngle + wanderChange;
  
  const vx = Math.cos(newWanderAngle) * speed;
  const vy = Math.sin(newWanderAngle) * speed;
  
  return {
    ...enemy,
    x: enemy.x + vx * dtSeconds,
    y: enemy.y + vy * dtSeconds,
    vx,
    vy,
    wanderAngle: newWanderAngle,
    timeAlive: enemy.timeAlive + dtSeconds
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
  
  // Place enemies at intervals along the track
  const minSpacing = 80; // 80m between spawns
  const maxSpacing = 150; // 150m between spawns
  const desiredCount = opts?.count ?? Math.floor(track.totalLengthM / 100); // ~1 per 100m
  
  let nextEnemyAt = minSpacing + rand() * (maxSpacing - minSpacing);
  
  for (let i = 0; i < desiredCount && nextEnemyAt < track.totalLengthM - 100; i++) {
    const { p, headingRad } = pointOnTrack(track, nextEnemyAt);
    
    // Skip if too close to start or end
    if (nextEnemyAt < 80 || nextEnemyAt > track.totalLengthM - 80) {
      nextEnemyAt += minSpacing + rand() * (maxSpacing - minSpacing);
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
      enemies.push(createEnemy(x, y));
    }
    
    // Schedule next enemy
    nextEnemyAt += minSpacing + rand() * (maxSpacing - minSpacing);
  }
  
  return enemies;
}

/**
 * Pool of active enemies
 */
export class EnemyPool {
  private enemies: Enemy[] = [];
  
  spawn(x: number, y: number): void {
    this.enemies.push(createEnemy(x, y));
  }
  
  setEnemies(enemies: Enemy[]): void {
    this.enemies = enemies;
  }
  
  update(dtSeconds: number): void {
    this.enemies = this.enemies.map(e => stepEnemy(e, dtSeconds));
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
