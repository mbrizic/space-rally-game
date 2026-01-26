import { KeyboardInput, TouchInput, CompositeInput, type GameInput, type InputState } from "./input";
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
import type { TuningPanel } from "./tuning";
import { ProjectilePool } from "../sim/projectile";
import { EnemyPool, generateEnemies } from "../sim/enemy";
import { createWeaponState, WeaponState, WeaponType } from "../sim/weapons";

export enum PlayerRole {
  DRIVER = "driver",
  NAVIGATOR = "navigator"
}

type GameState = {
  timeSeconds: number;
  car: ReturnType<typeof createCarState>;
  carTelemetry: CarTelemetry;
};

export class Game {
  private readonly renderer: Renderer2D;
  private readonly input: GameInput;
  private role: PlayerRole = PlayerRole.DRIVER;
  private lastInputState: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0, shoot: false, fromKeyboard: false };
  private readonly tuning?: TuningPanel;
  private readonly canvas: HTMLCanvasElement;
  private shootPointerId: number | null = null;
  private shootHeld = false;
  private netMode: "solo" | "host" | "client" = "solo";
  private netRemoteEnemies: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: "zombie" | "tank"; health?: number; maxHealth?: number }[] | null = null;
  private netRemoteProjectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[] | null = null;
  private netRemoteNavigator: { aimX: number; aimY: number; shootHeld: boolean; shootPulse: boolean; weaponIndex: number } | null = null;
  private netRemoteDriver: InputState | null = null;
  private netStatusLines: string[] = [];
  private netShootPulseHandler: (() => void) | null = null;
  private netParticleEvents: (
    | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
    | { type: "enemyDeath"; x: number; y: number; isTank: boolean }
  )[] = [];
  private netClientTargetCar: {
    xM: number;
    yM: number;
    headingRad: number;
    vxMS: number;
    vyMS: number;
    yawRateRadS: number;
    steerAngleRad: number;
    alphaFrontRad: number;
    alphaRearRad: number;
  } | null = null;
  private netClientLastRenderMs = 0;
  private trackDef!: TrackDefinition; // Will be set in constructor
  private track!: ReturnType<typeof createTrackFromDefinition>; // Will be set in constructor
  private trackSegmentFillStyles: string[] = [];
  private trackSegmentShoulderStyles: string[] = [];
  private trackSegmentSurfaceNames: ("tarmac" | "gravel" | "dirt" | "ice" | "offtrack")[] = [];
  private trees: CircleObstacle[] = [];
  private waterBodies: WaterBody[] = [];
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
  private visualPitchOffsetM = 0;
  private visualPitchVel = 0;
  private readonly driftDetector = new DriftDetector();
  private driftInfo: DriftInfo = { state: DriftState.NO_DRIFT, intensity: 0, duration: 0, score: 0 };
  private readonly particlePool = new ParticlePool(10000);
  private particleAccumulator = 0;
  private cameraShakeX = 0;
  private cameraShakeY = 0;
  private collisionFlashAlpha = 0;
  private cameraMode: "follow" | "runner" = "runner";
  private cameraRotationRad = 0;
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
  private readonly enemyPool = new EnemyPool();
  private mouseX = 0; // Mouse position in CSS pixels
  private mouseY = 0;
  private mouseWorldX = 0; // Mouse position in world meters
  private mouseWorldY = 0;
  private weapons: WeaponState[] = [];
  private currentWeaponIndex = 0;
  private enemyKillCount = 0; // Track kills for scoring

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

    // Mobile detection
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const kb = new KeyboardInput(window);

    if (isTouch) {
      this.input = new CompositeInput([kb, new TouchInput()]);
    } else {
      this.input = kb;
    }

    this.tuning = tuning;
    this.canvas = canvas;

    // Role selection toggle moved to 'I' key (see keydown handler)


    // Load total distance from localStorage
    const savedDistance = localStorage.getItem('space-rally-total-distance');
    if (savedDistance) {
      this.totalDistanceM = parseFloat(savedDistance) || 0;
    }

    // Track mouse position
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click', this.onMouseClick);
    canvas.addEventListener("pointerdown", this.onShootPointerDown);
    canvas.addEventListener("pointermove", this.onPointerAimMove);
    canvas.addEventListener("pointerup", this.onShootPointerUp);
    canvas.addEventListener("pointercancel", this.onShootPointerUp);
    canvas.style.cursor = 'none'; // Hide default cursor, we'll draw crosshair

    // Initialize weapons
    this.weapons = [
      createWeaponState(WeaponType.HANDGUN),
      createWeaponState(WeaponType.RIFLE),
      createWeaponState(WeaponType.AK47),
      createWeaponState(WeaponType.SHOTGUN)
    ];
    this.currentWeaponIndex = 0; // Default to Handgun
    this.setupWeaponButtons();

    // Start with a point-to-point track
    this.setTrack(createPointToPointTrackDefinition(this.proceduralSeed));

    // Desktop testing: very dim role toggle button (Driver/Shooter)
    const roleToggle = document.getElementById("role-toggle");
    // Hide on desktop; keyboard 'I' already toggles roles there.
    if (!isTouch && roleToggle) roleToggle.style.display = "none";
    roleToggle?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextRole = this.role === PlayerRole.DRIVER ? PlayerRole.NAVIGATOR : PlayerRole.DRIVER;
      this.setRole(nextRole);
      if (!this.audioUnlocked) {
        this.tryUnlockAudio();
      }
    });
    // Ensure label matches initial state (without triggering a notification)
    if (roleToggle) roleToggle.textContent = this.role === PlayerRole.DRIVER ? "Driver" : "Shooter";

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.reset();
      if (e.code === "KeyN") this.randomizeTrack();
      if (e.code === "KeyC") this.toggleCameraMode();
      if (e.code === "KeyT") this.toggleEditorMode(); // Changed from E to T
      if (e.code === "KeyJ") this.shiftDown(); // Manual downshift
      if (e.code === "KeyK") this.shiftUp(); // Manual upshift
      if (e.code === "Digit1" && !this.editorMode) this.switchWeapon(0);
      if (e.code === "Digit2" && !this.editorMode) this.switchWeapon(1);
      if (e.code === "Digit3" && !this.editorMode) this.switchWeapon(2);
      if (e.code === "Digit4" && !this.editorMode) this.switchWeapon(3);
      if (e.code === "Digit1" && this.editorMode) this.saveEditorTrack(); // Changed from S
      if (e.code === "Digit2" && this.editorMode) this.loadEditorTrack(); // Changed from L
      if (e.code === "KeyF") {
        this.showDebugMenu = !this.showDebugMenu;
        this.tuning?.setVisibility(this.showDebugMenu);
      }
      if (e.code === "KeyM") {
        this.showMinimap = !this.showMinimap;
      }
      if (e.code === "KeyI") {
        const nextRole = this.role === PlayerRole.DRIVER ? PlayerRole.NAVIGATOR : PlayerRole.DRIVER;
        this.setRole(nextRole);
      }
      if (e.code === "KeyO") {
        if (this.tuning) {
          this.tuning.values.manualTransmission = !this.tuning.values.manualTransmission;
          const mode = this.tuning.values.manualTransmission ? "MANUAL" : "AUTOMATIC";
          this.showNotification(`GEARBOX: ${mode}`);
        }
      }
      if (e.code === "Escape") {
        // Disconnect from multiplayer and return to solo play
        if (this.netMode !== "solo") {
          const url = new URL(window.location.href);
          url.searchParams.delete("room");
          url.searchParams.delete("host");
          url.searchParams.delete("role");
          window.location.href = url.toString();
        }
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

  // --- Net (server-infra testing) ---
  public setNetMode(mode: "solo" | "host" | "client"): void {
    this.netMode = mode;
    if (mode !== "client") {
      this.netRemoteEnemies = null;
      this.netRemoteProjectiles = null;
      this.netClientTargetCar = null;
      this.netClientLastRenderMs = 0;
    }
    if (mode !== "host") {
      this.netRemoteNavigator = null;
      this.netRemoteDriver = null;
      this.netParticleEvents = [];
    }
  }

  public setNetShootPulseHandler(handler: (() => void) | null): void {
    this.netShootPulseHandler = handler;
  }

  public setNetStatusLines(lines: string[]): void {
    this.netStatusLines = lines;
  }

  public getSerializedTrackDef(): string {
    return serializeTrackDefinition(this.trackDef);
  }

  public loadSerializedTrackDef(json: string): boolean {
    const def = parseTrackDefinition(json);
    if (!def) return false;
    this.setTrack(def);
    this.reset();
    // Reset client smoothing state to snap to new position
    if (this.netMode === "client") {
      this.netClientTargetCar = null;
      this.netClientLastRenderMs = 0;
    }
    return true;
  }

  public applyNetSnapshot(snapshot: {
    t: number;
    car: { xM: number; yM: number; headingRad: number; vxMS: number; vyMS: number; yawRateRadS: number; steerAngleRad: number; alphaFrontRad: number; alphaRearRad: number };
    enemies?: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: "zombie" | "tank"; health?: number; maxHealth?: number }[];
    projectiles?: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[];
    particleEvents?: (
      | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
      | { type: "enemyDeath"; x: number; y: number; isTank: boolean }
    )[];
    raceActive?: boolean;
    raceFinished?: boolean;
    finishTimeSeconds?: number | null;
    enemyKillCount?: number;
    cameraMode?: "follow" | "runner";
    cameraRotationRad?: number;
    shakeX?: number;
    shakeY?: number;
  }): void {
    // In client mode, smooth toward target to avoid jitter.
    this.state = { ...this.state, timeSeconds: snapshot.t };
    if (snapshot.cameraMode) this.cameraMode = snapshot.cameraMode;
    if (snapshot.cameraRotationRad !== undefined) this.cameraRotationRad = snapshot.cameraRotationRad;
    if (snapshot.shakeX !== undefined) this.cameraShakeX = snapshot.shakeX;
    if (snapshot.shakeY !== undefined) this.cameraShakeY = snapshot.shakeY;
    this.netClientTargetCar = snapshot.car;
    if (this.netMode === "client" && this.netClientLastRenderMs === 0) {
      this.state = { ...this.state, car: { ...this.state.car, ...snapshot.car } };
    }

    if (snapshot.enemies) this.netRemoteEnemies = snapshot.enemies.map((e) => ({ ...e }));
    if (snapshot.projectiles) this.netRemoteProjectiles = snapshot.projectiles.map((p) => ({ ...p }));
    if (snapshot.particleEvents) {
      for (const ev of snapshot.particleEvents) {
        if (!ev) continue;
        if (ev.type === "emit") {
          const o = ev.opts;
          this.particlePool.emit({
            x: o.x,
            y: o.y,
            vx: o.vx,
            vy: o.vy,
            lifetime: o.lifetime,
            sizeM: o.sizeM,
            color: o.color,
            count: o.count
          });
        } else if (ev.type === "enemyDeath") {
          this.createEnemyDeathParticles(ev.x, ev.y, ev.isTank);
        }
      }
    }
    if (typeof snapshot.raceActive === "boolean") this.raceActive = snapshot.raceActive;
    if (typeof snapshot.raceFinished === "boolean") this.raceFinished = snapshot.raceFinished;
    if (snapshot.finishTimeSeconds !== undefined) this.finishTimeSeconds = snapshot.finishTimeSeconds;
    if (typeof snapshot.enemyKillCount === "number") this.enemyKillCount = snapshot.enemyKillCount;
  }

  public applyRemoteNavigatorInput(input: { aimX: number; aimY: number; shootHeld: boolean; shootPulse: boolean; weaponIndex: number }): void {
    this.netRemoteNavigator = input;
  }

  public applyRemoteDriverInput(input: InputState): void {
    this.netRemoteDriver = input;
  }

  public getAimWorld(): { x: number; y: number } {
    return { x: this.mouseWorldX, y: this.mouseWorldY };
  }

  public getCurrentWeaponIndex(): number {
    return this.currentWeaponIndex;
  }

  public getNavigatorShootHeld(): boolean {
    // Touch uses shootHeld; keyboard uses lastInputState.shoot (KeyL).
    return (this.role === PlayerRole.NAVIGATOR) && (this.shootHeld || !!this.lastInputState.shoot);
  }

  public setRoleExternal(role: PlayerRole): void {
    this.setRole(role);
  }

  public getRoleExternal(): PlayerRole {
    return this.role;
  }

  public getInputStateExternal(): InputState {
    return this.lastInputState;
  }

  private setRole(role: PlayerRole): void {
    this.role = role;
    this.showNotification(`ROLE: ${role.toUpperCase()}`);

    // Update UI
    const driverGroup = document.getElementById("driver-group");
    const navGroup = document.getElementById("navigator-group");
    const roleToggle = document.getElementById("role-toggle");

    if (role === PlayerRole.DRIVER) {
      driverGroup?.classList.add("active");
      navGroup?.classList.remove("active");
      if (roleToggle) roleToggle.textContent = "Driver";
    } else {
      driverGroup?.classList.remove("active");
      navGroup?.classList.add("active");
      if (roleToggle) roleToggle.textContent = "Shooter";
    }
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
    // World position will be updated in render() after camera is set
  };

  private onMouseClick = (): void => {
    // On touch devices, use pointerdown for immediate shooting (click fires on touchup).
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isTouch) return;

    if (this.netMode === "client" && this.role === PlayerRole.NAVIGATOR) {
      this.netShootPulseHandler?.();
      return;
    }

    // Unlock audio on first click
    if (!this.audioUnlocked) {
      this.tryUnlockAudio();
    }
    this.shoot();
  };

  private onPointerAimMove = (e: PointerEvent): void => {
    // Keep aim updated for pointer inputs (especially touch).
    if (this.shootPointerId !== null && e.pointerId !== this.shootPointerId) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
  };

  private onShootPointerDown = (e: PointerEvent): void => {
    // Avoid interfering with editor interactions.
    if (this.editorMode) return;
    // Only shoot in shooter role.
    if (this.role !== PlayerRole.NAVIGATOR) return;
    // Only use pointerdown shooting for touch/pen to avoid double-firing with click on desktop mouse.
    if (e.pointerType === "mouse") return;

    e.preventDefault();
    this.shootPointerId = e.pointerId;
    this.shootHeld = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.onPointerAimMove(e);

    if (!this.audioUnlocked) {
      this.tryUnlockAudio();
    }
    if (this.netMode === "client") return;
    this.shoot();
  };

  private onShootPointerUp = (e: PointerEvent): void => {
    if (this.shootPointerId !== e.pointerId) return;
    this.shootHeld = false;
    this.shootPointerId = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private switchWeapon(index: number): void {
    if (index >= 0 && index < this.weapons.length) {
      this.currentWeaponIndex = index;
      this.updateWeaponButtons();
    }
  }

  private setupWeaponButtons(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(".mobile-button.weapon[data-weapon-index]"));
    for (const btn of buttons) {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.editorMode) return;
        if (this.role !== PlayerRole.NAVIGATOR) return;

        const raw = btn.getAttribute("data-weapon-index");
        const idx = raw ? Number.parseInt(raw, 10) : NaN;
        if (!Number.isFinite(idx)) return;
        this.switchWeapon(idx);

        if (!this.audioUnlocked) {
          this.tryUnlockAudio();
        }
      });
    }
    this.updateWeaponButtons();
  }

  private updateWeaponButtons(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(".mobile-button.weapon[data-weapon-index]"));
    for (const btn of buttons) {
      const raw = btn.getAttribute("data-weapon-index");
      const idx = raw ? Number.parseInt(raw, 10) : NaN;
      const active = Number.isFinite(idx) && idx === this.currentWeaponIndex;
      btn.classList.toggle("active", active);
    }
  }

  public getNetSnapshot(): {
    t: number;
    car: { xM: number; yM: number; headingRad: number; vxMS: number; vyMS: number; yawRateRadS: number; steerAngleRad: number; alphaFrontRad: number; alphaRearRad: number };
    enemies: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: "zombie" | "tank"; health?: number; maxHealth?: number }[];
    projectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age: number; maxAge: number }[];
    particleEvents: (
      | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
      | { type: "enemyDeath"; x: number; y: number; isTank: boolean }
    )[];
    raceActive: boolean;
    raceFinished: boolean;
    finishTimeSeconds: number | null;
    enemyKillCount: number;
    cameraMode: "follow" | "runner";
    cameraRotationRad: number;
    shakeX: number;
    shakeY: number;
  } {
    return {
      t: this.state.timeSeconds,
      car: { ...this.state.car },
      enemies: this.enemyPool.getActive().map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        radius: e.radius,
        vx: e.vx,
        vy: e.vy,
        type: e.type,
        health: e.health,
        maxHealth: e.maxHealth
      })),
      projectiles: this.projectilePool.getActive().map((p) => ({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        color: p.color,
        size: p.size,
        age: p.age,
        maxAge: p.maxAge
      })),
      particleEvents: this.netParticleEvents.splice(0, this.netParticleEvents.length),
      raceActive: this.raceActive,
      raceFinished: this.raceFinished,
      finishTimeSeconds: this.finishTimeSeconds,
      enemyKillCount: this.enemyKillCount,
      cameraMode: this.cameraMode,
      cameraRotationRad: this.cameraRotationRad,
      shakeX: this.cameraShakeX,
      shakeY: this.cameraShakeY
    };
  }

  private emitParticles(opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number }): void {
    this.particlePool.emit(opts);
    if (this.netMode === "host") {
      this.netParticleEvents.push({ type: "emit", opts });
    }
  }

  private shoot(opts?: { aimX?: number; aimY?: number; weaponIndex?: number }): void {
    const weaponIndex = opts?.weaponIndex ?? this.currentWeaponIndex;
    const weapon = this.weapons[weaponIndex];
    if (!weapon) return;

    // Check ammo
    if (weapon.ammo === 0) {
      if (this.audioUnlocked) {
        // Click sound for empty
      }
      return;
    }

    // Rate limit
    const now = this.state.timeSeconds;
    if (now - weapon.lastFireTime < weapon.stats.fireInterval) return;

    weapon.lastFireTime = now;
    if (weapon.ammo > 0) {
      weapon.ammo--;
    }

    // Spawn projectile(s) from car center
    const carX = this.state.car.xM;
    const carY = this.state.car.yM;
    const stats = weapon.stats;

    // Calculate base angle to target
    const aimX = opts?.aimX ?? this.mouseWorldX;
    const aimY = opts?.aimY ?? this.mouseWorldY;
    const dx = aimX - carX;
    const dy = aimY - carY;
    const baseAngle = Math.atan2(dy, dx);

    for (let i = 0; i < stats.projectileCount; i++) {
      // Apply spread
      const spread = (Math.random() - 0.5) * stats.spread;
      const angle = baseAngle + spread;

      // Calculate target from angle
      const dist = 10; // Arbitrary distance to define direction
      const targetX = carX + Math.cos(angle) * dist;
      const targetY = carY + Math.sin(angle) * dist;

      this.projectilePool.spawn(
        carX,
        carY,
        targetX,
        targetY,
        stats.projectileSpeed,
        stats.damage,
        stats.projectileColor,
        stats.projectileSize
      );
    }

    // Play gunshot sound - only if audio is unlocked
    if (this.audioUnlocked) {
      // Use weapon specific sound if we had more, for now vary pitch/vol
      let vol = 1.0;
      let pitch = 1.0;

      if (stats.type === WeaponType.RIFLE) { vol = 0.9; pitch = 0.75; }
      else if (stats.type === WeaponType.AK47) { vol = 0.7; pitch = 1.2; }
      else if (stats.type === WeaponType.SHOTGUN) { vol = 1.1; pitch = 0.6; } // Deep boom

      this.effectsAudio.playEffect("gunshot", vol, pitch);
    }
  }

  private updateMouseWorldPosition(): void {
    // Use renderer's screenToWorld method which properly handles camera rotation
    const worldPos = this.renderer.screenToWorld(this.mouseX, this.mouseY);
    this.mouseWorldX = worldPos.x;
    this.mouseWorldY = worldPos.y;
  }

  private setTrack(def: TrackDefinition): void {
    this.trackDef = def;
    this.track = createTrackFromDefinition(def);

    const trackSeed = def.meta?.seed ?? 1;
    this.trackSegmentFillStyles = [];
    this.trackSegmentShoulderStyles = [];
    this.trackSegmentSurfaceNames = [];
    for (let i = 0; i < this.track.points.length; i++) {
      const midSM = this.track.cumulativeLengthsM[i] + this.track.segmentLengthsM[i] * 0.5;
      const surface = surfaceForTrackSM(this.track.totalLengthM, midSM, false, trackSeed);
      this.trackSegmentFillStyles.push(surfaceFillStyle(surface));
      this.trackSegmentShoulderStyles.push(surfaceShoulderStyle(surface));
      this.trackSegmentSurfaceNames.push(surface.name);
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
    const enemies = generateEnemies(this.track, { seed: treeSeed + 1337 });
    this.enemyPool.setEnemies(enemies);

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
    // Always update inputs so net-clients can send them.
    this.lastInputState = this.input.getState();

    if (this.netMode === "client") {
      return;
    }

    this.state.timeSeconds += dtSeconds;

    this.applyTuning();

    const inputsEnabled = this.damage01 < 1;
    const rawInput = this.lastInputState;

    // Split input by role - although keyboard allows both for solo testing, 
    // we enforce the role logic strictly for touch users.
    const isDriverLocal = this.role === PlayerRole.DRIVER || !!rawInput.fromKeyboard;
    const isNavigatorLocal = this.role === PlayerRole.NAVIGATOR || !!rawInput.fromKeyboard;

    // Use remote driver input if we are host and a remote driver is connected
    const driverInput = (this.netMode === "host" && this.netRemoteDriver) ? this.netRemoteDriver : rawInput;
    const isDriverRemote = this.netMode === "host" && !!this.netRemoteDriver;

    // Driver actions
    const steer = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.steer : 0;
    const throttleForward = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.throttle : 0;
    const brakeOrReverse = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.brake : 0;
    const handbrake = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.handbrake : 0;

    // Navigator actions
    // - Local keyboard: rawInput.shoot (KeyL)
    // - Local touch/pen: hold-to-fire via shootHeld
    // - Remote navigator (net host): aim + shoot
    const heldTouchShoot = this.role === PlayerRole.NAVIGATOR && this.shootHeld;
    if (inputsEnabled && ((isNavigatorLocal && rawInput.shoot) || heldTouchShoot)) {
      this.shoot();
    }
    if (inputsEnabled && this.netMode === "host" && this.netRemoteNavigator) {
      const n = this.netRemoteNavigator;
      if (n.shootPulse || n.shootHeld) {
        this.shoot({ aimX: n.aimX, aimY: n.aimY, weaponIndex: n.weaponIndex });
      }
      // Pulse is one-shot; held is continuous.
      this.netRemoteNavigator = { ...n, shootPulse: false };
    }

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

    this.updateVisualDynamics(dtSeconds);

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

        this.emitParticles({
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
    this.enemyPool.update(dtSeconds, this.track);
    this.checkProjectileCollisions();

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
      // Smooth interpolation: faster rotation to reduce lag/mismatch
      const rotationSpeed = 2.0; // rad/s
      this.cameraRotationRad += angleDiff * rotationSpeed * dtSeconds;
    } else {
      this.cameraRotationRad = 0;
    }

    const projectionAfter = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.resolveHardBoundary(projectionAfter);

    const projectionFinal = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.lastTrackS = projectionFinal.sM;
    this.updateCheckpointsAndRace(projectionFinal);

    this.resolveTreeCollisions();
    this.resolveBuildingCollisions();
    this.resolveEnemyCollisions();
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

    // Client smoothing/prediction (net mode)
    if (this.netMode === "client") {
      const nowMs = performance.now();
      if (this.netClientLastRenderMs === 0) this.netClientLastRenderMs = nowMs;
      const dt = clamp((nowMs - this.netClientLastRenderMs) / 1000, 0, 0.05);
      this.netClientLastRenderMs = nowMs;

      // Predict remote enemies/projectiles forward a bit using their velocities
      if (this.netRemoteEnemies) {
        for (const e of this.netRemoteEnemies) {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
      }
      if (this.netRemoteProjectiles) {
        for (const p of this.netRemoteProjectiles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (typeof p.age === "number") p.age += dt;
        }
        this.netRemoteProjectiles = this.netRemoteProjectiles.filter((p) =>
          typeof p.age === "number" && typeof p.maxAge === "number" ? p.age < p.maxAge : true
        );
      }

      // Fast interpolation to smooth network jitter while staying responsive
      if (this.netClientTargetCar) {
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const wrapPi = (a: number) => {
          while (a > Math.PI) a -= Math.PI * 2;
          while (a < -Math.PI) a += Math.PI * 2;
          return a;
        };
        // Fast interpolation for position/heading (camera) - tuned for smoothness
        const fastAlpha = 1 - Math.exp(-dt * 40);
        // Slower for visual details
        const slowAlpha = 1 - Math.exp(-dt * 14);

        const c = this.state.car;
        const tcar = this.netClientTargetCar;
        // Fast interpolation for camera (position + heading)
        c.xM = lerp(c.xM, tcar.xM, fastAlpha);
        c.yM = lerp(c.yM, tcar.yM, fastAlpha);
        c.headingRad = c.headingRad + wrapPi(tcar.headingRad - c.headingRad) * fastAlpha;
        // Smooth visual/physics properties
        c.vxMS = lerp(c.vxMS, tcar.vxMS, slowAlpha);
        c.vyMS = lerp(c.vyMS, tcar.vyMS, slowAlpha);
        c.yawRateRadS = lerp(c.yawRateRadS, tcar.yawRateRadS, slowAlpha);
        c.steerAngleRad = lerp(c.steerAngleRad, tcar.steerAngleRad, slowAlpha);
        c.alphaFrontRad = lerp(c.alphaFrontRad, tcar.alphaFrontRad, slowAlpha);
        c.alphaRearRad = lerp(c.alphaRearRad, tcar.alphaRearRad, slowAlpha);
      }

      // Animate locally-emitted particle effects on the client (client doesn't run `step()`).
      this.particlePool.update(dt);
    }

    // Draw background
    this.renderer.drawBg();

    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

    // Offset camera to show more track ahead - car is lower on screen
    const cameraOffsetY = this.cameraMode === "runner" ? 8 : 4;
    const cosRot = Math.cos(this.state.car.headingRad);
    const sinRot = Math.sin(this.state.car.headingRad);
    const offsetX = cosRot * cameraOffsetY;
    const offsetY = sinRot * cameraOffsetY;

    const zoom = 24; // Unified tactical zoom

    // Don't shift screen center based on role - keep cameras identical for multiplayer
    const screenCenterXCssPx = undefined;

    // Use zero camera shake for client (shake is local to host simulation)
    const shakeX = this.netMode === "client" ? 0 : this.cameraShakeX;
    const shakeY = this.netMode === "client" ? 0 : this.cameraShakeY;

    this.renderer.beginCamera({
      centerX: this.state.car.xM + shakeX + offsetX,
      centerY: this.state.car.yM + shakeY + offsetY,
      pixelsPerMeter: zoom,
      rotationRad: this.cameraRotationRad,
      screenCenterXCssPx
    });

    // Update mouse world position now that camera is set
    this.updateMouseWorldPosition();

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
      segmentShoulderStyles: this.trackSegmentShoulderStyles,
      segmentSurfaceNames: this.trackSegmentSurfaceNames
    });
    if (this.editorMode) {
      this.renderer.drawTrackEditorPoints({
        points: this.trackDef.points,
        activeIndex: this.editorDragIndex ?? this.editorHoverIndex
      });
    }
    this.renderer.drawWater(this.waterBodies);
    this.renderer.drawTrees(this.trees);
    const enemiesToDraw = this.netMode === "client" && this.netRemoteEnemies ? this.netRemoteEnemies : this.enemyPool.getActive();
    this.renderer.drawEnemies(enemiesToDraw);
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
      rollOffsetM: this.visualRollOffsetM,
      pitchOffsetM: this.visualPitchOffsetM
    });

    // Draw projectiles (bullets)
    const projectilesToDraw = this.netMode === "client" && this.netRemoteProjectiles ? this.netRemoteProjectiles : this.projectilePool.getActive();
    this.renderer.drawProjectiles(projectilesToDraw);

    if (this.showDebugMenu && this.tuning?.values.showArrows) {
      this.drawForceArrows();
    }

    this.renderer.endCamera();

    if (this.role === PlayerRole.DRIVER) {
      this.renderer.drawFog(this.state.car.xM, this.state.car.yM, 45); // Blind driver fog
    }

    // Draw crosshair at mouse position (screen space) - Suppressed on Touch
    if (!isTouch) {
      this.renderer.drawCrosshair(this.mouseX, this.mouseY);
    }

    // --- HUD LAYOUT ORCHESTRATION ---

    const hudPadding = 12;

    // 1. Controls Panel (Top Left)
    // "disappear when you toggle debug menu" implies Debug Menu REPLACES controls?
    // Let's assume: Show Controls normally. If Debug Menu
    if (!this.showDebugMenu && !isTouch) {
      this.renderer.drawPanel({
        x: hudPadding,
        y: hudPadding,
        anchorX: "left",
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
            `🏎️ DRIVING`,
            `W / ↑      throttle`,
            `S / ↓      brake / reverse`,
            `A/D / ←/→  steer`,
            `Space      handbrake`,
            ``,
            `⚙️ GEARBOX`,
            `J / K      shift down / up`,
            `O          toggle auto/man`,
            ``,
            `🔫 SHOOTING`,
            `L / Click  fire weapon`,
            `1 / 2 / 3  switch weapon`,
            ``,
            `🛠️ OTHERS`,
            `R          reset car`,
            `N          new route`,
            `C          camera: ${this.cameraMode}`,
            `M          minimap: ${this.showMinimap ? "ON" : "OFF"}`,
            `T          editor`,
          ]
      });
    }

    // 2. Right Side Stack (Top Right)
    let rightStackY = hudPadding;
    const rightStackX = width - hudPadding;

    // 2a. Rally Info Panel (Top Right)
    if (!this.editorMode) {
      // Calculate split time color
      const raceTime = this.raceActive && !this.raceFinished
        ? this.state.timeSeconds - this.raceStartTimeSeconds
        : this.finishTimeSeconds ?? 0;

      let stageLine = `NOT STARTED`;
      if (this.raceActive) stageLine = `${raceTime.toFixed(2)}s`;
      else if (this.raceFinished) stageLine = `FINISHED: ${this.finishTimeSeconds?.toFixed(2)}s`;

      const lines = [
        `time: ${this.state.timeSeconds.toFixed(2)}s`,
        `checkpoint: ${this.nextCheckpointIndex}/${this.checkpointSM.length}`,
        stageLine,
        `Distance: ${this.lastTrackS.toFixed(0)}m`,
        `Kills: ${this.enemyKillCount}/${this.enemyPool.getAll().length}`
      ];

      if (this.raceFinished) {
        const totalTime = this.finishTimeSeconds ?? 1;
        const avgSpeedMS = this.track.totalLengthM / totalTime;
        const avgSpeedKmH = avgSpeedMS * 3.6;
        lines[2] = `FINISHED: ${totalTime.toFixed(2)}s`; // Update stage line
        lines.splice(3, 0, `AVG Speed: ${avgSpeedKmH.toFixed(1)} km/h`); // Insert Avg Speed
      }

      this.renderer.drawPanel({
        x: rightStackX,
        y: rightStackY,
        anchorX: "right",
        title: "Rally Info",
        lines: lines
      });
      rightStackY += 140; // Approx height of info panel
    }

    // 2b. Pacenotes (Below Rally Info) - FULLY REMOVED


    // 2c. Minimap
    // Show if:
    // 1. Role is NAVIGATOR (always)
    // 2. Role is DRIVER but we are on DESKTOP (not touch) - "Singleplayer Mode"
    const canShowMinimap = this.showMinimap && (this.role === PlayerRole.NAVIGATOR || !isTouch);

    if (canShowMinimap) {
      const miniMapSize = isTouch ? width : Math.min(height * 0.4, 300);
      const startMM = pointOnTrack(this.track, this.checkpointSM[0]).p;
      const finishMM = pointOnTrack(this.track, this.checkpointSM[this.checkpointSM.length - 1]).p;
      const minimapOffsetX = !isTouch && this.role === PlayerRole.DRIVER ? hudPadding : (width - miniMapSize) * 0.5;
      this.renderer.drawMinimap({
        track: this.track,
        carX: this.state.car.xM,
        carY: this.state.car.yM,
        carHeading: this.state.car.headingRad,
        waterBodies: this.waterBodies,
        enemies: this.enemyPool.getActive(),
        segmentSurfaceNames: this.trackSegmentSurfaceNames,
        start: startMM,
        finish: finishMM,
        offsetX: minimapOffsetX,
        offsetY: height - miniMapSize - (isTouch ? 0 : hudPadding), // Bottom (no padding if full width)
        size: miniMapSize
      });
    }

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
          `steer: ${this.lastInputState.steer.toFixed(2)}  throttle: ${this.lastInputState.throttle.toFixed(2)}  brake/rev: ${this.lastInputState.brake.toFixed(2)}`,
          `handbrake: ${this.lastInputState.handbrake.toFixed(2)}  gear: ${this.gear}`,
          `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`,
          ...this.netStatusLines.map(l => `net: ${l}`)
        ]
      });
    }

    // Draw Weapon HUD - Suppressed for Driver
    if (this.weapons.length > 0 && this.role === PlayerRole.NAVIGATOR) {
      const currentWeapon = this.weapons[this.currentWeaponIndex];
      this.renderer.drawWeaponHUD({
        name: currentWeapon.stats.name,
        ammo: currentWeapon.ammo,
        capacity: currentWeapon.stats.ammoCapacity
      }, width, height);
    }

    // Minimap - Moved below controls with spacing
    // This section is now handled by the new HUD layout orchestration.

    if (this.showDebugMenu) {
      const deg = (rad: number) => (rad * 180) / Math.PI;
      // Tires panel - positioned below Tuning panel (which is at ~280px and ~200px tall)
      this.renderer.drawPanel({
        x: 12,
        y: 510, // Below Debug (~270px) + Tuning (~200px) + 40px gap
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

    // RPM Meter - Suppressed for Navigator (replaced by minimap)
    if (this.role === PlayerRole.DRIVER) {
      this.renderer.drawRpmMeter({
        rpm: this.engineState.rpm,
        maxRpm: this.engineParams.maxRpm,
        redlineRpm: this.engineParams.redlineRpm,
        gear: this.engineState.gear,
        speedKmH: this.speedMS() * 3.6,
        damage01: this.damage01,
        totalDistanceKm: this.totalDistanceM / 1000
      });
    }

    // Notification (if recent)
    const timeSinceNotification = this.state.timeSeconds - this.notificationTimeSeconds;
    if (this.notificationText && timeSinceNotification < 2.5) {
      this.renderer.drawNotification(this.notificationText, timeSinceNotification);
    }

    // Pacenotes are now handled in the HUD Layout Orchestration block above.

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


    // Collision flash
    if (this.collisionFlashAlpha > 0.01) {
      const ctx = this.renderer.ctx;
      ctx.save();
      ctx.setTransform(this.renderer["dpr"], 0, 0, this.renderer["dpr"], 0, 0);
      ctx.fillStyle = `rgba(255, 230, 100, ${this.collisionFlashAlpha})`; // Yellow-brown flash
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    if (this.damage01 >= 1) {
      this.renderer.drawCenterText({ text: "WRECKED", subtext: "Press R to reset" });
    }

    if (this.raceFinished) {
      const totalTime = this.finishTimeSeconds ?? 1;
      const avgSpeedKmH = (this.track.totalLengthM / totalTime) * 3.6;
      this.renderer.drawFinishScreen({
        time: totalTime,
        avgSpeedKmH: avgSpeedKmH,
        kills: this.enemyKillCount,
        totalEnemies: this.enemyPool.getAll().length
      });
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

  private updateVisualDynamics(dtSeconds: number): void {
    const t = this.state.carTelemetry;
    const p = this.carParams;

    const cosSteer = Math.cos(t.steerAngleRad);
    const sinSteer = Math.sin(t.steerAngleRad);

    // 1. ROLL (Lateral sway)
    // Approx body lateral accel from net lateral force / mass.
    const fyFrontBodyN = t.lateralForceFrontN * cosSteer + t.longitudinalForceFrontN * sinSteer;
    const fyBodyN = t.lateralForceRearN + fyFrontBodyN;
    const ayBodyMS2 = fyBodyN / Math.max(1, p.massKg);

    // Map to a visual roll offset (Negated: ay left -> roll right)
    const rollTarget = clamp(-ayBodyMS2 * 0.025, -0.35, 0.35);
    const stiffness = 26;
    const damping = 9;

    const rollAccel = (rollTarget - this.visualRollOffsetM) * stiffness - this.visualRollVel * damping;
    this.visualRollVel += rollAccel * dtSeconds;
    this.visualRollOffsetM += this.visualRollVel * dtSeconds;

    // 2. PITCH (Longitudinal sway - Nose dive/ squat)
    // Approx body axial accel from net longitudinal force / mass.
    const fxFrontBodyN = t.longitudinalForceFrontN * cosSteer - t.lateralForceFrontN * sinSteer;
    const fxBodyN = t.longitudinalForceRearN + fxFrontBodyN;
    const axBodyMS2 = fxBodyN / Math.max(1, p.massKg);

    // Map to a visual pitch offset (Negated so dive on -accel/brake)
    const pitchTarget = clamp(-axBodyMS2 * 0.02, -0.25, 0.25);
    const pitchAccel = (pitchTarget - this.visualPitchOffsetM) * stiffness - this.visualPitchVel * damping;
    this.visualPitchVel += pitchAccel * dtSeconds;
    this.visualPitchOffsetM += this.visualPitchVel * dtSeconds;

    // Additional settle when nearly stopped.
    if (this.speedMS() < 0.5) {
      this.visualRollOffsetM *= 0.90;
      this.visualRollVel *= 0.7;
      this.visualPitchOffsetM *= 0.90;
      this.visualPitchVel *= 0.7;
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
    const rearY = car.yM - sinH * b;

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
    this.enemyKillCount = 0;

    // Respawn enemies when resetting (regenerate from track)
    const treeSeed = Math.floor(this.trackDef.meta?.seed ?? 20260123);
    const enemies = generateEnemies(this.track, { seed: treeSeed + 1337 });
    this.enemyPool.setEnemies(enemies);
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

    if (inAnyWater) {
      // Strong drag effect - water slows the car significantly
      const waterDrag = 0.85; // Lose 15% velocity per frame when in water
      const waterAngularDrag = 0.7; // Even more yaw damping

      this.state.car.vxMS *= Math.pow(waterDrag, dtSeconds * 60);
      this.state.car.vyMS *= Math.pow(waterDrag, dtSeconds * 60);
      this.state.car.yawRateRadS *= Math.pow(waterAngularDrag, dtSeconds * 60);
    }
  }

  private checkProjectileCollisions(): void {
    const projectiles = this.projectilePool.getActive();
    const projectilesToRemove: number[] = [];

    for (const proj of projectiles) {
      let hit = false;

      // Check collision with trees
      for (const tree of this.trees) {
        const dx = proj.x - tree.x;
        const dy = proj.y - tree.y;
        const dist = Math.hypot(dx, dy);

        // Projectile hits if within tree trunk radius
        if (dist < tree.r * 0.4) { // Matches visual trunk scale
          projectilesToRemove.push(proj.id);
          hit = true;
          break;
        }
      }

      if (hit) continue;

      // Check collision with enemies (RAYCAST to prevent tunneling)
      for (const enemy of this.enemyPool.getActive()) {
        const dx = proj.x - enemy.x;
        const dy = proj.y - enemy.y;
        const distSq = dx * dx + dy * dy;
        const radiusSq = enemy.radius * enemy.radius;

        // Simple distance check first
        let collision = distSq < radiusSq;

        // Raycast check if not hit directly but moving fast
        if (!collision) {
          // Previous position (approximate based on velocity)
          // We can use a simpler approach: distance from point (enemy center) to line segment (proj path)
          // Segment from (proj.x - proj.vx*dt, proj.y - proj.vy*dt) to (proj.x, proj.y)
          // Actually, since we update position then check collisions, the segment is P_prev -> P_curr

          // We need access to dt here ideally, but game loop step doesn't pass it easily to this method
          // However, since we just moved the projectile in stepProjectile, we can infer P_prev
          // Let's assume we check over the last step's movement.
          // Projectile speed is ~200m/s. At 60fps (16ms), it moves ~3.3m
          // Enemy radius is ~0.6m. Tunneling happens if step > 1.2m

          // Let's use a normalized direction and project enemy onto the line
          const speed = Math.hypot(proj.vx, proj.vy);
          if (speed > 1) {
            const stepDist = speed * 0.016; // Approx 1 frame at 60hz
            const vx = proj.vx / speed;
            const vy = proj.vy / speed;

            // Vector from enemy to current projectile pos
            const ex = enemy.x - proj.x;
            const ey = enemy.y - proj.y;

            // Project enemy onto line: t = dot(e, v)
            // But we are looking backwards from current pos. So direction is -v
            // Vector from P_curr to P_prev is -v * stepDist
            const t = -(ex * vx + ey * vy); // distance BACK along the path

            if (t > 0 && t < stepDist) {
              // Enemy is "behind" us within one frame's distance. Check perpendicular distance
              const closestX = proj.x - vx * t;
              const closestY = proj.y - vy * t;
              const distToLineSq = (closestX - enemy.x) ** 2 + (closestY - enemy.y) ** 2;

              if (distToLineSq < radiusSq) {
                collision = true;
              }
            }
          }
        }

        if (collision) {
          projectilesToRemove.push(proj.id);

          // Damage enemy
          const damage = proj.damage || 1.0; // Use projectile damage
          const damagedEnemy = this.enemyPool.damage(enemy.id, damage);

          if (damagedEnemy && damagedEnemy.health <= 0) {
            this.enemyKillCount++;
            // Create massive particle burst on death
            this.createEnemyDeathParticles(enemy.x, enemy.y, enemy.type === "tank");
            if (this.netMode === "host") {
              this.netParticleEvents.push({ type: "enemyDeath", x: enemy.x, y: enemy.y, isTank: enemy.type === "tank" });
            }
          } else {
            // Smaller visual feedback for hits that don't kill
            this.emitParticles({
              x: proj.x,
              y: proj.y,
              vx: (Math.random() - 0.5) * 4,
              vy: (Math.random() - 0.5) * 4,
              sizeM: 0.1,
              lifetime: 0.3,
              color: "rgba(200, 50, 50, 0.8)",
              count: 5
            });
          }

          // Play impact sound (slightly quieter for hits)
          if (this.audioUnlocked) {
            const volume = (damagedEnemy && damagedEnemy.health <= 0) ? 0.7 : 0.4;
            this.effectsAudio.playEffect("impact", volume);
          }

          hit = true;
          break;
        }
      }
    }

    // Remove hit projectiles
    for (const id of projectilesToRemove) {
      this.projectilePool.remove(id);
    }
  }

  private createEnemyDeathParticles(x: number, y: number, isTank: boolean = false): void {
    let particleCount: number;
    let speedMin: number;
    let speedRange: number;

    if (isTank) {
      // MASSIVE explosion for tanks
      particleCount = 200 + Math.floor(Math.random() * 100); // 200-300 particles
      speedMin = 4;
      speedRange = 8; // 4-12 m/s
    } else {
      // High density for zombies
      particleCount = 80 + Math.floor(Math.random() * 50); // 80-130 particles
      speedMin = 2;
      speedRange = 5; // 2-7 m/s
    }

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * speedRange;

      // Vary particle colors for more visual interest
      const colorVariant = Math.random();
      let color;
      if (colorVariant < 0.7) {
        color = "rgba(180, 50, 50, 0.85)"; // Dark red
      } else if (colorVariant < 0.9) {
        color = "rgba(220, 80, 70, 0.8)"; // Bright red
      } else {
        color = "rgba(120, 30, 30, 0.9)"; // Very dark red/brown
      }

      this.particlePool.emit({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        sizeM: 0.12 + Math.random() * 0.25, // 0.12-0.37m (varied sizes)
        lifetime: 0.7 + Math.random() * 0.6, // Short-lived (was 600s persistent)
        color
      });
    }
  }

  private resolveEnemyCollisions(): void {
    if (this.damage01 >= 1) return;

    const carRadius = 0.85;
    for (const enemy of this.enemyPool.getActive()) {
      const dx = this.state.car.xM - enemy.x;
      const dy = this.state.car.yM - enemy.y;
      const dist = Math.hypot(dx, dy);
      const minDist = carRadius + enemy.radius;

      if (dist >= minDist || dist < 1e-6) continue;

      // Collision detected
      const overlap = minDist - dist;
      const impact = this.speedMS() * overlap;

      if (impact > 0.2) {
        // Push car away
        const nx = dx / dist;
        const ny = dy / dist;
        this.state.car.xM += nx * overlap * 0.4;
        this.state.car.yM += ny * overlap * 0.4;

        // Type-specific physics
        const isTank = enemy.type === "tank";
        // Heavier zombies: significantly reduce speed on impact
        const speedReduction = isTank ? 0.60 : 0.75; // 40% loss for tanks, 25% for zombies (was 15%)
        const distortionMultiplier = isTank ? 0.5 : 0.15; // More yaw for tanks
        const damageRate = isTank ? 0.08 : 0.015; // More damage from tanks (was 0.02)

        this.state.car.vxMS *= speedReduction;
        this.state.car.vyMS *= speedReduction;

        const lateralImpact = (this.state.car.vyMS * nx - this.state.car.vxMS * ny) * distortionMultiplier;
        this.state.car.yawRateRadS += lateralImpact;

        this.damage01 = clamp(this.damage01 + impact * damageRate, 0, 1);

        // Camera shake
        const shakeIntensity = Math.min(impact * (isTank ? 0.5 : 0.25), 2.5);
        this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
        this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
        this.collisionFlashAlpha = Math.min(impact * (isTank ? 0.15 : 0.08), 0.5);

        // Kill/Damage enemy on impact (usually kills zombies immediately)
        const damaged = this.enemyPool.damage(enemy.id, isTank ? 1.0 : 1.0);
        if (damaged && damaged.health <= 0) {
          this.enemyKillCount++;
          this.createEnemyDeathParticles(enemy.x, enemy.y, isTank);
        }

        // Play impact sound
        if (this.audioUnlocked) {
          this.effectsAudio.playEffect("impact", isTank ? 0.9 : 0.6);
        }
      }
    }
  }
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
