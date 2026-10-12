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
    expect(res.screenCenterYCssPx).toBe(408);
    expect(res.screenCenterXCssPx).toBeUndefined();
    // Zoom clamped to basePixelsPerMeter.
    expect(res.pixelsPerMeter).toBe(24);
    expect(res.offsetXM).toBe(0);
    expect(res.offsetYM).toBe(0);
  });

  it("keeps navigator X bias with a wider world view than the driver", () => {
    const res = computeCameraFraming({
      widthCssPx: 800,
      heightCssPx: 600,
      isTouch: true,
      cameraMode: "runner",
      role: "navigator",
      carHeadingRad: 0
    });

    expect(res.screenCenterXCssPx).toBe(272);
    expect(res.screenCenterYCssPx).toBe(300);
    expect(res.pixelsPerMeter).toBeCloseTo(24 * 0.86, 6);
  });

  it("never zooms the navigator in more than the driver in landscape", () => {
    for (const [widthCssPx, heightCssPx] of [[844, 390], [932, 430], [640, 320], [1280, 720]]) {
      for (const isTouch of [true, false]) {
        for (const cameraMode of ["runner", "follow"] as const) {
          const options = { widthCssPx, heightCssPx, isTouch, cameraMode, carHeadingRad: 0 };
          const driver = computeCameraFraming({ ...options, role: "driver" });
          const navigator = computeCameraFraming({ ...options, role: "navigator" });
          expect(navigator.pixelsPerMeter).toBeCloseTo(driver.pixelsPerMeter * 0.86, 6);
          expect(navigator.screenCenterYCssPx).toBe(heightCssPx / 2);
          expect(navigator.offsetXM).toBe(0);
          expect(navigator.offsetYM).toBe(0);
          expect(widthCssPx / navigator.pixelsPerMeter).toBeGreaterThan(widthCssPx / driver.pixelsPerMeter);
          if (cameraMode === "runner") {
            const driverAheadM = driver.screenCenterYCssPx! / driver.pixelsPerMeter;
            const navigatorAheadM = (widthCssPx - navigator.screenCenterXCssPx!) / navigator.pixelsPerMeter;
            expect(navigatorAheadM).toBeGreaterThan(driverAheadM);
          }
        }
      }
    }
  });

  it("moves the phone driver down slightly without changing driver zoom", () => {
    const driver = computeCameraFraming({ widthCssPx: 844, heightCssPx: 390, isTouch: true, cameraMode: "runner", role: "driver", carHeadingRad: 0 });
    expect(driver.screenCenterYCssPx).toBeCloseTo(390 * 0.70 - 12);
    expect(driver.pixelsPerMeter).toBeCloseTo((390 * 0.66 - 12) / 14);
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
