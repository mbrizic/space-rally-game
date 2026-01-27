import { describe, it, expect } from "vitest";
import { parseTrackDefinition, serializeTrackDefinition, createTrackFromDefinition, type TrackDefinition } from "./track";

describe("TrackDefinition serialization/parsing", () => {
  it("round-trips a minimal definition", () => {
    const def: TrackDefinition = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ],
      baseWidthM: 7.5
    };

    const json = serializeTrackDefinition(def);
    const parsed = parseTrackDefinition(json);

    expect(parsed).not.toBeNull();
    expect(parsed?.baseWidthM).toBe(7.5);
    expect(parsed?.points).toEqual(def.points);
  });

  it("returns null for invalid JSON or missing required fields", () => {
    expect(parseTrackDefinition("not-json")).toBeNull();
    expect(parseTrackDefinition(JSON.stringify({}))).toBeNull();
    expect(parseTrackDefinition(JSON.stringify({ points: [{ x: 0, y: 0 }] }))).toBeNull();
    expect(parseTrackDefinition(JSON.stringify({ baseWidthM: 7.5 }))).toBeNull();
  });

  it("sanitizes segmentWidthsM and meta fields", () => {
    const def = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ],
      baseWidthM: 7.5,
      segmentWidthsM: [7.5, "bad", Infinity],
      meta: {
        seed: 123,
        source: "procedural",
        theme: { kind: "not-a-theme" },
        zones: [
          { kind: "fog", start01: -1, end01: 2, intensity01: 3 },
          { kind: "not-a-zone", start01: 0.1, end01: 0.2, intensity01: 0.3 },
          { kind: "rain", start01: 0.25, end01: 0.3, intensity01: 0.8 }
        ]
      }
    };

    const parsed = parseTrackDefinition(JSON.stringify(def));
    expect(parsed).not.toBeNull();

    // segmentWidthsM should be same length and non-finite/non-numbers fall back to baseWidthM
    expect(parsed?.segmentWidthsM).toEqual([7.5, 7.5, 7.5]);

    // invalid theme should be dropped
    expect(parsed?.meta?.theme).toBeUndefined();

    // zones should be filtered/clamped to [0..1]
    expect(parsed?.meta?.zones?.length).toBe(2);
    expect(parsed?.meta?.zones?.[0]).toEqual({ kind: "fog", start01: 0, end01: 1, intensity01: 1 });
    expect(parsed?.meta?.zones?.[1]).toEqual({ kind: "rain", start01: 0.25, end01: 0.3, intensity01: 0.8 });
  });

  it("creates a track with consistent length metadata", () => {
    const def: TrackDefinition = {
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 }, // 5m
        { x: 3, y: 8 } // 4m
      ],
      baseWidthM: 7.5
    };

    const track = createTrackFromDefinition(def);

    expect(track.segmentLengthsM.length).toBe(track.points.length);
    expect(track.cumulativeLengthsM.length).toBe(track.points.length);

    // total length should match cumulative at last point
    expect(track.totalLengthM).toBeCloseTo(track.cumulativeLengthsM[track.cumulativeLengthsM.length - 1], 6);

    // expected polyline length: 5 + 4 = 9
    expect(track.totalLengthM).toBeCloseTo(9, 6);
  });
});
