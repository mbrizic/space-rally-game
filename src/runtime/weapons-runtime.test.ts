import { describe, expect, it } from "vitest";
import {
  computeBulletTimeWeaponAdvantage,
  computeEffectiveFireIntervalSeconds,
  computeEffectiveProjectileSpeed
} from "./weapons-runtime";

describe("weapons runtime (bullet time)", () => {
  it("is identity when bullet time inactive", () => {
    const bulletScale = 0.4;
    const adv = computeBulletTimeWeaponAdvantage(false, bulletScale, 0.32);
    expect(adv).toBe(1.0);

    const interval = computeEffectiveFireIntervalSeconds(0.1, false, bulletScale, adv);
    expect(interval).toBe(0.1);

    const speed = computeEffectiveProjectileSpeed(60, false, bulletScale, adv);
    expect(speed).toBe(60);
  });

  it("matches current game formulas during bullet time", () => {
    const bulletScale = 0.4;
    const adv = computeBulletTimeWeaponAdvantage(true, bulletScale, 0.32);
    expect(adv).toBe(0.32);

    const interval = computeEffectiveFireIntervalSeconds(0.1, true, bulletScale, adv);
    expect(interval).toBeCloseTo(0.1 * 0.4 / 0.32, 10);

    const speed = computeEffectiveProjectileSpeed(60, true, bulletScale, adv);
    expect(speed).toBeCloseTo(60 * 0.32 / 0.4, 10);
  });

  it("never makes fire rate or projectile speed exceed normal time", () => {
    const baseInterval = 0.12;
    const baseSpeed = 50;
    const maxAdv = 0.32;
    const scales = [0.05, 0.1, 0.25, 0.4, 0.8, 1.0, 1.5, 2.0];

    for (const bulletScale of scales) {
      const adv = computeBulletTimeWeaponAdvantage(true, bulletScale, maxAdv);
      const interval = computeEffectiveFireIntervalSeconds(baseInterval, true, bulletScale, adv);
      const speed = computeEffectiveProjectileSpeed(baseSpeed, true, bulletScale, adv);

      expect(interval).toBeGreaterThanOrEqual(baseInterval);
      expect(speed).toBeLessThanOrEqual(baseSpeed);
    }
  });
});
