import { KeyboardInput } from "./input";
import { Renderer2D } from "./renderer2d";
import { clamp } from "./math";
import { createCarState, defaultCarParams, stepCar, type CarTelemetry } from "../sim/car";
import { createDefaultTrack, pointOnTrack, projectToTrack, type TrackProjection } from "../sim/track";
import { surfaceForTrackSM, type Surface } from "../sim/surface";
import { generateTrees, type CircleObstacle } from "../sim/props";
import type { TuningPanel } from "./tuning";

type GameState = {
  timeSeconds: number;
  car: ReturnType<typeof createCarState>;
  carTelemetry: CarTelemetry;
};

export class Game {
  private readonly renderer: Renderer2D;
  private readonly input: KeyboardInput;
  private readonly tuning?: TuningPanel;
  private readonly track = createDefaultTrack();
  private readonly trackSegmentFillStyles: string[];
  private readonly trees: CircleObstacle[];
  private readonly checkpointSM: number[];
  private nextCheckpointIndex = 0;
  private insideActiveGate = false;
  private lapActive = false;
  private lapStartTimeSeconds = 0;
  private lapCount = 0;
  private bestLapTimeSeconds: number | null = null;
  private damage01 = 0;
  private lastSurface: Surface = { name: "tarmac", frictionMu: 1, rollingResistanceN: 260 };
  private lastTrackS = 0;
  private showForceArrows = true;
  private gear: "F" | "R" = "F";
  private visualRollOffsetM = 0;
  private visualRollVel = 0;
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
      slipAngleFrontInstantRad: 0,
      slipAngleRearInstantRad: 0,
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
  private carParams = defaultCarParams();

