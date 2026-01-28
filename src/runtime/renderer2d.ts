import { clamp } from "./math";
import type { City } from "../sim/city";
import type { TrackZone, TrackZoneKind } from "../sim/stage";

type Camera2D = {
  centerX: number;
  centerY: number;
  pixelsPerMeter: number;
  rotationRad?: number;
  // Optional: shift the "screen center" used for camera transforms (testing/debug UI layouts).
  screenCenterXCssPx?: number;
  screenCenterYCssPx?: number;
};

export class Renderer2D {
  readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;

  private camera: Camera2D = { centerX: 0, centerY: 0, pixelsPerMeter: 36 };
  private dpr = 1;
  private viewportWidthCssPx = 0;
  private viewportHeightCssPx = 0;

  // Reused scratch buffers to avoid per-frame allocations.
  private tmpTrackNormals: { nx: number; ny: number }[] = [];

  // Cached terrain texture (tiled) to avoid per-frame expensive drawing.
  private terrainTile: HTMLCanvasElement | null = null;
  private terrainTileKey: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.canvas = canvas;
  }

  resizeToDisplay(): { width: number; height: number } {
    const dpr = clamp(window.devicePixelRatio ?? 1, 1, 3);
    let displayWidthCssPx = Math.max(1, Math.floor(this.canvas.clientWidth));
    let displayHeightCssPx = Math.max(1, Math.floor(this.canvas.clientHeight));

    // On some mobile browsers, fullscreen/orientation transitions can temporarily report
    // portrait-like dimensions while visually being landscape. After the game starts,
    // force the renderer to use landscape parameters (stable UI/camera layout).
    const looksTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints ?? 0) > 0;
    const started = typeof document !== "undefined" && document.body?.classList?.contains("started");
    if (started && looksTouch) {
      const w = Math.max(window.innerWidth || 0, window.innerHeight || 0);
      const h = Math.min(window.innerWidth || 0, window.innerHeight || 0);
      if (w > 0 && h > 0) {
        displayWidthCssPx = Math.max(displayWidthCssPx, Math.floor(w));
        displayHeightCssPx = Math.max(1, Math.floor(h));
      }
      if (displayHeightCssPx > displayWidthCssPx) {
        const tmp = displayWidthCssPx;
        displayWidthCssPx = displayHeightCssPx;
        displayHeightCssPx = tmp;
      }
    }

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
    const screenCenterX = camera.screenCenterXCssPx ?? width / 2;
    const screenCenterY = camera.screenCenterYCssPx ?? height / 2;
    ctx.save();
    ctx.translate(screenCenterX, screenCenterY);
    ctx.scale(camera.pixelsPerMeter, camera.pixelsPerMeter);
    if (camera.rotationRad) ctx.rotate(camera.rotationRad);
    ctx.translate(-camera.centerX, -camera.centerY);
  }

  endCamera(): void {
    this.ctx.restore();
  }

  screenToWorld(xCssPx: number, yCssPx: number): { x: number; y: number } {
    const width = this.viewportWidthCssPx || this.canvas.clientWidth;
    const height = this.viewportHeightCssPx || this.canvas.clientHeight;

    const screenCenterX = this.camera.screenCenterXCssPx ?? width / 2;
    const screenCenterY = this.camera.screenCenterYCssPx ?? height / 2;
    const dx = (xCssPx - screenCenterX) / this.camera.pixelsPerMeter;
    const dy = (yCssPx - screenCenterY) / this.camera.pixelsPerMeter;

    const rot = this.camera.rotationRad ?? 0;
    const cosR = Math.cos(-rot);
    const sinR = Math.sin(-rot);
    const rx = dx * cosR - dy * sinR;
    const ry = dx * sinR + dy * cosR;

    return { x: rx + this.camera.centerX, y: ry + this.camera.centerY };
  }

  drawBg(bgColor?: string, cameraX?: number, cameraY?: number, cameraRotationRad?: number, screenCenterXCssPx?: number, screenCenterYCssPx?: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Identity (pixel space)

    // Clear the ENTIRE canvas (in actual device pixels, not CSS pixels)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = bgColor ?? "rgba(15, 20, 25, 1)";
    // Fill the entire canvas (device pixels)
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Subtle terrain texture so the world doesn't feel like a flat card.
    // Now in world-space so it moves with the camera.
    this.drawTerrainDecorations(bgColor ?? "rgba(15, 20, 25, 1)", cameraX ?? 0, cameraY ?? 0, cameraRotationRad ?? 0, screenCenterXCssPx, screenCenterYCssPx);

    ctx.restore();
  }

  private drawTerrainDecorations(bgColor: string, cameraX: number, cameraY: number, cameraRotationRad: number, screenCenterXCssPx?: number, screenCenterYCssPx?: number): void {
    const ctx = this.ctx;
    const parsed = parseRgba(bgColor);
    if (!parsed) return;

    const dark = (k: number, a: number): string => {
      const r = clampInt(parsed.r * (1 - k));
      const g = clampInt(parsed.g * (1 - k));
      const b = clampInt(parsed.b * (1 - k));
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };
    const light = (k: number, a: number): string => {
      const r = clampInt(parsed.r * (1 + k));
      const g = clampInt(parsed.g * (1 + k));
      const b = clampInt(parsed.b * (1 + k));
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Ensure we have a cached tile for this bg color.
    const tileKey = `${bgColor}|${this.dpr}|v2`;
    if (!this.terrainTile || this.terrainTileKey !== tileKey) {
      const size = 512;
      const tile = document.createElement("canvas");
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext("2d");
      if (tctx) {
        tctx.clearRect(0, 0, size, size);
        const seed = hashStringToUint32(bgColor);
        const rand = mulberry32Local(seed);

        // Ridge/hill shapes - elongated darker/lighter bands suggesting terrain undulation
        const ridgeCount = 8;
        for (let i = 0; i < ridgeCount; i++) {
          const cx = rand() * size;
          const cy = rand() * size;
          const rx = (0.25 + rand() * 0.45) * size;
          const ry = (0.06 + rand() * 0.12) * size;
          const angle = rand() * Math.PI;
          // Alternate between dark (valleys) and light (ridges) for contrast
          const isLight = rand() < 0.4;
          tctx.fillStyle = isLight ? light(0.08 + rand() * 0.12, 0.18) : dark(0.15 + rand() * 0.20, 0.22);
          tctx.beginPath();
          tctx.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
          tctx.fill();
        }

        // Smaller highlight patches (rocky outcrops, clearings)
        const patchCount = 18;
        for (let i = 0; i < patchCount; i++) {
          const cx = rand() * size;
          const cy = rand() * size;
          const rx = (0.04 + rand() * 0.10) * size;
          const ry = (0.03 + rand() * 0.08) * size;
          const isLight = rand() < 0.5;
          tctx.fillStyle = isLight ? light(0.10 + rand() * 0.15, 0.16) : dark(0.12 + rand() * 0.18, 0.18);
          tctx.beginPath();
          tctx.ellipse(cx, cy, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
          tctx.fill();
        }

        // Low-frequency speckle for texture
        const dotCount = 1200;
        for (let i = 0; i < dotCount; i++) {
          const x = Math.floor(rand() * size);
          const y = Math.floor(rand() * size);
          const r = rand() < 0.85 ? 1 : 2;
          tctx.fillStyle = dark(0.15 + rand() * 0.20, 0.12);
          tctx.fillRect(x, y, r, r);
        }
      }
      this.terrainTile = tile;
      this.terrainTileKey = tileKey;
    }

    const tile = this.terrainTile;
    if (!tile) return;

    // To fix the background fully to the track (so it rotates with the camera),
    // we draw the tile pattern in a rotated coordinate system.
    // CRITICAL: The rotation pivot must match the camera's pivot point exactly,
    // otherwise the background will drift when the camera rotates.
    const ppmDevice = this.camera.pixelsPerMeter * this.dpr;
    const tw = tile.width;
    const th = tile.height;

    // Calculate offset in world-space, then apply rotation to match camera.
    // This anchors the texture to world coordinates, not screen coordinates.
    const worldOffX = cameraX * ppmDevice;
    const worldOffY = cameraY * ppmDevice;

    // Use the same screen center as the camera for rotation pivot.
    // If not specified, use canvas center.
    const cx = screenCenterXCssPx !== undefined ? screenCenterXCssPx * this.dpr : w / 2;
    const cy = screenCenterYCssPx !== undefined ? screenCenterYCssPx * this.dpr : h / 2;

    // Diagonal of the screen - need to cover corners when rotated
    const diagonal = Math.hypot(w, h);

    ctx.save();
    ctx.globalAlpha = 0.88;
    // Translate to the camera's screen center (pivot point), rotate, then tile from there
    ctx.translate(cx, cy);
    ctx.rotate(cameraRotationRad);

    // Tile offset in the rotated coordinate system
    const ox = ((worldOffX % tw) + tw) % tw;
    const oy = ((worldOffY % th) + th) % th;

    // Draw tiles covering the rotated area (need extra tiles for corners)
    const halfDiag = diagonal / 2 + tw;
    for (let y = -halfDiag - oy; y < halfDiag; y += th) {
      for (let x = -halfDiag - ox; x < halfDiag; x += tw) {
        ctx.drawImage(tile, x, y);
      }
    }
    ctx.restore();
  }

  private getViewRadiusWorldMeters(padM: number): number {
    const width = this.viewportWidthCssPx || this.canvas.clientWidth;
    const height = this.viewportHeightCssPx || this.canvas.clientHeight;
    const halfW = (width / 2) / this.camera.pixelsPerMeter;
    const halfH = (height / 2) / this.camera.pixelsPerMeter;
    return Math.hypot(halfW, halfH) + padM;
  }

  drawScreenOverlay(color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
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

  drawTrack(track: {
    points: { x: number; y: number }[];
    widthM: number;
    segmentWidthsM?: number[];
    segmentFillStyles?: string[];
    segmentShoulderStyles?: string[];
    segmentSurfaceNames?: ("tarmac" | "gravel" | "dirt" | "ice" | "offtrack")[];
  }): void {
    const ctx = this.ctx;
    if (track.points.length < 2) return;

    ctx.save();

    const fillStyles = track.segmentFillStyles;
    const shoulderStyles = track.segmentShoulderStyles;
    const segmentWidths = track.segmentWidthsM;

    // Calculate perpendicular normals for each point
    const normals = this.tmpTrackNormals;
    normals.length = track.points.length;
    for (let i = 0; i < track.points.length; i++) {
      let dx: number, dy: number;
      if (i === 0) {
        dx = track.points[1].x - track.points[0].x;
        dy = track.points[1].y - track.points[0].y;
      } else if (i === track.points.length - 1) {
        dx = track.points[i].x - track.points[i - 1].x;
        dy = track.points[i].y - track.points[i - 1].y;
      } else {
        // Average of adjacent segments for smooth corners
        dx = track.points[i + 1].x - track.points[i - 1].x;
        dy = track.points[i + 1].y - track.points[i - 1].y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Perpendicular (rotate 90 degrees)
      const nx = -dy / len;
      const ny = dx / len;
      const existing = normals[i];
      if (existing) {
        existing.nx = nx;
        existing.ny = ny;
      } else {
        normals[i] = { nx, ny };
      }
    }

    // Helper to draw a filled polygon section of the road
    const drawFilledSection = (startIdx: number, endIdx: number, style: string, widthMultiplier: number) => {
      ctx.fillStyle = style;
      ctx.beginPath();

      // Left edge (forward direction)
      for (let i = startIdx; i <= endIdx; i++) {
        const p = track.points[i];
        const n = normals[i];
        const halfWidth = ((segmentWidths ? segmentWidths[i] : track.widthM) * widthMultiplier) / 2;
        const x = p.x + n.nx * halfWidth;
        const y = p.y + n.ny * halfWidth;
        if (i === startIdx) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Right edge (backward direction)
      for (let i = endIdx; i >= startIdx; i--) {
        const p = track.points[i];
        const n = normals[i];
        const halfWidth = ((segmentWidths ? segmentWidths[i] : track.widthM) * widthMultiplier) / 2;
        const x = p.x - n.nx * halfWidth;
        const y = p.y - n.ny * halfWidth;
        ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.fill();
    };

    // Draw shoulders - batch consecutive segments with same style
    if (shoulderStyles && shoulderStyles.length === track.points.length) {
      let sectionStart = 0;
      let currentShoulderStyle = shoulderStyles[0];

      for (let i = 1; i < track.points.length; i++) {
        const newStyle = shoulderStyles[i];
        if (newStyle !== currentShoulderStyle) {
          drawFilledSection(sectionStart, i, currentShoulderStyle, 1.40);
          sectionStart = i;
          currentShoulderStyle = newStyle;
        }
      }
      drawFilledSection(sectionStart, track.points.length - 1, currentShoulderStyle, 1.40);
    } else {
      drawFilledSection(0, track.points.length - 1, "rgba(90, 120, 95, 0.16)", 1.40);
    }

    // Draw road fill - batch consecutive segments with same style
    if (fillStyles && fillStyles.length === track.points.length) {
      let sectionStart = 0;
      let currentFillStyle = fillStyles[0];

      for (let i = 1; i < track.points.length; i++) {
        const newStyle = fillStyles[i];
        if (newStyle !== currentFillStyle) {
          drawFilledSection(sectionStart, i, currentFillStyle, 1.0);
          sectionStart = i;
          currentFillStyle = newStyle;
        }
      }
      drawFilledSection(sectionStart, track.points.length - 1, currentFillStyle, 1.0);
    } else {
      drawFilledSection(0, track.points.length - 1, "rgba(210, 220, 235, 0.10)", 1.0);
    }

    // Road edge lines (left and right borders)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 0.15;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Left edge
    ctx.beginPath();
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i];
      const n = normals[i];
      const halfWidth = (segmentWidths ? segmentWidths[i] : track.widthM) / 2;
      const x = p.x + n.nx * halfWidth;
      const y = p.y + n.ny * halfWidth;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Right edge
    ctx.beginPath();
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i];
      const n = normals[i];
      const halfWidth = (segmentWidths ? segmentWidths[i] : track.widthM) / 2;
      const x = p.x - n.nx * halfWidth;
      const y = p.y - n.ny * halfWidth;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Centerline - only for tarmac and ice
    ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
    ctx.lineWidth = 0.20;
    ctx.setLineDash([1.2, 1.5]);

    ctx.beginPath();
    let hasCenterline = false;
    for (let i = 0; i < track.points.length - 1; i++) {
      const surfaceName = track.segmentSurfaceNames ? track.segmentSurfaceNames[i] : "tarmac";
      if (surfaceName === "tarmac" || surfaceName === "ice") {
        hasCenterline = true;
        ctx.moveTo(track.points[i].x, track.points[i].y);
        ctx.lineTo(track.points[i + 1].x, track.points[i + 1].y);
      }
    }
    if (hasCenterline) ctx.stroke();
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

  drawFinishLine(opts: { x: number; y: number; headingRad: number; widthM: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(opts.x, opts.y);
    ctx.rotate(opts.headingRad);

    const halfRoad = opts.widthM * 0.5;
    const bandHalfThickness = 0.65; // thick, very visible

    // Dark base band.
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(-bandHalfThickness, -halfRoad, bandHalfThickness * 2, halfRoad * 2);

    // Checkered pattern.
    const cell = 0.55;
    const cols = Math.max(1, Math.floor((bandHalfThickness * 2) / cell));
    const rows = Math.max(1, Math.floor((halfRoad * 2) / cell));
    const startX = -bandHalfThickness;
    const startY = -halfRoad;
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const isWhite = (ix + iy) % 2 === 0;
        ctx.fillStyle = isWhite ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.55)";
        ctx.fillRect(startX + ix * cell, startY + iy * cell, cell, cell);
      }
    }

    // Glow outline.
    ctx.strokeStyle = "rgba(255, 220, 90, 0.75)";
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(0, -halfRoad);
    ctx.lineTo(0, halfRoad);
    ctx.stroke();

    ctx.restore();
  }

  drawArrow(opts: { x: number; y: number; dx: number; dy: number; color: string; label?: string }): void {
    const ctx = this.ctx;
    const len = Math.hypot(opts.dx, opts.dy);
    if (len < 1e-6) return;

    const toX = opts.x + opts.dx;
    const toY = opts.y + opts.dy;
    const ux = opts.dx / len;
    const uy = opts.dy / len;

    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.fillStyle = opts.color;
    ctx.lineWidth = 0.14;

    ctx.beginPath();
    ctx.moveTo(opts.x, opts.y);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    const headLen = Math.min(0.55, Math.max(0.22, len * 0.22));
    const leftX = toX - ux * headLen - uy * headLen * 0.55;
    const leftY = toY - uy * headLen + ux * headLen * 0.55;
    const rightX = toX - ux * headLen + uy * headLen * 0.55;
    const rightY = toY - uy * headLen - ux * headLen * 0.55;

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();

    if (opts.label) {
      ctx.fillStyle = "rgba(232,236,241,0.9)";
      ctx.font = "0.45px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillText(opts.label, toX + uy * 0.25, toY - ux * 0.25);
    }

    ctx.restore();
  }

  drawCar(car: { x: number; y: number; headingRad: number; speed: number; rollOffsetM?: number; pitchOffsetM?: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.headingRad);

    const length = 1.85;
    const width = 0.93;

    // Dynamics gain (Boosted for better feel)
    const roll = (car.rollOffsetM ?? 0) * 1.2;
    const pitch = (car.pitchOffsetM ?? 0) * 1.5;

    // 1. BASE SHADOW - Very subtle, opposite direction, and high clarity
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    const shadowL = length * 1.05;
    const shadowW = width * 1.1;
    // OPPOSITE Dynamic Shift: Shadow peeks out from the other side (very subtle)
    const shadowShiftY = -roll * 0.3;
    const shadowShiftX = -pitch * 0.25;

    ctx.rect(-shadowL * 0.5 + shadowShiftX, -shadowW * 0.5 + shadowShiftY, shadowL, shadowW);
    ctx.fill();

    // 2. MAIN BODY - Pure White (Minimal shift)
    const bodyShiftY = roll * 0.25;
    const bodyShiftX = pitch * 0.15;

    ctx.fillStyle = "rgba(242, 246, 250, 0.95)";
    ctx.strokeStyle = "rgba(30, 40, 60, 0.9)";
    ctx.lineWidth = 2 / this.camera.pixelsPerMeter;

    ctx.beginPath();
    ctx.rect(-length * 0.5 + bodyShiftX, -width * 0.5 + bodyShiftY, length, width);
    ctx.fill();
    ctx.stroke();

    // 4. ROOF / COCKPIT - Extremely subtle 3D lean
    const roofShiftY = roll * 0.7;
    const roofShiftX = pitch * 0.4;

    ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 2 / this.camera.pixelsPerMeter;

    ctx.beginPath();
    // 2-Seater cockpit: 0.42 length, 0.55 width, shifted more towards rear
    ctx.rect(-length * 0.22 + roofShiftX, -width * 0.275 + roofShiftY, length * 0.42, width * 0.55);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  drawTrees(trees: { x: number; y: number; r: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    const pad = this.getViewRadiusWorldMeters(3);
    const cx = this.camera.centerX;
    const cy = this.camera.centerY;
    const rSq = pad * pad;

    for (const t of trees) {
      const dxC = t.x - cx;
      const dyC = t.y - cy;
      if (dxC * dxC + dyC * dyC > rSq) continue;

      // Brown tree trunk (narrower)
      ctx.fillStyle = "rgba(90, 60, 40, 1.0)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Trunk outline
      ctx.strokeStyle = "rgba(50, 35, 20, 1.0)";
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDebris(debris: { x: number; y: number; lengthM: number; widthM: number; rotationRad: number; integrity01?: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    const pad = this.getViewRadiusWorldMeters(8);
    const cx = this.camera.centerX;
    const cy = this.camera.centerY;
    const rSq = pad * pad;

    for (const d of debris) {
      const dxC = d.x - cx;
      const dyC = d.y - cy;
      if (dxC * dxC + dyC * dyC > rSq) continue;

      const integrity = d.integrity01 === undefined ? 1 : Math.max(0, Math.min(1, d.integrity01));
      if (integrity <= 0.02) continue;

      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rotationRad);

      // As debris breaks, shrink it visually (and slightly fade it).
      const scaleL = 0.35 + 0.65 * integrity;
      const scaleW = 0.55 + 0.45 * integrity;
      const halfL = d.lengthM * 0.5 * scaleL;
      const halfW = d.widthM * 0.5 * scaleW;

      // Base log (darker, closer to tree/trunk palette)
      const a = 0.35 + 0.57 * integrity;
      ctx.fillStyle = `rgba(110, 75, 50, ${a.toFixed(3)})`;
      ctx.strokeStyle = `rgba(50, 35, 20, ${a.toFixed(3)})`;
      ctx.lineWidth = 0.06;

      // Capsule / rounded rectangle.
      ctx.beginPath();
      ctx.moveTo(-halfL + halfW, -halfW);
      ctx.lineTo(halfL - halfW, -halfW);
      ctx.arc(halfL - halfW, 0, halfW, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-halfL + halfW, halfW);
      ctx.arc(-halfL + halfW, 0, halfW, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bark lines (variable count based on length)
      ctx.strokeStyle = "rgba(65, 45, 28, 0.55)";
      ctx.lineWidth = 0.045;
      const n = Math.max(2, Math.min(7, Math.round(d.lengthM * 0.95)));
      for (let i = 0; i < n; i++) {
        const t = -halfL + (i + 0.65) * (d.lengthM / (n + 1));
        ctx.beginPath();
        ctx.moveTo(t, -halfW * 0.85);
        ctx.lineTo(t, halfW * 0.85);
        ctx.stroke();
      }

      // Subtle highlight strip for depth
      ctx.strokeStyle = "rgba(170, 130, 95, 0.22)";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(-halfL * 0.85, -halfW * 0.35);
      ctx.lineTo(halfL * 0.85, -halfW * 0.35);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  drawEnemies(enemies: { id?: number; x: number; y: number; radius: number; vx: number; vy: number; type?: string; health?: number; maxHealth?: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    const pad = this.getViewRadiusWorldMeters(6);
    const cx = this.camera.centerX;
    const cy = this.camera.centerY;
    const rSq = pad * pad;

    for (const enemy of enemies) {
      const dxC = enemy.x - cx;
      const dyC = enemy.y - cy;
      if (dxC * dxC + dyC * dyC > rSq) continue;

      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      const isTank = enemy.type === "tank";
      const isColossus = enemy.type === "colossus";

      // Use velocity to orient large enemies.
      const vLen = Math.hypot(enemy.vx, enemy.vy);
      const heading = vLen > 0.2 ? Math.atan2(enemy.vy, enemy.vx) : 0;
      if (isColossus) ctx.rotate(heading);

      // Select base colors based on type
      let bodyColor = "rgba(80, 100, 70, 0.9)"; // Greenish gray (Zombie)
      let headColor = "rgba(90, 110, 80, 0.95)";
      let outlineColor = "rgba(40, 50, 35, 0.95)";

      if (isTank) {
        bodyColor = "rgba(100, 80, 120, 0.9)"; // Purplish dark gray (Tank)
        headColor = "rgba(110, 90, 130, 0.95)";
        outlineColor = "rgba(50, 40, 60, 0.95)";
      }

      if (isColossus) {
        bodyColor = "rgba(45, 45, 55, 0.92)";
        headColor = "rgba(60, 55, 70, 0.96)";
        outlineColor = "rgba(20, 15, 25, 0.98)";
      }

      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = isColossus ? 0.20 : isTank ? 0.12 : 0.08;

      // Body shape
      ctx.beginPath();
      if (isColossus) {
        ctx.ellipse(0, 0, enemy.radius * 1.25, enemy.radius * 0.85, 0, 0, Math.PI * 2);
      } else if (isTank) {
        // Tanks are beefier (more elliptical/broad)
        ctx.ellipse(0, 0, enemy.radius * 0.9, enemy.radius, 0, 0, Math.PI * 2);
      } else {
        ctx.ellipse(0, 0, enemy.radius * 0.8, enemy.radius, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();

      if (isColossus) {
        // Limbs (4) + tail segments for a "dragon-like" silhouette.
        const limbR = enemy.radius * 0.22;
        const limbX = enemy.radius * 0.65;
        const limbY = enemy.radius * 0.55;
        ctx.fillStyle = "rgba(35, 35, 45, 0.95)";
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = 0.14;

        const limbPoints = [
          { x: -limbX, y: -limbY },
          { x: limbX, y: -limbY },
          { x: -limbX, y: limbY },
          { x: limbX, y: limbY }
        ];
        for (const lp of limbPoints) {
          ctx.beginPath();
          ctx.arc(lp.x, lp.y, limbR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Tail
        const tailSegments = 6;
        for (let i = 0; i < tailSegments; i++) {
          const t = (i + 1) / tailSegments;
          const x = -enemy.radius * (0.9 + t * 1.6);
          const y = Math.sin((performance.now() / 1000) * 2 + t * 4) * enemy.radius * 0.10;
          const r = enemy.radius * (0.18 * (1 - t) + 0.05);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Fire glow / embers
        const tNow = performance.now() / 1000;
        const flicker = 0.45 + 0.25 * Math.sin(tNow * 8.5) + 0.15 * Math.sin(tNow * 13.2);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(255, 90, 30, ${0.18 * flicker})`;
        ctx.beginPath();
        ctx.ellipse(enemy.radius * 0.2, 0, enemy.radius * 1.2, enemy.radius * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 200, 70, ${0.10 * flicker})`;
        ctx.beginPath();
        ctx.ellipse(enemy.radius * 0.4, -enemy.radius * 0.15, enemy.radius * 0.8, enemy.radius * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      // Head
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(isColossus ? enemy.radius * 0.55 : 0, -enemy.radius * 0.6, enemy.radius * (isColossus ? 0.55 : isTank ? 0.4 : 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Eyes - Red for both
      const eyeY = -enemy.radius * 0.65;
      const eyeOffset = enemy.radius * (isColossus ? 0.22 : isTank ? 0.2 : 0.15);
      const eyeSize = isColossus ? 0.16 : isTank ? 0.12 : 0.08;

      ctx.fillStyle = "rgba(200, 50, 50, 0.9)";
      ctx.beginPath();
      const eyeX = isColossus ? enemy.radius * 0.55 : 0;
      ctx.arc(eyeX - eyeOffset, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.arc(eyeX + eyeOffset, eyeY, eyeSize, 0, Math.PI * 2);
      ctx.fill();

      // Health bar for Tanks or wounded enemies
      if (enemy.health !== undefined && enemy.maxHealth !== undefined && (isTank || isColossus || enemy.health < enemy.maxHealth)) {
        const barWidth = enemy.radius * (isColossus ? 2.8 : 1.5);
        const barHeight = 0.15;
        const barY = -enemy.radius * 1.4;

        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(-barWidth / 2, barY, barWidth, barHeight);

        const healthPercent = Math.max(0, enemy.health / enemy.maxHealth);
        ctx.fillStyle = healthPercent > 0.5 ? "rgba(100, 255, 100, 0.8)" : "rgba(255, 100, 100, 0.8)";
        ctx.fillRect(-barWidth / 2, barY, barWidth * healthPercent, barHeight);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  drawWater(waterBodies: { x: number; y: number; radiusX: number; radiusY: number; rotation: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    const pad = this.getViewRadiusWorldMeters(10);
    const cx = this.camera.centerX;
    const cy = this.camera.centerY;
    const rSq = pad * pad;

    for (const w of waterBodies) {
      const dxC = w.x - cx;
      const dyC = w.y - cy;
      if (dxC * dxC + dyC * dyC > rSq) continue;

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.rotation);

      // Water fill - semi-transparent blue
      ctx.fillStyle = "rgba(40, 90, 140, 0.7)";
      ctx.beginPath();
      ctx.ellipse(0, 0, w.radiusX, w.radiusY, 0, 0, Math.PI * 2);
      ctx.fill();

      // Darker edge/shore
      ctx.strokeStyle = "rgba(30, 60, 100, 0.9)";
      ctx.lineWidth = 0.3;
      ctx.stroke();

      // Inner highlight for depth effect
      ctx.fillStyle = "rgba(60, 120, 180, 0.4)";
      ctx.beginPath();
      ctx.ellipse(-w.radiusX * 0.2, -w.radiusY * 0.2, w.radiusX * 0.5, w.radiusY * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }

  drawTrackEditorPoints(opts: { points: { x: number; y: number }[]; activeIndex?: number | null }): void {
    const ctx = this.ctx;
    ctx.save();

    const r = 0.32;
    for (let i = 0; i < opts.points.length; i++) {
      const p = opts.points[i];
      const active = opts.activeIndex === i;

      ctx.fillStyle = active ? "rgba(255, 205, 105, 0.95)" : "rgba(170, 210, 255, 0.70)";
      ctx.strokeStyle = active ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.40)";
      ctx.lineWidth = 0.08;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Label every ~10 points to reduce clutter.
      if (active || i % 10 === 0) {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.font = "0.55px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(String(i), p.x, p.y - 0.7);
      }
    }

    ctx.restore();
  }

  drawParticles(particles: { x: number; y: number; sizeM: number; color: string; lifetime: number; maxLifetime: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    for (const p of particles) {
      // Fade alpha based on remaining lifetime
      const fade = Math.min(1, p.lifetime / Math.max(0.1, p.maxLifetime));
      const colonIdx = p.color.lastIndexOf(",");
      if (colonIdx !== -1) {
        const baseColor = p.color.substring(0, colonIdx + 1);
        const alpha = parseFloat(p.color.substring(colonIdx + 1).replace(")", "")) * fade;
        ctx.fillStyle = baseColor + " " + alpha.toFixed(2) + ")";
      } else {
        ctx.fillStyle = p.color;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.sizeM, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawProjectiles(projectiles: { x: number; y: number; vx: number; vy: number; color?: string; size?: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    for (const proj of projectiles) {
      const v = Math.hypot(proj.vx, proj.vy);
      if (v < 1) continue;

      // Tracer line - elongated based on velocity
      const tracerLen = 1.5; // High visibility length
      const dx = proj.vx / v;
      const dy = proj.vy / v;
      const tailX = proj.x - dx * tracerLen;
      const tailY = proj.y - dy * tracerLen;

      const baseColor = proj.color || "rgba(255, 220, 100, 0.95)";
      const sizeM = proj.size !== undefined ? proj.size : 0.2;

      // LAYER 0: DARK UNDERLAY (contrast on bright/icy scenes)
      ctx.save();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = sizeM * 2.1;
      ctx.lineCap = "round";
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.restore();

      // LAYER 1: OUTER GLOW (Thick, blured color)
      ctx.save();
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = sizeM * 1.5; // Bolder glow
      ctx.lineCap = "round";
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 1.2; // Significant glow

      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.restore();

      // LAYER 2: WHITE CORE (Thin, bright center)
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 1.0)";
      ctx.lineWidth = sizeM * 0.4; // Sharp center line
      ctx.lineCap = "round";
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 0.4;

      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  drawFireballs(projectiles: { x: number; y: number; color?: string; size?: number }[]): void {
    const ctx = this.ctx;
    ctx.save();

    for (const p of projectiles) {
      const r = p.size !== undefined ? p.size : 0.55;
      const outer = p.color || "rgba(255, 120, 40, 0.95)";

      // Outer glow
      ctx.save();
      ctx.fillStyle = outer;
      ctx.shadowColor = outer;
      ctx.shadowBlur = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Hot core
      ctx.save();
      ctx.fillStyle = "rgba(255, 245, 220, 0.98)";
      ctx.shadowColor = "rgba(255, 220, 140, 0.95)";
      ctx.shadowBlur = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  drawPanel(opts: {
    x: number;
    y: number;
    anchorX?: "left" | "right" | "center";
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

    const anchorX = opts.anchorX ?? "left";
    let x = opts.x;
    if (anchorX === "right") {
      x = Math.max(0, opts.x - panelWidth);
    } else if (anchorX === "center") {
      x = Math.max(0, opts.x - panelWidth / 2);
    }
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

  drawFinishScreen(opts: { time: number; avgSpeedKmH: number; kills: number; totalEnemies: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;

    // Background overlay for results
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";

    // Use responsive font sizes based on screen width
    const baseWidth = Math.min(w, h);
    const titleSize = Math.floor(baseWidth * 0.12);
    const speedSize = Math.floor(baseWidth * 0.18);
    const statsSize = Math.floor(baseWidth * 0.05);

    // "FINISHED" Title
    ctx.font = `bold ${titleSize}px 'Space Mono', monospace`;
    ctx.fillStyle = "#ffcc00"; // Rally yellow
    ctx.shadowColor = "rgba(255, 204, 0, 0.5)";
    ctx.shadowBlur = 20;
    ctx.fillText("STAGE FINISHED", cx, cy - titleSize * 1.5);
    ctx.shadowBlur = 0;

    // AVG SPEED - THE STAR METRIC
    ctx.font = `bold ${speedSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "white";
    ctx.fillText(`${opts.avgSpeedKmH.toFixed(1)}`, cx, cy);

    ctx.font = `bold ${statsSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(180, 220, 255, 0.8)";
    ctx.fillText("AVG KM/H", cx, cy + speedSize * 0.4);

    // Stats
    ctx.font = `${statsSize}px 'Space Mono', monospace`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(`TIME: ${opts.time.toFixed(2)}s`, cx, cy + speedSize * 0.8);
    ctx.fillText(`KILLS: ${opts.kills} / ${opts.totalEnemies}`, cx, cy + speedSize * 1.1);

    ctx.restore();
  }

  drawVectorPanel(opts: {
    x: number;
    y: number;
    anchorX?: "left" | "right";
    anchorY?: "top" | "bottom";
    title: string;
    vectors: { label: string; x: number; y: number; color: string }[];
    scale: number;
  }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const padding = 10;
    const plotSize = 132;
    const titleH = 18;
    const linesH = 16;
    const height = titleH + plotSize + padding * 2 + opts.vectors.length * linesH;
    const width = 280;

    const x = (opts.anchorX ?? "left") === "right" ? Math.max(0, opts.x - width) : opts.x;
    const y = (opts.anchorY ?? "top") === "bottom" ? Math.max(0, opts.y - height) : opts.y;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

    ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(170, 210, 255, 0.95)";
    ctx.fillText(opts.title, x + padding, y + padding + 2);

    const plotX = x + padding;
    const plotY = y + padding + titleH;
    const cx = plotX + plotSize / 2;
    const cy = plotY + plotSize / 2;

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, plotY);
    ctx.lineTo(cx, plotY + plotSize);
    ctx.moveTo(plotX, cy);
    ctx.lineTo(plotX + plotSize, cy);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotSize, plotSize);
    ctx.stroke();

    // Arrows.
    for (const v of opts.vectors) {
      const dx = v.x * opts.scale;
      const dy = -v.y * opts.scale; // y up in plot
      this.drawHudArrow(cx, cy, dx, dy, v.color);
    }

    // Legend + numeric.
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(232,236,241,0.92)";
    let ly = plotY + plotSize + 14;
    for (const v of opts.vectors) {
      ctx.fillStyle = v.color;
      ctx.fillRect(x + padding, ly - 9, 10, 10);
      ctx.fillStyle = "rgba(232,236,241,0.92)";
      ctx.fillText(`${v.label}: (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`, x + padding + 16, ly);
      ly += linesH;
    }

    ctx.restore();
  }

  drawDriftIndicator(opts: { intensity: number; score: number }): void {
    if (opts.intensity < 0.01) return; // Don't show if not drifting

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;

    // Position in top-right corner
    const x = w - 160;
    const y = 20;
    const width = 140;
    const barHeight = 8;
    const padding = 10;

    // Intensity-based color (yellow → orange → red)
    const hue = Math.max(0, 60 - opts.intensity * 60); // 60 (yellow) to 0 (red)
    const sat = 95;
    const light = 55;
    const color = `hsl(${hue}, ${sat}%, ${light}%)`;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(x, y, width, 60);

    // "DRIFT!" text
    ctx.font = "bold 20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("DRIFT!", x + width / 2, y + padding);

    // Intensity bar background
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x + padding, y + padding + 26, width - padding * 2, barHeight);

    // Intensity bar fill
    ctx.fillStyle = color;
    const barWidth = (width - padding * 2) * Math.min(opts.intensity, 1);
    ctx.fillRect(x + padding, y + padding + 26, barWidth, barHeight);

    // Score (small text)
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(232,236,241,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.floor(opts.score)}`, x + width / 2, y + padding + 38);

    ctx.restore();
  }

  drawRpmMeter(opts: {
    rpm: number;
    maxRpm: number;
    redlineRpm: number;
    gear: number | string;
    speedKmH: number;
    damage01: number;
    totalDistanceKm?: number;
    layout?: "bottom" | "left";
  }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    const layout = opts.layout ?? "bottom";

    // Default layout: bottom center.
    // Mobile landscape layout: left side, lifted above the bottom controls.
    let centerX = (w / 2) - 15;
    let centerY = h - 80;
    let radius = 70;
    if (layout === "left") {
      // Smaller + higher so it doesn't sit on top of the joystick/pedals.
      const lift = Math.min(410, Math.max(235, h * 0.57));
      centerX = Math.min(150, Math.max(110, w * 0.16));
      centerY = h - lift;
      radius = 58;
    }
    const scale = radius / 70;
    const startAngle = Math.PI * 0.75; // 135 degrees
    const endAngle = Math.PI * 2.25; // 405 degrees (270 degree sweep)

    // Background arc
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 18 * scale;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.stroke();

    // Color zones calculations
    const rpmFraction = opts.rpm / opts.maxRpm;
    const redlineFraction = opts.redlineRpm / opts.maxRpm;
    const sweepAngle = endAngle - startAngle;

    // Background full arc (Dimmed and desaturated)
    ctx.lineWidth = 14 * scale;
    ctx.lineCap = "round";

    // Dimmed Green (0-70%)
    ctx.strokeStyle = "rgba(40, 100, 60, 0.3)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sweepAngle * redlineFraction * 0.7);
    ctx.stroke();

    // Dimmed Yellow (70-90%)
    ctx.strokeStyle = "rgba(120, 100, 30, 0.3)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle + sweepAngle * redlineFraction * 0.7, startAngle + sweepAngle * redlineFraction * 0.9);
    ctx.stroke();

    // Dimmed Red (90-100%)
    ctx.strokeStyle = "rgba(100, 40, 40, 0.3)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle + sweepAngle * redlineFraction * 0.9, endAngle);
    ctx.stroke();

    // VIBRANT FOREGROUND ARC (Fills based on current RPM)
    const activeSweep = sweepAngle * Math.min(rpmFraction, 1);

    // We draw segment by segment to maintain color zones
    const greenEnd = sweepAngle * redlineFraction * 0.7;
    const yellowEnd = sweepAngle * redlineFraction * 0.9;

    // Vibrant Green
    if (activeSweep > 0) {
      ctx.strokeStyle = "rgba(80, 255, 120, 1.0)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + Math.min(activeSweep, greenEnd));
      ctx.stroke();
    }

    // Vibrant Yellow
    if (activeSweep > greenEnd) {
      ctx.strokeStyle = "rgba(255, 220, 60, 1.0)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle + greenEnd, startAngle + Math.min(activeSweep, yellowEnd));
      ctx.stroke();
    }

    // Vibrant Red
    if (activeSweep > yellowEnd) {
      ctx.strokeStyle = "rgba(255, 60, 60, 1.0)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle + yellowEnd, startAngle + activeSweep);
      ctx.stroke();
    }

    // Glow Effect for the active tip
    if (activeSweep > 0) {
      ctx.save();
      const tipAngle = startAngle + activeSweep;
      const tipX = centerX + Math.cos(tipAngle) * radius;
      const tipY = centerY + Math.sin(tipAngle) * radius;

      ctx.shadowColor = rpmFraction > redlineFraction * 0.9 ? "rgba(255, 60, 60, 1)" : "rgba(180, 220, 255, 0.8)";
      ctx.shadowBlur = 10 * scale;
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Speed text - BOLD and PROMINENT
    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.font = `bold ${Math.round(32 * scale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(opts.speedKmH)}`, centerX, centerY - 10 * scale);

    // Speed unit
    ctx.font = `bold ${Math.round(12 * scale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(180, 220, 255, 0.7)";
    ctx.fillText("KM/H", centerX, centerY + 12 * scale);

    // RPM text (smaller, below speed)
    ctx.fillStyle = "rgba(180, 220, 255, 0.6)";
    ctx.font = `bold ${Math.round(14 * scale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`RPM: ${Math.round(opts.rpm)}`, centerX, centerY + 32 * scale);

    // Gear indicator - PROMINENT for manual shifting
    const gearScale = layout === "left" ? scale * 0.82 : scale;
    ctx.font = `bold ${Math.round(60 * gearScale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = rpmFraction > redlineFraction * 0.9 ? "rgba(255, 100, 100, 1)" : "rgba(180, 220, 255, 0.98)";
    let gearX = centerX + radius + 42;
    if (gearX > w - 12) gearX = centerX - radius - 42;
    ctx.fillText(`${opts.gear}`, gearX, centerY - 5 * scale);

    // Gear label
    ctx.font = `bold ${Math.round(14 * gearScale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(180, 220, 255, 0.7)";
    ctx.fillText("GEAR", gearX, centerY + 35 * scale);

    // DAMAGE INDICATOR - WIDER bar
    let dmgX = centerX - radius - 55; // Slightly adjusted pos
    if (dmgX < 12) dmgX = centerX + radius + 18;
    const dmgY = centerY - 30 * scale;
    const dmgWidth = 24 * scale; // Wider (was 12)
    const dmgHeight = 60 * scale;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(dmgX, dmgY, dmgWidth, dmgHeight);

    // Fill (Green -> Red)
    const health = Math.max(0, 1.0 - opts.damage01);
    const fillH = dmgHeight * health;
    const dmgColor = health > 0.6 ? "rgba(80, 255, 200, 0.9)" : health > 0.3 ? "rgba(255, 200, 60, 0.9)" : "rgba(255, 60, 60, 0.9)";
    ctx.fillStyle = dmgColor;
    ctx.fillRect(dmgX, dmgY + (dmgHeight - fillH), dmgWidth, fillH);

    // Percentage label only (no "HP" text)
    ctx.font = `bold ${Math.round(12 * scale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(health * 100)}%`, dmgX + dmgWidth / 2, dmgY + dmgHeight + 14 * scale);

    // Total distance driven (if provided)
    if (opts.totalDistanceKm !== undefined) {
      ctx.font = `bold ${Math.round(12 * scale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillStyle = "rgba(180, 220, 255, 0.6)";
      ctx.textAlign = "center";
      ctx.fillText(`${opts.totalDistanceKm.toFixed(1)} km`, centerX, centerY + 50 * scale);
    }

    ctx.restore();
  }

  drawNotification(text: string, timeSinceShown: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Position at top-center
    const centerX = w / 2;
    const centerY = h * 0.25;

    // Fade in/out animation
    let alpha = 1.0;
    if (timeSinceShown < 0.2) {
      // Fade in
      alpha = timeSinceShown / 0.2;
    } else if (timeSinceShown > 2.0) {
      // Fade out
      alpha = 1.0 - ((timeSinceShown - 2.0) / 0.5);
    }

    // Dynamic font sizing based on text length and screen width
    const padding = 40;
    const maxTextWidth = w - padding;

    const isCheckpoint = /^Checkpoint\s+\d+\s*\/\s*\d+$/i.test(text);
    const isCallout = /\b(RAIN|DEBRIS|NARROW|FOG|SANDSTORM|ECLIPSE|ELECTRICAL)\b/i.test(text);

    // Checkpoints + co-driver callouts should be readable but not gigantic.
    let fontSize = isCheckpoint ? 34 : (isCallout ? 32 : 48);

    ctx.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    let metrics = ctx.measureText(text);

    if (metrics.width > maxTextWidth) {
      fontSize = Math.floor(fontSize * (maxTextWidth / metrics.width));
      ctx.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textRgb: { r: number; g: number; b: number } = isCheckpoint
      ? { r: 255, g: 255, b: 255 }
      : /\bRAIN\b/i.test(text)
        ? { r: 140, g: 205, b: 255 }
        : /\bDEBRIS\b/i.test(text)
          ? { r: 255, g: 175, b: 90 }
          : /\bNARROW\b/i.test(text)
            ? { r: 255, g: 240, b: 170 }
            : { r: 255, g: 255, b: 255 };

    // Black outline
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
    ctx.lineWidth = Math.max(2, fontSize / 6);
    ctx.strokeText(text, centerX, centerY);

    // Colored text
    ctx.fillStyle = `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, ${alpha})`;
    ctx.fillText(text, centerX, centerY);

    ctx.restore();
  }

  drawDamageOverlay(opts: { damage01: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Yellow/brown vignette that intensifies with damage
    const alpha = Math.min(opts.damage01 * 0.4, 0.6);
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, `rgba(255, 230, 100, 0)`);
    gradient.addColorStop(1, `rgba(120, 70, 20, ${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  drawCrosshair(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const size = 20; // Crosshair size
    const gap = 6; // Gap in center
    const thickness = 2;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255, 220, 80, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawWeaponHUD(currentWeapon: { name: string; ammo: number; capacity: number }, screenWidth: number, screenHeight: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const padding = 16;
    const x = screenWidth - padding;
    const y = screenHeight - padding;

    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";

    // Weapon Name
    ctx.font = "bold 24px 'Space Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(currentWeapon.name.toUpperCase(), x, y - 30);

    // Ammo
    ctx.font = "bold 36px 'Space Mono', monospace";
    const ammoText = currentWeapon.capacity === -1 ? "INF" : `${currentWeapon.ammo}/${currentWeapon.capacity}`;

    // Color ammo red if low
    if (currentWeapon.capacity !== -1 && currentWeapon.ammo <= currentWeapon.capacity * 0.2) {
      ctx.fillStyle = "rgba(255, 80, 80, 0.9)";
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    }
    ctx.fillText(ammoText, x, y);

    ctx.restore();
  }

  drawMinimap(opts: {
    track: any;
    carX: number;
    carY: number;
    carHeading: number;
    waterBodies?: { x: number; y: number; radiusX: number; radiusY: number; rotation: number }[];
    enemies?: { x: number; y: number; type?: string }[];
    debris?: { x: number; y: number; lengthM: number; rotationRad: number; integrity01?: number }[];
    segmentSurfaceNames?: ("tarmac" | "gravel" | "dirt" | "ice" | "offtrack")[];
    start?: { x: number; y: number };
    finish?: { x: number; y: number };
    offsetX?: number;
    offsetY?: number;
    size?: number; // Optional custom size
    minimapBgColor?: string;
    zones?: TrackZone[];
    activeZones?: { kind: TrackZoneKind; intensity01: number }[];
    statusTextLines?: string[];
    warningTextLines?: string[];
  }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Use custom size if provided, otherwise default to 18% of screen
    const minimapSize = opts.size ?? Math.min(w, h) * 0.18;
    const padding = 12;
    const minimapX = opts.offsetX ?? (w - minimapSize - padding);
    const minimapY = opts.offsetY ?? 280; // Below controls panel (which is ~260px tall)

    // Semi-transparent background
    ctx.fillStyle = opts.minimapBgColor ?? "rgba(20, 25, 30, 0.3)";
    ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

    // Electrical storm: replace minimap with an error display.
    if (opts.statusTextLines && opts.statusTextLines.length > 0) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.70)";
      ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

      ctx.save();
      ctx.translate(minimapX + minimapSize / 2, minimapY + minimapSize / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillStyle = "rgba(255, 80, 80, 0.95)";
      ctx.fillText(opts.statusTextLines[0], 0, -12);

      ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillStyle = "rgba(245, 248, 255, 0.92)";
      ctx.fillText(opts.statusTextLines.slice(1).join(" "), 0, 10);
      ctx.restore();

      ctx.restore();
      return;
    }

    // No Border - Cleaner look
    // ctx.strokeStyle = "rgba(180, 220, 255, 0.5)";
    // ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

    // Map Zoom: Fixed scale for tactical view - car centered
    // Slightly tighter zoom for readability.
    const viewWidthMeters = 450;
    const scale = minimapSize / viewWidthMeters;

    // CENTER & ROTATE
    const cx = minimapX + minimapSize / 2;
    const cy = minimapY + minimapSize / 2;

    ctx.save();
    // Clip to minimap box
    ctx.beginPath();
    ctx.rect(minimapX, minimapY, minimapSize, minimapSize);
    ctx.clip();

    // 1. Move to center of minimap
    ctx.translate(cx, cy);
    // 2. Scale world (No rotation, North Up)
    ctx.scale(scale, scale);
    // 3. Move world so car is at (0,0) (which is visually center)
    ctx.translate(-opts.carX, -opts.carY);

    const minimapRoadColorForSurface = (name: "tarmac" | "gravel" | "dirt" | "ice" | "offtrack"): string => {
      switch (name) {
        case "tarmac":
          return "rgba(160, 180, 200, 0.85)";
        case "gravel":
          return "rgba(175, 180, 190, 0.85)"; // gray-ish gravel
        case "dirt":
          return "rgba(175, 130, 95, 0.85)";
        case "ice":
          return "rgba(150, 220, 255, 0.9)";
        case "offtrack":
          return "rgba(140, 160, 120, 0.6)";
      }
    };

    const zoneColorForKind = (kind: TrackZoneKind): string => {
      switch (kind) {
        case "rain":
          return "rgba(80, 160, 255, 0.55)";
        case "fog":
          return "rgba(200, 220, 255, 0.45)";
        case "eclipse":
          return "rgba(40, 40, 50, 0.55)";
        case "electrical":
          return "rgba(175, 110, 255, 0.65)";
        case "sandstorm":
          return "rgba(230, 185, 95, 0.55)";
      }
    };

    // Draw track (wider + surface-colored segments)
    const pts: { x: number; y: number }[] = opts.track?.points ?? [];
    const hasPts = pts.length >= 2;
    let shouldLoop = false;
    if (pts.length > 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const endToStart = Math.hypot(last.x - first.x, last.y - first.y);
      shouldLoop = endToStart < 20;
    }

    if (hasPts) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Dark underlay for contrast
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = 13 / scale;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (shouldLoop) ctx.lineTo(pts[0].x, pts[0].y);
      ctx.stroke();

      // Colored segments
      const lw = 9 / scale;
      ctx.lineWidth = lw;
      const names = opts.segmentSurfaceNames;
      for (let i = 0; i < pts.length - 1; i++) {
        const surfaceName = (names?.[i] ?? "tarmac") as "tarmac" | "gravel" | "dirt" | "ice" | "offtrack";
        ctx.strokeStyle = minimapRoadColorForSurface(surfaceName);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
      if (shouldLoop) {
        const i = pts.length - 1;
        const surfaceName = (names?.[i] ?? names?.[0] ?? "tarmac") as "tarmac" | "gravel" | "dirt" | "ice" | "offtrack";
        ctx.strokeStyle = minimapRoadColorForSurface(surfaceName);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[0].x, pts[0].y);
        ctx.stroke();
      }

      // Zone labels (navigator intel) - show label at zone start instead of coloring road
      const zones: TrackZone[] | undefined = opts.zones;
      const totalLengthM = typeof opts.track?.totalLengthM === "number" ? (opts.track.totalLengthM as number) : undefined;
      const cum: number[] | undefined = Array.isArray(opts.track?.cumulativeLengthsM) ? (opts.track.cumulativeLengthsM as number[]) : undefined;
      if (zones && zones.length > 0 && totalLengthM && cum && cum.length === pts.length) {
        ctx.save();
        const labeledZones = new Set<TrackZone>();
        for (let i = 0; i < pts.length - 1; i++) {
          const segStart01 = (cum[i] ?? 0) / Math.max(1e-6, totalLengthM);
          // Find zone that starts at or near this segment
          for (const z of zones) {
            if (labeledZones.has(z)) continue;
            // Label at the segment closest to zone start
            if (Math.abs(segStart01 - z.start01) < 0.025) {
              labeledZones.add(z);
              const labelText = z.kind === "rain" ? "RAIN" : z.kind === "fog" ? "FOG" : z.kind === "electrical" ? "⚡" : z.kind.toUpperCase();
              const labelColor = z.kind === "rain" ? "rgba(80, 160, 255, 0.95)" : z.kind === "fog" ? "rgba(180, 180, 190, 0.95)" : "rgba(255, 220, 80, 0.95)";
              ctx.font = `bold ${11 / scale}px sans-serif`;
              ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
              ctx.fillText(labelText, pts[i].x + 2 / scale, pts[i].y + 1 / scale);
              ctx.fillStyle = labelColor;
              ctx.fillText(labelText, pts[i].x, pts[i].y);
            }
          }
        }
        ctx.restore();
      }
    }

    // Draw water bodies
    if (opts.waterBodies) {
      ctx.fillStyle = "rgba(40, 120, 200, 0.6)";
      for (const water of opts.waterBodies) {
        ctx.beginPath();
        ctx.ellipse(water.x, water.y, water.radiusX, water.radiusY, water.rotation, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw debris (logs)
    if (opts.debris) {
      ctx.strokeStyle = "rgba(130, 85, 55, 0.85)";
      ctx.lineWidth = 2.4 / scale;
      for (const d of opts.debris) {
        const integrity = d.integrity01 === undefined ? 1 : Math.max(0, Math.min(1, d.integrity01));
        if (integrity <= 0.05) continue;
        const halfL = Math.min(4.5, Math.max(1.0, d.lengthM * (0.35 + 0.65 * integrity))) * 0.5;
        const cosR = Math.cos(d.rotationRad);
        const sinR = Math.sin(d.rotationRad);
        const ax = d.x - cosR * halfL;
        const ay = d.y - sinR * halfL;
        const bx = d.x + cosR * halfL;
        const by = d.y + sinR * halfL;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Draw enemies
    if (opts.enemies) {
      for (const enemy of opts.enemies) {
        const isColossus = enemy.type === "colossus";
        const isTank = enemy.type === "tank";
        if (isColossus) {
          const r = 11 / scale;
          ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 160, 80, 0.92)";
          ctx.lineWidth = 2.6 / scale;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = `bold ${16 / scale}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 2.8 / scale;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
          ctx.strokeText("B", enemy.x, enemy.y);
          ctx.fillStyle = "rgba(255, 245, 235, 0.95)";
          ctx.fillText("B", enemy.x, enemy.y);
        } else if (isTank) {
          // More prominent tank marker
          const r = 7 / scale;
          ctx.fillStyle = "rgba(40, 0, 0, 0.55)";
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
          ctx.lineWidth = 2.2 / scale;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = `bold ${16 / scale}px monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 2.4 / scale;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
          ctx.strokeText("T", enemy.x, enemy.y);
          ctx.fillStyle = "rgba(255, 245, 245, 0.95)";
          ctx.fillText("T", enemy.x, enemy.y);
        } else {
          ctx.fillStyle = "rgba(180, 50, 50, 0.7)";
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, 4 / scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // START / FINISH markers
    const drawMinimapLabel = (x: number, y: number, text: string, bg: string, fg: string): void => {
      ctx.save();
      ctx.font = `bold ${10 / scale}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const padX = 5 / scale;
      const padY = 3 / scale;
      const tw = ctx.measureText(text).width;
      const w = tw + padX * 2;
      const h = (10 / scale) + padY * 2;
      const rx = x - w / 2;
      const ry = y - (12 / scale) - h / 2;
      const rad = 3 / scale;

      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + w - rad, ry);
      ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + rad);
      ctx.lineTo(rx + w, ry + h - rad);
      ctx.quadraticCurveTo(rx + w, ry + h, rx + w - rad, ry + h);
      ctx.lineTo(rx + rad, ry + h);
      ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - rad);
      ctx.lineTo(rx, ry + rad);
      ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 1.4 / scale;
      ctx.stroke();

      ctx.fillStyle = fg;
      ctx.fillText(text, x, ry + h / 2);

      // Anchor dot
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    if (opts.start) {
      drawMinimapLabel(opts.start.x, opts.start.y, "START", "rgba(0, 0, 0, 0.35)", "rgba(220, 255, 220, 0.95)");
    }
    if (opts.finish) {
      drawMinimapLabel(opts.finish.x, opts.finish.y, "FINISH", "rgba(0, 0, 0, 0.35)", "rgba(255, 235, 200, 0.95)");
    }

    // Draw cities (Parking Spots)
    if (opts.track.startCity) {
      const city = opts.track.startCity;
      // Dim gray circle
      ctx.fillStyle = "rgba(100, 100, 100, 0.5)";
      ctx.beginPath();
      ctx.arc(city.centerX, city.centerY, 8 / scale, 0, Math.PI * 2); // Slightly larger
      ctx.fill();

      // "P" label
      ctx.fillStyle = "rgba(220, 220, 220, 0.9)";
      ctx.font = `bold ${10 / scale}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", city.centerX, city.centerY);
    }
    if (opts.track.endCity) {
      const city = opts.track.endCity;
      // Dim gray circle
      ctx.fillStyle = "rgba(100, 100, 100, 0.5)";
      ctx.beginPath();
      ctx.arc(city.centerX, city.centerY, 8 / scale, 0, Math.PI * 2);
      ctx.fill();

      // "P" label
      ctx.fillStyle = "rgba(220, 220, 220, 0.9)";
      ctx.font = `bold ${10 / scale}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", city.centerX, city.centerY);
    }

    ctx.restore(); // Undo clip and transforms

    // Zone indicators (active-at-car) for quick callouts.
    if (opts.activeZones && opts.activeZones.length > 0) {
      const unique: { kind: TrackZoneKind; intensity01: number }[] = [];
      for (const z of opts.activeZones) {
        const prev = unique.find((u) => u.kind === z.kind);
        if (!prev) unique.push({ kind: z.kind, intensity01: z.intensity01 });
        else prev.intensity01 = Math.max(prev.intensity01, z.intensity01);
      }

      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

      const pad = 6;
      const baseX = minimapX + pad;
      let y = minimapY + pad;
      for (const u of unique.slice(0, 4)) {
        const swatch = zoneColorForKind(u.kind);
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.fillRect(baseX - 3, y - 2, 96, 14);

        ctx.fillStyle = swatch;
        ctx.fillRect(baseX, y + 2, 9, 9);

        ctx.fillStyle = "rgba(245, 248, 255, 0.92)";
        const label = `${u.kind.toUpperCase()} ${(u.intensity01 * 100).toFixed(0)}%`;
        ctx.fillText(label, baseX + 13, y);
        y += 14;
      }
      ctx.restore();
    }

    // Warnings (e.g. incoming rain / narrow road). Rendered above the minimap.
    if (opts.warningTextLines && opts.warningTextLines.length > 0) {
      ctx.save();

      const lines: string[] = [];
      for (let i = 0; i < Math.min(4, opts.warningTextLines.length); i++) {
        const raw = opts.warningTextLines[i] ?? "";
        if (raw) lines.push(raw);
      }

      const boxH = 18;
      const gapY = 6;
      const totalH = lines.length > 0 ? (lines.length * boxH + (lines.length - 1) * gapY) : 0;
      const padAbove = 10;
      const startY = Math.max(10, minimapY - padAbove - totalH);

      ctx.translate(minimapX + 10, startY);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      ctx.font = "800 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

      const roundRect = (x: number, y: number, w: number, h: number, r: number): void => {
        const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
      };

      const colorFor = (text: string): { bg: string; fg: string; prefix: string } => {
        if (text.includes("RAIN")) return { bg: "rgba(35, 90, 140, 0.72)", fg: "rgba(210, 240, 255, 0.98)", prefix: "!" };
        if (text.includes("DEBRIS")) return { bg: "rgba(140, 70, 25, 0.74)", fg: "rgba(255, 235, 210, 0.98)", prefix: "!" };
        if (text.includes("NARROW")) return { bg: "rgba(120, 110, 30, 0.74)", fg: "rgba(255, 248, 210, 0.98)", prefix: "!" };
        return { bg: "rgba(0, 0, 0, 0.65)", fg: "rgba(255, 245, 220, 0.95)", prefix: "!" };
      };

      let y = 0;
      for (const raw of lines) {
        const { bg, fg, prefix } = colorFor(raw);
        const text = `${prefix} ${raw}`;
        const tw = ctx.measureText(text).width;
        const boxW = Math.min(tw + 18, minimapSize - 22);

        // Background pill
        ctx.fillStyle = bg;
        roundRect(0, y, boxW, boxH, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Text
        ctx.fillStyle = fg;
        ctx.fillText(text, 9, y + 3);
        y += boxH + gapY;
      }

      ctx.restore();
    }

    // Draw Car Indicator (Centered, Rotating to show heading)
    ctx.save();
    ctx.translate(cx, cy);
    // Rotate indicator to match car heading
    // Map is North-Up (-Y). Car heading 0 is East (+X).
    // Indicator triangle draws pointing UP (-Y) by default.
    // So if heading is East (0), we need triangle to point Right (+X).
    // Let's just use carHeading + PI/2.
    ctx.rotate(opts.carHeading + Math.PI / 2);

    ctx.fillStyle = "#00ff00";
    ctx.beginPath();
    const indicatorSize = 10;
    ctx.moveTo(0, -indicatorSize);
    ctx.lineTo(-indicatorSize * 0.7, indicatorSize);
    ctx.lineTo(indicatorSize * 0.7, indicatorSize);
    ctx.fill();
    ctx.restore();
  }
  private drawHudArrow(fromX: number, fromY: number, dx: number, dy: number, color: string): void {
    const ctx = this.ctx;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const toX = fromX + dx;
    const toY = fromY + dy;
    const ux = dx / len;
    const uy = dy / len;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    const head = Math.min(12, Math.max(6, len * 0.18));
    const leftX = toX - ux * head - uy * head * 0.55;
    const leftY = toY - uy * head + ux * head * 0.55;
    const rightX = toX - ux * head + uy * head * 0.55;
    const rightY = toY - uy * head - ux * head * 0.55;

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawCity(city: City): void {
    const ctx = this.ctx;

    // Draw buildings
    for (const building of city.buildings) {
      ctx.save();
      ctx.translate(building.x, building.y);
      ctx.rotate(building.rotation);

      if (building.type === "store") {
        // Store buildings - more prominent
        ctx.fillStyle = "rgba(180, 160, 140, 1.0)";
        ctx.strokeStyle = "rgba(100, 80, 60, 1.0)";
        ctx.lineWidth = 0.15;
      } else {
        // Decorative buildings
        ctx.fillStyle = "rgba(140, 140, 150, 1.0)";
        ctx.strokeStyle = "rgba(80, 80, 90, 1.0)";
        ctx.lineWidth = 0.1;
      }

      const hw = building.width / 2;
      const hh = building.height / 2;

      ctx.fillRect(-hw, -hh, building.width, building.height);
      ctx.strokeRect(-hw, -hh, building.width, building.height);

      // Draw store name if it's a store
      if (building.type === "store" && building.name) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = "0.8px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(building.name, 0, 0);
      }

      ctx.restore();
    }

    // Draw parking spots
    for (const spot of city.parkingSpots) {
      ctx.save();
      ctx.translate(spot.x, spot.y);
      ctx.rotate(spot.rotation);

      // Parking spot marker
      ctx.strokeStyle = "rgba(120, 120, 120, 0.95)";
      ctx.lineWidth = 0.15;
      ctx.strokeRect(-1.5, -1, 3, 2);

      // "P" label (instead of directional triangle)
      ctx.fillStyle = "rgba(170, 170, 170, 0.95)";
      ctx.font = "bold 1.2px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", 0, 0);

      ctx.restore();
    }
  }

  drawFog(centerX: number, centerY: number, radiusM: number): void {
    const ctx = this.ctx;
    ctx.save();

    // Use screen space for the overlay
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Calculate screen position of the world point (centerX, centerY)
    const dx = centerX - this.camera.centerX;
    const dy = centerY - this.camera.centerY;

    const rot = this.camera.rotationRad ?? 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const rx = dx * cosR + dy * sinR;
    const ry = -dx * sinR + dy * cosR;

    const screenCenterX = this.camera.screenCenterXCssPx ?? w / 2;
    const screenCenterY = this.camera.screenCenterYCssPx ?? h / 2;
    const sx = screenCenterX + rx * this.camera.pixelsPerMeter;
    const sy = screenCenterY + ry * this.camera.pixelsPerMeter;

    const pixelRadius = radiusM * this.camera.pixelsPerMeter;
    // Use a larger gradient to avoid hard edges
    const gradientRadius = pixelRadius * 1.4;

    // Simplified gradient with fewer stops for better performance
    const gradient = ctx.createRadialGradient(sx, sy, pixelRadius * 0.2, sx, sy, gradientRadius);
    gradient.addColorStop(0, "rgba(185, 190, 195, 0)");
    gradient.addColorStop(0.6, "rgba(175, 180, 186, 0.72)");
    gradient.addColorStop(1, "rgba(165, 170, 176, 0.96)");

    // Draw gradient over entire screen (gradient naturally fades)
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Only fill outside if gradient doesn't cover screen
    const halfDiag = Math.sqrt(w * w + h * h) * 0.5;
    if (gradientRadius < halfDiag) {
      ctx.fillStyle = "rgba(165, 170, 176, 0.96)";
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(sx, sy, gradientRadius, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
    }

    ctx.restore();
  }

  drawRain(opts: { intensity01: number; timeSeconds: number }): void {
    const ctx = this.ctx;
    const intensity = clamp(opts.intensity01, 0, 1);
    if (intensity < 0.02) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Falling streaks (screen space) with per-particle randomness.
    // Batched into a single path+stroke to reduce draw-call overhead.
    // Reduced particle count for performance while maintaining visual effect.
    const count = Math.min(350, Math.floor((w * h) / 180000 * (0.18 + intensity * 0.7)));
    const t = opts.timeSeconds;

    const u32 = (n: number): number => (n >>> 0);
    const hash = (n: number): number => {
      let x = u32(n);
      x ^= x >>> 16;
      x = Math.imul(x, 0x7feb352d);
      x ^= x >>> 15;
      x = Math.imul(x, 0x846ca68b);
      x ^= x >>> 16;
      return u32(x);
    };
    const to01 = (x: number): number => (x >>> 0) / 4294967296;

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.globalAlpha = 0.28 + 0.38 * intensity;
    ctx.lineWidth = 1.3 + 1.2 * intensity;

    ctx.beginPath();

    const baseSpeed = 900 + 2600 * intensity;
    for (let i = 0; i < count; i++) {
      const h0 = hash(i * 3 + 1);
      const h1 = hash(i * 3 + 2);
      const h2 = hash(i * 3 + 3);
      const rx = to01(h0);
      const ry = to01(h1);
      const rv = to01(h2);

      const x = rx * (w + 220) - 110;
      const y0 = ry * (h + 260) - 130;
      const speed = baseSpeed * (0.65 + 0.7 * rv);
      const y = ((y0 + t * speed) % (h + 260)) - 130;

      const slant = -0.25 + 0.5 * rx;
      // Longer streaks to compensate for fewer particles
      const len = 14 + 32 * (0.25 + 0.75 * intensity) * (0.4 + 0.6 * rv);
      const dx = slant * len;
      const dy = len;

      ctx.moveTo(x, y);
      ctx.lineTo(x + dx, y + dy);
    }

    ctx.stroke();

    // Fine mist specks - reduced for performance.
    ctx.globalAlpha = 0.06 + 0.12 * intensity;
    ctx.fillStyle = "rgba(250, 252, 255, 0.70)";
    const speckCount = Math.min(200, Math.floor((w * h) / 400000 * (0.12 + intensity * 0.5)));
    const mistSpeed = 320 + 820 * intensity;
    for (let i = 0; i < speckCount; i++) {
      const r = to01(hash(i * 2 + 77));
      const s = to01(hash(i * 2 + 78));
      const x = r * w;
      const y = ((s * (h + 80) + t * mistSpeed) % (h + 80)) - 40;
      ctx.fillRect(x, y, 1, 1);
    }

    ctx.restore();
  }
}

function parseRgba(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/);
  if (!m) return null;
  return {
    r: clampInt(Number(m[1])),
    g: clampInt(Number(m[2])),
    b: clampInt(Number(m[3])),
    a: Math.max(0, Math.min(1, Number(m[4])))
  };
}

function clampInt(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hashStringToUint32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32Local(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
