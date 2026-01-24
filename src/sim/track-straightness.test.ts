import { describe, it, expect } from "vitest";
import { createPointToPointTrackDefinition, createTrackFromDefinition } from "./track";

/**
 * Calculate the straightness of a track section
 * Returns the average absolute curvature - lower values mean straighter
 */
function calculateSectionCurvature(
  track: ReturnType<typeof createTrackFromDefinition>,
  startFraction: number,
  endFraction: number
): number {
  const startIdx = Math.floor(track.points.length * startFraction);
  const endIdx = Math.floor(track.points.length * endFraction);
  
  let totalCurvature = 0;
  let count = 0;
  
  for (let i = startIdx; i < endIdx - 2; i++) {
    const p1 = track.points[i];
    const p2 = track.points[i + 1];
    const p3 = track.points[i + 2];
    
    // Calculate angles between consecutive segments
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    
    // Angle change (normalized to -PI to PI)
    let angleChange = angle2 - angle1;
    while (angleChange > Math.PI) angleChange -= Math.PI * 2;
    while (angleChange < -Math.PI) angleChange += Math.PI * 2;
    
    totalCurvature += Math.abs(angleChange);
    count++;
  }
  
  return count > 0 ? totalCurvature / count : 0;
}

/**
 * Detect long straight sections in the track
 * Returns array of straight sections with their start/end indices and length
 */
function findStraightSections(
  track: ReturnType<typeof createTrackFromDefinition>,
  minLengthM: number = 100
): Array<{ startIdx: number; endIdx: number; lengthM: number }> {
  const straightSections: Array<{ startIdx: number; endIdx: number; lengthM: number }> = [];
  const curvatureThreshold = 0.01; // Very low curvature = straight
  
  let currentStraightStart = -1;
  let currentStraightLength = 0;
  
  for (let i = 0; i < track.points.length - 2; i++) {
    const p1 = track.points[i];
    const p2 = track.points[i + 1];
    const p3 = track.points[i + 2];
    
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
    
    let angleChange = angle2 - angle1;
    while (angleChange > Math.PI) angleChange -= Math.PI * 2;
    while (angleChange < -Math.PI) angleChange += Math.PI * 2;
    
    const curvature = Math.abs(angleChange);
    const segmentLength = track.segmentLengthsM[i];
    
    if (curvature < curvatureThreshold) {
      // This segment is straight
      if (currentStraightStart === -1) {
        currentStraightStart = i;
        currentStraightLength = segmentLength;
      } else {
        currentStraightLength += segmentLength;
      }
    } else {
      // This segment is curved, end any current straight section
      if (currentStraightStart !== -1 && currentStraightLength >= minLengthM) {
        straightSections.push({
          startIdx: currentStraightStart,
          endIdx: i,
          lengthM: currentStraightLength
        });
      }
      currentStraightStart = -1;
      currentStraightLength = 0;
    }
  }
  
  // Handle case where track ends with a straight section
  if (currentStraightStart !== -1 && currentStraightLength >= minLengthM) {
    straightSections.push({
      startIdx: currentStraightStart,
      endIdx: track.points.length - 1,
      lengthM: currentStraightLength
    });
  }
  
  return straightSections;
}

describe("Track Straightness Prevention", () => {
  it("no section of track should be excessively straight (100 random tracks) - STRICT", () => {
    const maxStraightLengthM = 100; // STRICT: No straight section longer than 100m ANYWHERE
    let tracksWithLongStraights = 0;
    let worstStraightLength = 0;
    let worstSeed = -1;
    
    for (let i = 0; i < 100; i++) {
      const seed = 5000 + i * 19;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      const straightSections = findStraightSections(track, maxStraightLengthM);
      
      if (straightSections.length > 0) {
        tracksWithLongStraights++;
        const maxLength = Math.max(...straightSections.map(s => s.lengthM));
        if (maxLength > worstStraightLength) {
          worstStraightLength = maxLength;
          worstSeed = seed;
        }
        
        console.log(`Track ${seed} FAILED - has ${straightSections.length} straight section(s):`);
        for (const section of straightSections) {
          const startPct = (section.startIdx / track.points.length * 100).toFixed(0);
          const endPct = (section.endIdx / track.points.length * 100).toFixed(0);
          console.log(`  - ${section.lengthM.toFixed(0)}m straight from ${startPct}% to ${endPct}% of track`);
        }
      }
      
      // STRICT: NO long straights anywhere
      expect(straightSections.length).toBe(0);
    }
    
    if (tracksWithLongStraights > 0) {
      console.log(`\nFAILED: ${tracksWithLongStraights}/100 tracks have straight sections > ${maxStraightLengthM}m`);
      console.log(`Worst: ${worstStraightLength.toFixed(0)}m (seed ${worstSeed})`);
    }
  });
  
  it("last third of track should have similar curvature to first two thirds", () => {
    const testSeeds = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    
    for (const seed of testSeeds) {
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      // Calculate curvature for different sections
      const firstThirdCurvature = calculateSectionCurvature(track, 0, 0.33);
      const middleThirdCurvature = calculateSectionCurvature(track, 0.33, 0.66);
      const lastThirdCurvature = calculateSectionCurvature(track, 0.66, 1.0);
      
      // Last third should have at least 50% of the average curvature of first two thirds
      const avgEarlyCurvature = (firstThirdCurvature + middleThirdCurvature) / 2;
      
      if (lastThirdCurvature < avgEarlyCurvature * 0.5) {
        console.log(`\nTrack ${seed} has a too-straight last third:`);
        console.log(`  First third:  ${firstThirdCurvature.toFixed(4)} rad/point`);
        console.log(`  Middle third: ${middleThirdCurvature.toFixed(4)} rad/point`);
        console.log(`  Last third:   ${lastThirdCurvature.toFixed(4)} rad/point`);
        console.log(`  Ratio: ${(lastThirdCurvature / avgEarlyCurvature * 100).toFixed(0)}%`);
      }
      
      expect(lastThirdCurvature).toBeGreaterThan(avgEarlyCurvature * 0.45); // At least 45% of early curvature
    }
  });
  
  it("stress test: check straightness across 200 random tracks", () => {
    let straightLastThirds = 0;
    const maxStraightLengthM = 150;
    
    for (let i = 0; i < 200; i++) {
      const seed = 8000 + i * 23;
      const def = createPointToPointTrackDefinition(seed);
      const track = createTrackFromDefinition(def);
      
      // Check for straight sections specifically in the last third
      const lastThirdStartIdx = Math.floor(track.points.length * 0.66);
      const straightSections = findStraightSections(track, maxStraightLengthM);
      
      // Count straight sections that are in the last third
      const straightInLastThird = straightSections.filter(s => s.startIdx >= lastThirdStartIdx);
      
      if (straightInLastThird.length > 0) {
        straightLastThirds++;
      }
      
      // Check curvature distribution
      const lastThirdCurvature = calculateSectionCurvature(track, 0.66, 1.0);
      const avgEarlyCurvature = (
        calculateSectionCurvature(track, 0, 0.33) +
        calculateSectionCurvature(track, 0.33, 0.66)
      ) / 2;
      
      // Last third should not be dramatically straighter
      if (avgEarlyCurvature > 0.01) { // Only check if track has some curves
        expect(lastThirdCurvature).toBeGreaterThan(avgEarlyCurvature * 0.35); // At least 35% of early curvature
      }
    }
    
    // Report findings
    console.log(`\nTracks with straight sections in last third: ${straightLastThirds} / 200`);
    
    // Allow a small percentage to have straights, but not many
    expect(straightLastThirds).toBeLessThan(20); // Less than 10%
  });
});
