import { KeyboardInput } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";

type GameState = {
  timeSeconds: number;
  car: {
    x: number;
    y: number;
    headingRad: number;
    speed: number;
  };
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
    car: { x: 0, y: 0, headingRad: 0, speed: 0 }
  };

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

    const car = this.state.car;
    const accel = throttle * 10 - brake * 16 - car.speed * 1.2;
    car.speed = Math.max(0, car.speed + accel * dtSeconds);

    const steerRate = steer * (2.5 - Math.min(2, car.speed * 0.08));
    car.headingRad += steerRate * dtSeconds;

    car.x += Math.cos(car.headingRad) * car.speed * dtSeconds;
    car.y += Math.sin(car.headingRad) * car.speed * dtSeconds;
  }

  private render(): void {
    const { width, height } = this.renderer.resizeToDisplay();
    const ctx = this.renderer.ctx;

    ctx.clearRect(0, 0, width, height);

    this.renderer.beginCamera({
      centerX: this.state.car.x,
      centerY: this.state.car.y,
      pixelsPerMeter: 36
    });

    this.renderer.drawGrid({ spacingMeters: 1, majorEvery: 5 });
    this.renderer.drawCar(this.state.car);

    this.renderer.endCamera();

    this.renderer.drawPanel({
      x: 12,
      y: 12,
      title: "Debug",
      lines: [
        `FPS: ${this.fps.toFixed(0)}`,
        `t: ${this.state.timeSeconds.toFixed(2)}s`,
        `speed: ${this.state.car.speed.toFixed(2)} m/s`,
        `steer: ${this.input.axis("steer").toFixed(2)}  throttle: ${this.input.axis("throttle").toFixed(2)}  brake: ${this.input
          .axis("brake")
          .toFixed(2)}`,
      ]
    });

    this.renderer.drawPanel({
      x: width - 12,
      y: 12,
      anchor: "right",
      title: "Controls",
      lines: [
        `W / ↑  throttle`,
        `S / ↓  brake`,
        `A/D or ←/→ steer`,
        `Space  handbrake (reserved)`
      ]
    });
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
