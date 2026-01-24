import { KeyboardInput } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";
import { createCarState, defaultCarParams, stepCar, type CarTelemetry } from "../sim/car";
import {
  createPointToPointTrackDefinition,
  createTrackFromDefinition,
  parseTrackDefinition,
  pointOnTrack,
  projectToTrack,
  serializeTrackDefinition,
  type TrackDefinition,
  type TrackProjection
} from "../sim/track";
import { surfaceForTrackSM, type Surface } from "../sim/surface";
import { generateTrees, generateWaterBodies, type CircleObstacle, type WaterBody } from "../sim/props";
import { DriftDetector, DriftState, type DriftInfo } from "../sim/drift";
import { createEngineState, defaultEngineParams, stepEngine, rpmFraction, shiftUp, shiftDown, type EngineState } from "../sim/engine";
import { ParticlePool, getParticleConfig } from "./particles";
import { unlockAudio, suspendAudio, resumeAudio } from "../audio/audio-context";
import { EngineAudio } from "../audio/audio-engine";
import { SlideAudio } from "../audio/audio-slide";
import { EffectsAudio } from "../audio/audio-effects";
import { computePacenote } from "../sim/pacenotes";
import type { TuningPanel } from "./tuning";
import { ProjectilePool } from "../sim/projectile";

type GameState = {
  timeSeconds: number;
  car: ReturnType<typeof createCarState>;
  carTelemetry: CarTelemetry;
};

export class Game {
  private readonly renderer: Renderer2D;
  private readonly input: KeyboardInput;
  private readonly tuning?: TuningPanel;
  private readonly canvas: HTMLCanvasElement;
  private trackDef!: TrackDefinition; // Will be set in constructor
  private track!: ReturnType<typeof createTrackFromDefinition>; // Will be set in constructor
  private trackSegmentFillStyles: string[] = [];
  private trackSegmentShoulderStyles: string[] = [];
  private trees: CircleObstacle[] = [];
  private waterBodies: WaterBody[] = [];
  private inWater = false;
  private checkpointSM: number[] = [];
  private nextCheckpointIndex = 0;
  private insideActiveGate = false;
  private raceActive = false;
  private raceStartTimeSeconds = 0;
  private raceFinished = false;
  private finishTimeSeconds: number | null = null;
  private notificationText = "";
  private notificationTimeSeconds = 0;
  private damage01 = 0;
  private lastSurface: Surface = { name: "tarmac", frictionMu: 1, rollingResistanceN: 260 };
  private lastTrackS = 0;
  private showDebugMenu = false; // F to toggle debug/tires/tuning panels
  private showMinimap = true;
  private gear: "F" | "R" = "F";
  private visualRollOffsetM = 0;
  private visualRollVel = 0;
  private readonly driftDetector = new DriftDetector();
  private driftInfo: DriftInfo = { state: DriftState.NO_DRIFT, intensity: 0, duration: 0, score: 0 };
  private readonly particlePool = new ParticlePool(2000);
  private particleAccumulator = 0;
  private cameraShakeX = 0;
  private cameraShakeY = 0;
  private collisionFlashAlpha = 0;
  private cameraMode: "follow" | "runner" = "runner";
  private cameraRotationRad = 0;
  private pacenoteText = "";
  private editorMode = false;
  private editorDragIndex: number | null = null;
  private editorHoverIndex: number | null = null;
  private editorPointerId: number | null = null;
  // Engine simulation
  private engineState: EngineState = createEngineState();
  private readonly engineParams = defaultEngineParams();
  // Audio systems
  private readonly engineAudio = new EngineAudio();
  private readonly slideAudio = new SlideAudio();
  private readonly effectsAudio = new EffectsAudio();
  private audioUnlocked = false;
  private running = false;
  private proceduralSeed = 20260124;
  private totalDistanceM = 0; // Total distance driven across all sessions
  private lastSaveTime = 0; // For periodic localStorage saves
  private readonly projectilePool = new ProjectilePool();
  private mouseX = 0; // Mouse position in CSS pixels
  private mouseY = 0;
  private mouseWorldX = 0; // Mouse position in world meters
  private mouseWorldY = 0;
  private lastShotTime = 0; // For rate limiting shots

  private lastFrameTimeMs = 0;
  private accumulatorMs = 0;
  private readonly fixedStepMs = 1000 / 120;
  private readonly maxFrameCatchupMs = 250;

  private frameCounter = 0;
  private fps = 0;
  private fpsWindowMs = 0;

  private state: GameState = {
    timeSeconds: 0,
    car: createCarState(),
    carTelemetry: {
      steerAngleRad: 0,
      slipAngleFrontInstantRad: 0,
      slipAngleRearInstantRad: 0,
      slipAngleFrontRad: 0,
      slipAngleRearRad: 0,
      longitudinalForceFrontN: 0,
      longitudinalForceRearN: 0,
      lateralForceFrontN: 0,
      lateralForceRearN: 0,
      normalLoadFrontN: 0,
      normalLoadRearN: 0,
      wheelspinIntensity: 0
    }
  };
  private carParams = defaultCarParams();

