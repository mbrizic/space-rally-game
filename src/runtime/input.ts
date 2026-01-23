export type AxisName = "steer" | "throttle" | "brake" | "handbrake";

type KeyMap = Partial<Record<AxisName, { negative?: string[]; positive?: string[] }>>;

export class KeyboardInput {
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

  axis(name: AxisName): number {
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
}

