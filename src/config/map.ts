import type { Vector3State } from "../game/state/types";

export interface MapObstacle {
  id: string;
  center: Vector3State;
  width: number;
  height: number;
  depth: number;
  color: string;
}

export interface MapWallSegment extends MapObstacle {
  obstacleId: string;
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
  readonly mapPoints: readonly MapPoint[];
  readonly landingZones: readonly MapPoint[];
  readonly terrainHills: readonly TerrainHill[];
  readonly obstacles: readonly MapObstacle[];
  readonly wallSegments: readonly MapWallSegment[];
  readonly roofRamps: readonly RoofRamp[];
  readonly lootSpawnPoints: readonly Vector3State[];
  readonly lootZoneCounts: readonly number[];
}

export const MAP_SIZE = 2_400;
export const MAP_HALF_SIZE = MAP_SIZE / 2;
export const TERRAIN_GRID_SUBDIVISIONS = 200;
export const BUILDING_ROOF_CAP_HEIGHT = 0.18;
export const DEFAULT_MAP_SEED = 0;

export const MAP_POINT_COUNT = 8;
export const LANDING_ZONE_COUNT = 16;
export const TOTAL_LOOT_POINTS = 240;
const POI_NAMES = ["北港", "灰脊镇", "旧仓区", "高地站", "南岸村", "雷达哨", "西风农场", "东岭营地"] as const;
const WILDERNESS_NAMES = ["林间屋", "路边村", "山脚农舍", "旧哨所", "河谷牧场", "废弃院落", "边境仓房", "丘间小屋"] as const;

interface BuildingArea extends MapPoint {
  minimumBuildings: number;
  maximumBuildings: number;
  minimumRadius: number;
  maximumRadius: number;
  major: boolean;
}

const BASE_TERRAIN_HILLS: readonly TerrainHill[] = [
  { x: -984, z: -860, radius: 252, height: 13 },
  { x: -880, z: 924, radius: 224, height: 10 },
  { x: -140, z: 1_012, radius: 268, height: 15 },
  { x: 932, z: 860, radius: 240, height: 12 },
  { x: 1_020, z: -164, radius: 216, height: 9 },
  { x: 840, z: -948, radius: 280, height: 16 },
  { x: -260, z: -1_012, radius: 244, height: 11 },
  { x: -1_032, z: 104, radius: 212, height: 8 },
  { x: 16, z: 70, radius: 256, height: 7 },
  { x: 380, z: 984, radius: 236, height: 10 },
  { x: -1_050, z: -260, radius: 204, height: 9 },
  { x: 192, z: -784, radius: 230, height: 12 },
];

