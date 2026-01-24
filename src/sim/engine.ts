/**
 * Engine simulation module - handles RPM, power curves, and transmission
 * Separated from car.ts for composability
 */

export type EngineParams = {
    idleRpm: number;
    redlineRpm: number;
    maxRpm: number;
    // Power curve is defined as array of [rpm, powerMultiplier] pairs
    // Interpolated between points, power = basePower * multiplier
    powerCurve: [number, number][];
    // Transmission
    gearRatios: number[]; // gear 1, 2, 3, etc. (higher = more torque, less speed)
    finalDriveRatio: number;
    // RPM behavior
    rpmGainRate: number; // how fast RPM rises under throttle
    rpmDecayRate: number; // how fast RPM falls without throttle
    clutchEngageRpm: number; // RPM at which clutch starts engaging
};

export type EngineState = {
    rpm: number;
    gear: number; // 1-indexed (1, 2, 3...)
    throttleInput: number; // 0..1
};

export function defaultEngineParams(): EngineParams {
    return {
        idleRpm: 900,
        redlineRpm: 7200,
        maxRpm: 7500,
        // Realistic power curve: weak at idle, builds to peak around 5500, drops at redline
        powerCurve: [
            [900, 0.15],    // idle - very little power
            [2000, 0.35],   // low rpm - building
            [3500, 0.65],   // mid-low - decent power
            [4500, 0.85],   // mid - strong
            [5500, 1.0],    // peak power
            [6500, 0.92],   // high - starting to drop
            [7200, 0.78],   // redline - falling off
            [7500, 0.65],   // over-rev - significant drop
        ],
        gearRatios: [3.5, 2.3, 1.7, 1.3, 1.0, 0.85], // 6 gears
        finalDriveRatio: 3.8,
        rpmGainRate: 4500, // RPM per second at full throttle (no load)
        rpmDecayRate: 3000, // RPM per second decay (no throttle)
        clutchEngageRpm: 1200,
    };
}

export function createEngineState(): EngineState {
    return {
        rpm: 900,
        gear: 1,
        throttleInput: 0,
    };
}

/**
 * Sample the power curve at a given RPM
 * Returns power multiplier 0..1
 */
export function samplePowerCurve(params: EngineParams, rpm: number): number {
    const curve = params.powerCurve;
    if (curve.length === 0) return 0.5;

    // Clamp to curve bounds
    if (rpm <= curve[0][0]) return curve[0][1];
    if (rpm >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

    // Find segment and interpolate
    for (let i = 0; i < curve.length - 1; i++) {
        const [rpm0, power0] = curve[i];
        const [rpm1, power1] = curve[i + 1];
        if (rpm >= rpm0 && rpm <= rpm1) {
            const t = (rpm - rpm0) / (rpm1 - rpm0);
            return power0 + (power1 - power0) * t;
        }
    }

    return 0.5;
}

/**
 * Calculate wheel RPM from car speed
 */
function wheelRpmFromSpeed(speedMS: number, wheelRadiusM: number): number {
    // rpm = (speed / circumference) * 60
    const circumference = 2 * Math.PI * wheelRadiusM;
    return (speedMS / circumference) * 60;
}

/**
 * Calculate engine RPM from wheel RPM and gear
 */
function engineRpmFromWheelRpm(
    wheelRpm: number,
    gearRatio: number,
    finalDrive: number
): number {
    return wheelRpm * gearRatio * finalDrive;
}

/**
 * Step the engine simulation
 * Returns updated state and effective power multiplier
 */
export function stepEngine(
    state: EngineState,
    params: EngineParams,
    inputs: {
        throttle: number; // 0..1
        speedMS: number; // current car speed
        wheelRadiusM?: number;
    },
    dtSeconds: number
): { state: EngineState; powerMultiplier: number; torqueScale: number } {
    const throttle = Math.max(0, Math.min(1, inputs.throttle));
    const wheelRadius = inputs.wheelRadiusM ?? 0.32; // default tire radius
    const speedMS = Math.abs(inputs.speedMS);

    // Calculate target RPM from wheel speed (what the engine "wants" to be at)
    const wheelRpm = wheelRpmFromSpeed(speedMS, wheelRadius);
    const gearRatio = params.gearRatios[Math.min(state.gear - 1, params.gearRatios.length - 1)];
    const targetRpmFromSpeed = engineRpmFromWheelRpm(wheelRpm, gearRatio, params.finalDriveRatio);

    // RPM behavior depends on clutch engagement
    let newRpm = state.rpm;
    const clutchEngaged = state.rpm > params.clutchEngageRpm && speedMS > 0.5;

    if (clutchEngaged) {
        // Clutch engaged: RPM tied to wheel speed, but can rev higher under load
        const baseRpm = Math.max(params.idleRpm, targetRpmFromSpeed);
        // Throttle can push RPM above wheel-dictated value (engine spinning wheels)
        const revBoost = throttle * (params.redlineRpm - baseRpm) * 0.15;
        const targetRpm = baseRpm + revBoost;

        // Blend toward target
        const blendRate = throttle > 0.1 ? params.rpmGainRate : params.rpmDecayRate;
        const diff = targetRpm - newRpm;
        const maxDelta = blendRate * dtSeconds;
        newRpm += Math.sign(diff) * Math.min(Math.abs(diff), maxDelta);
    } else {
        // Clutch disengaged (low speed or low RPM): free-revving
        if (throttle > 0.05) {
            newRpm += throttle * params.rpmGainRate * dtSeconds;
        } else {
            // Decay toward idle
            const diff = params.idleRpm - newRpm;
            newRpm += Math.sign(diff) * Math.min(Math.abs(diff), params.rpmDecayRate * dtSeconds);
        }
    }

    // Clamp RPM
    newRpm = Math.max(params.idleRpm, Math.min(params.maxRpm, newRpm));

    // Auto transmission: shift up near redline, shift down at low RPM
    let newGear = state.gear;
    if (newRpm > params.redlineRpm * 0.95 && newGear < params.gearRatios.length) {
        newGear++;
    } else if (newRpm < params.idleRpm * 2.5 && newGear > 1 && speedMS > 2) {
        // Check if downshifting wouldn't over-rev
        const lowerGearRatio = params.gearRatios[newGear - 2];
        const lowerGearRpm = engineRpmFromWheelRpm(wheelRpm, lowerGearRatio, params.finalDriveRatio);
        if (lowerGearRpm < params.redlineRpm * 0.8) {
            newGear--;
        }
    }

    // Calculate power output
    const powerMultiplier = samplePowerCurve(params, newRpm);

    // Torque scale: higher in lower gears
    const torqueScale = gearRatio / params.gearRatios[params.gearRatios.length - 1];

    return {
        state: {
            rpm: newRpm,
            gear: newGear,
            throttleInput: throttle,
        },
        powerMultiplier,
        torqueScale,
    };
}

/**
 * Get RPM as fraction of redline (0..1+)
 */
export function rpmFraction(state: EngineState, params: EngineParams): number {
    return (state.rpm - params.idleRpm) / (params.redlineRpm - params.idleRpm);
}
