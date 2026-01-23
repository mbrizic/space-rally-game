import { clamp } from "../runtime/math";

export type CarParams = {
  massKg: number;
  inertiaYawKgM2: number;
  wheelbaseM: number;
  cgToFrontAxleM: number;
  cgToRearAxleM: number;
  cgHeightM: number;
  corneringStiffnessFrontNPerRad: number;
  corneringStiffnessRearNPerRad: number;
  frictionMu: number;
  maxSteerRad: number;
  engineForceN: number;
  engineFadeSpeedMS: number;
  brakeForceN: number;
  handbrakeForceN: number;
  handbrakeRearGripScale: number; // 0..1 (lower = more slide)
  driveBiasFront: number; // 0 = RWD, 1 = FWD
  brakeBiasFront: number; // 0 = rear-only, 1 = front-only
  relaxationLengthFrontM: number;
  relaxationLengthRearM: number;
  rollingResistanceN: number;
  aeroDragNPerMS2: number;
};

export type CarControls = {
  steer: number; // [-1..1]
  throttle: number; // [0..1]
  brake: number; // [0..1]
  handbrake: number; // [0..1]
};

export type CarState = {
  xM: number;
  yM: number;
  headingRad: number;

  // Body-frame velocities.
  vxMS: number;
  vyMS: number;

  yawRateRadS: number;

  // Tire slip angle state (relaxation).
  alphaFrontRad: number;
  alphaRearRad: number;
};

export type CarTelemetry = {
  steerAngleRad: number;
  slipAngleFrontInstantRad: number;
  slipAngleRearInstantRad: number;
  slipAngleFrontRad: number;
  slipAngleRearRad: number;
  longitudinalForceFrontN: number;
  longitudinalForceRearN: number;
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
    cgHeightM: 0.62,
    corneringStiffnessFrontNPerRad: 70000,
    corneringStiffnessRearNPerRad: 80000,
    frictionMu: 1.05,
    maxSteerRad: 0.62,
    engineForceN: 14000,
    engineFadeSpeedMS: 33,
    brakeForceN: 19000,
    handbrakeForceN: 9000,
    handbrakeRearGripScale: 0.32,
    driveBiasFront: 0.48,
    brakeBiasFront: 0.65,
    relaxationLengthFrontM: 7.5,
    relaxationLengthRearM: 9.5,
    rollingResistanceN: 260,
    aeroDragNPerMS2: 10
  };
}

export function createCarState(): CarState {
  return {
    xM: 0,
    yM: 0,
    headingRad: 0,
    vxMS: 0,
    vyMS: 0,
    yawRateRadS: 0,
    alphaFrontRad: 0,
    alphaRearRad: 0
  };
}

