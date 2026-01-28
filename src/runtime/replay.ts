import type { EngineState } from "../sim/engine";
import type { NetSnapshot } from "./net-snapshot";
import { createCarState } from "../sim/car";

// NOTE: This module is intentionally self-contained and testable.
// The replay feature is currently dormant in the UI, but the format and parsing
// logic should remain stable for backwards compatibility.

export type ReplayRecordingV1 = {
  v: 1;
  createdAtMs: number;
  seed: string;
  trackDef: string;
  sampleHz: number;
  frames: NetSnapshot[];
};

export type ReplayInputEventV1 = {
  t: number;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
};

export type ReplayBundleV2 = {
  v: 2;
  createdAtMs: number;
  seed: string;
  trackDef: string;
  state: {
    sampleHz: number;
    frames: NetSnapshot[];
  };
  inputs: {
    startTimeSeconds: number;
    startCar: ReturnType<typeof createCarState>;
    startEngine: EngineState;
    startGear: "F" | "R";
    events: ReplayInputEventV1[];
  } | null;
};

function coerceStartGear(raw: unknown): "F" | "R" | null {
  let gear: unknown = raw;
  if (typeof gear === "number") gear = gear < 0 ? "R" : "F";
  if (gear === "F" || gear === "R") return gear;
  return null;
}

/**
 * Parse a replay bundle from a JS object (already JSON-parsed).
 * Returns null if the payload is not recognized/valid.
 */
export function parseReplayBundle(parsed: unknown): ReplayBundleV2 | null {
  const anyParsed: any = parsed as any;
  if (!anyParsed) return null;

  if (anyParsed.v === 2) {
    if (typeof anyParsed.seed !== "string" || typeof anyParsed.trackDef !== "string") return null;
    if (!anyParsed.state || typeof anyParsed.state.sampleHz !== "number" || !Array.isArray(anyParsed.state.frames)) return null;

    if (anyParsed.inputs != null) {
      const inp: any = anyParsed.inputs;
      if (typeof inp.startTimeSeconds !== "number") return null;
      if (!inp.startCar || typeof inp.startCar !== "object") return null;
      if (!inp.startEngine || typeof inp.startEngine !== "object") return null;
      const gear = coerceStartGear(inp.startGear);
      if (!gear) return null;
      inp.startGear = gear;
      if (!Array.isArray(inp.events)) return null;
    }

    return anyParsed as ReplayBundleV2;
  }

  if (anyParsed.v === 1) {
    if (typeof anyParsed.seed !== "string" || typeof anyParsed.trackDef !== "string") return null;
    if (typeof anyParsed.sampleHz !== "number" || !Number.isFinite(anyParsed.sampleHz) || anyParsed.sampleHz <= 0) return null;
    if (!Array.isArray(anyParsed.frames)) return null;
    const v1 = anyParsed as ReplayRecordingV1;
    return {
      v: 2,
      createdAtMs: v1.createdAtMs,
      seed: v1.seed,
      trackDef: v1.trackDef,
      state: { sampleHz: v1.sampleHz, frames: v1.frames },
      inputs: null
    };
  }

  return null;
}

export function importReplayFromJsonText(text: string):
  | { ok: true; rec: ReplayBundleV2 }
  | { ok: false; error: string } {
  try {
    const parsed: any = JSON.parse(text);
    const rec = parseReplayBundle(parsed);
    if (!rec) return { ok: false, error: "Invalid replay file." };
    return { ok: true, rec };
  } catch {
    return { ok: false, error: "Could not parse JSON." };
  }
}
