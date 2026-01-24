import type { CarTelemetry } from "./car";

export enum DriftState {
    NO_DRIFT = "NO_DRIFT",
    STARTING = "STARTING",
    DRIFTING = "DRIFTING",
    ENDING = "ENDING"
}

export type DriftInfo = {
    state: DriftState;
    intensity: number; // 0..1, how "hard" the drift is
    duration: number; // seconds in current drift
    score: number; // accumulated drift score
};

export class DriftDetector {
    private driftState: DriftState = DriftState.NO_DRIFT;
    private driftStartTime = 0;
    private driftScore = 0;
    private currentDriftDuration = 0;

    // Thresholds for drift detection
    private readonly minSlipAngleRad = 0.12; // ~7 degrees minimum slip
    private readonly minSaturation = 0.65; // tire force saturation threshold
    private readonly minSpeed = 8; // m/s, need some speed to drift

    detect(telemetry: CarTelemetry, speedMS: number, timeSeconds: number): DriftInfo {
        // Calculate if we're in a drift based on slip angles and tire saturation
        const rearSlipMagnitude = Math.abs(telemetry.slipAngleRearRad);

        // Calculate tire saturation (how much lateral force vs available grip)
        const rearSaturation = Math.min(
            Math.abs(telemetry.lateralForceRearN) / Math.max(1, telemetry.normalLoadRearN * 0.95),
            1
        );

        const isDrifting =
            speedMS > this.minSpeed &&
            rearSlipMagnitude > this.minSlipAngleRad &&
            rearSaturation > this.minSaturation;

        // State machine
        if (isDrifting) {
            if (this.driftState === DriftState.NO_DRIFT) {
                this.driftState = DriftState.STARTING;
                this.driftStartTime = timeSeconds;
                this.driftScore = 0;
                this.currentDriftDuration = 0;
            } else if (this.driftState === DriftState.STARTING) {
                this.driftState = DriftState.DRIFTING;
            } else if (this.driftState === DriftState.ENDING) {
                // Re-entered drift
                this.driftState = DriftState.DRIFTING;
            }

            // Accumulate score based on slip angle and saturation
            if (this.driftState === DriftState.DRIFTING) {
                this.currentDriftDuration = timeSeconds - this.driftStartTime;
                const scoreDelta = rearSlipMagnitude * rearSaturation * 10;
                this.driftScore += scoreDelta;
            }
        } else {
            if (this.driftState === DriftState.DRIFTING || this.driftState === DriftState.STARTING) {
                this.driftState = DriftState.ENDING;
            } else if (this.driftState === DriftState.ENDING) {
                this.driftState = DriftState.NO_DRIFT;
            }
        }

        // Calculate intensity (0..1) based on slip and saturation
        const intensity = isDrifting
            ? Math.min(
                (rearSlipMagnitude / 0.6) * 0.5 + rearSaturation * 0.5,
                1
            )
            : 0;

        return {
            state: this.driftState,
            intensity,
            duration: this.currentDriftDuration,
            score: this.driftScore
        };
    }

    reset(): void {
        this.driftState = DriftState.NO_DRIFT;
        this.driftStartTime = 0;
        this.driftScore = 0;
        this.currentDriftDuration = 0;
    }
}