  constructor(canvas: HTMLCanvasElement, tuning?: TuningPanel) {
    this.renderer = new Renderer2D(canvas);
    this.input = new KeyboardInput(window);
    this.tuning = tuning;
    this.canvas = canvas;
    
    // Load total distance from localStorage
    const savedDistance = localStorage.getItem('space-rally-total-distance');
    if (savedDistance) {
      this.totalDistanceM = parseFloat(savedDistance) || 0;
    }
    
    // Track mouse position
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click', this.onMouseClick);
    canvas.style.cursor = 'none'; // Hide default cursor, we'll draw crosshair
    // Start with a point-to-point track
    this.setTrack(createPointToPointTrackDefinition(this.proceduralSeed));

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.reset();
      if (e.code === "KeyN") this.randomizeTrack();
      if (e.code === "KeyC") this.toggleCameraMode();
      if (e.code === "KeyT") this.toggleEditorMode(); // Changed from E to T
      if (e.code === "KeyJ") this.shiftDown(); // Manual downshift
      if (e.code === "KeyK") this.shiftUp(); // Manual upshift
      if (e.code === "Digit1" && this.editorMode) this.saveEditorTrack(); // Changed from S
      if (e.code === "Digit2" && this.editorMode) this.loadEditorTrack(); // Changed from L
      if (e.code === "KeyF") {
        this.showDebugMenu = !this.showDebugMenu;
        this.tuning?.setVisibility(this.showDebugMenu);
      }
      if (e.code === "KeyM") {
        this.showMinimap = !this.showMinimap;
      }
      if (e.code === "KeyL") {
        this.shoot();
      }
      // Unlock audio on first key press
      if (!this.audioUnlocked) {
        this.tryUnlockAudio();
      }
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      if (this.editorMode) e.preventDefault();
    });
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);

    // Handle tab visibility for audio
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        suspendAudio();
      } else {
        resumeAudio();
      }
    });

    this.reset();
  }

  private toggleEditorMode(): void {
    this.editorMode = !this.editorMode;
    this.editorDragIndex = null;
    this.editorHoverIndex = null;
    this.editorPointerId = null;

    // Editing and procedural generation go well together; pause driving feel by resetting timer state.
    if (this.editorMode) {
      this.raceActive = false;
    }
  }

  private editorWorldPointFromEvent(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const xCss = e.clientX - rect.left;
    const yCss = e.clientY - rect.top;
    return this.renderer.screenToWorld(xCss, yCss);
  }

  private nearestEditorPointIndex(p: { x: number; y: number }, maxDistM: number): number | null {
    const maxDist2 = maxDistM * maxDistM;
    let bestI: number | null = null;
    let bestD2 = maxDist2;
    for (let i = 0; i < this.trackDef.points.length; i++) {
      const q = this.trackDef.points[i];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestI = i;
      }
    }
    return bestI;
  }

  private applyEditorDef(next: TrackDefinition): void {
    // Keep the editor track identifiable.
    next.meta = { ...(next.meta ?? {}), name: next.meta?.name ?? "Custom", source: "editor" };
    this.setTrack(next);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.editorMode) return;
    e.preventDefault();

    const p = this.editorWorldPointFromEvent(e);
    const hit = this.nearestEditorPointIndex(p, 0.9);

    // Right click deletes.
    if (e.button === 2) {
      if (hit === null) return;
      if (this.trackDef.points.length <= 6) return; // keep a minimally sane loop

      const points = this.trackDef.points.slice();
      points.splice(hit, 1);

      let segmentWidthsM = this.trackDef.segmentWidthsM ? this.trackDef.segmentWidthsM.slice() : undefined;
      if (segmentWidthsM && segmentWidthsM.length === this.trackDef.points.length) {
        segmentWidthsM.splice(hit, 1);
      }

      this.applyEditorDef({ ...this.trackDef, points, segmentWidthsM });
      return;
    }

    // Left click selects/drags or adds.
    if (hit !== null) {
      this.editorDragIndex = hit;
      this.editorPointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    const points = this.trackDef.points.concat([{ x: p.x, y: p.y }]);
    const baseWidthM = this.trackDef.baseWidthM;
    const segmentWidthsM = this.trackDef.segmentWidthsM
      ? this.trackDef.segmentWidthsM.concat([this.trackDef.segmentWidthsM[this.trackDef.segmentWidthsM.length - 1] ?? baseWidthM])
      : undefined;

    this.applyEditorDef({ ...this.trackDef, points, segmentWidthsM });
    this.editorDragIndex = points.length - 1;
    this.editorPointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.editorMode) return;
    const p = this.editorWorldPointFromEvent(e);

    if (this.editorDragIndex !== null && this.editorPointerId === e.pointerId) {
      const points = this.trackDef.points.slice();
      points[this.editorDragIndex] = { x: p.x, y: p.y };
      this.applyEditorDef({ ...this.trackDef, points });
      return;
    }

    this.editorHoverIndex = this.nearestEditorPointIndex(p, 0.9);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.editorMode) return;
    if (this.editorPointerId !== e.pointerId) return;
    this.editorPointerId = null;
    this.editorDragIndex = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private saveEditorTrack(): void {
    const json = serializeTrackDefinition({
      ...this.trackDef,
      meta: { ...(this.trackDef.meta ?? {}), name: "Custom", source: "editor" }
    });
    localStorage.setItem("spaceRally.trackDef", json);
  }

  private loadEditorTrack(): void {
    const json = localStorage.getItem("spaceRally.trackDef");
    if (!json) return;
    const def = parseTrackDefinition(json);
    if (!def) return;
    this.setTrack({ ...def, meta: { ...(def.meta ?? {}), name: def.meta?.name ?? "Custom", source: "editor" } });
    this.reset();
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === "follow" ? "runner" : "follow";
  }

  private shiftUp(): void {
    if (this.tuning?.values.manualTransmission) {
      this.engineState = shiftUp(this.engineState, this.engineParams.gearRatios.length);
    }
  }

  private shiftDown(): void {
    if (this.tuning?.values.manualTransmission) {
      this.engineState = shiftDown(this.engineState);
    }
  }

  private showNotification(text: string): void {
    this.notificationText = text;
    this.notificationTimeSeconds = this.state.timeSeconds;
  }

  private randomizeTrack(): void {
    // Deterministic-ish but changing seeds; makes it easy to share a specific stage later.
    this.proceduralSeed = (this.proceduralSeed + 1) % 1_000_000_000;
    const def = createPointToPointTrackDefinition(this.proceduralSeed);
    this.setTrack(def);
    this.reset();
  }

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    
    // Convert to world coordinates
    this.updateMouseWorldPosition();
  };

  private onMouseClick = (): void => {
    this.shoot();
  };

  private shoot(): void {
    // Rate limit: max 5 shots per second (0.2s cooldown)
    const now = this.state.timeSeconds;
    if (now - this.lastShotTime < 0.2) return;
    
    this.lastShotTime = now;
    
    // Spawn projectile from car position toward mouse cursor
    const carX = this.state.car.xM;
    const carY = this.state.car.yM;
    
    this.projectilePool.spawn(carX, carY, this.mouseWorldX, this.mouseWorldY);
    
    // Play gunshot sound
    this.effectsAudio.playEffect("gunshot", 0.8);
  }

  private updateMouseWorldPosition(): void {
    // Get camera transform info
    const pixelsPerMeter = 36;
    const cameraOffsetY = this.cameraMode === "runner" ? 6 : 3;
    const cosRot = Math.cos(this.state.car.headingRad);
    const sinRot = Math.sin(this.state.car.headingRad);
    const offsetX = cosRot * cameraOffsetY;
    const offsetY = sinRot * cameraOffsetY;
    
    const cameraCenterX = this.state.car.xM + this.cameraShakeX + offsetX;
    const cameraCenterY = this.state.car.yM + this.cameraShakeY + offsetY;
    
    // Convert mouse CSS pixels to world coordinates
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    
    // Mouse position relative to center
    const mouseCenterX = this.mouseX - w / 2;
    const mouseCenterY = this.mouseY - h / 2;
    
    // Account for camera rotation
    const cos = Math.cos(this.cameraRotationRad);
    const sin = Math.sin(this.cameraRotationRad);
    
    // Rotate mouse position
    const rotatedX = mouseCenterX * cos - mouseCenterY * sin;
    const rotatedY = mouseCenterX * sin + mouseCenterY * cos;
    
    // Convert to world meters and add camera position
    this.mouseWorldX = cameraCenterX + rotatedX / pixelsPerMeter;
    this.mouseWorldY = cameraCenterY + rotatedY / pixelsPerMeter;
  }

  private setTrack(def: TrackDefinition): void {
    this.trackDef = def;
    this.track = createTrackFromDefinition(def);

    const trackSeed = def.meta?.seed ?? 1;
    this.trackSegmentFillStyles = [];
    this.trackSegmentShoulderStyles = [];
    for (let i = 0; i < this.track.points.length; i++) {
      const midSM = this.track.cumulativeLengthsM[i] + this.track.segmentLengthsM[i] * 0.5;
      const surface = surfaceForTrackSM(this.track.totalLengthM, midSM, false, trackSeed);
      this.trackSegmentFillStyles.push(surfaceFillStyle(surface));
      this.trackSegmentShoulderStyles.push(surfaceShoulderStyle(surface));
    }

    // Track layout: 0-50m city, 50m START, route, end-50m FINISH, last 50m city
    const cityLength = 50;
    const startLinePos = cityLength; // Exit of starting city
    const finishLinePos = this.track.totalLengthM - cityLength; // Entrance to ending city
    const raceDistance = finishLinePos - startLinePos;
    
    this.checkpointSM = [
      startLinePos, // START LINE at exit of starting city
      startLinePos + raceDistance * 0.33,
      startLinePos + raceDistance * 0.66,
      finishLinePos // FINISH LINE at entrance to ending city
    ];

    const treeSeed = Math.floor(def.meta?.seed ?? 20260123);
    this.trees = generateTrees(this.track, { seed: treeSeed });
    this.waterBodies = generateWaterBodies(this.track, { seed: treeSeed + 777 });

    // Reset stage-related state when swapping tracks.
    this.raceActive = false;
    this.raceStartTimeSeconds = this.state.timeSeconds;
    this.raceFinished = false;
    this.finishTimeSeconds = null;
    this.nextCheckpointIndex = 0;
    this.insideActiveGate = false;
    this.lastTrackS = 0;
  }

  private async tryUnlockAudio(): Promise<void> {
    if (this.audioUnlocked) return;
    const unlocked = await unlockAudio();
    if (unlocked) {
      this.audioUnlocked = true;
      this.engineAudio.start();
      this.slideAudio.start();
      this.effectsAudio.start();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTimeMs = performance.now();
    requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
  }

  private onFrame = (frameTimeMs: number): void => {
    if (!this.running) return;

    let deltaMs = frameTimeMs - this.lastFrameTimeMs;
    this.lastFrameTimeMs = frameTimeMs;

    if (!Number.isFinite(deltaMs) || deltaMs < 0) deltaMs = this.fixedStepMs;
    deltaMs = clamp(deltaMs, 0, this.maxFrameCatchupMs);

    this.accumulatorMs += deltaMs;

    while (this.accumulatorMs >= this.fixedStepMs) {
      this.step(this.fixedStepMs / 1000);
      this.accumulatorMs -= this.fixedStepMs;
    }

    this.render();
    this.updateFps(deltaMs);

    requestAnimationFrame(this.onFrame);
  };

  private step(dtSeconds: number): void {
    if (this.editorMode) return;
    this.state.timeSeconds += dtSeconds;

    this.applyTuning();

    const inputsEnabled = this.damage01 < 1;
    const steer = inputsEnabled ? this.input.axis("steer") : 0; // [-1..1]
    const throttleForward = inputsEnabled ? this.input.axis("throttle") : 0; // [0..1]
    const brakeOrReverse = inputsEnabled ? this.input.axis("brake") : 0; // [0..1]
    const handbrake = inputsEnabled ? this.input.axis("handbrake") : 0; // [0..1]

    // Gear logic: holding brake from (near) standstill engages reverse.
    // In reverse gear, the brake key becomes reverse throttle; press W to go back to forward.
    if (throttleForward > 0.05) this.gear = "F";
    const speedMSNow = this.speedMS();
    if (this.gear === "F" && throttleForward <= 0.05 && brakeOrReverse > 0.05 && speedMSNow < 1.0) this.gear = "R";
    if (this.gear === "R" && speedMSNow > 1.5 && this.state.car.vxMS > 0.8) this.gear = "F";

    let throttle = 0;
    let brake = 0;
    if (this.gear === "F") {
      throttle = throttleForward;
      brake = brakeOrReverse;
    } else {
      throttle = -brakeOrReverse;
      brake = 0;
    }

    const projectionBefore = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    const roadHalfWidthM = projectionBefore.widthM * 0.5;
    const offTrack = projectionBefore.distanceToCenterlineM > roadHalfWidthM;
    const trackSeed = this.trackDef.meta?.seed ?? 1;
    this.lastSurface = surfaceForTrackSM(this.track.totalLengthM, projectionBefore.sM, offTrack, trackSeed);

    // Step engine simulation BEFORE car simulation to use its output
    const engineResult = stepEngine(
      this.engineState,
      this.engineParams,
      { 
        throttle: Math.abs(throttle), 
        speedMS: this.speedMS(),
        manualTransmission: this.tuning?.values.manualTransmission ?? true
      },
      dtSeconds
    );
    this.engineState = engineResult.state;

    // Adjust effective throttle for car physics based on engine power band and gear torque
    const effectiveThrottle = throttle * engineResult.powerMultiplier * engineResult.torqueScale;

    const stepped = stepCar(
      this.state.car,
      this.carParams,
      { steer, throttle: effectiveThrottle, brake, handbrake },
      dtSeconds,
      { frictionMu: this.lastSurface.frictionMu, rollingResistanceN: this.lastSurface.rollingResistanceN }
    );
    this.state.car = stepped.state;
    this.state.carTelemetry = stepped.telemetry;
    this.driftInfo = this.driftDetector.detect(stepped.telemetry, this.speedMS(), this.state.timeSeconds);

    // Track total distance driven
    const distanceThisFrame = this.speedMS() * dtSeconds;
    this.totalDistanceM += distanceThisFrame;

    // Save to localStorage periodically (once per second)
    if (this.state.timeSeconds - this.lastSaveTime >= 1.0) {
      localStorage.setItem('space-rally-total-distance', this.totalDistanceM.toString());
      this.lastSaveTime = this.state.timeSeconds;
    }

    // Update audio
    if (this.audioUnlocked) {
      const rpmNorm = rpmFraction(this.engineState, this.engineParams);
      this.engineAudio.update(rpmNorm, this.engineState.throttleInput);
      this.slideAudio.update(this.driftInfo.intensity, this.lastSurface);
    }

    this.updateVisualRoll(dtSeconds);

    // Emit particles when drifting OR using handbrake OR wheelspinning
    const speedMS = this.speedMS();
    const driftIntensity = Math.max(this.driftInfo.intensity, handbrake * Math.min(speedMS / 15, 1));
    const rawWheelspinIntensity = this.state.carTelemetry.wheelspinIntensity;
    
    // Scale wheelspin by surface - much less on tarmac, more on low-grip surfaces
    const surfaceFriction = this.lastSurface.frictionMu;
    const wheelspinSurfaceScale = Math.max(0.1, 1.5 - surfaceFriction); // 0.5 on tarmac, 1.0+ on gravel/dirt
    const wheelspinIntensity = rawWheelspinIntensity * wheelspinSurfaceScale;
    
    // Combine drift and wheelspin - wheelspin is most visible at lower speeds
    const totalIntensity = Math.max(driftIntensity, wheelspinIntensity * (1 - Math.min(speedMS / 30, 1)));
    
    if (totalIntensity > 0.2) {
      const particleConfig = getParticleConfig(this.lastSurface);
      const particlesPerSecond = particleConfig.spawnRate * totalIntensity;
      this.particleAccumulator += particlesPerSecond * dtSeconds;

      const particlesToEmit = Math.floor(this.particleAccumulator);
      this.particleAccumulator -= particlesToEmit;

      if (particlesToEmit > 0) {
        // Emit from rear of car
        const cosH = Math.cos(this.state.car.headingRad);
        const sinH = Math.sin(this.state.car.headingRad);
        const rearOffsetM = this.carParams.cgToRearAxleM;
        const rearX = this.state.car.xM - cosH * rearOffsetM;
        const rearY = this.state.car.yM - sinH * rearOffsetM;

        // Add some spread
        const spreadX = (Math.random() - 0.5) * 0.6;
        const spreadY = (Math.random() - 0.5) * 0.6;

        // Particle velocity - wheelspin particles are slightly more spread out
        const isWheelspin = wheelspinIntensity > driftIntensity;
        const vxSpread = (Math.random() - 0.5) * (isWheelspin ? 3.5 : 3);
        const vySpread = (Math.random() - 0.5) * (isWheelspin ? 3.5 : 3);

        this.particlePool.emit({
          x: rearX + spreadX,
          y: rearY + spreadY,
          vx: -this.state.car.vxMS * cosH * (isWheelspin ? 0.35 : 0.3) + vxSpread,
          vy: -this.state.car.vxMS * sinH * (isWheelspin ? 0.35 : 0.3) + vySpread,
          lifetime: particleConfig.lifetime,
          sizeM: particleConfig.sizeM,
          color: particleConfig.color,
          count: particlesToEmit
        });
      }
    }

    this.particlePool.update(dtSeconds);
    this.projectilePool.update(dtSeconds);

    // Decay camera shake
    this.cameraShakeX *= 0.85;
    this.cameraShakeY *= 0.85;
    this.collisionFlashAlpha *= 0.92;

    // Smooth camera rotation for runner mode
    if (this.cameraMode === "runner") {
      const targetRot = -this.state.car.headingRad - Math.PI / 2;
      // Normalize angle difference to [-PI, PI]
      let angleDiff = targetRot - this.cameraRotationRad;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      // Smooth interpolation: slower rotation for stability during rapid maneuvers
      const rotationSpeed = 0.8; // rad/s - lower = more stable, less disorienting
      this.cameraRotationRad += angleDiff * rotationSpeed * dtSeconds;
    } else {
      this.cameraRotationRad = 0;
    }

    const projectionAfter = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.resolveHardBoundary(projectionAfter);

    const projectionFinal = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.lastTrackS = projectionFinal.sM;
    this.updateCheckpointsAndRace(projectionFinal);
    this.pacenoteText = computePacenote(this.track, this.lastTrackS, this.speedMS())?.label ?? "STRAIGHT";

    this.resolveTreeCollisions();
    this.resolveBuildingCollisions();
    this.checkWaterHazards(dtSeconds);
    if (this.damage01 >= 1) {
      this.damage01 = 1;
      this.state.car.vxMS = 0;
      this.state.car.vyMS = 0;
      this.state.car.yawRateRadS = 0;
      this.state.car.steerAngleRad = 0;
      this.state.car.alphaFrontRad = 0;
      this.state.car.alphaRearRad = 0;
    }
  }

  private render(): void {
    const { width, height } = this.renderer.resizeToDisplay();

    // Draw background
    this.renderer.drawBg();

    // Offset camera to show more track ahead - car is lower on screen
    const cameraOffsetY = this.cameraMode === "runner" ? 6 : 3; // Show 3-6m ahead
    const cosRot = Math.cos(this.state.car.headingRad);
    const sinRot = Math.sin(this.state.car.headingRad);
    const offsetX = cosRot * cameraOffsetY;
    const offsetY = sinRot * cameraOffsetY;

    this.renderer.beginCamera({
      centerX: this.state.car.xM + this.cameraShakeX + offsetX,
      centerY: this.state.car.yM + this.cameraShakeY + offsetY,
      pixelsPerMeter: 36,
      rotationRad: this.cameraRotationRad
    });

    this.renderer.drawGrid({ spacingMeters: 1, majorEvery: 5 });
    
    // Draw cities BEFORE track so road appears on top
    if (this.track.startCity) {
      this.renderer.drawCity(this.track.startCity);
    }
    if (this.track.endCity) {
      this.renderer.drawCity(this.track.endCity);
    }
    
    this.renderer.drawTrack({ 
      ...this.track, 
      segmentFillStyles: this.trackSegmentFillStyles,
      segmentShoulderStyles: this.trackSegmentShoulderStyles
    });
    if (this.editorMode) {
      this.renderer.drawTrackEditorPoints({
        points: this.trackDef.points,
        activeIndex: this.editorDragIndex ?? this.editorHoverIndex
      });
    }
    this.renderer.drawWater(this.waterBodies);
    this.renderer.drawTrees(this.trees);
    this.renderer.drawParticles(this.particlePool.getActiveParticles());
    // Draw start line at the first checkpoint position (edge of starting city)
    const start = pointOnTrack(this.track, this.checkpointSM[0]);
    const startProj = projectToTrack(this.track, start.p);
    this.renderer.drawStartLine({
      x: start.p.x,
      y: start.p.y,
      headingRad: start.headingRad,
      widthM: startProj.widthM
    });
    // Draw active checkpoint if race isn't finished
    if (this.nextCheckpointIndex < this.checkpointSM.length) {
      const activeGate = pointOnTrack(this.track, this.checkpointSM[this.nextCheckpointIndex]);
      const activeGateProj = projectToTrack(this.track, activeGate.p);
      this.renderer.drawCheckpointLine({
        x: activeGate.p.x,
        y: activeGate.p.y,
        headingRad: activeGate.headingRad,
        widthM: activeGateProj.widthM
      });
    }
    this.renderer.drawCar({
      x: this.state.car.xM,
      y: this.state.car.yM,
      headingRad: this.state.car.headingRad,
      speed: this.speedMS(),
      rollOffsetM: this.visualRollOffsetM
    });
    
    // Draw projectiles (bullets)
    this.renderer.drawProjectiles(this.projectilePool.getActive());

    if (this.showDebugMenu && this.tuning?.values.showArrows) {
      this.drawForceArrows();
    }

    this.renderer.endCamera();
    
    // Update mouse world position after camera is set
    this.updateMouseWorldPosition();
    
    // Draw crosshair at mouse position (screen space)
    this.renderer.drawCrosshair(this.mouseX, this.mouseY);

    // Rally info - prominent at top center
    const raceTime = this.raceActive && !this.raceFinished 
      ? this.state.timeSeconds - this.raceStartTimeSeconds 
      : this.finishTimeSeconds ?? 0;
    const stageLine = this.raceFinished 
      ? `FINISHED: ${this.finishTimeSeconds?.toFixed(2)}s` 
      : this.raceActive 
        ? `${raceTime.toFixed(2)}s` 
        : `NOT STARTED`;
    this.renderer.drawPanel({
      x: width / 2,
      y: 12,
      anchorX: "center",
      title: `Rally - Checkpoint ${this.nextCheckpointIndex}/${this.checkpointSM.length}`,
      lines: [
        stageLine,
        `Distance: ${this.lastTrackS.toFixed(0)}m`
      ]
    });

    // Debug panels (F to toggle)
    if (this.showDebugMenu) {
      const speedMS = this.speedMS();
      const speedKmH = speedMS * 3.6;
      this.renderer.drawPanel({
        x: 12,
        y: 12,
        title: "Debug",
        lines: [
          `FPS: ${this.fps.toFixed(0)}`,
          `t: ${this.state.timeSeconds.toFixed(2)}s`,
          `track: ${this.trackDef.meta?.name ?? "Custom"}${this.trackDef.meta?.seed ? ` (seed ${this.trackDef.meta.seed})` : ""}`,
          `camera: ${this.cameraMode}`,
          `speed: ${speedMS.toFixed(2)} m/s (${speedKmH.toFixed(0)} km/h)`,
          `steer: ${this.input.axis("steer").toFixed(2)}  throttle: ${this.input.axis("throttle").toFixed(2)}  brake/rev: ${this.input
            .axis("brake")
            .toFixed(2)}`,
          `handbrake: ${this.input.axis("handbrake").toFixed(2)}  gear: ${this.gear}`,
          `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`,
          `next gate: ${gateLabel(this.nextCheckpointIndex, this.checkpointSM.length)}`,
          `surface: ${this.lastSurface.name}  (μ=${this.lastSurface.frictionMu.toFixed(2)})${this.inWater ? " [WATER!]" : ""}`,
          `damage: ${(this.damage01 * 100).toFixed(0)}%`
        ]
      });
    }

    this.renderer.drawPanel({
      x: width - 12,
      y: 12,
      anchorX: "right",
      title: "Controls",
      lines: this.editorMode
        ? [
            `EDITOR MODE`,
            `Left click/drag  move point`,
            `Left click empty add point`,
            `Right click      delete point`,
            `1               save track`,
            `2               load track`,
            `T               exit editor`
          ]
        : [
        `W / ↑  throttle`,
        `S / ↓  brake / reverse`,
        `A/D or ←/→ steer`,
        `Space  handbrake`,
        `J / K  shift down / up`,
        `L / Click  shoot`,
        `R      reset`,
        `N      new route`,
        `C      camera: ${this.cameraMode}`,
        `M      minimap: ${this.showMinimap ? "ON" : "OFF"}`,
        `T      editor`,
        `F      debug menu: ${this.showDebugMenu ? "ON" : "OFF"}`
      ]
    });

    if (this.showDebugMenu) {
      const deg = (rad: number) => (rad * 180) / Math.PI;
      // Tires panel - positioned below Tuning panel (which is at ~280px and ~200px tall)
      this.renderer.drawPanel({
        x: 12,
        y: 490, // Below Debug (~270px) + Tuning (~200px) + 20px gap
        title: "Tires",
        lines: [
          `steerAngle: ${deg(this.state.carTelemetry.steerAngleRad).toFixed(1)}°`,
          `alphaF: ${deg(this.state.carTelemetry.slipAngleFrontRad).toFixed(1)}° (inst ${deg(this.state.carTelemetry.slipAngleFrontInstantRad).toFixed(1)}°)`,
          `alphaR: ${deg(this.state.carTelemetry.slipAngleRearRad).toFixed(1)}° (inst ${deg(this.state.carTelemetry.slipAngleRearInstantRad).toFixed(1)}°)`,
          `FzF: ${this.state.carTelemetry.normalLoadFrontN.toFixed(0)} N  FxF: ${this.state.carTelemetry.longitudinalForceFrontN.toFixed(0)} N`,
          `FzR: ${this.state.carTelemetry.normalLoadRearN.toFixed(0)} N  FxR: ${this.state.carTelemetry.longitudinalForceRearN.toFixed(0)} N`,
          `FyF: ${this.state.carTelemetry.lateralForceFrontN.toFixed(0)} N`,
          `FyR: ${this.state.carTelemetry.lateralForceRearN.toFixed(0)} N`
        ],
        anchorX: "left"
      });

      // Side visualization of vectors (body frame: +x forward, +y left).
      if (this.tuning?.values.showArrows) {
        const t = this.state.carTelemetry;
        const cosSteer = Math.cos(t.steerAngleRad);
        const sinSteer = Math.sin(t.steerAngleRad);
        const fxBody =
          (t.longitudinalForceFrontN + t.longitudinalForceRearN) - t.lateralForceFrontN * sinSteer;
        const fyBody = t.lateralForceRearN + t.lateralForceFrontN * cosSteer;

        const vx = this.state.car.vxMS;
        const vy = this.state.car.vyMS;

        this.renderer.drawVectorPanel({
          x: width - 12,
          y: height * 0.5,
          anchorX: "right",
          anchorY: "top",
          title: "Vectors (body frame)",
          scale: 48,
          vectors: [
            { label: "v (m/s)", x: vx, y: vy, color: "rgba(232, 236, 241, 0.72)" },
            {
              label: "p (x0.01)",
              x: vx * this.carParams.massKg * 0.01,
              y: vy * this.carParams.massKg * 0.01,
              color: "rgba(210, 210, 255, 0.55)"
            },
            { label: "F (kN)", x: fxBody / 1000, y: fyBody / 1000, color: "rgba(255, 205, 105, 0.88)" }
          ]
        });
      }
    }

    // RPM Meter
    this.renderer.drawRpmMeter({
      rpm: this.engineState.rpm,
      maxRpm: this.engineParams.maxRpm,
      redlineRpm: this.engineParams.redlineRpm,
      gear: this.engineState.gear,
      totalDistanceKm: this.totalDistanceM / 1000
    });

    // Notification (if recent)
    const timeSinceNotification = this.state.timeSeconds - this.notificationTimeSeconds;
    if (this.notificationText && timeSinceNotification < 2.5) {
      this.renderer.drawNotification(this.notificationText, timeSinceNotification);
    }

    // Pacenotes
    this.renderer.drawPacenoteBanner({ text: this.pacenoteText });

    // Drift indicator
    this.renderer.drawDriftIndicator({
      intensity: this.driftInfo.intensity,
      score: this.driftInfo.score
    });

    // Damage overlay (red vignette)
    if (this.damage01 > 0.15) {
      this.renderer.drawDamageOverlay({ damage01: this.damage01 });
    }

    // Minimap
    if (this.showMinimap) {
      this.renderer.drawMinimap({
        track: this.track,
        carX: this.state.car.xM,
        carY: this.state.car.yM,
        carHeading: this.state.car.headingRad,
        waterBodies: this.waterBodies
      });
    }

    // Collision flash
    if (this.collisionFlashAlpha > 0.01) {
      const ctx = this.renderer.ctx;
      ctx.save();
      ctx.setTransform(this.renderer["dpr"], 0, 0, this.renderer["dpr"], 0, 0);
      ctx.fillStyle = `rgba(255, 100, 100, ${this.collisionFlashAlpha})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    if (this.damage01 >= 1) {
      this.renderer.drawCenterText({ text: "WRECKED", subtext: "Press R to reset" });
    }
  }

  private speedMS(): number {
    return Math.hypot(this.state.car.vxMS, this.state.car.vyMS);
  }

  private applyTuning(): void {
    if (!this.tuning) return;
    const t = this.tuning.values;
    this.carParams.engineForceN = clamp(t.engineForceN, 4000, 45000);
    this.carParams.maxSteerRad = clamp((t.maxSteerDeg * Math.PI) / 180, 0.15, 1.2);
    this.carParams.driveBiasFront = clamp(t.driveBiasFront01, 0, 1);
  }

  private updateVisualRoll(dtSeconds: number): void {
    const t = this.state.carTelemetry;
    const p = this.carParams;

    const cosSteer = Math.cos(t.steerAngleRad);
    const sinSteer = Math.sin(t.steerAngleRad);

    // Approx body lateral accel from net lateral force / mass.
    const fyFrontBodyN = t.lateralForceFrontN * cosSteer + t.longitudinalForceFrontN * sinSteer;
    const fyBodyN = t.lateralForceRearN + fyFrontBodyN;
    const ayBodyMS2 = fyBodyN / Math.max(1, p.massKg);

    // Map to a visual roll offset (meters in local Y), spring-damper.
    const target = clamp(-ayBodyMS2 * 0.018, -0.22, 0.22);
    const stiffness = 26;
    const damping = 9;
    const accel = (target - this.visualRollOffsetM) * stiffness - this.visualRollVel * damping;
    this.visualRollVel += accel * dtSeconds;
    this.visualRollOffsetM += this.visualRollVel * dtSeconds;

    // Additional settle when nearly stopped.
    if (this.speedMS() < 1) {
      this.visualRollOffsetM *= 0.95;
      this.visualRollVel *= 0.8;
    }
  }

  private drawForceArrows(): void {
    const t = this.state.carTelemetry;
    const car = this.state.car;
    const p = this.carParams;

    const cosH = Math.cos(car.headingRad);
    const sinH = Math.sin(car.headingRad);
    const forwardX = cosH;
    const forwardY = sinH;
    const leftX = -sinH;
    const leftY = cosH;

    const a = p.cgToFrontAxleM;
    const b = p.cgToRearAxleM;

    const frontX = car.xM + forwardX * a;
    const frontY = car.yM + forwardY * a;
    const rearX = car.xM - forwardX * b;
    const rearY = car.yM - forwardY * b;

    const cosSteer = Math.cos(t.steerAngleRad);
    const sinSteer = Math.sin(t.steerAngleRad);

    const fxFrontBodyN = t.longitudinalForceFrontN * cosSteer - t.lateralForceFrontN * sinSteer;
    const fyFrontBodyN = t.lateralForceFrontN * cosSteer + t.longitudinalForceFrontN * sinSteer;
    const fxRearBodyN = t.longitudinalForceRearN;
    const fyRearBodyN = t.lateralForceRearN;

    const fxNetBodyN = fxRearBodyN + fxFrontBodyN;
    const fyNetBodyN = fyRearBodyN + fyFrontBodyN;

    const toWorldX = (fxBody: number, fyBody: number) => fxBody * cosH - fyBody * sinH;
    const toWorldY = (fxBody: number, fyBody: number) => fxBody * sinH + fyBody * cosH;

    const forceScaleMPerN = 1 / 9000;
    this.renderer.drawArrow({
      x: rearX,
      y: rearY,
      dx: toWorldX(fxRearBodyN, fyRearBodyN) * forceScaleMPerN,
      dy: toWorldY(fxRearBodyN, fyRearBodyN) * forceScaleMPerN,
      color: "rgba(90, 210, 255, 0.85)",
      label: "F_rear"
    });
    this.renderer.drawArrow({
      x: frontX,
      y: frontY,
      dx: toWorldX(fxFrontBodyN, fyFrontBodyN) * forceScaleMPerN,
      dy: toWorldY(fxFrontBodyN, fyFrontBodyN) * forceScaleMPerN,
      color: "rgba(255, 205, 105, 0.88)",
      label: "F_front"
    });

    const axBody = fxNetBodyN / p.massKg;
    const ayBody = fyNetBodyN / p.massKg;
    const accelScaleMPerMS2 = 0.14;
    this.renderer.drawArrow({
      x: car.xM,
      y: car.yM,
      dx: toWorldX(axBody, ayBody) * accelScaleMPerMS2,
      dy: toWorldY(axBody, ayBody) * accelScaleMPerMS2,
      color: "rgba(185, 255, 160, 0.85)",
      label: "a"
    });

    const vxW = car.vxMS * cosH - car.vyMS * sinH;
    const vyW = car.vxMS * sinH + car.vyMS * cosH;
    const velScaleMPerMS = 0.32;
    this.renderer.drawArrow({
      x: car.xM,
      y: car.yM,
      dx: vxW * velScaleMPerMS,
      dy: vyW * velScaleMPerMS,
      color: "rgba(232, 236, 241, 0.72)",
      label: "v"
    });

    // Lateral velocity component (useful for Scandinavian flick timing).
    const vLat = car.vyMS;
    const vLatScaleMPerMS = 0.45;
    this.renderer.drawArrow({
      x: car.xM,
      y: car.yM,
      dx: leftX * vLat * vLatScaleMPerMS,
      dy: leftY * vLat * vLatScaleMPerMS,
      color: "rgba(255, 120, 180, 0.75)",
      label: "v_lat"
    });
  }

  private reset(): void {
    // Spawn in the starting city (behind the start line)
    // Start line is at 50m, so spawn at 20m to be in the middle of the city
    const spawn = pointOnTrack(this.track, 20);
    this.state.car = {
      ...createCarState(),
      xM: spawn.p.x,
      yM: spawn.p.y,
      headingRad: spawn.headingRad
    };
    this.nextCheckpointIndex = 0;
    this.insideActiveGate = false;
    this.raceActive = false;
    this.raceStartTimeSeconds = this.state.timeSeconds;
    this.raceFinished = false;
    this.finishTimeSeconds = null;
    this.damage01 = 0;
    this.state.car.steerAngleRad = 0;
    this.visualRollOffsetM = 0;
    this.visualRollVel = 0;
    this.driftDetector.reset();
    this.engineState = createEngineState();
    this.particlePool.reset();
    this.particleAccumulator = 0;
    this.cameraRotationRad = this.cameraMode === "runner" ? -spawn.headingRad - Math.PI / 2 : 0;
  }

  private updateCheckpointsAndRace(proj: TrackProjection): void {
    if (this.raceFinished) return; // Don't update if race is done
    
    const speed = this.speedMS();
    if (speed < 1.5) {
      this.insideActiveGate = false;
      return;
    }

    const gateSM = this.checkpointSM[this.nextCheckpointIndex];
    const insideGate =
      Math.abs(proj.sM - gateSM) < 3.5 &&
      proj.distanceToCenterlineM < proj.widthM * 0.6;

    if (insideGate && !this.insideActiveGate) {
      if (this.nextCheckpointIndex === 0) {
        // Start the race timer when crossing the start line
        this.raceActive = true;
        this.raceStartTimeSeconds = this.state.timeSeconds;
        this.nextCheckpointIndex = 1;
        this.showNotification("GO!");
        this.effectsAudio.playEffect("checkpoint", 0.8);
      } else if (this.nextCheckpointIndex === this.checkpointSM.length - 1) {
        // Finish line!
        this.raceFinished = true;
        this.finishTimeSeconds = this.state.timeSeconds - this.raceStartTimeSeconds;
        this.nextCheckpointIndex = this.checkpointSM.length; // Move past last checkpoint
        const time = this.finishTimeSeconds.toFixed(2);
        this.showNotification(`FINISH! Time: ${time}s`);
        this.effectsAudio.playEffect("checkpoint", 1.0); // Louder for finish
      } else {
        // Regular checkpoint
        this.nextCheckpointIndex += 1;
        const checkpointNum = this.nextCheckpointIndex;
        const totalCheckpoints = this.checkpointSM.length - 1; // Excluding finish
        this.showNotification(`Checkpoint ${checkpointNum}/${totalCheckpoints}`);
        this.effectsAudio.playEffect("checkpoint", 0.7);
      }
      this.insideActiveGate = true;
    } else if (!insideGate) {
      this.insideActiveGate = false;
    }
  }

  private resolveHardBoundary(proj: TrackProjection): void {
    const roadHalfWidthM = proj.widthM * 0.5;
    const hardBoundaryHalfWidthM = roadHalfWidthM + 3.5;
    if (proj.distanceToCenterlineM <= hardBoundaryHalfWidthM) return;

    const sign = proj.lateralOffsetM >= 0 ? 1 : -1;
    const nx = proj.normal.x * sign;
    const ny = proj.normal.y * sign;

    const boundaryX = proj.closest.x + nx * hardBoundaryHalfWidthM;
    const boundaryY = proj.closest.y + ny * hardBoundaryHalfWidthM;
    this.state.car.xM = boundaryX;
    this.state.car.yM = boundaryY;

    const cosH = Math.cos(this.state.car.headingRad);
    const sinH = Math.sin(this.state.car.headingRad);
    const vxW = this.state.car.vxMS * cosH - this.state.car.vyMS * sinH;
    const vyW = this.state.car.vxMS * sinH + this.state.car.vyMS * cosH;

    const vN = vxW * nx + vyW * ny;
    const tx = -ny;
    const ty = nx;
    const vT = vxW * tx + vyW * ty;

    const restitution = 0.18;
    const tangentialDamping = 0.55;
    const newVN = vN > 0 ? -vN * restitution : vN;
    const newVT = vT * tangentialDamping;

    const newVxW = newVN * nx + newVT * tx;
    const newVyW = newVN * ny + newVT * ty;

    this.state.car.vxMS = newVxW * cosH + newVyW * sinH;
    this.state.car.vyMS = -newVxW * sinH + newVyW * cosH;
    this.state.car.yawRateRadS *= 0.6;

    const impact = Math.max(0, vN);
    if (impact > 2) {
      this.damage01 = clamp(this.damage01 + impact * 0.02, 0, 1);
      // Camera shake based on impact
      const shakeIntensity = Math.min(impact * 0.15, 1.5);
      this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
      this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
      this.collisionFlashAlpha = Math.min(impact * 0.08, 0.3);
    }
  }

  private resolveTreeCollisions(): void {
    if (this.damage01 >= 1) return;

    const carRadius = 0.85; // Slightly tighter for narrow trunks
    for (const tree of this.trees) {
      const dx = this.state.car.xM - tree.x;
      const dy = this.state.car.yM - tree.y;
      const dist = Math.hypot(dx, dy);
      const minDist = carRadius + tree.r * 0.4; // Matches visual trunk scale
      if (dist >= minDist || dist < 1e-6) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      // Push out.
      const penetration = minDist - dist;
      this.state.car.xM += nx * penetration;
      this.state.car.yM += ny * penetration;

      // Reflect world velocity with damping.
      const cosH = Math.cos(this.state.car.headingRad);
      const sinH = Math.sin(this.state.car.headingRad);
      const vxW = this.state.car.vxMS * cosH - this.state.car.vyMS * sinH;
      const vyW = this.state.car.vxMS * sinH + this.state.car.vyMS * cosH;

      const vN = vxW * nx + vyW * ny;
      const tx = -ny;
      const ty = nx;
      const vT = vxW * tx + vyW * ty;

      const restitution = 0.25; // More bouncy rebound
      const tangentialDamping = 0.5;

      // Rebound if moving towards tree (vN < 0)
      const newVN = vN < 0 ? -vN * restitution : vN;
      const newVT = vT * tangentialDamping;

      const newVxW = newVN * nx + newVT * tx;
      const newVyW = newVN * ny + newVT * ty;

      this.state.car.vxMS = newVxW * cosH + newVyW * sinH;
      this.state.car.vyMS = -newVxW * sinH + newVyW * cosH;
      this.state.car.yawRateRadS *= 0.4;

      const impact = vN < 0 ? Math.abs(vN) : 0;
      if (impact > 1) {
        this.damage01 = clamp(this.damage01 + impact * 0.08, 0, 1);
        // Camera shake for tree collisions
        const shakeIntensity = Math.min(impact * 0.25, 2.5);
        this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
        this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
        this.collisionFlashAlpha = Math.min(impact * 0.12, 0.4);
      }
    }
  }

  private resolveBuildingCollisions(): void {
    if (this.damage01 >= 1) return;

    const carRadius = 0.85;
    const cities = [this.track.startCity, this.track.endCity].filter(Boolean);
    
    for (const city of cities) {
      if (!city) continue;
      
      for (const building of city.buildings) {
        // Simplified collision: treat buildings as circles for now
        const dx = this.state.car.xM - building.x;
        const dy = this.state.car.yM - building.y;
        const dist = Math.hypot(dx, dy);
        const buildingRadius = Math.max(building.width, building.height) / 2;
        const minDist = carRadius + buildingRadius;
        
        if (dist >= minDist || dist < 1e-6) continue;

        const nx = dx / dist;
        const ny = dy / dist;

        // Push out
        const penetration = minDist - dist;
        this.state.car.xM += nx * penetration;
        this.state.car.yM += ny * penetration;

        // Reflect velocity (similar to tree collision but harder)
        const cosH = Math.cos(this.state.car.headingRad);
        const sinH = Math.sin(this.state.car.headingRad);
        const vxW = this.state.car.vxMS * cosH - this.state.car.vyMS * sinH;
        const vyW = this.state.car.vxMS * sinH + this.state.car.vyMS * cosH;

        const vN = vxW * nx + vyW * ny;
        const tx = -ny;
        const ty = nx;
        const vT = vxW * tx + vyW * ty;

        const restitution = 0.15; // Less bouncy than trees
        const tangentialDamping = 0.3; // More friction

        const newVN = vN < 0 ? -vN * restitution : vN;
        const newVT = vT * tangentialDamping;

        const newVxW = newVN * nx + newVT * tx;
        const newVyW = newVN * ny + newVT * ty;

        this.state.car.vxMS = newVxW * cosH + newVyW * sinH;
        this.state.car.vyMS = -newVxW * sinH + newVyW * cosH;
        this.state.car.yawRateRadS *= 0.3;

        const impact = vN < 0 ? Math.abs(vN) : 0;
        if (impact > 1) {
          this.damage01 = clamp(this.damage01 + impact * 0.12, 0, 1); // More damage than trees
          const shakeIntensity = Math.min(impact * 0.35, 3.5);
          this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
          this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
          this.collisionFlashAlpha = Math.min(impact * 0.15, 0.5);
        }
      }
    }
  }

  private updateFps(deltaMs: number): void {
    this.frameCounter += 1;
    this.fpsWindowMs += deltaMs;
    if (this.fpsWindowMs >= 500) {
      this.fps = (this.frameCounter / this.fpsWindowMs) * 1000;
      this.frameCounter = 0;
      this.fpsWindowMs = 0;
    }
  }

  private checkWaterHazards(dtSeconds: number): void {
    const carX = this.state.car.xM;
    const carY = this.state.car.yM;
    
    let inAnyWater = false;
    
    for (const water of this.waterBodies) {
      // Transform car position to water's local coordinate system
      const dx = carX - water.x;
      const dy = carY - water.y;
      
      // Rotate to align with ellipse axes
      const cos = Math.cos(-water.rotation);
      const sin = Math.sin(-water.rotation);
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      
      // Check if inside ellipse: (x/a)^2 + (y/b)^2 <= 1
      const normalizedDist = (localX * localX) / (water.radiusX * water.radiusX) 
                           + (localY * localY) / (water.radiusY * water.radiusY);
      
      if (normalizedDist <= 1) {
        inAnyWater = true;
        break;
      }
    }
    
    this.inWater = inAnyWater;
    
    if (inAnyWater) {
      // Strong drag effect - water slows the car significantly
      const waterDrag = 0.85; // Lose 15% velocity per frame when in water
      const waterAngularDrag = 0.7; // Even more yaw damping
      
      this.state.car.vxMS *= Math.pow(waterDrag, dtSeconds * 60);
      this.state.car.vyMS *= Math.pow(waterDrag, dtSeconds * 60);
      this.state.car.yawRateRadS *= Math.pow(waterAngularDrag, dtSeconds * 60);
    }
  }
}

function gateLabel(index: number, total: number): string {
  if (index === 0) return "START";
  if (index === total - 1) return "FINISH";
  return `CP${index}`;
}

function surfaceFillStyle(surface: Surface): string {
  switch (surface.name) {
    case "tarmac":
      return "rgba(70, 75, 85, 0.35)"; // Darker gray - asphalt
    case "gravel":
      return "rgba(180, 155, 110, 0.45)"; // Tan/beige - gravel
    case "dirt":
      return "rgba(140, 100, 70, 0.45)"; // Brown - dirt
    case "ice":
      return "rgba(180, 220, 245, 0.50)"; // Light blue - ice
    case "offtrack":
      return "rgba(100, 130, 90, 0.25)"; // Green-gray - grass
  }
}

function surfaceShoulderStyle(surface: Surface): string {
  switch (surface.name) {
    case "tarmac":
      return "rgba(50, 55, 65, 0.25)"; // Darker shoulder
    case "gravel":
      return "rgba(160, 135, 90, 0.30)"; // Darker gravel
    case "dirt":
      return "rgba(120, 80, 50, 0.30)"; // Darker brown
    case "ice":
      return "rgba(160, 200, 225, 0.35)"; // Darker ice blue
    case "offtrack":
      return "rgba(80, 110, 70, 0.20)"; // Darker grass
  }
}
