import { describe, it, expect } from "vitest";
import { stageMetaFromSeed, resolveStageTheme, type TrackZone } from "./stage";

function overlaps(a: TrackZone, b: TrackZone): boolean {
  return a.start01 < b.end01 && b.start01 < a.end01;
}

describe("stageMetaFromSeed", () => {
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
