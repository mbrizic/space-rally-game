import { describe, expect, it } from "vitest";
import { DriftDetector, DriftState } from "./drift";
import { createCarState, defaultCarParams, stepCar } from "./car";

describe("drift detection", () => {
  it("detects no drift when driving straight", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 15;

    // Drive straight
    for (let i = 0; i < 60; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 0, throttle: 0.5, brake: 0, handbrake: 0 },
        1 / 60
      );
      state = nextState;

      const driftInfo = detector.detect(telemetry, Math.hypot(state.vxMS, state.vyMS), i / 60);

      expect(driftInfo.state).toBe(DriftState.NO_DRIFT);
      expect(driftInfo.intensity).toBe(0);
    }
  });

  it("handles aggressive maneuvers without crashing", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 20; // Higher initial speed

    // Aggressive handbrake turn
    for (let i = 0; i < 120; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 0.8, throttle: 0.4, brake: 0, handbrake: 0.8 },
        1 / 60
      );
      state = nextState;

      const speed = Math.hypot(state.vxMS, state.vyMS);
      const driftInfo = detector.detect(telemetry, speed, i / 60);

      // Should not produce NaN or invalid values
      expect(Number.isFinite(driftInfo.intensity)).toBe(true);
      expect(Number.isFinite(driftInfo.score)).toBe(true);
      expect(Number.isFinite(driftInfo.duration)).toBe(true);

      // Intensity should be bounded
      expect(driftInfo.intensity).toBeGreaterThanOrEqual(0);
      expect(driftInfo.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("accumulates score during sustained drift", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 15;

    let maxScore = 0;

    // Sustained drift
    for (let i = 0; i < 120; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 0.8, throttle: 0.5, brake: 0, handbrake: 0.5 },
        1 / 60
      );
      state = nextState;

      const driftInfo = detector.detect(telemetry, Math.hypot(state.vxMS, state.vyMS), i / 60);
      maxScore = Math.max(maxScore, driftInfo.score);
    }

    expect(maxScore).toBeGreaterThan(0);
  });

  it("resets properly after reset() call", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 15;

    // Create some drift
    for (let i = 0; i < 30; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 1, throttle: 0.3, brake: 0, handbrake: 1 },
        1 / 60
      );
      state = nextState;
      detector.detect(telemetry, Math.hypot(state.vxMS, state.vyMS), i / 60);
    }

    // Reset
    detector.reset();

    // Check clean state
    state = createCarState();
    state.vxMS = 15;

    const { telemetry } = stepCar(state, params, { steer: 0, throttle: 0.5, brake: 0, handbrake: 0 }, 1 / 60);
    const driftInfo = detector.detect(telemetry, 15, 10);

    expect(driftInfo.state).toBe(DriftState.NO_DRIFT);
    expect(driftInfo.score).toBe(0);
  });

  it("intensity is bounded between 0 and 1", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 20;

    for (let i = 0; i < 120; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 1, throttle: 1, brake: 0, handbrake: 1 },
        1 / 60
      );
      state = nextState;

      const driftInfo = detector.detect(telemetry, Math.hypot(state.vxMS, state.vyMS), i / 60);

      expect(driftInfo.intensity).toBeGreaterThanOrEqual(0);
      expect(driftInfo.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("does not detect drift at very low speeds", () => {
    const detector = new DriftDetector();
    const params = defaultCarParams();
    let state = createCarState();
    state.vxMS = 2; // Very low speed

    for (let i = 0; i < 60; i++) {
      const { state: nextState, telemetry } = stepCar(
        state,
        params,
        { steer: 1, throttle: 0, brake: 0, handbrake: 1 },
        1 / 60
      );
      state = nextState;

      const driftInfo = detector.detect(telemetry, Math.hypot(state.vxMS, state.vyMS), i / 60);

      // Should not register significant drift at very low speed
      expect(driftInfo.intensity).toBeLessThan(0.3);
    }
  });
});
