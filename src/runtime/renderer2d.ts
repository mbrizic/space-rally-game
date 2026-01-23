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
  private dpr = 1;
  private viewportWidthCssPx = 0;
  private viewportHeightCssPx = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.canvas = canvas;
  }

  resizeToDisplay(): { width: number; height: number } {
    const dpr = clamp(window.devicePixelRatio ?? 1, 1, 3);
    const displayWidthCssPx = Math.max(1, Math.floor(this.canvas.clientWidth));
    const displayHeightCssPx = Math.max(1, Math.floor(this.canvas.clientHeight));

    const displayWidthDevicePx = Math.floor(displayWidthCssPx * dpr);
    const displayHeightDevicePx = Math.floor(displayHeightCssPx * dpr);

    if (this.canvas.width !== displayWidthDevicePx || this.canvas.height !== displayHeightDevicePx) {
      this.canvas.width = displayWidthDevicePx;
      this.canvas.height = displayHeightDevicePx;
    }

    this.dpr = dpr;
    this.viewportWidthCssPx = displayWidthCssPx;
    this.viewportHeightCssPx = displayHeightCssPx;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { width: displayWidthCssPx, height: displayHeightCssPx };
  }

  beginCamera(camera: Camera2D): void {
    this.camera = camera;
    const width = this.viewportWidthCssPx || this.canvas.clientWidth;
    const height = this.viewportHeightCssPx || this.canvas.clientHeight;
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

    const width = this.viewportWidthCssPx || this.canvas.clientWidth;
    const height = this.viewportHeightCssPx || this.canvas.clientHeight;
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

  drawTrack(track: { points: { x: number; y: number }[]; widthM: number; segmentFillStyles?: string[] }): void {
    const ctx = this.ctx;
    if (track.points.length < 2) return;

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Shoulder / terrain edge hint.
    ctx.strokeStyle = "rgba(90, 120, 95, 0.16)";
    ctx.lineWidth = track.widthM * 1.32;
    ctx.beginPath();
    ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
    ctx.closePath();
    ctx.stroke();

    // Road fill.
    ctx.lineWidth = track.widthM;
    const fillStyles = track.segmentFillStyles;
    if (fillStyles && fillStyles.length === track.points.length) {
      for (let i = 0; i < track.points.length; i++) {
        const a = track.points[i];
        const b = track.points[(i + 1) % track.points.length];
        ctx.strokeStyle = fillStyles[i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(210, 220, 235, 0.10)";
      ctx.beginPath();
      ctx.moveTo(track.points[0].x, track.points[0].y);
      for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    // Road border.
    ctx.strokeStyle = "rgba(210, 220, 235, 0.26)";
    ctx.lineWidth = Math.max(0.15, track.widthM * 0.06);
    ctx.beginPath();
    ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
    ctx.closePath();
    ctx.stroke();

    // Centerline.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 0.18;
    ctx.setLineDash([0.8, 1.2]);
    ctx.beginPath();
    ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawStartLine(opts: { x: number; y: number; headingRad: number; widthM: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(opts.x, opts.y);
    ctx.rotate(opts.headingRad);
    ctx.lineWidth = 0.25;

    const half = opts.widthM * 0.5;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.setLineDash([0.4, 0.4]);
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawCheckpointLine(opts: { x: number; y: number; headingRad: number; widthM: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(opts.x, opts.y);
    ctx.rotate(opts.headingRad);
    ctx.lineWidth = 0.22;

    const half = opts.widthM * 0.5;
    ctx.strokeStyle = "rgba(90, 210, 255, 0.55)";
    ctx.setLineDash([0.6, 0.5]);
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
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

  drawTrees(trees: { x: number; y: number; r: number }[]): void {
    const ctx = this.ctx;
    ctx.save();
    for (const t of trees) {
      // Trunk.
      ctx.fillStyle = "rgba(110, 80, 55, 0.95)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Canopy.
      ctx.fillStyle = "rgba(80, 155, 95, 0.85)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(20, 30, 25, 0.25)";
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPanel(opts: {
    x: number;
    y: number;
    anchorX?: "left" | "right";
    anchorY?: "top" | "bottom";
    title?: string;
    lines: string[];
  }): void {
    const ctx = this.ctx;
    ctx.save();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const paddingX = 10;
    const paddingY = 8;
    const lineHeight = 20;
    const font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.font = font;
    ctx.textBaseline = "top";

    const title = opts.title;
    const textLines = title ? [title, ...opts.lines] : opts.lines;
    const width = textLines.reduce((maxWidth, line) => Math.max(maxWidth, ctx.measureText(line).width), 0);
    const panelWidth = Math.ceil(width + paddingX * 2);
    const panelHeight = Math.ceil(textLines.length * lineHeight + paddingY * 2);

    const x = (opts.anchorX ?? "left") === "right" ? Math.max(0, opts.x - panelWidth) : opts.x;
    const y = (opts.anchorY ?? "top") === "bottom" ? Math.max(0, opts.y - panelHeight) : opts.y;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y, panelWidth, panelHeight);

    ctx.fillStyle = "rgba(232,236,241,0.95)";
    let textY = y + paddingY;
    if (title) {
      ctx.fillStyle = "rgba(170, 210, 255, 0.95)";
      ctx.fillText(title, x + paddingX, textY);
      textY += lineHeight;
      ctx.fillStyle = "rgba(232,236,241,0.95)";
    }

    for (let i = 0; i < opts.lines.length; i++) {
      ctx.fillText(opts.lines[i], x + paddingX, textY + i * lineHeight);
    }
    ctx.restore();
  }

  drawCenterText(opts: { text: string; subtext?: string }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const mainSize = Math.max(44, Math.min(84, Math.floor(Math.min(w, h) * 0.13)));
    const subSize = Math.max(16, Math.min(22, Math.floor(mainSize * 0.28)));

    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(cx - 170, cy - 78, 340, 156);

    ctx.font = `${mainSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(232,236,241,0.98)";
    ctx.fillText(opts.text, cx, cy - (opts.subtext ? 10 : 0));

    if (opts.subtext) {
      ctx.font = `${subSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillStyle = "rgba(170, 210, 255, 0.95)";
      ctx.fillText(opts.subtext, cx, cy + mainSize * 0.42);
    }

    ctx.restore();
  }
}
