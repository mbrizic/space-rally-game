/**
 * Tire sliding/drift sound synthesis
 * Uses filtered white noise with surface-dependent characteristics
 */

import { getAudioContext, getEnvironmentChannel, isAudioUnlocked } from "./audio-context";
import type { Surface } from "../sim/surface";

export type SlideAudioParams = {
    // Filter settings per surface
    surfaces: {
        [key: string]: {
            filterFreq: number; // bandpass center frequency
            filterQ: number; // resonance
            gain: number; // relative volume
            noiseType: "white" | "pink"; // noise character
        };
    };
};

export function defaultSlideAudioParams(): SlideAudioParams {
    return {
        surfaces: {
            tarmac: {
                filterFreq: 3200, // higher pitch screech
                filterQ: 5, // more resonant/sharp
                gain: 0.65, // balanced for audibility without being harsh
                noiseType: "white",
            },
            gravel: {
                filterFreq: 800, // mid rumble with crackle
                filterQ: 1.5,
                gain: 0.8,
                noiseType: "white",
            },
            dirt: {
                filterFreq: 500, // lower, muffled
                filterQ: 1.2,
                gain: 0.5,
                noiseType: "pink",
            },
            offtrack: {
                filterFreq: 400, // very muffled
                filterQ: 1.0,
                gain: 0.35,
                noiseType: "pink",
            },
        },
    };
}

/**
 * Create a white noise buffer
 */
function createNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const bufferSize = sampleRate * durationSeconds;
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    return buffer;
}

/**
 * Create a pink noise buffer (less harsh than white)
 */
function createPinkNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const bufferSize = sampleRate * durationSeconds;
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    // Paul Kellet's pink noise algorithm
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
    }

    return buffer;
}

export class SlideAudio {
    private params: SlideAudioParams;
    private noiseSource: AudioBufferSourceNode | null = null;
    private filter: BiquadFilterNode | null = null;
    private gainNode: GainNode | null = null;
    private whiteNoiseBuffer: AudioBuffer | null = null;
    private pinkNoiseBuffer: AudioBuffer | null = null;
    private isRunning = false;
    private currentSurface: string = "tarmac";
    private currentIntensity = 0;

    constructor(params?: SlideAudioParams) {
        this.params = params ?? defaultSlideAudioParams();
    }

    /**
     * Start the slide audio system
     */
    start(): boolean {
        if (this.isRunning) return true;

        const ctx = getAudioContext();
        const envChannel = getEnvironmentChannel();
        if (!ctx || !envChannel || !isAudioUnlocked()) return false;

        // Pre-create noise buffers
        this.whiteNoiseBuffer = createNoiseBuffer(ctx, 2);
        this.pinkNoiseBuffer = createPinkNoiseBuffer(ctx, 2);

        // Create filter
        this.filter = ctx.createBiquadFilter();
        this.filter.type = "bandpass";
        this.filter.frequency.value = 1000;
        this.filter.Q.value = 2;

        // Create gain
        this.gainNode = ctx.createGain();
        this.gainNode.gain.value = 0;

        this.filter.connect(this.gainNode);
        this.gainNode.connect(envChannel);

        // Start with white noise (will switch based on surface)
        this.startNoiseSource("white");

        this.isRunning = true;
        return true;
    }

    private startNoiseSource(type: "white" | "pink"): void {
        const ctx = getAudioContext();
        if (!ctx || !this.filter) return;

        // Stop existing source
        if (this.noiseSource) {
            try {
                this.noiseSource.stop();
                this.noiseSource.disconnect();
            } catch (e) {
                // already stopped
            }
        }

        // Create new looping noise source
        this.noiseSource = ctx.createBufferSource();
        this.noiseSource.buffer = type === "white" ? this.whiteNoiseBuffer : this.pinkNoiseBuffer;
        this.noiseSource.loop = true;
        this.noiseSource.connect(this.filter);
        this.noiseSource.start();
    }

    /**
     * Stop the slide audio
     */
    stop(): void {
        if (this.noiseSource) {
            try {
                this.noiseSource.stop();
                this.noiseSource.disconnect();
            } catch (e) {
                // already stopped
            }
        }
        if (this.filter) this.filter.disconnect();
        if (this.gainNode) this.gainNode.disconnect();

        this.noiseSource = null;
        this.filter = null;
        this.gainNode = null;
        this.isRunning = false;
    }

    /**
     * Update slide sound based on slip and surface
     * @param slipIntensity 0..1 (no slip to maximum slide)
     * @param surface current surface type
     */
    update(slipIntensity: number, surface: Surface): void {
        if (!this.isRunning || !this.filter || !this.gainNode) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        const surfaceName = surface.name;
        const surfaceParams = this.params.surfaces[surfaceName] ?? this.params.surfaces.tarmac;

        // Switch noise type if surface changed
        if (surfaceName !== this.currentSurface) {
            this.currentSurface = surfaceName;
            this.startNoiseSource(surfaceParams.noiseType);
        }

        this.currentIntensity = Math.max(0, Math.min(1, slipIntensity));

        const now = ctx.currentTime;

        // Update filter based on surface
        this.filter.frequency.setTargetAtTime(surfaceParams.filterFreq, now, 0.05);
        this.filter.Q.setTargetAtTime(surfaceParams.filterQ, now, 0.05);

        // Volume based on intensity and surface gain
        // On dedicated environment channel, can be more prominent
        const targetGain = this.currentIntensity * surfaceParams.gain * 1.0; // Increased from 0.7
        this.gainNode.gain.setTargetAtTime(targetGain, now, 0.03);
    }

    /**
     * Check if slide audio is running
     */
    isActive(): boolean {
        return this.isRunning;
    }
}
