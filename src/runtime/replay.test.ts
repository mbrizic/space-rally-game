import { describe, expect, it } from "vitest";
import { importReplayFromJsonText, parseReplayBundle, type ReplayBundleV2 } from "./replay";

function makeMinV2(overrides: Partial<ReplayBundleV2> = {}): ReplayBundleV2 {
  return {
    v: 2,
    createdAtMs: 123,
    seed: "42",
    trackDef: "{}",
    state: { sampleHz: 15, frames: [] },
    inputs: null,
    ...overrides
  };
}

describe("replay bundle parsing", () => {
  it("parses v2 minimal bundle", () => {
    const rec = parseReplayBundle(makeMinV2());
    expect(rec?.v).toBe(2);
    expect(rec?.seed).toBe("42");
  });

  it("accepts v2 inputs with startGear as 'F'", () => {
    const rec = parseReplayBundle(
      makeMinV2({
        inputs: {
          startTimeSeconds: 0,
          startCar: {} as any,
          startEngine: {} as any,
          startGear: "F",
          events: []
        }
      })
    );
    expect(rec?.inputs?.startGear).toBe("F");
  });

  it("accepts v2 inputs with startGear as 'R'", () => {
    const rec = parseReplayBundle(
      makeMinV2({
        inputs: {
          startTimeSeconds: 0,
          startCar: {} as any,
          startEngine: {} as any,
          startGear: "R",
          events: []
        }
      })
    );
    expect(rec?.inputs?.startGear).toBe("R");
  });

  it("coerces numeric startGear to 'F'|'R'", () => {
    const parsed: any = makeMinV2({
      inputs: {
        startTimeSeconds: 0,
        startCar: {},
        startEngine: {},
        startGear: -1,
        events: []
      } as any
    });
    const rec = parseReplayBundle(parsed);
    expect(rec?.inputs?.startGear).toBe("R");

    parsed.inputs.startGear = 1;
    const rec2 = parseReplayBundle(parsed);
    expect(rec2?.inputs?.startGear).toBe("F");
  });

  it("rejects unknown startGear", () => {
    const rec = parseReplayBundle(
      makeMinV2({
        inputs: {
          startTimeSeconds: 0,
          startCar: {} as any,
          startEngine: {} as any,
          startGear: "N" as any,
          events: []
        }
      })
    );
    expect(rec).toBeNull();
  });

  it("converts v1 recording to v2 with inputs null", () => {
    const v1: any = {
      v: 1,
      createdAtMs: 99,
      seed: "7",
      trackDef: "{}",
      sampleHz: 15,
      frames: []
    };
    const rec = parseReplayBundle(v1);
    expect(rec?.v).toBe(2);
    expect(rec?.seed).toBe("7");
    expect(rec?.inputs).toBeNull();
    expect(rec?.state.sampleHz).toBe(15);
  });
});

describe("importReplayFromJsonText", () => {
  it("returns ok for valid replay JSON", () => {
    const json = JSON.stringify(makeMinV2());
    const res = importReplayFromJsonText(json);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rec.v).toBe(2);
  });

  it("returns Invalid replay file for valid JSON that doesn't match schema", () => {
    const res = importReplayFromJsonText(JSON.stringify({ hello: "world" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid replay file.");
  });

  it("returns Could not parse JSON for invalid JSON", () => {
    const res = importReplayFromJsonText("{");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Could not parse JSON.");
  });
});
