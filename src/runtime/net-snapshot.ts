// Shared snapshot type used by networking and replay recording/playback.

export type NetSnapshot = {
  t: number;
  car: {
    xM: number;
    yM: number;
    headingRad: number;
    vxMS: number;
    vyMS: number;
    yawRateRadS: number;
    steerAngleRad: number;
    alphaFrontRad: number;
    alphaRearRad: number;
  };
  enemies: {
    id: number;
    x: number;
    y: number;
    radius: number;
    vx: number;
    vy: number;
    type?: "zombie" | "tank" | "colossus";
    health?: number;
    maxHealth?: number;
  }[];
  projectiles: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color?: string;
    size?: number;
    age: number;
    maxAge: number;
  }[];
  enemyProjectiles: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color?: string;
    size?: number;
    age: number;
    maxAge: number;
  }[];
  particleEvents: (
    | {
        type: "emit";
        opts: {
          x: number;
          y: number;
          vx: number;
          vy: number;
          lifetime: number;
          sizeM: number;
          color: string;
          count?: number;
        };
      }
    | { type: "enemyDeath"; x: number; y: number; isTank: boolean; radiusM?: number }
  )[];
  debrisDestroyed: number[];
  audioEvents: { effect: "gunshot" | "explosion" | "impact" | "checkpoint"; volume: number; pitch: number }[];
  continuousAudio: { engineRpm: number; engineThrottle: number; slideIntensity: number; surfaceName: string };
  raceActive: boolean;
  raceStartTimeSeconds: number;
  raceFinished: boolean;
  finishTimeSeconds: number | null;
  damage01: number;
  enemyKillCount: number;
  cameraMode: "follow" | "runner";
  cameraRotationRad: number;
  shakeX: number;
  shakeY: number;
};
