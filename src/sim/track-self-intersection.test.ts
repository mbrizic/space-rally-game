import { describe, it, expect } from "vitest";
import { createPointToPointTrackDefinition, createTrackFromDefinition } from "./track";

/**
 * Check if two line segments intersect
 * Returns true if segments (p1-p2) and (p3-p4) intersect
 */
function segmentsIntersect(
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  p4x: number, p4y: number
): boolean {
  const d1x = p2x - p1x;
  const d1y = p2y - p1y;
  const d2x = p4x - p3x;
  const d2y = p4y - p3y;
  
  const denominator = d1x * d2y - d1y * d2x;
  
  // Parallel or coincident
  if (Math.abs(denominator) < 1e-10) return false;
  
  const t1 = ((p3x - p1x) * d2y - (p3y - p1y) * d2x) / denominator;
  const t2 = ((p3x - p1x) * d1y - (p3y - p1y) * d1x) / denominator;
  
  // Check if intersection point is within both segments
  // Use small epsilon to avoid flagging adjacent segments
  const epsilon = 0.01;
  return t1 > epsilon && t1 < (1 - epsilon) && t2 > epsilon && t2 < (1 - epsilon);
}

/**
 * Check if a track has any self-intersections
 * Returns array of intersection points if found
 */
function findTrackSelfIntersections(track: ReturnType<typeof createTrackFromDefinition>): Array<{i: number, j: number}> {
  const intersections: Array<{i: number, j: number}> = [];
  
  // Check each segment against all other non-adjacent segments
  for (let i = 0; i < track.points.length - 1; i++) {
    const p1 = track.points[i];
    const p2 = track.points[i + 1];
    
    // Start checking from segments that are far enough away (skip adjacent)
    for (let j = i + 3; j < track.points.length - 1; j++) {
      const p3 = track.points[j];
      const p4 = track.points[j + 1];
      
      if (segmentsIntersect(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)) {
        intersections.push({ i, j });
      }
    }
  }
  
  return intersections;
}

/**
 * Check if track segments come too close to each other
 * (within road width, indicating potential overlap)
 */
function findTrackNearOverlaps(track: ReturnType<typeof createTrackFromDefinition>): Array<{i: number, j: number, distance: number}> {
  const overlaps: Array<{i: number, j: number, distance: number}> = [];
  const minDistance = 15; // Roads should be at least 15m apart (2x road width)
  
  for (let i = 0; i < track.points.length; i++) {
    const p1 = track.points[i];
    
    // Check against distant points (skip nearby points on the track)
    for (let j = i + 10; j < track.points.length; j++) {
      const p2 = track.points[j];
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      
      if (distance < minDistance) {
        overlaps.push({ i, j, distance });
      }
    }
  }
  
  return overlaps;
}

describe("Track Self-Intersection Prevention", () => {
  it("tracks should have ZERO crossing segments (100 random tracks) - STRICT", () => {
    let tracksWithIntersections = 0;
    let worstSeed = -1;
    let maxIntersections = 0;
    
    for (let i = 0; i < 100; i++) {
      const seed = 7000 + i * 37;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const intersections = findTrackSelfIntersections(track);
      
      if (intersections.length > 0) {
        tracksWithIntersections++;
        if (intersections.length > maxIntersections) {
          maxIntersections = intersections.length;
          worstSeed = seed;
        }
      }
      
      // STRICT: NO intersections allowed
      if (intersections.length > 0) {
        console.log(`Track ${seed} has ${intersections.length} intersection(s) - FAILING`);
      }
      expect(intersections.length).toBe(0);
    }
    
    if (tracksWithIntersections > 0) {
      console.log(`FAILED: ${tracksWithIntersections}/100 tracks have intersections. Worst: ${maxIntersections} (seed ${worstSeed})`);
    }
  });
  
  it("track segments should maintain minimum separation distance", () => {
    // Test a subset with detailed checking
    const testSeeds = [100, 200, 300, 400, 500];
    
    for (const seed of testSeeds) {
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const overlaps = findTrackNearOverlaps(track);
      
      // Allow some close passes (rally stages can be tight), but not too many
      expect(overlaps.length).toBeLessThan(20);
      
      // If there are close passes, they shouldn't be dangerously close (causing visual overlaps)
      for (const overlap of overlaps) {
        expect(overlap.distance).toBeGreaterThan(3); // At least 3m apart (road width)
      }
    }
  });
  
  it("stress test: 500 tracks should NEVER self-intersect - STRICT", () => {
    let totalIntersections = 0;
    let intersectingTracks = 0;
    
    for (let i = 0; i < 500; i++) {
      const seed = 10000 + i * 47;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const intersections = findTrackSelfIntersections(track);
      
      if (intersections.length > 0) {
        intersectingTracks++;
        totalIntersections += intersections.length;
      }
    }
    
    // Report findings
    if (intersectingTracks > 0) {
      console.log(`FAILED: ${intersectingTracks} tracks with self-intersections out of 500`);
      console.log(`Total intersection points: ${totalIntersections}`);
      console.log(`Failure rate: ${(intersectingTracks/500*100).toFixed(1)}%`);
    }
    
    // STRICT: ZERO intersections allowed
    expect(intersectingTracks).toBe(0);
  });
  
  it("visual check: log details of first intersecting track if any exist", () => {
    // This test helps debug by finding and logging the first problem
    for (let i = 0; i < 50; i++) {
      const seed = 20000 + i * 13;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const intersections = findTrackSelfIntersections(track);
      
      if (intersections.length > 0) {
        console.log(`\nTrack seed ${seed} has ${intersections.length} intersection(s):`);
        for (const inter of intersections.slice(0, 3)) { // Log first 3
          const p1 = track.points[inter.i];
          const p2 = track.points[inter.i + 1];
          const p3 = track.points[inter.j];
          const p4 = track.points[inter.j + 1];
          console.log(`  Segment ${inter.i}-${inter.i+1} (${p1.x.toFixed(1)},${p1.y.toFixed(1)} → ${p2.x.toFixed(1)},${p2.y.toFixed(1)})`);
          console.log(`  crosses segment ${inter.j}-${inter.j+1} (${p3.x.toFixed(1)},${p3.y.toFixed(1)} → ${p4.x.toFixed(1)},${p4.y.toFixed(1)})`);
        }
        
        // Report first intersection found for debugging
        expect(intersections.length).toBeLessThanOrEqual(2); // Allow minor intersections
        return; // Stop after first check
      }
    }
    
    // If we get here, no intersections found - good!
    expect(true).toBe(true);
  });
});
