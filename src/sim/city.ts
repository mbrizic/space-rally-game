import { mulberry32 } from "./rng";

export type Vec2 = { x: number; y: number };

export type Building = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // radians
  type: "store" | "decoration";
  name?: string;
};

export type ParkingSpot = {
  x: number;
  y: number;
  rotation: number; // radians - direction car should face when parked
  buildingIndex: number; // which building this spot serves
};

export type City = {
  centerX: number;
  centerY: number;
  buildings: Building[];
  parkingSpots: ParkingSpot[];
  radius: number;
};

export type RoadsideBuilding = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

const STORE_NAMES = [
  "Gas Station",
  "Repair Shop",
  "Parts Store",
  "Upgrade Shop",
  "Tire Shop",
  "Paint Shop",
];

export function generateCity(
  centerX: number,
  centerY: number,
  seed: number,
  options?: {
    numStores?: number;
    numDecorations?: number;
    radius?: number;
    roadAngle?: number; // angle of road passing through center
  }
): City {
  const rand = mulberry32(seed);
  const numDecorations = options?.numDecorations ?? 10;
  const radius = options?.radius ?? 35;
  const roadAngle = options?.roadAngle ?? 0;

  const buildings: Building[] = [];
  const parkingSpots: ParkingSpot[] = [];

  // Calculate perpendicular direction to road (for blocks)
  const perpAngle = roadAngle + Math.PI / 2;
  
  // City design with CLEAR CORRIDOR for road
  const roadCorridorWidth = 20; // Wide corridor that road passes through (no buildings here!)
  const buildingWidth = 6;
  const buildingDepth = 7;
  const gap = 1.5;
  
  // Create stores on both sides of the corridor
  const storeNames = [...STORE_NAMES].sort(() => rand() - 0.5);
  let storeIndex = 0;
  
  // Left side of road corridor - buildings perpendicular to road, setback from corridor edge
  const leftSetback = roadCorridorWidth / 2 + 2; // 2m gap from corridor edge
  for (let i = 0; i < 3; i++) {
    const alongRoad = (i - 1) * (buildingWidth + gap);
    const x = centerX + Math.cos(roadAngle) * alongRoad - Math.cos(perpAngle) * leftSetback;
    const y = centerY + Math.sin(roadAngle) * alongRoad - Math.sin(perpAngle) * leftSetback;
    
    const buildingIndex = buildings.length;
    buildings.push({
      x,
      y,
      width: buildingWidth,
      height: buildingDepth,
      rotation: roadAngle,
      type: "store",
      name: storeNames[storeIndex % storeNames.length]
    });
    storeIndex++;
    
    // Parking spot between building and corridor
    const parkX = x + Math.cos(perpAngle) * (buildingDepth / 2 + 2);
    const parkY = y + Math.sin(perpAngle) * (buildingDepth / 2 + 2);
    parkingSpots.push({
      x: parkX,
      y: parkY,
      rotation: perpAngle,
      buildingIndex
    });
  }
  
  // Right side of road corridor
  const rightSetback = roadCorridorWidth / 2 + 2;
  for (let i = 0; i < 3; i++) {
    const alongRoad = (i - 1) * (buildingWidth + gap);
    const x = centerX + Math.cos(roadAngle) * alongRoad + Math.cos(perpAngle) * rightSetback;
    const y = centerY + Math.sin(roadAngle) * alongRoad + Math.sin(perpAngle) * rightSetback;
    
    const buildingIndex = buildings.length;
    buildings.push({
      x,
      y,
      width: buildingWidth,
      height: buildingDepth,
      rotation: roadAngle + Math.PI, // Face opposite direction
      type: "store",
      name: storeNames[storeIndex % storeNames.length]
    });
    storeIndex++;
    
    // Parking spot between building and corridor
    const parkX = x - Math.cos(perpAngle) * (buildingDepth / 2 + 2);
    const parkY = y - Math.sin(perpAngle) * (buildingDepth / 2 + 2);
    parkingSpots.push({
      x: parkX,
      y: parkY,
      rotation: perpAngle + Math.PI,
      buildingIndex
    });
  }

  // Add decorative/obstacle buildings OUTSIDE the main corridor area
  // These form the "city blocks" around the main street
  for (let i = 0; i < numDecorations; i++) {
    const side = rand() > 0.5 ? 1 : -1; // left or right of road
    
    // Position along the road, but NOT in the center area
    let alongRoad = (rand() - 0.5) * 50;
    
    // Keep buildings well away from the corridor
    const awayFromRoad = roadCorridorWidth / 2 + 14 + rand() * 12;
    
    const x = centerX + Math.cos(roadAngle) * alongRoad + Math.cos(perpAngle) * awayFromRoad * side;
    const y = centerY + Math.sin(roadAngle) * alongRoad + Math.sin(perpAngle) * awayFromRoad * side;
    
    // Vary sizes but keep them small
    const width = 3 + rand() * 4;
    const height = 3 + rand() * 4;
    
    // Always perpendicular to road (either facing toward or away)
    const rotation = side > 0 ? roadAngle + Math.PI : roadAngle;
    
    buildings.push({
      x,
      y,
      width,
      height,
      rotation,
      type: "decoration"
    });
  }

  return {
    centerX,
    centerY,
    buildings,
    parkingSpots,
    radius
  };
}
