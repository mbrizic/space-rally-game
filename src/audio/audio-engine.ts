/**
 * Engine sound synthesis using Web Audio API
 * Creates realistic engine noise from oscillators based on RPM
 */

import { getAudioContext, getMasterGain, isAudioUnlocked } from "./audio-context";

export type EngineAudioParams = {
    baseFrequency: number; // frequency at idle RPM
    maxFrequency: number; // frequency at redline
    harmonics: number[]; // overtone multipliers [1, 2, 3...]
    harmonicGains: number[]; // relative gains for each harmonic
};

export function defaultEngineAudioParams(): EngineAudioParams {
    return {
        baseFrequency: 55, // ~A1, deep engine idle
        maxFrequency: 220, // ~A3, high revving
        harmonics: [1, 2, 3, 4, 5, 6],
        harmonicGains: [1.0, 0.5, 0.35, 0.2, 0.12, 0.08],
    };
}

export class EngineAudio {
    private params: EngineAudioParams;
    private oscillators: OscillatorNode[] = [];
    private gains: GainNode[] = [];
    private masterGain: GainNode | null = null;
    private isRunning = false;
    private currentRpmNorm = 0; // 0..1
    private currentThrottle = 0;

    constructor(params?: EngineAudioParams) {
        this.params = params ?? defaultEngineAudioParams();
    }

    /**
     * Start the engine audio (call after audio context unlocked)
     */
    start(): boolean {
        if (this.isRunning) return true;

        const ctx = getAudioContext();
        const master = getMasterGain();
        if (!ctx || !master || !isAudioUnlocked()) return false;

        // Create master gain for this engine
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0;
        this.masterGain.connect(master);

        // Create oscillators for each harmonic
        for (let i = 0; i < this.params.harmonics.length; i++) {
            const osc = ctx.createOscillator();
            osc.type = "sawtooth"; // rich harmonic content
            osc.frequency.value = this.params.baseFrequency * this.params.harmonics[i];

            const gain = ctx.createGain();
            gain.gain.value = this.params.harmonicGains[i] * 0.15; // scale down

            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start();

            this.oscillators.push(osc);
            this.gains.push(gain);
        }

        this.isRunning = true;
        return true;
    }

    /**
     * Stop the engine audio
     */
    stop(): void {
        for (const osc of this.oscillators) {
            try {
                osc.stop();
                osc.disconnect();
            } catch (e) {
                // already stopped
            }
        }
        for (const gain of this.gains) {
            gain.disconnect();
        }
        if (this.masterGain) {
            this.masterGain.disconnect();
        }

        this.oscillators = [];
        this.gains = [];
        this.masterGain = null;
        this.isRunning = false;
    }

    /**
     * Update engine sound based on RPM and throttle
     * @param rpmNormalized 0..1 (idle to redline)
     * @param throttle 0..1
     */
    update(rpmNormalized: number, throttle: number): void {
        if (!this.isRunning || !this.masterGain) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        this.currentRpmNorm = Math.max(0, Math.min(1.1, rpmNormalized));
        this.currentThrottle = Math.max(0, Math.min(1, throttle));

        // Calculate frequency from RPM
        const freq = this.params.baseFrequency +
            (this.params.maxFrequency - this.params.baseFrequency) * this.currentRpmNorm;

        // Update oscillator frequencies smoothly
        const now = ctx.currentTime;
        for (let i = 0; i < this.oscillators.length; i++) {
            const targetFreq = freq * this.params.harmonics[i];
            this.oscillators[i].frequency.setTargetAtTime(targetFreq, now, 0.02);
        }

        // Volume based on throttle and RPM
        // Louder with throttle, slightly louder at high RPM
        const baseVolume = 0.1 + this.currentThrottle * 0.4;
        const rpmBoost = this.currentRpmNorm * 0.15;
        const targetVolume = baseVolume + rpmBoost;

        this.masterGain.gain.setTargetAtTime(targetVolume, now, 0.05);
    }

    /**
     * Check if engine audio is running
     */
    isActive(): boolean {
        return this.isRunning;
    }
}
