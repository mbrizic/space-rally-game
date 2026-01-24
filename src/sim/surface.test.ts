import { describe, expect, it } from "vitest";
import { surfaceForTrackSM } from "./surface";

describe("surface types", () => {
  it("returns all surface types correctly throughout track", () => {
    const totalLength = 1000;
    
    // Sample the entire track
    const surfaces = new Set<string>();
    for (let s = 0; s < totalLength; s += 10) {
      const surface = surfaceForTrackSM(totalLength, s, false);
      surfaces.add(surface.name);
      
      // All surfaces should have valid friction
      expect(surface.frictionMu).toBeGreaterThan(0);
      expect(surface.frictionMu).toBeLessThan(2);
      
      // All surfaces should have valid rolling resistance
      expect(surface.rollingResistanceN).toBeGreaterThan(0);
      expect(surface.rollingResistanceN).toBeLessThan(2000);
    }
    
    // Check that ice is included
    expect(surfaces.has("ice")).toBe(true);
    expect(surfaces.has("tarmac")).toBe(true);
  });

  it("returns offtrack surface when off track", () => {
    const surface = surfaceForTrackSM(1000, 500, true);
    expect(surface.name).toBe("offtrack");
    expect(surface.frictionMu).toBeLessThan(1);
  });

  it("ice has lower friction than tarmac", () => {
    const totalLength = 1000;
    let iceFound = false;
    let tarmacFound = false;
    let iceFriction = 0;
    let tarmacFriction = 0;

    for (let s = 0; s < totalLength; s += 5) {
      const surface = surfaceForTrackSM(totalLength, s, false);
      if (surface.name === "ice") {
        iceFound = true;
        iceFriction = surface.frictionMu;
      }
      if (surface.name === "tarmac") {
        tarmacFound = true;
        tarmacFriction = surface.frictionMu;
      }
    }

    expect(iceFound).toBe(true);
    expect(tarmacFound).toBe(true);
    expect(iceFriction).toBeLessThan(tarmacFriction);
    expect(iceFriction).toBeLessThan(0.5); // Ice should be very slippery
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
