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
  maxSteerRateRadS: number;
  engineForceN: number;
  engineFadeSpeedMS: number;
  brakeForceN: number;
  handbrakeForceN: number;
  handbrakeRearGripScale: number; // 0..1 (lower = more slide)
  driveBiasFront: number; // 0 = RWD, 1 = FWD
  brakeBiasFront: number; // 0 = rear-only, 1 = front-only
  relaxationLengthFrontM: number;
  relaxationLengthRearM: number;
  lowSpeedForceFadeMS: number;
  yawDampingPerS: number;
  lateralDampingPerS: number;
  yawDampingHighSpeedPerS: number;
  lateralDampingHighSpeedPerS: number;
  rollingResistanceN: number;
  aeroDragNPerMS2: number;
  maxReverseSpeedMS: number;
  reverseEngineScale: number;
  torqueCutOnSteer01: number; // 0..1, reduces drive when steering
  tractionEllipseP: number; // >= 1 (lower => less understeer under power)
  frontFxLimitAtFullSteer01: number; // 0..1, reserve lateral grip on steer (assist)
  aligningYawDampingNmPerRadS: number;
  aligningYawDampingSpeedMS: number;
};

export type CarControls = {
  steer: number; // [-1..1]
  throttle: number; // [-1..1] (reverse allowed)
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

  // Actual steer angle state (rate-limited).
  steerAngleRad: number;

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
  wheelspinIntensity: number; // 0..1, how much wheels are spinning beyond grip
};

