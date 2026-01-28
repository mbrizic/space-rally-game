export function computeBulletTimeWeaponAdvantage(
  bulletTimeActive: boolean,
  bulletScale: number,
  bulletTimeWeaponAdvantage: number
): number {
  if (bulletTimeActive && bulletScale > 1e-6) {
    return Math.min(1.0, bulletScale, bulletTimeWeaponAdvantage);
  }
  return 1.0;
}

export function computeEffectiveFireIntervalSeconds(
  baseFireIntervalSeconds: number,
  bulletTimeActive: boolean,
  bulletScale: number,
  weaponAdvantage: number
): number {
  if (bulletTimeActive && bulletScale > 1e-6) {
    return (baseFireIntervalSeconds * bulletScale) / Math.max(1e-6, weaponAdvantage);
  }
  return baseFireIntervalSeconds;
}

export function computeEffectiveProjectileSpeed(
  baseProjectileSpeed: number,
  bulletTimeActive: boolean,
  bulletScale: number,
  weaponAdvantage: number
): number {
  if (bulletTimeActive && bulletScale > 1e-6) {
    return (baseProjectileSpeed * weaponAdvantage) / bulletScale;
  }
  return baseProjectileSpeed;
}
