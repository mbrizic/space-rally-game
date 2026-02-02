import { KeyboardInput, TouchInput, CompositeInput, type GameInput, type InputState } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";
import { createCarState, defaultCarParams, stepCar, type CarTelemetry } from "../sim/car";
import type { NetSnapshot } from "./net-snapshot";
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
import { quietZonesFromSeed, resolveStageTheme, stageMetaFromSeed, zoneEdgeFade, zoneIntensityAtTrackDistance, zonesAtTrackDistance, type QuietZone, type StageThemeKind, type TrackZone, type TrackZoneKind } from "../sim/stage";
import { generateDebris, generateEdgeRocks, generateTrees, generateWaterBodies, pointToSegmentDistance, type CircleObstacle, type DebrisObstacle, type WaterBody } from "../sim/props";
import { DriftDetector, DriftState, type DriftInfo } from "../sim/drift";
import { createEngineState, defaultEngineParams, stepEngine, rpmFraction, shiftUp, shiftDown, type EngineState } from "../sim/engine";
import { ParticlePool, getParticleConfig } from "./particles";
import { unlockAudio, suspendAudio, resumeAudio } from "../audio/audio-context";
import { EngineAudio } from "../audio/audio-engine";
import { SlideAudio } from "../audio/audio-slide";
import { EffectsAudio } from "../audio/audio-effects";
import { RainAudio } from "../audio/audio-rain";
import type { TuningPanel } from "./tuning";
import { ProjectilePool } from "../sim/projectile";
import { EnemyPool, EnemyType, generateEnemies } from "../sim/enemy";
import { createWeaponState, WeaponState, WeaponType } from "../sim/weapons";
import { getHighScoreChampions, getHighScores, getTrackVotes, postGameStat, postHighScore, postTrackVote } from "../net/backend-api";
import { importReplayFromJsonText as importReplayFromJsonTextPure, parseReplayBundle, type ReplayBundleV2 } from "./replay";
import { computeCameraFraming } from "./camera-framing";
import {
  computeBulletTimeWeaponAdvantage,
  computeEffectiveFireIntervalSeconds,
  computeEffectiveProjectileSpeed
} from "./weapons-runtime";

