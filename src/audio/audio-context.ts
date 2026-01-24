/**
 * Shared audio context management with multi-channel mixing
 * Handles lazy initialization and user gesture requirements
 * 
 * Audio mixing architecture:
 * - Engine channel: Lower volume, always audible (0.25)
 * - Environment channel: Tires, wind, ambient (0.35)
 * - Effects channel: Guns, explosions, impacts - priority (0.5)
 * - All channels -> Master (0.6) -> Destination
 */

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let engineChannel: GainNode | null = null;
let environmentChannel: GainNode | null = null;
let effectsChannel: GainNode | null = null;
let isUnlocked = false;

/**
 * Get or create the shared audio context
 * Must be called after user gesture to work in browsers
 */
export function getAudioContext(): AudioContext | null {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            
            // Create master output
            masterGain = audioContext.createGain();
            masterGain.gain.value = 0.6; // Overall master volume
            masterGain.connect(audioContext.destination);
            
            // Create separate mixing channels
            engineChannel = audioContext.createGain();
            engineChannel.gain.value = 0.25; // Engine is subtle but present
            engineChannel.connect(masterGain);
            
            environmentChannel = audioContext.createGain();
            environmentChannel.gain.value = 0.35; // Tires, wind - moderate
            environmentChannel.connect(masterGain);
            
            effectsChannel = audioContext.createGain();
            effectsChannel.gain.value = 0.5; // Guns, explosions - louder/priority
            effectsChannel.connect(masterGain);
            
        } catch (e) {
            console.warn("Web Audio API not supported:", e);
            return null;
        }
    }
    return audioContext;
}

/**
 * Get the master gain node for volume control
 */
export function getMasterGain(): GainNode | null {
    getAudioContext(); // ensure initialized
    return masterGain;
}

/**
 * Get the engine audio channel
 */
export function getEngineChannel(): GainNode | null {
    getAudioContext(); // ensure initialized
    return engineChannel;
}

/**
 * Get the environment audio channel (tires, wind, ambient)
 */
export function getEnvironmentChannel(): GainNode | null {
    getAudioContext(); // ensure initialized
    return environmentChannel;
}

/**
 * Get the effects audio channel (guns, explosions, impacts)
 */
export function getEffectsChannel(): GainNode | null {
    getAudioContext(); // ensure initialized
    return effectsChannel;
}

/**
 * Attempt to unlock audio context (must be called from user gesture)
 */
export async function unlockAudio(): Promise<boolean> {
    const ctx = getAudioContext();
    if (!ctx) return false;

    if (ctx.state === "suspended") {
        try {
            await ctx.resume();
            isUnlocked = true;
        } catch (e) {
            console.warn("Failed to resume audio context:", e);
            return false;
        }
    } else {
        isUnlocked = true;
    }

    return isUnlocked;
}

/**
 * Check if audio is unlocked and ready
 */
export function isAudioUnlocked(): boolean {
    return isUnlocked && audioContext?.state === "running";
}

/**
 * Set master volume (0..1)
 */
export function setMasterVolume(volume: number): void {
    if (masterGain) {
        masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
}

/**
 * Suspend audio when tab is hidden
 */
export function suspendAudio(): void {
    if (audioContext && audioContext.state === "running") {
        audioContext.suspend();
    }
}

/**
 * Resume audio when tab becomes visible
 */
export function resumeAudio(): void {
    if (audioContext && audioContext.state === "suspended" && isUnlocked) {
        audioContext.resume();
    }
}