  constructor(canvas: HTMLCanvasElement, tuning?: TuningPanel) {
    this.renderer = new Renderer2D(canvas);
    this.input = new KeyboardInput(window);
    this.tuning = tuning;

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

    this.trees = generateTrees(this.track, { seed: 20260123 });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyR") this.reset();
      if (e.code === "KeyF") {
        this.showForceArrows = !this.showForceArrows;
        this.tuning?.setShowArrows(this.showForceArrows);
      }
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
    const roadHalfWidthM = this.track.widthM * 0.5;
    const offTrack = projectionBefore.distanceToCenterlineM > roadHalfWidthM;
    this.lastSurface = surfaceForTrackSM(this.track.totalLengthM, projectionBefore.sM, offTrack);

    const stepped = stepCar(
      this.state.car,
      this.carParams,
      { steer, throttle, brake, handbrake },
      dtSeconds,
      { frictionMu: this.lastSurface.frictionMu, rollingResistanceN: this.lastSurface.rollingResistanceN }
    );
    this.state.car = stepped.state;
    this.state.carTelemetry = stepped.telemetry;
    this.updateVisualRoll(dtSeconds);

    const projectionAfter = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.resolveHardBoundary(projectionAfter);

    const projectionFinal = projectToTrack(this.track, { x: this.state.car.xM, y: this.state.car.yM });
    this.lastTrackS = projectionFinal.sM;
    this.updateCheckpointsAndLap(projectionFinal);

    this.resolveTreeCollisions();
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
    const ctx = this.renderer.ctx;

    ctx.clearRect(0, 0, width, height);

    this.renderer.beginCamera({
      centerX: this.state.car.xM,
      centerY: this.state.car.yM,
      pixelsPerMeter: 36
    });

    this.renderer.drawGrid({ spacingMeters: 1, majorEvery: 5 });
    this.renderer.drawTrack({ ...this.track, segmentFillStyles: this.trackSegmentFillStyles });
    this.renderer.drawTrees(this.trees);
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
      speed: this.speedMS(),
      rollOffsetM: this.visualRollOffsetM
    });

    if (this.showForceArrows) {
      this.drawForceArrows();
    }

    this.renderer.endCamera();

    const speedMS = this.speedMS();
    const speedKmH = speedMS * 3.6;
    this.renderer.drawPanel({
      x: 12,
      y: 12,
      title: "Debug",
      lines: [
        `FPS: ${this.fps.toFixed(0)}`,
        `t: ${this.state.timeSeconds.toFixed(2)}s`,
        `speed: ${speedMS.toFixed(2)} m/s (${speedKmH.toFixed(0)} km/h)`,
        `steer: ${this.input.axis("steer").toFixed(2)}  throttle: ${this.input.axis("throttle").toFixed(2)}  brake/rev: ${this.input
          .axis("brake")
          .toFixed(2)}`,
        `handbrake: ${this.input.axis("handbrake").toFixed(2)}  gear: ${this.gear}`,
        `yawRate: ${this.state.car.yawRateRadS.toFixed(2)} rad/s`,
        `next gate: ${gateLabel(this.nextCheckpointIndex)}`,
        `surface: ${this.lastSurface.name}  (μ=${this.lastSurface.frictionMu.toFixed(2)})`,
        `damage: ${(this.damage01 * 100).toFixed(0)}%`
      ]
    });

    this.renderer.drawPanel({
      x: width - 12,
      y: 12,
      anchorX: "right",
      title: "Controls",
      lines: [
        `W / ↑  throttle`,
        `S / ↓  brake / reverse`,
        `A/D or ←/→ steer`,
        `Space  handbrake`,
        `R      reset`,
        `F      force arrows: ${this.showForceArrows ? "ON" : "OFF"}`,
        `arrows: forces + velocity`,
        `cross START to begin timer`
      ]
    });

    const deg = (rad: number) => (rad * 180) / Math.PI;
    this.renderer.drawPanel({
      x: 12,
      y: height - 12,
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
      anchorX: "left",
      anchorY: "bottom"
    });

    const lapTime = this.lapActive ? this.state.timeSeconds - this.lapStartTimeSeconds : 0;
    const stageLine = this.lapActive ? `running` : `not started`;
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
        `s: ${this.lastTrackS.toFixed(1)}m`,
        stageLine
      ]
    });

    // Side visualization of vectors (body frame: +x forward, +y left).
    if (this.showForceArrows) {
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
    this.carParams.engineForceN = clamp(t.engineForceN, 4000, 30000);
    this.carParams.maxSteerRad = clamp((t.maxSteerDeg * Math.PI) / 180, 0.15, 1.2);
    this.carParams.driveBiasFront = clamp(t.driveBiasFront01, 0, 1);

    // UI can override arrows, but keep KeyF working by syncing.
    this.showForceArrows = t.showArrows;
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
    const spawn = pointOnTrack(this.track, this.track.totalLengthM - 6);
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
    this.damage01 = 0;
    this.state.car.steerAngleRad = 0;
    this.visualRollOffsetM = 0;
    this.visualRollVel = 0;
  }

  private updateCheckpointsAndLap(proj: TrackProjection): void {
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
          // Start the stage timer the first time we cross START.
          this.lapActive = true;
          this.lapStartTimeSeconds = this.state.timeSeconds;
          this.nextCheckpointIndex = 1;
        } else {
          const lapTime = this.state.timeSeconds - this.lapStartTimeSeconds;
          this.lapStartTimeSeconds = this.state.timeSeconds;
          this.lapCount += 1;
          this.bestLapTimeSeconds =
            this.bestLapTimeSeconds === null ? lapTime : Math.min(this.bestLapTimeSeconds, lapTime);
          this.nextCheckpointIndex = 1;
        }
      } else {
        this.nextCheckpointIndex = (this.nextCheckpointIndex + 1) % this.checkpointSM.length;
      }
      this.insideActiveGate = true;
    } else if (!insideGate) {
      this.insideActiveGate = false;
    }
  }

  private resolveHardBoundary(proj: TrackProjection): void {
    const roadHalfWidthM = this.track.widthM * 0.5;
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
    }
  }

  private resolveTreeCollisions(): void {
    if (this.damage01 >= 1) return;

    const carRadius = 1.55;
    for (const tree of this.trees) {
      const dx = this.state.car.xM - tree.x;
      const dy = this.state.car.yM - tree.y;
      const dist = Math.hypot(dx, dy);
      const minDist = carRadius + tree.r;
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

      const restitution = 0.08;
      const tangentialDamping = 0.35;
      const newVN = vN > 0 ? -vN * restitution : vN;
      const newVT = vT * tangentialDamping;

      const newVxW = newVN * nx + newVT * tx;
      const newVyW = newVN * ny + newVT * ty;

      this.state.car.vxMS = newVxW * cosH + newVyW * sinH;
      this.state.car.vyMS = -newVxW * sinH + newVyW * cosH;
      this.state.car.yawRateRadS *= 0.5;

      const impact = Math.max(0, vN);
      if (impact > 1) {
        this.damage01 = clamp(this.damage01 + impact * 0.09, 0, 1);
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
}

function circularDistance(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

function gateLabel(index: number): string {
  if (index === 0) return "START";
  return `CP${index}`;
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
