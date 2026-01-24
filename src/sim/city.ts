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
  }
): City {
  const rand = mulberry32(seed);
  const numStores = options?.numStores ?? 4;
  const numDecorations = options?.numDecorations ?? 6;
  const radius = options?.radius ?? 35;

  const buildings: Building[] = [];
  const parkingSpots: ParkingSpot[] = [];

  // Generate stores in a rough circle around the center
  const storeNames = [...STORE_NAMES].sort(() => rand() - 0.5).slice(0, numStores);
  
  for (let i = 0; i < numStores; i++) {
    const angle = (i / numStores) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const distance = radius * 0.6 + (rand() - 0.5) * radius * 0.2;
    
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    
    // Store buildings are larger
    const width = 8 + rand() * 4;
    const height = 6 + rand() * 3;
    const rotation = angle + Math.PI / 2 + (rand() - 0.5) * 0.3;
    
    const buildingIndex = buildings.length;
    buildings.push({
      x,
      y,
      width,
      height,
      rotation,
      type: "store",
      name: storeNames[i]
    });

    // Add 1-2 parking spots in front of each store
    const numSpots = 1 + Math.floor(rand() * 2);
    for (let j = 0; j < numSpots; j++) {
      // Place parking spots in front of the building
      const spotDistance = 10 + j * 4;
      const spotAngle = rotation;
      const spotX = x + Math.cos(spotAngle) * spotDistance;
      const spotY = y + Math.sin(spotAngle) * spotDistance;
      
      parkingSpots.push({
        x: spotX,
        y: spotY,
        rotation: spotAngle,
        buildingIndex
      });
    }
  }

  // Add decorative buildings
  for (let i = 0; i < numDecorations; i++) {
    const angle = rand() * Math.PI * 2;
    const distance = (rand() * 0.5 + 0.3) * radius;
    
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    
    // Smaller decorative buildings
    const width = 4 + rand() * 4;
    const height = 3 + rand() * 3;
    const rotation = rand() * Math.PI * 2;
    
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
