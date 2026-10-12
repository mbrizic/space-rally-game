import { describe, expect, it, vi } from "vitest";
import { createCarState } from "../sim/car";
import { Game, PlayerRole } from "./game";
import { Renderer2D } from "./renderer2d";
import { stageName } from "../sim/stage";
import * as backend from "../net/backend-api";

function collisionRuntime() {
  return Object.assign(Object.create(Game.prototype), {
    state: { car: createCarState() },
    damage01: 0,
    netMode: "solo",
    debris: [],
    speedMS: () => 28,
    emitParticles: vi.fn(),
    playNetEffect: vi.fn()
  });
}

describe("small collision tuning", () => {
  it("gives logs a slightly stronger disturbance without extra damage or a hard stop", () => {
    const game = collisionRuntime();
    game.state.car.vxMS = 28;
    game.state.car.yM = 0.9;
    game.debris = [{ id: 1, x: 0, y: 0, rotationRad: 0, lengthM: 4, widthM: 0.6, integrity01: 1 }];
    game.resolveDebrisCollisions();
    expect(Math.abs(game.state.car.yawRateRadS)).toBeGreaterThan(0.24 + 0.55);
    expect(Math.abs(game.state.car.yawRateRadS)).toBeLessThan((0.24 + 0.55) * 1.15);
    expect(game.state.car.vxMS).toBeCloseTo(28 * 0.983);
    expect(game.damage01).toBeCloseTo(0.0012);
    expect(game.debris).toHaveLength(0);
  });

  it("increases small-mob reaction only modestly and keeps damage unchanged", () => {
    const game = collisionRuntime();
    game.state.car.xM = 1;
    game.state.car.vxMS = 28;
    game.state.car.vyMS = 4;
    game.enemyPool = { getActive: () => [{ id: 1, type: "zombie", x: 0, y: 0, radius: 0.6 }], damage: vi.fn() };
    game.resolveEnemyCollisions();
    expect(game.state.car.xM).toBeCloseTo(1 + 0.45 * 0.135);
    expect(game.state.car.vxMS).toBeCloseTo(28 * 0.91);
    expect(game.state.car.yawRateRadS).toBeCloseTo(4 * 0.91 * 0.067);
    expect(game.damage01).toBeCloseTo(28 * 0.45 * 0.0035);
    expect(game.enemyPool.damage).toHaveBeenCalledWith(1, 1);
  });

  it("leaves tank collision strength unchanged", () => {
    const game = collisionRuntime();
    game.state.car.xM = 1;
    game.state.car.vxMS = 28;
    game.enemyPool = { getActive: () => [{ id: 1, type: "tank", x: 0, y: 0, radius: 0.9 }], damage: vi.fn() };
    game.resolveEnemyCollisions();
    expect(game.state.car.vxMS).toBeCloseTo(28 * 0.78);
    expect(game.state.car.xM).toBeCloseTo(1 + 0.75 * 0.35);
  });
});

describe("notification prominence", () => {
  it.each(["Checkpoint 1/3", "BULLET TIME"])("keeps %s smaller and dimmer", text => {
    const context = {
      save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
      measureText: () => ({ width: 180 }), strokeText: vi.fn(), fillText: vi.fn(),
      font: "", fillStyle: ""
    };
    const renderer = Object.assign(Object.create(Renderer2D.prototype), {
      ctx: context, dpr: 1, viewportWidthCssPx: 844, viewportHeightCssPx: 390
    });
    renderer.drawNotification(text, 0.5);
    expect(context.font).toContain("24px");
    expect(context.fillStyle).toBe("rgba(255, 255, 255, 0.72)");
    renderer.drawNotification("WRECKED", 0.5);
    expect(context.font).toContain("48px");
    expect(context.fillStyle).toBe("rgba(255, 255, 255, 1)");
  });
});

