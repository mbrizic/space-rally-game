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

  constructor() {
    this.setupJoystick();
    this.setupButtons();

    // Show overlay
    const overlay = document.getElementById("mobile-overlay");
    if (overlay) overlay.style.display = "block";
  }

  private setupJoystick(): void {
    const zone = document.getElementById("steering-zone");
    const knob = document.getElementById("joystick-knob");
    if (!zone || !knob) return;

    const handleMove = (e: TouchEvent | PointerEvent) => {
      const rect = zone.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;

      const deltaX = clientX - centerX;
      const maxDelta = rect.width / 2;

      this.steer = Math.max(-1, Math.min(1, deltaX / maxDelta));

      // Visuals
      knob.style.transform = `translateX(${this.steer * (maxDelta - 20)}px)`;
    };

    const handleEnd = () => {
      this.steer = 0;
      knob.style.transform = "translateX(0)";
    };

    zone.addEventListener("pointerdown", (e) => {
      zone.setPointerCapture(e.pointerId);
      handleMove(e);
    });
    zone.addEventListener("pointermove", (e) => {
      if (zone.hasPointerCapture(e.pointerId)) {
        handleMove(e);
      }
    });
    zone.addEventListener("pointerup", (e) => {
      zone.releasePointerCapture(e.pointerId);
      handleEnd();
    });
    zone.addEventListener("pointercancel", () => handleEnd());
  }

  private setupButtons(): void {
    const brake = document.getElementById("btn-brake");
    const handbrake = document.getElementById("btn-handbrake");
    const throttleZone = document.getElementById("throttle-slider-container");
    const throttleHandle = document.getElementById("throttle-handle");
    const throttleFill = document.getElementById("throttle-fill");

    const bind = (el: HTMLElement | null, action: (down: boolean) => void) => {
      if (!el) return;
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        action(true);
      });
      el.addEventListener("pointerup", (e) => {
        el.releasePointerCapture(e.pointerId);
        action(false);
      });
      el.addEventListener("pointercancel", () => action(false));
    };

    bind(brake, (down) => this.brake = down ? 1 : 0);
    bind(handbrake, (down) => this.handbrake = down ? 1 : 0);

    // Throttle Slider Logic
    if (throttleZone && throttleHandle && throttleFill) {
      const updateThrottle = (e: PointerEvent) => {
        const rect = throttleZone.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const normalized = 1 - Math.max(0, Math.min(1, y / rect.height));
        this.throttle = normalized;

        // Visuals
        throttleHandle.style.bottom = `${normalized * (rect.height - 30)}px`;
        throttleFill.style.height = `${normalized * 100}%`;
      };

      const resetThrottle = () => {
        this.throttle = 0;
        throttleHandle.style.bottom = "0px";
        throttleFill.style.height = "0%";
      };

      throttleZone.addEventListener("pointerdown", (e) => {
        throttleZone.setPointerCapture(e.pointerId);
        updateThrottle(e);
      });
      throttleZone.addEventListener("pointermove", (e) => {
        if (throttleZone.hasPointerCapture(e.pointerId)) {
          updateThrottle(e);
        }
      });
      throttleZone.addEventListener("pointerup", (e) => {
        throttleZone.releasePointerCapture(e.pointerId);
        resetThrottle();
      });
      throttleZone.addEventListener("pointercancel", () => resetThrottle());
    }
  }

  getState(): InputState {
    return {
      steer: this.steer,
      throttle: this.throttle,
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
