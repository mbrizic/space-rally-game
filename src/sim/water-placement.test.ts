import { describe, it, expect } from "vitest";
import { createPointToPointTrackDefinition, createTrackFromDefinition } from "./track";
import { generateWaterBodies, pointToSegmentDistance } from "./props";

/**
 * Check if an ellipse overlaps with the track road surface
 * Returns true if any part of the water body is on the road
 */
function waterOverlapsTrack(
  water: { x: number; y: number; radiusX: number; radiusY: number; rotation: number },
  track: ReturnType<typeof createTrackFromDefinition>
): { overlaps: boolean; minDistance: number; closestSegment: number } {
  const roadHalfWidth = track.widthM * 0.5;
  let minDistance = Infinity;
  let closestSegment = -1;
  
  // Check distance from water center to each track segment
  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i];
    const b = track.points[i + 1];
    const dist = pointToSegmentDistance(water.x, water.y, a.x, a.y, b.x, b.y);
    
    if (dist < minDistance) {
      minDistance = dist;
      closestSegment = i;
    }
  }
  
  // Water overlaps if its edge (center - maxRadius) is within road bounds
  const maxRadius = Math.max(water.radiusX, water.radiusY);
  const distanceToRoadEdge = minDistance - roadHalfWidth;
  const overlaps = distanceToRoadEdge < maxRadius;
  
  return { overlaps, minDistance, closestSegment };
}

describe("Water Placement - Never On Track", () => {
  it("water bodies should NEVER overlap with the road surface (100 tracks)", () => {
    let tracksWithOverlap = 0;
    let totalOverlaps = 0;
    
    for (let i = 0; i < 100; i++) {
      const seed = 5000 + i * 31;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const waterBodies = generateWaterBodies(track, { seed: seed + 777 });
      
      let trackOverlaps = 0;
      
      for (const water of waterBodies) {
        const result = waterOverlapsTrack(water, track);
        
        if (result.overlaps) {
          trackOverlaps++;
          totalOverlaps++;
        }
      }
      
      if (trackOverlaps > 0) {
        tracksWithOverlap++;
      }
    }
    
    if (tracksWithOverlap > 0) {
      console.log(`FAILED: ${tracksWithOverlap}/100 tracks have water overlapping road`);
      console.log(`Total overlapping water bodies: ${totalOverlaps}`);
    }
    
    // STRICT: No water should ever be on the road
    expect(tracksWithOverlap).toBe(0);
  });
  
  it("water should be placed within reasonable distance from track (not too far)", () => {
    const seed = 12345;
    const def = createPointToPointTrackDefinition(seed);
    const track = createTrackFromDefinition(def);
    const waterBodies = generateWaterBodies(track, { seed: seed + 777 });
    
    // Should generate some water bodies
    expect(waterBodies.length).toBeGreaterThan(0);
    
    for (const water of waterBodies) {
      const result = waterOverlapsTrack(water, track);
      
      // Water should be close enough to be relevant (within 50m of road edge)
      const roadHalfWidth = track.widthM * 0.5;
      const maxRadius = Math.max(water.radiusX, water.radiusY);
      const distanceFromRoadEdge = result.minDistance - roadHalfWidth - maxRadius;
      
      expect(distanceFromRoadEdge).toBeLessThan(50);
      expect(distanceFromRoadEdge).toBeGreaterThanOrEqual(0); // Not on road!
    }
  });
  
  it("water placement stress test: 500 tracks, zero overlaps - STRICT", () => {
    let totalWaterBodies = 0;
    let overlappingBodies = 0;
    
    for (let i = 0; i < 500; i++) {
      const seed = 50000 + i * 47;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const waterBodies = generateWaterBodies(track, { seed: seed + 777 });
      
      totalWaterBodies += waterBodies.length;
      
      for (const water of waterBodies) {
        const result = waterOverlapsTrack(water, track);
        if (result.overlaps) {
          overlappingBodies++;
        }
      }
    }
    
    console.log(`Tested ${totalWaterBodies} water bodies across 500 tracks`);
    
    if (overlappingBodies > 0) {
      console.log(`FAILED: ${overlappingBodies} water bodies overlap with track`);
    }
    
    // STRICT: Zero overlaps
    expect(overlappingBodies).toBe(0);
  });
  
  it("each track should have water bodies for hazard variety", () => {
    let tracksWithNoWater = 0;
    
    for (let i = 0; i < 50; i++) {
      const seed = 8000 + i * 23;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const waterBodies = generateWaterBodies(track, { seed: seed + 777 });
      
      if (waterBodies.length === 0) {
        tracksWithNoWater++;
      }
    }
    
    // Most tracks should have water
    expect(tracksWithNoWater).toBeLessThan(5);
  });
});