describe("navigator map-only callouts", () => {
  it.each(["solo", "host", "client"])("keeps hazard distances off the screen in %s mode", netMode => {
    const game = collisionRuntime();
    Object.assign(game, { role: PlayerRole.NAVIGATOR, netMode, notificationText: "", notificationTimeSeconds: 0 });
    for (const hazard of ["DEBRIS", "RAIN", "NARROW", "FOG", "ECLIPSE", "SANDSTORM", "ELECTRICAL"]) {
      const text = `${hazard} IN 100m`;
      expect(game.isMinimapOnlyCallout(text)).toBe(true);
      game.notify(text);
      expect(game.notificationText).toBe("");
    }
    game.notify("Checkpoint 1/3");
    expect(game.notificationText).toBe("Checkpoint 1/3");
    game.notify("BULLET TIME");
    expect(game.notificationText).toBe("BULLET TIME");
  });

  it("keeps weather badges inside the map and replaces debris/narrow distances with D patches", () => {
    const methods: Record<string, any> = {
      measureText: () => ({ width: 140 }), fillText: vi.fn(), rect: vi.fn(), clip: vi.fn(), translate: vi.fn()
    };
    const context = new Proxy(methods, { get(target, key: string) { return target[key] ?? (target[key] = vi.fn()); } });
    const renderer = Object.assign(Object.create(Renderer2D.prototype), { ctx: context, dpr: 1, viewportWidthCssPx: 844, viewportHeightCssPx: 390 });
    renderer.drawMinimap({
      track: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], widthM: 7 },
      carX: 0, carY: 0, carHeading: 0, offsetX: 10, offsetY: 20, size: 200,
      warningTextLines: ["RAIN IN 100m", "NARROW IN 50m", "DEBRIS IN 30m"],
      debris: [
        { x: 25, y: 0, lengthM: 3, rotationRad: 0, sM: 25, integrity01: 1 },
        { x: 30, y: 0, lengthM: 3, rotationRad: 0, sM: 30, integrity01: 1 },
        { x: 70, y: 0, lengthM: 3, rotationRad: 0, sM: 150, integrity01: 1 },
        { x: 90, y: 0, lengthM: 3, rotationRad: 0, sM: 250, integrity01: 0 }
      ]
    });
    expect(context.rect).toHaveBeenCalledWith(10, 20, 200, 200);
    expect(context.clip).toHaveBeenCalled();
    expect(context.translate).toHaveBeenCalledWith(20, 30);
    const text = context.fillText.mock.calls.map((call: any[]) => String(call[0]));
    expect(text.some((line: string) => line.includes("RAIN IN 100m"))).toBe(true);
    expect(text.some((line: string) => /NARROW IN|DEBRIS IN/.test(line))).toBe(false);
    expect(text.filter((line: string) => line === "D")).toHaveLength(2);
  });
});

describe("first finisher message", () => {
  it.each(["solo", "client"])("shows mode-appropriate finish copy in %s without changing score data", async netMode => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.spyOn(backend, "getTrackVotes").mockResolvedValue({ ok: true, upvotes: 0, downvotes: 0 });
    vi.spyOn(backend, "getHighScores").mockResolvedValue({ ok: true, scores: [] });
    vi.spyOn(backend, "getHighScoreChampions").mockResolvedValue({ ok: true, totalTracks: 0, leaders: [] });
    try {
      const game = collisionRuntime();
      Object.assign(game, {
        finishPanelSeed: "150", finishPanelScoreMs: 12345, trackDef: { meta: { seed: 150 } }, soloMode: "timeTrial", netMode,
        finishPanel: { record: { textContent: "" }, board: { textContent: "" } }
      });
      await game.refreshFinishPanelData();
      if (netMode === "client") {
        expect(game.finishPanel.record.textContent).toContain("P1 driver will request a new job");
        expect(game.finishPanel.record.textContent).toContain("Please wait");
      } else {
        expect(game.finishPanel.record.textContent).toContain(stageName(150));
        expect(game.finishPanel.record.textContent).toContain("Fastest by default");
      }
      expect(backend.getHighScores).toHaveBeenCalledWith({ seed: "150", limit: 100 });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

describe("start overlay separation", () => {
  it("keeps GO away from a visible route description", () => {
    const game = collisionRuntime();
    Object.assign(game, { role: PlayerRole.DRIVER, stageIntro: { hidden: false } });
    expect(game.shouldShowScreenNotification("GO!")).toBe(false);
    expect(game.shouldShowScreenNotification("Checkpoint 1/3")).toBe(true);
    game.stageIntro.hidden = true;
    expect(game.shouldShowScreenNotification("GO!")).toBe(true);
  });

  it("keeps the failure text backdrop above the retry button region on landscape screens", () => {
    for (const height of [240, 320, 390, 720]) {
      const context = {
        save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
        measureText: () => ({ width: 250 }), fillRect: vi.fn(), fillText: vi.fn()
      };
      const renderer = Object.assign(Object.create(Renderer2D.prototype), {
        ctx: context, dpr: 1, viewportWidthCssPx: 844, viewportHeightCssPx: height
      });
      renderer.drawCenterText({ text: "DELIVERY FAILED", subtext: "Please try another delivery.", centerYFraction: 0.4 });
      const [, top, , panelHeight] = context.fillRect.mock.calls[0];
      const padding = Math.max(10, Math.min(22, height * 0.022));
      const retryTop = Math.min(height / 2 + 72, height - padding - 21 - 52);
      expect(top + panelHeight).toBeLessThan(retryTop);
    }
  });
});