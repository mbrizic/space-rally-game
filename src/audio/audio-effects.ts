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
     */
    playEffect(type: EffectType, volume: number = 1.0): void {
        if (!this.isReady) return;

        const ctx = getAudioContext();
        const channel = getEffectsChannel();
        if (!ctx || !channel) return;

        switch (type) {
            case "gunshot":
                this.playGunshot(ctx, channel, volume);
                break;
            case "explosion":
                this.playExplosion(ctx, channel, volume);
                break;
            case "impact":
                this.playImpact(ctx, channel, volume);
                break;
            case "checkpoint":
                this.playCheckpoint(ctx, channel, volume);
                break;
        }
    }

    private playGunshot(ctx: AudioContext, channel: GainNode, volume: number): void {
        // Synthesized gunshot: short, sharp noise burst
        const now = ctx.currentTime;
        
        // Create noise burst
        const bufferSize = ctx.sampleRate * 0.05; // 50ms
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            // Exponential decay envelope
            const envelope = Math.exp(-i / (bufferSize * 0.15));
            data[i] = (Math.random() * 2 - 1) * envelope;
        }
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        
        // Add some low-end punch
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 400;
        lowpass.Q.value = 2;
        
        const gain = ctx.createGain();
        gain.gain.value = volume * 0.8;
        
        source.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(channel);
        
        source.start(now);
        source.stop(now + 0.1);
    }

    private playExplosion(ctx: AudioContext, channel: GainNode, volume: number): void {
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
        
        // Deep rumble
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 200;
        lowpass.Q.value = 3;
        
        const gain = ctx.createGain();
        gain.gain.value = volume * 0.9;
        
        source.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(channel);
        
        source.start(now);
        source.stop(now + 0.6);
    }

    private playImpact(ctx: AudioContext, channel: GainNode, volume: number): void {
        // Short percussive impact
        const now = ctx.currentTime;
        
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.05);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume * 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        
        osc.connect(gain);
        gain.connect(channel);
        
        osc.start(now);
        osc.stop(now + 0.15);
    }

    private playCheckpoint(ctx: AudioContext, channel: GainNode, volume: number): void {
        // Pleasant success sound
        const now = ctx.currentTime;
        
        // Two-tone chime
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.value = 800;
        
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = 1200;
        
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
