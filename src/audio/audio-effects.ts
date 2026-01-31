/**
 * Effects audio system for one-shot sounds (guns, explosions, impacts)
 * Uses the high-priority effects channel to ensure audibility over engine/tire sounds
 */

import { getAudioContext, getEffectsChannel, isAudioUnlocked } from "./audio-context";

export type EffectType = "gunshot" | "explosion" | "impact" | "checkpoint";

export class EffectsAudio {
    private isReady = false;

    /**
     * Initialize the effects audio system
     */
    start(): boolean {
        const ctx = getAudioContext();
        const channel = getEffectsChannel();
        if (!ctx || !channel || !isAudioUnlocked()) return false;

        this.isReady = true;
        return true;
    }

    /**
     * Play a one-shot effect sound
     * @param type Effect type to play
     * @param volume 0..1 (default 1.0)
     * @param pitchScale 0.1..2.0 (default 1.0)
     */
    playEffect(type: EffectType, volume: number = 1.0, pitchScale: number = 1.0): void {
        if (!this.isReady) return;

        const ctx = getAudioContext();
        const channel = getEffectsChannel();
        if (!ctx || !channel) return;

        switch (type) {
            case "gunshot":
                this.playGunshot(ctx, channel, volume, pitchScale);
                break;
            case "explosion":
                this.playExplosion(ctx, channel, volume, pitchScale);
                break;
            case "impact":
                this.playImpact(ctx, channel, volume, pitchScale);
                break;
            case "checkpoint":
                this.playCheckpoint(ctx, channel, volume, pitchScale);
                break;
        }
    }

    private playGunshot(ctx: AudioContext, channel: GainNode, volume: number, pitchScale: number): void {
        // Powerful gunshot with multiple layers and decay
        const now = ctx.currentTime;
        const duration = 0.25; // 250ms for full decay

        // Layer 1: Sharp crack (high frequency burst)
        const crackBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.02, ctx.sampleRate);
        const crackData = crackBuffer.getChannelData(0);
        for (let i = 0; i < crackData.length; i++) {
            const env = Math.exp(-i / (crackData.length * 0.08));
            crackData[i] = (Math.random() * 2 - 1) * env;
        }

        const crackSource = ctx.createBufferSource();
        crackSource.buffer = crackBuffer;
        crackSource.playbackRate.value = pitchScale;

        const crackFilter = ctx.createBiquadFilter();
        crackFilter.type = "highpass";
        crackFilter.frequency.value = 2000 * pitchScale;
        crackFilter.Q.value = 2;

        const crackGain = ctx.createGain();
        crackGain.gain.setValueAtTime(volume * 0.8, now);
        crackGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        crackSource.connect(crackFilter);
        crackFilter.connect(crackGain);
        crackGain.connect(channel);

        // Layer 2: Mid-range punch
        const punchBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
        const punchData = punchBuffer.getChannelData(0);
        for (let i = 0; i < punchData.length; i++) {
            const env = Math.exp(-i / (punchData.length * 0.2));
            punchData[i] = (Math.random() * 2 - 1) * env;
        }

        const punchSource = ctx.createBufferSource();
        punchSource.buffer = punchBuffer;
        punchSource.playbackRate.value = pitchScale;

        const punchFilter = ctx.createBiquadFilter();
        punchFilter.type = "bandpass";
        punchFilter.frequency.value = 800 * pitchScale;
        punchFilter.Q.value = 1.5;

        const punchGain = ctx.createGain();
        punchGain.gain.setValueAtTime(volume * 1.0, now);
        punchGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        punchSource.connect(punchFilter);
        punchFilter.connect(punchGain);
        punchGain.connect(channel);

        // Layer 3: Low-end boom with decay tail
        const boomBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
        const boomData = boomBuffer.getChannelData(0);
        for (let i = 0; i < boomData.length; i++) {
            const env = Math.exp(-i / (boomData.length * 0.3));
            boomData[i] = (Math.random() * 2 - 1) * env;
        }

        const boomSource = ctx.createBufferSource();
        boomSource.buffer = boomBuffer;
        boomSource.playbackRate.value = pitchScale;

        const boomFilter = ctx.createBiquadFilter();
        boomFilter.type = "lowpass";
        boomFilter.frequency.value = 300 * pitchScale;
        boomFilter.Q.value = 3;

        const boomGain = ctx.createGain();
        boomGain.gain.setValueAtTime(volume * 1.2, now);
        boomGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

        boomSource.connect(boomFilter);
        boomFilter.connect(boomGain);
        boomGain.connect(channel);

        // Start all layers
        crackSource.start(now);
        crackSource.stop(now + 0.1);

        punchSource.start(now);
        punchSource.stop(now + 0.15);

        boomSource.start(now);
        boomSource.stop(now + duration);
    }

    private playExplosion(ctx: AudioContext, channel: GainNode, volume: number, pitchScale: number): void {
        // Synthesized explosion: rumbling noise with decay
        const now = ctx.currentTime;

        const bufferSize = ctx.sampleRate * 0.5; // 500ms
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const envelope = Math.exp(-i / (bufferSize * 0.25));
            data[i] = (Math.random() * 2 - 1) * envelope;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitchScale;

        // Deep rumble
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 200 * pitchScale;
        lowpass.Q.value = 3;

        const gain = ctx.createGain();
        gain.gain.value = volume * 0.9;

        source.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(channel);

        source.start(now);
        source.stop(now + 0.6);
    }

    private playImpact(ctx: AudioContext, channel: GainNode, volume: number, pitchScale: number): void {
        // Short percussive impact
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150 * pitchScale, now);
        osc.frequency.exponentialRampToValueAtTime(50 * pitchScale, now + 0.05);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume * 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

        osc.connect(gain);
        gain.connect(channel);

        osc.start(now);
        osc.stop(now + 0.15);
    }

    private playCheckpoint(ctx: AudioContext, channel: GainNode, volume: number, pitchScale: number): void {
        // Pleasant success sound
        const now = ctx.currentTime;

        // Two-tone chime
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.value = 800 * pitchScale;

        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = 1200 * pitchScale;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume * 0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(channel);

        osc1.start(now);
        osc2.start(now + 0.05);
        osc1.stop(now + 0.35);
        osc2.stop(now + 0.35);
    }

    /**
     * Check if effects audio is ready
     */
    isActive(): boolean {
        return this.isReady;
    }

    /**
     * Stop the effects audio system
     */
    stop(): void {
        this.isReady = false;
    }
}
