import { mulberry32 } from "./rng";

export type StageThemeKind = "temperate" | "rainforest" | "desert" | "arctic";

// Keep what we serialize small + stable.
export type StageThemeRef = { kind: StageThemeKind };

export type StageTheme = StageThemeRef & {
  name: string;
  bgColor: string; // world background
  minimapBgColor: string;
  offtrackBgColor: string;
  terrainColor: string; // strong theme tint (use for world bg / offtrack)
  allowsIce: boolean;
  allowsRain: boolean;
  allowsFog: boolean;
  allowsDarkness: boolean;
  allowsElectrical: boolean;
  allowsSandstorm: boolean;
};

export type TrackZoneKind = "rain" | "fog" | "eclipse" | "electrical" | "sandstorm";

export type TrackZone = {
  kind: TrackZoneKind;
  start01: number;
  end01: number;
  intensity01: number;
};

export function resolveStageTheme(ref: StageThemeRef): StageTheme {
  switch (ref.kind) {
    case "rainforest":
      return {
        kind: "rainforest",
        name: "Rainforest Stage",
        // Deeper greens, damp vibe.
        terrainColor: "rgba(55, 80, 55, 1)",
        bgColor: "rgba(38, 58, 40, 1)",
        minimapBgColor: "rgba(55, 80, 55, 0.22)",
        offtrackBgColor: "rgba(55, 80, 55, 1)",
        allowsIce: false,
        allowsRain: true,
        allowsFog: true,
        allowsDarkness: true,
        allowsElectrical: true,
        allowsSandstorm: false
      };
    case "desert":
      return {
        kind: "desert",
        name: "Desert Rally",
        // Warm sandy background - visible but not overpowering.
        terrainColor: "rgba(140, 115, 75, 1)",
        bgColor: "rgba(120, 100, 65, 1)",
        minimapBgColor: "rgba(140, 115, 75, 0.22)",
        offtrackBgColor: "rgba(140, 115, 75, 1)",
        allowsIce: false,
        allowsRain: false,
        allowsFog: false,
        allowsDarkness: true,
        allowsElectrical: true,
        allowsSandstorm: false
      };
    case "arctic":
      return {
        kind: "arctic",
        name: "Arctic Rally",
        // Light grayish snow/ice background.
        terrainColor: "rgba(170, 175, 180, 1)",
        bgColor: "rgba(155, 160, 165, 1)",
        minimapBgColor: "rgba(170, 175, 180, 0.22)",
        offtrackBgColor: "rgba(170, 175, 180, 1)",
        allowsIce: true,
        allowsRain: true,
        allowsFog: true,
        allowsDarkness: true,
        allowsElectrical: true,
        allowsSandstorm: false
      };
    case "temperate":
    default:
      return {
        kind: "temperate",
        name: "Temperate Stage",
        // Less rainforest-y: more dirt/rock tones with a hint of vegetation.
        terrainColor: "rgba(105, 95, 80, 1)",
        bgColor: "rgba(82, 76, 64, 1)",
        minimapBgColor: "rgba(105, 95, 80, 0.22)",
        offtrackBgColor: "rgba(105, 95, 80, 1)",
        allowsIce: true,
        allowsRain: true,
        allowsFog: true,
        allowsDarkness: true,
        allowsElectrical: true,
        allowsSandstorm: false
      };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pickThemeRef(seed: number): StageThemeRef {
  const r = mulberry32(Math.floor(seed) || 1);
  const roll = r();
  if (roll < 0.22) return { kind: "desert" };
  if (roll < 0.44) return { kind: "arctic" };
  if (roll < 0.70) return { kind: "temperate" };
  return { kind: "rainforest" };
}

function allowedZoneKinds(theme: StageTheme): TrackZoneKind[] {
  // For now, focus on the 3 best gameplay zones and make them frequent.
  // Keep the other kinds around (for compatibility) but stop generating them.
  const out: TrackZoneKind[] = [];
  if (theme.allowsRain) out.push("rain");
  if (theme.allowsFog) out.push("fog");
  if (theme.allowsElectrical) out.push("electrical");
  return out.length > 0 ? out : ["electrical"];
}

function overlaps(a: { start01: number; end01: number }, b: { start01: number; end01: number }): boolean {
  return a.start01 < b.end01 && b.start01 < a.end01;
}

export function stageMetaFromSeed(seed: number): { theme: StageThemeRef; zones: TrackZone[] } {
  const safeSeed = Math.floor(seed) || 1;
  const themeRef = pickThemeRef(safeSeed);
  const theme = resolveStageTheme(themeRef);

  const rand = mulberry32((safeSeed ^ 0x5f3759df) >>> 0);

  const zoneKinds = allowedZoneKinds(theme);
  const zones: TrackZone[] = [];

  // Rain happens 0-1 times per map, covering 20-35% of the track.
  // Fog is a weather zone that reduces visibility (arctic: very common for testing, temperate: moderate).
  const hasRain = theme.allowsRain && rand() < 0.65; // 65% chance of rain zone
  // Fog: arctic is intentionally common; bump slightly for more frequent arctic fog.
  const fogChance = themeRef.kind === "arctic" ? 0.92 : themeRef.kind === "temperate" ? 0.35 : 0.04;
  const hasFog = theme.allowsFog && rand() < fogChance;
  const hasElectrical = theme.allowsElectrical && rand() < 0.06; // 6% chance electrical

  // Add rain zone if applicable
  if (hasRain) {
    const start01 = clamp01(rand() * 0.60); // Start in first 60% of track
    const len01 = 0.20 + rand() * 0.15; // 20-35% of track
    const end01 = clamp01(start01 + len01);
    const intensity01 = clamp01(0.75 + rand() * 0.25);
    zones.push({ kind: "rain", start01, end01, intensity01 });
  }

  // Add fog zone if applicable (non-overlapping) - weather fog that reduces visibility
  if (hasFog) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const start01 = clamp01(rand() * 0.70);
      // Fog covers 15-30% of the track
      const len01 = 0.15 + rand() * 0.15;
      const end01 = clamp01(start01 + len01);
      // Intensity affects visibility radius
      const intensity01 = clamp01(0.5 + rand() * 0.5);
      const candidate: TrackZone = { kind: "fog", start01, end01, intensity01 };
      if (!zones.some((z) => overlaps(z, candidate))) {
        zones.push(candidate);
        break;
      }
    }
  }

  // Add electrical zone if applicable (non-overlapping)
  if (hasElectrical) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const start01 = clamp01(rand() * 0.75);
      const len01 = 0.08 + rand() * 0.12;
      const end01 = clamp01(start01 + len01);
      const intensity01 = clamp01(0.7 + rand() * 0.3);
      const candidate: TrackZone = { kind: "electrical", start01, end01, intensity01 };
      if (!zones.some((z) => overlaps(z, candidate))) {
        zones.push(candidate);
        break;
      }
    }
  }

  // Legacy loop kept for compatibility but now empty since we handle zones above
  const zoneCount = 0;
  for (let i = 0; i < zoneCount; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const roll = rand();
      const kind = (() => {
        if (theme.allowsFog && roll < 0.02) return "fog" as const;
        if (theme.allowsElectrical && roll < 0.06) return "electrical" as const;
        if (theme.allowsRain) return "rain" as const;
        return (zoneKinds[0] ?? "electrical") as TrackZoneKind;
      })();
      const start01 = clamp01(rand() * 0.80);
      const len01 = kind === "rain" ? (0.20 + rand() * 0.30) : (0.10 + rand() * 0.22);
      const end01 = clamp01(start01 + len01);
      const intensity01 = clamp01(0.75 + rand() * 0.25); // Higher intensity

      // Avoid teeny zones.
      if (end01 - start01 < 0.06) continue;

      const candidate: TrackZone = { kind, start01, end01, intensity01 };
      if (zones.some((z) => overlaps(z, candidate))) continue;
      zones.push(candidate);
      break;
    }
  }

  zones.sort((a, b) => a.start01 - b.start01);

  return { theme: themeRef, zones };
}

export function zoneContainsSM(totalLengthM: number, sM: number, zone: TrackZone): boolean {
  const total = Math.max(1e-6, totalLengthM);
  const t01 = ((sM % total) + total) % total;
  const u = t01 / total;
  return u >= zone.start01 && u <= zone.end01;
}

export function zonesAtSM(totalLengthM: number, sM: number, zones: TrackZone[]): TrackZone[] {
  return zones.filter((z) => zoneContainsSM(totalLengthM, sM, z));
}