const INDOOR_LOOT_POINTS_PER_ZONE = 1;
const LOOT_OBSTACLE_CLEARANCE = 0.75;
const BUILDING_WALL_THICKNESS = 0.35;
const MAP_GEOMETRY_MARGIN = 1;
const BUILDING_GROUND_EMBED = 0.1;
const MINIMUM_INTERIOR_CLEARANCE = 2.4;
const RAMP_TERRAIN_EPSILON = 0.08;
const MINIMUM_BUILDING_DISTANCE_FROM_POI = 58;
const MAJOR_POINT_MINIMUM_DISTANCE = 420;
const LANDING_ZONE_MINIMUM_DISTANCE = 300;
const POINT_MAP_MARGIN = 210;
const MOUNTAIN_COUNT = 16;
const COVERAGE_COMPOUND_COUNT = 20;
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
  const terrainHills = [
    ...BASE_TERRAIN_HILLS.map((hill) => ({
      x: round(hill.x + randomBetween(terrainRandom, -18, 18)),
      z: round(hill.z + randomBetween(terrainRandom, -18, 18)),
      radius: round(hill.radius * randomBetween(terrainRandom, 0.9, 1.1)),
      height: round(hill.height * randomBetween(terrainRandom, 0.88, 1.12)),
    })),
    ...Array.from({ length: 20 }, () => ({
      x: round(randomBetween(terrainRandom, -1_080, 1_080)),
      z: round(randomBetween(terrainRandom, -1_080, 1_080)),
      radius: round(randomBetween(terrainRandom, 72, 190)),
      height: round(randomBetween(terrainRandom, 1.5, 5.5)),
    })),
    ...createCoverageMountains(terrainRandom),
  ];

  const pointRandom = createSeededRandom(normalizedSeed ^ 0x27d4eb2f);
  const mapPoints = createSeededMapPoints(
    POI_NAMES,
    pointRandom,
    [],
    MAJOR_POINT_MINIMUM_DISTANCE,
    terrainHills,
  );
  const wildernessPoints = createSeededMapPoints(
    WILDERNESS_NAMES,
    pointRandom,
    mapPoints,
    LANDING_ZONE_MINIMUM_DISTANCE,
    terrainHills,
    true,
  );
  const landingZones = [...mapPoints, ...wildernessPoints];
  const coveragePoints = createSeededMapPoints(
    Array.from({ length: COVERAGE_COMPOUND_COUNT }, (_, index) => `路边院落 ${index + 1}`),
    pointRandom,
    landingZones,
    180,
    terrainHills,
    true,
  );
  const buildingAreas = createBuildingAreas(mapPoints, wildernessPoints, coveragePoints);
  const obstacleRandom = createSeededRandom(normalizedSeed ^ 0x85ebca6b);
  const obstacles = createSeededBuildings(terrainHills, buildingAreas, obstacleRandom);
  const wallSegments = createWallSegments(obstacles);

  const roofRamps = obstacles.map((obstacle) => {
    const pointIndex = Number(obstacle.id.split("-")[1]);
    const poi = buildingAreas[pointIndex] ?? buildingAreas[0];
    return createRoofRamp(obstacle, poi as MapPoint, terrainHills);
  });

  const { points: lootSpawnPoints, counts: lootZoneCounts } = createLootSpawnPoints(
    landingZones,
    terrainHills,
    obstacles,
    wallSegments,
    roofRamps,
    createSeededRandom(normalizedSeed ^ 0xc2b2ae35),
  );
  const layout: MapLayout = {
    seed: normalizedSeed,
    mapPoints,
    landingZones,
    terrainHills,
    obstacles,
    wallSegments,
    roofRamps,
    lootSpawnPoints,
    lootZoneCounts,
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

export function createMapRoadSegments(
  points: readonly MapPoint[],
): ReadonlyArray<readonly [number, number, number, number]> {
  const segments = new Map<string, readonly [number, number, number, number]>();
  const addSegment = (leftIndex: number, rightIndex: number): void => {
    const left = points[leftIndex];
    const right = points[rightIndex];
    if (!left || !right) return;
    const first = Math.min(leftIndex, rightIndex);
    const second = Math.max(leftIndex, rightIndex);
    segments.set(`${first}:${second}`, [
      left.position.x,
      left.position.z,
      right.position.x,
      right.position.z,
    ]);
  };

  if (points.length > 0) {
    const connected = new Set<number>([0]);
    while (connected.size < points.length) {
      let bestLeft = -1;
      let bestRight = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const leftIndex of connected) {
        const left = points[leftIndex];
        if (!left) continue;
        for (let rightIndex = 0; rightIndex < points.length; rightIndex += 1) {
          if (connected.has(rightIndex)) continue;
          const right = points[rightIndex];
          if (!right) continue;
          const distance = Math.hypot(
            left.position.x - right.position.x,
            left.position.z - right.position.z,
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            bestLeft = leftIndex;
            bestRight = rightIndex;
          }
        }
      }
      if (bestRight < 0) break;
      addSegment(bestLeft, bestRight);
      connected.add(bestRight);
    }
  }

  points.forEach((point, pointIndex) => {
    const nearest = points
      .map((candidate, candidateIndex) => ({
        candidate,
        candidateIndex,
        distance: Math.hypot(
          point.position.x - candidate.position.x,
          point.position.z - candidate.position.z,
        ),
      }))
      .filter((entry) => entry.candidateIndex !== pointIndex)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2);
    for (const entry of nearest) {
      addSegment(pointIndex, entry.candidateIndex);
    }
  });
  return [...segments.values()];
}

const DEFAULT_MAP_LAYOUT = createMapLayout(DEFAULT_MAP_SEED);

