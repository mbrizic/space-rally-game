# Audio System Architecture

## Overview

The audio system uses a multi-channel mixing approach to ensure all sounds can be heard simultaneously without masking each other. This is critical for gameplay where engine, tires, and weapons/effects all need to be audible.

## Channel Structure

```
┌─────────────────┐
│ Audio Context   │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Master  │ (0.6)
    │  Gain   │
    └────┬────┘
         │
    ┌────┴────────────────────┐
    │                         │
┌───▼────┐  ┌────▼────┐  ┌───▼────┐
│Engine  │  │Environ- │  │Effects │
│Channel │  │ment     │  │Channel │
│(0.25)  │  │Channel  │  │(0.5)   │
│        │  │(0.35)   │  │        │
└───┬────┘  └────┬────┘  └───┬────┘
    │            │            │
  Engine      Tires       Guns,
  sounds      Wind        Explosions
              Ambient     Checkpoints
```

## Channels

### 1. Engine Channel (Gain: 0.25)
- **Purpose**: Continuous engine sounds
- **Volume**: Lower to not overpower other sounds
- **Contains**: Engine oscillators with harmonics
- **Files**: `audio-engine.ts`

### 2. Environment Channel (Gain: 0.35)
- **Purpose**: Tire/surface interactions and ambient sounds
- **Volume**: Moderate, more prominent than engine
- **Contains**: 
  - Tire slide/drift noises (filtered noise)
  - Wind sounds (future)
  - Ambient rally sounds (future)
- **Files**: `audio-slide.ts`

### 3. Effects Channel (Gain: 0.5)
- **Purpose**: One-shot sounds that need priority
- **Volume**: Highest - ensures audibility over continuous sounds
- **Contains**:
  - Weapon sounds (gunshots, explosions)
  - Impact sounds (collisions, water splashes)
  - UI sounds (checkpoint notifications)
- **Files**: `audio-effects.ts`

## Implementation Details

### Engine Audio
- Uses multiple sawtooth oscillators with harmonic overtones
- Frequency modulated by RPM (normalized 0-1)
- Volume controlled by throttle input and RPM
- Smooth parameter changes via `setTargetAtTime`

### Tire/Slide Audio
- Uses filtered white/pink noise
- Filter characteristics vary by surface (tarmac, gravel, sand, ice)
- Volume controlled by slip intensity (drift detection)
- Seamlessly switches noise type when surface changes

### Effects Audio
- Synthesized one-shot sounds (no audio file dependencies)
- Types: `gunshot`, `explosion`, `impact`, `checkpoint`
- Each effect has custom synthesis (oscillators, noise bursts, filters)
- Short duration with envelope shaping for realism

## Adding New Sounds

### To add a weapon sound:

```typescript
// In game.ts
this.effectsAudio.playEffect("gunshot", 1.0);
```

### To add a new effect type:

1. Add type to `EffectType` in `audio-effects.ts`
2. Add case in `playEffect()` switch
3. Implement synthesis method (e.g., `playGunshot()`)

### To add continuous ambient sounds:

1. Create new audio class (e.g., `AmbientAudio`)
2. Connect to `getEnvironmentChannel()` or create dedicated channel
3. Start/stop in game lifecycle

## Browser Compatibility

- Uses Web Audio API (supported in all modern browsers)
- Requires user gesture to unlock (handled by `audio-context.ts`)
- Automatically suspended/resumed on tab visibility changes
- Falls back gracefully if Web Audio not available

## Volume Mixing Philosophy

The gain values are carefully balanced:
- **Engine (0.25)**: Present but subtle, like hearing it from inside the car
- **Environment (0.35)**: More prominent - what you "feel" through the tires
- **Effects (0.5)**: Clear and unmistakable - important gameplay feedback

Combined with master (0.6), total maximum volume per channel:
- Engine: 0.25 × 0.6 = 0.15 (15%)
- Environment: 0.35 × 0.6 = 0.21 (21%)
- Effects: 0.5 × 0.6 = 0.30 (30%)

This ensures no single channel can dominate while allowing all to be heard simultaneously.

## Future Enhancements

- [ ] Doppler effect for passing objects
- [ ] 3D positional audio for multiplayer
- [ ] Reverb/echo for tunnels or canyons
- [ ] Wind noise based on speed
- [ ] Co-driver voice callouts
- [ ] Dynamic music system
- [ ] Audio visualization for debugging
