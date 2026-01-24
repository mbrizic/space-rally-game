import { describe, expect, it } from "vitest";
import { surfaceForTrackSM } from "./surface";

describe("surface types", () => {
  it("returns valid surface types throughout track with randomization", () => {
    const totalLength = 1000;
    const trackSeed = 12345;
    
    // Sample the entire track
    const surfaces = new Set<string>();
    for (let s = 0; s < totalLength; s += 10) {
      const surface = surfaceForTrackSM(totalLength, s, false, trackSeed);
      surfaces.add(surface.name);
      
      // All surfaces should have valid friction
      expect(surface.frictionMu).toBeGreaterThan(0);
      expect(surface.frictionMu).toBeLessThan(2);
      
      // All surfaces should have valid rolling resistance
      expect(surface.rollingResistanceN).toBeGreaterThan(0);
      expect(surface.rollingResistanceN).toBeLessThan(2000);
      
      // Surface name should be one of the valid types
      expect(["tarmac", "gravel", "dirt", "ice", "offtrack"]).toContain(surface.name);
    }
    
    // Check that we have some variety (at least 2 different surfaces)
    expect(surfaces.size).toBeGreaterThanOrEqual(2);
  });

  it("returns offtrack surface when off track", () => {
    const surface = surfaceForTrackSM(1000, 500, true);
    expect(surface.name).toBe("offtrack");
    expect(surface.frictionMu).toBeLessThan(1);
  });

  it("different surface types have appropriate friction values", () => {
    const totalLength = 1000;
    const trackSeed = 99999;
    const surfaceMap = new Map<string, number>();

    // Collect friction values for each surface type we encounter
    for (let s = 0; s < totalLength; s += 5) {
      const surface = surfaceForTrackSM(totalLength, s, false, trackSeed);
      if (!surfaceMap.has(surface.name)) {
        surfaceMap.set(surface.name, surface.frictionMu);
      }
    }

    // Ice should be slippery (if present)
    if (surfaceMap.has("ice")) {
      expect(surfaceMap.get("ice")!).toBeLessThan(0.5);
    }
    
    // Tarmac should have high grip (if present)
    if (surfaceMap.has("tarmac")) {
      expect(surfaceMap.get("tarmac")!).toBeGreaterThan(1.0);
    }
    
    // If both are present, ice should be slipperier
    if (surfaceMap.has("ice") && surfaceMap.has("tarmac")) {
      expect(surfaceMap.get("ice")!).toBeLessThan(surfaceMap.get("tarmac")!);
    }
  });

  it("handles wrap-around at track boundaries", () => {
    const totalLength = 1000;
    
    // Test at boundaries
    const start = surfaceForTrackSM(totalLength, 0, false);
    const end = surfaceForTrackSM(totalLength, totalLength, false);
    const overEnd = surfaceForTrackSM(totalLength, totalLength + 10, false);
    
    expect(start.name).toBeDefined();
    expect(end.name).toBeDefined();
    expect(overEnd.name).toBeDefined();
  });
});
