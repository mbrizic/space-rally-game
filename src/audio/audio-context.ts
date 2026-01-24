/**
 * Shared audio context management
 * Handles lazy initialization and user gesture requirements
 */

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isUnlocked = false;

/**
 * Get or create the shared audio context
 * Must be called after user gesture to work in browsers
 */
export function getAudioContext(): AudioContext | null {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            masterGain = audioContext.createGain();
            masterGain.gain.value = 0.5;
            masterGain.connect(audioContext.destination);
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
