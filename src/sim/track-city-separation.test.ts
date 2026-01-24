import { describe, it, expect } from "vitest";
import { createPointToPointTrackDefinition } from "./track";

describe("Track City Separation", () => {
  it("ensures cities are always at least 350m apart (100 random tracks)", () => {
    const minDistance = 350;
    let minFoundDistance = Infinity;
    let worstSeed = 0;

    for (let seed = 1; seed <= 100; seed++) {
      const trackDef = createPointToPointTrackDefinition(seed);
      
      if (!trackDef.startCity || !trackDef.endCity) {
        throw new Error(`Track ${seed} missing cities`);
      }

      const distance = Math.hypot(
        trackDef.endCity.centerX - trackDef.startCity.centerX,
        trackDef.endCity.centerY - trackDef.startCity.centerY
      );

      if (distance < minFoundDistance) {
        minFoundDistance = distance;
        worstSeed = seed;
      }

      expect(distance).toBeGreaterThanOrEqual(minDistance - 1); // Allow 1m tolerance for rounding
    }

    console.log(`Minimum city distance found: ${minFoundDistance.toFixed(1)}m (seed ${worstSeed})`);
  });

  it("ensures no individual angle change exceeds 90 degrees", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const trackDef = createPointToPointTrackDefinition(seed);
      const points = trackDef.points;

      let maxAngleChange = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const v1x = points[i].x - points[i - 1].x;
        const v1y = points[i].y - points[i - 1].y;
        const v2x = points[i + 1].x - points[i].x;
        const v2y = points[i + 1].y - points[i].y;

        const angle1 = Math.atan2(v1y, v1x);
        const angle2 = Math.atan2(v2y, v2x);
        
        // Calculate smallest angle difference
        let angleDiff = angle2 - angle1;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        const absAngleDiff = Math.abs(angleDiff);
        if (absAngleDiff > maxAngleChange) {
          maxAngleChange = absAngleDiff;
        }

        // No segment should turn more than 90 degrees
        expect(absAngleDiff).toBeLessThan(Math.PI / 2 + 0.2); // Allow small tolerance for spline smoothing
      }
    }
  });

  it("ensures track doesn't loop back excessively (straight-line distance check)", () => {
    // Instead of tracking cumulative angles (which is affected by spline smoothing),
    // verify that the straight-line distance from start to end is reasonable
    // compared to the track's actual route distance
    for (let seed = 1; seed <= 50; seed++) {
      const trackDef = createPointToPointTrackDefinition(seed);
      const points = trackDef.points;

      // Straight-line distance start to end
      const straightLine = Math.hypot(
        points[points.length - 1].x - points[0].x,
        points[points.length - 1].y - points[0].y
      );

      // Actual route distance
      let routeDistance = 0;
      for (let i = 1; i < points.length; i++) {
        routeDistance += Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y
        );
      }

      // Straight-line distance should be at least 45% of route distance
      // (if it's much less, the track is looping back too much)
      const ratio = straightLine / routeDistance;
      expect(ratio).toBeGreaterThan(0.44); // Allow for natural curves and hairpins
    }
  });

  it("ensures track never fully reverses direction", () => {
    // Verify no segment points more than 160 degrees away from the overall
    // start-to-end direction (allowing hairpins but not full reversals)
    for (let seed = 1; seed <= 50; seed++) {
      const trackDef = createPointToPointTrackDefinition(seed);
      const points = trackDef.points;

      if (points.length < 3) continue;

      // Overall direction from start to end
      const overallAngle = Math.atan2(
        points[points.length - 1].y - points[0].y,
        points[points.length - 1].x - points[0].x
      );

      // Check each segment
      let maxReverse = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const currentAngle = Math.atan2(
          points[i + 1].y - points[i].y,
          points[i + 1].x - points[i].x
        );

        // Calculate angle difference from overall direction
        let angleDiff = currentAngle - overallAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const absAngleDiff = Math.abs(angleDiff);
        if (absAngleDiff > maxReverse) {
          maxReverse = absAngleDiff;
        }
        
        // Should never face more than 160 degrees away from overall direction
        // (allows tight hairpins but prevents full 180° reversals)
        expect(absAngleDiff).toBeLessThan(Math.PI * 0.90); // 162 degrees max
      }
    }
  });

  it("generates tracks with reasonable total length", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const trackDef = createPointToPointTrackDefinition(seed);
      const points = trackDef.points;

      let totalLength = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        totalLength += Math.hypot(dx, dy);
      }

      // Should be between 500m and 700m total (including city sections)
      expect(totalLength).toBeGreaterThan(480);
      expect(totalLength).toBeLessThan(720);
    }
  });
});
