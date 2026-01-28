import { describe, expect, it } from "vitest";
import { computeCameraFraming } from "./camera-framing";

describe("camera framing", () => {
  it("computes safe runner framing for touch driver", () => {
    const res = computeCameraFraming({
      widthCssPx: 800,
      heightCssPx: 600,
      isTouch: true,
      cameraMode: "runner",
      role: "driver",
      carHeadingRad: 0
    });

    // Touch bottom safe area clamps the Y center.
    expect(res.screenCenterYCssPx).toBe(384);
    expect(res.screenCenterXCssPx).toBeUndefined();
    // Zoom clamped to basePixelsPerMeter.
    expect(res.pixelsPerMeter).toBe(24);
    expect(res.offsetXM).toBe(0);
    expect(res.offsetYM).toBe(0);
  });

  it("computes runner navigator X bias and zoom from right-edge ahead pixels", () => {
    const res = computeCameraFraming({
      widthCssPx: 800,
      heightCssPx: 600,
      isTouch: true,
      cameraMode: "runner",
      role: "navigator",
      carHeadingRad: 0
    });

    expect(res.screenCenterXCssPx).toBe(272);
    expect(res.screenCenterYCssPx).toBe(384);
    // aheadPx is derived from (width - screenCenterX), so still clamped to basePixelsPerMeter.
    expect(res.pixelsPerMeter).toBe(24);
  });

  it("computes follow-mode look-ahead offset from heading", () => {
    const res = computeCameraFraming({
      widthCssPx: 1000,
      heightCssPx: 500,
      isTouch: false,
      cameraMode: "follow",
      role: "driver",
      carHeadingRad: 0
    });

    expect(res.screenCenterXCssPx).toBeUndefined();
    expect(res.screenCenterYCssPx).toBeUndefined();
    expect(res.offsetXM).toBeCloseTo(4.5, 10);
    expect(res.offsetYM).toBeCloseTo(0, 10);
    expect(res.pixelsPerMeter).toBeCloseTo(320 / 14, 6);
  });
});
