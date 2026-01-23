import { KeyboardInput } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";
import { createCarState, defaultCarParams, stepCar, type CarTelemetry } from "../sim/car";
import { createDefaultTrack, pointOnTrack, projectToTrack } from "../sim/track";
import { surfaceForTrackSM, type Surface } from "../sim/surface";

type GameState = {
  timeSeconds: number;
  car: ReturnType<typeof createCarState>;
  carTelemetry: CarTelemetry;
};

export class Game {
  private readonly renderer: Renderer2D;
  private readonly input: KeyboardInput;
  private readonly track = createDefaultTrack();
  private readonly trackSegmentFillStyles: string[];
  private readonly checkpointSM: number[];
  private nextCheckpointIndex = 0;
  private insideActiveGate = false;
  private lapActive = false;
  private lapStartTimeSeconds = 0;
  private lapCount = 0;
  private bestLapTimeSeconds: number | null = null;
  private lastSurface: Surface = { name: "tarmac", frictionMu: 1, rollingResistanceN: 260 };
  private lastTrackS = 0;
  private running = false;

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
      slipAngleFrontRad: 0,
      slipAngleRearRad: 0,
      longitudinalForceFrontN: 0,
      longitudinalForceRearN: 0,
      lateralForceFrontN: 0,
      lateralForceRearN: 0,
      normalLoadFrontN: 0,
      normalLoadRearN: 0
    }
  };
  private readonly carParams = defaultCarParams();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer2D(canvas);
    this.input = new KeyboardInput(window);

    this.trackSegmentFillStyles = [];
    for (let i = 0; i < this.track.points.length; i++) {
      const midSM = this.track.cumulativeLengthsM[i] + this.track.segmentLengthsM[i] * 0.5;
      const surface = surfaceForTrackSM(this.track.totalLengthM, midSM, false);
      this.trackSegmentFillStyles.push(surfaceFillStyle(surface));
    }

    this.checkpointSM = [
      0,
      this.track.totalLengthM * 0.25,
      this.track.totalLengthM * 0.5,
      this.track.totalLengthM * 0.75
    ];

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.reset();
    });

    this.reset();
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
    this.state.timeSeconds += dtSeconds;

    const steer = this.input.axis("steer"); // [-1..1]
    const throttle = this.input.axis("throttle"); // [0..1]
    const brake = this.input.axis("brake"); // [0..1]
    const handbrake = this.input.axis("handbrake"); // [0..1]

    const projection = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    const offTrack = projection.distanceToCenterlineM > this.track.widthM * 0.5;
    this.lastSurface = surfaceForTrackSM(this.track.totalLengthM, projection.sM, offTrack);
    this.lastTrackS = projection.sM;

    const stepped = stepCar(
      this.state.car,
      this.carParams,
      { steer, throttle, brake, handbrake },
      dtSeconds,
      { frictionMu: this.lastSurface.frictionMu, rollingResistanceN: this.lastSurface.rollingResistanceN }
    );
    this.state.car = stepped.state;
    this.state.carTelemetry = stepped.telemetry;

    this.updateCheckpointsAndLap(projection);
  }

  private render(): void {
    const { width, height } = this.renderer.resizeToDisplay();
    const ctx = this.renderer.ctx;

    ctx.clearRect(0, 0, width, height);

    this.renderer.beginCamera({
      centerX: this.state.car.xM,
      centerY: this.state.car.yM,
      pixelsPerMeter: 36
    });

    this.renderer.drawGrid({ spacingMeters: 1, majorEvery: 5 });
    this.renderer.drawTrack({ ...this.track, segmentFillStyles: this.trackSegmentFillStyles });
    const start = pointOnTrack(this.track, 0);
    this.renderer.drawStartLine({
      x: start.p.x,
      y: start.p.y,
      headingRad: start.headingRad + Math.PI / 2,
      widthM: this.track.widthM
    });
    const activeGate = pointOnTrack(this.track, this.checkpointSM[this.nextCheckpointIndex]);
    this.renderer.drawCheckpointLine({
      x: activeGate.p.x,
      y: activeGate.p.y,
      headingRad: activeGate.headingRad + Math.PI / 2,
      widthM: this.track.widthM
    });
    this.renderer.drawCar({
      x: this.state.car.xM,
      y: this.state.car.yM,
      headingRad: this.state.car.headingRad,
      speed: this.speedMS()
    });

    this.renderer.endCamera();

    this.renderer.drawPanel({
      x: 12,
      y: 12,
      title: "Debug",
      lines: [
        `FPS: ${this.fps.toFixed(0)}`,
        `t: ${this.state.timeSeconds.toFixed(2)}s`,
        `speed: ${this.speedMS().toFixed(2)} m/s`,
        `steer: ${this.input.axis("steer").toFixed(2)}  throttle: ${this.input.axis("throttle").toFixed(2)}  brake: ${this.input
          .axis("brake")
          .toFixed(2)}`,
        `handbrake: ${this.input.axis("handbrake").toFixed(2)}`,
        `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`,
        `checkpoint: ${this.nextCheckpointIndex + 1}/${this.checkpointSM.length}`,
        `surface: ${this.lastSurface.name}  (μ=${this.lastSurface.frictionMu.toFixed(2)})`
      ]
    });

    this.renderer.drawPanel({
      x: width - 12,
      y: 12,
      anchorX: "right",
      title: "Controls",
      lines: [
        `W / ↑  throttle`,
        `S / ↓  brake`,
        `A/D or ←/→ steer`,
        `Space  handbrake`,
        `R      reset`
      ]
    });

    const deg = (rad: number) => (rad * 180) / Math.PI;
    this.renderer.drawPanel({
      x: 12,
      y: height - 12,
      title: "Tires",
      lines: [
        `steerAngle: ${deg(this.state.carTelemetry.steerAngleRad).toFixed(1)}°`,
        `alphaF: ${deg(this.state.carTelemetry.slipAngleFrontRad).toFixed(1)}°`,
        `alphaR: ${deg(this.state.carTelemetry.slipAngleRearRad).toFixed(1)}°`,
        `FzF: ${this.state.carTelemetry.normalLoadFrontN.toFixed(0)} N  FxF: ${this.state.carTelemetry.longitudinalForceFrontN.toFixed(0)} N`,
        `FzR: ${this.state.carTelemetry.normalLoadRearN.toFixed(0)} N  FxR: ${this.state.carTelemetry.longitudinalForceRearN.toFixed(0)} N`,
        `FyF: ${this.state.carTelemetry.lateralForceFrontN.toFixed(0)} N`,
        `FyR: ${this.state.carTelemetry.lateralForceRearN.toFixed(0)} N`
      ],
      anchorX: "left",
      anchorY: "bottom"
    });

    const lapTime = this.lapActive ? this.state.timeSeconds - this.lapStartTimeSeconds : 0;
    this.renderer.drawPanel({
      x: width - 12,
      y: height - 12,
      anchorX: "right",
      anchorY: "bottom",
      title: "Rally",
      lines: [
        `lap: ${this.lapCount}`,
        `time: ${lapTime.toFixed(2)}s`,
        `best: ${this.bestLapTimeSeconds ? `${this.bestLapTimeSeconds.toFixed(2)}s` : "--"}`,
        `s: ${this.lastTrackS.toFixed(1)}m`
      ]
    });
  }

  private speedMS(): number {
    return Math.hypot(this.state.car.vxMS, this.state.car.vyMS);
  }

  private reset(): void {
    const spawn = pointOnTrack(this.track, 6);
    this.state.car = {
      ...createCarState(),
      xM: spawn.p.x,
      yM: spawn.p.y,
      headingRad: spawn.headingRad
    };
    this.nextCheckpointIndex = 0;
    this.insideActiveGate = false;
    this.lapActive = false;
    this.lapStartTimeSeconds = this.state.timeSeconds;
  }

  private updateCheckpointsAndLap(proj: { sM: number; distanceToCenterlineM: number }): void {
    const speed = this.speedMS();
    if (speed < 1.5) {
      this.insideActiveGate = false;
      return;
    }

    const gateSM = this.checkpointSM[this.nextCheckpointIndex];
    const insideGate =
      circularDistance(proj.sM, gateSM, this.track.totalLengthM) < 3.5 &&
      proj.distanceToCenterlineM < this.track.widthM * 0.6;

    if (insideGate && !this.insideActiveGate) {
      if (this.nextCheckpointIndex === 0) {
        if (!this.lapActive) {
          this.lapActive = true;
          this.lapStartTimeSeconds = this.state.timeSeconds;
        } else {
          const lapTime = this.state.timeSeconds - this.lapStartTimeSeconds;
          this.lapStartTimeSeconds = this.state.timeSeconds;
          this.lapCount += 1;
          this.bestLapTimeSeconds = this.bestLapTimeSeconds === null ? lapTime : Math.min(this.bestLapTimeSeconds, lapTime);
        }
      }

      this.nextCheckpointIndex = (this.nextCheckpointIndex + 1) % this.checkpointSM.length;
      this.insideActiveGate = true;
    } else if (!insideGate) {
      this.insideActiveGate = false;
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
}

function circularDistance(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

function surfaceFillStyle(surface: Surface): string {
  switch (surface.name) {
    case "tarmac":
      return "rgba(210, 220, 235, 0.14)";
    case "gravel":
      return "rgba(210, 190, 140, 0.14)";
    case "dirt":
      return "rgba(165, 125, 90, 0.14)";
    case "offtrack":
      return "rgba(120, 170, 120, 0.10)";
  }
}
