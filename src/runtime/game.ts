import { KeyboardInput } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";
import { createCarState, defaultCarParams, stepCar, type CarTelemetry } from "../sim/car";

type GameState = {
  timeSeconds: number;
  car: ReturnType<typeof createCarState>;
  carTelemetry: CarTelemetry;
};

export class Game {
  private readonly renderer: Renderer2D;
  private readonly input: KeyboardInput;
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

    const stepped = stepCar(
      this.state.car,
      this.carParams,
      { steer, throttle, brake },
      dtSeconds
    );
    this.state.car = stepped.state;
    this.state.carTelemetry = stepped.telemetry;
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
        `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`
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
        `Space  handbrake (reserved)`
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
  }

  private speedMS(): number {
    return Math.hypot(this.state.car.vxMS, this.state.car.vyMS);
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
