/**
 * Visual rendering styles for tracks
 */

export type RenderStyle = "clean" | "realistic" | "day" | "night";

export interface StyleConfig {
  // Background
  bgColor: string;
  gridAlpha: number;
  
  // Track colors
  shoulderColor: (surfaceStyle: string) => string;
  roadColor: (surfaceStyle: string) => string;
  edgeColor: string;
  centerlineColor: string;
  
  // Effects
  addNoiseTexture?: boolean;
  tireMark?: boolean;
  ambientLight?: number; // 0-1, for night mode
  
  // Particles
  particleBrightness: number; // multiplier
}

export const STYLE_CONFIGS: Record<RenderStyle, StyleConfig> = {
  clean: {
    bgColor: "rgba(15, 20, 25, 1)",
    gridAlpha: 0.08,
    shoulderColor: (surfaceStyle) => surfaceStyle,
    roadColor: (surfaceStyle) => surfaceStyle,
    edgeColor: "rgba(255, 255, 255, 0.15)",
    centerlineColor: "rgba(255, 255, 255, 0.20)",
    particleBrightness: 1.0,
  },
  
  realistic: {
    bgColor: "rgba(30, 35, 30, 1)",
    gridAlpha: 0,
    shoulderColor: (surfaceStyle) => {
      // Darker, more muted shoulders
      if (surfaceStyle.includes("70,75,85")) return "rgba(40, 45, 50, 0.5)"; // tarmac
      if (surfaceStyle.includes("180,155,110")) return "rgba(120, 100, 70, 0.5)"; // gravel
      if (surfaceStyle.includes("140,100,70")) return "rgba(90, 65, 45, 0.5)"; // dirt
      if (surfaceStyle.includes("180,220,245")) return "rgba(140, 180, 200, 0.5)"; // ice
      return "rgba(60, 80, 55, 0.4)";
    },
    roadColor: (surfaceStyle) => {
      // More saturated, realistic colors
      if (surfaceStyle.includes("70,75,85")) return "rgba(45, 48, 52, 0.95)"; // darker tarmac
      if (surfaceStyle.includes("180,155,110")) return "rgba(160, 135, 95, 0.8)"; // sandy gravel
      if (surfaceStyle.includes("140,100,70")) return "rgba(120, 85, 60, 0.85)"; // brown dirt
      if (surfaceStyle.includes("180,220,245")) return "rgba(200, 230, 250, 0.6)"; // light ice
      return surfaceStyle;
    },
    edgeColor: "rgba(200, 200, 180, 0.25)",
    centerlineColor: "rgba(240, 240, 200, 0.35)",
    addNoiseTexture: true,
    tireMark: true,
    particleBrightness: 0.85,
  },
  
  day: {
    bgColor: "rgba(135, 180, 120, 1)", // Grass/field green
    gridAlpha: 0,
    shoulderColor: (surfaceStyle) => {
      // Bright, sunny shoulder colors
      if (surfaceStyle.includes("70,75,85")) return "rgba(90, 95, 100, 0.6)";
      if (surfaceStyle.includes("180,155,110")) return "rgba(200, 170, 120, 0.6)";
      if (surfaceStyle.includes("140,100,70")) return "rgba(160, 115, 80, 0.6)";
      if (surfaceStyle.includes("180,220,245")) return "rgba(190, 230, 255, 0.6)";
      return "rgba(120, 150, 100, 0.5)";
    },
    roadColor: (surfaceStyle) => {
      // Bright daylight colors
      if (surfaceStyle.includes("70,75,85")) return "rgba(80, 85, 95, 0.9)";
      if (surfaceStyle.includes("180,155,110")) return "rgba(190, 165, 120, 0.85)";
      if (surfaceStyle.includes("140,100,70")) return "rgba(150, 110, 80, 0.9)";
      if (surfaceStyle.includes("180,220,245")) return "rgba(210, 240, 255, 0.7)";
      return surfaceStyle;
    },
    edgeColor: "rgba(255, 255, 255, 0.5)", // Brighter edges in daylight
    centerlineColor: "rgba(255, 255, 220, 0.6)",
    particleBrightness: 1.2,
  },
  
  night: {
    bgColor: "rgba(5, 8, 15, 1)", // Very dark
    gridAlpha: 0.03,
    shoulderColor: () => {
      // Very dark shoulders, barely visible
      return "rgba(20, 25, 30, 0.3)";
    },
    roadColor: (surfaceStyle) => {
      // Muted, dark road colors
      if (surfaceStyle.includes("70,75,85")) return "rgba(25, 30, 35, 0.9)";
      if (surfaceStyle.includes("180,155,110")) return "rgba(60, 50, 40, 0.8)";
      if (surfaceStyle.includes("140,100,70")) return "rgba(45, 35, 25, 0.85)";
      if (surfaceStyle.includes("180,220,245")) return "rgba(40, 60, 75, 0.7)";
      return "rgba(20, 25, 30, 0.8)";
    },
    edgeColor: "rgba(200, 200, 180, 0.4)", // Reflective edges
    centerlineColor: "rgba(220, 220, 180, 0.45)", // Reflective centerline
    ambientLight: 0.15,
    particleBrightness: 0.7,
  },
};

export function getRandomRenderStyle(seed: number): RenderStyle {
  const styles: RenderStyle[] = ["clean", "realistic", "day", "night"];
  const rng = mulberry32(seed + 9999); // Offset seed for style selection
  const index = Math.floor(rng() * styles.length);
  return styles[index];
}

// Import RNG for style selection
function mulberry32(seed: number) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