export function defaultCarParams(): CarParams {
  const wheelbaseM = 2.6;
  const cgToFrontAxleM = 1.1;
  const cgToRearAxleM = wheelbaseM - cgToFrontAxleM;
  return {
    massKg: 1080,
    inertiaYawKgM2: 1350,
    wheelbaseM,
    cgToFrontAxleM,
    cgToRearAxleM,
    cgHeightM: 0.55,
    corneringStiffnessFrontNPerRad: 105000,
    corneringStiffnessRearNPerRad: 98000,
    frictionMu: 1.22,
    maxSteerRad: 1.0,
    maxSteerRateRadS: 7.5,
    engineForceN: 32000,
    engineFadeSpeedMS: 58,
    brakeForceN: 42000,
    handbrakeForceN: 16000,
    handbrakeRearGripScale: 0.55,
    driveBiasFront: 0.35, // 35% front (default)
    brakeBiasFront: 0.65,
    // Shorter relaxation => less "springy" snap, still enough transient for flicks.
    relaxationLengthFrontM: 0.7,
    relaxationLengthRearM: 0.9,
    lowSpeedForceFadeMS: 1.2,
    yawDampingPerS: 2.0,
    lateralDampingPerS: 1.1,
    // Keep any additional damping as "assist" (handled via UI later); defaults off.
    yawDampingHighSpeedPerS: 0,
    lateralDampingHighSpeedPerS: 0,
    rollingResistanceN: 260,
    aeroDragNPerMS2: 10,
    maxReverseSpeedMS: 12,
    reverseEngineScale: 2.2,
    // Key to "steering with pedals": under power we lose some steering, but not all.
    // This also prevents full-throttle from consuming *all* front capacity on a FWD car.
    torqueCutOnSteer01: 0.32,
    tractionEllipseP: 5.5,
    frontFxLimitAtFullSteer01: 0.72,
    aligningYawDampingNmPerRadS: 1200,
    aligningYawDampingSpeedMS: 3.5
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
    steerAngleRad: 0,
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
  const surfaceMu = environment?.frictionMu ?? params.frictionMu;

  const steerInput = clamp(controls.steer, -1, 1);
  const throttle = clamp(controls.throttle, -1, 1);
  const brake = clamp(controls.brake, 0, 1);
  const handbrake = clamp(controls.handbrake, 0, 1);

  const speedMS = Math.hypot(state.vxMS, state.vyMS);
  // Steering limit should follow momentum (speed), not throttle. Keep full steering at low speed
  // (e.g. launch) and reduce only after we're moving quickly.
  const steerLimiter = lerp(1, 0.38, clamp((speedMS - 5) / 20, 0, 1));
  const steerCmdRad = steerInput * params.maxSteerRad * steerLimiter;
  const maxDeltaSteer = Math.max(0.1, params.maxSteerRateRadS) * dtSeconds;
  const steerAngleRad = state.steerAngleRad + clamp(steerCmdRad - state.steerAngleRad, -maxDeltaSteer, maxDeltaSteer);

  const g = 9.81;
  const weightN = params.massKg * g;
  const normalLoadFrontStaticN = (weightN * params.cgToRearAxleM) / params.wheelbaseM;
  const normalLoadRearStaticN = (weightN * params.cgToFrontAxleM) / params.wheelbaseM;

  const vx = state.vxMS;
  const vy = state.vyMS;
  const r = state.yawRateRadS;
  const a = params.cgToFrontAxleM;
  const b = params.cgToRearAxleM;

  // Wheel longitudinal forces (requested). Important: aero drag is NOT a tire force, so it should
  // not steal lateral capacity via the traction circle.
  const engineFade = clamp(1 - speedMS / Math.max(1, params.engineFadeSpeedMS), 0.35, 1);
  const steerFrac01 = clamp(Math.abs(steerAngleRad) / Math.max(1e-6, params.maxSteerRad), 0, 1);
  const torqueCut = 1 - clamp(params.torqueCutOnSteer01, 0, 1) * steerFrac01;
  const engineScale = throttle < 0 ? Math.max(1, params.reverseEngineScale) : 1;
  const driveTotalN = throttle * params.engineForceN * engineFade * engineScale * torqueCut;
  const brakeTotalN = brake * params.brakeForceN;

  const driveFrontN = driveTotalN * clamp(params.driveBiasFront, 0, 1);
  const driveRearN = driveTotalN - driveFrontN;

  const brakeFrontNMag = brakeTotalN * clamp(params.brakeBiasFront, 0, 1);
  const brakeRearNMag = brakeTotalN - brakeFrontNMag + handbrake * params.handbrakeForceN;

  const longDir =
    Math.abs(state.vxMS) > 0.2 ? Math.sign(state.vxMS) : throttle !== 0 ? Math.sign(throttle) : 1;
  const brakeFrontN = brakeFrontNMag * longDir;
  const brakeRearN = brakeRearNMag * longDir;

  const fxFrontRequestN = driveFrontN - brakeFrontN;
  const fxRearRequestN = driveRearN - brakeRearN;

  // External drag (applied opposite body velocity; does not affect traction circle).
  const rollingResistanceN = environment?.rollingResistanceN ?? params.rollingResistanceN;
  const aeroDragNPerMS2 = environment?.aeroDragNPerMS2 ?? params.aeroDragNPerMS2;
  const dragMagN = (rollingResistanceN + aeroDragNPerMS2 * speedMS * speedMS) * clamp(speedMS / 0.5, 0, 1);
  const dragX = speedMS > 1e-6 ? -dragMagN * (state.vxMS / speedMS) : 0;
  const dragY = speedMS > 1e-6 ? -dragMagN * (state.vyMS / speedMS) : 0;

  // Weight transfer approximation from *realized* longitudinal accel (positive = accelerating).
  // Important: using the raw requested drive force here can massively over-unload the front axle on a
  // FWD car (because the request can be far above tire limits), making the launch and turning feel wrong.
  const normalLoadsFromAx = (axMS2: number) => {
    const loadTransferN = (params.massKg * axMS2 * params.cgHeightM) / params.wheelbaseM;
    const frontN = clamp(normalLoadFrontStaticN - loadTransferN, 0.15 * weightN, 0.85 * weightN);
    const rearN = clamp(normalLoadRearStaticN + loadTransferN, 0.15 * weightN, 0.85 * weightN);
    return { frontN, rearN };
  };

  // First pass: clamp longitudinal forces with static loads, then estimate ax from that.
  const cosSteer0 = Math.cos(steerAngleRad);
  const steerFrac01_0 = steerFrac01;
  const maxFFront0 = surfaceMu * normalLoadFrontStaticN;
  const maxFRear0 = surfaceMu * normalLoadRearStaticN;
  const fxLimitFront0 =
    maxFFront0 * lerp(1, clamp(params.frontFxLimitAtFullSteer01, 0.2, 1), steerFrac01_0);
  const longFront0 = clamp(fxFrontRequestN, -fxLimitFront0, fxLimitFront0);
  const longRear0 = clamp(fxRearRequestN, -maxFRear0, maxFRear0);
  const fxLongBodyApprox0 = longRear0 + longFront0 * cosSteer0;
  const axApproxMS2 = (fxLongBodyApprox0 + dragX) / Math.max(1, params.massKg);

  const { frontN: normalLoadFrontN, rearN: normalLoadRearN } = normalLoadsFromAx(axApproxMS2);

  // Slip angles (instantaneous). At very low speed, slip is ill-defined; fade to 0.
  const slipDenom = Math.max(0.75, Math.abs(vx), speedMS);
  const slipAngleFrontInstantRad =
    speedMS < 0.4 ? 0 : Math.atan2(vy + a * r, slipDenom) - steerAngleRad;
  const slipAngleRearInstantRad = speedMS < 0.4 ? 0 : Math.atan2(vy - b * r, slipDenom);

  // Tire relaxation (first-order lag based on distance traveled). If speed is very low, we still want
  // slip to settle quickly (no "stuck" slip angle after a handbrake turn).
  const relaxSpeedMS = Math.max(speedMS, 14);
  const relaxKFront = relaxSpeedMS / Math.max(0.5, params.relaxationLengthFrontM);
  const relaxKRear = relaxSpeedMS / Math.max(0.5, params.relaxationLengthRearM);
  const blendFront = 1 - Math.exp(-relaxKFront * dtSeconds);
  const blendRear = 1 - Math.exp(-relaxKRear * dtSeconds);

  const alphaFrontRad =
    state.alphaFrontRad +
    (slipAngleFrontInstantRad - state.alphaFrontRad) * clamp(blendFront, 0, 1);
  const alphaRearRad =
    state.alphaRearRad + (slipAngleRearInstantRad - state.alphaRearRad) * clamp(blendRear, 0, 1);

  // Traction circle per axle: Fx steals available Fy.
  const maxFFront = surfaceMu * normalLoadFrontN;
  const maxFRear = surfaceMu * normalLoadRearN;

  // Assist: reserve some front tire capacity for lateral force when steering.
  const fxLimitFront =
    maxFFront *
    lerp(1, clamp(params.frontFxLimitAtFullSteer01, 0.2, 1), steerFrac01);
  const longitudinalForceFrontN = clamp(fxFrontRequestN, -fxLimitFront, fxLimitFront);
  const longitudinalForceRearN = clamp(fxRearRequestN, -maxFRear, maxFRear);

  const ellipseP = Math.max(1.05, params.tractionEllipseP);
  const lateralCapFrontN = lateralCapacity(maxFFront, longitudinalForceFrontN, ellipseP);
  const lateralCapRearBaseN = lateralCapacity(maxFRear, longitudinalForceRearN, ellipseP);
  const rearGripScale = lerp(1, clamp(params.handbrakeRearGripScale, 0.05, 1), handbrake);
  const lateralCapRearN = lateralCapRearBaseN * rearGripScale;

  const lowSpeedBase = clamp(speedMS / Math.max(0.4, params.lowSpeedForceFadeMS), 0, 1);
  const lowSpeedForceFade = lowSpeedBase * lowSpeedBase;

  const lateralForceFrontN =
    lowSpeedForceFade *
    clamp(
      -params.corneringStiffnessFrontNPerRad * alphaFrontRad,
      -lateralCapFrontN,
      lateralCapFrontN
    );
  const lateralForceRearN =
    lowSpeedForceFade *
    clamp(
      -params.corneringStiffnessRearNPerRad * rearGripScale * alphaRearRad,
      -lateralCapRearN,
      lateralCapRearN
    );

  // Bicycle model equations in body frame.
  const m = params.massKg;
  const iz = params.inertiaYawKgM2;

  const cosSteer = Math.cos(steerAngleRad);
  const sinSteer = Math.sin(steerAngleRad);

  // Resolve front wheel forces (steered) into the body frame.
  const fxBodyN =
    longitudinalForceRearN + longitudinalForceFrontN * cosSteer - lateralForceFrontN * sinSteer;
  const fyBodyN =
    lateralForceRearN + lateralForceFrontN * cosSteer + longitudinalForceFrontN * sinSteer;

  const dvx = (fxBodyN + dragX) / m + vy * r;
  const dvy = (fyBodyN + dragY) / m - vx * r;
  let dr =
    (a * (lateralForceFrontN * cosSteer + longitudinalForceFrontN * sinSteer) - b * lateralForceRearN) /
    iz;

  // Approximate pneumatic trail / aligning torque: damps yaw-rate at speed without directly
  // killing lateral velocity. This reduces post-handbrake wobble while keeping motion physical-ish.
  const alignScale = clamp(speedMS / Math.max(0.5, params.aligningYawDampingSpeedMS), 0, 1);
  const mzAlign = -state.yawRateRadS * Math.max(0, params.aligningYawDampingNmPerRadS) * alignScale;
  dr += mzAlign / iz;

  let nextVx = state.vxMS + dvx * dtSeconds;
  nextVx = clamp(nextVx, -Math.max(0.5, params.maxReverseSpeedMS), 1e9);
  const nextVy = state.vyMS + dvy * dtSeconds;
  const nextR = state.yawRateRadS + dr * dtSeconds;

  // Low-speed stability only. (Any high-speed "assist" should be optional and explicit.)
  const lowSpeedStability = clamp(1 - speedMS / 3, 0, 1);
  const yawDampingPerS = Math.max(0, params.yawDampingPerS) * lowSpeedStability;
  const lateralDampingPerS = Math.max(0, params.lateralDampingPerS) * lowSpeedStability;
  const dampYaw = Math.exp(-yawDampingPerS * dtSeconds);
  const dampLat = Math.exp(-lateralDampingPerS * dtSeconds);
  const nextVyDamped = nextVy * dampLat;
  const nextRDamped = nextR * dampYaw;

  const nextHeading = state.headingRad + nextRDamped * dtSeconds;

  const midHeading = state.headingRad + nextRDamped * dtSeconds * 0.5;
  const cosH = Math.cos(midHeading);
  const sinH = Math.sin(midHeading);
  const xDot = nextVx * cosH - nextVyDamped * sinH;
  const yDot = nextVx * sinH + nextVyDamped * cosH;

  const nextState: CarState = {
    xM: state.xM + xDot * dtSeconds,
    yM: state.yM + yDot * dtSeconds,
    headingRad: nextHeading,
    vxMS: nextVx,
    vyMS: nextVyDamped,
    yawRateRadS: nextRDamped,
    steerAngleRad,
    alphaFrontRad,
    alphaRearRad
  };

  // Calculate wheelspin intensity: when requested force exceeds available grip
  // Focus on drive wheels (mostly rear in our 30/70 split)
  // Only count positive (driving) forces, not braking
  const driveForceRequestedRear = Math.max(0, fxRearRequestN);
  const availableGripRear = maxFRear;
  const rearSpinRatio = availableGripRear > 0 ? driveForceRequestedRear / availableGripRear : 0;
  const rearExcess = Math.max(0, rearSpinRatio - 0.92); // Start showing wheelspin at 92% grip usage (higher threshold)

  const driveForceRequestedFront = Math.max(0, fxFrontRequestN);
  const availableGripFront = fxLimitFront;
  const frontSpinRatio = availableGripFront > 0 ? driveForceRequestedFront / availableGripFront : 0;
  const frontExcess = Math.max(0, frontSpinRatio - 0.92);

  // Weight rear more heavily since we're RWD-biased, reduced multiplier for subtler effect
  const wheelspinIntensity = clamp((rearExcess * 0.7 + frontExcess * 0.3) * 8, 0, 1);

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
      normalLoadRearN,
      wheelspinIntensity
    }
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lateralCapacity(maxF: number, fx: number, p: number): number {
  if (maxF <= 0) return 0;
  const x = clamp(Math.abs(fx) / maxF, 0, 1);
  const inside = 1 - Math.pow(x, p);
  return maxF * Math.pow(Math.max(0, inside), 1 / p);
}
