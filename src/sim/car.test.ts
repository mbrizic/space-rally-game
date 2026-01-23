import { describe, expect, it } from "vitest";
import { createCarState, defaultCarParams, stepCar } from "./car";

describe("car physics sanity", () => {
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
    const state = createCarState();

    let cur = state;
    for (let i = 0; i < 360; i++) {
      cur = stepCar(
        cur,
        params,
        { steer: 1, throttle: 1, brake: 0, handbrake: 0 },
        1 / 120,
        { frictionMu: 1.02, rollingResistanceN: 260, aeroDragNPerMS2: 10 }
      ).state;
    }

    // Under full throttle + full steer, we should still arc noticeably (not go nearly straight).
    expect(cur.headingRad).toBeGreaterThan(0.25);
    expect(cur.yM).toBeGreaterThan(2.0);
  });
});
