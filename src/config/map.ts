import type { Vector3State } from "../game/state/types";

export interface MapObstacle {
  id: string;
  center: Vector3State;
  width: number;
  height: number;
  depth: number;
  color: string;
}

export interface MapPoint {
  name: string;
  position: Vector3State;
}

export interface TerrainHill {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface RoofRamp {
  id: string;
  centerX: number;
  width: number;
  startZ: number;
  endZ: number;
  bottomY: number;
  topY: number;
}

export interface MapLayout {
  readonly seed: number;
  readonly terrainHills: readonly TerrainHill[];
  readonly obstacles: readonly MapObstacle[];
  readonly roofRamps: readonly RoofRamp[];
  readonly lootSpawnPoints: readonly Vector3State[];
}

export const MAP_SIZE = 800;
export const MAP_HALF_SIZE = MAP_SIZE / 2;
export const TERRAIN_GRID_SUBDIVISIONS = 160;
export const BUILDING_ROOF_CAP_HEIGHT = 0.18;
export const DEFAULT_MAP_SEED = 0;

export const MAP_POINTS: readonly MapPoint[] = [
  { name: "北港", position: { x: -210, y: 0, z: 205 } },
  { name: "灰脊镇", position: { x: 120, y: 0, z: 155 } },
  { name: "旧仓区", position: { x: -155, y: 0, z: -115 } },
  { name: "高地站", position: { x: 190, y: 0, z: -185 } },
];

const BASE_TERRAIN_HILLS: readonly TerrainHill[] = [
  { x: -326, z: -278, radius: 92, height: 13 },
  { x: -286, z: 302, radius: 78, height: 10 },
  { x: -42, z: 330, radius: 96, height: 15 },
  { x: 304, z: 286, radius: 84, height: 12 },
  { x: 328, z: -54, radius: 74, height: 9 },
  { x: 276, z: -310, radius: 100, height: 16 },
  { x: -88, z: -334, radius: 88, height: 11 },
  { x: -336, z: 34, radius: 72, height: 8 },
  { x: 5, z: 35, radius: 94, height: 7 },
];

const LOOT_POINTS_PER_AREA = 18;
const LOOT_OBSTACLE_CLEARANCE = 0.75;
const MAP_LAYOUT_CACHE_LIMIT = 8;
const mapLayoutCache = new Map<number, MapLayout>();
const terrainGridCache = new WeakMap<readonly TerrainHill[], Float32Array>();

export function createMapLayout(seed: number): MapLayout {
  const normalizedSeed = seed >>> 0;
  const cached = mapLayoutCache.get(normalizedSeed);
  if (cached) {
    return cached;
  }

  const terrainRandom = createSeededRandom(normalizedSeed ^ 0x9e3779b9);
  const terrainHills = BASE_TERRAIN_HILLS.map((hill) => ({
    x: round(hill.x + randomBetween(terrainRandom, -12, 12)),
    z: round(hill.z + randomBetween(terrainRandom, -12, 12)),
    radius: round(hill.radius * randomBetween(terrainRandom, 0.92, 1.08)),
    height: round(hill.height * randomBetween(terrainRandom, 0.9, 1.1)),
  }));

  const obstacleRandom = createSeededRandom(normalizedSeed ^ 0x85ebca6b);
  const obstacles = MAP_POINTS.flatMap((point, pointIndex) =>
    Array.from({ length: pointIndex === 1 ? 8 : 6 }, (_, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const width = 18 + ((index + pointIndex) % 3) * 7;
      const depth = 16 + ((index * 2 + pointIndex) % 3) * 8;
      const height = 3.2 + ((index + pointIndex) % 2) * 0.8;
      const x = round(
        point.position.x + (column - 1) * 44 + (row % 2) * 8 + randomBetween(obstacleRandom, -4, 4),
      );
      const z = round(point.position.z + (row - 0.5) * 48 + randomBetween(obstacleRandom, -4, 4));
      const baseY = terrainHeightFromHills(x, z, terrainHills);
      return {
        id: `building-${pointIndex}-${index}`,
        center: {
          x,
          y: round(baseY + height / 2),
          z,
        },
        width,
        height,
        depth,
        color: pointIndex % 2 === 0 ? "#59645b" : "#726955",
      };
    }),
  );

  const roofRamps = obstacles.map((obstacle) => {
    const topY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
    const obstacleIndex = Number(obstacle.id.slice(obstacle.id.lastIndexOf("-") + 1));
    const pointsAwayFromPoiCenter = Math.floor(obstacleIndex / 3) === 0 ? -1 : 1;
    const endZ = obstacle.center.z + pointsAwayFromPoiCenter * (obstacle.depth / 2 + 0.48);
    const length = Math.max(8, obstacle.height * 2.8);
    const startZ = endZ + pointsAwayFromPoiCenter * length;
    return {
      id: `ramp-${obstacle.id}`,
      centerX: obstacle.center.x,
      width: 3.6,
      startZ: round(startZ),
      endZ: round(endZ),
      bottomY: round(terrainHeightFromHills(obstacle.center.x, startZ, terrainHills)),
      topY: round(topY),
    };
  });

  const lootSpawnPoints = createLootSpawnPoints(
    terrainHills,
    obstacles,
    roofRamps,
    createSeededRandom(normalizedSeed ^ 0xc2b2ae35),
  );
  const layout: MapLayout = {
    seed: normalizedSeed,
    terrainHills,
    obstacles,
    roofRamps,
    lootSpawnPoints,
  };
  if (mapLayoutCache.size >= MAP_LAYOUT_CACHE_LIMIT) {
    const oldestSeed = mapLayoutCache.keys().next().value;
    if (oldestSeed !== undefined) mapLayoutCache.delete(oldestSeed);
  }
  mapLayoutCache.set(normalizedSeed, layout);
  return layout;
}

export function getTerrainHeight(x: number, z: number, seedOrLayout: number | MapLayout = DEFAULT_MAP_SEED): number {
  const layout = typeof seedOrLayout === "number" ? createMapLayout(seedOrLayout) : seedOrLayout;
  return terrainHeightFromHills(x, z, layout.terrainHills);
}

export function getRampHeight(ramp: RoofRamp, x: number, z: number): number | null {
  if (
    Math.abs(x - ramp.centerX) > ramp.width / 2 ||
    z < Math.min(ramp.startZ, ramp.endZ) ||
    z > Math.max(ramp.startZ, ramp.endZ)
  ) {
    return null;
  }
  const progress = (z - ramp.startZ) / (ramp.endZ - ramp.startZ);
  return ramp.bottomY + (ramp.topY - ramp.bottomY) * progress;
}

const DEFAULT_MAP_LAYOUT = createMapLayout(DEFAULT_MAP_SEED);

export const TERRAIN_HILLS: readonly TerrainHill[] = DEFAULT_MAP_LAYOUT.terrainHills;
export const MAP_OBSTACLES: readonly MapObstacle[] = DEFAULT_MAP_LAYOUT.obstacles;
export const MAP_ROOF_RAMPS: readonly RoofRamp[] = DEFAULT_MAP_LAYOUT.roofRamps;
export const LOOT_SPAWN_POINTS: readonly Vector3State[] = DEFAULT_MAP_LAYOUT.lootSpawnPoints;

export const BOT_SPAWN_POINTS: readonly Vector3State[] = Array.from({ length: 19 }, (_, index) => {
  const angle = (index / 19) * Math.PI * 2;
  const radius = 190 + (index % 4) * 35;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return { x, y: getTerrainHeight(x, z) + 1.76, z };
});

function createLootSpawnPoints(
  terrainHills: readonly TerrainHill[],
  obstacles: readonly MapObstacle[],
  roofRamps: readonly RoofRamp[],
  random: () => number,
): Vector3State[] {
  return MAP_POINTS.flatMap((point) => {
    const selected: Vector3State[] = [];
    for (let candidateIndex = 0; candidateIndex < LOOT_POINTS_PER_AREA * 6; candidateIndex += 1) {
      const slot = candidateIndex % LOOT_POINTS_PER_AREA;
      const attempt = Math.floor(candidateIndex / LOOT_POINTS_PER_AREA);
      const angle =
        (slot / LOOT_POINTS_PER_AREA) * Math.PI * 2 +
        attempt * 0.13 +
        randomBetween(random, -0.09, 0.09);
      const radius = 24 + (slot % 4) * 14 + attempt * 3 + randomBetween(random, -4, 4);
      const x = round(point.position.x + Math.cos(angle) * radius);
      const z = round(point.position.z + Math.sin(angle) * radius);
      const candidate = {
        x,
        y: round(terrainHeightFromHills(x, z, terrainHills) + 0.45),
        z,
      };
      const isClear =
        obstacles.every((obstacle) => !pointInsideObstacle(candidate, obstacle, LOOT_OBSTACLE_CLEARANCE)) &&
        roofRamps.every((ramp) => !pointInsideRamp(candidate, ramp, LOOT_OBSTACLE_CLEARANCE)) &&
        selected.every((spawnPoint) => Math.hypot(spawnPoint.x - x, spawnPoint.z - z) >= 6);
      if (isClear) {
        selected.push(candidate);
        if (selected.length === LOOT_POINTS_PER_AREA) {
          break;
        }
      }
    }
    if (selected.length < LOOT_POINTS_PER_AREA) {
      throw new Error(`Not enough clear loot spawn points around ${point.name}`);
    }
    return selected;
  });
}

function terrainHeightFromHills(x: number, z: number, hills: readonly TerrainHill[]): number {
  if (Math.abs(x) > MAP_HALF_SIZE || Math.abs(z) > MAP_HALF_SIZE) return 0;
  const cellSize = MAP_SIZE / TERRAIN_GRID_SUBDIVISIONS;
  const xIndex = Math.min(TERRAIN_GRID_SUBDIVISIONS - 1, Math.floor((x + MAP_HALF_SIZE) / cellSize));
  const zIndex = Math.min(TERRAIN_GRID_SUBDIVISIONS - 1, Math.floor((z + MAP_HALF_SIZE) / cellSize));
  const xProgress = (x + MAP_HALF_SIZE) / cellSize - xIndex;
  const zProgress = (z + MAP_HALF_SIZE) / cellSize - zIndex;
  const rowSize = TERRAIN_GRID_SUBDIVISIONS + 1;
  const heights = getTerrainGrid(hills);
  const bottomLeft = heights[zIndex * rowSize + xIndex] ?? 0;
  const bottomRight = heights[zIndex * rowSize + xIndex + 1] ?? 0;
  const topLeft = heights[(zIndex + 1) * rowSize + xIndex] ?? 0;
  const topRight = heights[(zIndex + 1) * rowSize + xIndex + 1] ?? 0;
  if (xProgress + zProgress <= 1) {
    return bottomLeft * (1 - xProgress - zProgress) + bottomRight * xProgress + topLeft * zProgress;
  }
  return topLeft * (1 - xProgress) + topRight * (xProgress + zProgress - 1) + bottomRight * (1 - zProgress);
}

function getTerrainGrid(hills: readonly TerrainHill[]): Float32Array {
  const cached = terrainGridCache.get(hills);
  if (cached) return cached;
  const rowSize = TERRAIN_GRID_SUBDIVISIONS + 1;
  const cellSize = MAP_SIZE / TERRAIN_GRID_SUBDIVISIONS;
  const heights = new Float32Array(rowSize * rowSize);
  for (let zIndex = 0; zIndex < rowSize; zIndex += 1) {
    for (let xIndex = 0; xIndex < rowSize; xIndex += 1) {
      heights[zIndex * rowSize + xIndex] = smoothTerrainHeightFromHills(
        -MAP_HALF_SIZE + xIndex * cellSize,
        -MAP_HALF_SIZE + zIndex * cellSize,
        hills,
      );
    }
  }
  terrainGridCache.set(hills, heights);
  return heights;
}

function smoothTerrainHeightFromHills(x: number, z: number, hills: readonly TerrainHill[]): number {
  let height = 0;
  for (const hill of hills) {
    const distance = Math.hypot(x - hill.x, z - hill.z);
    if (distance >= hill.radius) continue;
    const normalized = 1 - distance / hill.radius;
    const smooth = normalized * normalized * (3 - 2 * normalized);
    height = Math.max(height, hill.height * smooth);
  }
  return height;
}

function pointInsideObstacle(point: Vector3State, obstacle: MapObstacle, clearance: number): boolean {
  return (
    point.x >= obstacle.center.x - obstacle.width / 2 - clearance &&
    point.x <= obstacle.center.x + obstacle.width / 2 + clearance &&
    point.z >= obstacle.center.z - obstacle.depth / 2 - clearance &&
    point.z <= obstacle.center.z + obstacle.depth / 2 + clearance
  );
}

function pointInsideRamp(point: Vector3State, ramp: RoofRamp, clearance: number): boolean {
  return (
    Math.abs(point.x - ramp.centerX) <= ramp.width / 2 + clearance &&
    point.z >= Math.min(ramp.startZ, ramp.endZ) - clearance &&
    point.z <= Math.max(ramp.startZ, ramp.endZ) + clearance
  );
}

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random();
}

function round(value: number): number {
  const result = Math.round(value * 1_000) / 1_000;
  return Object.is(result, -0) ? 0 : result;
}
