import { describe, it, expect } from "vitest";
import { createTrackFromDefinition } from "./track";
import { generateEnemies, EnemyType } from "./enemy";

describe("enemies", () => {
  it("generateEnemies is deterministic for a given seed (including ids)", () => {
    const track = createTrackFromDefinition({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 1000 }
      ],
      baseWidthM: 7.5
    });

    const a = generateEnemies(track, { seed: 1234, count: 25 });
    const b = generateEnemies(track, { seed: 1234, count: 25 });

    const normalize = (xs: typeof a) =>
      xs.map((e) => ({
        id: e.id,
        type: e.type,
        x: +e.x.toFixed(4),
        y: +e.y.toFixed(4),
        trackSegmentHint: +e.trackSegmentHint.toFixed(4),
        wanderAngle: +e.wanderAngle.toFixed(6),
        wanderRngState: e.wanderRngState
      }));

    expect(normalize(a)).toEqual(normalize(b));
  });

  it("generateEnemies produces reasonable positions and types", () => {
    const track = createTrackFromDefinition({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 800 }
      ],
      baseWidthM: 7.5
    });

    const enemies = generateEnemies(track, { seed: 999, count: 40 });

    // All enemies should be within the track bounds in terms of segment hint.
    for (const e of enemies) {
      expect(e.trackSegmentHint).toBeGreaterThanOrEqual(0);
      expect(e.trackSegmentHint).toBeLessThan(track.totalLengthM);

      // Types are constrained to known enums.
      expect([EnemyType.ZOMBIE, EnemyType.TANK, EnemyType.COLOSSUS]).toContain(e.type);

      // Health/radius align with type.
      if (e.type === EnemyType.COLOSSUS) {
        expect(e.maxHealth).toBe(42);
        expect(e.radius).toBeGreaterThan(2.5);
      } else if (e.type === EnemyType.TANK) {
        expect(e.maxHealth).toBe(5);
        expect(e.radius).toBeCloseTo(0.9, 6);
      } else {
        expect(e.maxHealth).toBe(1);
        expect(e.radius).toBeCloseTo(0.6, 6);
      }
    }
  });
});