export function stepCar(
  state: CarState,
  params: CarParams,
  controls: CarControls,
  dtSeconds: number,
  environment?: { frictionMu?: number; rollingResistanceN?: number; aeroDragNPerMS2?: number }
): { state: CarState; telemetry: CarTelemetry } {
  const steerInput = clamp(controls.steer, -1, 1);
  const throttle = clamp(controls.throttle, 0, 1);
  const brake = clamp(controls.brake, 0, 1);
  const handbrake = clamp(controls.handbrake, 0, 1);

  const speedMS = Math.hypot(state.vxMS, state.vyMS);
  const steerLimiter = clamp(1 - speedMS * 0.03, 0.25, 1);
  const steerAngleRad = steerInput * params.maxSteerRad * steerLimiter;

  const g = 9.81;
  const weightN = params.massKg * g;
  const normalLoadFrontStaticN = (weightN * params.cgToRearAxleM) / params.wheelbaseM;
  const normalLoadRearStaticN = (weightN * params.cgToFrontAxleM) / params.wheelbaseM;

  const vx = Math.max(0.25, state.vxMS);
  const vy = state.vyMS;
  const r = state.yawRateRadS;
  const a = params.cgToFrontAxleM;
  const b = params.cgToRearAxleM;

  // Longitudinal forces (requested).
  const engineFade = clamp(1 - speedMS / Math.max(1, params.engineFadeSpeedMS), 0.35, 1);
  const driveTotalN = throttle * params.engineForceN * engineFade;
  const brakeTotalN = brake * params.brakeForceN;

  const rollingResistanceN = environment?.rollingResistanceN ?? params.rollingResistanceN;
  const aeroDragNPerMS2 = environment?.aeroDragNPerMS2 ?? params.aeroDragNPerMS2;
  const resistN = rollingResistanceN + aeroDragNPerMS2 * speedMS * speedMS;

  const driveFrontN = driveTotalN * clamp(params.driveBiasFront, 0, 1);
  const driveRearN = driveTotalN - driveFrontN;

  const brakeFrontN = brakeTotalN * clamp(params.brakeBiasFront, 0, 1);
  const brakeRearN = brakeTotalN - brakeFrontN + handbrake * params.handbrakeForceN;

  const resistFrontN = resistN * (normalLoadFrontStaticN / weightN);
  const resistRearN = resistN - resistFrontN;

  const fxFrontRequestN = driveFrontN - brakeFrontN - resistFrontN;
  const fxRearRequestN = driveRearN - brakeRearN - resistRearN;

  // Weight transfer approximation from longitudinal accel (positive = accelerating).
  const axApproxMS2 = (fxFrontRequestN + fxRearRequestN) / params.massKg;
  const loadTransferN = (params.massKg * axApproxMS2 * params.cgHeightM) / params.wheelbaseM;
  const normalLoadFrontN = clamp(normalLoadFrontStaticN - loadTransferN, 0.15 * weightN, 0.85 * weightN);
  const normalLoadRearN = clamp(normalLoadRearStaticN + loadTransferN, 0.15 * weightN, 0.85 * weightN);

  // Slip angles (instantaneous).
  const slipAngleFrontInstantRad = Math.atan2(vy + a * r, vx) - steerAngleRad;
  const slipAngleRearInstantRad = Math.atan2(vy - b * r, vx);

  // Tire relaxation (first-order lag based on distance traveled).
  const relaxKFront = vx / Math.max(0.5, params.relaxationLengthFrontM);
  const relaxKRear = vx / Math.max(0.5, params.relaxationLengthRearM);
  const blendFront = 1 - Math.exp(-relaxKFront * dtSeconds);
  const blendRear = 1 - Math.exp(-relaxKRear * dtSeconds);

  const alphaFrontRad = state.alphaFrontRad + (slipAngleFrontInstantRad - state.alphaFrontRad) * clamp(blendFront, 0, 1);
  const alphaRearRad = state.alphaRearRad + (slipAngleRearInstantRad - state.alphaRearRad) * clamp(blendRear, 0, 1);

  // Traction circle per axle: Fx steals available Fy.
  const frictionMu = environment?.frictionMu ?? params.frictionMu;
  const maxFFront = frictionMu * normalLoadFrontN;
  const maxFRear = frictionMu * normalLoadRearN;

  const longitudinalForceFrontN = clamp(fxFrontRequestN, -maxFFront, maxFFront);
  const longitudinalForceRearN = clamp(fxRearRequestN, -maxFRear, maxFRear);

  const lateralCapFrontN = Math.sqrt(Math.max(0, maxFFront * maxFFront - longitudinalForceFrontN * longitudinalForceFrontN));
  const lateralCapRearBaseN = Math.sqrt(Math.max(0, maxFRear * maxFRear - longitudinalForceRearN * longitudinalForceRearN));
  const rearGripScale = lerp(1, clamp(params.handbrakeRearGripScale, 0.05, 1), handbrake);
  const lateralCapRearN = lateralCapRearBaseN * rearGripScale;

  const lateralForceFrontN = clamp(
    -params.corneringStiffnessFrontNPerRad * alphaFrontRad,
    -lateralCapFrontN,
    lateralCapFrontN
  );
  const lateralForceRearN = clamp(
    -params.corneringStiffnessRearNPerRad * rearGripScale * alphaRearRad,
    -lateralCapRearN,
    lateralCapRearN
  );

  // Bicycle model equations in body frame.
  const m = params.massKg;
  const iz = params.inertiaYawKgM2;

  const cosSteer = Math.cos(steerAngleRad);
  const sinSteer = Math.sin(steerAngleRad);

  const fxBodyN = longitudinalForceRearN + longitudinalForceFrontN * cosSteer - lateralForceFrontN * sinSteer;
  const fyBodyN = lateralForceRearN + lateralForceFrontN * cosSteer + longitudinalForceFrontN * sinSteer;

  const dvx = fxBodyN / m + vy * r;
  const dvy = fyBodyN / m - vx * r;
  const dr = (a * (lateralForceFrontN * cosSteer + longitudinalForceFrontN * sinSteer) - b * lateralForceRearN) / iz;

  const nextVx = Math.max(0, state.vxMS + dvx * dtSeconds);
  const nextVy = state.vyMS + dvy * dtSeconds;
  const nextR = state.yawRateRadS + dr * dtSeconds;

  const nextHeading = state.headingRad + nextR * dtSeconds;

  const midHeading = state.headingRad + nextR * dtSeconds * 0.5;
  const cosH = Math.cos(midHeading);
  const sinH = Math.sin(midHeading);
  const xDot = nextVx * cosH - nextVy * sinH;
  const yDot = nextVx * sinH + nextVy * cosH;

  const nextState: CarState = {
    xM: state.xM + xDot * dtSeconds,
    yM: state.yM + yDot * dtSeconds,
    headingRad: nextHeading,
    vxMS: nextVx,
    vyMS: nextVy,
    yawRateRadS: nextR,
    alphaFrontRad,
    alphaRearRad
  };

  return {
    state: nextState,
    telemetry: {
      steerAngleRad,
      slipAngleFrontInstantRad,
      slipAngleRearInstantRad,
      slipAngleFrontRad: alphaFrontRad,
      slipAngleRearRad: alphaRearRad,
      longitudinalForceFrontN,
      longitudinalForceRearN,
      lateralForceFrontN,
      lateralForceRearN,
      normalLoadFrontN,
      normalLoadRearN
    }
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
