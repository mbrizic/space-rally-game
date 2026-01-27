import { describe, it, expect } from "vitest";
import { WeaponType, createWeaponStats, createWeaponState } from "./weapons";

describe("weapons", () => {
  it("weapon stats are sane for all weapon types", () => {
    const types = Object.values(WeaponType);
    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      const s = createWeaponStats(type);
      expect(s.type).toBe(type);
      expect(s.name.length).toBeGreaterThan(0);

      expect(s.damage).toBeGreaterThan(0);
      expect(s.fireInterval).toBeGreaterThan(0);
      expect(s.projectileSpeed).toBeGreaterThan(0);
      expect(s.projectileCount).toBeGreaterThanOrEqual(1);
      expect(s.spread).toBeGreaterThanOrEqual(0);
      expect(s.projectileSize).toBeGreaterThan(0);
      expect(s.projectileColor.length).toBeGreaterThan(0);
      expect(s.sound.length).toBeGreaterThan(0);

      // ammoCapacity: -1 means infinite, otherwise must be a positive integer-ish value
      if (s.ammoCapacity !== -1) {
        expect(s.ammoCapacity).toBeGreaterThan(0);
      }
    }
  });

  it("weapon state initializes to ammoCapacity and is ready to fire", () => {
    const state = createWeaponState(WeaponType.RIFLE);
    expect(state.stats.type).toBe(WeaponType.RIFLE);
    expect(state.ammo).toBe(state.stats.ammoCapacity);
    expect(state.lastFireTime).toBeLessThan(0);
  });
});
