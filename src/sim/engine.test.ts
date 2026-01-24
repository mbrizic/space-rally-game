import { describe, expect, it } from "vitest";
import {
  createEngineState,
  defaultEngineParams,
  stepEngine,
  samplePowerCurve,
  rpmFraction,
} from "./engine";

describe("engine simulation", () => {
  it("idles at idle RPM with no throttle", () => {
    const params = defaultEngineParams();
    let state = createEngineState();

    // Run for 2 seconds
    for (let i = 0; i < 120; i++) {
      const result = stepEngine(state, params, { throttle: 0, speedMS: 0 }, 1 / 60);
      state = result.state;
    }

    expect(state.rpm).toBeCloseTo(params.idleRpm, 10);
  });

  it("increases RPM with throttle", () => {
    const params = defaultEngineParams();
    let state = createEngineState();
    const startRpm = state.rpm;

    // Apply throttle
    const result = stepEngine(state, params, { throttle: 1, speedMS: 0 }, 1 / 60);
    state = result.state;

    expect(state.rpm).toBeGreaterThan(startRpm);
  });

  it("does not exceed max RPM", () => {
    const params = defaultEngineParams();
    let state = createEngineState();

    // Run at full throttle for 10 seconds
    for (let i = 0; i < 600; i++) {
      const result = stepEngine(state, params, { throttle: 1, speedMS: 0 }, 1 / 60);
      state = result.state;
    }

    expect(state.rpm).toBeLessThanOrEqual(params.maxRpm);
  });

  it("shifts up when approaching redline", () => {
    const params = defaultEngineParams();
    let state = createEngineState();

    // Run at full throttle with increasing speed
    for (let i = 0; i < 300; i++) {
      const speedMS = i * 0.1; // Gradually increasing speed
      const result = stepEngine(state, params, { throttle: 1, speedMS }, 1 / 60);
      state = result.state;
    }

    expect(state.gear).toBeGreaterThan(1);
  });

  it("shifts down when RPM is too low", () => {
    const params = defaultEngineParams();
    let state = createEngineState();
    state.gear = 3;
    state.rpm = params.idleRpm * 2;

    // Run at low throttle with low speed
    const result = stepEngine(state, params, { throttle: 0.1, speedMS: 2.5 }, 1 / 60);

    expect(result.state.gear).toBeLessThanOrEqual(state.gear);
  });

  it("does not produce NaN values", () => {
    const params = defaultEngineParams();
    let state = createEngineState();

    // Test various scenarios
    const scenarios = [
      { throttle: 0, speedMS: 0 },
      { throttle: 1, speedMS: 0 },
      { throttle: 0.5, speedMS: 10 },
      { throttle: 1, speedMS: 50 },
      { throttle: 0, speedMS: 30 },
    ];

    for (const inputs of scenarios) {
      const result = stepEngine(state, params, inputs, 1 / 60);
      state = result.state;

      expect(Number.isFinite(state.rpm)).toBe(true);
      expect(Number.isFinite(state.gear)).toBe(true);
      expect(Number.isFinite(result.powerMultiplier)).toBe(true);
      expect(Number.isFinite(result.torqueScale)).toBe(true);
    }
  });

  it("power curve samples correctly at all RPMs", () => {
    const params = defaultEngineParams();

    // Test at curve points
    for (const [rpm, expectedPower] of params.powerCurve) {
      const power = samplePowerCurve(params, rpm);
      expect(power).toBeCloseTo(expectedPower, 2);
    }

    // Test interpolation between points
    const power = samplePowerCurve(params, 4000);
    expect(power).toBeGreaterThan(0.65);
    expect(power).toBeLessThan(0.85);
  });

  it("handles extreme RPM values gracefully", () => {
    const params = defaultEngineParams();

    // Below minimum
    expect(samplePowerCurve(params, 0)).toBe(params.powerCurve[0][1]);

    // Above maximum
    expect(samplePowerCurve(params, 10000)).toBe(params.powerCurve[params.powerCurve.length - 1][1]);
  });

  it("rpmFraction is normalized correctly", () => {
    const params = defaultEngineParams();
    
    const idleState = createEngineState();
    idleState.rpm = params.idleRpm;
    expect(rpmFraction(idleState, params)).toBeCloseTo(0, 2);

    const redlineState = createEngineState();
    redlineState.rpm = params.redlineRpm;
    expect(rpmFraction(redlineState, params)).toBeCloseTo(1, 2);

    const midState = createEngineState();
    midState.rpm = (params.idleRpm + params.redlineRpm) / 2;
    expect(rpmFraction(midState, params)).toBeCloseTo(0.5, 2);
  });

  it("handles edge case where idle equals redline (defensive)", () => {
    const params = defaultEngineParams();
    params.idleRpm = 5000;
    params.redlineRpm = 5000;

    const state = createEngineState();
    state.rpm = 5000;

    // Should not crash or produce NaN (fixed to return 0 when range is 0)
    const fraction = rpmFraction(state, params);
    expect(Number.isFinite(fraction)).toBe(true);
    expect(fraction).toBe(0);
  });

  it("torque scale is higher in lower gears", () => {
    const params = defaultEngineParams();
    let state1 = createEngineState();
    state1.gear = 1;

    let state6 = createEngineState();
    state6.gear = 6;

    const result1 = stepEngine(state1, params, { throttle: 0.5, speedMS: 5 }, 1 / 60);
    const result6 = stepEngine(state6, params, { throttle: 0.5, speedMS: 20 }, 1 / 60);

    expect(result1.torqueScale).toBeGreaterThan(result6.torqueScale);
  });
});