function isTouchMode(): boolean {
  try {
    const url = new URL(window.location.href);
    const forced = url.searchParams.get("mobile") === "1" || url.searchParams.get("touch") === "1";
    if (forced) return true;
  } catch {
    // ignore
  }
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export enum PlayerRole {
  DRIVER = "driver",
  NAVIGATOR = "navigator"
}

export type SoloMode = "timeTrial" | "practice";


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
  private netWaitForPeer = false;
  private netRemoteEnemies: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: "zombie" | "tank" | "colossus"; health?: number; maxHealth?: number }[] | null = null;
  private netRemoteProjectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[] | null = null;
  private netRemoteEnemyProjectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[] | null = null;
  private netRemoteNavigator: { aimX: number; aimY: number; shootHeld: boolean; shootPulse: boolean; weaponIndex: number; bulletTimeHeld?: boolean } | null = null;
  private netRemoteDriver: InputState | null = null;
  private netStatusLines: string[] = [];
  // Damage events from client navigator to host (client-authoritative shooting)
  private netClientDamageEvents: { enemyId: number; damage: number; killed: boolean; x: number; y: number; isTank: boolean; enemyType?: "zombie" | "tank" | "colossus"; radiusM?: number }[] = [];
  // Muzzle flash events from client navigator to host (so host sees shooting effects)
  private netClientMuzzleFlashEvents: { x: number; y: number; angleRad: number; weaponType: WeaponType }[] = [];
  private netDebrisDestroyedIds: number[] = [];
  private netParticleEvents: (
    | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
    | { type: "enemyDeath"; x: number; y: number; isTank: boolean; radiusM?: number }
  )[] = [];
  // Audio events to sync between host and client
  private netAudioEvents: { effect: "gunshot" | "explosion" | "impact" | "checkpoint"; volume: number; pitch: number }[] = [];
  // Audio events captured for local state replay recording (solo/host).
  private replayLocalAudioEvents: { effect: "gunshot" | "explosion" | "impact" | "checkpoint"; volume: number; pitch: number }[] = [];
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
  private gunFlash01 = 0;
  private gunFlashLastUpdateMs = 0;
  private currentQuietZones: QuietZone[] = [];
  private netBroadcastTrackDef: ((trackDef: string) => void) | null = null;
  private soloMode: SoloMode = "timeTrial";

  private finishPanel = {
    root: null as HTMLDivElement | null,
    sub: null as HTMLDivElement | null,
    rowSubmit: null as HTMLDivElement | null,
    rowVote: null as HTMLDivElement | null,
    rowNav: null as HTMLDivElement | null,
    name: null as HTMLInputElement | null,
    submit: null as HTMLButtonElement | null,
    voteUp: null as HTMLButtonElement | null,
    voteDown: null as HTMLButtonElement | null,
    retry: null as HTMLButtonElement | null,
    newTrack: null as HTMLButtonElement | null,
    replayState: null as HTMLButtonElement | null,
    replayInput: null as HTMLButtonElement | null,
    replayDownload: null as HTMLButtonElement | null,
    replayAutoDownload: null as HTMLInputElement | null,
    record: null as HTMLDivElement | null,
    msg: null as HTMLDivElement | null,
    board: null as HTMLDivElement | null
  };
  private finishPanelSeed: string | null = null;
  private finishPanelScoreMs: number | null = null;
  private finishPanelShown = false;

  private backendPlayedSent = false;
  private backendFinishedSent = false;
  private backendWreckedSent = false;

  private readonly replayStorageKey = "spaceRallyReplay:last";
  private readonly replayAutoDownloadKey = "spaceRallyReplay:autoDownload";
  private readonly replaySampleHz = 15;
  private lastReplay: ReplayBundleV2 | null = null;
  private replayRecording: ReplayBundleV2 | null = null;
  private replayRecordAccumulatorS = 0;
  private replayPlayback:
    | null
    | {
        rec: ReplayBundleV2;
        index: number;
        accumulatorS: number;
        speed: 0.5 | 1 | 2 | 4;
        ended: boolean;
      } = null;

  private replayInputRecording: ReplayBundleV2["inputs"] | null = null;
  private replayInputPlayback:
    | null
    | {
        rec: ReplayBundleV2;
        speed: 0.5 | 1 | 2 | 4;
        cursor: number;
        current: { steer: number; throttle: number; brake: number; handbrake: number };
        ended: boolean;
      } = null;

  private replayPanel = {
    root: null as HTMLDivElement | null,
    sub: null as HTMLDivElement | null,
    restart: null as HTMLButtonElement | null,
    speed: null as HTMLButtonElement | null,
    exit: null as HTMLButtonElement | null
  };

  private trackDef!: TrackDefinition; // Will be set in constructor
  private track!: ReturnType<typeof createTrackFromDefinition>; // Will be set in constructor
  private trackSegmentFillStyles: string[] = [];
  private trackSegmentShoulderStyles: string[] = [];
  private trackSegmentSurfaceNames: ("tarmac" | "gravel" | "sand" | "ice" | "offtrack")[] = [];
  private trees: CircleObstacle[] = [];
  private waterBodies: WaterBody[] = [];
  private debris: DebrisObstacle[] = [];
  private checkpointSM: number[] = [];
  private nextCheckpointIndex = 0;
  private insideActiveGate = false;
  private raceActive = false;
  private raceStartTimeSeconds = 0;
  private raceFinished = false;
  private finishTimeSeconds: number | null = null;
  private wreckedTimeSeconds: number | null = null;
  private notificationText = "";
  private notificationTimeSeconds = 0;
  private damage01 = 0;
  private lastSurface: Surface = { name: "tarmac", frictionMu: 1, rollingResistanceN: 260 };
  private currentStageThemeKind: StageThemeKind = "temperate";
  private currentStageZones: TrackZone[] = [];
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
  // Bullet-time: a per-map time budget (seconds) that is consumed while held.
  private bulletTimeRemainingS = 0;
  private bulletTimeHeldLocal = false;
  private bulletTimeActive = false;
  // Client view of host bullet-time activation.
  private bulletTimeActiveFromHost = false;
  private readonly bulletTimeBudgetS = 30.0;
  private readonly bulletTimeScale = 0.4;
  // "Player advantage" during bullet time: counteract (and exceed) the slowed sim time.
  // These values are multipliers relative to normal real-time behavior.
  private readonly bulletTimeSteerAdvantage = 2.2;
  private readonly bulletTimeBrakeAdvantage = 1.6;
  // Weapons are capped to never be faster than normal-time.
  // (During bullet time, bullets may still *feel* faster relative to the slowed world.)
  private readonly bulletTimeWeaponAdvantage = 0.32;
  private editorMode = false;
  private editorDragIndex: number | null = null;
  private editorHoverIndex: number | null = null;
  private editorPointerId: number | null = null;
  // Client interpolation quality tracking
  private netClientInterpolationDistance = 0;
  private netClientVelocityError = 0;
  // Engine simulation
  private engineState: EngineState = createEngineState();
  private readonly engineParams = defaultEngineParams();
  // Audio systems
  private readonly engineAudio = new EngineAudio();
  private readonly slideAudio = new SlideAudio();
  private readonly effectsAudio = new EffectsAudio();
  private readonly rainAudio = new RainAudio();
  private audioUnlocked = false;
  // Continuous audio state for network sync
  private continuousAudioState = { engineRpm: 0, engineThrottle: 0, slideIntensity: 0, surfaceName: "tarmac" as string };
  private running = false;
  private controlsLocked = false;
  private proceduralSeed = 0;
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

  private colossusFirePhase = 0;

  private enemyProjectiles: { x: number; y: number; vx: number; vy: number; age: number; maxAge: number }[] = [];
  private colossusShotCooldownS = 0;
  private colossusShotPhase = 0;

  private prevCarX = 0;
  private prevCarY = 0;

  private lastDebrisWarnId: number | null = null;
  private lastDebrisWarnAtSeconds = -999;

  // Simple frame timing breakdown (shown in debug menu).
  // Raw instantaneous values for internal tracking.
  private perfTimingsMs: { frame: number; bg: number; world: number; hud: number; overlays: number; rain: number } = {
    frame: 0,
    bg: 0,
    world: 0,
    hud: 0,
    overlays: 0,
    rain: 0
  };
  // Smoothed values for display (exponential moving average).
  private perfTimingsSmoothMs: { frame: number; bg: number; world: number; hud: number; overlays: number; rain: number } = {
    frame: 0,
    bg: 0,
    world: 0,
    hud: 0,
    overlays: 0,
    rain: 0
  };
  // EMA smoothing factor: 0.1 = slow/stable, 0.3 = responsive.
  private readonly perfSmoothAlpha = 0.15;

  private readonly startStageSeedStorageKey = "space-rally-last-start-stage-seed";

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
    const isTouch = isTouchMode();
    const kb = new KeyboardInput(window);

    if (isTouch) {
      this.input = new CompositeInput([
        kb,
        new TouchInput({
          setAimClientPoint: (clientX, clientY) => this.setTouchAimClientPoint(clientX, clientY),
          setShootHeld: (held) => this.setTouchShootHeld(held),
          shootPulse: () => this.touchShootPulse(),
          showOverlay: false
        })
      ]);
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
    this.setupBulletTimeButton();

    // Keep procedural seeds compact (0..999).
    // Multiplayer clients will load the host's trackDef after connecting.
    this.proceduralSeed = Math.floor(Math.random() * 1000);

    // Start with a point-to-point track
    this.setTrack(createPointToPointTrackDefinition(this.proceduralSeed));

    this.initFinishPanel();
    this.initReplayPanel();
    this.loadLastReplayFromStorage();

    if (!this.backendPlayedSent) {
      this.backendPlayedSent = true;
      void postGameStat({
        type: "played",
        seed: this.getTrackSeedString(),
        mode: this.soloMode,
        name: (localStorage.getItem("spaceRallyName") ?? "").trim().slice(0, 40) || "anonymous"
      });
    }

    // Touch: New track button (shown when finished)
    const onNewTrackClick = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      if (this.netMode === "client") return;
      this.randomizeTrack();
      if (!this.audioUnlocked) this.tryUnlockAudio();
    };
    document.getElementById("btn-new-track")?.addEventListener("click", onNewTrackClick);

    // Wrecked: on-screen reset button (shown via JS)
    const resetBtn = document.getElementById("btn-reset") as HTMLButtonElement | null;
    resetBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.netMode === "client") return;
      this.reset();
      if (!this.audioUnlocked) this.tryUnlockAudio();
    });

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

    const shouldIgnoreKey = (e: KeyboardEvent): boolean => {
      // Don't allow game controls before the game loop is running.
      if (!this.running) return true;

      // Avoid interfering with browser/system shortcuts (copy/paste, find, etc).
      if (e.ctrlKey || e.metaKey || e.altKey) return true;

      // If focus is in an input/textarea, don't steal keys.
      const target = e.target as any;
      const tag = (target?.tagName as string | undefined)?.toLowerCase?.() ?? "";
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return true;

      return false;
    };

    window.addEventListener("keydown", (e) => {
      // Don't allow game controls before the game loop is running.
      if (shouldIgnoreKey(e)) return;

      if (this.replayPlayback) {
        if (e.code === "Escape") {
          const pb = this.replayPlayback;
          if (pb && pb.rec.state.frames.length) {
            this.applyReplayFrame(pb.rec.state.frames[pb.rec.state.frames.length - 1]);
            this.controlsLocked = true;
            this.finishPanelShown = true;
            this.setFinishPanelVisible(true);
          }
          this.stopReplayPlayback();
          if (this.raceFinished) this.finishPanelShown = true;
        }
        if (e.code === "KeyR") {
          const rec = this.replayPlayback?.rec;
          if (rec) this.startReplayPlayback(rec);
        }
        return;
      }

      if (e.code === "KeyR") {
        if (this.damage01 >= 1) return;
        if (this.netMode !== "client") this.reset();
      }
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
      if (e.code === "KeyU") this.setBulletTimeHeld(true);
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

    window.addEventListener("keyup", (e) => {
      if (shouldIgnoreKey(e)) return;
      if (e.code === "KeyU") this.setBulletTimeHeld(false);
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
      this.netRemoteEnemyProjectiles = null;
      this.netClientTargetCar = null;
      this.netClientLastRenderMs = 0;
    }
    if (mode !== "host") {
      this.netRemoteNavigator = null;
      this.netRemoteDriver = null;
      this.netParticleEvents = [];
    }
  }

  public setNetWaitForPeer(wait: boolean): void {
    this.netWaitForPeer = wait;
  }

  public setNetShootPulseHandler(_handler: (() => void) | null): void {
    // No longer used - client handles shooting locally
  }

  public setNetTrackDefBroadcaster(handler: ((trackDef: string) => void) | null): void {
    this.netBroadcastTrackDef = handler;
  }

  public setSoloMode(mode: SoloMode): void {
    this.soloMode = mode;
  }

  public getSoloMode(): SoloMode {
    return this.soloMode;
  }

  private getTrackSeedString(): string {
    const seed = this.trackDef?.meta?.seed;
    if (typeof seed === "number" && Number.isFinite(seed)) return String(Math.floor(seed));
    // Fallback: keep stable-ish for editor/imported tracks.
    return "0";
  }

  private resetFinishPanel(): void {
    this.finishPanelSeed = null;
    this.finishPanelScoreMs = null;
    this.finishPanelShown = false;
    this.backendFinishedSent = false;
    this.backendWreckedSent = false;

    if (this.finishPanel.record) this.finishPanel.record.textContent = "";
    if (this.finishPanel.msg) this.finishPanel.msg.textContent = "";
    if (this.finishPanel.board) this.finishPanel.board.textContent = "";
    this.setFinishPanelVisible(false);
  }

  private setFinishPanelVisible(visible: boolean): void {
    const root = this.finishPanel.root;
    if (!root) return;
    root.style.display = visible ? "flex" : "none";
  }

  private initFinishPanel(): void {
    this.finishPanel.root = document.getElementById("finish-panel") as HTMLDivElement | null;
    this.finishPanel.sub = document.getElementById("finish-sub") as HTMLDivElement | null;
    this.finishPanel.rowSubmit = document.getElementById("finish-row-submit") as HTMLDivElement | null;
    this.finishPanel.rowVote = document.getElementById("finish-row-vote") as HTMLDivElement | null;
    this.finishPanel.rowNav = document.getElementById("finish-row-nav") as HTMLDivElement | null;
    this.finishPanel.name = document.getElementById("finish-name") as HTMLInputElement | null;
    this.finishPanel.submit = document.getElementById("finish-submit") as HTMLButtonElement | null;
    this.finishPanel.voteUp = document.getElementById("finish-vote-up") as HTMLButtonElement | null;
    this.finishPanel.voteDown = document.getElementById("finish-vote-down") as HTMLButtonElement | null;
    this.finishPanel.newTrack = document.getElementById("finish-new-track") as HTMLButtonElement | null;
    this.finishPanel.replayState = document.getElementById("finish-replay-state") as HTMLButtonElement | null;
    this.finishPanel.replayInput = document.getElementById("finish-replay-input") as HTMLButtonElement | null;
    this.finishPanel.replayDownload = document.getElementById("finish-replay-download") as HTMLButtonElement | null;
    this.finishPanel.replayAutoDownload = document.getElementById("finish-replay-auto-download") as HTMLInputElement | null;
    this.finishPanel.record = document.getElementById("finish-record") as HTMLDivElement | null;
    this.finishPanel.msg = document.getElementById("finish-msg") as HTMLDivElement | null;
    this.finishPanel.board = document.getElementById("finish-board") as HTMLDivElement | null;

    const nameEl = this.finishPanel.name;
    if (nameEl) {
      const saved = localStorage.getItem("spaceRallyName") ?? "";
      if (!nameEl.value) nameEl.value = saved;
      nameEl.addEventListener("change", () => {
        try {
          localStorage.setItem("spaceRallyName", nameEl.value.trim().slice(0, 40));
        } catch {
          // ignore
        }
      });
    }

    this.finishPanel.submit?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const seed = this.finishPanelSeed;
      const scoreMs = this.finishPanelScoreMs;
      const name = (this.finishPanel.name?.value ?? "").trim().slice(0, 40) || "anonymous";
      if (!seed || !scoreMs) return;

      if (this.netMode === "client") {
        if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Only the driver can submit.";
        return;
      }

      if (this.finishPanel.submit) this.finishPanel.submit.disabled = true;
      if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Submitting score...";

      try {
        localStorage.setItem("spaceRallyName", name);
      } catch {
        // ignore
      }

      const avgSpeedKmH = this.finishTimeSeconds !== null ? (this.track.totalLengthM / this.finishTimeSeconds) * 3.6 : undefined;
      const res = await postHighScore({ name, scoreMs, seed, mode: this.soloMode, avgSpeedKmH, netMode: this.netMode });
      if (this.finishPanel.msg) this.finishPanel.msg.textContent = res.ok ? "Score submitted." : "Score submit failed (offline?).";
      if (this.finishPanel.submit) this.finishPanel.submit.disabled = false;

      void this.refreshFinishPanelData();
    });

    this.finishPanel.newTrack?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.netMode === "client") {
        // Allow net clients to escape the finish screen on mobile (no keyboard Escape).
        const url = new URL(window.location.href);
        url.searchParams.delete("room");
        url.searchParams.delete("host");
        url.searchParams.delete("role");
        window.location.href = url.toString();
        return;
      }

      this.finishPanelShown = false;
      this.setFinishPanelVisible(false);
      // Move on.
      this.randomizeTrack();
      if (!this.audioUnlocked) this.tryUnlockAudio();
    });

    const vote = async (type: "up" | "down"): Promise<void> => {
      const seed = this.finishPanelSeed;
      if (!seed) return;

      if (this.netMode === "client") {
        if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Only the driver can vote.";
        return;
      }

      if (this.netMode === "solo" && this.soloMode === "practice") {
        if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Practice runs can't vote.";
        return;
      }

      const key = `spaceRallyVote:${seed}`;
      if (localStorage.getItem(key)) return;

      if (this.finishPanel.voteUp) this.finishPanel.voteUp.disabled = true;
      if (this.finishPanel.voteDown) this.finishPanel.voteDown.disabled = true;
      if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Sending vote...";

      const res = await postTrackVote(seed, type, { mode: this.soloMode });
      if (res.ok) {
        try {
          localStorage.setItem(key, type);
        } catch {
          // ignore
        }
        if (this.finishPanel.msg) this.finishPanel.msg.textContent = type === "up" ? "Upvoted." : "Downvoted.";
      } else {
        if (this.finishPanel.msg) this.finishPanel.msg.textContent = "Vote failed (offline?).";
      }

      void this.refreshFinishPanelData();
    };

    this.finishPanel.voteUp?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void vote("up");
    });
    this.finishPanel.voteDown?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void vote("down");
    });

    this.finishPanel.replayState?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rec = this.lastReplay;
      if (!rec || rec.state.frames.length === 0) return;
      this.startReplayPlayback(rec);
    });

    this.finishPanel.replayInput?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rec = this.lastReplay;
      if (!rec || !rec.inputs || rec.inputs.events.length === 0) return;
      this.startInputReplayPlayback(rec);
    });

    this.finishPanel.replayDownload?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const res = this.downloadLastReplay();
      if (this.finishPanel.msg) this.finishPanel.msg.textContent = res.ok ? "Replay downloaded." : (res.error ?? "No replay to download.");
    });

    const autoDl = this.finishPanel.replayAutoDownload;
    if (autoDl) {
      try {
        autoDl.checked = localStorage.getItem(this.replayAutoDownloadKey) === "1";
      } catch {
        autoDl.checked = false;
      }
      autoDl.addEventListener("change", () => {
        try {
          localStorage.setItem(this.replayAutoDownloadKey, autoDl.checked ? "1" : "0");
        } catch {
          // ignore
        }
      });
    }

    if (this.finishPanel.replayState) this.finishPanel.replayState.disabled = true;
    if (this.finishPanel.replayInput) this.finishPanel.replayInput.disabled = true;
    if (this.finishPanel.replayDownload) this.finishPanel.replayDownload.disabled = !this.lastReplay;

    this.setFinishPanelVisible(false);
  }

  private updateFinishPanelReplayButtons(): void {
    const seed = this.finishPanelSeed;
    const rec = this.lastReplay;

    if (this.finishPanel.replayDownload) this.finishPanel.replayDownload.disabled = !rec;

    if (this.finishPanel.replayState) {
      const ok = !!seed && !!rec && rec.seed === seed && rec.state.frames.length > 0;
      this.finishPanel.replayState.disabled = !ok;
    }
    if (this.finishPanel.replayInput) {
      const ok = !!seed && !!rec && rec.seed === seed && !!rec.inputs && rec.inputs.events.length > 0;
      this.finishPanel.replayInput.disabled = !ok;
    }
  }

  private initReplayPanel(): void {
    this.replayPanel.root = document.getElementById("replay-panel") as HTMLDivElement | null;
    this.replayPanel.sub = document.getElementById("replay-sub") as HTMLDivElement | null;
    this.replayPanel.restart = document.getElementById("replay-restart") as HTMLButtonElement | null;
    this.replayPanel.speed = document.getElementById("replay-speed") as HTMLButtonElement | null;
    this.replayPanel.exit = document.getElementById("replay-exit") as HTMLButtonElement | null;

    this.replayPanel.restart?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.replayPlayback) {
        this.startReplayPlayback(this.replayPlayback.rec);
        return;
      }
      if (this.replayInputPlayback) {
        this.startInputReplayPlayback(this.replayInputPlayback.rec);
      }
    });

    this.replayPanel.speed?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pb = this.replayPlayback;
      const ipb = this.replayInputPlayback;
      if (!pb && !ipb) return;
      const cur = pb ? pb.speed : (ipb ? ipb.speed : 1);
      const next: 0.5 | 1 | 2 | 4 = cur === 1
        ? 2
        : cur === 2
          ? 4
          : cur === 4
            ? 0.5
            : 1;
      if (pb) pb.speed = next;
      if (ipb) ipb.speed = next;
      this.updateReplayPanelUi();
    });

    this.replayPanel.exit?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pb = this.replayPlayback;
      // For STATE replays (started from the finish panel), always restore the final frame
      // so exiting replay returns to the finish screen instead of leaving you mid-run.
      if (pb && pb.rec.state.frames.length) {
        this.applyReplayFrame(pb.rec.state.frames[pb.rec.state.frames.length - 1]);
        this.controlsLocked = true;
        this.finishPanelShown = true;
        this.setFinishPanelVisible(true);
      }
      this.stopReplayPlayback();
      // For other cases (e.g. INPUT replay), fall back to existing behavior.
      if (this.raceFinished) {
        this.finishPanelShown = true;
      }
    });

    this.setReplayPanelVisible(false);
  }

  private setReplayPanelVisible(visible: boolean): void {
    const root = this.replayPanel.root;
    if (!root) return;
    root.style.display = visible ? "flex" : "none";
  }

  private updateReplayPanelUi(): void {
    const pb = this.replayPlayback;
    const ipb = this.replayInputPlayback;
    if (!pb && !ipb) return;

    const speed = pb ? pb.speed : (ipb ? ipb.speed : 1);
    if (this.replayPanel.speed) this.replayPanel.speed.textContent = `SPEED: ${speed}×`;

    if (pb) {
      const total = pb.rec.state.frames.length;
      const idx = Math.min(pb.index + 1, total);
      const seed = pb.rec.seed;
      const timeS = this.finishTimeSeconds !== null ? this.finishTimeSeconds.toFixed(2) : "--";
      const status = pb.ended ? "(END)" : "";
      if (this.replayPanel.sub) this.replayPanel.sub.textContent = `MODE: STATE | Track: ${seed} | Frame: ${idx}/${total} | Time: ${timeS}s ${status}`.trim();
      return;
    }

    if (ipb) {
      const seed = ipb.rec.seed;
      const timeS = this.finishTimeSeconds !== null ? this.finishTimeSeconds.toFixed(2) : "--";
      const status = ipb.ended ? "(END)" : "";
      if (this.replayPanel.sub) this.replayPanel.sub.textContent = `MODE: INPUTS | Track: ${seed} | Time: ${timeS}s ${status}`.trim();
    }
  }

  private commitLastReplay(rec: ReplayBundleV2): void {
    this.lastReplay = rec;
    try {
      localStorage.setItem(this.replayStorageKey, JSON.stringify(rec));
    } catch {
      // ignore
    }
    (globalThis as any).__SPACE_RALLY_LAST_REPLAY__ = this.lastReplay;
    this.updateFinishPanelReplayButtons();
  }

  private downloadReplayBundle(rec: ReplayBundleV2): { ok: true } | { ok: false; error: string } {
    try {
      const ts = new Date(rec.createdAtMs || Date.now());
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${ts.getFullYear()}-${pad2(ts.getMonth() + 1)}-${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}${pad2(ts.getSeconds())}`;
      const seedSafe = (rec.seed || "0").replace(/[^0-9a-zA-Z_-]+/g, "_");
      const filename = `space-rally_replay_v2_seed-${seedSafe}_${stamp}.json`;

      const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    } catch {
      return { ok: false, error: "Download failed." };
    }
  }

  public downloadLastReplay(): { ok: true } | { ok: false; error: string } {
    const rec = this.lastReplay;
    if (!rec) return { ok: false, error: "No replay recorded yet." };
    return this.downloadReplayBundle(rec);
  }

  public importReplayFromJsonText(text: string): { ok: true } | { ok: false; error: string } {
    const res = importReplayFromJsonTextPure(text);
    if (!res.ok) return res;
    this.commitLastReplay(res.rec);
    return { ok: true };
  }

  public playLastReplay(mode: "auto" | "state" | "inputs" = "auto"): boolean {
    const rec = this.lastReplay;
    if (!rec) return false;

    const canState = rec.state.frames.length > 0;
    const canInputs = !!rec.inputs && rec.inputs.events.length > 0;

    if (mode === "inputs") {
      if (!canInputs) return false;
      this.startInputReplayPlayback(rec);
      return true;
    }

    if (mode === "state") {
      if (!canState) return false;
      this.startReplayPlayback(rec);
      return true;
    }

    if (canInputs) {
      this.startInputReplayPlayback(rec);
      return true;
    }
    if (canState) {
      this.startReplayPlayback(rec);
      return true;
    }
    return false;
  }

  private loadLastReplayFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.replayStorageKey);
      if (!raw) return;
      const parsed: any = JSON.parse(raw);
      const rec = parseReplayBundle(parsed);
      if (!rec) return;
      this.lastReplay = rec;
      (globalThis as any).__SPACE_RALLY_LAST_REPLAY__ = this.lastReplay;
      this.updateFinishPanelReplayButtons();
    } catch {
      // ignore
    }
  }

  private onRaceFinishedUi(): void {
    this.finishPanelSeed = this.getTrackSeedString();
    this.finishPanelScoreMs = this.finishTimeSeconds !== null ? Math.max(1, Math.floor(this.finishTimeSeconds * 1000)) : null;
    this.finishPanelShown = true;

    this.updateFinishPanelReplayButtons();

    if (!this.backendFinishedSent) {
      this.backendFinishedSent = true;
      const scoreMs = this.finishPanelScoreMs;
      const avgSpeedKmH = this.finishTimeSeconds !== null ? (this.track.totalLengthM / this.finishTimeSeconds) * 3.6 : undefined;
      const name = (this.finishPanel.name?.value ?? "").trim().slice(0, 40) || (localStorage.getItem("spaceRallyName") ?? "").trim().slice(0, 40) || "anonymous";
      void postGameStat({ type: "finished", seed: this.finishPanelSeed, mode: this.soloMode, name, scoreMs: scoreMs ?? undefined, avgSpeedKmH });
    }

    const timeS = this.finishTimeSeconds !== null ? this.finishTimeSeconds.toFixed(2) : "--";
    if (this.finishPanel.sub) this.finishPanel.sub.textContent = `Time: ${timeS}s`;
    if (this.finishPanel.record) this.finishPanel.record.textContent = "";
    if (this.finishPanel.msg) this.finishPanel.msg.textContent = "";

    void this.refreshFinishPanelData();
  }

  private async refreshFinishPanelData(): Promise<void> {
    const seed = this.finishPanelSeed;
    if (!seed) return;

    const key = `spaceRallyVote:${seed}`;
    const voted = ((): "up" | "down" | null => {
      const v = localStorage.getItem(key);
      return v === "up" || v === "down" ? v : null;
    })();

    const canVote = this.netMode !== "client" && this.soloMode !== "practice";
    if (this.finishPanel.voteUp) this.finishPanel.voteUp.disabled = !canVote || !!voted;
    if (this.finishPanel.voteDown) this.finishPanel.voteDown.disabled = !canVote || !!voted;

    // For testing: allow score submissions from solo + practice too (still disallow net clients).
    const canSubmit = this.netMode !== "client";
    if (this.finishPanel.rowSubmit) this.finishPanel.rowSubmit.style.display = canSubmit ? "flex" : "none";
    if (this.finishPanel.submit) this.finishPanel.submit.disabled = !canSubmit;

    if (this.finishPanel.rowVote) this.finishPanel.rowVote.style.display = canVote ? "flex" : "none";
    if (this.finishPanel.rowNav) this.finishPanel.rowNav.style.display = "flex";

    // Keep finish navigation usable in every mode.
    if (this.finishPanel.newTrack) {
      if (this.netMode === "client") {
        this.finishPanel.newTrack.textContent = "LEAVE ROOM";
        this.finishPanel.newTrack.disabled = false;
      } else {
        this.finishPanel.newTrack.textContent = "NEW TRACK";
        this.finishPanel.newTrack.disabled = false;
      }
    }

    const [votes, scores, champions] = await Promise.all([
      getTrackVotes(seed),
      // Fetch more than we display so we can show counts + ties.
      getHighScores({ seed, limit: 100 }),
      getHighScoreChampions({ limit: 5 })
    ]);

    // Record/congrats messaging (separate from transient submit/vote status).
    if (this.finishPanel.record) {
      const playerScoreMs = this.finishPanelScoreMs;
      const playerName = (this.finishPanel.name?.value ?? "").trim().slice(0, 40)
        || (localStorage.getItem("spaceRallyName") ?? "").trim().slice(0, 40)
        || "anonymous";

      if (!scores.ok || playerScoreMs === null) {
        this.finishPanel.record.textContent = "";
      } else {
        const rows = scores.scores;
        const hasAny = rows.length > 0;
        const bestMs = hasAny ? rows[0]!.score : null;
        const wouldBeBest = bestMs === null || playerScoreMs <= bestMs;
        const isTie = bestMs !== null && playerScoreMs === bestMs;
        const bestTieCount = bestMs !== null ? rows.filter((r) => r.score === bestMs).length : 0;

        // Heuristic: detect whether *this exact run* is already on the board.
        const probablyAlreadyRecorded = rows.some((r) => r.score === playerScoreMs && r.name === playerName);
        const otherFinishers = Math.max(0, rows.length - (probablyAlreadyRecorded ? 1 : 0));
        const otherFinishersLabel = otherFinishers === 1 ? "other person" : "other people";

        if (!wouldBeBest) {
          this.finishPanel.record.textContent = "";
        } else if (!hasAny) {
          this.finishPanel.record.textContent = "Congrats — you're the first recorded finisher on this seed (0 others so far). Submit to claim #1.";
        } else if (isTie) {
          if (bestTieCount >= 2) {
            const others = Math.max(0, bestTieCount - 1);
            this.finishPanel.record.textContent = `Congrats — you're tied for #1. (${others} ${others === 1 ? "other" : "others"} share the best time.)`;
          } else {
            this.finishPanel.record.textContent = "Congrats — you're currently #1 on this seed.";
          }
        } else {
          const prevBestS = bestMs !== null ? (bestMs / 1000).toFixed(3) : "--";
          this.finishPanel.record.textContent = `Congrats — you're currently #1 on this seed (previous best: ${prevBestS}s). ${otherFinishers} ${otherFinishersLabel} have recorded a finish.`;
        }
      }
    }

    const lines: string[] = [];
    if (votes.ok) {
      lines.push(`VOTES:  👍 ${votes.upvotes}   👎 ${votes.downvotes}`);
    } else {
      lines.push("VOTES:  (unavailable)");
    }

    lines.push("");
    lines.push("TOP TIMES (THIS TRACK)");

    if (scores.ok && scores.scores.length > 0) {
      const showN = Math.min(6, scores.scores.length);
      if (scores.scores.length > showN) {
        lines.push(`(showing ${showN} of ${scores.scores.length})`);
        lines.push("");
      }
      for (let i = 0; i < showN; i++) {
        const s = scores.scores[i];
        const sec = (s.score / 1000).toFixed(3);
        lines.push(`${i + 1}. ${sec}s  ${s.name}`);
      }
    } else {
      lines.push("(none yet)");
    }

    lines.push("");
    lines.push("TOP #1 HOLDERS");
    if (champions.ok && champions.leaders.length > 0) {
      for (let i = 0; i < champions.leaders.length; i++) {
        const c = champions.leaders[i];
        const total = Math.max(0, champions.totalTracks);
        const share = total > 0 ? Math.round((c.firstPlaceTracks / total) * 100) : 0;
        lines.push(`${i + 1}. ${c.firstPlaceTracks} #1s (${c.soloFirstPlaceTracks} solo)  ${c.name}  ${total > 0 ? `(${share}%)` : ""}`.trim());
      }
    } else {
      lines.push("(unavailable)");
    }

    if (voted) {
      lines.push("");
      lines.push(voted === "up" ? "You voted: 👍" : "You voted: 👎");
    }

    if (this.finishPanel.board) this.finishPanel.board.textContent = lines.join("\n");
  }

  private getReplaySnapshotNonDestructive(): NetSnapshot {
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
      enemyProjectiles: this.enemyProjectiles.map((p) => ({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        color: "rgba(255, 120, 40, 0.95)",
        size: 0.34,
        age: p.age,
        maxAge: p.maxAge
      })),
      particleEvents: this.netParticleEvents.slice(),
      debrisDestroyed: this.netDebrisDestroyedIds.slice(),
      // For replays we want the local one-shot audio, not just network-queued audio.
      audioEvents: this.replayLocalAudioEvents.slice(),
      continuousAudio: { ...this.continuousAudioState },
      raceActive: this.raceActive,
      raceStartTimeSeconds: this.raceStartTimeSeconds,
      raceFinished: this.raceFinished,
      finishTimeSeconds: this.finishTimeSeconds,
      damage01: this.damage01,
      enemyKillCount: this.enemyKillCount,
      cameraMode: this.cameraMode,
      cameraRotationRad: this.cameraRotationRad,
      shakeX: this.cameraShakeX,
      shakeY: this.cameraShakeY
    };
  }

  private getDriverInputForReplayRecording(): { steer: number; throttle: number; brake: number; handbrake: number } {
    // Record the *driver* controls actually used by the host sim.
    const raw = this.lastInputState;
    const driverInput = (this.netMode === "host" && this.netRemoteDriver) ? this.netRemoteDriver : raw;
    return {
      steer: clamp(driverInput.steer, -1, 1),
      throttle: clamp(driverInput.throttle, 0, 1),
      brake: clamp(driverInput.brake, 0, 1),
      handbrake: clamp(driverInput.handbrake, 0, 1)
    };
  }

  private startReplayRecording(): void {
    if (this.netMode === "client") return;
    const seed = this.getTrackSeedString();
    const trackDef = this.getSerializedTrackDef();

    const inputs: ReplayBundleV2["inputs"] = {
      startTimeSeconds: this.state.timeSeconds,
      startCar: { ...this.state.car },
      startEngine: { ...this.engineState },
      startGear: this.gear,
      events: []
    };

    // Seed inputs with the current driver state at t=0.
    const d0 = this.getDriverInputForReplayRecording();
    inputs.events.push({ t: 0, steer: d0.steer, throttle: d0.throttle, brake: d0.brake, handbrake: d0.handbrake });

    this.replayRecording = {
      v: 2,
      createdAtMs: Date.now(),
      seed,
      trackDef,
      state: {
        sampleHz: this.replaySampleHz,
        frames: []
      },
      inputs
    };
    this.replayInputRecording = inputs;
    this.replayRecordAccumulatorS = 0;
    this.replayRecording.state.frames.push(this.getReplaySnapshotNonDestructive());
    this.replayLocalAudioEvents.length = 0;
  }

  private stopReplayRecording(commitToLast: boolean): void {
    if (!this.replayRecording) return;
    // Capture the final state.
    this.replayRecording.state.frames.push(this.getReplaySnapshotNonDestructive());
    this.replayLocalAudioEvents.length = 0;

    const rec = this.replayRecording;
    this.replayRecording = null;
    this.replayInputRecording = null;
    this.replayRecordAccumulatorS = 0;

    if (!commitToLast) return;

    this.commitLastReplay(rec);

    try {
      const autoDl = localStorage.getItem(this.replayAutoDownloadKey) === "1";
      if (autoDl) {
        this.downloadReplayBundle(rec);
      }
    } catch {
      // ignore
    }
  }

  private recordReplayFrame(dtSeconds: number): void {
    const rec = this.replayRecording;
    if (!rec) return;
    if (!this.raceActive) return;

    // Cap to ~3 minutes at current sampling rate.
    const maxFrames = Math.floor(rec.state.sampleHz * 180);
    if (rec.state.frames.length >= maxFrames) {
      this.stopReplayRecording(true);
      return;
    }

    this.replayRecordAccumulatorS += dtSeconds;
    const stepS = 1 / rec.state.sampleHz;
    while (this.replayRecordAccumulatorS >= stepS) {
      this.replayRecordAccumulatorS -= stepS;
      rec.state.frames.push(this.getReplaySnapshotNonDestructive());
      // Ensure one-shot SFX are only captured once.
      this.replayLocalAudioEvents.length = 0;
    }
  }

  private recordReplayInputAtTime(timeSeconds: number, driverInput: { steer: number; throttle: number; brake: number; handbrake: number }): void {
    const inputs = this.replayInputRecording;
    if (!inputs) return;
    if (!this.raceActive) return;

    const t = Math.max(0, timeSeconds - inputs.startTimeSeconds);
    const events = inputs.events;
    const last = events.length ? events[events.length - 1] : null;

    // Quantize slightly to avoid noisy touch jitter exploding event count.
    const q = (x: number): number => Math.round(clamp(x, -1, 1) * 256) / 256;
    const steer = q(driverInput.steer);
    const throttle = q(driverInput.throttle);
    const brake = q(driverInput.brake);
    const handbrake = q(driverInput.handbrake);

    if (last && last.steer === steer && last.throttle === throttle && last.brake === brake && last.handbrake === handbrake) return;

    // Cap to a generous upper bound (~60Hz * 5min) to avoid unbounded storage.
    if (events.length >= 18000) return;
    events.push({ t, steer, throttle, brake, handbrake });
  }

  private applyReplayFrame(frame: NetSnapshot): void {
    this.state = { ...this.state, timeSeconds: frame.t, car: { ...this.state.car, ...frame.car } };

    // Use the "net remote" containers as our replay render sources.
    this.netRemoteEnemies = frame.enemies.map((e) => ({ ...e }));
    this.netRemoteProjectiles = frame.projectiles.map((p) => ({ ...p }));
    this.netRemoteEnemyProjectiles = frame.enemyProjectiles.map((p) => ({ ...p }));

    this.raceActive = frame.raceActive;
    this.raceStartTimeSeconds = frame.raceStartTimeSeconds;
    this.raceFinished = frame.raceFinished;
    this.finishTimeSeconds = frame.finishTimeSeconds;
    this.damage01 = clamp(frame.damage01, 0, 1);
    this.enemyKillCount = frame.enemyKillCount;
    this.cameraMode = frame.cameraMode;
    this.cameraRotationRad = frame.cameraRotationRad;
    this.cameraShakeX = frame.shakeX;
    this.cameraShakeY = frame.shakeY;

    // Drive continuous audio during state replay.
    if (this.audioUnlocked) {
      const ca = frame.continuousAudio;
      this.engineAudio.update(ca.engineRpm, ca.engineThrottle, { timeScale: this.getBulletTimeScale() });
      const surfaceForSlide = { name: ca.surfaceName, frictionMu: 1.0, rollingResistanceMu: 0.01 };
      this.slideAudio.update(ca.slideIntensity, surfaceForSlide as any, { timeScale: this.getBulletTimeScale() });
    }
  }

  private applyReplayFrameInterpolated(a: NetSnapshot, b: NetSnapshot, alpha: number): void {
    const t = clamp(alpha, 0, 1);
    const lerp = (x: number, y: number): number => x + (y - x) * t;
    const wrapPi = (ang: number): number => {
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      return ang;
    };
    const lerpAngle = (x: number, y: number): number => x + wrapPi(y - x) * t;

    this.state = {
      ...this.state,
      timeSeconds: lerp(a.t, b.t),
      car: {
        ...this.state.car,
        xM: lerp(a.car.xM, b.car.xM),
        yM: lerp(a.car.yM, b.car.yM),
        headingRad: lerpAngle(a.car.headingRad, b.car.headingRad),
        vxMS: lerp(a.car.vxMS, b.car.vxMS),
        vyMS: lerp(a.car.vyMS, b.car.vyMS),
        yawRateRadS: lerp(a.car.yawRateRadS, b.car.yawRateRadS),
        steerAngleRad: lerp(a.car.steerAngleRad, b.car.steerAngleRad),
        alphaFrontRad: lerp(a.car.alphaFrontRad, b.car.alphaFrontRad),
        alphaRearRad: lerp(a.car.alphaRearRad, b.car.alphaRearRad)
      }
    };

    // For non-car entities, pick the nearer frame (keeps CPU low).
    const pick = t >= 0.5 ? b : a;
    this.netRemoteEnemies = pick.enemies.map((e) => ({ ...e }));
    this.netRemoteProjectiles = pick.projectiles.map((p) => ({ ...p }));
    this.netRemoteEnemyProjectiles = pick.enemyProjectiles.map((p) => ({ ...p }));

    this.raceActive = pick.raceActive;
    this.raceStartTimeSeconds = pick.raceStartTimeSeconds;
    this.raceFinished = pick.raceFinished;
    this.finishTimeSeconds = pick.finishTimeSeconds;
    this.damage01 = clamp(pick.damage01, 0, 1);
    this.enemyKillCount = pick.enemyKillCount;
    this.cameraMode = pick.cameraMode;
    this.cameraRotationRad = lerpAngle(a.cameraRotationRad, b.cameraRotationRad);
    this.cameraShakeX = lerp(a.shakeX, b.shakeX);
    this.cameraShakeY = lerp(a.shakeY, b.shakeY);

    // Interpolate continuous audio too so engine/slide sound doesn't "step".
    if (this.audioUnlocked) {
      const ca0 = a.continuousAudio;
      const ca1 = b.continuousAudio;
      const rpm = lerp(ca0.engineRpm, ca1.engineRpm);
      const thr = lerp(ca0.engineThrottle, ca1.engineThrottle);
      const slide = lerp(ca0.slideIntensity, ca1.slideIntensity);
      this.engineAudio.update(rpm, thr, { timeScale: this.getBulletTimeScale() });
      const surfaceForSlide = { name: (t >= 0.5 ? ca1.surfaceName : ca0.surfaceName), frictionMu: 1.0, rollingResistanceMu: 0.01 };
      this.slideAudio.update(slide, surfaceForSlide as any, { timeScale: this.getBulletTimeScale() });
    }
  }

  private playReplayAudioEvents(frame: NetSnapshot): void {
    if (!this.audioUnlocked) return;
    if (!frame.audioEvents || frame.audioEvents.length === 0) return;
    for (const ev of frame.audioEvents) {
      if (!ev) continue;
      this.effectsAudio.playEffect(ev.effect, ev.volume, ev.pitch);
    }
  }

  private startReplayPlayback(rec: ReplayBundleV2): void {
    if (!rec.state.frames.length) return;

    // Ensure a clean world before applying snapshots.
    this.stopReplayPlayback();
    this.stopReplayRecording(false);

    // If the replay is from a different track, load it.
    if (rec.trackDef && this.getSerializedTrackDef() !== rec.trackDef) {
      const ok = this.loadSerializedTrackDef(rec.trackDef);
      if (!ok) return;
    }

    // Reset sim-side state so leftover enemies/projectiles/particles don't leak into replay UI.
    this.reset();

    this.replayInputPlayback = null;
    this.controlsLocked = true;
    this.finishPanelShown = false;
    this.setFinishPanelVisible(false);

    this.replayPlayback = { rec, index: 0, accumulatorS: 0, speed: 1, ended: false };
    this.applyReplayFrame(rec.state.frames[0]);
    this.playReplayAudioEvents(rec.state.frames[0]);
    this.setReplayPanelVisible(true);
    this.updateReplayPanelUi();
  }

  private stopReplayPlayback(): void {
    this.replayPlayback = null;
    this.replayInputPlayback = null;
    this.setReplayPanelVisible(false);
  }

  private stepReplayPlayback(dtSeconds: number): void {
    const pb = this.replayPlayback;
    if (!pb) return;
    if (pb.ended) {
      this.updateReplayPanelUi();
      return;
    }

    pb.accumulatorS += dtSeconds * pb.speed;
    const stepS = 1 / pb.rec.state.sampleHz;
    const frames = pb.rec.state.frames;
    while (pb.accumulatorS >= stepS && !pb.ended) {
      pb.accumulatorS -= stepS;
      pb.index += 1;
      if (pb.index >= frames.length) {
        pb.index = frames.length - 1;
        pb.ended = true;
        break;
      }
      this.playReplayAudioEvents(frames[pb.index]);
    }

    // Smoothly interpolate between snapshot frames to avoid visible "15Hz" stepping.
    const a = frames[pb.index];
    const b = frames[Math.min(frames.length - 1, pb.index + 1)];
    if (a && b && !pb.ended && b !== a) {
      this.applyReplayFrameInterpolated(a, b, pb.accumulatorS / stepS);
    } else if (a) {
      this.applyReplayFrame(a);
    }

    this.updateReplayPanelUi();
  }

  private startInputReplayPlayback(rec: ReplayBundleV2): void {
    const inputs = rec.inputs;
    if (!inputs || inputs.events.length === 0) return;

    // Ensure a clean world before deterministic playback.
    this.stopReplayPlayback();
    this.stopReplayRecording(false);

    // If the replay is from a different track, load it.
    if (rec.trackDef && this.getSerializedTrackDef() !== rec.trackDef) {
      const ok = this.loadSerializedTrackDef(rec.trackDef);
      if (!ok) return;
    }

    // Reset world state (enemies/debris/projectiles/etc). We may be in practice mode, but
    // input replays should still recreate the original world as closely as possible.
    this.reset();

    const wantsEnemies = !!rec.state.frames[0] && Array.isArray(rec.state.frames[0].enemies) && rec.state.frames[0].enemies.length > 0;
    if (!wantsEnemies) {
      this.enemyPool.clear();
    } else {
      const treeSeed = Math.floor(this.trackDef.meta?.seed ?? 20260123);
      const enemies = generateEnemies(this.track, { seed: treeSeed + 1337, quietZones: this.currentQuietZones });
      this.enemyPool.setEnemies(enemies);
    }

    // Ensure replay cannot generate backend events.
    this.backendFinishedSent = true;
    this.backendWreckedSent = true;

    this.finishPanelShown = false;
    this.setFinishPanelVisible(false);

    // Restore initial deterministic state.
    this.controlsLocked = false;
    this.damage01 = 0;
    this.wreckedTimeSeconds = null;
    this.raceFinished = false;
    this.raceActive = true;
    this.raceStartTimeSeconds = inputs.startTimeSeconds;
    this.finishTimeSeconds = null;
    this.state.timeSeconds = inputs.startTimeSeconds;
    this.state.car = { ...inputs.startCar };
    this.engineState = { ...inputs.startEngine };
    this.gear = inputs.startGear;

    // Match the in-race state at the moment we started recording.
    this.nextCheckpointIndex = 1;
    this.insideActiveGate = true;

    this.replayInputPlayback = {
      rec,
      speed: 1,
      cursor: 0,
      current: { steer: 0, throttle: 0, brake: 0, handbrake: 0 },
      ended: false
    };

    // Prime current input from t=0 and show overlay.
    this.stepInputReplayPlayback(inputs.startTimeSeconds);
    this.setReplayPanelVisible(true);
    this.updateReplayPanelUi();
  }

  private stepInputReplayPlayback(timeBeforeSeconds: number): void {
    const ipb = this.replayInputPlayback;
    if (!ipb) return;
    const inputs = ipb.rec.inputs;
    if (!inputs) return;
    if (ipb.ended) {
      this.updateReplayPanelUi();
      return;
    }

    const t = Math.max(0, timeBeforeSeconds - inputs.startTimeSeconds);
    const events = inputs.events;
    while (ipb.cursor < events.length && events[ipb.cursor].t <= t) {
      const ev = events[ipb.cursor];
      ipb.current = { steer: ev.steer, throttle: ev.throttle, brake: ev.brake, handbrake: ev.handbrake };
      ipb.cursor += 1;
    }

    // Feed inputs into the sim via lastInputState.
    this.lastInputState = { ...ipb.current, shoot: false, fromKeyboard: false };
    this.updateReplayPanelUi();
  }

  public getAndClearClientDamageEvents(): { enemyId: number; damage: number; killed: boolean; x: number; y: number; isTank: boolean; enemyType?: "zombie" | "tank" | "colossus"; radiusM?: number }[] {
    return this.netClientDamageEvents.splice(0, this.netClientDamageEvents.length);
  }

  public getAndClearClientMuzzleFlashEvents(): { x: number; y: number; angleRad: number; weaponType: WeaponType }[] {
    return this.netClientMuzzleFlashEvents.splice(0, this.netClientMuzzleFlashEvents.length);
  }

  public getClientProjectiles(): { x: number; y: number; vx: number; vy: number; color?: string; size?: number }[] {
    return this.projectilePool.getActive().map(p => ({
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, color: p.color, size: p.size
    }));
  }

  public applyRemoteNavigatorProjectiles(projectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number }[]): void {
    // Store for rendering on host side
    this.netRemoteProjectiles = projectiles;
  }

  public applyRemoteDamageEvents(events: { enemyId: number; damage: number; killed: boolean; x: number; y: number; isTank: boolean; enemyType?: "zombie" | "tank" | "colossus"; radiusM?: number }[]): void {
    for (const ev of events) {
      if (ev.killed) {
        // Kill the enemy and create death particles
        const enemy = this.enemyPool.getAll().find((e) => e.id === ev.enemyId) ?? null;
        const isTank = enemy?.type === EnemyType.TANK ? true : ev.isTank;
        const radiusM = enemy?.radius ?? ev.radiusM ?? (isTank ? 0.9 : 0.6);
        this.enemyPool.damage(ev.enemyId, 999); // Ensure death
        this.enemyKillCount++;
        this.createEnemyDeathParticles(ev.x, ev.y, isTank, radiusM);
        // Queue particle event for syncing back to client (client already sees it locally, but keeps host in sync)
        this.netParticleEvents.push({ type: "enemyDeath", x: ev.x, y: ev.y, isTank, radiusM });
      } else {
        // Just damage
        this.enemyPool.damage(ev.enemyId, ev.damage);
      }
    }
  }

  public applyRemoteMuzzleFlashEvents(events: { x: number; y: number; angleRad: number; weaponType: WeaponType }[]): void {
    for (const ev of events) {
      // Trigger muzzle flash particles on host
      this.emitMuzzleFlash({ x: ev.x, y: ev.y, angleRad: ev.angleRad, weaponType: ev.weaponType });
      // Play gunshot sound
      let vol = 1.0;
      let pitch = 1.0;
      if (ev.weaponType === WeaponType.RIFLE) { vol = 1.25; pitch = 0.65; }
      else if (ev.weaponType === WeaponType.AK47) { vol = 0.7; pitch = 1.2; }
      else if (ev.weaponType === WeaponType.SHOTGUN) { vol = 1.1; pitch = 0.6; }
      this.playNetEffect("gunshot", vol, pitch);
    }
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
    enemies?: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: "zombie" | "tank" | "colossus"; health?: number; maxHealth?: number }[];
    projectiles?: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[];
    enemyProjectiles?: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age?: number; maxAge?: number }[];
    particleEvents?: (
      | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
      | { type: "enemyDeath"; x: number; y: number; isTank: boolean; radiusM?: number }
    )[];
    debrisDestroyed?: number[];
    audioEvents?: { effect: "gunshot" | "explosion" | "impact" | "checkpoint"; volume: number; pitch: number }[];
    continuousAudio?: { engineRpm: number; engineThrottle: number; slideIntensity: number; surfaceName: string };
    raceActive?: boolean;
    raceStartTimeSeconds?: number;
    raceFinished?: boolean;
    finishTimeSeconds?: number | null;
    damage01?: number;
    enemyKillCount?: number;
    cameraMode?: "follow" | "runner";
    cameraRotationRad?: number;
    shakeX?: number;
    shakeY?: number;
    bulletTimeRemainingS?: number;
    bulletTimeActive?: boolean;
  }): void {
    // In client mode, smooth toward target to avoid jitter.
    this.state = { ...this.state, timeSeconds: snapshot.t };
    if (snapshot.cameraMode) this.cameraMode = snapshot.cameraMode;
    if (snapshot.cameraRotationRad !== undefined) {
      const mode = snapshot.cameraMode ?? this.cameraMode;
      const offset = (this.role === PlayerRole.NAVIGATOR && mode === "runner") ? (Math.PI / 2) : 0;
      this.cameraRotationRad = snapshot.cameraRotationRad + offset;
    }
    if (snapshot.shakeX !== undefined) this.cameraShakeX = snapshot.shakeX;
    if (snapshot.shakeY !== undefined) this.cameraShakeY = snapshot.shakeY;
    
    this.netClientTargetCar = snapshot.car;
    if (this.netMode === "client" && this.netClientLastRenderMs === 0) {
      this.state = { ...this.state, car: { ...this.state.car, ...snapshot.car } };
    }

    if (snapshot.enemies) this.netRemoteEnemies = snapshot.enemies.map((e) => ({ ...e }));
    if (snapshot.projectiles) this.netRemoteProjectiles = snapshot.projectiles.map((p) => ({ ...p }));
    if (snapshot.enemyProjectiles) this.netRemoteEnemyProjectiles = snapshot.enemyProjectiles.map((p) => ({ ...p }));
    if (snapshot.debrisDestroyed && snapshot.debrisDestroyed.length) {
      const destroyed = new Set(snapshot.debrisDestroyed);
      this.debris = this.debris.filter((d) => !destroyed.has(d.id));
      if (this.lastDebrisWarnId !== null && destroyed.has(this.lastDebrisWarnId)) {
        this.lastDebrisWarnId = null;
      }
    }
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
          this.createEnemyDeathParticles(ev.x, ev.y, ev.isTank, ev.radiusM);
        }
      }
    }
    // Play synced audio events from host
    if (snapshot.audioEvents && this.audioUnlocked) {
      for (const ev of snapshot.audioEvents) {
        if (!ev) continue;
        this.effectsAudio.playEffect(ev.effect, ev.volume, ev.pitch);
      }
    }
    // Update continuous audio (engine/slide) from host state
    if (snapshot.continuousAudio && this.audioUnlocked) {
      const ca = snapshot.continuousAudio;
      this.engineAudio.update(ca.engineRpm, ca.engineThrottle, { timeScale: this.getBulletTimeScale() });
      // Map surface name to a surface object for slide audio
      const surfaceForSlide = { name: ca.surfaceName, frictionMu: 1.0, rollingResistanceMu: 0.01 };
      this.slideAudio.update(ca.slideIntensity, surfaceForSlide as any, { timeScale: this.getBulletTimeScale() });
    }
    if (typeof snapshot.raceActive === "boolean") this.raceActive = snapshot.raceActive;
    if (typeof snapshot.raceStartTimeSeconds === "number") this.raceStartTimeSeconds = snapshot.raceStartTimeSeconds;
    if (typeof snapshot.raceFinished === "boolean") {
      const wasFinished = this.raceFinished;
      this.raceFinished = snapshot.raceFinished;
      if (this.raceFinished) this.controlsLocked = true;
      if (!wasFinished && this.raceFinished) {
        // Ensure the finish UI shows up for net clients too.
        this.onRaceFinishedUi();
      }
    }
    if (snapshot.finishTimeSeconds !== undefined) this.finishTimeSeconds = snapshot.finishTimeSeconds;
    if (typeof snapshot.damage01 === "number") {
      this.damage01 = clamp(snapshot.damage01, 0, 1);
      if (this.damage01 >= 1) {
        if (this.wreckedTimeSeconds === null) this.wreckedTimeSeconds = this.state.timeSeconds;
        if (!this.backendWreckedSent) {
          this.backendWreckedSent = true;
          void postGameStat({
            type: "wrecked",
            seed: this.getTrackSeedString(),
            mode: this.soloMode,
            name: (localStorage.getItem("spaceRallyName") ?? "").trim().slice(0, 40) || "anonymous"
          });
        }
      } else {
        this.wreckedTimeSeconds = null;
      }
    }
    if (typeof snapshot.enemyKillCount === "number") this.enemyKillCount = snapshot.enemyKillCount;

    if (typeof snapshot.bulletTimeRemainingS === "number") {
      this.bulletTimeRemainingS = Math.max(0, snapshot.bulletTimeRemainingS);
      this.updateBulletTimeUi();
    }
    if (typeof snapshot.bulletTimeActive === "boolean") {
      this.bulletTimeActiveFromHost = snapshot.bulletTimeActive;
      this.updateBulletTimeUi();
    }
  }

  public applyRemoteNavigatorInput(input: { aimX: number; aimY: number; shootHeld: boolean; shootPulse: boolean; weaponIndex: number; bulletTimeHeld?: boolean }): void {
    this.netRemoteNavigator = input;
  }

  public applyRemoteDriverInput(input: InputState, _opts?: { bulletTimeHeld?: boolean }): void {
    this.netRemoteDriver = input;
  }

  public getAimWorld(): { x: number; y: number } {
    return { x: this.mouseWorldX, y: this.mouseWorldY };
  }

  public setTouchAimClientPoint(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = clientX - rect.left;
    this.mouseY = clientY - rect.top;
    // Keep world-space aim in sync so tap-to-shoot uses the latest position.
    this.updateMouseWorldPosition();
  }

  public setTouchShootHeld(held: boolean): void {
    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return;
    if (this.role !== PlayerRole.NAVIGATOR) return;
    this.shootHeld = held;
    if (held && !this.audioUnlocked) {
      this.tryUnlockAudio();
    }
  }

  public touchShootPulse(): void {
    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return;
    if (this.role !== PlayerRole.NAVIGATOR) return;
    if (!this.audioUnlocked) {
      this.tryUnlockAudio();
    }

    // Ensure tap-to-shoot uses the most recent touch aim (world-space).
    this.updateMouseWorldPosition();

    // In net client mode, client is authoritative for shooting.
    if (this.netMode === "client") {
      this.clientShoot();
      return;
    }

    // In solo/host mode, fire locally.
    this.shoot();
  }

  public getCurrentWeaponIndex(): number {
    return this.currentWeaponIndex;
  }

  public getNavigatorShootHeld(): boolean {
    // Touch uses shootHeld; keyboard uses lastInputState.shoot (KeyL).
    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return false;
    return (this.role === PlayerRole.NAVIGATOR) && (this.shootHeld || !!this.lastInputState.shoot);
  }

  public setRoleExternal(role: PlayerRole): void {
    // Network-owned role assignment (allowed even in multiplayer).
    this.setRole(role, true);
  }

  public getRoleExternal(): PlayerRole {
    return this.role;
  }

  public getInputStateExternal(): InputState {
    if (!this.controlsLocked) return this.lastInputState;
    return { steer: 0, throttle: 0, brake: 0, handbrake: 0, shoot: false, fromKeyboard: false };
  }

  private setRole(role: PlayerRole, force = false): void {
    // In multiplayer, roles are fixed (driver hosts, co-driver joins).
    // Prevent local toggles from creating confusing states.
    if (!force && this.netMode !== "solo") return;

    this.role = role;
    this.showNotification(`ROLE: ${role.toUpperCase()}`);

    // Snap camera rotation to match new role immediately (no smooth transition)
    if (this.cameraMode === "runner") {
      const roleOffset = role === PlayerRole.NAVIGATOR ? 0 : Math.PI / 2;
      this.cameraRotationRad = -this.state.car.headingRad - roleOffset;
    }

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
      if (roleToggle) roleToggle.textContent = "Gunner";
    }

    this.updateAmmoDisplay();
    this.updateBulletTimeUi();
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

  public notify(text: string): void {
    this.showNotification(text);
  }

  private randomizeTrack(): void {
    // Random seed (so "next track" isn't just seed+1).
    const rand01 = (): number => {
      try {
        const c: any = globalThis as any;
        const cryptoObj: Crypto | undefined = c.crypto;
        if (cryptoObj?.getRandomValues) {
          const buf = new Uint32Array(1);
          cryptoObj.getRandomValues(buf);
          return (buf[0] ?? 0) / 0x1_0000_0000;
        }
      } catch {
        // ignore
      }
      return Math.random();
    };

    const randomIntInclusive = (min: number, max: number): number => {
      return min + Math.floor(rand01() * (max - min + 1));
    };

    let seed = randomIntInclusive(0, 999);
    for (let i = 0; i < 10 && seed === this.proceduralSeed; i++) {
      seed = randomIntInclusive(0, 999);
    }

    this.proceduralSeed = seed;
    const def = createPointToPointTrackDefinition(this.proceduralSeed);
    this.setTrack(def);
    this.reset();
  }

  private refillAmmo(): void {
    for (const w of this.weapons) {
      const cap = w.stats.ammoCapacity;
      w.ammo = cap === -1 ? -1 : Math.max(0, Math.floor(cap));
      w.lastFireTime = -100;
    }
    this.updateAmmoDisplay();
  }

  public pickRandomStartStage(opts?: { minSeed?: number; maxSeed?: number }): number {
    // In multiplayer client mode, the host owns track selection.
    if (this.netMode === "client") return this.trackDef.meta?.seed ?? this.proceduralSeed;

    const minSeed = Math.max(0, Math.floor(opts?.minSeed ?? 0));
    const maxSeed = Math.min(999, Math.max(minSeed, Math.floor(opts?.maxSeed ?? 999)));

    const lastRaw = localStorage.getItem(this.startStageSeedStorageKey);
    const lastSeed = lastRaw ? Number.parseInt(lastRaw, 10) : NaN;

    const rand01 = (): number => {
      try {
        const c: any = globalThis as any;
        const cryptoObj: Crypto | undefined = c.crypto;
        if (cryptoObj?.getRandomValues) {
          const buf = new Uint32Array(1);
          cryptoObj.getRandomValues(buf);
          return (buf[0] ?? 0) / 0x1_0000_0000;
        }
      } catch {
        // ignore
      }
      return Math.random();
    };

    const randomIntInclusive = (min: number, max: number): number => {
      return min + Math.floor(rand01() * (max - min + 1));
    };

    let seed = randomIntInclusive(minSeed, maxSeed);
    for (let i = 0; i < 10 && Number.isFinite(lastSeed) && seed === lastSeed; i++) {
      seed = randomIntInclusive(minSeed, maxSeed);
    }

    this.proceduralSeed = seed;
    const def = createPointToPointTrackDefinition(this.proceduralSeed);
    this.setTrack(def);
    this.reset();
    localStorage.setItem(this.startStageSeedStorageKey, String(seed));
    return seed;
  }

  private onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    // Keep aim responsive for click-to-shoot.
    this.updateMouseWorldPosition();
  };

  private onMouseClick = (): void => {
    // On touch devices, use pointerdown for immediate shooting (click fires on touchup).
    const isTouch = isTouchMode();
    if (isTouch) return;

    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return;

    if (this.netMode === "client" && this.role === PlayerRole.NAVIGATOR) {
      // Client is authoritative for their own shooting
      this.clientShoot();
      return;
    }

    // Unlock audio on first click
    if (!this.audioUnlocked) {
      this.tryUnlockAudio();
    }

    // Ensure we shoot at the latest cursor position.
    this.updateMouseWorldPosition();
    this.shoot();
  };

  private onPointerAimMove = (e: PointerEvent): void => {
    // Keep aim updated for pointer inputs (especially touch).
    if (this.shootPointerId !== null && e.pointerId !== this.shootPointerId) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    // Keep world-space aim in sync so taps don't lag a frame.
    this.updateMouseWorldPosition();
  };

  private onShootPointerDown = (e: PointerEvent): void => {
    // Avoid interfering with editor interactions.
    if (this.editorMode) return;
    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return;
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

  private emitMuzzleFlash(opts: { x: number; y: number; angleRad: number; weaponType: WeaponType }): void {
    // Dramatic flash/sparks to make shooting feel punchier.
    const ax = Math.cos(opts.angleRad);
    const ay = Math.sin(opts.angleRad);
    const originX = opts.x + ax * 1.05;
    const originY = opts.y + ay * 1.05;

    let burst = 10;
    let size = 0.18;
    let life = 0.085;
    let flashStrength = 0.55;
    if (opts.weaponType === WeaponType.AK47) { burst = 12; size = 0.17; life = 0.08; flashStrength = 0.50; }
    if (opts.weaponType === WeaponType.RIFLE) { burst = 14; size = 0.18; life = 0.085; flashStrength = 0.62; }
    if (opts.weaponType === WeaponType.SHOTGUN) { burst = 22; size = 0.22; life = 0.095; flashStrength = 0.95; }

    // Brief screen bloom (decays in render).
    this.gunFlash01 = Math.max(this.gunFlash01, Math.min(1, flashStrength));

    // Core flash: big + very short.
    const coreCount = opts.weaponType === WeaponType.SHOTGUN ? 2 : 1;
    this.emitParticles({
      x: originX,
      y: originY,
      vx: ax * 1.2,
      vy: ay * 1.2,
      lifetime: life * 0.55,
      sizeM: size * 2.4,
      color: "rgba(255, 255, 245, 0.98)",
      count: coreCount
    });

    // Cone flash.
    const groups = 3;
    const perGroup = Math.max(1, Math.floor(burst / groups));
    for (let i = 0; i < groups; i++) {
      const jitter = (Math.random() - 0.5) * 0.80;
      const a = opts.angleRad + jitter;
      const s = 7.0 + Math.random() * 6.5;
      this.emitParticles({
        x: originX,
        y: originY,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        lifetime: life,
        sizeM: size,
        color: "rgba(255, 235, 195, 0.95)",
        count: perGroup
      });
    }

    // Orange sparks.
    const sparkCount = Math.max(3, Math.floor(burst * 0.35));
    for (let i = 0; i < 3; i++) {
      const jitter = (Math.random() - 0.5) * 0.95;
      const a = opts.angleRad + jitter;
      const s = 9.0 + Math.random() * 9.0;
      this.emitParticles({
        x: originX,
        y: originY,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        lifetime: 0.15,
        sizeM: 0.12,
        color: "rgba(255, 160, 70, 0.92)",
        count: Math.max(1, Math.floor(sparkCount / 3))
      });
    }

    // A little smoke bloom behind the flash.
    const smokeCount = opts.weaponType === WeaponType.SHOTGUN ? 3 : 2;
    for (let i = 0; i < smokeCount; i++) {
      const jitter = (Math.random() - 0.5) * 1.1;
      const a = opts.angleRad + jitter;
      const s = 0.8 + Math.random() * 1.4;
      this.emitParticles({
        x: originX - ax * 0.25,
        y: originY - ay * 0.25,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        lifetime: 0.35,
        sizeM: 0.24 + Math.random() * 0.10,
        color: "rgba(60, 60, 60, 0.22)",
        count: 1
      });
    }
  }

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
      this.updateAmmoDisplay();
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
    this.updateAmmoDisplay();
  }

  private setupBulletTimeButton(): void {
    const btn = document.getElementById("btn-bullet-time") as HTMLDivElement | null;
    if (!btn) return;

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      this.setBulletTimeHeld(true);
      if (!this.audioUnlocked) {
        this.tryUnlockAudio();
      }
    });

    btn.addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setBulletTimeHeld(false);
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    });

    btn.addEventListener("pointercancel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setBulletTimeHeld(false);
    });

    this.updateBulletTimeUi();
  }

  private canRequestBulletTimeLocal(): boolean {
    // Only the co-driver (navigator) can request bullet time in multiplayer.
    // Exception: in solo desktop mode, allow any role (debug/playground convenience).
    const isTouch = isTouchMode();
    if (this.netMode === "solo" && !isTouch) return true;
    return this.role === PlayerRole.NAVIGATOR;
  }

  private updateBulletTimeUi(): void {
    const btn = document.getElementById("btn-bullet-time") as HTMLDivElement | null;
    if (!btn) return;

    const started = document.body.classList.contains("started");
    const isTouch = isTouchMode();
    const shouldShow = started && isTouch && this.role === PlayerRole.NAVIGATOR;
    if (!shouldShow) {
      btn.style.display = "none";
      return;
    }

    btn.style.display = "flex";

    const remaining = Math.max(0, this.bulletTimeRemainingS);
    const active = this.bulletTimeActive;
    const empty = remaining <= 1e-6;

    // In net client mode, bullet time activation is host-authoritative.
    // Give the navigator immediate feedback that they're *requesting* it.
    const requesting = this.netMode === "client" && this.canRequestBulletTimeLocal() && this.bulletTimeHeldLocal && !empty;

    btn.classList.toggle("used", empty && !active);
    btn.classList.toggle("active", active || requesting);

    if (active) {
      btn.textContent = `${remaining.toFixed(1)}s`;
    } else if (empty) {
      btn.textContent = "0.0s";
    } else {
      btn.textContent = "SLOW";
    }
  }

  private getBulletTimeScale(): number {
    return this.bulletTimeActive ? this.bulletTimeScale : 1.0;
  }

  private computeDesiredBulletTimeActive(): boolean {
    if (this.editorMode) return false;
    if (this.controlsLocked || this.raceFinished || this.damage01 >= 1) return false;
    if (this.bulletTimeRemainingS <= 1e-6) return false;

    // In client mode, host is authoritative; we follow the host's active flag.
    if (this.netMode === "client") {
      return this.bulletTimeActiveFromHost;
    }

    const remoteNavHeld = !!this.netRemoteNavigator?.bulletTimeHeld;
    const localHeld = this.canRequestBulletTimeLocal() ? this.bulletTimeHeldLocal : false;
    // Driver-held bullet time is intentionally ignored in multiplayer.
    return localHeld || remoteNavHeld;
  }

  private updateBulletTime(realDtSeconds: number): void {
    const desired = this.computeDesiredBulletTimeActive();
    if (desired && !this.bulletTimeActive) {
      this.showNotification("BULLET TIME");
    }
    this.bulletTimeActive = desired;

    // Only the host/solo drains budget (client follows snapshots).
    if (this.netMode !== "client" && this.bulletTimeActive) {
      this.bulletTimeRemainingS = Math.max(0, this.bulletTimeRemainingS - realDtSeconds);
      if (this.bulletTimeRemainingS <= 1e-6) this.bulletTimeActive = false;
    }

    this.updateBulletTimeUi();
  }

  private setBulletTimeHeld(held: boolean): void {
    if (held && !this.canRequestBulletTimeLocal()) {
      // Force-clear any accidental/old state (e.g. driver role or pre-start).
      if (this.bulletTimeHeldLocal) this.bulletTimeHeldLocal = false;
      this.updateBulletTimeUi();
      return;
    }
    if (held === this.bulletTimeHeldLocal) return;
    this.bulletTimeHeldLocal = held;

    this.updateBulletTimeUi();
  }

  public getBulletTimeHeld(): boolean {
    return this.canRequestBulletTimeLocal() ? this.bulletTimeHeldLocal : false;
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

  private updateAmmoDisplay(): void {
    const el = document.getElementById("ammo-display");
    if (!(el instanceof HTMLDivElement)) return;

    // Only show for Navigator; driver doesn't need it.
    el.style.display = this.role === PlayerRole.NAVIGATOR ? "block" : "none";

    const weapon = this.weapons[this.currentWeaponIndex];
    if (!weapon) {
      el.textContent = "";
      return;
    }

    const cap = weapon.stats.ammoCapacity;
    el.textContent = cap === -1 ? "∞" : `${weapon.ammo}/${cap}`;
  }

  public getNetSnapshot(): {
    t: number;
    car: { xM: number; yM: number; headingRad: number; vxMS: number; vyMS: number; yawRateRadS: number; steerAngleRad: number; alphaFrontRad: number; alphaRearRad: number };
    enemies: { id: number; x: number; y: number; radius: number; vx: number; vy: number; type?: string; health?: number; maxHealth?: number }[];
    projectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age: number; maxAge: number }[];
    enemyProjectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number; age: number; maxAge: number }[];
    particleEvents: (
      | { type: "emit"; opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number } }
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
    bulletTimeRemainingS: number;
    bulletTimeActive: boolean;
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
      enemyProjectiles: this.enemyProjectiles.map((p) => ({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        color: "rgba(255, 120, 40, 0.95)",
        size: 0.34,
        age: p.age,
        maxAge: p.maxAge
      })),
      particleEvents: this.netParticleEvents.splice(0, this.netParticleEvents.length),
      debrisDestroyed: this.netDebrisDestroyedIds.splice(0, this.netDebrisDestroyedIds.length),
      audioEvents: this.netAudioEvents.splice(0, this.netAudioEvents.length),
      continuousAudio: { ...this.continuousAudioState },
      raceActive: this.raceActive,
      raceStartTimeSeconds: this.raceStartTimeSeconds,
      raceFinished: this.raceFinished,
      finishTimeSeconds: this.finishTimeSeconds,
      damage01: this.damage01,
      enemyKillCount: this.enemyKillCount,
      cameraMode: this.cameraMode,
      cameraRotationRad: this.cameraRotationRad,
      shakeX: this.cameraShakeX,
      shakeY: this.cameraShakeY,
      bulletTimeRemainingS: this.bulletTimeRemainingS,
      bulletTimeActive: this.bulletTimeActive
    };
  }

  private emitParticles(opts: { x: number; y: number; vx: number; vy: number; lifetime: number; sizeM: number; color: string; count?: number }): void {
    this.particlePool.emit(opts);
    if (this.netMode === "host") {
      this.netParticleEvents.push({ type: "emit", opts });
    }
  }

  /**
   * Play an audio effect locally and queue it for network sync (host only).
   * Client receives these via audioEvents in the snapshot.
   */
  private playNetEffect(effect: "gunshot" | "explosion" | "impact" | "checkpoint", volume: number = 1.0, pitch: number = 1.0): void {
    if (!this.audioUnlocked) return;
    const timeScale = this.getBulletTimeScale();
    const pitchScale = 0.10 + 0.90 * timeScale;
    // Play locally
    this.effectsAudio.playEffect(effect, volume, pitch * pitchScale);
    // Capture for local replay recording (solo/host).
    if (this.replayRecording) {
      this.replayLocalAudioEvents.push({ effect, volume, pitch: pitch * pitchScale });
    }
    // Queue for network sync (host sends to client)
    if (this.netMode === "host") {
      this.netAudioEvents.push({ effect, volume, pitch: pitch * pitchScale });
    }
  }

  /**
   * Client-authoritative shooting: client handles projectiles, collisions, and damage locally.
   * Damage events are sent to host to update enemy state.
   */
  private clientShoot(): void {
    if (this.netMode !== "client") return;
    
    const weapon = this.weapons[this.currentWeaponIndex];
    if (!weapon) return;
    
    // Check ammo
    if (weapon.ammo === 0) return;
    
    // Rate limit (timeSeconds is scaled by bullet-time; compensate to make shooting faster during bullet time)
    const now = this.state.timeSeconds;
    const bulletScale = this.getBulletTimeScale();
    const weaponAdv = computeBulletTimeWeaponAdvantage(this.bulletTimeActive, bulletScale, this.bulletTimeWeaponAdvantage);
    const interval = computeEffectiveFireIntervalSeconds(weapon.stats.fireInterval, this.bulletTimeActive, bulletScale, weaponAdv);
    if (now - weapon.lastFireTime < interval) return;
    weapon.lastFireTime = now;
    
    // Consume ammo
    if (weapon.ammo > 0) {
      weapon.ammo--;
    }
    this.updateAmmoDisplay();
    
    // Spawn local projectiles
    const carX = this.state.car.xM;
    const carY = this.state.car.yM;
    const stats = weapon.stats;
    
    const dx = this.mouseWorldX - carX;
    const dy = this.mouseWorldY - carY;
    const baseAngle = Math.atan2(dy, dx);

    this.emitMuzzleFlash({ x: carX, y: carY, angleRad: baseAngle, weaponType: stats.type });
    // Queue muzzle flash event for network sync (so host sees the flash too)
    this.netClientMuzzleFlashEvents.push({ x: carX, y: carY, angleRad: baseAngle, weaponType: stats.type });
    
    for (let i = 0; i < stats.projectileCount; i++) {
      const spread = (Math.random() - 0.5) * stats.spread;
      const angle = baseAngle + spread;
      const dist = 10;
      const targetX = carX + Math.cos(angle) * dist;
      const targetY = carY + Math.sin(angle) * dist;
      
      const projectileSpeed = computeEffectiveProjectileSpeed(stats.projectileSpeed, this.bulletTimeActive, bulletScale, weaponAdv);

      this.projectilePool.spawn(
        carX, carY, targetX, targetY,
        projectileSpeed,
        stats.damage,
        stats.projectileColor,
        stats.projectileSize
      );
    }
    
    // Play gunshot sound locally
    if (this.audioUnlocked) {
      let vol = 1.0;
      let pitch = 1.0;
      if (stats.type === WeaponType.RIFLE) { vol = 1.25; pitch = 0.65; }
      else if (stats.type === WeaponType.AK47) { vol = 0.7; pitch = 1.2; }
      else if (stats.type === WeaponType.SHOTGUN) { vol = 1.1; pitch = 0.6; }
      this.effectsAudio.playEffect("gunshot", vol, pitch);
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

    // Rate limit (timeSeconds is scaled by bullet-time; compensate to make shooting faster during bullet time)
    const now = this.state.timeSeconds;
    const bulletScale = this.getBulletTimeScale();
    const weaponAdv = computeBulletTimeWeaponAdvantage(this.bulletTimeActive, bulletScale, this.bulletTimeWeaponAdvantage);
    const interval = computeEffectiveFireIntervalSeconds(weapon.stats.fireInterval, this.bulletTimeActive, bulletScale, weaponAdv);
    if (now - weapon.lastFireTime < interval) return;

    weapon.lastFireTime = now;
    if (weapon.ammo > 0) {
      weapon.ammo--;
    }
    this.updateAmmoDisplay();

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

    this.emitMuzzleFlash({ x: carX, y: carY, angleRad: baseAngle, weaponType: stats.type });

    for (let i = 0; i < stats.projectileCount; i++) {
      // Apply spread
      const spread = (Math.random() - 0.5) * stats.spread;
      const angle = baseAngle + spread;

      // Calculate target from angle
      const dist = 10; // Arbitrary distance to define direction
      const targetX = carX + Math.cos(angle) * dist;
      const targetY = carY + Math.sin(angle) * dist;

      const projectileSpeed = computeEffectiveProjectileSpeed(stats.projectileSpeed, this.bulletTimeActive, bulletScale, weaponAdv);

      this.projectilePool.spawn(
        carX,
        carY,
        targetX,
        targetY,
        projectileSpeed,
        stats.damage,
        stats.projectileColor,
        stats.projectileSize
      );
    }

    // Play gunshot sound - use weapon specific pitch/volume
    let vol = 1.0;
    let pitch = 1.0;
    if (stats.type === WeaponType.RIFLE) { vol = 1.25; pitch = 0.65; }
    else if (stats.type === WeaponType.AK47) { vol = 0.7; pitch = 1.2; }
    else if (stats.type === WeaponType.SHOTGUN) { vol = 1.1; pitch = 0.6; } // Deep boom
    this.playNetEffect("gunshot", vol, pitch);
  }

  private updateMouseWorldPosition(): void {
    // Use renderer's screenToWorld method which properly handles camera rotation
    const worldPos = this.renderer.screenToWorld(this.mouseX, this.mouseY);
    this.mouseWorldX = worldPos.x;
    this.mouseWorldY = worldPos.y;
  }

  private setTrack(def: TrackDefinition): void {
    this.resetFinishPanel();

    // Track change == new map: reset bullet-time availability.
    this.bulletTimeRemainingS = this.bulletTimeBudgetS;
    this.bulletTimeHeldLocal = false;
    this.bulletTimeActive = false;
    this.bulletTimeActiveFromHost = false;
    this.updateBulletTimeUi();

    // New contract == reload.
    this.refillAmmo();

    // Ensure stage meta exists deterministically if we have a seed.
    const seed = def.meta?.seed;
    if (typeof seed === "number" && Number.isFinite(seed)) {
      const stageMeta = stageMetaFromSeed(seed);
      const meta = def.meta ?? {};
      const theme = meta.theme ?? stageMeta.theme;
      const zones = meta.zones ?? stageMeta.zones;
      def = { ...def, meta: { ...meta, theme, zones } };
    }

    const themeRef = def.meta?.theme ?? { kind: "temperate" as const };
    this.currentStageThemeKind = themeRef.kind;
    this.currentStageZones = def.meta?.zones ?? [];

    const trackSeed = def.meta?.seed ?? 1;
    this.currentQuietZones = quietZonesFromSeed(trackSeed);
    this.trackSegmentFillStyles = [];
    this.trackSegmentShoulderStyles = [];
    this.trackSegmentSurfaceNames = [];

    const theme = resolveStageTheme(themeRef);

    // Build an initial track so we can sample sM for deterministic surface/width generation.
    // Then compute per-segment widths that vary more (especially for gravel/sand).
    // Keep the result stable across peers via (seed + segment index) hashing.
    const initialTrack = createTrackFromDefinition(def);

    const widthRand01 = (segmentIdx: number): number => {
      const seed = (Math.floor(trackSeed) || 1) * 131 + segmentIdx * 17 + 0x9e3779b9;
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };

    const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

    const computedWidths: number[] = new Array(initialTrack.points.length);
    for (let i = 0; i < initialTrack.points.length; i++) {
      const midSM = initialTrack.cumulativeLengthsM[i] + initialTrack.segmentLengthsM[i] * 0.5;
      const surface = surfaceForTrackSM(initialTrack.totalLengthM, midSM, false, trackSeed, themeRef.kind);

      const baseW = (def.segmentWidthsM && def.segmentWidthsM.length === initialTrack.points.length)
        ? (def.segmentWidthsM[i] ?? def.baseWidthM)
        : def.baseWidthM;

      // Deterministic per-segment variability.
      const r = widthRand01(i);
      let minMult = 0.70;
      let maxMult = 1.10;
      if (surface.name === "tarmac") {
        minMult = 0.75;
        maxMult = 1.08;
      } else if (surface.name === "gravel" || surface.name === "sand") {
        // Gravel/sand routes: can be very tight squeezes or moderately wide sections.
        minMult = 0.30;
        maxMult = 1.40;
      } else if (surface.name === "ice") {
        minMult = 0.50;
        maxMult = 1.25;
      }

      // Bias toward the center for tarmac, but allow extremes for gravel.
      const shaped = surface.name === "tarmac" ? (0.5 + (r - 0.5) * 0.55) : r;
      const mult = lerp(minMult, maxMult, clamp01(shaped));
      computedWidths[i] = baseW * mult;
    }

    // Smooth once to avoid sharp width discontinuities.
    for (let pass = 0; pass < 1; pass++) {
      for (let i = 0; i < computedWidths.length; i++) {
        const a = computedWidths[(i - 1 + computedWidths.length) % computedWidths.length];
        const b = computedWidths[i];
        const c = computedWidths[(i + 1) % computedWidths.length];
        computedWidths[i] = (a + b * 2 + c) / 4;
      }
    }

    // Rebuild track with the computed widths so projection/collisions match visuals.
    def = { ...def, segmentWidthsM: computedWidths };
    this.trackDef = def;
    this.track = createTrackFromDefinition(def);

    for (let i = 0; i < this.track.points.length; i++) {
      const midSM = this.track.cumulativeLengthsM[i] + this.track.segmentLengthsM[i] * 0.5;
      const surface = surfaceForTrackSM(this.track.totalLengthM, midSM, false, trackSeed, themeRef.kind);
      this.trackSegmentFillStyles.push(surfaceFillStyle(surface));
      // Track type flavor: a solid, stable underlay beneath the road.
      this.trackSegmentShoulderStyles.push(theme.offtrackBgColor);
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
    this.trees = generateTrees(this.track, { seed: treeSeed, themeKind: themeRef.kind });
    this.trees.push(...generateEdgeRocks(this.track, { seed: treeSeed + 4242, themeKind: themeRef.kind, trackSeed }));
    this.waterBodies = generateWaterBodies(this.track, { seed: treeSeed + 777, quietZones: this.currentQuietZones });
    const spawnEnemies = !(this.netMode === "solo" && this.soloMode === "practice");
    if (spawnEnemies) {
      const enemies = generateEnemies(this.track, { seed: treeSeed + 1337, quietZones: this.currentQuietZones });
      this.enemyPool.setEnemies(enemies);
    } else {
      this.enemyPool.clear();
    }

    // If we're the host, broadcast track changes so clients refresh immediately (minimap, hazards, etc).
    if (this.netMode === "host" && this.netBroadcastTrackDef) {
      try {
        this.netBroadcastTrackDef(this.getSerializedTrackDef());
      } catch {
        // ignore
      }
    }

    // Reset stage-related state when swapping tracks.
    this.stopReplayPlayback();
    this.stopReplayRecording(false);
    this.raceActive = false;
    this.raceStartTimeSeconds = this.state.timeSeconds;
    this.raceFinished = false;
    this.finishTimeSeconds = null;
    this.nextCheckpointIndex = 0;
    this.insideActiveGate = false;
  }

  private async tryUnlockAudio(): Promise<void> {
    if (this.audioUnlocked) return;
    const unlocked = await unlockAudio();
    if (unlocked) {
      this.audioUnlocked = true;
      this.engineAudio.start();
      this.slideAudio.start();
      this.effectsAudio.start();
      this.rainAudio.start();
    }
  }

  // Called from explicit user gestures (start menu, invite button, etc).
  public unlockAudioFromUserGesture(): void {
    void this.tryUnlockAudio();
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

    const realDtSeconds = dtSeconds;

    this.updateBulletTime(realDtSeconds);
    dtSeconds *= this.getBulletTimeScale();

    const timeBeforeSeconds = this.state.timeSeconds;

    if (this.replayPlayback) {
      this.stepReplayPlayback(dtSeconds);
      return;
    }

    if (this.replayInputPlayback) {
      // Drive the sim using recorded inputs, and scale time by replay speed.
      this.stepInputReplayPlayback(timeBeforeSeconds);
      dtSeconds *= this.replayInputPlayback.speed;
    } else {
      // Always update inputs so net-clients can send them.
      this.lastInputState = this.input.getState();
    }

    // After finish (or other hard locks), ignore controls entirely.
    if (this.controlsLocked) {
      this.lastInputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0, shoot: false, fromKeyboard: false };
      this.shootHeld = false;
    }

    // Client navigator handles their own projectiles (client-authoritative shooting)
    if (this.netMode === "client") {
      this.stepClientProjectiles(dtSeconds);
      return;
    }

    if (this.netWaitForPeer) {
      return;
    }

    // Snapshot previous position for robust gate-crossing detection.
    this.prevCarX = this.state.car.xM;
    this.prevCarY = this.state.car.yM;

    this.state.timeSeconds += dtSeconds;

    this.applyTuning();

    const inputsEnabled = this.damage01 < 1 && !this.controlsLocked;
    const rawInput = this.lastInputState;

    // Split input by role - although keyboard allows both for solo testing, 
    // we enforce the role logic strictly for touch users.
    const isDriverLocal = this.role === PlayerRole.DRIVER || !!rawInput.fromKeyboard;
    const isNavigatorLocal = this.role === PlayerRole.NAVIGATOR || !!rawInput.fromKeyboard;

    // Use remote driver input if we are host and a remote driver is connected
    const driverInput = (this.netMode === "host" && this.netRemoteDriver) ? this.netRemoteDriver : rawInput;
    const isDriverRemote = this.netMode === "host" && !!this.netRemoteDriver;

    // Record the driver input timeline for input replay (host/solo only).
    if (!this.replayInputPlayback) {
      this.recordReplayInputAtTime(timeBeforeSeconds, {
        steer: driverInput.steer,
        throttle: driverInput.throttle,
        brake: driverInput.brake,
        handbrake: driverInput.handbrake
      });
    }

    // Driver actions
    let steer = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.steer : 0;
    const throttleForward = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.throttle : 0;
    const brakeOrReverse = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.brake : 0;
    const handbrake = inputsEnabled && (isDriverLocal || isDriverRemote) ? driverInput.handbrake : 0;

    // Navigator actions
    // - Local keyboard: rawInput.shoot (KeyL)
    // - Local touch/pen: hold-to-fire via shootHeld
    // - Remote navigator: handled on client side (client-authoritative shooting)
    const heldTouchShoot = this.role === PlayerRole.NAVIGATOR && this.shootHeld;
    if (inputsEnabled && ((isNavigatorLocal && rawInput.shoot) || heldTouchShoot)) {
      this.shoot();
    }
    // Note: Remote navigator shooting is NOT handled here anymore - client is authoritative
    // Host just receives damage events from client via applyRemoteDamageEvents()
    if (this.netRemoteNavigator) {
      // Still clear the pulse flag to prevent stale data
      this.netRemoteNavigator = { ...this.netRemoteNavigator, shootPulse: false };
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

    // Feel: invert steering while reversing so left/right match driver expectation.
    if (this.gear === "R") steer = -steer;

    const projectionBefore = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    const roadHalfWidthM = projectionBefore.widthM * 0.5;
    const offTrack = projectionBefore.distanceToCenterlineM > roadHalfWidthM;
    const trackSeed = this.trackDef.meta?.seed ?? 1;
    const activeZones = this.currentStageZones.length
      ? zonesAtTrackDistance(this.track.totalLengthM, projectionBefore.sM, this.currentStageZones)
      : [];

    const rainIntensity = zoneIntensityAtTrackDistance(this.track.totalLengthM, projectionBefore.sM, this.currentStageZones, "rain", { rampM: 35 });
    const sandIntensity = activeZones
      .filter((z) => z.kind === "sandstorm")
      .reduce((m, z) => Math.max(m, z.intensity01), 0);

    // Rain should be slippy, but not overly punishing.
    // Lower frictionMu = less max tire force = less grip = more sliding.
    const rainGripMult = 1 - 0.45 * rainIntensity;
    const sandGripMult = 1 - 0.18 * sandIntensity;
    const zoneGripMult = clamp(rainGripMult * sandGripMult, 0.62, 1.0);
    const zoneRRMult = clamp(1 + 0.22 * sandIntensity, 1.0, 1.35);

    const baseSurface = surfaceForTrackSM(
      this.track.totalLengthM,
      projectionBefore.sM,
      offTrack,
      trackSeed,
      this.currentStageThemeKind
    );
    this.lastSurface = {
      ...baseSurface,
      frictionMu: clamp(baseSurface.frictionMu * zoneGripMult, 0.18, 1.8),
      rollingResistanceN: clamp(baseSurface.rollingResistanceN * zoneRRMult, 80, 2500)
    };

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

    const bulletScale = this.getBulletTimeScale();
    const steerRateScale =
      this.bulletTimeActive && bulletScale > 1e-6 ? this.bulletTimeSteerAdvantage / bulletScale : 1.0;
    const brakeForceScale =
      this.bulletTimeActive && bulletScale > 1e-6 ? this.bulletTimeBrakeAdvantage / bulletScale : 1.0;
    const carParamsForStep =
      steerRateScale !== 1.0 || brakeForceScale !== 1.0
        ? {
            ...this.carParams,
            maxSteerRateRadS: this.carParams.maxSteerRateRadS * steerRateScale,
            brakeForceN: this.carParams.brakeForceN * brakeForceScale,
            handbrakeForceN: this.carParams.handbrakeForceN * brakeForceScale
          }
        : this.carParams;

    const stepped = stepCar(
      this.state.car,
      carParamsForStep,
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
    const rpmNorm = rpmFraction(this.engineState, this.engineParams);
    if (this.audioUnlocked) {
      this.engineAudio.update(rpmNorm, this.engineState.throttleInput, { timeScale: this.getBulletTimeScale() });
    }

    this.updateVisualDynamics(dtSeconds);

    // Emit particles when drifting OR using handbrake OR wheelspinning OR hard braking on loose surfaces
    const speedMS = this.speedMS();
    const driftIntensity = Math.max(this.driftInfo.intensity, handbrake * Math.min(speedMS / 15, 1));
    const rawWheelspinIntensity = this.state.carTelemetry.wheelspinIntensity;

    // Scale wheelspin by surface - much less on tarmac, more on low-grip surfaces
    const surfaceFriction = this.lastSurface.frictionMu;
    const wheelspinSurfaceScale = Math.max(0.1, 1.5 - surfaceFriction); // 0.5 on tarmac, 1.0+ on gravel/sand
    const wheelspinIntensity = rawWheelspinIntensity * wheelspinSurfaceScale;

    // Hard braking can kick up gravel/sand even without a big yaw slip.
    const surfaceName = this.lastSurface.name;
    const surfaceIsLoose = surfaceName === "gravel" || surfaceName === "sand" || surfaceName === "offtrack";
    const brakeSurfaceScale = surfaceIsLoose ? 1.0 : 0.35;
    const brakeIntensity = clamp(brake * clamp(speedMS / 18, 0, 1) * brakeSurfaceScale * clamp(1.35 - surfaceFriction, 0, 1), 0, 1);

    // Combine drift and wheelspin - wheelspin is most visible at lower speeds
    const totalIntensity = Math.max(driftIntensity, wheelspinIntensity * (1 - Math.min(speedMS / 30, 1)), brakeIntensity);

    // Slide/gravel sound: tie it to the same signal that drives particles.
    // More audible on gravel/sand/offtrack, and stronger while actually sliding.
    // Prefer regular gravel/loose spray a bit more, and keep drift from dominating the mix.
    const driftLoud = clamp(this.driftInfo.intensity * 0.95, 0, 1);
    const particleSignal = clamp((totalIntensity - 0.06) / 0.68, 0, 1);
    const looseDrive = surfaceIsLoose
      ? clamp((Math.abs(this.engineState.throttleInput) - 0.12) / 0.6, 0, 1) * clamp(speedMS / 10, 0, 1)
      : 0;
    const gravelLoud = clamp(particleSignal * (0.58 + 0.42 * looseDrive) + looseDrive * 0.12, 0, 1);
    const slideIntensity = Math.max(driftLoud, gravelLoud);
    if (this.audioUnlocked) {
      this.slideAudio.update(slideIntensity, this.lastSurface, { timeScale: this.getBulletTimeScale() });
    }
    
    // Store continuous audio state for network sync
    this.continuousAudioState = {
      engineRpm: rpmNorm,
      engineThrottle: this.engineState.throttleInput,
      slideIntensity,
      surfaceName
    };

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
    this.emitColossusFire(dtSeconds);
    this.shootColossusFireballs(dtSeconds);
    this.updateEnemyProjectiles(dtSeconds);
    this.checkProjectileCollisions();

    // Decay camera shake
    this.cameraShakeX *= 0.85;
    this.cameraShakeY *= 0.85;
    this.collisionFlashAlpha *= 0.92;

    // Smooth camera rotation for runner mode
    if (this.cameraMode === "runner") {
      const roleOffset = this.role === PlayerRole.NAVIGATOR ? 0 : Math.PI / 2;
      const targetRot = -this.state.car.headingRad - roleOffset;
      // Normalize angle difference to [-PI, PI]
      let angleDiff = targetRot - this.cameraRotationRad;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      // Smooth interpolation: balanced rotation speed
      const rotationSpeed = 1.2; // rad/s
      this.cameraRotationRad += angleDiff * rotationSpeed * dtSeconds;
    } else {
      this.cameraRotationRad = 0;
    }

    const projectionAfter = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.resolveHardBoundary(projectionAfter);

    const projectionFinal = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.updateCheckpointsAndRace(projectionFinal);

    this.updateDebrisWarnings(projectionFinal);

    this.resolveTreeCollisions();
    this.updateDebris(dtSeconds);
    this.resolveDebrisCollisions();
    this.resolveBuildingCollisions();
    this.resolveEnemyCollisions();
    this.checkWaterHazards(dtSeconds);
    if (this.damage01 >= 1) {
      if (this.wreckedTimeSeconds === null) this.wreckedTimeSeconds = this.state.timeSeconds;
      if (!this.backendWreckedSent) {
        this.backendWreckedSent = true;
        void postGameStat({
          type: "wrecked",
          seed: this.getTrackSeedString(),
          mode: this.soloMode,
          name: (localStorage.getItem("spaceRallyName") ?? "").trim().slice(0, 40) || "anonymous"
        });
      }
      this.stopReplayRecording(true);
      this.damage01 = 1;
      this.state.car.vxMS = 0;
      this.state.car.vyMS = 0;
      this.state.car.yawRateRadS = 0;
      this.state.car.steerAngleRad = 0;
      this.state.car.alphaFrontRad = 0;
      this.state.car.alphaRearRad = 0;
    } else {
      this.wreckedTimeSeconds = null;
    }

    this.recordReplayFrame(dtSeconds);

    // End input replay once we reach a terminal race state.
    if (this.replayInputPlayback && !this.replayInputPlayback.ended && (this.raceFinished || this.damage01 >= 1)) {
      this.replayInputPlayback.ended = true;
      this.updateReplayPanelUi();
    }
  }

  private render(): void {
    const { width, height } = this.renderer.resizeToDisplay();

    // Independent render-time decay (net client may not advance sim time).
    {
      const nowMs = performance.now();
      if (this.gunFlashLastUpdateMs === 0) this.gunFlashLastUpdateMs = nowMs;
      const dt = clamp((nowMs - this.gunFlashLastUpdateMs) / 1000, 0, 0.05);
      this.gunFlashLastUpdateMs = nowMs;
      this.gunFlash01 = Math.max(0, this.gunFlash01 - dt * 4);
    }

    // Hide touch controls after finish/wrecked (or when hard-locked) so the UI matches the lockout.
    const driverGroup = document.getElementById("driver-group");
    const navGroup = document.getElementById("navigator-group");
    if (this.raceFinished || this.damage01 >= 1 || this.controlsLocked || this.replayPlayback || this.replayInputPlayback) {
      if (driverGroup) driverGroup.style.display = "none";
      if (navGroup) navGroup.style.display = "none";
    } else {
      // Restore default behavior (CSS + .active class decide visibility).
      if (driverGroup) driverGroup.style.display = "";
      if (navGroup) navGroup.style.display = "";
    }

    // Wrecked: no reset. Only allow trying a new track.
    const resetBtn = document.getElementById("btn-reset") as HTMLButtonElement | null;
    if (resetBtn) resetBtn.style.display = "none";

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
      if (this.netRemoteEnemyProjectiles) {
        for (const p of this.netRemoteEnemyProjectiles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (typeof p.age === "number") p.age += dt;
        }
        this.netRemoteEnemyProjectiles = this.netRemoteEnemyProjectiles.filter((p) =>
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
        // Predictive smoothing: lower alpha (less twitch) + small lookahead (less lag)
        const leadSeconds = 0.07;

        const posAlpha = 1 - Math.exp(-dt * 18);
        const headingAlpha = 1 - Math.exp(-dt * 14);
        // Slower for visual/physics properties
        const slowAlpha = 1 - Math.exp(-dt * 12);

        const c = this.state.car;
        const tcar = this.netClientTargetCar;
        
        // Track interpolation quality metrics
        const distToTarget = Math.hypot(tcar.xM - c.xM, tcar.yM - c.yM);
        const velToTarget = Math.hypot(tcar.vxMS - c.vxMS, tcar.vyMS - c.vyMS);
        this.netClientInterpolationDistance = distToTarget;
        this.netClientVelocityError = velToTarget;
        
        // Predict forward only (avoid sideways lookahead causing slow lateral drift)
        const fx = Math.cos(tcar.headingRad);
        const fy = Math.sin(tcar.headingRad);
        const forwardSpeedMS = tcar.vxMS * fx + tcar.vyMS * fy;
        const targetX = tcar.xM + fx * forwardSpeedMS * leadSeconds;
        const targetY = tcar.yM + fy * forwardSpeedMS * leadSeconds;
        const targetHeading = tcar.headingRad + tcar.yawRateRadS * leadSeconds;

        // Smooth camera (position + heading)
        c.xM = lerp(c.xM, targetX, posAlpha);
        c.yM = lerp(c.yM, targetY, posAlpha);
        c.headingRad = c.headingRad + wrapPi(targetHeading - c.headingRad) * headingAlpha;
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

    const perfStartMs = performance.now();
    let perfMarkMs = perfStartMs;

    const isTouch = isTouchMode();

    // Show NEW TRACK button when finished or wrecked.
    const showNewTrack = (this.raceFinished || this.damage01 >= 1) && this.netMode !== "client" && !this.replayPlayback;
    const newTrackBtn = document.getElementById("btn-new-track") as HTMLButtonElement | null;
    if (newTrackBtn) {
      newTrackBtn.style.display = showNewTrack ? "block" : "none";
      newTrackBtn.textContent = this.damage01 >= 1 ? "Go try another one" : "New Track";
    }

    const showFinishPanel = this.raceFinished && this.finishPanelShown && !this.replayPlayback && !this.replayInputPlayback;
    this.setFinishPanelVisible(showFinishPanel);

    const framing = computeCameraFraming({
      widthCssPx: width,
      heightCssPx: height,
      isTouch,
      cameraMode: this.cameraMode,
      role: this.role === PlayerRole.NAVIGATOR ? "navigator" : "driver",
      carHeadingRad: this.state.car.headingRad
    });

    // P2 (client navigator) gets extra zoom-out for better situational awareness.
    const pixelsPerMeter = framing.pixelsPerMeter * (this.netMode === "client" ? 0.78 : 1.0);
    const offsetX = framing.offsetXM;
    const offsetY = this.netMode === "client" ? 0 : framing.offsetYM;
    const screenCenterXCssPx = framing.screenCenterXCssPx;
    const screenCenterYCssPxOverride = this.netMode === "client" ? height * 0.5 : framing.screenCenterYCssPx;

    // Use zero camera shake for client (shake is local to host simulation)
    const shakeX = this.netMode === "client" ? 0 : this.cameraShakeX;
    const shakeY = this.netMode === "client" ? 0 : this.cameraShakeY;

    // Compute actual camera center (used for both bg and world rendering)
    const cameraCenterX = this.state.car.xM + shakeX + offsetX;
    const cameraCenterY = this.state.car.yM + shakeY + offsetY;

    // Draw background BEFORE beginCamera but using the same pivot point
    const theme = resolveStageTheme({ kind: this.currentStageThemeKind });
    this.renderer.drawBg(theme.bgColor, cameraCenterX, cameraCenterY, this.cameraRotationRad, screenCenterXCssPx, screenCenterYCssPxOverride);
    {
      const now = performance.now();
      this.perfTimingsMs.bg = now - perfMarkMs;
      perfMarkMs = now;
    }

    this.renderer.beginCamera({
      centerX: cameraCenterX,
      centerY: cameraCenterY,
      pixelsPerMeter,
      rotationRad: this.cameraRotationRad,
      screenCenterXCssPx,
      screenCenterYCssPx: screenCenterYCssPxOverride
    });

    // Update mouse world position now that camera is set
    this.updateMouseWorldPosition();

    // Only show the world grid when debugging or editing. It obscures the theme read.
    if (this.showDebugMenu || this.editorMode) {
      this.renderer.drawGrid({ spacingMeters: 1, majorEvery: 5 });
    }

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
    this.renderer.drawDebris(this.debris);
    const enemiesToDraw = (this.replayPlayback && this.netRemoteEnemies)
      ? this.netRemoteEnemies
      : (this.netMode === "client" && this.netRemoteEnemies ? this.netRemoteEnemies : this.enemyPool.getActive());
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

    // Draw finish line (always visible)
    const finishSM = this.checkpointSM[this.checkpointSM.length - 1];
    const finish = pointOnTrack(this.track, finishSM);
    const finishProj = projectToTrack(this.track, finish.p);
    this.renderer.drawFinishLine({
      x: finish.p.x,
      y: finish.p.y,
      headingRad: finish.headingRad,
      widthM: finishProj.widthM
    });

    // Draw active checkpoint if race isn't finished
    if (this.nextCheckpointIndex < this.checkpointSM.length) {
      const isFinishNext = this.nextCheckpointIndex === this.checkpointSM.length - 1;
      if (!isFinishNext) {
        const activeGate = pointOnTrack(this.track, this.checkpointSM[this.nextCheckpointIndex]);
        const activeGateProj = projectToTrack(this.track, activeGate.p);
        this.renderer.drawCheckpointLine({
          x: activeGate.p.x,
          y: activeGate.p.y,
          headingRad: activeGate.headingRad,
          widthM: activeGateProj.widthM
        });
      }
    }
    this.renderer.drawCar({
      x: this.state.car.xM,
      y: this.state.car.yM,
      headingRad: this.state.car.headingRad,
      speed: this.speedMS(),
      rollOffsetM: this.visualRollOffsetM,
      pitchOffsetM: this.visualPitchOffsetM,
      braking: this.lastInputState.brake > 0.1
    });

    // Draw enemy fireballs (circular, distinct from bullet tracers)
    const fireballsToDraw = (this.replayPlayback && this.netRemoteEnemyProjectiles && this.netRemoteEnemyProjectiles.length > 0)
      ? this.netRemoteEnemyProjectiles.map((p) => ({
        x: p.x,
        y: p.y,
        color: p.color || "rgba(255, 120, 40, 0.95)",
        size: (p.size !== undefined ? p.size : 0.55)
      }))
      : (this.netMode === "client" && this.netRemoteEnemyProjectiles && this.netRemoteEnemyProjectiles.length > 0)
      ? this.netRemoteEnemyProjectiles.map((p) => ({
        x: p.x,
        y: p.y,
        color: p.color || "rgba(255, 120, 40, 0.95)",
        size: (p.size !== undefined ? p.size : 0.55)
      }))
      : (this.netMode !== "client" && this.enemyProjectiles.length > 0)
        ? this.enemyProjectiles.map((p) => ({
          x: p.x,
          y: p.y,
          color: "rgba(255, 120, 40, 0.95)",
          size: 0.55
        }))
        : [];
    if (fireballsToDraw.length > 0) this.renderer.drawFireballs(fireballsToDraw);

    // Draw projectiles (bullets)
    // Client navigator uses their own local projectiles (client-authoritative shooting)
    // Host combines local projectiles with remote projectiles from client navigator
    let projectilesToDraw: { x: number; y: number; vx: number; vy: number; color?: string; size?: number }[] = this.projectilePool.getActive();
    if (this.replayPlayback && this.netRemoteProjectiles) {
      projectilesToDraw = this.netRemoteProjectiles;
    } else if (this.netMode === "host" && this.netRemoteProjectiles && this.netRemoteProjectiles.length > 0) {
      // Host renders client's projectiles (received via nav messages)
      projectilesToDraw = [...projectilesToDraw, ...this.netRemoteProjectiles];
    }
    this.renderer.drawProjectiles(projectilesToDraw);

    if (this.showDebugMenu && this.tuning?.values.showArrows) {
      this.drawForceArrows();
    }

    this.renderer.endCamera();
    {
      const now = performance.now();
      this.perfTimingsMs.world = now - perfMarkMs;
      perfMarkMs = now;
    }

    // Zone-based visibility effects (screen-space overlays). Keep these under HUD.
    const proj = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });

    // Client navigator doesn't run `step()`, so emit deterministic cues here too.
    this.updateDebrisWarnings(proj);

    let rainIntensity = 0;
    let fogIntensity = 0;
    let eclipseIntensity = 0;
    let sandIntensity = 0;
    let electricalIntensity = 0;
    let activeZoneKinds: string[] = [];
    let activeZoneIndicators: { kind: TrackZoneKind; intensity01: number }[] = [];
    if (this.currentStageZones.length > 0) {
      const activeZones = zonesAtTrackDistance(this.track.totalLengthM, proj.sM, this.currentStageZones);
      activeZoneKinds = [...new Set(activeZones.map((z) => z.kind))];
      activeZoneIndicators = activeZones.map((z) => ({
        kind: z.kind,
        intensity01: (z.kind === "rain" || z.kind === "fog" || z.kind === "eclipse")
          ? z.intensity01 * zoneEdgeFade(this.track.totalLengthM, proj.sM, z, z.kind === "eclipse" ? 150 : 35)
          : z.intensity01
      }));
      rainIntensity = zoneIntensityAtTrackDistance(this.track.totalLengthM, proj.sM, this.currentStageZones, "rain", { rampM: 35 });
      fogIntensity = zoneIntensityAtTrackDistance(this.track.totalLengthM, proj.sM, this.currentStageZones, "fog", { rampM: 35 });
      eclipseIntensity = zoneIntensityAtTrackDistance(this.track.totalLengthM, proj.sM, this.currentStageZones, "eclipse", { rampM: 150 });
      sandIntensity = activeZones.filter((z) => z.kind === "sandstorm").reduce((m, z) => Math.max(m, z.intensity01), 0);
      electricalIntensity = activeZones.filter((z) => z.kind === "electrical").reduce((m, z) => Math.max(m, z.intensity01), 0);
    }

    // Desert maps should never have fog (even if a legacy track definition includes it).
    // Temperate and arctic can have fog as a weather zone.
    if (this.currentStageThemeKind === "desert") fogIntensity = 0;

    // Desert should never have rain (even if a legacy track definition includes it).
    if (this.currentStageThemeKind === "desert") rainIntensity = 0;

    // Update rain audio (ambient pink-ish noise). Intentionally loud.
    if (this.audioUnlocked) this.rainAudio.update(rainIntensity, { timeScale: this.getBulletTimeScale() });

    if (fogIntensity > 0.02) {
      // Fog should ramp in/out like rain, and be a bit more intense.
      const fogI = clamp(fogIntensity * 1.65, 0, 1);
      const radius = clamp(110 - 92 * fogI, 14, 110);
      this.renderer.drawFog(this.state.car.xM, this.state.car.yM, radius);
      this.renderer.drawScreenOverlay(`rgba(160, 165, 175, ${clamp(0.02 + 0.06 * fogI, 0, 0.10)})`);
    }
    if (sandIntensity > 0.05) {
      const radius = 140 - 80 * sandIntensity;
      this.renderer.drawFog(this.state.car.xM, this.state.car.yM, radius);
      this.renderer.drawScreenOverlay(`rgba(170, 120, 55, ${clamp(0.04 + 0.10 * sandIntensity, 0, 0.18)})`);
    }
    if (eclipseIntensity > 0.02) {
      this.renderer.drawEclipseOverlay({
        intensity01: eclipseIntensity,
        flash01: this.gunFlash01,
        carX: this.state.car.xM,
        carY: this.state.car.yM,
        carHeadingRad: this.state.car.headingRad
      });
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
    if (!this.editorMode && !showFinishPanel) {
      // Calculate split time color
      const nowTimeSeconds = this.wreckedTimeSeconds ?? this.state.timeSeconds;
      const raceTime = this.raceActive && !this.raceFinished
        ? nowTimeSeconds - this.raceStartTimeSeconds
        : this.finishTimeSeconds ?? 0;

      let stageLine = `NOT STARTED`;
      if (this.raceActive) stageLine = `${raceTime.toFixed(2)}s`;
      else if (this.raceFinished) stageLine = `FINISHED: ${this.finishTimeSeconds?.toFixed(2)}s`;

      const lines = [stageLine];

      this.renderer.drawPanel({
        x: rightStackX,
        y: rightStackY,
        anchorX: "right",
        title: "Time",
        lines: lines
      });
      rightStackY += 68; // Slim panel
    }

    // 2c. Minimap
    // Show if:
    // 1. Role is NAVIGATOR (always)
    // 2. Role is DRIVER but we are on DESKTOP (not touch) - "Singleplayer Mode"
    const canShowMinimap = this.showMinimap && (this.role === PlayerRole.NAVIGATOR || !isTouch);

    if (canShowMinimap) {
      // Minimap warnings (driver hinting). Keep these simple; full zone intel is for the navigator.
      const warningTextLines: string[] = [];
      const calloutsEnabled = proj.sM >= this.checkpointSM[0];
      const calloutLookaheadM = 150;
      const rainLookaheadM = calloutLookaheadM;
      const narrowLookaheadM = calloutLookaheadM;
      const debrisLookaheadM = calloutLookaheadM;
      const hideImminentM = 10;
      const loops = this.track.points.length > 2
        ? Math.hypot(
          this.track.points[0].x - this.track.points[this.track.points.length - 1].x,
          this.track.points[0].y - this.track.points[this.track.points.length - 1].y
        ) < 20
        : false;

      const forwardDistM = (targetSM: number): number => {
        let d = targetSM - proj.sM;
        if (d < 0) d = loops ? d + this.track.totalLengthM : Infinity;
        return d;
      };

      if (calloutsEnabled) {
        // Upcoming rain
        const rainActive = activeZoneKinds.includes("rain");
        if (!rainActive && this.currentStageZones.length > 0) {
          let best = Infinity;
          for (const z of this.currentStageZones) {
            if (z.kind !== "rain") continue;
            const target = z.start01 * this.track.totalLengthM;
            const d = forwardDistM(target);
            if (d >= 0 && d <= rainLookaheadM) best = Math.min(best, d);
          }
          if (Number.isFinite(best) && best <= rainLookaheadM) {
            warningTextLines.push(`RAIN IN ${Math.round(best)}m`);
          }
        }

        // Upcoming eclipse (solar eclipse / darkness zone)
        const eclipseActive = activeZoneKinds.includes("eclipse");
        if (!eclipseActive && this.currentStageZones.length > 0) {
          let best = Infinity;
          for (const z of this.currentStageZones) {
            if (z.kind !== "eclipse") continue;
            const target = z.start01 * this.track.totalLengthM;
            const d = forwardDistM(target);
            if (d >= 0 && d <= calloutLookaheadM) best = Math.min(best, d);
          }
          if (Number.isFinite(best) && best <= calloutLookaheadM && best > hideImminentM) {
            warningTextLines.push(`ECLIPSE IN ${Math.round(best)}m`);
          }
        }

        // Upcoming narrow road segments (based on per-segment width profile)
        if (this.track.segmentWidthsM && this.track.segmentWidthsM.length > 0) {
          const base = this.track.widthM;
          // Only warn for VERY narrow segments (avoid spamming on mild squeezes).
          const narrowThreshold = base * 0.64;
          const currentW = this.track.segmentWidthsM[proj.segmentIndex] ?? base;
          if (currentW > narrowThreshold) {
            let best = Infinity;
            for (let i = 0; i < this.track.segmentWidthsM.length; i++) {
              const idx = loops ? (proj.segmentIndex + i) % this.track.segmentWidthsM.length : proj.segmentIndex + i;
              if (idx < 0 || idx >= this.track.segmentWidthsM.length) break;
              const w = this.track.segmentWidthsM[idx] ?? base;
              if (w >= narrowThreshold) continue;
              const segStart = this.track.cumulativeLengthsM[idx] ?? 0;
              const d = forwardDistM(segStart);
              if (d > narrowLookaheadM && !loops) break;
              if (d >= 0 && d <= narrowLookaheadM) best = Math.min(best, d);
            }
            if (Number.isFinite(best) && best <= narrowLookaheadM && best > hideImminentM) {
              warningTextLines.push(`NARROW IN ${Math.round(best)}m`);
            }
          }
        }

        // Upcoming debris
        if (this.debris.length > 0) {
          let best = Infinity;
          for (const d of this.debris) {
            const dist = forwardDistM(d.sM);
            if (dist >= 0 && dist <= debrisLookaheadM) best = Math.min(best, dist);
          }
          if (Number.isFinite(best) && best <= debrisLookaheadM && best > hideImminentM) {
            warningTextLines.push(`DEBRIS IN ${Math.round(best)}m`);
          }
        }
      }

      const miniMapSize = this.role === PlayerRole.NAVIGATOR
        ? (isTouch
          ? Math.min(width * 0.62, height * 0.62)
          : Math.min(height * 0.52, 360))
        : (isTouch ? width : Math.min(height * 0.4, 300));
      const startMM = pointOnTrack(this.track, this.checkpointSM[0]).p;
      const finishMM = pointOnTrack(this.track, this.checkpointSM[this.checkpointSM.length - 1]).p;
      const minimapOffsetX = (isTouch && this.role === PlayerRole.NAVIGATOR)
        ? hudPadding
        : (!isTouch && this.role === PlayerRole.DRIVER ? hudPadding : (width - miniMapSize) * 0.5);

      const minimapEnemies = (this.replayPlayback && this.netRemoteEnemies)
        ? this.netRemoteEnemies
        : (this.netMode === "client" && this.netRemoteEnemies)
          ? this.netRemoteEnemies
          : this.enemyPool.getActive();

      this.renderer.drawMinimap({
        track: this.track,
        carX: this.state.car.xM,
        carY: this.state.car.yM,
        carHeading: this.state.car.headingRad,
        waterBodies: this.waterBodies,
        enemies: minimapEnemies,
        debris: this.debris,
        segmentSurfaceNames: this.trackSegmentSurfaceNames,
        start: startMM,
        finish: finishMM,
        offsetX: minimapOffsetX,
        offsetY: height - miniMapSize - ((isTouch && this.role === PlayerRole.NAVIGATOR) ? hudPadding : (isTouch ? 0 : hudPadding)),
        size: miniMapSize,
        minimapBgColor: theme.minimapBgColor,
        zones: this.role === PlayerRole.NAVIGATOR ? this.currentStageZones : undefined,
        activeZones: this.role === PlayerRole.NAVIGATOR ? activeZoneIndicators : undefined,
        statusTextLines: (this.role === PlayerRole.NAVIGATOR && electricalIntensity > 0.05)
          ? ["ERROR", "ELECTRICAL STORM"]
          : undefined,
        warningTextLines: this.netMode === "client" ? [] : warningTextLines
      });
    }

    // Debug panels (F to toggle)
    if (this.showDebugMenu) {
      const speedMS = this.speedMS();
      const speedKmH = speedMS * 3.6;

      // Grip calculation (mirror the same logic used in step()).
      const proj = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
      const roadHalfWidthM = proj.widthM * 0.5;
      const offTrack = proj.distanceToCenterlineM > roadHalfWidthM;
      const trackSeed = this.trackDef.meta?.seed ?? 1;
      const activeZones = this.currentStageZones.length
        ? zonesAtTrackDistance(this.track.totalLengthM, proj.sM, this.currentStageZones)
        : [];

      const rainI = activeZones.filter((z) => z.kind === "rain").reduce((m, z) => Math.max(m, z.intensity01), 0);
      const sandI = activeZones.filter((z) => z.kind === "sandstorm").reduce((m, z) => Math.max(m, z.intensity01), 0);
      const rainGripMult = 1 - 0.62 * rainI;
      const sandGripMult = 1 - 0.18 * sandI;
      const zoneGripMult = clamp(rainGripMult * sandGripMult, 0.55, 1.0);

      const baseSurface = surfaceForTrackSM(
        this.track.totalLengthM,
        proj.sM,
        offTrack,
        trackSeed,
        this.currentStageThemeKind
      );
      const gripMu = clamp(baseSurface.frictionMu * zoneGripMult, 0.18, 1.8);

      const zoneSummary = this.currentStageZones.length > 0
        ? this.currentStageZones
          .map((z) => `${z.kind}@${z.intensity01.toFixed(2)} [${z.start01.toFixed(2)}-${z.end01.toFixed(2)}]`)
          .join(", ")
        : "none";
      const activeSummary = activeZoneKinds.length > 0 ? activeZoneKinds.join(", ") : "none";
      const perf = this.perfTimingsSmoothMs;
      this.renderer.drawPanel({
        x: 12,
        y: 12,
        title: "Debug",
        lines: [
          `FPS: ${this.fps.toFixed(0)}`,
          `ms (avg): frame ${perf.frame.toFixed(1)}  bg ${perf.bg.toFixed(1)}  world ${perf.world.toFixed(1)}`,
          `ms (avg): hud ${perf.hud.toFixed(1)}  overlays ${perf.overlays.toFixed(1)}  rain ${perf.rain.toFixed(1)}`,
          `t: ${this.state.timeSeconds.toFixed(2)}s`,
          `track: ${this.trackDef.meta?.name ?? "Custom"}${this.trackDef.meta?.seed ? ` (seed ${this.trackDef.meta.seed})` : ""}`,
          `stage: ${this.trackDef.meta?.seed ?? this.proceduralSeed}`,
          `theme: ${theme.name} (${theme.kind})`,
          `zones: ${zoneSummary}`,
          `zones now: ${activeSummary}  rain:${rainIntensity.toFixed(2)} fog:${fogIntensity.toFixed(2)} elec:${electricalIntensity.toFixed(2)}`,
          `camera: ${this.cameraMode}`,
          `speed: ${speedMS.toFixed(2)} m/s (${speedKmH.toFixed(0)} km/h)`,
          `grip: ${baseSurface.name}${offTrack ? " (offtrack)" : ""}  mu: ${baseSurface.frictionMu.toFixed(2)} x zone ${zoneGripMult.toFixed(2)} = ${gripMu.toFixed(2)}`,
          `grip factors: rain:${rainI.toFixed(2)} sand:${sandI.toFixed(2)}`,
          `steer: ${this.lastInputState.steer.toFixed(2)}  throttle: ${this.lastInputState.throttle.toFixed(2)}  brake/rev: ${this.lastInputState.brake.toFixed(2)}`,
          `handbrake: ${this.lastInputState.handbrake.toFixed(2)}  gear: ${this.gear}`,
          `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`,
          ...(this.netMode === "client" ? [
            `client interp distance: ${this.netClientInterpolationDistance.toFixed(2)}m`,
            `client velocity error: ${this.netClientVelocityError.toFixed(2)}m/s`
          ] : []),
          ...this.netStatusLines.map(l => `net: ${l}`)
        ]
      });
    }

    // Draw Weapon HUD - Suppressed for Driver and for touch (touch uses HTML ammo above weapon buttons)
    if (this.weapons.length > 0 && this.role === PlayerRole.NAVIGATOR && !isTouch) {
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
      // Tires panel - positioned below Tuning panel
      this.renderer.drawPanel({
        x: 12,
        y: 742, // Below Debug + Tuning + gap
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
        totalDistanceKm: this.totalDistanceM / 1000,
        layout: isTouch ? "left" : "bottom"
      });
    }

    // Notification (if recent)
    const timeSinceNotification = this.state.timeSeconds - this.notificationTimeSeconds;
    if (this.notificationText && timeSinceNotification < 2.5) {
      this.renderer.drawNotification(this.notificationText, timeSinceNotification);
    }

    // Everything above was mostly HUD/minimap/panels; mark it separately.
    {
      const now = performance.now();
      this.perfTimingsMs.hud = now - perfMarkMs;
      perfMarkMs = now;
    }

    // Drift indicator removed (future: vibration-driven feedback)

    // Damage overlay (red vignette)
    if (this.damage01 > 0.15) {
      this.renderer.drawDamageOverlay({ damage01: this.damage01 });
    }

    // Rain visual effect: blue tint + falling streak noise (over everything).
    this.perfTimingsMs.rain = 0;
    if (rainIntensity > 0.05) {
      const rainStartMs = performance.now();
      this.renderer.drawScreenOverlay(`rgba(28, 95, 220, ${clamp(0.04 + 0.14 * rainIntensity, 0, 0.22)})`);
      this.renderer.drawRain({ intensity01: rainIntensity, timeSeconds: this.state.timeSeconds });
      this.perfTimingsMs.rain = performance.now() - rainStartMs;
    }

    // Electrical storm: occasional white flashes across the screen.
    // Tone down: lower peak alpha and reduce the strobe aggressiveness.
    if (electricalIntensity > 0.05) {
      const t = this.state.timeSeconds;
      const elec = clamp(electricalIntensity * 0.55, 0, 1);

      const w = 1.6 + 1.6 * elec;
      const mainA = Math.pow(Math.max(0, Math.sin(t * w + 1.7)), 6);
      const mainB = Math.pow(Math.max(0, Math.sin(t * (w * 0.70) + 0.3)), 7);
      const main = Math.max(mainA, mainB);

      const strobe = Math.pow(Math.max(0, Math.sin(t * (14 + 14 * elec) + 0.9)), 1.6);
      const pulse = clamp(main * (0.30 + 0.55 * strobe), 0, 1);
      const alpha = clamp(pulse * (0.05 + 0.16 * elec), 0, 0.22);
      if (alpha > 0.01) this.renderer.drawScreenOverlay(`rgba(255, 255, 255, ${alpha})`);
    }

    // Gun flash: brief warm bloom across the screen.
    if (this.gunFlash01 > 0.01) {
      const a = clamp(0.02 + 0.10 * this.gunFlash01, 0, 0.13);
      this.renderer.drawScreenOverlay(`rgba(255, 240, 210, ${a})`);
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

    // Show a host waiting HUD whenever we're blocking the sim on peer join.
    // This is keyed off `netWaitForPeer` so the banner still appears even if
    // `netMode` hasn't flipped to "host" yet (racey in some flows).
    if (this.netWaitForPeer && this.netMode !== "client") {
      this.renderer.drawCenterText({ text: "WAITING", subtext: "Invite the gunner to join" });
    }

    if (this.damage01 >= 1) {
      this.renderer.drawCenterText({
        text: "DELIVERY FAILED",
        subtext: "Also, you've wrecked your car and almost died."
      });
    }

    if (this.raceFinished && !this.finishPanelShown) {
      const totalTime = this.finishTimeSeconds ?? 1;
      const avgSpeedKmH = (this.track.totalLengthM / totalTime) * 3.6;
      this.renderer.drawFinishScreen({
        time: totalTime,
        avgSpeedKmH: avgSpeedKmH,
        kills: this.enemyKillCount,
        totalEnemies: this.enemyPool.getAll().length
      });
    }

    {
      const end = performance.now();
      this.perfTimingsMs.overlays = end - perfMarkMs;
      this.perfTimingsMs.frame = end - perfStartMs;
      // Update smoothed (EMA) values for stable display.
      const a = this.perfSmoothAlpha;
      const raw = this.perfTimingsMs;
      const s = this.perfTimingsSmoothMs;
      s.frame = s.frame + a * (raw.frame - s.frame);
      s.bg = s.bg + a * (raw.bg - s.bg);
      s.world = s.world + a * (raw.world - s.world);
      s.hud = s.hud + a * (raw.hud - s.hud);
      s.overlays = s.overlays + a * (raw.overlays - s.overlays);
      s.rain = s.rain + a * (raw.rain - s.rain);
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
    this.stopReplayPlayback();
    this.stopReplayRecording(false);

    // Reset transient gameplay state (debug hard-reset)
    this.bulletTimeRemainingS = this.bulletTimeBudgetS;
    this.bulletTimeHeldLocal = false;
    this.bulletTimeActive = false;
    this.bulletTimeActiveFromHost = false;

    this.netRemoteNavigator = null;
    this.netRemoteDriver = null;
    this.netRemoteEnemies = null;
    this.netRemoteProjectiles = null;
    this.netRemoteEnemyProjectiles = null;
    this.netClientDamageEvents = [];
    this.netClientMuzzleFlashEvents = [];
    this.netParticleEvents = [];
    this.netAudioEvents = [];
    this.netDebrisDestroyedIds = [];

    // Spawn in the starting city (behind the start line)
    // Start line is at 50m, so spawn at 20m to be in the middle of the city
    const spawn = pointOnTrack(this.track, 20);
    this.state.car = {
      ...createCarState(),
      xM: spawn.p.x,
      yM: spawn.p.y,
      headingRad: spawn.headingRad
    };
    this.prevCarX = this.state.car.xM;
    this.prevCarY = this.state.car.yM;
    this.nextCheckpointIndex = 0;
    this.insideActiveGate = false;
    this.raceActive = false;
    this.raceStartTimeSeconds = this.state.timeSeconds;
    this.raceFinished = false;
    this.finishTimeSeconds = null;
    this.resetFinishPanel();
    this.controlsLocked = false;
    this.damage01 = 0;
    this.wreckedTimeSeconds = null;
    this.state.car.steerAngleRad = 0;
    this.visualRollOffsetM = 0;
    this.visualRollVel = 0;
    this.driftDetector.reset();
    this.engineState = createEngineState();
    this.particlePool.reset();
    this.particleAccumulator = 0;
    this.projectilePool.clear();
    this.cameraRotationRad = this.cameraMode === "runner" ? -spawn.headingRad - Math.PI / 2 : 0;
    this.enemyKillCount = 0;
    this.enemyProjectiles = [];
    this.colossusShotCooldownS = 0;
    this.colossusShotPhase = 0;
    // netDebrisDestroyedIds cleared above (hard reset)

    // Respawn enemies when resetting (regenerate from track)
    const treeSeed = Math.floor(this.trackDef.meta?.seed ?? 20260123);
    const spawnEnemies = !(this.netMode === "solo" && this.soloMode === "practice");
    if (spawnEnemies) {
      const enemies = generateEnemies(this.track, { seed: treeSeed + 1337, quietZones: this.currentQuietZones });
      this.enemyPool.setEnemies(enemies);
    } else {
      this.enemyPool.clear();
    }

    // Deterministic on-road debris (biome-tuned)
    this.debris = generateDebris(this.track, { seed: treeSeed + 3333, themeKind: this.currentStageThemeKind, quietZones: this.currentQuietZones });
  }

  private wrapDeltaSForward(fromSM: number, toSM: number): number {
    const L = this.track.totalLengthM;
    let d = toSM - fromSM;
    while (d < 0) d += L;
    while (d >= L) d -= L;
    return d;
  }

  private updateDebrisWarnings(proj: TrackProjection): void {
    if (!this.debris.length) return;
    // Only the navigator should get this cue.
    if (this.role !== PlayerRole.NAVIGATOR) return;
    // P2 shouldn't get on-screen callouts.
    if (this.netMode === "client") return;
    // No callouts until after leaving the start city.
    if (proj.sM < this.checkpointSM[0]) return;

    const nowS = proj.sM;
    let best: DebrisObstacle | null = null;
    let bestDelta = Infinity;

    for (const d of this.debris) {
      if (d.integrity01 <= 0.05) continue;
      const delta = this.wrapDeltaSForward(nowS, d.sM);
      if (delta < 1) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = d;
      }
    }

    // Only warn when it's close but not already visually imminent.
    if (!best || bestDelta < 10 || bestDelta > 150) return;
    if (this.lastDebrisWarnId === best.id && (this.state.timeSeconds - this.lastDebrisWarnAtSeconds) < 4.0) return;

    this.lastDebrisWarnId = best.id;
    this.lastDebrisWarnAtSeconds = this.state.timeSeconds;
    this.showNotification(`DEBRIS IN ${Math.round(bestDelta)}m`);
  }

  private resolveDebrisCollisions(): void {
    if (this.debris.length === 0) return;
    if (this.damage01 >= 1) return;
    // Host/solo sim only; clients receive debrisDestroyed + particle events.
    if (this.netMode === "client") return;

    const carRadius = 0.85;
    const speed = this.speedMS();

    const destroyedIds: number[] = [];

    for (const d of this.debris) {
      const integrity = clamp(d.integrity01, 0, 1);
      if (integrity <= 0.02) continue;

      // Match renderer scaling.
      const scaleL = 0.35 + 0.65 * integrity;
      const scaleW = 0.55 + 0.45 * integrity;
      const halfL = d.lengthM * 0.5 * scaleL;
      const halfW = d.widthM * 0.5 * scaleW;

      const cosR = Math.cos(d.rotationRad);
      const sinR = Math.sin(d.rotationRad);
      const ax = d.x - cosR * halfL;
      const ay = d.y - sinR * halfL;
      const bx = d.x + cosR * halfL;
      const by = d.y + sinR * halfL;

      const dist = pointToSegmentDistance(this.state.car.xM, this.state.car.yM, ax, ay, bx, by);
      const minDist = carRadius + halfW;
      if (dist >= minDist) continue;

      // Closest point on segment.
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 1e-9
        ? Math.max(0, Math.min(1, ((this.state.car.xM - ax) * dx + (this.state.car.yM - ay) * dy) / lenSq))
        : 0;
      const cx = ax + dx * t;
      const cy = ay + dy * t;

      const nx0 = this.state.car.xM - cx;
      const ny0 = this.state.car.yM - cy;
      const nLen = Math.max(1e-6, Math.hypot(nx0, ny0));
      const nx = nx0 / nLen;
      const ny = ny0 / nLen;

      // Tiny destabilization, but don't bounce/stop the car.
      const cosH = Math.cos(this.state.car.headingRad);
      const sinH = Math.sin(this.state.car.headingRad);
      const sideSign = Math.sign(nx * sinH - ny * cosH) || 1;
      const twist = clamp(speed / 28, 0, 1);
      this.state.car.yawRateRadS += sideSign * (0.24 + 0.55 * twist);
      this.state.car.vxMS *= 0.985;
      this.state.car.vyMS *= 0.985;
      if (speed > 18) {
        this.damage01 = clamp(this.damage01 + 0.0012 * twist, 0, 1);
      }

      // Shatter into splinters immediately.
      const burst = Math.floor(42 + 105 * twist);
      for (let i = 0; i < burst; i++) {
        const jitter = Math.sin((d.id + 1) * 0.17 + i * 1.23) * 0.65;
        const dirX0 = nx * 0.85 + (-ny) * jitter;
        const dirY0 = ny * 0.85 + nx * jitter;
        const dirLen = Math.max(1e-6, Math.hypot(dirX0, dirY0));
        const dirX = dirX0 / dirLen;
        const dirY = dirY0 / dirLen;
        const sp = (1.4 + 3.8 * twist) * (0.65 + 0.55 * (0.5 + 0.5 * Math.sin(i * 2.3 + d.id * 0.09)));
        const col = i % 4 === 0
          ? "rgba(190, 135, 95, 0.92)"
          : (i % 4 === 1 ? "rgba(145, 100, 70, 0.88)" : (i % 4 === 2 ? "rgba(110, 78, 52, 0.90)" : "rgba(90, 65, 45, 0.82)"));
        this.emitParticles({
          x: cx,
          y: cy,
          vx: dirX * sp,
          vy: dirY * sp,
          lifetime: 0.26 + 0.28 * twist,
          sizeM: 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(i * 1.7 + 0.2)),
          color: col,
          count: 1
        });
      }

      d.integrity01 = 0;
      destroyedIds.push(d.id);
      if (this.netMode === "host") {
        this.netDebrisDestroyedIds.push(d.id);
      }
    }

    if (destroyedIds.length) {
      const destroyed = new Set(destroyedIds);
      this.debris = this.debris.filter((d) => !destroyed.has(d.id));
    }
  }

  private updateDebris(dtSeconds: number): void {
    if (!this.debris.length) return;
    if (dtSeconds <= 0) return;

    // Only host/solo sim. Client doesn't run physics.
    if (this.netMode === "client") return;

    const linDamp = Math.exp(-dtSeconds * 1.25);
    const angDamp = Math.exp(-dtSeconds * 1.8);
    const maxSpeed = 5.5;
    const maxAng = 2.8;
    for (const d of this.debris) {
      if (!d.isDynamic) continue;

      // Clamp so collisions don't launch debris unrealistically fast.
      const v = Math.hypot(d.vx, d.vy);
      if (v > maxSpeed) {
        const s = maxSpeed / Math.max(1e-6, v);
        d.vx *= s;
        d.vy *= s;
      }
      d.angularVelRadS = clamp(d.angularVelRadS, -maxAng, maxAng);

      d.x += d.vx * dtSeconds;
      d.y += d.vy * dtSeconds;
      d.rotationRad += d.angularVelRadS * dtSeconds;
      d.vx *= linDamp;
      d.vy *= linDamp;
      d.angularVelRadS *= angDamp;
      if ((Math.abs(d.vx) + Math.abs(d.vy)) < 0.05 && Math.abs(d.angularVelRadS) < 0.05) {
        d.vx = 0;
        d.vy = 0;
        d.angularVelRadS = 0;
        // Keep it dynamic (it moved) but now at rest.
      }
    }
  }

  private emitColossusFire(dtSeconds: number): void {
    // Client doesn't run sim.
    if (this.netMode === "client") return;
    if (dtSeconds <= 0) return;

    const colossi = this.enemyPool.getActive().filter((e) => e.type === EnemyType.COLOSSUS);
    if (colossi.length === 0) return;

    // Deterministic phase accumulator.
    this.colossusFirePhase += dtSeconds;

    for (const c of colossi) {
      const h = c.wanderAngle;
      const cosH = Math.cos(h);
      const sinH = Math.sin(h);
      const nx = -sinH;
      const ny = cosH;

      // ~30-55 particles/sec depending on size.
      const rate = 32 + c.radius * 5;
      const want = rate * dtSeconds;
      let count = Math.floor(want);
      const frac = want - count;
      // Deterministic "fractional" extra based on id + phase.
      const gate = 0.5 + 0.5 * Math.sin((this.colossusFirePhase + c.id * 0.017) * 11.0);
      if (frac > gate) count++;
      if (count <= 0) continue;

      // Emit from a couple of "vents" near the front half.
      for (let i = 0; i < count; i++) {
        const t = this.colossusFirePhase * 2.2 + i * 0.9 + c.id * 0.01;
        const side = Math.sin(t * 3.1);
        const along = 0.35 + 0.25 * Math.sin(t * 2.3);
        const radial = 0.40 + 0.20 * Math.sin(t * 4.7);

        const px = c.x + cosH * (c.radius * along) + nx * (c.radius * 0.35 * side);
        const py = c.y + sinH * (c.radius * along) + ny * (c.radius * 0.35 * side);

        const vx = cosH * (1.2 + 1.6 * radial) + nx * (side * 0.8);
        const vy = sinH * (1.2 + 1.6 * radial) + ny * (side * 0.8);

        const hot = 0.5 + 0.5 * Math.sin(t * 5.0);
        const color = hot > 0.6 ? "rgba(255, 210, 80, 0.95)" : "rgba(255, 120, 40, 0.92)";
        this.emitParticles({
          x: px,
          y: py,
          vx,
          vy,
          lifetime: 0.55 + 0.25 * radial,
          sizeM: 0.18 + 0.18 * radial,
          color,
          count: 1
        });
      }
    }
  }

  private shootColossusFireballs(dtSeconds: number): void {
    // Client doesn't run sim.
    if (this.netMode === "client") return;
    if (dtSeconds <= 0) return;
    if (this.damage01 >= 1) return;
    if (this.raceFinished) return;

    // Deterministic phase accumulator for firing patterns.
    this.colossusShotPhase += dtSeconds;

    this.colossusShotCooldownS = Math.max(0, this.colossusShotCooldownS - dtSeconds);
    if (this.colossusShotCooldownS > 0) return;

    const colossi = this.enemyPool.getActive().filter((e) => e.type === EnemyType.COLOSSUS);
    if (colossi.length === 0) return;

    // Choose the closest colossus to keep attacks predictable.
    let best = colossi[0];
    let bestD2 = Infinity;
    for (const c of colossi) {
      const dx = this.state.car.xM - c.x;
      const dy = this.state.car.yM - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }

    const dx = this.state.car.xM - best.x;
    const dy = this.state.car.yM - best.y;
    const dist = Math.max(1e-6, Math.hypot(dx, dy));

    // Don't shoot from extremely far away.
    if (dist > 260) {
      this.colossusShotCooldownS = 0.55;
      return;
    }

    const baseAngle = Math.atan2(dy, dx);
    // Wide, deterministic spread so it doesn't track accurately.
    const spreadMaxRad = 0.55;
    const spreadA = Math.sin((this.colossusShotPhase + best.id * 0.013) * 3.9);
    const spreadB = Math.sin((this.colossusShotPhase + best.id * 0.071) * 7.1);
    const spreadRad = (0.55 * spreadA + 0.45 * spreadB) * spreadMaxRad;
    const aimAngle = baseAngle + spreadRad;
    const dirX = Math.cos(aimAngle);
    const dirY = Math.sin(aimAngle);

    const speed = 18;
    const spawnX = best.x + dirX * (best.radius * 0.85);
    const spawnY = best.y + dirY * (best.radius * 0.85);
    this.enemyProjectiles.push({ x: spawnX, y: spawnY, vx: dirX * speed, vy: dirY * speed, age: 0, maxAge: 3.2 });

    // Slower cadence overall (still somewhat distance-based).
    const dist01 = clamp(dist / 240, 0, 1);
    this.colossusShotCooldownS = 1.45 + 1.65 * dist01;
    this.playNetEffect("explosion", 0.22, 0.85);
  }

  private updateEnemyProjectiles(dtSeconds: number): void {
    if (this.netMode === "client") return;
    if (this.enemyProjectiles.length === 0) return;

    for (const p of this.enemyProjectiles) {
      p.x += p.vx * dtSeconds;
      p.y += p.vy * dtSeconds;
      p.age += dtSeconds;

      // Simple collision against car.
      const dx = p.x - this.state.car.xM;
      const dy = p.y - this.state.car.yM;
      const d = Math.hypot(dx, dy);
      if (d < 1.05 && this.damage01 < 1) {
        // Fireballs should hurt a bit, but mostly destabilize handling.
        this.damage01 = clamp(this.damage01 + 0.06, 0, 1);

        // Destabilize: yaw kick + slight speed loss.
        const cosH = Math.cos(this.state.car.headingRad);
        const sinH = Math.sin(this.state.car.headingRad);
        // Tangential direction around car (right-hand).
        const tx = -dy / Math.max(1e-6, d);
        const ty = dx / Math.max(1e-6, d);
        // Determine which side of the car relative to forward vector.
        const fx = cosH;
        const fy = sinH;
        const side = Math.sign((dx / Math.max(1e-6, d)) * fy - (dy / Math.max(1e-6, d)) * fx) || 1;
        const speedMS = this.speedMS();
        const kick = 0.25 + 0.55 * clamp(speedMS / 26, 0, 1);
        this.state.car.yawRateRadS += side * kick;
        this.state.car.vxMS *= 0.965;
        this.state.car.vyMS *= 0.965;
        this.playNetEffect("impact", 0.9, 0.85);
        this.cameraShakeX = (dx / Math.max(1e-6, d)) * 0.55;
        this.cameraShakeY = (dy / Math.max(1e-6, d)) * 0.55;
        this.emitParticles({
          x: p.x,
          y: p.y,
          vx: tx * 0.8,
          vy: ty * 0.8,
          lifetime: 0.28,
          sizeM: 0.22,
          color: "rgba(255, 155, 70, 0.95)",
          count: 16
        });
        p.age = p.maxAge + 1;
      }
    }

    this.enemyProjectiles = this.enemyProjectiles.filter((p) => p.age < p.maxAge);
  }

  private updateCheckpointsAndRace(proj: TrackProjection): void {
    if (this.raceFinished) return; // Don't update if race is done
    if (this.damage01 >= 1) return; // Stop timer/progression when wrecked

    const speed = this.speedMS();
    if (speed < 1.5) {
      this.insideActiveGate = false;
      return;
    }

    const gateSM = this.checkpointSM[this.nextCheckpointIndex];
    const gate = pointOnTrack(this.track, gateSM);
    const tx = Math.cos(gate.headingRad);
    const ty = Math.sin(gate.headingRad);

    const signedNow = (this.state.car.xM - gate.p.x) * tx + (this.state.car.yM - gate.p.y) * ty;
    const signedPrev = (this.prevCarX - gate.p.x) * tx + (this.prevCarY - gate.p.y) * ty;

    // Effectively infinite gate line (no lateral requirement); keep a modest along-track window
    // to avoid false triggers when far away.
    const nearGate = Math.abs(proj.sM - gateSM) < 18;

    const cosH = Math.cos(this.state.car.headingRad);
    const sinH = Math.sin(this.state.car.headingRad);
    const vxW = this.state.car.vxMS * cosH - this.state.car.vyMS * sinH;
    const vyW = this.state.car.vxMS * sinH + this.state.car.vyMS * cosH;
    const forwardAlongGate = vxW * tx + vyW * ty;

    const crossedForward = signedPrev <= 0 && signedNow > 0 && forwardAlongGate > 0.5;
    const insideGate = nearGate && crossedForward;

    if (insideGate && !this.insideActiveGate) {
      if (this.nextCheckpointIndex === 0) {
        // Start the race timer when crossing the start line
        this.raceActive = true;
        this.raceStartTimeSeconds = this.state.timeSeconds;
        this.startReplayRecording();
        this.nextCheckpointIndex = 1;
        this.showNotification("GO!");
        this.playNetEffect("checkpoint", 0.8);
      } else if (this.nextCheckpointIndex === this.checkpointSM.length - 1) {
        // Finish line!
        this.raceFinished = true;
        this.raceActive = false;
        this.finishTimeSeconds = this.state.timeSeconds - this.raceStartTimeSeconds;
        this.nextCheckpointIndex = this.checkpointSM.length; // Move past last checkpoint

        // Hard stop: freeze the car exactly at the line and ignore controls.
        this.controlsLocked = true;
        this.lastInputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0, shoot: false, fromKeyboard: false };
        this.shootHeld = false;
        this.state.car.vxMS = 0;
        this.state.car.vyMS = 0;
        this.state.car.yawRateRadS = 0;
        this.state.car.steerAngleRad = 0;
        this.state.car.alphaFrontRad = 0;
        this.state.car.alphaRearRad = 0;

        const time = this.finishTimeSeconds.toFixed(2);
        this.showNotification(`FINISH! Time: ${time}s`);
        this.playNetEffect("checkpoint", 1.0); // Louder for finish

        this.stopReplayRecording(true);
        this.onRaceFinishedUi();
      } else {
        // Regular checkpoint
        this.nextCheckpointIndex += 1;
        const checkpointNum = this.nextCheckpointIndex;
        const totalCheckpoints = this.checkpointSM.length - 1; // Excluding finish
        this.showNotification(`Checkpoint ${checkpointNum}/${totalCheckpoints}`);
        this.playNetEffect("checkpoint", 0.7);
      }
      this.insideActiveGate = true;
    } else if (!nearGate) {
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
      if (tree.kind === "rock" && tree.poly && tree.poly.length >= 3) {
        const rockExtentR = tree.collR ?? tree.r;
        const dxC = this.state.car.xM - tree.x;
        const dyC = this.state.car.yM - tree.y;
        const broadR = carRadius + rockExtentR + 0.25;
        if (dxC * dxC + dyC * dyC > broadR * broadR) continue;

        const rot = tree.rotationRad ?? 0;
        const worldPoly = transformPoly(tree.poly, tree.x, tree.y, rot);
        const inside = pointInConvexPolygon(this.state.car.xM, this.state.car.yM, worldPoly);
        const cp = closestPointOnPolygon(this.state.car.xM, this.state.car.yM, worldPoly);
        const vx = this.state.car.xM - cp.x;
        const vy = this.state.car.yM - cp.y;
        const dist = Math.hypot(vx, vy);

        if (!inside && dist >= carRadius) continue;

        let nx: number;
        let ny: number;
        if (dist > 1e-6) {
          // Normal pointing from obstacle to car (outside). If inside, flip for pushout.
          const nToCarX = vx / dist;
          const nToCarY = vy / dist;
          nx = inside ? -nToCarX : nToCarX;
          ny = inside ? -nToCarY : nToCarY;
        } else {
          const dxc = this.state.car.xM - tree.x;
          const dyc = this.state.car.yM - tree.y;
          const d = Math.hypot(dxc, dyc);
          nx = d > 1e-6 ? dxc / d : 1;
          ny = d > 1e-6 ? dyc / d : 0;
        }

        const penetration = inside ? (carRadius + dist) : (carRadius - dist);
        if (penetration > 0) {
          this.state.car.xM += nx * penetration;
          this.state.car.yM += ny * penetration;
        }

        const cosH = Math.cos(this.state.car.headingRad);
        const sinH = Math.sin(this.state.car.headingRad);
        const vxW = this.state.car.vxMS * cosH - this.state.car.vyMS * sinH;
        const vyW = this.state.car.vxMS * sinH + this.state.car.vyMS * cosH;

        const vN = vxW * nx + vyW * ny;
        const tx = -ny;
        const ty = nx;
        const vT = vxW * tx + vyW * ty;

        const restitution = 0.10;
        const tangentialDamping = 0.42;

        const newVN = vN < 0 ? -vN * restitution : vN;
        const newVT = vT * tangentialDamping;

        const newVxW = newVN * nx + newVT * tx;
        const newVyW = newVN * ny + newVT * ty;

        this.state.car.vxMS = newVxW * cosH + newVyW * sinH;
        this.state.car.vyMS = -newVxW * sinH + newVyW * cosH;
        this.state.car.yawRateRadS *= 0.4;

        const impact = vN < 0 ? Math.abs(vN) : 0;
        if (impact > 1) {
          const dmg = 0.032;
          this.damage01 = clamp(this.damage01 + impact * dmg, 0, 1);
          const shakeIntensity = Math.min(impact * 0.26, 2.6);
          this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
          this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
          this.collisionFlashAlpha = Math.min(impact * 0.10, 0.35);
        }
        continue;
      }

      const dx = this.state.car.xM - tree.x;
      const dy = this.state.car.yM - tree.y;
      const dist = Math.hypot(dx, dy);
      const obstacleR = tree.collR ?? (tree.kind === "rock" ? tree.r * 0.46 : tree.r * 0.4);
      const minDist = carRadius + obstacleR;
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

      const restitution = tree.kind === "rock" ? 0.10 : 0.25;
      const tangentialDamping = tree.kind === "rock" ? 0.42 : 0.5;

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
        const dmg = tree.kind === "rock" ? 0.032 : 0.05;
        this.damage01 = clamp(this.damage01 + impact * dmg, 0, 1);
        const shakeIntensity = Math.min(impact * (tree.kind === "rock" ? 0.26 : 0.25), 2.6);
        this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
        this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
        this.collisionFlashAlpha = Math.min(impact * (tree.kind === "rock" ? 0.10 : 0.12), 0.35);
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
          // More collision HP: reduce damage per impact
          this.damage01 = clamp(this.damage01 + impact * 0.07, 0, 1);
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
      // Update always-visible FPS counter
      const fpsEl = document.getElementById("fps-counter");
      if (fpsEl) fpsEl.textContent = `${Math.round(this.fps)} FPS`;
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

  /**
   * Client-side projectile update for navigator shooting.
   * Client is authoritative for their own projectiles - updates, collision detection,
   * and damage events are handled locally, then damage is sent to host.
   */
  private stepClientProjectiles(dtSeconds: number): void {
    if (this.role !== PlayerRole.NAVIGATOR) return;
    
    // Handle hold-to-shoot for client (P2)
    if (this.shootHeld || this.lastInputState.shoot) {
      this.clientShoot();
    }
    
    // Update projectile positions
    this.projectilePool.update(dtSeconds);
    
    // Check collisions using remote enemy positions (synced from host)
    if (!this.netRemoteEnemies) return;
    
    const projectiles = this.projectilePool.getActive();
    const projectilesToRemove: number[] = [];
    
    for (const proj of projectiles) {
      let hit = false;
      
      // Check collision with trees/rocks
      for (const tree of this.trees) {
        if (tree.kind === "rock" && tree.poly && tree.poly.length >= 3) {
          const rot = tree.rotationRad ?? 0;
          const worldPoly = transformPoly(tree.poly, tree.x, tree.y, rot);
          if (pointInConvexPolygon(proj.x, proj.y, worldPoly)) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
          const cp = closestPointOnPolygon(proj.x, proj.y, worldPoly);
          const d = Math.hypot(proj.x - cp.x, proj.y - cp.y);
          if (d < 0.03) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
        } else {
          const dx = proj.x - tree.x;
          const dy = proj.y - tree.y;
          const dist = Math.hypot(dx, dy);
          const hitR = tree.collR ?? (tree.kind === "rock" ? tree.r * 0.46 : tree.r * 0.4);
          if (dist < hitR) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
        }
      }
      
      if (hit) continue;
      
      // Check collision with enemies (use synced positions from host)
      for (const enemy of this.netRemoteEnemies) {
        const dx = proj.x - enemy.x;
        const dy = proj.y - enemy.y;
        const distSq = dx * dx + dy * dy;
        const radiusSq = enemy.radius * enemy.radius;
        
        let collision = distSq < radiusSq;
        
        // Raycast for fast projectiles
        if (!collision) {
          const speed = Math.hypot(proj.vx, proj.vy);
          if (speed > 1) {
            const stepDist = speed * 0.016;
            const vx = proj.vx / speed;
            const vy = proj.vy / speed;
            const ex = enemy.x - proj.x;
            const ey = enemy.y - proj.y;
            const t = -(ex * vx + ey * vy);
            if (t > 0 && t < stepDist) {
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
          
          const damage = proj.damage || 1.0;
          const health = (enemy.health ?? 1) - damage;
          const killed = health <= 0;
          const isTank = enemy.type === "tank";
          
          // Queue damage event to send to host
          this.netClientDamageEvents.push({
            enemyId: enemy.id,
            damage,
            killed,
            x: enemy.x,
            y: enemy.y,
            isTank,
            enemyType: enemy.type,
            radiusM: enemy.radius
          });
          
          // Update local enemy health for visual feedback
          enemy.health = health;
          
          if (killed) {
            // Show death particles locally
            this.createEnemyDeathParticles(enemy.x, enemy.y, isTank, enemy.radius);
          } else {
            // Small hit particles
            this.particlePool.emit({
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
          
          // Play impact sound locally
          const impactVol = killed ? 0.7 : 0.4;
          if (this.audioUnlocked) {
            this.effectsAudio.playEffect("impact", impactVol);
          }
          
          hit = true;
          break;
        }
      }
    }
    
    for (const id of projectilesToRemove) {
      this.projectilePool.remove(id);
    }
  }

  private checkProjectileCollisions(): void {
    const projectiles = this.projectilePool.getActive();
    const projectilesToRemove: number[] = [];

    for (const proj of projectiles) {
      let hit = false;

      // Check collision with trees/rocks
      for (const tree of this.trees) {
        if (tree.kind === "rock" && tree.poly && tree.poly.length >= 3) {
          const rot = tree.rotationRad ?? 0;
          const worldPoly = transformPoly(tree.poly, tree.x, tree.y, rot);
          if (pointInConvexPolygon(proj.x, proj.y, worldPoly)) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
          const cp = closestPointOnPolygon(proj.x, proj.y, worldPoly);
          const d = Math.hypot(proj.x - cp.x, proj.y - cp.y);
          if (d < 0.03) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
        } else {
          const dx = proj.x - tree.x;
          const dy = proj.y - tree.y;
          const dist = Math.hypot(dx, dy);

          const hitR = tree.collR ?? (tree.kind === "rock" ? tree.r * 0.46 : tree.r * 0.4);
          if (dist < hitR) {
            projectilesToRemove.push(proj.id);
            hit = true;
            break;
          }
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
            this.createEnemyDeathParticles(enemy.x, enemy.y, enemy.type === "tank", enemy.radius);
            if (this.netMode === "host") {
              this.netParticleEvents.push({ type: "enemyDeath", x: enemy.x, y: enemy.y, isTank: enemy.type === "tank", radiusM: enemy.radius });
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
          const impactVol = (damagedEnemy && damagedEnemy.health <= 0) ? 0.7 : 0.4;
          this.playNetEffect("impact", impactVol);

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

  private createEnemyDeathParticles(x: number, y: number, isTank: boolean = false, radiusM?: number): void {
    // Deterministic local RNG (avoid Math.random for net-consistent visuals).
    const xi = Math.floor(x * 1000);
    const yi = Math.floor(y * 1000);
    const ri = Math.floor((radiusM ?? (isTank ? 0.9 : 0.6)) * 1000);
    let rngState = ((xi * 374761393) ^ (yi * 668265263) ^ (ri * 2147483647) ^ (isTank ? 0x1badf00d : 0x9e3779b9)) >>> 0;
    const rand01 = (): number => {
      // xorshift32
      let x = (rngState >>> 0) || 0x12345678;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      rngState = x >>> 0;
      return rngState / 4294967296;
    };

    const rBase = Math.max(0.55, radiusM ?? (isTank ? 0.95 : 0.7));
    let particleCount: number;
    let speedMin: number;
    let speedRange: number;

    if (isTank) {
      // MASSIVE explosion for tanks
      particleCount = 200 + Math.floor(rand01() * 100); // 200-300 particles
      speedMin = 4;
      speedRange = 8; // 4-12 m/s
    } else {
      // High density for zombies
      particleCount = 80 + Math.floor(rand01() * 50); // 80-130 particles
      speedMin = 2;
      speedRange = 5; // 2-7 m/s
    }

    for (let i = 0; i < particleCount; i++) {
      const angle = rand01() * Math.PI * 2;
      const speed = speedMin + rand01() * speedRange;

      // Spawn across the full body, not from the center.
      const r = rBase * (0.55 + 0.45 * rand01());
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;

      // Vary particle colors for more visual interest
      const colorVariant = rand01();
      let color;
      if (colorVariant < 0.7) {
        color = "rgba(180, 50, 50, 0.85)"; // Dark red
      } else if (colorVariant < 0.9) {
        color = "rgba(220, 80, 70, 0.8)"; // Bright red
      } else {
        color = "rgba(120, 30, 30, 0.9)"; // Very dark red/brown
      }

      this.particlePool.emit({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        sizeM: 0.12 + rand01() * 0.25, // 0.12-0.37m (varied sizes)
        lifetime: 0.7 + rand01() * 0.6, // Short-lived (was 600s persistent)
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
        const isTank = enemy.type === "tank";
        const isColossus = enemy.type === "colossus";
        const isZombie = enemy.type === "zombie";
        const push = isColossus ? 0.95 : (isTank ? 0.35 : (isZombie ? 0.12 : 0.22));
        this.state.car.xM += nx * overlap * push;
        this.state.car.yM += ny * overlap * push;

        // Type-specific physics
        // Colossus should feel like a catastrophic collision.
        // Tanks should feel less like immovable walls
        const speedReduction = isColossus ? 0.55 : (isTank ? 0.78 : (isZombie ? 0.92 : 0.86));
        const distortionMultiplier = isColossus ? 0.65 : (isTank ? 0.25 : (isZombie ? 0.06 : 0.12));
        // Damage from enemy impacts
        const damageRate = isColossus ? 0.11 : (isTank ? 0.03 : (isZombie ? 0.0035 : 0.008));
        const baseDamage = isColossus ? 0.18 : 0;

        this.state.car.vxMS *= speedReduction;
        this.state.car.vyMS *= speedReduction;

        const lateralImpact = (this.state.car.vyMS * nx - this.state.car.vxMS * ny) * distortionMultiplier;
        this.state.car.yawRateRadS += lateralImpact;

        const contactSeverity = isColossus ? Math.max(impact, overlap * 4.0) : impact;
        this.damage01 = clamp(this.damage01 + baseDamage + contactSeverity * damageRate, 0, 1);

        // Camera shake
        const shakeIntensity = Math.min(contactSeverity * (isColossus ? 0.85 : (isTank ? 0.5 : (isZombie ? 0.12 : 0.22))), 3.2);
        if (isColossus) {
          // Deterministic shove-based shake for the boss.
          this.cameraShakeX = nx * shakeIntensity * 0.55;
          this.cameraShakeY = ny * shakeIntensity * 0.55;
        } else {
          this.cameraShakeX = (Math.random() - 0.5) * shakeIntensity;
          this.cameraShakeY = (Math.random() - 0.5) * shakeIntensity;
        }
        this.collisionFlashAlpha = Math.min(contactSeverity * (isColossus ? 0.22 : (isTank ? 0.15 : (isZombie ? 0.03 : 0.06))), 0.65);

        // Kill/Damage enemy on impact (usually kills zombies immediately).
        // The colossus should not be damaged by touching the car.
        if (!isColossus) {
          const damaged = this.enemyPool.damage(enemy.id, 1.0);
          if (damaged && damaged.health <= 0) {
            this.enemyKillCount++;
              this.createEnemyDeathParticles(enemy.x, enemy.y, isTank, enemy.radius);
            if (this.netMode === "host") {
                this.netParticleEvents.push({ type: "enemyDeath", x: enemy.x, y: enemy.y, isTank, radiusM: enemy.radius });
            }
          }
        }

        // Play impact sound
        const base = isTank ? 0.85 : (enemy.type === "zombie" ? 0.48 : 0.72);
        const impactVolume = clamp(base + impact * 0.18, 0, 1);
        this.playNetEffect("impact", impactVolume);
      }
    }
  }
}

function transformPoly(poly: { x: number; y: number }[], tx: number, ty: number, rotRad: number): { x: number; y: number }[] {
  const c = Math.cos(rotRad);
  const s = Math.sin(rotRad);
  const out: { x: number; y: number }[] = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const x = p.x * c - p.y * s;
    const y = p.x * s + p.y * c;
    out[i] = { x: x + tx, y: y + ty };
  }
  return out;
}

function pointInConvexPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  // Assumes vertices are in CW or CCW order.
  let sign = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  const t = abLen2 > 1e-9 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2)) : 0;
  return { x: ax + abx * t, y: ay + aby * t };
}

function closestPointOnPolygon(px: number, py: number, poly: { x: number; y: number }[]): { x: number; y: number } {
  let bestX = poly[0].x;
  let bestY = poly[0].y;
  let bestD2 = Number.POSITIVE_INFINITY;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const cp = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
    const dx = px - cp.x;
    const dy = py - cp.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = cp.x;
      bestY = cp.y;
    }
  }
  return { x: bestX, y: bestY };
}

function surfaceFillStyle(surface: Surface): string {
  switch (surface.name) {
    case "tarmac":
      return "rgba(70, 75, 85, 1.0)"; // Darker gray - asphalt (opaque for predictability)
    case "gravel":
      return "rgba(140, 145, 150, 1.0)"; // Gray-ish gravel (opaque)
    case "sand":
      return "rgba(200, 180, 120, 1.0)"; // Pale tan - sand (opaque)
    case "ice":
      return "rgba(180, 220, 245, 1.0)"; // Light blue - ice (opaque)
    case "offtrack":
      return "rgba(100, 130, 90, 1.0)"; // Green-gray - grass (opaque)
  }
}