export const TERRAIN_HILLS: readonly TerrainHill[] = DEFAULT_MAP_LAYOUT.terrainHills;
export const MAP_OBSTACLES: readonly MapObstacle[] = DEFAULT_MAP_LAYOUT.obstacles;
export const MAP_WALL_SEGMENTS: readonly MapWallSegment[] = DEFAULT_MAP_LAYOUT.wallSegments;
export const MAP_ROOF_RAMPS: readonly RoofRamp[] = DEFAULT_MAP_LAYOUT.roofRamps;
export const LOOT_SPAWN_POINTS: readonly Vector3State[] = DEFAULT_MAP_LAYOUT.lootSpawnPoints;
export const MAP_POINTS: readonly MapPoint[] = DEFAULT_MAP_LAYOUT.mapPoints;
export const LANDING_ZONES: readonly MapPoint[] = DEFAULT_MAP_LAYOUT.landingZones;

export const BOT_SPAWN_POINTS: readonly Vector3State[] = Array.from({ length: 49 }, (_, index) => {
  const angle = (index / 49) * Math.PI * 2;
  const radius = 380 + (index % 4) * 70;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return { x, y: getTerrainHeight(x, z) + 1.76, z };
});

function createSeededMapPoints(
  names: readonly string[],
  random: () => number,
  existing: readonly MapPoint[],
  minimumDistance: number,
  terrainHills: readonly TerrainHill[],
  maximizeCoverage = false,
): MapPoint[] {
  const selected: MapPoint[] = [];
  const limit = MAP_HALF_SIZE - POINT_MAP_MARGIN;
  if (maximizeCoverage) {
    while (selected.length < names.length) {
      let bestPosition: Vector3State | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let sample = 0; sample < 480; sample += 1) {
        const candidate = {
          x: round(randomBetween(random, -limit, limit)),
          y: 0,
          z: round(randomBetween(random, -limit, limit)),
        };
        if (!isBuildableMapPoint(candidate, terrainHills)) continue;
        const nearestDistance = [...existing, ...selected].reduce(
          (nearest, point) => Math.min(
            nearest,
            Math.hypot(candidate.x - point.position.x, candidate.z - point.position.z),
          ),
          Number.POSITIVE_INFINITY,
        );
        if (nearestDistance < minimumDistance) continue;
        const score = nearestDistance * randomBetween(random, 0.88, 1);
        if (score > bestScore) {
          bestScore = score;
          bestPosition = candidate;
        }
      }
      if (!bestPosition) {
        for (let sample = 0; sample < 1_000; sample += 1) {
          const candidate = {
            x: round(randomBetween(random, -limit, limit)),
            y: 0,
            z: round(randomBetween(random, -limit, limit)),
          };
          if (!isBuildableMapPoint(candidate, terrainHills)) continue;
          const nearestDistance = [...existing, ...selected].reduce(
            (nearest, point) => Math.min(
              nearest,
              Math.hypot(candidate.x - point.position.x, candidate.z - point.position.z),
            ),
            Number.POSITIVE_INFINITY,
          );
          if (nearestDistance > bestScore) {
            bestScore = nearestDistance;
            bestPosition = candidate;
          }
        }
      }
      if (!bestPosition) throw new Error("Not enough buildable coverage points");
      selected.push({ name: names[selected.length] ?? `区域 ${selected.length + 1}`, position: bestPosition });
    }
    return selected;
  }
  for (let attempt = 0; attempt < names.length * 4_000 && selected.length < names.length; attempt += 1) {
    const candidate = {
      x: round(randomBetween(random, -limit, limit)),
      y: 0,
      z: round(randomBetween(random, -limit, limit)),
    };
    if (!isBuildableMapPoint(candidate, terrainHills)) continue;
    if ([...existing, ...selected].some((point) =>
      Math.hypot(candidate.x - point.position.x, candidate.z - point.position.z) < minimumDistance
    )) {
      continue;
    }
    selected.push({ name: names[selected.length] ?? `区域 ${selected.length + 1}`, position: candidate });
  }
  if (selected.length !== names.length) throw new Error("Not enough irregular map points");
  return selected;
}

function createCoverageMountains(random: () => number): TerrainHill[] {
  const mountains: TerrainHill[] = [];
  for (let mountainIndex = 0; mountainIndex < MOUNTAIN_COUNT; mountainIndex += 1) {
    let best: TerrainHill | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let sample = 0; sample < 1_000; sample += 1) {
      const candidate = {
        x: round(randomBetween(random, -1_020, 1_020)),
        z: round(randomBetween(random, -1_020, 1_020)),
        radius: round(randomBetween(random, 210, 330)),
        height: round(randomBetween(random, 24, 42)),
      };
      const nearestDistance = mountains.length === 0
        ? Math.hypot(candidate.x, candidate.z) + randomBetween(random, 0, 500)
        : Math.min(...mountains.map((mountain) =>
            Math.hypot(candidate.x - mountain.x, candidate.z - mountain.z) - mountain.radius
          ));
      const edgeBonus = Math.min(180, Math.max(Math.abs(candidate.x), Math.abs(candidate.z)) * 0.08);
      const score = nearestDistance + edgeBonus + randomBetween(random, 0, 35);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) mountains.push(best);
  }
  return mountains;
}

