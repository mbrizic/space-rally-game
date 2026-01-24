import { describe, it, expect } from "vitest";
import { createPointToPointTrackDefinition, createTrackFromDefinition } from "./track";

/**
 * Calculate the total curvature of a track by summing absolute angle changes
 * between consecutive segments. Higher values = more wavy/curvy track.
 */
function calculateTrackCurvature(track: ReturnType<typeof createTrackFromDefinition>): number {
  let totalCurvature = 0;
  
  for (let i = 1; i < track.points.length - 1; i++) {
    const p0 = track.points[i - 1];
    const p1 = track.points[i];
    const p2 = track.points[i + 1];
    
    // Vector from p0 to p1
    const v1x = p1.x - p0.x;
    const v1y = p1.y - p0.y;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    
    // Vector from p1 to p2
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.01 && len2 > 0.01) {
      // Normalize vectors
      const n1x = v1x / len1;
      const n1y = v1y / len1;
      const n2x = v2x / len2;
      const n2y = v2y / len2;
      
      // Calculate angle between vectors using dot product
      const dot = n1x * n2x + n1y * n2y;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      totalCurvature += angle;
    }
  }
  
  return totalCurvature;
}

/**
 * Count the number of "real corners" (angle changes > 15 degrees)
 */
function countSignificantCorners(track: ReturnType<typeof createTrackFromDefinition>): number {
  let cornerCount = 0;
  const minCornerAngle = Math.PI / 12; // 15 degrees
  
  for (let i = 1; i < track.points.length - 1; i++) {
    const p0 = track.points[i - 1];
    const p1 = track.points[i];
    const p2 = track.points[i + 1];
    
    const v1x = p1.x - p0.x;
    const v1y = p1.y - p0.y;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (len1 > 0.01 && len2 > 0.01) {
      const n1x = v1x / len1;
      const n1y = v1y / len1;
      const n2x = v2x / len2;
      const n2y = v2y / len2;
      
      const dot = n1x * n2x + n1y * n2y;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      
      if (angle > minCornerAngle) {
        cornerCount++;
      }
    }
  }
  
  return cornerCount;
}

describe("Track Waviness (Rally Requirements)", () => {
  it("tracks have sufficient curvature for rally gameplay", () => {
    const testSeeds = [100, 200, 300, 400, 500];
    const curvatures: number[] = [];
    
    for (const seed of testSeeds) {
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const curvature = calculateTrackCurvature(track);
      curvatures.push(curvature);
    }
    
    const avgCurvature = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
    const minCurvature = Math.min(...curvatures);
    
    // Rally tracks should have significant curvature
    // With Catmull-Rom smoothing, ~6+ radians (340+ degrees) total curvature is very wavy
    expect(avgCurvature).toBeGreaterThan(5.5);
    expect(minCurvature).toBeGreaterThan(4.5); // Even the straightest track should be wavy
  });
  
  it("tracks have many significant corners (not mostly straight)", () => {
    const testSeeds = [100, 200, 300, 400, 500];
    const cornerCounts: number[] = [];
    
    for (const seed of testSeeds) {
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const corners = countSignificantCorners(track);
      cornerCounts.push(corners);
    }
    
    const avgCorners = cornerCounts.reduce((a, b) => a + b, 0) / cornerCounts.length;
    const minCorners = Math.min(...cornerCounts);
    
    // Rally stages should have noticeable corners to navigate
    // Catmull-Rom smooths things out, but we should still see distinct direction changes
    expect(avgCorners).toBeGreaterThan(7);
    expect(minCorners).toBeGreaterThan(5); // Even the straightest should have corners
  });
  
  it("tracks maintain variety (not all the same curvature)", () => {
    const testSeeds = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const curvatures: number[] = [];
    
    for (const seed of testSeeds) {
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      const curvature = calculateTrackCurvature(track);
      curvatures.push(curvature);
    }
    
    // Calculate standard deviation to ensure variety
    const avg = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
    const variance = curvatures.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / curvatures.length;
    const stdDev = Math.sqrt(variance);
    
    // Tracks should vary enough to feel different
    // Standard deviation should be at least 0.2 radians for some variety
    expect(stdDev).toBeGreaterThan(0.2);
  });
  
  it("wavy tracks still maintain safety constraints", () => {
    // Generate 20 random tracks and ensure they all pass basic safety checks
    const numTests = 20;
    
    for (let i = 0; i < numTests; i++) {
      const seed = 2000 + i * 123; // Different seeds
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      // Check 1: Cities should still be far apart
      expect(track.startCity).toBeDefined();
      expect(track.endCity).toBeDefined();
      if (track.startCity && track.endCity) {
        const cityDist = Math.hypot(
          track.endCity.centerX - track.startCity.centerX,
          track.endCity.centerY - track.startCity.centerY
        );
        expect(cityDist).toBeGreaterThanOrEqual(350 - 5); // 5m tolerance
      }
      
      // Check 2: Track length should be reasonable
      expect(track.totalLengthM).toBeGreaterThanOrEqual(800);
      expect(track.totalLengthM).toBeLessThanOrEqual(1600);
      
      // Check 3: Track should have enough curvature to be interesting
      const curvature = calculateTrackCurvature(track);
      expect(curvature).toBeGreaterThan(4); // Minimum interesting curvature
    }
  });
  
  it("stress test: 100 wavy tracks all meet requirements", () => {
    let minCurvatureSeen = Infinity;
    let maxCurvatureSeen = -Infinity;
    let totalCorners = 0;
    
    for (let i = 0; i < 100; i++) {
      const seed = 5000 + i * 47;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const curvature = calculateTrackCurvature(track);
      const corners = countSignificantCorners(track);
      
      minCurvatureSeen = Math.min(minCurvatureSeen, curvature);
      maxCurvatureSeen = Math.max(maxCurvatureSeen, curvature);
      totalCorners += corners;
      
      // Each track should meet minimum requirements
      expect(curvature).toBeGreaterThanOrEqual(4);
      expect(corners).toBeGreaterThanOrEqual(5);
    }
    
    const avgCorners = totalCorners / 100;
    
    // Summary checks
    expect(minCurvatureSeen).toBeGreaterThan(4);
    expect(maxCurvatureSeen).toBeGreaterThan(7); // Some tracks should be very curvy
    expect(avgCorners).toBeGreaterThan(6);
  });
});
