export type CarAxis = "steer" | "throttle" | "brake" | "handbrake";

export interface InputState {
  steer: number;      // [-1, 1]
  throttle: number;   // [0, 1]
  brake: number;      // [0, 1]
  handbrake: number;  // [0, 1]
  shoot: boolean;
  fromKeyboard?: boolean;
}

export interface GameInput {
  getState(): InputState;
  isDown(code: string): boolean; // Still useful for some specific keys
}

type KeyMap = Partial<Record<CarAxis, { negative?: string[]; positive?: string[] }>>;

export class KeyboardInput implements GameInput {
  private readonly down = new Set<string>();
  private readonly map: KeyMap = {
    steer: { negative: ["KeyA", "ArrowLeft"], positive: ["KeyD", "ArrowRight"] },
    throttle: { positive: ["KeyW", "ArrowUp"] },
    brake: { positive: ["KeyS", "ArrowDown"] },
    handbrake: { positive: ["Space"] }
  };

  constructor(target: Window) {
    target.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      this.down.add(e.code);
    });
    target.addEventListener("keyup", (e) => {
      this.down.delete(e.code);
    });
    target.addEventListener("blur", () => this.down.clear());
  }

  getState(): InputState {
    return {
      steer: this.axis("steer"),
      throttle: this.axis("throttle"),
      brake: this.axis("brake"),
      handbrake: this.axis("handbrake"),
      shoot: this.isDown("KeyL"),
      fromKeyboard: true
    };
  }

  private axis(name: CarAxis): number {
    const config = this.map[name];
    if (!config) return 0;

    const negative = config.negative?.some((code) => this.down.has(code)) ?? false;
    const positive = config.positive?.some((code) => this.down.has(code)) ?? false;

    if (config.negative) {
      if (negative && !positive) return -1;
      if (positive && !negative) return 1;
      return 0;
    }

    return positive ? 1 : 0;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
}

export class TouchInput implements GameInput {
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private handbrake = 0;
  private shoot = false;

  constructor(
    private readonly opts: {
      setAimClientPoint?: (clientX: number, clientY: number) => void;
      setShootHeld?: (held: boolean) => void;
      shootPulse?: () => void;
      showOverlay?: boolean;
    } = {}
  ) {
    this.setupJoystick();
    this.setupButtons();
    this.setupNavigatorControls();

    // Show overlay (optional; start menu may want to delay this)
    if (this.opts.showOverlay !== false) {
      const overlay = document.getElementById("mobile-overlay");
      if (overlay) overlay.style.display = "block";
    }
  }

