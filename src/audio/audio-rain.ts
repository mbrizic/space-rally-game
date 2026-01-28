/**
 * Rain ambient audio (pink-ish noise)
 * Uses filtered looping noise on the environment channel.
 */

import { getAudioContext, getEnvironmentChannel, isAudioUnlocked } from "./audio-context";

function createPinkNoiseBuffer(ctx: AudioContext, durationSeconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const bufferSize = Math.floor(sampleRate * durationSeconds);
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class RainAudio {
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private filterLow: BiquadFilterNode | null = null;
  private filterHigh: BiquadFilterNode | null = null;
  private isRunning = false;

  start(): boolean {
    if (this.isRunning) return true;

    const ctx = getAudioContext();
    const envChannel = getEnvironmentChannel();
    if (!ctx || !envChannel || !isAudioUnlocked()) return false;

    // Looping noise source
    const buffer = createPinkNoiseBuffer(ctx, 2.0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    // Filters: remove deep rumble + tame hiss
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 160;
    hp.Q.value = 0.7;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3600;
    lp.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(gain);
    gain.connect(envChannel);

    src.start();

    this.source = src;
    this.filterHigh = hp;
    this.filterLow = lp;
    this.gainNode = gain;
    this.isRunning = true;
    return true;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch {
        // ignore
      }
    }
    if (this.filterHigh) this.filterHigh.disconnect();
    if (this.filterLow) this.filterLow.disconnect();
    if (this.gainNode) this.gainNode.disconnect();

    this.source = null;
    this.filterHigh = null;
    this.filterLow = null;
    this.gainNode = null;
    this.isRunning = false;
  }

  update(intensity01: number): void {
    if (!this.isRunning || !this.gainNode || !this.filterLow) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    const i = clamp01(intensity01);
    const now = ctx.currentTime;

    // Keep rain present but not fatiguing.
    const targetGain = 0.01 + 0.35 * i;
    this.gainNode.gain.setTargetAtTime(targetGain, now, 0.08);

    // Heavier rain = slightly brighter hiss.
    const targetLowpass = 2400 + 2400 * i;
    this.filterLow.frequency.setTargetAtTime(targetLowpass, now, 0.12);
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
