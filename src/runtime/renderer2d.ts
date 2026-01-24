import { clamp } from "./math";
import type { City } from "../sim/city";

type Camera2D = {
  centerX: number;
  centerY: number;
  pixelsPerMeter: number;
  rotationRad?: number;
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
    if (camera.rotationRad) ctx.rotate(camera.rotationRad);
    ctx.translate(-camera.centerX, -camera.centerY);
  }

  endCamera(): void {
    this.ctx.restore();
  }

  screenToWorld(xCssPx: number, yCssPx: number): { x: number; y: number } {
    const width = this.viewportWidthCssPx || this.canvas.clientWidth;
    const height = this.viewportHeightCssPx || this.canvas.clientHeight;

    const dx = (xCssPx - width / 2) / this.camera.pixelsPerMeter;
    const dy = (yCssPx - height / 2) / this.camera.pixelsPerMeter;

    const rot = this.camera.rotationRad ?? 0;
    const cosR = Math.cos(-rot);
    const sinR = Math.sin(-rot);
    const rx = dx * cosR - dy * sinR;
    const ry = dx * sinR + dy * cosR;

    return { x: rx + this.camera.centerX, y: ry + this.camera.centerY };
  }

  drawBg(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Identity (pixel space)

    // Clear the ENTIRE canvas (in actual device pixels, not CSS pixels)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    ctx.fillStyle = "rgba(15, 20, 25, 1)";
    // Fill the entire canvas (device pixels)
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
  }): void {
    const ctx = this.ctx;
    if (track.points.length < 2) return;

    ctx.save();

    const fillStyles = track.segmentFillStyles;
    const shoulderStyles = track.segmentShoulderStyles;
    const segmentWidths = track.segmentWidthsM;

    // Calculate perpendicular normals for each point
    const normals: { nx: number; ny: number }[] = [];
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
      normals.push({ nx: -dy / len, ny: dx / len });
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

    // Centerline
    ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
    ctx.lineWidth = 0.20;
    ctx.setLineDash([1.2, 1.5]);
    ctx.beginPath();
    ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
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

  drawCar(car: { x: number; y: number; headingRad: number; speed: number; rollOffsetM?: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.headingRad);

    const length = 1.85;
    const width = 0.93;

    const rollOffset = clamp(car.rollOffsetM ?? 0, -0.22, 0.22);

    // Shadow/body-roll hint (purely visual).
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.rect(-length * 0.5 + rollOffset * 0.35, -width * 0.5 - rollOffset * 0.9, length, width);
    ctx.fill();

    ctx.fillStyle = "rgba(240, 246, 255, 0.9)";
    ctx.strokeStyle = "rgba(30, 40, 60, 0.9)";
    ctx.lineWidth = 2 / this.camera.pixelsPerMeter;

    ctx.beginPath();
    ctx.rect(-length * 0.5, -width * 0.5, length, width);
    ctx.fill();
    ctx.stroke();

    // Roof highlight shifted by roll direction.
    ctx.fillStyle = "rgba(170, 210, 255, 0.14)";
    ctx.beginPath();
    ctx.rect(-length * 0.35 + rollOffset * 0.25, -width * 0.22 - rollOffset * 0.45, length * 0.7, width * 0.44);
    ctx.fill();

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

  drawEnemies(enemies: { x: number; y: number; radius: number; vx: number; vy: number }[]): void {
    const ctx = this.ctx;
    ctx.save();
    
    for (const enemy of enemies) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      
      // Zombie body - greenish gray humanoid
      ctx.fillStyle = "rgba(80, 100, 70, 0.9)";
      ctx.strokeStyle = "rgba(40, 50, 35, 0.95)";
      ctx.lineWidth = 0.08;
      
      // Simple humanoid shape (circle with slight ellipse for body)
      ctx.beginPath();
      ctx.ellipse(0, 0, enemy.radius * 0.8, enemy.radius, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Head (smaller circle on top)
      ctx.fillStyle = "rgba(90, 110, 80, 0.95)";
      ctx.beginPath();
      ctx.arc(0, -enemy.radius * 0.6, enemy.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Red eyes for zombie effect
      const eyeY = -enemy.radius * 0.65;
      ctx.fillStyle = "rgba(200, 50, 50, 0.9)";
      ctx.beginPath();
      ctx.arc(-enemy.radius * 0.15, eyeY, 0.08, 0, Math.PI * 2);
      ctx.arc(enemy.radius * 0.15, eyeY, 0.08, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
    
    ctx.restore();
  }

  drawWater(waterBodies: { x: number; y: number; radiusX: number; radiusY: number; rotation: number }[]): void {
    const ctx = this.ctx;
    ctx.save();
    
    for (const w of waterBodies) {
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

  drawProjectiles(projectiles: { x: number; y: number; vx: number; vy: number; age: number }[]): void {
    const ctx = this.ctx;
    ctx.save();
    
    for (const proj of projectiles) {
      // Draw bullet as bright tracer line
      const speed = Math.hypot(proj.vx, proj.vy);
      const tracerLength = Math.min(speed * 0.02, 15); // 20ms trail, max 15m
      
      // Calculate tracer tail position
      const dx = proj.vx / speed;
      const dy = proj.vy / speed;
      const tailX = proj.x - dx * tracerLength;
      const tailY = proj.y - dy * tracerLength;
      
      // Bright tracer with glow
      ctx.strokeStyle = "rgba(255, 220, 100, 0.95)";
      ctx.lineWidth = 0.15; // 15cm tracer width
      ctx.lineCap = "round";
      
      // Add glow effect
      ctx.shadowColor = "rgba(255, 200, 80, 0.8)";
      ctx.shadowBlur = 0.3;
      
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      
      // Draw bright head
      ctx.fillStyle = "rgba(255, 240, 150, 1)";
      ctx.shadowBlur = 0.4;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 0.1, 0, Math.PI * 2);
      ctx.fill();
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

  drawPacenoteBanner(opts: { text: string }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const x = w / 2;
    const y = 80; // Moved down to avoid overlapping with Rally info

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

    const padX = 14;
    const padY = 8;
    const textW = ctx.measureText(opts.text).width;
    const boxW = Math.ceil(textW + padX * 2);
    const boxH = 30 + padY;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - boxW / 2, y, boxW, boxH);

    ctx.fillStyle = "rgba(255, 205, 105, 0.95)";
    ctx.fillText(opts.text, x, y + padY);

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

  drawRpmMeter(opts: { rpm: number; maxRpm: number; redlineRpm: number; gear: number; totalDistanceKm?: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Position bottom-center
    const centerX = w / 2;
    const centerY = h - 80;
    const radius = 70;
    const startAngle = Math.PI * 0.75; // 135 degrees
    const endAngle = Math.PI * 2.25; // 405 degrees (270 degree sweep)

    // Background arc
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.stroke();

    // Color zones
    const rpmFraction = opts.rpm / opts.maxRpm;
    const redlineFraction = opts.redlineRpm / opts.maxRpm;
    const sweepAngle = endAngle - startAngle;

    // Green zone (0-70% of redline)
    ctx.strokeStyle = "rgba(80, 200, 120, 0.7)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sweepAngle * redlineFraction * 0.7);
    ctx.stroke();

    // Yellow zone (70-90% of redline)
    ctx.strokeStyle = "rgba(255, 200, 60, 0.7)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle + sweepAngle * redlineFraction * 0.7, startAngle + sweepAngle * redlineFraction * 0.9);
    ctx.stroke();

    // Red zone (90%+ of redline)
    ctx.strokeStyle = "rgba(255, 80, 80, 0.7)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle + sweepAngle * redlineFraction * 0.9, endAngle);
    ctx.stroke();

    // RPM needle
    const needleAngle = startAngle + sweepAngle * Math.min(rpmFraction, 1);
    const needleLength = radius - 10;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(needleAngle) * needleLength,
      centerY + Math.sin(needleAngle) * needleLength
    );
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fill();

    // RPM text
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "bold 18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(opts.rpm)}`, centerX, centerY + 28);

    // Gear indicator - PROMINENT for manual shifting
    ctx.font = "bold 60px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = rpmFraction > redlineFraction * 0.9 ? "rgba(255, 100, 100, 1)" : "rgba(180, 220, 255, 0.98)";
    ctx.fillText(`${opts.gear}`, centerX + radius + 50, centerY - 5);
    
    // Gear label
    ctx.font = "bold 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillStyle = "rgba(180, 220, 255, 0.7)";
    ctx.fillText("GEAR", centerX + radius + 50, centerY + 35);

    // Total distance driven (if provided)
    if (opts.totalDistanceKm !== undefined) {
      ctx.font = "bold 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillStyle = "rgba(180, 220, 255, 0.6)";
      ctx.textAlign = "center";
      ctx.fillText(`${opts.totalDistanceKm.toFixed(1)} km`, centerX, centerY + 50);
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

    // Shadow/outline for visibility
    ctx.font = "bold 48px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // Black outline
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
    ctx.lineWidth = 8;
    ctx.strokeText(text, centerX, centerY);
    
    // White text
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillText(text, centerX, centerY);

    ctx.restore();
  }

  drawDamageOverlay(opts: { damage01: number }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Red vignette that intensifies with damage
    const alpha = Math.min(opts.damage01 * 0.4, 0.6);
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, `rgba(255, 0, 0, 0)`);
    gradient.addColorStop(1, `rgba(200, 0, 0, ${alpha})`);
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

  drawMinimap(opts: { track: any; carX: number; carY: number; carHeading: number; waterBodies?: { x: number; y: number; radiusX: number; radiusY: number; rotation: number }[]; enemies?: { x: number; y: number }[] }): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.viewportWidthCssPx || this.canvas.clientWidth;
    const h = this.viewportHeightCssPx || this.canvas.clientHeight;

    // Minimap positioned below the Controls panel (top-right)
    const minimapSize = Math.min(w, h) * 0.18; // 18% of screen
    const padding = 12;
    const minimapX = w - minimapSize - padding;
    const minimapY = 280; // Below controls panel (which is ~260px tall)

    // Semi-transparent background
    ctx.fillStyle = "rgba(20, 25, 30, 0.7)";
    ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

    // Border
    ctx.strokeStyle = "rgba(180, 220, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

    // Calculate track bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of opts.track.points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }

    const trackWidth = maxX - minX;
    const trackHeight = maxY - minY;
    const scale = Math.min(minimapSize / trackWidth, minimapSize / trackHeight) * 0.85;
    const offsetX = minimapX + minimapSize / 2 - (minX + maxX) / 2 * scale;
    const offsetY = minimapY + minimapSize / 2 - (minY + maxY) / 2 * scale;

    // Draw track
    ctx.strokeStyle = "rgba(120, 140, 160, 0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < opts.track.points.length; i++) {
      const pt = opts.track.points[i];
      const x = offsetX + pt.x * scale;
      const y = offsetY + pt.y * scale;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw water bodies on minimap
    if (opts.waterBodies) {
      ctx.fillStyle = "rgba(40, 120, 200, 0.6)";
      for (const water of opts.waterBodies) {
        const wx = offsetX + water.x * scale;
        const wy = offsetY + water.y * scale;
        const rx = water.radiusX * scale;
        const ry = water.radiusY * scale;
        
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(water.rotation);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(2, rx), Math.max(2, ry), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Draw enemies on minimap
    if (opts.enemies) {
      ctx.fillStyle = "rgba(180, 50, 50, 0.7)";
      for (const enemy of opts.enemies) {
        const ex = offsetX + enemy.x * scale;
        const ey = offsetY + enemy.y * scale;
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw cities
    if (opts.track.startCity) {
      const cx = offsetX + opts.track.startCity.centerX * scale;
      const cy = offsetY + opts.track.startCity.centerY * scale;
      ctx.fillStyle = "rgba(255, 220, 100, 0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (opts.track.endCity) {
      const cx = offsetX + opts.track.endCity.centerX * scale;
      const cy = offsetY + opts.track.endCity.centerY * scale;
      ctx.fillStyle = "rgba(100, 255, 100, 0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw car
    const carX = offsetX + opts.carX * scale;
    const carY = offsetY + opts.carY * scale;
    
    ctx.save();
    ctx.translate(carX, carY);
    ctx.rotate(opts.carHeading);
    
    // Car triangle
    ctx.fillStyle = "rgba(255, 100, 100, 0.9)";
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-4, 3);
    ctx.closePath();
    ctx.fill();
    
    // Car outline
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
    
    ctx.restore();

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
      ctx.strokeStyle = "rgba(255, 200, 100, 1.0)";
      ctx.lineWidth = 0.15;
      ctx.strokeRect(-1.5, -1, 3, 2);

      // Arrow showing parking direction
      ctx.fillStyle = "rgba(255, 200, 100, 1.0)";
      ctx.beginPath();
      ctx.moveTo(0, -0.5);
      ctx.lineTo(0.5, 0.5);
      ctx.lineTo(-0.5, 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }
}