  private setupJoystick(): void {
    const zone = document.getElementById("steering-zone");
    const knob = document.getElementById("joystick-knob");
    if (!zone || !knob) return;

    // Avoid long-press selection/callouts on mobile browsers.
    zone.addEventListener("contextmenu", (e) => e.preventDefault());

    const deadzone = 0.08;
    const expo = 1.25;

    const handleMove = (e: PointerEvent) => {
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const maxR = Math.max(1, Math.min(rect.width, rect.height) * 0.42);
      const r = Math.hypot(dx, dy);
      const k = r > 1e-6 ? Math.min(1, r / maxR) : 0;
      const nx = r > 1e-6 ? (dx / r) * k : 0;
      const ny = r > 1e-6 ? (dy / r) * k : 0;

      const rawSteer = nx;
      const mag = Math.abs(rawSteer);
      if (mag < deadzone) {
        this.steer = 0;
      } else {
        const t = (mag - deadzone) / (1 - deadzone);
        const shaped = Math.pow(t, expo);
        this.steer = Math.sign(rawSteer) * shaped;
      }

      // Visuals (full 2D for better thumb feedback)
      knob.style.transform = `translate(calc(-50% + ${nx * maxR}px), calc(-50% + ${ny * maxR}px))`;
    };

    const handleEnd = () => {
      this.steer = 0;
      knob.style.transform = "translate(-50%, -50%)";
    };

    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.setPointerCapture(e.pointerId);
      handleMove(e);
    });
    zone.addEventListener("pointermove", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (zone.hasPointerCapture(e.pointerId)) handleMove(e);
    });
    zone.addEventListener("pointerup", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { zone.releasePointerCapture(e.pointerId); } catch { }
      handleEnd();
    });
    zone.addEventListener("pointercancel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    });
  }

  private setupButtons(): void {
    const throttle = document.getElementById("btn-throttle");
    const brake = document.getElementById("btn-brake");
    const handbrake = document.getElementById("btn-handbrake");

    const bind = (el: HTMLElement | null, action: (down: boolean) => void) => {
      if (!el) return;
      // Avoid long-press selection/callouts on mobile browsers.
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        action(true);
      });
      el.addEventListener("pointerup", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { el.releasePointerCapture(e.pointerId); } catch { }
        action(false);
      });
      el.addEventListener("pointercancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        action(false);
      });
    };

    bind(throttle, (down) => this.throttle = down ? 1 : 0);
    bind(brake, (down) => this.brake = down ? 1 : 0);
    bind(handbrake, (down) => this.handbrake = down ? 1 : 0);
  }

  private setupNavigatorControls(): void {
    const aimZone = document.getElementById("aim-zone");
    const shootBtn = document.getElementById("btn-shoot");

    if (aimZone && this.opts.setAimClientPoint) {
      // Avoid long-press selection/callouts on mobile browsers.
      aimZone.addEventListener("contextmenu", (e) => e.preventDefault());

      const updateAim = (e: PointerEvent) => {
        this.opts.setAimClientPoint?.(e.clientX, e.clientY);
      };

      aimZone.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        aimZone.setPointerCapture(e.pointerId);
        updateAim(e);
        // Tap/hold anywhere to shoot (especially useful for automatic weapons)
        this.opts.shootPulse?.();
        this.opts.setShootHeld?.(true);
      });
      aimZone.addEventListener("pointermove", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (aimZone.hasPointerCapture(e.pointerId)) updateAim(e);
      });
      aimZone.addEventListener("pointerup", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { aimZone.releasePointerCapture(e.pointerId); } catch { }
        this.opts.setShootHeld?.(false);
      });
      aimZone.addEventListener("pointercancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.opts.setShootHeld?.(false);
      });
    }

    if (shootBtn) {
      // Avoid long-press selection/callouts on mobile browsers.
      shootBtn.addEventListener("contextmenu", (e) => e.preventDefault());
      shootBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        shootBtn.setPointerCapture(e.pointerId);
        this.opts.shootPulse?.();
        this.opts.setShootHeld?.(true);
      });
      shootBtn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { shootBtn.releasePointerCapture(e.pointerId); } catch { }
        this.opts.setShootHeld?.(false);
      });
      shootBtn.addEventListener("pointercancel", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.opts.setShootHeld?.(false);
      });
    }
  }

  getState(): InputState {
    // Prefer braking over throttle if both are pressed.
    const throttle = this.brake > 0 ? 0 : this.throttle;
    return {
      steer: this.steer,
      throttle,
      brake: this.brake,
      handbrake: this.handbrake,
      shoot: this.shoot,
      fromKeyboard: false
    };
  }

  isDown(_code: string): boolean {
    return false;
  }
}

export class CompositeInput implements GameInput {
  constructor(private readonly inputs: GameInput[]) { }

  getState(): InputState {
    const states = this.inputs.map(i => i.getState());

    // Merge states: max for numbers (for throttle/brake), 
    // for steer we take the one with higher magnitude, or sum and clamp.
    // simpler: if one is non-zero, use it.

    return {
      steer: this.mergeAxis(states.map(s => s.steer)),
      throttle: Math.max(...states.map(s => s.throttle)),
      brake: Math.max(...states.map(s => s.brake)),
      handbrake: Math.max(...states.map(s => s.handbrake)),
      shoot: states.some(s => s.shoot),
      fromKeyboard: states.some(s => s.fromKeyboard)
    };
  }

  private mergeAxis(values: number[]): number {
    // Return the value with the largest magnitude
    let maxMag = 0;
    let result = 0;
    for (const v of values) {
      if (Math.abs(v) > maxMag) {
        maxMag = Math.abs(v);
        result = v;
      }
    }
    return result;
  }

  isDown(code: string): boolean {
    return this.inputs.some(i => i.isDown(code));
  }
}
