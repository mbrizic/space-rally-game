import { clamp } from "../runtime/math";

export type CarParams = {
  massKg: number;
  inertiaYawKgM2: number;
  wheelbaseM: number;
  cgToFrontAxleM: number;
  cgToRearAxleM: number;
  corneringStiffnessFrontNPerRad: number;
  corneringStiffnessRearNPerRad: number;
  frictionMu: number;
  maxSteerRad: number;
  engineForceN: number;
  brakeForceN: number;
  rollingResistanceN: number;
  aeroDragNPerMS2: number;
};

export type CarControls = {
  steer: number; // [-1..1]
  throttle: number; // [0..1]
  brake: number; // [0..1]
};

export type CarState = {
  xM: number;
  yM: number;
  headingRad: number;

  // Body-frame velocities.
  vxMS: number;
  vyMS: number;

  yawRateRadS: number;
};

export type CarTelemetry = {
  steerAngleRad: number;
  slipAngleFrontRad: number;
  slipAngleRearRad: number;
  lateralForceFrontN: number;
  lateralForceRearN: number;
  normalLoadFrontN: number;
  normalLoadRearN: number;
};

export function defaultCarParams(): CarParams {
  const wheelbaseM = 2.6;
  const cgToFrontAxleM = 1.1;
  const cgToRearAxleM = wheelbaseM - cgToFrontAxleM;
  return {
    massKg: 1200,
    inertiaYawKgM2: 1650,
    wheelbaseM,
    cgToFrontAxleM,
    cgToRearAxleM,
    corneringStiffnessFrontNPerRad: 70000,
    corneringStiffnessRearNPerRad: 80000,
    frictionMu: 1.05,
    maxSteerRad: 0.62,
    engineForceN: 8200,
    brakeForceN: 14000,
    rollingResistanceN: 260,
    aeroDragNPerMS2: 24
  };
}

export function createCarState(): CarState {
  return {
    xM: 0,
    yM: 0,
    headingRad: 0,
    vxMS: 0,
    vyMS: 0,
    yawRateRadS: 0
  };
}

export function stepCar(
  state: CarState,
  params: CarParams,
  controls: CarControls,
  dtSeconds: number
): { state: CarState; telemetry: CarTelemetry } {
  const steerInput = clamp(controls.steer, -1, 1);
  const throttle = clamp(controls.throttle, 0, 1);
  const brake = clamp(controls.brake, 0, 1);

  const speedMS = Math.hypot(state.vxMS, state.vyMS);
  const steerLimiter = clamp(1 - speedMS * 0.03, 0.25, 1);
  const steerAngleRad = steerInput * params.maxSteerRad * steerLimiter;

  const g = 9.81;
  const weightN = params.massKg * g;
  const normalLoadFrontN = (weightN * params.cgToRearAxleM) / params.wheelbaseM;
  const normalLoadRearN = (weightN * params.cgToFrontAxleM) / params.wheelbaseM;

  const vx = Math.max(0.25, state.vxMS);
  const vy = state.vyMS;
  const r = state.yawRateRadS;
  const a = params.cgToFrontAxleM;
  const b = params.cgToRearAxleM;

  // Slip angles.
  const slipAngleFrontRad = Math.atan2(vy + a * r, vx) - steerAngleRad;
  const slipAngleRearRad = Math.atan2(vy - b * r, vx);

  // Lateral tire forces (linear w/ saturation).
  const maxFyFront = params.frictionMu * normalLoadFrontN;
  const maxFyRear = params.frictionMu * normalLoadRearN;

  const lateralForceFrontN = clamp(
    -params.corneringStiffnessFrontNPerRad * slipAngleFrontRad,
    -maxFyFront,
    maxFyFront
  );
  const lateralForceRearN = clamp(
    -params.corneringStiffnessRearNPerRad * slipAngleRearRad,
    -maxFyRear,
    maxFyRear
  );

  // Longitudinal force: engine at rear, brakes oppose motion.
  const driveN = throttle * params.engineForceN;
  const brakingN = brake * params.brakeForceN;
  const resistN = params.rollingResistanceN + params.aeroDragNPerMS2 * speedMS * speedMS;
  const longForceN = driveN - brakingN - resistN;

  // Bicycle model equations in body frame.
  const m = params.massKg;
  const iz = params.inertiaYawKgM2;

  const dvx = (longForceN - lateralForceFrontN * Math.sin(steerAngleRad)) / m + vy * r;
  const dvy = (lateralForceRearN + lateralForceFrontN * Math.cos(steerAngleRad)) / m - vx * r;
  const dr =
    (a * lateralForceFrontN * Math.cos(steerAngleRad) - b * lateralForceRearN) / iz;

  const nextVx = Math.max(0, state.vxMS + dvx * dtSeconds);
  const nextVy = state.vyMS + dvy * dtSeconds;
  const nextR = state.yawRateRadS + dr * dtSeconds;

  const nextHeading = state.headingRad + nextR * dtSeconds;

  const cosH = Math.cos(state.headingRad);
  const sinH = Math.sin(state.headingRad);
  const xDot = nextVx * cosH - nextVy * sinH;
  const yDot = nextVx * sinH + nextVy * cosH;

  const nextState: CarState = {
    xM: state.xM + xDot * dtSeconds,
    yM: state.yM + yDot * dtSeconds,
    headingRad: nextHeading,
    vxMS: nextVx,
    vyMS: nextVy,
    yawRateRadS: nextR
  };

  return {
    state: nextState,
    telemetry: {
      steerAngleRad,
      slipAngleFrontRad,
      slipAngleRearRad,
      lateralForceFrontN,
      lateralForceRearN,
      normalLoadFrontN,
      normalLoadRearN
    }
  };
}

