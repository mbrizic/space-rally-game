import { describe, expect, it } from "vitest";
import { createCarState, defaultCarParams, stepCar } from "./car";

describe("car physics sanity", () => {
  it("turns a tighter arc under power than the previous steering tuning", () => {
    const current = defaultCarParams();
    const previous = { ...current, maxSteerRad: 1.12, maxSteerRateRadS: 8.5, engineForceN: 30500, torqueCutOnSteer01: 0.32, frontFxLimitAtFullSteer01: 0.72, aligningYawDampingNmPerRadS: 1000 };
    for (const steer of [-0.6, 0.6, 1]) {
      for (const frictionMu of [0.9, 1.1]) {
        const curvature = (params: typeof current): number => {
          let state = { ...createCarState(), vxMS: 16 };
          let distanceM = 0;
          for (let tick = 0; tick < 180; tick++) {
            const next = stepCar(state, params, { steer, throttle: 1, brake: 0, handbrake: 0 }, 1 / 120, { frictionMu }).state;
            distanceM += Math.hypot(next.xM - state.xM, next.yM - state.yM);
            state = next;
          }
          return Math.abs(state.headingRad) / distanceM;
        };
        const before = curvature(previous);
        const after = curvature(current);
        console.log(`Steering ${steer}, grip ${frictionMu}: curvature ratio ${(after / before).toFixed(3)}`);
        expect(after).toBeGreaterThan(before * 1.02);
        expect(after).toBeLessThan(before * 3);
      }
    }
  });

  it("makes steering slightly quicker without removing the speed-dependent limit", () => {
    const params = defaultCarParams();
    const previous = { ...params, maxSteerRad: 1.0, maxSteerRateRadS: 8.0 };
    const controls = { steer: 0.5, throttle: 0, brake: 0, handbrake: 0 };
    const state = { ...createCarState(), vxMS: 8 };
    const next = stepCar(state, params, controls, 1 / 120).state;
    const baseline = stepCar(state, previous, controls, 1 / 120).state;
    expect(next.steerAngleRad).toBeGreaterThan(baseline.steerAngleRad);
    expect(next.steerAngleRad).toBeLessThan(baseline.steerAngleRad * 1.1);
    const lowSpeed = stepCar(createCarState(), params, { ...controls, steer: 1 }, 0.2).state;
    const highSpeed = stepCar({ ...createCarState(), vxMS: 30 }, params, { ...controls, steer: 1 }, 0.2).state;
    expect(lowSpeed.steerAngleRad).toBeCloseTo(1.15);
    expect(highSpeed.steerAngleRad).toBeCloseTo(1.15 * 0.38);
  });

  it("adds engine acceleration when tire grip is available", () => {
    const current = defaultCarParams();
    const previous = { ...current, engineForceN: 30500 };
    const state = { ...createCarState(), vxMS: 5 };
    const controls = { steer: 0, throttle: 0.2, brake: 0, handbrake: 0 };
    const after = stepCar(state, current, controls, 1 / 120).state.vxMS - state.vxMS;
    const before = stepCar(state, previous, controls, 1 / 120).state.vxMS - state.vxMS;
    expect(after).toBeGreaterThan(before * 1.15);
    expect(after).toBeLessThan(before * 1.25);
  });

  it("does not generate NaNs", () => {
    const params = defaultCarParams();
    const state = createCarState();
    const { state: next, telemetry } = stepCar(state, params, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }, 1 / 120);

    const values = [
      next.xM,
      next.yM,
      next.headingRad,
      next.vxMS,
      next.vyMS,
      next.yawRateRadS,
      telemetry.lateralForceFrontN,
      telemetry.lateralForceRearN
    ];
    for (const v of values) expect(Number.isFinite(v)).toBe(true);
  });

  it("stops yawing at low speed with no inputs", () => {
    const params = defaultCarParams();
    const state = createCarState();
    state.vxMS = 0.2;
    state.vyMS = 0;
    state.yawRateRadS = 4;
    state.steerAngleRad = 0;

    let cur = state;
    for (let i = 0; i < 240; i++) {
      cur = stepCar(cur, params, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }, 1 / 120).state;
    }

    expect(Math.abs(cur.yawRateRadS)).toBeLessThan(0.3);
    expect(Math.hypot(cur.vxMS, cur.vyMS)).toBeLessThan(0.6);
  });

  it("does not spin up from rest when only steering", () => {
    const params = defaultCarParams();
    const state = createCarState();

    let cur = state;
    for (let i = 0; i < 120; i++) {
      cur = stepCar(cur, params, { steer: 1, throttle: 0, brake: 0, handbrake: 0 }, 1 / 120).state;
    }

    expect(Math.abs(cur.yawRateRadS)).toBeLessThan(0.05);
    expect(Math.hypot(cur.vxMS, cur.vyMS)).toBeLessThan(0.05);
  });

  it("does not slide sideways at rest when steering", () => {
    const params = defaultCarParams();
    const state = createCarState();
    state.vxMS = 0;
    state.vyMS = 0;
    state.yawRateRadS = 0;
    state.steerAngleRad = 0;

    let cur = state;
    for (let i = 0; i < 240; i++) {
      cur = stepCar(cur, params, { steer: -1, throttle: 0, brake: 0, handbrake: 0 }, 1 / 120).state;
    }

    expect(Math.hypot(cur.vxMS, cur.vyMS)).toBeLessThan(1e-3);
    expect(Math.abs(cur.xM)).toBeLessThan(1e-3);
    expect(Math.abs(cur.yM)).toBeLessThan(1e-3);
  });

  it("coasts down without growing yaw at speed", () => {
    const params = defaultCarParams();
    const state = createCarState();
    state.vxMS = 20;
    state.vyMS = 0.8;
    state.yawRateRadS = 1.0;
    state.steerAngleRad = 0;

    let cur = state;
    for (let i = 0; i < 240; i++) {
      cur = stepCar(
        cur,
        params,
        { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
        1 / 120,
        { frictionMu: 1.02, rollingResistanceN: 260, aeroDragNPerMS2: 10 }
      ).state;
    }

    expect(Math.abs(cur.yawRateRadS)).toBeLessThan(0.7);
    expect(Math.abs(cur.vyMS)).toBeLessThan(0.7);
  });

  it("turns under full throttle (tarmac)", () => {
    const params = defaultCarParams();
    const env = { frictionMu: 1.10, rollingResistanceN: 260, aeroDragNPerMS2: 10 };
    const dt = 1 / 120;

    // Warm up to a meaningful speed, then check if we can still arc under full throttle.
    let warm = createCarState();
    for (let i = 0; i < 240; i++) {
      warm = stepCar(warm, params, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, dt, env).state;
    }
    const warmSpeed = Math.hypot(warm.vxMS, warm.vyMS);
    expect(warmSpeed).toBeGreaterThan(7);

    const runTurnPhase = (steer: number) => {
      let cur = warm;
      let maxAbsYDelta = 0;
      const y0 = warm.yM;
      for (let i = 0; i < 240; i++) {
        cur = stepCar(cur, params, { steer, throttle: 1, brake: 0, handbrake: 0 }, dt, env).state;
        maxAbsYDelta = Math.max(maxAbsYDelta, Math.abs(cur.yM - y0));
      }
      return { cur, maxAbsYDelta };
    };

    const straight = runTurnPhase(0);
    const turning = runTurnPhase(1);

    expect(straight.maxAbsYDelta).toBeLessThan(1.0);
    expect(turning.maxAbsYDelta).toBeGreaterThan(6.0);
  });
});
