/**
 * Projectile/bullet system for shooting mechanics
 */

export type Projectile = {
  id: number;
  x: number; // World position X (meters)
  y: number; // World position Y (meters)
  vx: number; // Velocity X (m/s)
  vy: number; // Velocity Y (m/s)
  age: number; // Time since creation (seconds)
  maxAge: number; // Time before despawn (seconds)
};

let nextProjectileId = 1;

/**
 * Create a new projectile
 */
export function createProjectile(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  speed: number = 200 // Game-friendly speed: 200 m/s (more visible, still fast)
): Projectile {
  // Calculate direction vector
  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.hypot(dx, dy);
  
  // Normalize and apply speed
  const vx = (dx / distance) * speed;
  const vy = (dy / distance) * speed;
  
  return {
    id: nextProjectileId++,
    x,
    y,
    vx,
    vy,
    age: 0,
    maxAge: 5.0 // Despawn after 5 seconds (1km travel at 200m/s)
  };
}

/**
 * Update projectile physics
 */
export function stepProjectile(projectile: Projectile, dtSeconds: number): Projectile {
  return {
    ...projectile,
    x: projectile.x + projectile.vx * dtSeconds,
    y: projectile.y + projectile.vy * dtSeconds,
    age: projectile.age + dtSeconds
  };
}

/**
 * Check if projectile should be removed
 */
export function shouldRemoveProjectile(projectile: Projectile): boolean {
  return projectile.age >= projectile.maxAge;
}

/**
 * Pool of active projectiles
 */
export class ProjectilePool {
  private projectiles: Projectile[] = [];
  
  spawn(x: number, y: number, targetX: number, targetY: number, speed?: number): void {
    this.projectiles.push(createProjectile(x, y, targetX, targetY, speed));
  }
  
  update(dtSeconds: number): void {
    // Update all projectiles
    this.projectiles = this.projectiles.map(p => stepProjectile(p, dtSeconds));
    
    // Remove expired projectiles
    this.projectiles = this.projectiles.filter(p => !shouldRemoveProjectile(p));
  }
  
  getActive(): Projectile[] {
    return this.projectiles;
  }
  
  clear(): void {
    this.projectiles = [];
  }
  
  getCount(): number {
    return this.projectiles.length;
  }
  
  remove(id: number): void {
    this.projectiles = this.projectiles.filter(p => p.id !== id);
  }
}
