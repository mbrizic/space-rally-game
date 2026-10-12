import { describe, expect, it } from "vitest";
import { generateDebris } from "./props";
import { createPointToPointTrackDefinition, createTrackFromDefinition } from "./track";
import { isQuietAtTrackDistance, quietZonesFromSeed } from "./stage";

describe("concentrated debris", () => {
  it("is deterministic and keeps logs out of cities and quiet stretches", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const track = createTrackFromDefinition(createPointToPointTrackDefinition(seed));
      const options = { seed, themeKind: "rainforest" as const, quietZones: quietZonesFromSeed(seed) };
      const logs = generateDebris(track, options);
      expect(logs).toEqual(generateDebris(track, options));
      for (const log of logs) {
        expect(log.sM).toBeGreaterThanOrEqual(150);
        expect(log.sM).toBeLessThan(track.totalLengthM - 180);
        expect(isQuietAtTrackDistance(track.totalLengthM, log.sM, options.quietZones)).toBe(false);
        expect(Number.isFinite(log.x + log.y + log.rotationRad)).toBe(true);
      }
    }
  });

  it("concentrates rainforest logs into at most three short patches and more logs than other biomes", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const track = createTrackFromDefinition(createPointToPointTrackDefinition(seed));
      const rainforest = generateDebris(track, { seed, themeKind: "rainforest" });
      const patches: number[][] = [];
      for (const log of rainforest) {
        const patch = patches[patches.length - 1];
        if (!patch || log.sM - patch[0] > 60) patches.push([log.sM]);
        else patch.push(log.sM);
      }
      expect(patches).toHaveLength(3);
      for (const patch of patches) {
        expect(patch.length).toBeGreaterThanOrEqual(8);
        expect(patch[patch.length - 1] - patch[0]).toBeLessThan(60);
      }
      expect(patches.reduce((sum, patch) => sum + patch[patch.length - 1] - patch[0], 0) / track.totalLengthM).toBeLessThan(0.2);
      for (const themeKind of ["temperate", "arctic", "desert"] as const) {
        expect(rainforest.length).toBeGreaterThan(generateDebris(track, { seed, themeKind }).length);
      }
    }
  });

  it("places no logs when the whole route is quiet", () => {
    const track = createTrackFromDefinition(createPointToPointTrackDefinition(315));
    expect(generateDebris(track, { themeKind: "rainforest", quietZones: [{ start01: 0, end01: 1 }] })).toEqual([]);
  });

  it("reduces patch count on short custom routes without crossing city margins", () => {
    const track = createTrackFromDefinition({ points: [{ x: 0, y: 0 }, { x: 500, y: 0 }], baseWidthM: 7 });
    const logs = generateDebris(track, { themeKind: "rainforest", seed: 315 });
    expect(logs.length).toBeGreaterThanOrEqual(8);
    for (const log of logs) {
      expect(log.sM).toBeGreaterThanOrEqual(150);
      expect(log.sM).toBeLessThan(320);
    }
  });
});