function isBuildableMapPoint(point: Vector3State, terrainHills: readonly TerrainHill[]): boolean {
  const heights = [-75, 0, 75].flatMap((offsetX) =>
    [-75, 0, 75].map((offsetZ) => terrainHeightFromHills(point.x + offsetX, point.z + offsetZ, terrainHills))
  );
  return Math.max(...heights) <= 8 && Math.max(...heights) - Math.min(...heights) <= 4;
}

function createBuildingAreas(
  mapPoints: readonly MapPoint[],
  wildernessPoints: readonly MapPoint[],
  coveragePoints: readonly MapPoint[],
): BuildingArea[] {
  return [
    ...mapPoints.map((point) => ({
      ...point,
      minimumBuildings: 8,
      maximumBuildings: 12,
      minimumRadius: MINIMUM_BUILDING_DISTANCE_FROM_POI,
      maximumRadius: 300,
      major: true,
    })),
    ...wildernessPoints.map((point) => ({
      ...point,
      minimumBuildings: 4,
      maximumBuildings: 7,
      minimumRadius: 14,
      maximumRadius: 180,
      major: false,
    })),
    ...coveragePoints.map((point) => ({
      ...point,
      minimumBuildings: 2,
      maximumBuildings: 3,
      minimumRadius: 12,
      maximumRadius: 90,
      major: false,
    })),
  ];
}

function createSeededBuildings(
  terrainHills: readonly TerrainHill[],
  buildingAreas: readonly BuildingArea[],
  random: () => number,
): MapObstacle[] {
  const allSelected: MapObstacle[] = [];
  return buildingAreas.flatMap((point, pointIndex) => {
    const targetCount = point.minimumBuildings + Math.floor(random() * (point.maximumBuildings - point.minimumBuildings + 1));
    const selected: MapObstacle[] = [];
    for (let attempt = 0; attempt < targetCount * 500 && selected.length < targetCount; attempt += 1) {
      const width = round(randomBetween(random, 18, 34));
      const depth = round(randomBetween(random, 16, 33));
      const height = round(randomBetween(random, 3.2, 4.4));
      const angle = random() * Math.PI * 2;
      const minimumRadius = point.minimumRadius;
      const maximumRadius = point.maximumRadius;
      const radius = Math.sqrt(randomBetween(random, minimumRadius ** 2, maximumRadius ** 2));
      const x = round(point.position.x + Math.cos(angle) * radius + randomBetween(random, -10, 10));
      const z = round(point.position.z + Math.sin(angle) * radius + randomBetween(random, -10, 10));
      if (!footprintInsideMap(x, z, width, depth)) continue;
      const terrainRange = getFootprintTerrainRange(x, z, width, depth, terrainHills);
      if (terrainRange.maximum - terrainRange.minimum > height - MINIMUM_INTERIOR_CLEARANCE) continue;
      const baseY = terrainRange.minimum - BUILDING_GROUND_EMBED;
      const candidate: MapObstacle = {
        id: `building-${pointIndex}-${selected.length}`,
        center: { x, y: round(baseY + height / 2), z },
        width,
        height,
        depth,
        color: pointIndex % 2 === 0 ? "#59645b" : "#726955",
      };
      const candidateRamp = createRoofRamp(candidate, point, terrainHills);
      if (!rampInsideMap(candidateRamp) || !rampClearsTerrain(candidateRamp, terrainHills)) continue;
      if (
        allSelected.every((existing) =>
          !buildingsOverlap(candidate, existing, 10) &&
          !rampIntersectsBuilding(candidateRamp, existing, 1) &&
          !rampIntersectsBuilding(
            createRoofRamp(existing, buildingAreas[Number(existing.id.split("-")[1])] ?? point, terrainHills),
            candidate,
            1,
          ),
        )
      ) {
        selected.push(candidate);
        allSelected.push(candidate);
      }
    }
    if (selected.length < point.minimumBuildings) throw new Error(`Not enough clear buildings around ${point.name}`);
    return selected;
  });
}

