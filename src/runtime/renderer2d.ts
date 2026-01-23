import { clamp } from "./math";

type Camera2D = {
  centerX: number;
  centerY: number;
  pixelsPerMeter: number;
};

export class Renderer2D {
  readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;

  private camera: Camera2D = { centerX: 0, centerY: 0, pixelsPerMeter: 36 };

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.canvas = canvas;
  }

  resizeToDisplay(): { width: number; height: number } {
    const dpr = clamp(window.devicePixelRatio ?? 1, 1, 3);
    const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
    const displayHeight = Math.floor(this.canvas.clientHeight * dpr);

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }

    return { width: this.canvas.width, height: this.canvas.height };
  }

  beginCamera(camera: Camera2D): void {
    this.camera = camera;
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.pixelsPerMeter, camera.pixelsPerMeter);
    ctx.translate(-camera.centerX, -camera.centerY);
  }

  endCamera(): void {
    this.ctx.restore();
  }

  drawGrid(opts: { spacingMeters: number; majorEvery: number }): void {
    const ctx = this.ctx;
    const spacing = opts.spacingMeters;
    const majorEvery = Math.max(1, Math.floor(opts.majorEvery));

    const { width, height } = this.canvas;
    const viewHalfW = (width / 2) / this.camera.pixelsPerMeter;
    const viewHalfH = (height / 2) / this.camera.pixelsPerMeter;

    const minX = this.camera.centerX - viewHalfW;
    const maxX = this.camera.centerX + viewHalfW;
    const minY = this.camera.centerY - viewHalfH;
    const maxY = this.camera.centerY + viewHalfH;

    const startX = Math.floor(minX / spacing) * spacing;
    const endX = Math.ceil(maxX / spacing) * spacing;
    const startY = Math.floor(minY / spacing) * spacing;
    const endY = Math.ceil(maxY / spacing) * spacing;

    ctx.lineWidth = 1 / this.camera.pixelsPerMeter;

    for (let x = startX; x <= endX + 1e-9; x += spacing) {
      const isMajor = (Math.round(x / spacing) % majorEvery) === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }

    for (let y = startY; y <= endY + 1e-9; y += spacing) {
      const isMajor = (Math.round(y / spacing) % majorEvery) === 0;
      ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(123, 200, 255, 0.28)";
    ctx.beginPath();
    ctx.moveTo(0, minY);
    ctx.lineTo(0, maxY);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 120, 180, 0.28)";
    ctx.beginPath();
    ctx.moveTo(minX, 0);
    ctx.lineTo(maxX, 0);
    ctx.stroke();
  }

  drawCar(car: { x: number; y: number; headingRad: number; speed: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.headingRad);

    const length = 1.1;
    const width = 0.55;

    ctx.fillStyle = "rgba(240, 246, 255, 0.9)";
    ctx.strokeStyle = "rgba(30, 40, 60, 0.9)";
    ctx.lineWidth = 2 / this.camera.pixelsPerMeter;

    ctx.beginPath();
    ctx.rect(-length * 0.5, -width * 0.5, length, width);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 205, 105, 0.95)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length * 0.55, 0);
    ctx.stroke();

    ctx.restore();
  }

  drawHud(opts: { lines: string[] }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.resetTransform();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(12, 12, 520, 118);
    ctx.fillStyle = "rgba(232,236,241,0.92)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.textBaseline = "top";
    for (let i = 0; i < opts.lines.length; i++) {
      ctx.fillText(opts.lines[i], 20, 20 + i * 18);
    }
    ctx.restore();
  }
}
