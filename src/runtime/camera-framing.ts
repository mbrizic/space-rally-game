import { clamp } from "./math";

export type CameraFramingRole = "driver" | "navigator";
export type CameraMode = "follow" | "runner";

export type CameraFramingOptions = {
  widthCssPx: number;
  heightCssPx: number;
  isTouch: boolean;
  cameraMode: CameraMode;
  role: CameraFramingRole;
  carHeadingRad: number;
};

export type CameraFramingResult = {
  pixelsPerMeter: number;
  screenCenterXCssPx?: number;
  screenCenterYCssPx?: number;
  offsetXM: number;
  offsetYM: number;
};

export function computeCameraFraming(opts: CameraFramingOptions): CameraFramingResult {
  const { widthCssPx: width, heightCssPx: height, isTouch, cameraMode, role, carHeadingRad } = opts;

  // Camera framing
  // Goal: ensure the car is always visible even on short landscape viewports.
  // Strategy:
  // - Use a "safe" on-screen car position so it can't disappear under touch UI.
  // - Derive zoom from a target forward visibility (meters ahead), so short viewports zoom out.
  const basePixelsPerMeter = 24;
  const minPixelsPerMeter = 10;

  // Reserve space for touch controls at the bottom so the car remains visible.
  // (The controls are HTML overlays and can obscure the canvas.)
  const bottomUiSafePx = isTouch ? Math.min(280, height * 0.34) : 0;
  const marginPx = isTouch ? 12 : 0;
  const minCarYPx = marginPx;
  const maxCarYPx = height - bottomUiSafePx - marginPx;

  // In runner mode, the camera rotates so "forward" is up on the screen (driver).
  // For navigator (rotated 90°), "forward" is toward the right edge of the screen.
  // Keep the car lower on screen so driver sees more ahead.
  const desiredCarYFrac = cameraMode === "runner" ? (isTouch ? 0.72 : 0.78) : 0.64;
  const screenCenterYCssPxForZoom = clamp(height * desiredCarYFrac, minCarYPx, maxCarYPx);

  const marginXPx = isTouch ? 12 : 0;
  // Navigator: keep the car just to the right of the large bottom-left minimap on touch.
  // Moved back about halfway from the previous nudge.
  const desiredCarXFrac = cameraMode === "runner" && role === "navigator" ? (isTouch ? 0.34 : 0.34) : 0.5;
  const screenCenterXCssPxOverride =
    cameraMode === "runner" && role === "navigator" ? clamp(width * desiredCarXFrac, marginXPx, width - marginXPx) : undefined;

  // Target meters of view ahead of the car.
  // - Driver runner: ahead is toward the top (screenCenterY pixels)
  // - Navigator runner (rotated): ahead is toward the right (width - screenCenterX pixels)
  const targetAheadMeters =
    cameraMode === "runner" ? (role === "navigator" ? (isTouch ? 20 : 26) : (isTouch ? 14 : 18)) : 14;
  const aheadPx =
    cameraMode === "runner" && role === "navigator"
      ? Math.max(1, width - (screenCenterXCssPxOverride ?? width / 2))
      : Math.max(1, screenCenterYCssPxForZoom);
  const pixelsPerMeter = clamp(aheadPx / Math.max(1e-6, targetAheadMeters), minPixelsPerMeter, basePixelsPerMeter);

  // Fallback look-ahead for non-runner (no camera rotation): keep a small forward offset.
  let offsetXM = 0;
  let offsetYM = 0;
  let screenCenterYCssPxOverride: number | undefined = undefined;
  if (cameraMode === "runner") {
    screenCenterYCssPxOverride = screenCenterYCssPxForZoom;
  } else {
    const cosH = Math.cos(carHeadingRad);
    const sinH = Math.sin(carHeadingRad);
    const lookAheadM = 4.5;
    offsetXM = cosH * lookAheadM;
    offsetYM = sinH * lookAheadM;
  }

  return {
    pixelsPerMeter,
    screenCenterXCssPx: screenCenterXCssPxOverride,
    screenCenterYCssPx: screenCenterYCssPxOverride,
    offsetXM,
    offsetYM
  };
}