function buildingsOverlap(left: MapObstacle, right: MapObstacle, padding: number): boolean {
  return (
    Math.abs(left.center.x - right.center.x) < (left.width + right.width) / 2 + padding &&
    Math.abs(left.center.z - right.center.z) < (left.depth + right.depth) / 2 + padding
  );
}

function createRoofRamp(
  obstacle: MapObstacle,
  poi: MapPoint,
  terrainHills: readonly TerrainHill[],
): RoofRamp {
  const preferredDirection = obstacle.center.z >= poi.position.z ? 1 : -1;
  const preferred = createRoofRampInDirection(obstacle, preferredDirection, terrainHills);
  if (rampInsideMap(preferred) && rampClearsTerrain(preferred, terrainHills)) return preferred;
  const opposite = createRoofRampInDirection(obstacle, -preferredDirection, terrainHills);
  return rampInsideMap(opposite) && rampClearsTerrain(opposite, terrainHills) ? opposite : preferred;
}

function createRoofRampInDirection(
  obstacle: MapObstacle,
  direction: number,
  terrainHills: readonly TerrainHill[],
): RoofRamp {
  const endZ = obstacle.center.z + direction * (obstacle.depth / 2 + 0.48);
  const startZ = endZ + direction * Math.max(8, obstacle.height * 2.8);
  return {
    id: `ramp-${obstacle.id}`,
    centerX: obstacle.center.x,
    width: 3.6,
    startZ: round(startZ),
    endZ: round(endZ),
    bottomY: round(terrainHeightFromHills(obstacle.center.x, startZ, terrainHills)),
    topY: round(obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT),
  };
}

function rampIntersectsBuilding(ramp: RoofRamp, obstacle: MapObstacle, padding: number): boolean {
  const rampMinimumZ = Math.min(ramp.startZ, ramp.endZ) - padding;
  const rampMaximumZ = Math.max(ramp.startZ, ramp.endZ) + padding;
  return (
    Math.abs(ramp.centerX - obstacle.center.x) < ramp.width / 2 + obstacle.width / 2 + padding &&
    rampMaximumZ > obstacle.center.z - obstacle.depth / 2 - padding &&
    rampMinimumZ < obstacle.center.z + obstacle.depth / 2 + padding
  );
}

function footprintInsideMap(x: number, z: number, width: number, depth: number): boolean {
  const limit = MAP_HALF_SIZE - MAP_GEOMETRY_MARGIN;
  return Math.abs(x) + width / 2 <= limit && Math.abs(z) + depth / 2 <= limit;
}

function rampInsideMap(ramp: RoofRamp): boolean {
  const limit = MAP_HALF_SIZE - MAP_GEOMETRY_MARGIN;
  return (
    Math.abs(ramp.centerX) + ramp.width / 2 <= limit &&
    Math.abs(ramp.startZ) <= limit &&
    Math.abs(ramp.endZ) <= limit
  );
}

function rampClearsTerrain(ramp: RoofRamp, terrainHills: readonly TerrainHill[]): boolean {
  const horizontalLength = Math.abs(ramp.endZ - ramp.startZ);
  const sampleCount = Math.max(8, Math.ceil(horizontalLength * 2));
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const progress = sample / sampleCount;
    const z = ramp.startZ + (ramp.endZ - ramp.startZ) * progress;
    const rampY = ramp.bottomY + (ramp.topY - ramp.bottomY) * progress;
    for (const x of [ramp.centerX - ramp.width / 2, ramp.centerX, ramp.centerX + ramp.width / 2]) {
      if (terrainHeightFromHills(x, z, terrainHills) > rampY + RAMP_TERRAIN_EPSILON) return false;
    }
  }
  return true;
}

function getFootprintTerrainRange(
  x: number,
  z: number,
  width: number,
  depth: number,
  terrainHills: readonly TerrainHill[],
): { minimum: number; maximum: number } {
  const xs = terrainSampleCoordinates(x - width / 2, x + width / 2);
  const zs = terrainSampleCoordinates(z - depth / 2, z + depth / 2);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const sampleX of xs) {
    for (const sampleZ of zs) {
      const height = terrainHeightFromHills(sampleX, sampleZ, terrainHills);
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }
  return { minimum, maximum };
}

