import { describe, it, expect } from "vitest";
import { createProjectile, stepProjectile, shouldRemoveProjectile, ProjectilePool } from "./projectile";

describe("projectiles", () => {
  it("creates a projectile with velocity pointing at the target", () => {
    const p = createProjectile(0, 0, 3, 4, 100);
    // direction (3,4) normalized -> (0.6,0.8)
    expect(p.vx).toBeCloseTo(60, 6);
    expect(p.vy).toBeCloseTo(80, 6);
    expect(p.age).toBe(0);
    expect(p.maxAge).toBeGreaterThan(0);
  });

  it("does not produce NaNs when target equals origin", () => {
    const p = createProjectile(10, 20, 10, 20, 123);
    expect(Number.isFinite(p.vx)).toBe(true);
    expect(Number.isFinite(p.vy)).toBe(true);
  });

  it("steps forward and expires after maxAge", () => {
    let p = createProjectile(0, 0, 1, 0, 10);
    p = stepProjectile(p, 0.5);
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.age).toBeCloseTo(0.5, 6);

    p = { ...p, age: p.maxAge };
    expect(shouldRemoveProjectile(p)).toBe(true);
  });

  it("ProjectilePool spawns, updates, and removes expired projectiles", () => {
    const pool = new ProjectilePool();
    expect(pool.getCount()).toBe(0);

    pool.spawn(0, 0, 1, 0, 10);
    expect(pool.getCount()).toBe(1);

    pool.update(0.1);
    expect(pool.getCount()).toBe(1);

    // Force expiration
    const p0 = pool.getActive()[0];
    pool.remove(p0.id);
    expect(pool.getCount()).toBe(0);
  });
});
