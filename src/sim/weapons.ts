export enum WeaponType {
    HANDGUN = "handgun",
    RIFLE = "rifle",
    AK47 = "ak47",
    SHOTGUN = "shotgun"
}

export interface WeaponStats {
    name: string;
    type: WeaponType;
    damage: number;
    fireInterval: number; // Seconds between shots
    projectileSpeed: number; // m/s
    projectileCount: number; // Number of projectiles per shot (e.g. shotgun)
    spread: number; // Spread angle in radians (total cone)
    ammoCapacity: number; // -1 for infinity
    projectileColor: string;
    projectileSize: number; // Meters
    sound: string; // Audio effect ID
}

export interface WeaponState {
    stats: WeaponStats;
    ammo: number; // Current ammo
    lastFireTime: number;
}

export function createWeaponStats(type: WeaponType): WeaponStats {
    switch (type) {
        case WeaponType.HANDGUN:
            return {
                name: "Handgun",
                type: WeaponType.HANDGUN,
                damage: 1.5,
                fireInterval: 0.25,
                projectileSpeed: 220,
                projectileCount: 1,
                spread: 0.05, // Slight inaccuracy
                ammoCapacity: -1, // Infinite
                projectileColor: "#ffffaa",
                projectileSize: 0.2, // Small
                sound: "gunshot"
            };
        case WeaponType.RIFLE:
            return {
                name: "Rifle",
                type: WeaponType.RIFLE,
                damage: 5.2,
                fireInterval: 0.6,
                projectileSpeed: 350,
                projectileCount: 1,
                spread: 0.01, // Very accurate
                ammoCapacity: 30,
                projectileColor: "#ffaa00",
                projectileSize: 0.3,
                sound: "rifle"
            };
        case WeaponType.AK47:
            return {
                name: "AK-47",
                type: WeaponType.AK47,
                damage: 1.2,
                fireInterval: 0.11,
                projectileSpeed: 240,
                projectileCount: 1,
                spread: 0.1, // Less accurate when spraying
                ammoCapacity: 90,
                projectileColor: "#ffcc00",
                projectileSize: 0.2,
                sound: "ak47"
            };
        case WeaponType.SHOTGUN:
            return {
                name: "Shotgun",
                type: WeaponType.SHOTGUN,
                damage: 1.0, // Per pellet
                fireInterval: 0.9,
                projectileSpeed: 170, // Slower pellets
                projectileCount: 6, // 6 pellets
                spread: 0.25, // Wide spread
                ammoCapacity: 12,
                projectileColor: "#ffcc00",
                projectileSize: 0.2,
                sound: "shotgun"
            };
    }
}

export function createWeaponState(type: WeaponType): WeaponState {
    const stats = createWeaponStats(type);
    return {
        stats,
        ammo: stats.ammoCapacity,
        lastFireTime: -100 // Ready to fire immediately
    };
}