function terrainSampleCoordinates(minimum: number, maximum: number): number[] {
  const cellSize = MAP_SIZE / TERRAIN_GRID_SUBDIVISIONS;
  const coordinates = [minimum, maximum];
  const firstGridIndex = Math.ceil((minimum + MAP_HALF_SIZE) / cellSize);
  const lastGridIndex = Math.floor((maximum + MAP_HALF_SIZE) / cellSize);
  for (let index = firstGridIndex; index <= lastGridIndex; index += 1) {
    coordinates.push(-MAP_HALF_SIZE + index * cellSize);
  }
  return coordinates;
}

function createWallSegments(obstacles: readonly MapObstacle[]): MapWallSegment[] {
  return obstacles.flatMap((obstacle) => {
    const doorWidth = Math.min(4.2, obstacle.width * 0.34);
    const windowWidth = Math.min(3.6, obstacle.width * 0.3);
    const sideOpeningDepth = Math.min(5.2, obstacle.depth * 0.34);
    const wallHeight = obstacle.height;
    const sideDepth = Math.max(1, (obstacle.depth - sideOpeningDepth) / 2);
    const frontWidth = Math.max(1, (obstacle.width - doorWidth) / 2);
    const backWidth = Math.max(1, (obstacle.width - windowWidth) / 2);
    const frontZ = obstacle.center.z - obstacle.depth / 2 + BUILDING_WALL_THICKNESS / 2;
    const backZ = obstacle.center.z + obstacle.depth / 2 - BUILDING_WALL_THICKNESS / 2;
    const leftX = obstacle.center.x - obstacle.width / 2 + BUILDING_WALL_THICKNESS / 2;
    const rightX = obstacle.center.x + obstacle.width / 2 - BUILDING_WALL_THICKNESS / 2;
    return [
      wallSegment(obstacle, "front-left", obstacle.center.x - doorWidth / 2 - frontWidth / 2, frontZ, frontWidth, BUILDING_WALL_THICKNESS, wallHeight),
      wallSegment(obstacle, "front-right", obstacle.center.x + doorWidth / 2 + frontWidth / 2, frontZ, frontWidth, BUILDING_WALL_THICKNESS, wallHeight),
      wallSegment(obstacle, "back-left", obstacle.center.x - windowWidth / 2 - backWidth / 2, backZ, backWidth, BUILDING_WALL_THICKNESS, wallHeight),
      wallSegment(obstacle, "back-right", obstacle.center.x + windowWidth / 2 + backWidth / 2, backZ, backWidth, BUILDING_WALL_THICKNESS, wallHeight),
      wallSegment(obstacle, "left-front", leftX, obstacle.center.z - sideOpeningDepth / 2 - sideDepth / 2, BUILDING_WALL_THICKNESS, sideDepth, wallHeight),
      wallSegment(obstacle, "left-back", leftX, obstacle.center.z + sideOpeningDepth / 2 + sideDepth / 2, BUILDING_WALL_THICKNESS, sideDepth, wallHeight),
      wallSegment(obstacle, "right-front", rightX, obstacle.center.z - sideOpeningDepth / 2 - sideDepth / 2, BUILDING_WALL_THICKNESS, sideDepth, wallHeight),
      wallSegment(obstacle, "right-back", rightX, obstacle.center.z + sideOpeningDepth / 2 + sideDepth / 2, BUILDING_WALL_THICKNESS, sideDepth, wallHeight),
    ];
  });
}

function wallSegment(
  obstacle: MapObstacle,
  suffix: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
): MapWallSegment {
  return {
    id: `${obstacle.id}-wall-${suffix}`,
    obstacleId: obstacle.id,
    center: { x: round(x), y: obstacle.center.y, z: round(z) },
    width: round(width),
    height,
    depth: round(depth),
    color: obstacle.color,
  };
}

