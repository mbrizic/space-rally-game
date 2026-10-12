import { describe, it, expect } from "vitest";
import { stageBriefing, stageName, stageMetaFromSeed, resolveStageTheme, type TrackZone } from "./stage";
import { surfaceForTrackSM, trackSurfacePercentages } from "./surface";

function overlaps(a: TrackZone, b: TrackZone): boolean {
  return a.start01 < b.end01 && b.start01 < a.end01;
}

describe("stageMetaFromSeed", () => {
  it("names routes deterministically with varied road labels", () => {
    const labels = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const name = stageName(seed);
      expect(name).toBe(stageName(seed));
      expect(name).toMatch(new RegExp(`^(Road|Passage|Detour|Salvage Run|Trail) ${seed}$`));
      expect(name).not.toContain("Street");
      labels.add(name.slice(0, name.lastIndexOf(" ")));
    }
    expect(labels.size).toBe(5);
  });

  it("describes the actual biome and surface mix for each level", () => {
    for (const themeKind of ["desert", "rainforest", "arctic", "temperate"] as const) {
      for (const seed of [1, 315, 999]) {
        const briefing = stageBriefing(seed, themeKind, 1500);
        const percentages = trackSurfacePercentages(1500, seed, themeKind);
        expect(briefing.title).toBe(stageName(seed));
        expect(briefing.tagline.toLowerCase()).toContain(themeKind);
        expect(briefing.tagline).not.toMatch(/[\d%]/);
        const mainSurface = percentages[0].name === "tarmac" ? "asphalt" : percentages[0].name;
        if (percentages.length === 1) expect(briefing.tagline).toContain(`all ${mainSurface}`);
        else if (percentages[0].percent >= 70) expect(briefing.tagline).toContain(`mostly ${mainSurface}`);
        else {
          expect(briefing.tagline).toContain("mix of ");
          for (const surface of percentages) expect(briefing.tagline).toContain(surface.name === "tarmac" ? "asphalt" : surface.name);
        }
        expect(percentages.reduce((sum, surface) => sum + surface.percent, 0)).toBe(100);
        for (const surface of percentages) {
          let samples = 0;
          for (let index = 0; index < 1000; index++) {
            if (surfaceForTrackSM(1500, (index + 0.5) * 1.5, false, seed, themeKind).name === surface.name) samples++;
          }
          expect(Math.abs(surface.percent - samples / 10)).toBeLessThanOrEqual(1.5);
        }
        if (themeKind === "desert") expect(briefing.tagline).not.toMatch(/ice|gravel/);
        if (themeKind === "rainforest") expect(briefing.tagline).not.toContain("ice");
      }
    }
  });

  it("uses a custom route label when no seed exists", () => {
    expect(stageBriefing(undefined, "temperate", 500).title).toBe("Custom route");
  });

  it("is deterministic for a given seed", () => {
    const a = stageMetaFromSeed(123);
    const b = stageMetaFromSeed(123);
    expect(a).toEqual(b);
  });

  it("produces sorted, clamped, non-overlapping zones", () => {
    const { theme, zones } = stageMetaFromSeed(2026);
    const resolved = resolveStageTheme(theme);

    for (const z of zones) {
      expect(z.start01).toBeGreaterThanOrEqual(0);
      expect(z.end01).toBeLessThanOrEqual(1);
      expect(z.intensity01).toBeGreaterThanOrEqual(0);
      expect(z.intensity01).toBeLessThanOrEqual(1);
      expect(z.start01).toBeLessThanOrEqual(z.end01);

      // Zone kinds should be compatible with the resolved theme.
      if (z.kind === "rain") expect(resolved.allowsRain).toBe(true);
      if (z.kind === "fog") expect(resolved.allowsFog).toBe(true);
      if (z.kind === "electrical") expect(resolved.allowsElectrical).toBe(true);
    }

    // sorted
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i - 1].start01).toBeLessThanOrEqual(zones[i].start01);
    }

    // non-overlapping
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        expect(overlaps(zones[i], zones[j])).toBe(false);
      }
    }
  });
});
