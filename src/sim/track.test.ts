import { describe, expect, it } from "vitest";
import {
  createProceduralTrackDefinition,
  createPointToPointTrackDefinition,
  createTrackFromDefinition,
  projectToTrack,
  pointOnTrack,
} from "./track";

describe("track generation", () => {
  it("creates point-to-point track with valid properties", () => {
    const def = createPointToPointTrackDefinition(123);

    expect(def.points.length).toBeGreaterThan(10);
    expect(def.baseWidthM).toBeGreaterThan(0);
    expect(def.meta?.seed).toBe(123);
  });

  it("creates procedural track with valid properties", () => {
    const seed = 12345;
    const def = createProceduralTrackDefinition(seed);

    expect(def.points.length).toBeGreaterThan(10);
    expect(def.baseWidthM).toBeGreaterThan(0);
    expect(def.meta?.seed).toBe(seed);
  });

  it("procedural tracks are deterministic with same seed", () => {
    const seed = 42;
    const track1 = createProceduralTrackDefinition(seed);
    const track2 = createProceduralTrackDefinition(seed);

    expect(track1.points.length).toBe(track2.points.length);
    expect(track1.points[0].x).toBeCloseTo(track2.points[0].x, 5);
    expect(track1.points[0].y).toBeCloseTo(track2.points[0].y, 5);
  });

  it("procedural tracks differ with different seeds", () => {
    const track1 = createProceduralTrackDefinition(1);
    const track2 = createProceduralTrackDefinition(2);

    expect(track1.points[0].x).not.toBeCloseTo(track2.points[0].x, 2);
  });

  it("track from definition has valid cumulative lengths", () => {
    const def = createProceduralTrackDefinition(42);
    const track = createTrackFromDefinition(def);

    expect(track.cumulativeLengthsM.length).toBe(track.points.length);
    expect(track.segmentLengthsM.length).toBe(track.points.length);

    // Lengths should be monotonically increasing
    for (let i = 1; i < track.cumulativeLengthsM.length; i++) {
      expect(track.cumulativeLengthsM[i]).toBeGreaterThan(track.cumulativeLengthsM[i - 1]);
    }

    // Total length should match last cumulative + last segment
    const expectedTotal =
      track.cumulativeLengthsM[track.cumulativeLengthsM.length - 1] +
      track.segmentLengthsM[track.segmentLengthsM.length - 1];
    expect(track.totalLengthM).toBeCloseTo(expectedTotal, 1);
  });

  it("projects point onto track correctly", () => {
    const def = createProceduralTrackDefinition(42);
    const track = createTrackFromDefinition(def);

    // Project a point that's on the track
    const pointAt0 = pointOnTrack(track, 0);
    const projection = projectToTrack(track, pointAt0.p);

    expect(projection.sM).toBeCloseTo(0, 1);
    expect(Math.abs(projection.lateralOffsetM)).toBeLessThan(0.1);
  });

  it("calculates distance to centerline correctly", () => {
    const def = createProceduralTrackDefinition(42);
    const track = createTrackFromDefinition(def);

    // Get a point on the track
    const onTrack = pointOnTrack(track, track.totalLengthM / 2);

    // Offset it to the side
    const offsetPoint = {
      x: onTrack.p.x + 5,
      y: onTrack.p.y,
    };

    const projection = projectToTrack(track, offsetPoint);
    expect(projection.distanceToCenterlineM).toBeGreaterThan(0);
  });

  it("handles point-to-point track endpoints correctly", () => {
    const def = createPointToPointTrackDefinition(123);
    const track = createTrackFromDefinition(def);

    const startPoint = pointOnTrack(track, 0);
    const endPoint = pointOnTrack(track, track.totalLengthM);

    // Both should return valid points
    expect(Number.isFinite(startPoint.p.x)).toBe(true);
    expect(Number.isFinite(endPoint.p.x)).toBe(true);

    // Start and end should be far apart (it's point-to-point, not a loop)
    const distance = Math.hypot(startPoint.p.x - endPoint.p.x, startPoint.p.y - endPoint.p.y);
    expect(distance).toBeGreaterThan(100); // Should be well separated
  });

  it("does not produce NaN coordinates", () => {
    const def = createProceduralTrackDefinition(999);
    const track = createTrackFromDefinition(def);

    // Sample the entire track
    for (let s = 0; s < track.totalLengthM; s += 10) {
      const point = pointOnTrack(track, s);

      expect(Number.isFinite(point.p.x)).toBe(true);
      expect(Number.isFinite(point.p.y)).toBe(true);
      expect(Number.isFinite(point.headingRad)).toBe(true);
    }
  });

  it("track segments have positive lengths (except last)", () => {
    const def = createPointToPointTrackDefinition(456);
    const track = createTrackFromDefinition(def);

    expect(track.segmentLengthsM.length).toBeGreaterThan(0);
    // All segments except the last should have positive length
    // (last segment is 0 as there's no segment after the final point)
    for (let i = 0; i < track.segmentLengthsM.length - 1; i++) {
      expect(track.segmentLengthsM[i]).toBeGreaterThan(0);
    }
  });

  it("projection never produces NaN", () => {
    const def = createProceduralTrackDefinition(42);
    const track = createTrackFromDefinition(def);

    // Test with various points
    const testPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: -100, y: -100 },
      { x: 1000, y: 1000 },
    ];

    for (const p of testPoints) {
      const projection = projectToTrack(track, p);

      expect(Number.isFinite(projection.sM)).toBe(true);
      expect(Number.isFinite(projection.distanceToCenterlineM)).toBe(true);
      expect(Number.isFinite(projection.lateralOffsetM)).toBe(true);
      expect(Number.isFinite(projection.widthM)).toBe(true);
    }
  });

  it("narrow track has smaller width than default", () => {
    const narrow = createProceduralTrackDefinition(123, { baseWidthM: 5 });
    const normal = createProceduralTrackDefinition(123, { baseWidthM: 10 });

    expect(narrow.baseWidthM).toBeLessThan(normal.baseWidthM);
  });
});