function createLootSpawnPoints(
  landingZones: readonly MapPoint[],
  terrainHills: readonly TerrainHill[],
  obstacles: readonly MapObstacle[],
  wallSegments: readonly MapWallSegment[],
  roofRamps: readonly RoofRamp[],
  random: () => number,
): { points: Vector3State[]; counts: number[] } {
  const counts = createLootZoneCounts(random);
  const allSelected: Vector3State[] = [];
  const points = landingZones.flatMap((point, pointIndex) => {
    const zoneCount = counts[pointIndex] ?? 10;
    const minimumSpacing = 38 - (zoneCount - 10) * 2;
    const selected: Vector3State[] = [];
    const outdoorCount = zoneCount - INDOOR_LOOT_POINTS_PER_ZONE;
    for (let slot = 0; slot < outdoorCount; slot += 1) {
      let placed = false;
      for (let attempt = 0; attempt < 160; attempt += 1) {
      const fieldLoot = slot >= Math.max(3, Math.floor(outdoorCount * 0.35));
        const angle = random() * Math.PI * 2;
        const minimumRadius = fieldLoot ? 220 : 70;
        const maximumRadius = fieldLoot ? 450 : 180;
        const radius = Math.sqrt(randomBetween(random, minimumRadius ** 2, maximumRadius ** 2));
        const x = round(point.position.x + Math.cos(angle) * radius);
        const z = round(point.position.z + Math.sin(angle) * radius);
        const candidate = {
          x,
          y: round(terrainHeightFromHills(x, z, terrainHills) + 0.45),
          z,
        };
        if (
          !isClearLootPoint(candidate, wallSegments, roofRamps, selected, obstacles, minimumSpacing) ||
          !hasGlobalLootClearance(candidate, allSelected)
        ) continue;
        selected.push(candidate);
        allSelected.push(candidate);
        placed = true;
        break;
      }
      if (!placed) throw new Error(`Not enough open loot around ${point.name}`);
    }
    const interiorObstacles = obstacles.filter((obstacle) => obstacle.id.startsWith(`building-${pointIndex}-`));
    for (const obstacle of interiorObstacles) {
      if (selected.length >= zoneCount) break;
      const candidate = {
        x: round(obstacle.center.x),
        y: round(terrainHeightFromHills(obstacle.center.x, obstacle.center.z, terrainHills) + 0.45),
        z: round(obstacle.center.z),
      };
      if (
        isClearLootPoint(candidate, wallSegments, roofRamps, selected, [], minimumSpacing) &&
        hasGlobalLootClearance(candidate, allSelected)
      ) {
        selected.push(candidate);
        allSelected.push(candidate);
      }
    }
    for (let attempt = 0; selected.length < zoneCount && attempt < 420; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(randomBetween(random, 120 ** 2, 380 ** 2));
      const x = round(point.position.x + Math.cos(angle) * radius);
      const z = round(point.position.z + Math.sin(angle) * radius);
      const candidate = { x, y: round(terrainHeightFromHills(x, z, terrainHills) + 0.45), z };
      if (
        isClearLootPoint(candidate, wallSegments, roofRamps, selected, obstacles, minimumSpacing) &&
        hasGlobalLootClearance(candidate, allSelected)
      ) {
        selected.push(candidate);
        allSelected.push(candidate);
      }
    }
    if (selected.length < zoneCount) {
      throw new Error(`Not enough clear loot spawn points around ${point.name}`);
    }
    return selected;
  });
  return { points, counts };
}

function hasGlobalLootClearance(candidate: Vector3State, selected: readonly Vector3State[]): boolean {
  return selected.every((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) >= 12);
}

function createLootZoneCounts(random: () => number): number[] {
  const counts = [20, 19, 18, 17, 16, 16, 15, 15, 15, 15, 14, 14, 13, 12, 11, 10];
  for (let index = counts.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [counts[index], counts[swapIndex]] = [counts[swapIndex] as number, counts[index] as number];
  }
  return counts;
}

function isClearLootPoint(
  candidate: Vector3State,
  wallSegments: readonly MapWallSegment[],
  roofRamps: readonly RoofRamp[],
  selected: readonly Vector3State[],
  blockedFootprints: readonly MapObstacle[] = [],
  minimumSpacing = 12,
): boolean {
  return (
    Math.abs(candidate.x) <= MAP_HALF_SIZE - 1 &&
    Math.abs(candidate.z) <= MAP_HALF_SIZE - 1 &&
    blockedFootprints.every((obstacle) => !pointInsideObstacle(candidate, obstacle, 0.5)) &&
    wallSegments.every((wall) => !pointInsideObstacle(candidate, wall, LOOT_OBSTACLE_CLEARANCE)) &&
    roofRamps.every((ramp) => !pointInsideRamp(candidate, ramp, LOOT_OBSTACLE_CLEARANCE)) &&
    selected.every((spawnPoint) => Math.hypot(spawnPoint.x - candidate.x, spawnPoint.z - candidate.z) >= minimumSpacing)
  );
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
