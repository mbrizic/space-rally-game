export type TuningValues = {
  engineForceN: number;
  maxSteerDeg: number;
  driveBiasFront01: number;
  showArrows: boolean;
};

export class TuningPanel {
  readonly values: TuningValues;

  private readonly root: HTMLDivElement;
  private readonly sliders: Record<string, HTMLInputElement> = {};
  private readonly labels: Record<string, HTMLSpanElement> = {};

  constructor(container: HTMLElement, initial?: Partial<TuningValues>) {
    this.values = {
      engineForceN: initial?.engineForceN ?? 18000,
      maxSteerDeg: initial?.maxSteerDeg ?? 45,
      driveBiasFront01: initial?.driveBiasFront01 ?? 1,
      showArrows: initial?.showArrows ?? true
    };

    this.root = document.createElement("div");
    this.root.style.position = "fixed";
    this.root.style.right = "12px";
    this.root.style.bottom = "160px";
    this.root.style.padding = "10px 12px";
    this.root.style.background = "rgba(0,0,0,0.55)";
    this.root.style.border = "1px solid rgba(255,255,255,0.12)";
    this.root.style.borderRadius = "10px";
    this.root.style.color = "rgba(232,236,241,0.95)";
    this.root.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    this.root.style.fontSize = "12px";
    this.root.style.width = "300px";
    this.root.style.pointerEvents = "auto";

    this.root.appendChild(this.titleRow("Tuning"));

    this.root.appendChild(
      this.sliderRow("engineForceN", "Acceleration", 7000, 22000, 100, this.values.engineForceN)
    );
    this.root.appendChild(
      this.sliderRow("maxSteerDeg", "Steering", 22, 52, 1, this.values.maxSteerDeg)
    );
    this.root.appendChild(
      this.sliderRow("driveBiasFront01", "FWD %", 0, 1, 0.01, this.values.driveBiasFront01)
    );

    const arrowsRow = document.createElement("label");
    arrowsRow.style.display = "flex";
    arrowsRow.style.alignItems = "center";
    arrowsRow.style.gap = "8px";
    arrowsRow.style.marginTop = "8px";
    arrowsRow.style.userSelect = "none";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = this.values.showArrows;
    cb.addEventListener("change", () => {
      this.values.showArrows = cb.checked;
    });
    arrowsRow.appendChild(cb);

    const txt = document.createElement("span");
    txt.textContent = "Show arrows (F)";
    arrowsRow.appendChild(txt);
    this.root.appendChild(arrowsRow);

    container.appendChild(this.root);
    this.refreshLabels();

    // Stop keyboard from moving the page when using sliders.
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
  }

  setShowArrows(on: boolean): void {
    this.values.showArrows = on;
    const input = this.root.querySelector("input[type=checkbox]");
    if (input instanceof HTMLInputElement) input.checked = on;
  }

  private titleRow(title: string): HTMLElement {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "baseline";
    row.style.marginBottom = "8px";

    const t = document.createElement("div");
    t.textContent = title;
    t.style.fontSize = "13px";
    t.style.fontWeight = "600";
    t.style.color = "rgba(170, 210, 255, 0.95)";
    row.appendChild(t);

    const hint = document.createElement("div");
    hint.textContent = "drag sliders";
    hint.style.color = "rgba(232,236,241,0.55)";
    row.appendChild(hint);

    return row;
  }

  private sliderRow(
    key: keyof TuningValues,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number
  ): HTMLElement {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.marginTop = "8px";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = label;
    name.style.color = "rgba(232,236,241,0.9)";
    left.appendChild(name);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.width = "210px";
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      (this.values[key] as number) = v;
      this.refreshLabels();
    });
    left.appendChild(slider);

    const valueLabel = document.createElement("span");
    valueLabel.style.color = "rgba(232,236,241,0.8)";
    valueLabel.style.minWidth = "64px";
    valueLabel.style.textAlign = "right";

    this.sliders[String(key)] = slider;
    this.labels[String(key)] = valueLabel;

    row.appendChild(left);
    row.appendChild(valueLabel);

    return row;
  }

  private refreshLabels(): void {
    const eng = this.labels["engineForceN"];
    if (eng) eng.textContent = `${Math.round(this.values.engineForceN)} N`;

    const steer = this.labels["maxSteerDeg"];
    if (steer) steer.textContent = `${this.values.maxSteerDeg.toFixed(0)}°`;

    const bias = this.labels["driveBiasFront01"];
    if (bias) bias.textContent = `${Math.round(this.values.driveBiasFront01 * 100)}%`;
  }
}
