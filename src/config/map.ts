import type { Vector3State } from "../game/state/types";
import { ACTOR_EYE_HEIGHT } from "../game/rules/actorGeometry";
import { GROUND_LOOT_POSITION_HEIGHT } from "../game/rules/loot";
import { DEFAULT_MAP_ID, mapDisplayName, type MapId } from "./maps";
import {
  createMixedMapBlueprint,
  mixedFootprintClearsRoads,
  pointOwnedByMixedRegion,
  type MixedMapBlueprint,
  type MixedRegionSpec,
} from "./mixedMap";
import {
  createTownMapBlueprint,
  type TownBuildingKind,
  TOWN_POINT_HALF_DEPTH,
  TOWN_POINT_HALF_WIDTH,
  TOWN_POINT_OBSTACLE_CLEARANCE,
  townFootprintClearsRoads,
} from "./townMap";

export interface MapObstacle {
  id: string;
  regionId?: string;
  center: Vector3State;
  width: number;
  height: number;
  depth: number;
  color: string;
}

export interface BuildingStairwell {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  side: -1 | 1;
}

export interface MapBuilding extends MapObstacle {
  baseY: number;
  storyCount: 1 | 2 | 3 | 4 | 5;
  storyHeight: number;
  stairwell: BuildingStairwell | null;
  townKind?: TownBuildingKind;
}

export interface MapWallSegment extends MapObstacle {
  obstacleId: string;
}

export interface MapRockObstacle extends MapObstacle {}

export interface MapTreeTrunk extends MapObstacle {
  kind: "tree-trunk";
}

export interface MapCoverObstacle extends MapObstacle {
  kind: "fence" | "hay";
}

export interface MapFloorSlab extends MapObstacle {
  obstacleId: string;
  level: number;
  kind: "floor" | "roof";
}

export interface MapWallOpening {
  id: string;
  obstacleId: string;
  storyIndex: number;
  side: "front" | "back" | "left" | "right";
  kind: "door" | "window";
  center: Vector3State;
  width: number;
  height: number;
}

export interface MapPoint {
  name: string;
  position: Vector3State;
}

export interface HospitalPoi extends MapPoint {
  buildingId: string;
  bandageLootIndex: number;
  medkitLootIndex: number;
}

export interface TerrainHill {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface RoofRamp {
  id: string;
  obstacleId: string;
  kind: "exterior" | "interior";
  fromLevel: number;
  toLevel: number;
  centerX: number;
  width: number;
  startZ: number;
  endZ: number;
  bottomY: number;
  topY: number;
}

export interface MapSkybridge {
  id: string;
  fromBuildingId: string;
  toBuildingId: string;
  fromSide: "left" | "right";
  toSide: "left" | "right";
  center: Vector3State;
  width: number;
  height: number;
  depth: number;
  orientation: "x" | "z";
  floorY: number;
}

export interface MapLayout {
  readonly mapId: MapId;
  readonly displayName: string;
  readonly seed: number;
  readonly mapPoints: readonly MapPoint[];
  readonly landingZones: readonly MapPoint[];
  readonly terrainHills: readonly TerrainHill[];
  readonly obstacles: readonly MapBuilding[];
  readonly wallSegments: readonly MapWallSegment[];
  readonly wallOpenings: readonly MapWallOpening[];
  readonly floorSlabs: readonly MapFloorSlab[];
  readonly rockObstacles: readonly MapRockObstacle[];
  readonly treeTrunks: readonly MapTreeTrunk[];
  readonly coverObstacles: readonly MapCoverObstacle[];
  readonly roofRamps: readonly RoofRamp[];
  readonly roadSegments: readonly (readonly [number, number, number, number])[];
  readonly urbanRoadSegments: readonly (readonly [number, number, number, number])[];
  readonly skybridges: readonly MapSkybridge[];
  readonly hospital: HospitalPoi;
  readonly lootSpawnPoints: readonly Vector3State[];
  readonly lootZoneCounts: readonly number[];
}

export const MAP_SIZE = 2_400;
export const MAP_HALF_SIZE = MAP_SIZE / 2;
export const TERRAIN_GRID_SUBDIVISIONS = 200;
export const BUILDING_ROOF_CAP_HEIGHT = 0.18;
export const BUILDING_WINDOW_SILL_HEIGHT = 1.5;
export const HOSPITAL_WALL_COLOR = "#eef2ef";
export const DEFAULT_MAP_SEED = 0;
export const MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA = 0.798;

export const MAP_POINT_COUNT = 8;
export const LANDING_ZONE_COUNT = 16;
export const BASE_LOOT_POINTS = 240;
export const ADDITIONAL_MEDICAL_LOOT_POINTS = 10;
export const TOTAL_LOOT_POINTS = BASE_LOOT_POINTS + ADDITIONAL_MEDICAL_LOOT_POINTS;
export const TREE_TRUNK_COUNT = 384;
const HOSPITAL_MEDICAL_LOOT_POINTS = 2;
const RANDOM_MEDICAL_LOOT_POINTS = ADDITIONAL_MEDICAL_LOOT_POINTS - HOSPITAL_MEDICAL_LOOT_POINTS;
const POI_NAMES = ["北港", "灰脊镇", "旧仓区", "高地站", "南岸村", "雷达哨", "西风农场", "东岭营地"] as const;
const WILDERNESS_NAMES = ["林间屋", "路边村", "山脚农舍", "旧哨所", "河谷牧场", "废弃院落", "边境仓房", "丘间小屋"] as const;

interface BuildingArea extends MapPoint {
  minimumBuildings: number;
  maximumBuildings: number;
  minimumRadius: number;
  maximumRadius: number;
  major: boolean;
}

interface HospitalSelection {
  buildingId: string;
  stairwellSide: -1 | 1;
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
const MINIMUM_INTERIOR_CLEARANCE = 3.48;
const RAMP_TERRAIN_EPSILON = 0.08;
const MINIMUM_BUILDING_DISTANCE_FROM_POI = 58;
const MAJOR_POINT_MINIMUM_DISTANCE = 420;
const LANDING_ZONE_MINIMUM_DISTANCE = 300;
const POINT_MAP_MARGIN = 210;
const MIXED_OUTDOOR_LOOT_BUILDING_CLEARANCE = 8;
const MIXED_OUTDOOR_LOOT_OBSTACLE_CLEARANCE = 14;
const MOUNTAIN_COUNT = 16;
const COVERAGE_COMPOUND_COUNT = 20;
const COVER_ROCK_COUNT = 64;
const MOUNTAIN_TREE_TRUNK_COUNT = 160;
const FENCE_COVER_COUNT = 96;
const HAY_COVER_COUNT = 72;
const MULTI_STORY_BUILDING_RATIO = 0.2;
const STAIRWELL_WIDTH = 4.8;
const STAIRWELL_LANDING_DEPTH = 1.2;
const STAIRWELL_FLOOR_BORDER = 0.3;
const MAP_LAYOUT_CACHE_LIMIT = 8;
const mapLayoutCache = new Map<string, MapLayout>();
const terrainGridCache = new WeakMap<readonly TerrainHill[], Float32Array>();

export function createMapLayout(seed: number): MapLayout;
export function createMapLayout(mapId: MapId, seed: number): MapLayout;
export function createMapLayout(mapIdOrSeed: MapId | number, explicitSeed?: number): MapLayout {
  const mapId = typeof mapIdOrSeed === "number" ? DEFAULT_MAP_ID : mapIdOrSeed;
  const seed = typeof mapIdOrSeed === "number" ? mapIdOrSeed : explicitSeed;
  if (seed === undefined) throw new Error("Map seed is required");
  const normalizedSeed = seed >>> 0;
  const cacheKey = `${mapId}:${normalizedSeed}`;
  const cached = mapLayoutCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  if (mapId === "town") {
    return cacheMapLayout(cacheKey, createTownMapLayout(normalizedSeed));
  }
  if (mapId === "mixed") {
    return cacheMapLayout(cacheKey, createMixedMapLayout(normalizedSeed));
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
  const baseObstacles = createSeededBuildings(terrainHills, buildingAreas, obstacleRandom);
  const baseWallGeometry = createWallSegments(baseObstacles, terrainHills);
  const baseRoofRamps = baseObstacles.map((obstacle) => {
    const pointIndex = Number(obstacle.id.split("-")[1]);
    const poi = buildingAreas[pointIndex] ?? buildingAreas[0];
    return createRoofRamp(obstacle, poi as MapPoint, terrainHills);
  });
  const rockObstacles = createCoverRocks(
    terrainHills,
    baseObstacles,
    baseRoofRamps,
    landingZones,
    createSeededRandom(normalizedSeed ^ 0x165667b1),
  );
  const coverObstacles = createCoverObstacles(
    terrainHills,
    baseObstacles,
    baseRoofRamps,
    rockObstacles,
    landingZones,
    createSeededRandom(normalizedSeed ^ 0xa24baed5),
  );
  const hospitalSelection = selectHospitalBuilding(
    baseObstacles,
    terrainHills,
    [...rockObstacles, ...coverObstacles],
    createSeededRandom(normalizedSeed ^ 0x4cf5ad43),
  );
  const storyObstacles = baseObstacles.map((building) =>
    building.id === hospitalSelection.buildingId ? { ...building, color: HOSPITAL_WALL_COLOR } : building
  );

  const { points: baseLootSpawnPoints, counts: lootZoneCounts } = createLootSpawnPoints(
    landingZones,
    terrainHills,
    baseObstacles,
    baseWallGeometry.wallSegments,
    baseRoofRamps,
    rockObstacles,
    coverObstacles,
    createSeededRandom(normalizedSeed ^ 0xc2b2ae35),
    createSeededRandom(normalizedSeed ^ 0xd3a2646c),
  );
  const obstacles = assignBuildingStories(
    storyObstacles,
    terrainHills,
    createSeededRandom(normalizedSeed ^ 0x7f4a7c15),
    hospitalSelection,
  );
  const { wallSegments, wallOpenings } = createWallSegments(obstacles, terrainHills);
  const floorSlabs = obstacles.flatMap(createBuildingFloorSlabs);
  const roofRamps = obstacles.flatMap((obstacle) => {
    if (obstacle.storyCount > 1) return createInternalRamps(obstacle, terrainHills);
    const pointIndex = Number(obstacle.id.split("-")[1]);
    const poi = buildingAreas[pointIndex] ?? buildingAreas[0];
    return [createRoofRamp(obstacle, poi as MapPoint, terrainHills)];
  });
  const hospitalBuilding = obstacles.find((building) => building.id === hospitalSelection.buildingId);
  if (!hospitalBuilding) throw new Error("Hospital building missing");
  const hospitalMedicalPoints = createHospitalMedicalPoints(
    hospitalBuilding,
    terrainHills,
    wallSegments.filter((wall) => wall.obstacleId === hospitalBuilding.id),
    roofRamps.filter((ramp) => ramp.obstacleId === hospitalBuilding.id),
    baseLootSpawnPoints,
  );
  const hospital: HospitalPoi = {
    name: "医院",
    buildingId: hospitalBuilding.id,
    position: {
      x: hospitalBuilding.center.x,
      y: round(terrainHeightFromHills(hospitalBuilding.center.x, hospitalBuilding.center.z, terrainHills)),
      z: hospitalBuilding.center.z,
    },
    bandageLootIndex: baseLootSpawnPoints.length,
    medkitLootIndex: baseLootSpawnPoints.length + 1,
  };
  const lootSpawnPoints = [...baseLootSpawnPoints, ...hospitalMedicalPoints];
  const treeTrunks = createTreeTrunks(
    terrainHills,
    obstacles,
    roofRamps,
    rockObstacles,
    coverObstacles,
    landingZones,
    lootSpawnPoints,
    createSeededRandom(normalizedSeed ^ 0x68bc21eb),
  );
  const layout: MapLayout = {
    mapId,
    displayName: mapDisplayName(mapId),
    seed: normalizedSeed,
    mapPoints,
    landingZones,
    terrainHills,
    obstacles,
    wallSegments,
    wallOpenings,
    floorSlabs,
    rockObstacles,
    treeTrunks,
    coverObstacles,
    roofRamps,
    roadSegments: createMapRoadSegments(landingZones),
    urbanRoadSegments: [],
    skybridges: [],
    hospital,
    lootSpawnPoints,
    lootZoneCounts,
  };
  return cacheMapLayout(cacheKey, layout);
}

function createTownMapLayout(seed: number): MapLayout {
  const blueprint = createTownMapBlueprint(seed);
  const terrainHills = createTownTerrainHills(seed);
  const obstacles = blueprint.buildings.map<MapBuilding>((building) => {
    const baseY = round(terrainHeightFromHills(building.x, building.z, terrainHills) - BUILDING_GROUND_EMBED);
    const height = round(building.storyHeight * building.storyCount);
    const base: MapBuilding = {
      id: building.id,
      center: { x: building.x, y: round(baseY + height / 2), z: building.z },
      width: building.width,
      height,
      depth: building.depth,
      color: building.color,
      baseY,
      storyCount: building.storyCount,
      storyHeight: building.storyHeight,
      stairwell: null,
      townKind: building.kind,
    };
    return {
      ...base,
      stairwell: building.storyCount > 1
        ? createBuildingStairwell(base, building.stairwellSide)
        : null,
    };
  });
  const hospitalBase = obstacles.find((building) => building.id === blueprint.hospitalBuildingId);
  if (!hospitalBase) throw new Error("Town hospital building missing");
  const hospitalBuilding = hospitalBase.storyCount < 2
    ? promoteBuilding(hospitalBase, 2, 1)
    : { ...hospitalBase, color: HOSPITAL_WALL_COLOR };
  const hospitalIndex = obstacles.findIndex((building) => building.id === hospitalBuilding.id);
  obstacles[hospitalIndex] = { ...hospitalBuilding, color: HOSPITAL_WALL_COLOR };
  const roofRamps = obstacles.flatMap((building) =>
    building.storyCount > 1
      ? createInternalRamps(building, terrainHills)
      : []
  );
  const skybridges = createTownSkybridges(blueprint.skybridges, obstacles);
  const baseWallGeometry = createWallSegments(obstacles, terrainHills);
  const bridgeWallGeometry = createTownSkybridgeWallGeometry(
    skybridges,
    obstacles,
    terrainHills,
    baseWallGeometry,
  );
  const wallSegments = [
    ...bridgeWallGeometry.wallSegments,
    ...createTownSkybridgeRails(skybridges),
  ];
  const wallOpenings = bridgeWallGeometry.wallOpenings;
  const floorSlabs = [
    ...obstacles.flatMap(createBuildingFloorSlabs),
    ...createTownSkybridgeFloorSlabs(skybridges),
  ];
  const rockObstacles = createTownRockObstacles(seed, terrainHills);
  const coverObstacles = createTownCoverObstacles(
    seed,
    terrainHills,
    blueprint.roadSegments,
    blueprint.landingZones,
    obstacles,
    roofRamps,
  );
  const lootZoneCounts = createTownLootZoneCounts(blueprint.landingZones.length);
  const baseLootSpawnPoints = createTownLootSpawnPoints(
    blueprint.landingZones,
    lootZoneCounts,
    obstacles,
    wallOpenings,
    terrainHills,
    seed,
  );
  const hospitalMedicalPoints = createTownHospitalMedicalPoints(
    obstacles[hospitalIndex] as MapBuilding,
    terrainHills,
  );
  const hospital: HospitalPoi = {
    name: "灰炉医院",
    buildingId: hospitalBuilding.id,
    position: {
      x: hospitalBuilding.center.x,
      y: round(terrainHeightFromHills(hospitalBuilding.center.x, hospitalBuilding.center.z, terrainHills)),
      z: hospitalBuilding.center.z,
    },
    bandageLootIndex: baseLootSpawnPoints.length,
    medkitLootIndex: baseLootSpawnPoints.length + 1,
  };
  const lootSpawnPoints = [...baseLootSpawnPoints, ...hospitalMedicalPoints];
  const landingZones = blueprint.landingZones.map<MapPoint>((point) => ({
    name: point.name,
    position: {
      x: point.x,
      y: round(terrainHeightFromHills(point.x, point.z, terrainHills)),
      z: point.z,
    },
  }));
  const mapPoints = blueprint.mapPoints.map<MapPoint>((point) => ({
    name: point.name,
    position: {
      x: point.x,
      y: round(terrainHeightFromHills(point.x, point.z, terrainHills)),
      z: point.z,
    },
  }));
  const treeTrunks = createTownTreeTrunks(
    seed,
    terrainHills,
    obstacles,
    lootSpawnPoints,
    blueprint.landingZones,
    blueprint.roadSegments,
    blueprint.mapPoints.find((point) => point.name === "城市公园"),
  );
  return {
    mapId: "town",
    displayName: mapDisplayName("town"),
    seed,
    mapPoints,
    landingZones,
    terrainHills,
    obstacles,
    wallSegments,
    wallOpenings,
    floorSlabs,
    rockObstacles,
    treeTrunks,
    coverObstacles,
    roofRamps,
    roadSegments: blueprint.roadSegments,
    urbanRoadSegments: blueprint.roadSegments,
    skybridges,
    hospital,
    lootSpawnPoints,
    lootZoneCounts,
  };
}

function createMixedMapLayout(seed: number): MapLayout {
  const blueprint = createMixedMapBlueprint(seed);
  const terrainHills = blueprint.terrainHills.map<TerrainHill>((hill) => ({
    x: hill.x,
    z: hill.z,
    radius: hill.radius,
    height: hill.height,
  }));
  const obstacles = blueprint.buildings.map<MapBuilding>((building) => {
    const baseY = round(terrainHeightFromHills(building.x, building.z, terrainHills) - BUILDING_GROUND_EMBED);
    const storyCount = building.id === blueprint.hospitalBuildingId
      ? Math.max(2, building.storyCount) as 2 | 3 | 4
      : building.storyCount;
    const height = round(building.storyHeight * storyCount);
    const base: MapBuilding = {
      id: building.id,
      regionId: building.regionId,
      center: { x: building.x, y: round(baseY + height / 2), z: building.z },
      width: building.width,
      height,
      depth: building.depth,
      color: building.id === blueprint.hospitalBuildingId ? HOSPITAL_WALL_COLOR : building.color,
      baseY,
      storyCount,
      storyHeight: building.storyHeight,
      stairwell: null,
      ...(building.townKind ? { townKind: building.townKind } : {}),
    };
    return {
      ...base,
      stairwell: storyCount > 1 ? createBuildingStairwell(base, building.stairwellSide) : null,
    };
  });
  const roofRamps = obstacles.flatMap((building) =>
    building.storyCount > 1 ? createInternalRamps(building, terrainHills) : []
  );
  const { wallSegments, wallOpenings } = createWallSegments(obstacles, terrainHills);
  const floorSlabs = obstacles.flatMap(createBuildingFloorSlabs);
  const landingZones = blueprint.landingZones.map<MapPoint>((point) => ({
    name: point.name,
    position: {
      x: point.x,
      y: round(terrainHeightFromHills(point.x, point.z, terrainHills)),
      z: point.z,
    },
  }));
  const mapPoints = blueprint.mapPoints.map<MapPoint>((point) => ({
    name: point.name,
    position: {
      x: point.x,
      y: round(terrainHeightFromHills(point.x, point.z, terrainHills)),
      z: point.z,
    },
  }));
  const rockObstacles = createMixedRockObstacles(blueprint, terrainHills, obstacles, roofRamps, seed);
  const coverObstacles = createMixedCoverObstacles(
    blueprint,
    terrainHills,
    obstacles,
    roofRamps,
    rockObstacles,
    seed,
  );
  const treeTrunks = createMixedTreeTrunks(
    blueprint,
    terrainHills,
    obstacles,
    roofRamps,
    rockObstacles,
    coverObstacles,
    seed,
  );
  const lootZoneCounts = createMixedLootZoneCounts(landingZones.length);
  const baseLootSpawnPoints = createMixedLootSpawnPoints(
    blueprint,
    landingZones,
    lootZoneCounts,
    terrainHills,
    obstacles,
    wallSegments,
    roofRamps,
    rockObstacles,
    coverObstacles,
    treeTrunks,
    seed,
  );
  const hospitalBuilding = obstacles.find((building) => building.id === blueprint.hospitalBuildingId);
  if (!hospitalBuilding) throw new Error("Mixed map hospital building missing");
  const supplementalMedicalPoints = createMixedSupplementalMedicalPoints(
    blueprint,
    terrainHills,
    obstacles,
    wallSegments,
    roofRamps,
    rockObstacles,
    coverObstacles,
    treeTrunks,
    baseLootSpawnPoints,
    seed,
  );
  const hospitalMedicalPoints = createTownHospitalMedicalPoints(hospitalBuilding, terrainHills);
  const lootSpawnPoints = [
    ...baseLootSpawnPoints,
    ...supplementalMedicalPoints,
    ...hospitalMedicalPoints,
  ];
  const hospital: HospitalPoi = {
    name: "医院",
    buildingId: hospitalBuilding.id,
    position: {
      x: hospitalBuilding.center.x,
      y: round(terrainHeightFromHills(hospitalBuilding.center.x, hospitalBuilding.center.z, terrainHills)),
      z: hospitalBuilding.center.z,
    },
    bandageLootIndex: lootSpawnPoints.length - 2,
    medkitLootIndex: lootSpawnPoints.length - 1,
  };
  return {
    mapId: "mixed",
    displayName: mapDisplayName("mixed"),
    seed,
    mapPoints,
    landingZones,
    terrainHills,
    obstacles,
    wallSegments,
    wallOpenings,
    floorSlabs,
    rockObstacles,
    treeTrunks,
    coverObstacles,
    roofRamps,
    roadSegments: blueprint.roadSegments,
    urbanRoadSegments: blueprint.urbanRoadSegments,
    skybridges: [],
    hospital,
    lootSpawnPoints,
    lootZoneCounts,
  };
}

function createMixedRockObstacles(
  blueprint: MixedMapBlueprint,
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  seed: number,
): MapRockObstacle[] {
  const rocks: MapRockObstacle[] = [];
  for (const [regionIndex, region] of blueprint.regions.entries()) {
    const targetCount = region.kind === "forest" ? 24 : region.kind === "rural" ? 10 : 4;
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0x165667b1));
    for (let attempt = 0; attempt < 60_000 && countRegionObstacles(rocks, region) < targetCount; attempt += 1) {
      const x = round(randomBetween(random, region.centerX - region.width / 2 + 25, region.centerX + region.width / 2 - 25));
      const z = round(randomBetween(random, region.centerZ - region.depth / 2 + 25, region.centerZ + region.depth / 2 - 25));
      const width = round(randomBetween(random, region.kind === "forest" ? 3.8 : 3.5, region.kind === "forest" ? 6 : 7));
      const depth = round(randomBetween(random, region.kind === "forest" ? 3.8 : 3.5, region.kind === "forest" ? 6 : 7));
      const height = round(randomBetween(random, 2.4, 5.5));
      const terrainRange = terrainFootprintRange(x, z, width, depth, terrainHills);
      const baseY = (terrainRange.minimum + terrainRange.maximum) / 2;
      const candidate: MapRockObstacle = {
        id: `mixed-rock-${rocks.length}`,
        regionId: region.id,
        center: { x, y: round(baseY + height / 2), z },
        width,
        height,
        depth,
        color: "#676a62",
      };
      if (!pointOwnedByMixedRegion(blueprint.regions, region, x, z)) continue;
      if (terrainRange.maximum - terrainRange.minimum > MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA) continue;
      if (region.kind === "forest" && terrainRange.minimum < 3) continue;
      if (!mixedPlacementIsClear(candidate, blueprint, buildings, roofRamps, rocks, [], 3)) continue;
      rocks.push(candidate);
    }
    const actualCount = countRegionObstacles(rocks, region);
    if (actualCount !== targetCount) {
      throw new Error(`Mixed map rock generation failed: ${region.name} ${actualCount}/${targetCount}`);
    }
  }
  return rocks;
}

function createMixedCoverObstacles(
  blueprint: MixedMapBlueprint,
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  seed: number,
): MapCoverObstacle[] {
  const covers: MapCoverObstacle[] = [];
  for (const [regionIndex, region] of blueprint.regions.entries()) {
    const targetCount = region.kind === "rural" ? 30 : region.kind === "town" ? 12 : 0;
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0xa24baed5));
    for (let attempt = 0; attempt < 16_000 && countRegionObstacles(covers, region) < targetCount; attempt += 1) {
      const kind = region.kind === "rural" || covers.length % 3 !== 0 ? "hay" : "fence";
      const x = round(randomBetween(random, region.centerX - region.width / 2 + 22, region.centerX + region.width / 2 - 22));
      const z = round(randomBetween(random, region.centerZ - region.depth / 2 + 22, region.centerZ + region.depth / 2 - 22));
      const width = kind === "hay" ? round(randomBetween(random, 3.2, 5.2)) : round(randomBetween(random, 7, 12));
      const depth = kind === "hay" ? width : 0.7;
      const height = kind === "hay" ? round(randomBetween(random, 2.2, 3.6)) : 2.1;
      const candidate: MapCoverObstacle = {
        id: `mixed-cover-${covers.length}`,
        regionId: region.id,
        kind,
        center: { x, y: round(terrainHeightFromHills(x, z, terrainHills) + height / 2), z },
        width,
        height,
        depth,
        color: kind === "hay" ? "#a58b4f" : "#5a5348",
      };
      if (!pointOwnedByMixedRegion(blueprint.regions, region, x, z)) continue;
      if (!mixedPlacementIsClear(candidate, blueprint, buildings, roofRamps, rocks, covers, 2.5)) continue;
      covers.push(candidate);
    }
    const actualCount = countRegionObstacles(covers, region);
    if (actualCount !== targetCount) {
      throw new Error(`Mixed map cover generation failed: ${region.name} ${actualCount}/${targetCount}`);
    }
  }
  return covers;
}

function createMixedTreeTrunks(
  blueprint: MixedMapBlueprint,
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  covers: readonly MapCoverObstacle[],
  seed: number,
): MapTreeTrunk[] {
  const trees: MapTreeTrunk[] = [];
  for (const [regionIndex, region] of blueprint.regions.entries()) {
    const targetCount = region.kind === "forest" ? 180 : region.kind === "rural" ? 36 : 12;
    const minimumSpacing = region.kind === "forest" ? 10 : 17;
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0x68bc21eb));
    for (let attempt = 0; attempt < 80_000 && countRegionObstacles(trees, region) < targetCount; attempt += 1) {
      const x = round(randomBetween(random, region.centerX - region.width / 2 + 18, region.centerX + region.width / 2 - 18));
      const z = round(randomBetween(random, region.centerZ - region.depth / 2 + 18, region.centerZ + region.depth / 2 - 18));
      const width = round(randomBetween(random, 2.2, 3.4));
      const height = round(randomBetween(random, region.kind === "forest" ? 10 : 8, region.kind === "forest" ? 16 : 13));
      const terrainRange = terrainFootprintRange(x, z, width, width, terrainHills);
      const baseY = (terrainRange.minimum + terrainRange.maximum) / 2;
      const candidate: MapTreeTrunk = {
        id: `mixed-tree-${trees.length}`,
        regionId: region.id,
        kind: "tree-trunk",
        center: { x, y: round(baseY + height / 2), z },
        width,
        height,
        depth: width,
        color: "#594b38",
      };
      if (!pointOwnedByMixedRegion(blueprint.regions, region, x, z)) continue;
      if (terrainRange.maximum - terrainRange.minimum > MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA) continue;
      if (region.kind === "forest" && terrainRange.minimum < 3) continue;
      if (!mixedPlacementIsClear(candidate, blueprint, buildings, roofRamps, rocks, [...covers, ...trees], minimumSpacing)) {
        continue;
      }
      trees.push(candidate);
    }
    const actualCount = countRegionObstacles(trees, region);
    if (actualCount !== targetCount) {
      throw new Error(`Mixed map tree generation failed: ${region.name} ${actualCount}/${targetCount}`);
    }
  }
  return trees;
}

function createMixedLootZoneCounts(zoneCount: number): number[] {
  return Array.from({ length: zoneCount }, (_, index) => index < 8 ? 16 : 14);
}

function createMixedLootSpawnPoints(
  blueprint: MixedMapBlueprint,
  landingZones: readonly MapPoint[],
  counts: readonly number[],
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  wallSegments: readonly MapWallSegment[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  covers: readonly MapCoverObstacle[],
  trees: readonly MapTreeTrunk[],
  seed: number,
): Vector3State[] {
  const selected: Vector3State[] = [];
  const buildingUseCounts = new Map<string, number>();
  const random = createSeededRandom(seed ^ 0xc2b2ae35);
  for (const [zoneIndex, zone] of landingZones.entries()) {
    const source = blueprint.landingZones[zoneIndex];
    const region = source && blueprint.regions.find((candidate) => candidate.id === source.regionId);
    if (!region) throw new Error(`Mixed map loot region missing for zone ${zoneIndex}`);
    const targetCount = counts[zoneIndex] ?? 0;
    const regionBuildings = buildings
      .filter((building) => building.regionId === region.id)
      .sort((left, right) =>
        distanceSquared2d(left.center.x, left.center.z, zone.position.x, zone.position.z) -
          distanceSquared2d(right.center.x, right.center.z, zone.position.x, zone.position.z) ||
        left.id.localeCompare(right.id)
      );
    const indoorSelection = selectMixedIndoorLootPoint(
      regionBuildings,
      terrainHills,
      selected,
      buildingUseCounts,
      zoneIndex,
    );
    if (!indoorSelection) {
      throw new Error(
        `Mixed map indoor loot spacing failed: ${region.name} zone=${zoneIndex} buildings=${regionBuildings.length} selected=${selected.length}`,
      );
    }
    const { building: indoorBuilding, point: indoorPoint, useCount: buildingUseCount } = indoorSelection;
    selected.push(indoorPoint);
    buildingUseCounts.set(indoorBuilding.id, buildingUseCount + 1);
    for (let slot = 1, attempt = 0; slot < targetCount && attempt < 80_000; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(randomBetween(random, 30 ** 2, 175 ** 2));
      const x = round(zone.position.x + Math.cos(angle) * radius);
      const z = round(zone.position.z + Math.sin(angle) * radius);
      const point = {
        x,
        y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
        z,
      };
      if (!pointOwnedByMixedRegion(blueprint.regions, region, x, z)) continue;
      if (buildings.some((building) =>
        pointInsideObstacle(point, building, MIXED_OUTDOOR_LOOT_BUILDING_CLEARANCE)
      )) continue;
      if ([...rocks, ...covers, ...trees].some((obstacle) =>
        pointInsideObstacle(point, obstacle, MIXED_OUTDOOR_LOOT_OBSTACLE_CLEARANCE)
      )) continue;
      if (!mixedLootCorridorIsClear(
        zone.position,
        point,
        [...buildings, ...rocks, ...covers, ...trees],
        roofRamps,
      )) continue;
      if (!isClearLootPoint(
        point,
        wallSegments,
        roofRamps,
        selected,
        [...buildings, ...rocks, ...covers, ...trees],
        12,
      )) continue;
      selected.push(point);
      slot += 1;
    }
    const expectedTotal = counts.slice(0, zoneIndex + 1).reduce((total, count) => total + count, 0);
    if (selected.length !== expectedTotal) {
      throw new Error(`Mixed map loot generation failed: ${region.name} ${selected.length}/${expectedTotal}`);
    }
  }
  return selected;
}

function mixedLootCorridorIsClear(
  start: Vector3State,
  end: Vector3State,
  obstacles: readonly MapObstacle[],
  roofRamps: readonly RoofRamp[],
): boolean {
  return (
    obstacles.every((obstacle) =>
      !segmentIntersectsObstacleFootprint(start, end, obstacle, 1.5)
    ) &&
    roofRamps.every((ramp) =>
      !segmentIntersectsRectangleFootprint(
        start.x,
        start.z,
        end.x,
        end.z,
        ramp.centerX,
        (ramp.startZ + ramp.endZ) / 2,
        ramp.width + 3,
        Math.abs(ramp.endZ - ramp.startZ) + 3,
      )
    )
  );
}

function segmentIntersectsObstacleFootprint(
  start: Vector3State,
  end: Vector3State,
  obstacle: MapObstacle,
  clearance: number,
): boolean {
  return segmentIntersectsRectangleFootprint(
    start.x,
    start.z,
    end.x,
    end.z,
    obstacle.center.x,
    obstacle.center.z,
    obstacle.width + clearance * 2,
    obstacle.depth + clearance * 2,
  );
}

function segmentIntersectsRectangleFootprint(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
): boolean {
  const minimumX = centerX - width / 2;
  const maximumX = centerX + width / 2;
  const minimumZ = centerZ - depth / 2;
  const maximumZ = centerZ + depth / 2;
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  let minimumProgress = 0;
  let maximumProgress = 1;
  for (const [start, delta, minimum, maximum] of [
    [startX, deltaX, minimumX, maximumX],
    [startZ, deltaZ, minimumZ, maximumZ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (start < minimum || start > maximum) return false;
      continue;
    }
    const first = (minimum - start) / delta;
    const second = (maximum - start) / delta;
    minimumProgress = Math.max(minimumProgress, Math.min(first, second));
    maximumProgress = Math.min(maximumProgress, Math.max(first, second));
    if (minimumProgress > maximumProgress) return false;
  }
  return true;
}

function selectMixedIndoorLootPoint(
  buildings: readonly MapBuilding[],
  terrainHills: readonly TerrainHill[],
  selected: readonly Vector3State[],
  buildingUseCounts: ReadonlyMap<string, number>,
  zoneIndex: number,
): { building: MapBuilding; point: Vector3State; useCount: number } | null {
  for (let buildingOffset = 0; buildingOffset < buildings.length; buildingOffset += 1) {
    const building = buildings[(zoneIndex + buildingOffset) % buildings.length];
    if (!building) continue;
    const initialUseCount = buildingUseCounts.get(building.id) ?? 0;
    for (let useOffset = 0; useOffset < 4; useOffset += 1) {
      const useCount = initialUseCount + useOffset;
      const point = createMixedIndoorLootPoint(building, terrainHills, useCount);
      if (selected.every((candidate) =>
        Math.hypot(candidate.x - point.x, candidate.z - point.z) >= 12
      )) {
        return { building, point, useCount };
      }
    }
  }
  return null;
}

function createMixedIndoorLootPoint(
  building: MapBuilding,
  terrainHills: readonly TerrainHill[],
  useCount: number,
): Vector3State {
  const offsets = [
    [-building.width * 0.24, -building.depth * 0.24],
    [building.width * 0.24, building.depth * 0.24],
    [-building.width * 0.24, building.depth * 0.24],
    [building.width * 0.24, -building.depth * 0.24],
  ] as const;
  const [offsetX, offsetZ] = offsets[useCount % offsets.length] ?? [0, 0];
  const x = round(building.center.x + offsetX);
  const z = round(building.center.z + offsetZ);
  return {
    x,
    y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
    z,
  };
}

function createMixedSupplementalMedicalPoints(
  blueprint: MixedMapBlueprint,
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  wallSegments: readonly MapWallSegment[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  covers: readonly MapCoverObstacle[],
  trees: readonly MapTreeTrunk[],
  selected: readonly Vector3State[],
  seed: number,
): Vector3State[] {
  const points: Vector3State[] = [];
  const random = createSeededRandom(seed ^ 0xd3a2646c);
  for (let attempt = 0; attempt < 80_000 && points.length < RANDOM_MEDICAL_LOOT_POINTS; attempt += 1) {
    const anchor = blueprint.landingZones[points.length % blueprint.landingZones.length];
    if (!anchor) continue;
    const angle = random() * Math.PI * 2;
    const radius = randomBetween(random, 35, 90);
    const x = round(anchor.x + Math.cos(angle) * radius);
    const z = round(anchor.z + Math.sin(angle) * radius);
    const point = {
      x,
      y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
      z,
    };
    if (!isClearLootPoint(
      point,
      wallSegments,
      roofRamps,
      [...selected, ...points],
      [...buildings, ...rocks, ...covers, ...trees],
      12,
    )) continue;
    points.push(point);
  }
  if (points.length !== RANDOM_MEDICAL_LOOT_POINTS) throw new Error("Mixed map supplemental medical loot generation failed");
  return points;
}

function mixedPlacementIsClear(
  candidate: MapObstacle,
  blueprint: MixedMapBlueprint,
  buildings: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  fixedObstacles: readonly MapObstacle[],
  placedObstacles: readonly MapObstacle[],
  spacing: number,
): boolean {
  return (
    mixedFootprintClearsRoads(
      blueprint.roadSegments,
      candidate.center.x,
      candidate.center.z,
      candidate.width,
      candidate.depth,
      0.5,
    ) &&
    blueprint.landingZones.every((point) =>
      Math.hypot(point.x - candidate.center.x, point.z - candidate.center.z) >= 18
    ) &&
    buildings.every((building) => !buildingsOverlap(building, candidate, 4)) &&
    roofRamps.every((ramp) => !rampIntersectsBuilding(ramp, candidate, 2)) &&
    fixedObstacles.every((obstacle) => !buildingsOverlap(obstacle, candidate, spacing)) &&
    placedObstacles.every((obstacle) => !buildingsOverlap(obstacle, candidate, spacing))
  );
}

function countRegionObstacles(
  obstacles: readonly MapObstacle[],
  region: MixedRegionSpec,
): number {
  return obstacles.filter((obstacle) => obstacle.regionId === region.id).length;
}

function terrainFootprintRange(
  x: number,
  z: number,
  width: number,
  depth: number,
  terrainHills: readonly TerrainHill[],
): { minimum: number; maximum: number } {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let xStep = 0; xStep <= 4; xStep += 1) {
    for (let zStep = 0; zStep <= 4; zStep += 1) {
      const sampleX = x - width / 2 + width * xStep / 4;
      const sampleZ = z - depth / 2 + depth * zStep / 4;
      const height = terrainHeightFromHills(sampleX, sampleZ, terrainHills);
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }
  return { minimum, maximum };
}

function cacheMapLayout(cacheKey: string, layout: MapLayout): MapLayout {
  if (mapLayoutCache.size >= MAP_LAYOUT_CACHE_LIMIT) {
    const oldestKey = mapLayoutCache.keys().next().value;
    if (oldestKey !== undefined) mapLayoutCache.delete(oldestKey);
  }
  mapLayoutCache.set(cacheKey, layout);
  return layout;
}

function createTownTerrainHills(seed: number): TerrainHill[] {
  const random = createSeededRandom(seed ^ 0x9e3779b9);
  return [
    { x: -1_020, z: -1_020, radius: 260, height: 5 },
    { x: 1_020, z: -1_020, radius: 260, height: 4 },
    { x: -1_020, z: 1_020, radius: 260, height: 4 },
    { x: 1_020, z: 1_020, radius: 260, height: 5 },
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2 + randomBetween(random, -0.12, 0.12);
      const radius = randomBetween(random, 980, 1_090);
      return {
      x: round(Math.cos(angle) * radius),
      z: round(Math.sin(angle) * radius),
      radius: round(randomBetween(random, 120, 240)),
      height: round(randomBetween(random, 0.4, 1.6)),
      };
    }),
  ];
}

function createTownSkybridges(
  specs: ReturnType<typeof createTownMapBlueprint>["skybridges"],
  buildings: readonly MapBuilding[],
): MapSkybridge[] {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  return specs.map((spec) => {
    const from = byId.get(spec.fromBuildingId);
    const to = byId.get(spec.toBuildingId);
    if (!from || !to || from.storyCount < 2 || to.storyCount < 2) {
      throw new Error(`Town skybridge endpoint missing: ${spec.id}`);
    }
    const floorY = round(Math.max(
      from.baseY + from.storyHeight + BUILDING_ROOF_CAP_HEIGHT,
      to.baseY + to.storyHeight + BUILDING_ROOF_CAP_HEIGHT,
    ));
    const fromX = from.center.x + (spec.fromSide === "right" ? from.width / 2 : -from.width / 2);
    const toX = to.center.x + (spec.toSide === "right" ? to.width / 2 : -to.width / 2);
    const minimumX = Math.min(fromX, toX);
    const maximumX = Math.max(fromX, toX);
    const overlapMinimumZ = Math.max(
      from.center.z - from.depth / 2 + 4,
      to.center.z - to.depth / 2 + 4,
    );
    const overlapMaximumZ = Math.min(
      from.center.z + from.depth / 2 - 4,
      to.center.z + to.depth / 2 - 4,
    );
    if (overlapMaximumZ <= overlapMinimumZ) {
      throw new Error(`Town skybridge endpoints do not overlap: ${spec.id}`);
    }
    const centerZ = round((overlapMinimumZ + overlapMaximumZ) / 2);
    return {
      id: spec.id,
      fromBuildingId: from.id,
      toBuildingId: to.id,
      fromSide: spec.fromSide,
      toSide: spec.toSide,
      center: {
        x: round((minimumX + maximumX) / 2),
        y: round(floorY + 1.2),
        z: centerZ,
      },
      width: round(maximumX - minimumX),
      height: 2.4,
      depth: 5.2,
      orientation: "x",
      floorY,
    };
  });
}

function createTownSkybridgeWallGeometry(
  skybridges: readonly MapSkybridge[],
  buildings: readonly MapBuilding[],
  terrainHills: readonly TerrainHill[],
  baseGeometry: ReturnType<typeof createWallSegments>,
): ReturnType<typeof createWallSegments> {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const replacements = skybridges.flatMap((bridge) => [
    {
      building: byId.get(bridge.fromBuildingId),
      side: bridge.fromSide,
    },
    {
      building: byId.get(bridge.toBuildingId),
      side: bridge.toSide,
    },
  ] as const);
  const replacementKeys = new Set(replacements.map(({ building, side }) => `${building?.id}:${side}:1`));
  const wallSegments = baseGeometry.wallSegments.filter((wall) => {
    for (const key of replacementKeys) {
      const [buildingId, side, storyIndex] = key.split(":");
      if (wall.id.startsWith(`${buildingId}-wall-${side}-${storyIndex}-`)) return false;
    }
    return true;
  });
  const wallOpenings = baseGeometry.wallOpenings.filter(
    (opening) => !replacementKeys.has(`${opening.obstacleId}:${opening.side}:${opening.storyIndex}`),
  );
  for (const { building, side } of replacements) {
    if (!building) throw new Error("Town skybridge opening building missing");
    const bridge = skybridges.find((candidate) =>
      (candidate.fromBuildingId === building.id && candidate.fromSide === side) ||
      (candidate.toBuildingId === building.id && candidate.toSide === side)
    );
    if (!bridge) throw new Error("Town skybridge opening record missing");
    const geometry = createFacadeGeometry(building, 1, side, "door", terrainHills, bridge.center.z);
    wallSegments.push(...geometry.wallSegments);
    wallOpenings.push(geometry.opening);
  }
  return { wallSegments, wallOpenings };
}

function createTownSkybridgeFloorSlabs(skybridges: readonly MapSkybridge[]): MapFloorSlab[] {
  return skybridges.map((bridge) => ({
    id: `${bridge.id}-floor`,
    obstacleId: bridge.id,
    level: 1,
    kind: "floor",
    center: {
      x: bridge.center.x,
      y: round(bridge.floorY - BUILDING_ROOF_CAP_HEIGHT / 2),
      z: bridge.center.z,
    },
    width: bridge.width,
    height: BUILDING_ROOF_CAP_HEIGHT,
    depth: bridge.depth,
    color: "#545b5e",
  }));
}

function createTownSkybridgeRails(skybridges: readonly MapSkybridge[]): MapWallSegment[] {
  return skybridges.flatMap((bridge) => [-1, 1].map((side) => ({
    id: `${bridge.id}-rail-${side < 0 ? "north" : "south"}`,
    obstacleId: bridge.id,
    center: {
      x: bridge.center.x,
      y: round(bridge.floorY + bridge.height / 2),
      z: round(bridge.center.z + side * (bridge.depth / 2 - BUILDING_WALL_THICKNESS / 2)),
    },
    width: bridge.width,
    height: bridge.height,
    depth: BUILDING_WALL_THICKNESS,
    color: "#4b5154",
  })));
}

function createTownRockObstacles(seed: number, terrainHills: readonly TerrainHill[]): MapRockObstacle[] {
  const random = createSeededRandom(seed ^ 0x165667b1);
  return Array.from({ length: 64 }, (_, index) => {
    const column = index % 16;
    const row = Math.floor(index / 16);
    const x = -825 + column * 110;
    const z = row < 2 ? -1_050 + row * 2_100 : -1_050 + (row - 2) * 2_100;
    const offsetX = row < 2 ? randomBetween(random, -20, 20) : (row === 2 ? -1_050 : 1_050);
    const offsetZ = row < 2 ? z : x;
    const centerX = round(row < 2 ? x + offsetX : offsetX);
    const centerZ = round(row < 2 ? offsetZ : x + randomBetween(random, -20, 20));
    const width = round(randomBetween(random, 5.5, 8));
    const depth = round(randomBetween(random, 5, 8));
    const height = round(randomBetween(random, 3.4, 5.2));
    const ground = terrainHeightFromHills(centerX, centerZ, terrainHills);
    return {
      id: `town-cover-rock-${index}`,
      center: { x: centerX, y: round(ground + height / 2), z: centerZ },
      width,
      height,
      depth,
      color: "#4f5553",
    };
  });
}

function createTownCoverObstacles(
  seed: number,
  terrainHills: readonly TerrainHill[],
  roads: readonly (readonly [number, number, number, number])[],
  reservedPoints: readonly { x: number; z: number }[],
  buildings: readonly MapBuilding[],
  ramps: readonly RoofRamp[],
): MapCoverObstacle[] {
  const random = createSeededRandom(seed ^ 0xa24baed5);
  const covers: MapCoverObstacle[] = [];
  for (let attempt = 0; attempt < 50_000 && covers.length < 168; attempt += 1) {
    const index = covers.length;
    const road = roads[(index * 7 + attempt) % roads.length];
    if (!road) continue;
    const [startX, startZ, endX, endZ] = road;
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const length = Math.hypot(deltaX, deltaZ);
    if (length < 1) continue;
    const normalX = -deltaZ / length;
    const normalZ = deltaX / length;
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaZ);
    const progress = randomBetween(random, 0.03, 0.97);
    const side = random() < 0.5 ? -1 : 1;
    const edgeOffset = randomBetween(random, 8.5, 11.5);
    const x = round(startX + deltaX * progress + normalX * side * edgeOffset);
    const z = round(startZ + deltaZ * progress + normalZ * side * edgeOffset);
    const kind = index % 3 === 0 ? "hay" as const : "fence" as const;
    const longSize = round(randomBetween(random, 7, 12));
    const width = kind === "fence"
      ? horizontal ? longSize : 0.8
      : round(randomBetween(random, 4, 7));
    const depth = kind === "fence"
      ? horizontal ? 0.8 : longSize
      : round(randomBetween(random, 3, 5));
    const height = kind === "fence" ? 2.2 : round(randomBetween(random, 2.4, 3.6));
    const ground = terrainHeightFromHills(x, z, terrainHills);
    const candidate: MapCoverObstacle = {
      id: `town-cover-${index}`,
      kind,
      center: { x, y: round(ground + height / 2), z },
      width,
      height,
      depth,
      color: kind === "fence" ? "#5c615e" : "#6d5f4b",
    };
    if (buildings.some((building) => buildingsOverlap(candidate, building, 1.2))) continue;
    if (ramps.some((ramp) => rampIntersectsBuilding(ramp, candidate, 1.2))) continue;
    if (!townFootprintClearsRoads(roads, x, z, width, depth, 0.25)) continue;
    if (reservedPoints.some((point) =>
      Math.abs(candidate.center.x - point.x) <=
        candidate.width / 2 + TOWN_POINT_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE &&
      Math.abs(candidate.center.z - point.z) <=
        candidate.depth / 2 + TOWN_POINT_HALF_DEPTH + TOWN_POINT_OBSTACLE_CLEARANCE
    )) continue;
    if (covers.some((cover) => buildingsOverlap(candidate, cover, 3))) continue;
    covers.push(candidate);
  }
  if (covers.length !== 168) throw new Error("Not enough random town cover obstacles");
  return covers;
}

function createTownLootZoneCounts(zoneCount: number): number[] {
  const counts = Array.from({ length: zoneCount }, () => 15);
  for (let index = 0; index < Math.min(8, zoneCount); index += 1) {
    counts[index] = 16;
  }
  return counts;
}

function createTownLootSpawnPoints(
  landingZones: readonly { name: string; x: number; z: number }[],
  counts: readonly number[],
  buildings: readonly MapBuilding[],
  openings: readonly MapWallOpening[],
  terrainHills: readonly TerrainHill[],
  seed: number,
): Vector3State[] {
  const random = createSeededRandom(seed ^ 0xc2b2ae35);
  const usedBuildingIds = new Set<string>();
  const byDistance = (point: { x: number; z: number }) => [...buildings].sort((left, right) =>
    distanceSquared2d(left.center.x, left.center.z, point.x, point.z) -
      distanceSquared2d(right.center.x, right.center.z, point.x, point.z) ||
    left.id.localeCompare(right.id)
  );
  const selected: Vector3State[] = [];
  for (const [zoneIndex, zone] of landingZones.entries()) {
    const targetCount = counts[zoneIndex] ?? 15;
    const nearbyBuildings = byDistance(zone);
    for (let slot = 0; slot < targetCount; slot += 1) {
      const startIndex = (slot * 3 + zoneIndex) % nearbyBuildings.length;
      const building = Array.from({ length: nearbyBuildings.length }, (_, offset) =>
        nearbyBuildings[(startIndex + offset) % nearbyBuildings.length]
      ).find((candidate) => candidate && !usedBuildingIds.has(candidate.id));
      if (!building) throw new Error(`Town loot building missing for ${zone.name}`);
      usedBuildingIds.add(building.id);
      const opening = openings.find((candidate) =>
        candidate.obstacleId === building.id && candidate.storyIndex === 0 && candidate.kind === "door"
      );
      const jitterX = randomBetween(random, -2, 2);
      const jitterZ = randomBetween(random, -2, 2);
      const x = round(building.center.x + jitterX);
      const z = round(building.center.z + jitterZ);
      const candidate = {
        x,
        y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
        z,
      };
      if (opening && slot % 4 === 0) {
        candidate.x = round(opening.center.x + (opening.side === "left" ? 1.2 : opening.side === "right" ? -1.2 : 0));
        candidate.z = round(opening.center.z + (opening.side === "front" ? 1.2 : opening.side === "back" ? -1.2 : 0));
        candidate.y = round(terrainHeightFromHills(candidate.x, candidate.z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT);
      }
      selected.push(candidate);
    }
  }
  return selected;
}

function createTownHospitalMedicalPoints(
  hospital: MapBuilding,
  terrainHills: readonly TerrainHill[],
): [Vector3State, Vector3State] {
  return [-4, 4].map((offset) => {
    const x = round(hospital.center.x + offset);
    const z = hospital.center.z;
    return {
      x,
      y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
      z,
    };
  }) as [Vector3State, Vector3State];
}

function createTownTreeTrunks(
  seed: number,
  terrainHills: readonly TerrainHill[],
  buildings: readonly MapBuilding[],
  loot: readonly Vector3State[],
  reservedPoints: readonly { x: number; z: number }[],
  roads: readonly (readonly [number, number, number, number])[],
  parkPoint: { x: number; z: number } | undefined,
): MapTreeTrunk[] {
  const random = createSeededRandom(seed ^ 0x68bc21eb);
  const trees: MapTreeTrunk[] = [];
  for (let attempt = 0; attempt < 20_000 && trees.length < 96; attempt += 1) {
    const parkTree = trees.length < 48 && attempt < 8_000;
    const parkX = parkPoint?.x ?? 770;
    const parkZ = parkPoint?.z ?? 0;
    const x = round(parkTree ? randomBetween(random, parkX - 80, parkX + 80) : randomBetween(random, -1_120, 1_120));
    const z = round(parkTree ? randomBetween(random, parkZ - 130, parkZ + 130) : randomBetween(random, -1_120, 1_120));
    const width = round(randomBetween(random, 2.2, 3.2));
    const height = round(randomBetween(random, 9, 14));
    const depth = round(randomBetween(random, 2.2, 3.2));
    if (
      buildings.some((building) => buildingsOverlap(
        building,
        { id: "", center: { x, y: 0, z }, width: 5, height: 5, depth: 5, color: "" },
        6,
      )) ||
      loot.some((point) => Math.hypot(point.x - x, point.z - z) < 5) ||
      reservedPoints.some((point) =>
        Math.abs(point.x - x) <= TOWN_POINT_HALF_WIDTH + 4 &&
        Math.abs(point.z - z) <= TOWN_POINT_HALF_DEPTH + 4
      ) ||
      !townFootprintClearsRoads(roads, x, z, width, depth, 0.25) ||
      trees.some((tree) => Math.hypot(tree.center.x - x, tree.center.z - z) < 12)
    ) continue;
    const ground = terrainHeightFromHills(x, z, terrainHills);
    trees.push({
      id: `town-tree-${trees.length}`,
      kind: "tree-trunk",
      center: { x, y: round(ground + height / 2), z },
      width,
      height,
      depth,
      color: "#5a4d39",
    });
  }
  if (trees.length !== 96) throw new Error("Not enough town tree trunks");
  return trees;
}

function distanceSquared2d(x: number, z: number, targetX: number, targetZ: number): number {
  return (x - targetX) ** 2 + (z - targetZ) ** 2;
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
export const MAP_ROCK_OBSTACLES: readonly MapRockObstacle[] = DEFAULT_MAP_LAYOUT.rockObstacles;
export const MAP_TREE_TRUNKS: readonly MapTreeTrunk[] = DEFAULT_MAP_LAYOUT.treeTrunks;
export const MAP_COVER_OBSTACLES: readonly MapCoverObstacle[] = DEFAULT_MAP_LAYOUT.coverObstacles;
export const MAP_ROOF_RAMPS: readonly RoofRamp[] = DEFAULT_MAP_LAYOUT.roofRamps;
export const LOOT_SPAWN_POINTS: readonly Vector3State[] = DEFAULT_MAP_LAYOUT.lootSpawnPoints;
export const MAP_POINTS: readonly MapPoint[] = DEFAULT_MAP_LAYOUT.mapPoints;
export const LANDING_ZONES: readonly MapPoint[] = DEFAULT_MAP_LAYOUT.landingZones;

export const BOT_SPAWN_POINTS: readonly Vector3State[] = Array.from({ length: 49 }, (_, index) => {
  const angle = (index / 49) * Math.PI * 2;
  const radius = 380 + (index % 4) * 70;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return { x, y: getTerrainHeight(x, z) + ACTOR_EYE_HEIGHT, z };
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
      minimumBuildings: 10,
      maximumBuildings: 14,
      minimumRadius: MINIMUM_BUILDING_DISTANCE_FROM_POI,
      maximumRadius: 300,
      major: true,
    })),
    ...wildernessPoints.map((point) => ({
      ...point,
      minimumBuildings: 6,
      maximumBuildings: 9,
      minimumRadius: 14,
      maximumRadius: 180,
      major: false,
    })),
    ...coveragePoints.map((point) => ({
      ...point,
      minimumBuildings: 3,
      maximumBuildings: 4,
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
): MapBuilding[] {
  const allSelected: MapBuilding[] = [];
  return buildingAreas.flatMap((point, pointIndex) => {
    const targetCount = point.minimumBuildings + Math.floor(random() * (point.maximumBuildings - point.minimumBuildings + 1));
    const selected: MapBuilding[] = [];
    for (let attempt = 0; attempt < targetCount * 500 && selected.length < targetCount; attempt += 1) {
      const width = round(randomBetween(random, 18, 34));
      const depth = round(randomBetween(random, 16, 33));
      const height = round(randomBetween(random, 4.28, 5.48));
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
      const candidate: MapBuilding = {
        id: `building-${pointIndex}-${selected.length}`,
        center: { x, y: round(baseY + height / 2), z },
        width,
        height,
        depth,
        color: pointIndex % 2 === 0 ? "#59645b" : "#726955",
        baseY: round(baseY),
        storyCount: 1,
        storyHeight: height,
        stairwell: null,
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

function assignBuildingStories(
  buildings: readonly MapBuilding[],
  terrainHills: readonly TerrainHill[],
  random: () => number,
  hospital: HospitalSelection,
): MapBuilding[] {
  const targetCount = Math.round(buildings.length * MULTI_STORY_BUILDING_RATIO);
  const candidates = buildings
    .map((building) => ({
      building,
      score: random(),
      storyCount: (random() < 0.42 ? 3 : 2) as 2 | 3,
      side: (random() < 0.5 ? -1 : 1) as -1 | 1,
    }))
    .sort((left, right) => left.score - right.score || left.building.id.localeCompare(right.building.id));
  const promoted = new Map<string, MapBuilding>();
  const hospitalBase = buildings.find((building) => building.id === hospital.buildingId);
  if (!hospitalBase) throw new Error("Hospital story assignment requires its building");
  const hospitalBuilding = promoteBuilding(hospitalBase, 2, hospital.stairwellSide);
  if (!createInternalRamps(hospitalBuilding, terrainHills).every((ramp) => rampClearsTerrain(ramp, terrainHills))) {
    throw new Error("Hospital internal stairs do not clear terrain");
  }
  promoted.set(hospitalBuilding.id, hospitalBuilding);
  for (const candidate of candidates) {
    if (promoted.size >= targetCount) break;
    if (candidate.building.id === hospital.buildingId) continue;
    const building = promoteBuilding(candidate.building, candidate.storyCount, candidate.side);
    if (createInternalRamps(building, terrainHills).every((ramp) => rampClearsTerrain(ramp, terrainHills))) {
      promoted.set(building.id, building);
    }
  }
  if (promoted.size !== targetCount) throw new Error("Not enough buildings support internal stairs");
  return buildings.map((building) => promoted.get(building.id) ?? building);
}

function selectHospitalBuilding(
  buildings: readonly MapBuilding[],
  terrainHills: readonly TerrainHill[],
  entranceBlockers: readonly MapObstacle[],
  random: () => number,
): HospitalSelection {
  const preferred = buildings
    .filter((building) => Number(building.id.split("-")[1]) < LANDING_ZONE_COUNT)
    .sort((left, right) => left.width * left.depth - right.width * right.depth || left.id.localeCompare(right.id));
  const pool = preferred.slice(0, Math.max(1, Math.ceil(preferred.length * 0.45)));
  const startIndex = Math.floor(random() * pool.length);
  const firstSide = (random() < 0.5 ? -1 : 1) as -1 | 1;
  const secondSide = (firstSide === -1 ? 1 : -1) as -1 | 1;
  for (let offset = 0; offset < pool.length; offset += 1) {
    const building = pool[(startIndex + offset) % pool.length];
    if (!building) continue;
    if (!hospitalEntranceClear(building, entranceBlockers)) continue;
    for (const side of [firstSide, secondSide]) {
      const candidate = promoteBuilding({ ...building, color: HOSPITAL_WALL_COLOR }, 2, side);
      if (createInternalRamps(candidate, terrainHills).every((ramp) => rampClearsTerrain(ramp, terrainHills))) {
        return { buildingId: building.id, stairwellSide: side };
      }
    }
  }
  throw new Error("Not enough buildings support a hospital");
}

function hospitalEntranceClear(building: MapBuilding, blockers: readonly MapObstacle[]): boolean {
  const doorWidth = Math.min(4.2, building.width * 0.34);
  const entranceCenterZ = building.center.z - building.depth / 2 - 2;
  return blockers.every((blocker) =>
    Math.abs(blocker.center.x - building.center.x) >= blocker.width / 2 + doorWidth / 2 + 0.8 ||
    Math.abs(blocker.center.z - entranceCenterZ) >= blocker.depth / 2 + 2.8
  );
}

function promoteBuilding(
  building: MapBuilding,
  storyCount: 2 | 3,
  side: -1 | 1,
): MapBuilding {
  const height = round(building.storyHeight * storyCount);
  return {
    ...building,
    center: { ...building.center, y: round(building.baseY + height / 2) },
    height,
    storyCount,
    stairwell: createBuildingStairwell(building, side),
  };
}

function createBuildingStairwell(building: MapBuilding, side: -1 | 1): BuildingStairwell {
  const width = Math.min(STAIRWELL_WIDTH, building.width - BUILDING_WALL_THICKNESS * 2 - 2);
  const runLength = Math.min(
    Math.max(8, building.storyHeight * 2.8),
    building.depth - BUILDING_WALL_THICKNESS * 2 - STAIRWELL_LANDING_DEPTH * 2 - STAIRWELL_FLOOR_BORDER * 2,
  );
  const depth = runLength + STAIRWELL_LANDING_DEPTH * 2;
  const xOffset = Math.max(
    0,
    building.width / 2 - BUILDING_WALL_THICKNESS - width / 2 - 0.8,
  );
  return {
    centerX: round(building.center.x + side * xOffset),
    centerZ: building.center.z,
    width: round(width),
    depth: round(depth),
    side,
  };
}

function createInternalRamps(building: MapBuilding, terrainHills: readonly TerrainHill[]): RoofRamp[] {
  const stairwell = building.stairwell;
  if (!stairwell) return [];
  const runLength = stairwell.depth - STAIRWELL_LANDING_DEPTH * 2;
  const rampWidth = stairwell.width / 2;
  return Array.from({ length: building.storyCount }, (_, level) => {
    const direction = level % 2 === 0 ? 1 : -1;
    const lane = level % 2 === 0 ? -1 : 1;
    const startZ = stairwell.centerZ - direction * runLength / 2;
    const endZ = stairwell.centerZ + direction * runLength / 2;
    const bottomY = level === 0
      ? terrainHeightFromHills(stairwell.centerX, startZ, terrainHills)
      : building.baseY + level * building.storyHeight + BUILDING_ROOF_CAP_HEIGHT;
    return {
      id: `ramp-${building.id}-level-${level}`,
      obstacleId: building.id,
      kind: "interior",
      fromLevel: level,
      toLevel: level + 1,
      centerX: round(stairwell.centerX + lane * rampWidth / 2),
      width: round(rampWidth),
      startZ: round(startZ),
      endZ: round(endZ),
      bottomY: round(bottomY),
      topY: round(building.baseY + (level + 1) * building.storyHeight + BUILDING_ROOF_CAP_HEIGHT),
    };
  });
}

function createBuildingFloorSlabs(building: MapBuilding): MapFloorSlab[] {
  if (!building.stairwell) {
    return [floorSlab(
      building,
      building.storyCount,
      "roof",
      "full",
      building.center.x,
      building.center.z,
      building.width,
      building.depth,
    )];
  }
  const minimumX = building.center.x - building.width / 2;
  const maximumX = building.center.x + building.width / 2;
  const minimumZ = building.center.z - building.depth / 2;
  const maximumZ = building.center.z + building.depth / 2;
  const openingMinimumX = building.stairwell.centerX - building.stairwell.width / 2;
  const openingMaximumX = building.stairwell.centerX + building.stairwell.width / 2;
  const openingMinimumZ = building.stairwell.centerZ - building.stairwell.depth / 2;
  const openingMaximumZ = building.stairwell.centerZ + building.stairwell.depth / 2;
  return Array.from({ length: building.storyCount }, (_, index) => index + 1).flatMap((level) => {
    const kind = level === building.storyCount ? "roof" : "floor";
    const wallInset = kind === "floor" ? BUILDING_WALL_THICKNESS : 0;
    const levelMinimumX = minimumX + wallInset;
    const levelMaximumX = maximumX - wallInset;
    const levelMinimumZ = minimumZ + wallInset;
    const levelMaximumZ = maximumZ - wallInset;
    const landingDirection = (level - 1) % 2 === 0 ? 1 : -1;
    const rampRunLength = building.stairwell?.depth
      ? building.stairwell.depth - STAIRWELL_LANDING_DEPTH * 2
      : 0;
    const landingZ = (building.stairwell?.centerZ ?? building.center.z) + landingDirection * rampRunLength / 2;
    return [
      floorSlab(building, level, kind, "left", (levelMinimumX + openingMinimumX) / 2, building.center.z, openingMinimumX - levelMinimumX, levelMaximumZ - levelMinimumZ),
      floorSlab(building, level, kind, "right", (openingMaximumX + levelMaximumX) / 2, building.center.z, levelMaximumX - openingMaximumX, levelMaximumZ - levelMinimumZ),
      floorSlab(building, level, kind, "front", building.stairwell?.centerX ?? building.center.x, (levelMinimumZ + openingMinimumZ) / 2, building.stairwell?.width ?? 0, openingMinimumZ - levelMinimumZ),
      floorSlab(building, level, kind, "back", building.stairwell?.centerX ?? building.center.x, (openingMaximumZ + levelMaximumZ) / 2, building.stairwell?.width ?? 0, levelMaximumZ - openingMaximumZ),
      floorSlab(
        building,
        level,
        kind,
        "stair-landing",
        building.stairwell?.centerX ?? building.center.x,
        landingZ,
        building.stairwell?.width ?? 0,
        STAIRWELL_LANDING_DEPTH * 2,
      ),
    ].filter((slab) => slab.width > 0.1 && slab.depth > 0.1);
  });
}

function floorSlab(
  building: MapBuilding,
  level: number,
  kind: "floor" | "roof",
  piece: string,
  x: number,
  z: number,
  width: number,
  depth: number,
): MapFloorSlab {
  const bottomY = building.baseY + level * building.storyHeight;
  return {
    id: `${building.id}-${kind}-${level}-${piece}`,
    obstacleId: building.id,
    level,
    kind,
    center: { x: round(x), y: round(bottomY + BUILDING_ROOF_CAP_HEIGHT / 2), z: round(z) },
    width: round(width),
    height: BUILDING_ROOF_CAP_HEIGHT,
    depth: round(depth),
    color: building.color,
  };
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
    obstacleId: obstacle.id,
    kind: "exterior",
    fromLevel: 0,
    toLevel: 1,
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

function createCoverRocks(
  terrainHills: readonly TerrainHill[],
  obstacles: readonly MapObstacle[],
  roofRamps: readonly RoofRamp[],
  landingZones: readonly MapPoint[],
  random: () => number,
): MapRockObstacle[] {
  const rocks: MapRockObstacle[] = [];
  const roads = createMapRoadSegments(landingZones);
  for (let index = 0; index < COVER_ROCK_COUNT; index += 1) {
    let rock: MapRockObstacle | null = null;
    for (let attempt = 0; attempt < 800 && !rock; attempt += 1) {
      const width = round(randomBetween(random, 5.5, 9));
      const depth = round(randomBetween(random, 5, 8.5));
      const height = round(randomBetween(random, 3.4, 5.4));
      const x = round(randomBetween(random, -1_100, 1_100));
      const z = round(randomBetween(random, -1_100, 1_100));
      if (!footprintInsideMap(x, z, width, depth)) continue;
      const terrainRange = getFootprintTerrainRange(x, z, width, depth, terrainHills);
      if (terrainRange.maximum - terrainRange.minimum > 0.9) continue;
      const candidate: MapRockObstacle = {
        id: `cover-rock-${index}`,
        center: { x, y: round(terrainRange.minimum + height / 2 - 0.15), z },
        width,
        height,
        depth,
        color: "#65685e",
      };
      if (obstacles.some((obstacle) => footprintsOverlap(candidate, obstacle, 8))) continue;
      if (rocks.some((existing) => footprintsOverlap(candidate, existing, 18))) continue;
      if (roofRamps.some((ramp) => rampIntersectsBuilding(ramp, candidate, 8))) continue;
      if (roads.some(([startX, startZ, endX, endZ]) =>
        pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= Math.max(width, depth) / 2 + 7
      )) continue;
      rock = candidate;
    }
    if (!rock) throw new Error(`Unable to place cover rock ${index}`);
    rocks.push(rock);
  }
  return rocks;
}

function createCoverObstacles(
  terrainHills: readonly TerrainHill[],
  obstacles: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  landingZones: readonly MapPoint[],
  random: () => number,
): MapCoverObstacle[] {
  const covers: MapCoverObstacle[] = [];
  const roads = createMapRoadSegments(landingZones);
  const totalCount = FENCE_COVER_COUNT + HAY_COVER_COUNT;
  for (let index = 0; index < totalCount; index += 1) {
    const kind = index < FENCE_COVER_COUNT ? "fence" : "hay";
    let selected: MapCoverObstacle | null = null;
    for (let attempt = 0; attempt < 1_200 && !selected; attempt += 1) {
      const owner = obstacles[Math.floor(random() * obstacles.length)];
      if (!owner) break;
      const horizontal = random() < 0.5;
      const width = kind === "fence"
        ? (horizontal ? randomBetween(random, 7, 15) : 0.5)
        : randomBetween(random, 2.8, 4.8);
      const depth = kind === "fence"
        ? (horizontal ? 0.5 : randomBetween(random, 7, 15))
        : randomBetween(random, 2.8, 4.8);
      const height = kind === "fence" ? randomBetween(random, 1.25, 1.55) : randomBetween(random, 1.5, 2.1);
      const side = Math.floor(random() * 4);
      const sideDistance = randomBetween(random, 7, kind === "fence" ? 24 : 34);
      const lateralJitter = randomBetween(random, -22, 22);
      const x = round(
        owner.center.x +
        (side === 0 ? owner.width / 2 + sideDistance : side === 1 ? -owner.width / 2 - sideDistance : lateralJitter),
      );
      const z = round(
        owner.center.z +
        (side === 2 ? owner.depth / 2 + sideDistance : side === 3 ? -owner.depth / 2 - sideDistance : lateralJitter),
      );
      if (!footprintInsideMap(x, z, width, depth)) continue;
      const terrainRange = getFootprintTerrainRange(x, z, width, depth, terrainHills);
      if (terrainRange.maximum - terrainRange.minimum > (kind === "fence" ? 0.45 : 0.75)) continue;
      const candidate: MapCoverObstacle = {
        id: `${kind}-cover-${kind === "fence" ? index : index - FENCE_COVER_COUNT}`,
        kind,
        center: { x, y: round(terrainRange.maximum + height / 2 - 0.08), z },
        width: round(width),
        height: round(height),
        depth: round(depth),
        color: kind === "fence" ? "#655443" : "#b86b22",
      };
      if (obstacles.some((obstacle) => footprintsOverlap(candidate, obstacle, 3))) continue;
      if (rocks.some((rock) => footprintsOverlap(candidate, rock, 4))) continue;
      if (covers.some((cover) => footprintsOverlap(candidate, cover, kind === "fence" ? 2.5 : 4))) continue;
      if (roofRamps.some((ramp) => rampIntersectsBuilding(ramp, candidate, 3))) continue;
      if (roads.some(([startX, startZ, endX, endZ]) =>
        pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= Math.max(width, depth) / 2 + 2
      )) continue;
      selected = candidate;
    }
    if (!selected) throw new Error(`Unable to place ${kind} cover ${index}`);
    covers.push(selected);
  }
  return covers;
}

function createTreeTrunks(
  terrainHills: readonly TerrainHill[],
  obstacles: readonly MapBuilding[],
  roofRamps: readonly RoofRamp[],
  rocks: readonly MapRockObstacle[],
  covers: readonly MapCoverObstacle[],
  landingZones: readonly MapPoint[],
  lootSpawnPoints: readonly Vector3State[],
  random: () => number,
): MapTreeTrunk[] {
  const trees: MapTreeTrunk[] = [];
  const roads = createMapRoadSegments(landingZones);
  const mountains = terrainHills.filter((hill) => hill.height >= 24);
  const blockedFootprints = [...obstacles, ...rocks, ...covers];
  const limit = MAP_HALF_SIZE - 35;
  for (let index = 0; index < TREE_TRUNK_COUNT; index += 1) {
    const treeScale = index % 11 === 0 ? 1.4 : 0.96 + (index % 4) * 0.025;
    const width = round(1.1 * treeScale * (0.92 + (index % 3) * 0.04));
    const height = round(5.8 * treeScale);
    const depth = round(1.1 * treeScale * 0.96);
    let selected: MapTreeTrunk | null = null;
    const tryPosition = (x: number, z: number): boolean => {
      if (Math.abs(x) + width / 2 > limit || Math.abs(z) + depth / 2 > limit) return false;
      const terrainRange = getFootprintTerrainRange(x, z, width, depth, terrainHills);
      if (terrainRange.maximum - terrainRange.minimum > 0.7) return false;
      const terrainY = terrainHeightFromHills(x, z, terrainHills);
      const candidate: MapTreeTrunk = {
        id: `tree-trunk-${index}`,
        kind: "tree-trunk",
        center: { x: round(x), y: round(terrainY + height / 2), z: round(z) },
        width,
        height,
        depth,
        color: "#6f5135",
      };
      if (blockedFootprints.some((obstacle) => footprintsOverlap(candidate, obstacle, 5))) {
        return false;
      }
      if (trees.some((tree) => footprintsOverlap(candidate, tree, 3))) return false;
      if (roofRamps.some((ramp) => rampIntersectsBuilding(ramp, candidate, 5))) return false;
      if (roads.some(([startX, startZ, endX, endZ]) =>
        pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= Math.max(width, depth) / 2 + 7
      )) return false;
      if (lootSpawnPoints.some((loot) =>
        Math.abs(loot.x - x) <= width / 2 + 3 && Math.abs(loot.z - z) <= depth / 2 + 3
      )) return false;
      selected = candidate;
      return true;
    };

    if (index < MOUNTAIN_TREE_TRUNK_COUNT) {
      for (let attempt = 0; attempt < 240 && !selected; attempt += 1) {
        const mountain = mountains[Math.floor(random() * mountains.length)];
        if (!mountain) break;
        const angle = random() * Math.PI * 2;
        const radius = mountain.radius * Math.sqrt(randomBetween(random, 0.02, 0.5));
        tryPosition(mountain.x + Math.cos(angle) * radius, mountain.z + Math.sin(angle) * radius);
      }
    }
    for (let attempt = 0; attempt < 1_200 && !selected; attempt += 1) {
      tryPosition(randomBetween(random, -limit, limit), randomBetween(random, -limit, limit));
    }
    if (!selected) throw new Error(`Unable to place tree trunk ${index}`);
    trees.push(selected);
  }
  return trees;
}

function footprintsOverlap(left: MapObstacle, right: MapObstacle, padding: number): boolean {
  return (
    Math.abs(left.center.x - right.center.x) < (left.width + right.width) / 2 + padding &&
    Math.abs(left.center.z - right.center.z) < (left.depth + right.depth) / 2 + padding
  );
}

function pointToSegmentDistance(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const progress = Math.max(0, Math.min(1, ((x - startX) * deltaX + (z - startZ) * deltaZ) / lengthSquared));
  return Math.hypot(x - (startX + deltaX * progress), z - (startZ + deltaZ * progress));
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

function createWallSegments(obstacles: readonly MapBuilding[], terrainHills: readonly TerrainHill[]): {
  wallSegments: MapWallSegment[];
  wallOpenings: MapWallOpening[];
} {
  const wallSegments: MapWallSegment[] = [];
  const wallOpenings: MapWallOpening[] = [];
  for (const obstacle of obstacles) {
    for (let storyIndex = 0; storyIndex < obstacle.storyCount; storyIndex += 1) {
      for (const side of ["front", "back", "left", "right"] as const) {
        const kind = storyIndex === 0 && side === "front" ? "door" : "window";
        const geometry = createFacadeGeometry(obstacle, storyIndex, side, kind, terrainHills);
        wallSegments.push(...geometry.wallSegments);
        wallOpenings.push(geometry.opening);
      }
    }
  }
  return { wallSegments, wallOpenings };
}

function createFacadeGeometry(
  building: MapBuilding,
  storyIndex: number,
  side: MapWallOpening["side"],
  kind: MapWallOpening["kind"],
  terrainHills: readonly TerrainHill[],
  openingCoordinate?: number,
): { wallSegments: MapWallSegment[]; opening: MapWallOpening } {
  const horizontalAlongX = side === "front" || side === "back";
  const span = horizontalAlongX ? building.width : building.depth;
  const openingWidth = kind === "door"
    ? Math.min(4.2, span * 0.34)
    : Math.min(horizontalAlongX ? 3.6 : 5.2, span * 0.3);
  const storyBottom = building.baseY + storyIndex * building.storyHeight;
  const storyTop = storyBottom + building.storyHeight;
  const position = facadePosition(building, side);
  const requestedOffset = openingCoordinate === undefined
    ? 0
    : openingCoordinate - (horizontalAlongX ? building.center.x : building.center.z);
  const maximumOpeningOffset = Math.max(
    0,
    span / 2 - openingWidth / 2 - BUILDING_WALL_THICKNESS - 0.8,
  );
  const openingOffset = Math.max(
    -maximumOpeningOffset,
    Math.min(maximumOpeningOffset, requestedOffset),
  );
  const localSupport = storyIndex === 0
    ? Math.max(storyBottom, terrainHeightFromHills(position.x, position.z, terrainHills))
    : storyBottom + BUILDING_ROOF_CAP_HEIGHT;
  const openingBottom = kind === "door" ? localSupport : localSupport + BUILDING_WINDOW_SILL_HEIGHT;
  const openingTop = kind === "door"
    ? Math.min(storyTop - 0.08, openingBottom + 3)
    : storyTop - 0.08;
  const openingHeight = openingTop - openingBottom;
  const opening: MapWallOpening = {
    id: `${building.id}-opening-${side}-${storyIndex}`,
    obstacleId: building.id,
    storyIndex,
    side,
    kind,
    center: {
      x: openingCoordinate === undefined
        ? position.x
        : horizontalAlongX ? round(building.center.x + openingOffset) : position.x,
      y: round((openingBottom + openingTop) / 2),
      z: openingCoordinate === undefined
        ? position.z
        : horizontalAlongX ? position.z : round(building.center.z + openingOffset),
    },
    width: round(openingWidth),
    height: round(openingHeight),
  };
  const segments: MapWallSegment[] = [];
  const addHorizontalPiece = (suffix: string, offset: number, width: number, centerY: number, height: number): void => {
    if (width <= 0.05 || height <= 0.05) return;
    const x = horizontalAlongX ? building.center.x + offset : position.x;
    const z = horizontalAlongX ? position.z : building.center.z + offset;
    segments.push(wallSegmentAt(
      building,
      `${side}-${storyIndex}-${suffix}`,
      x,
      centerY,
      z,
      horizontalAlongX ? width : BUILDING_WALL_THICKNESS,
      horizontalAlongX ? BUILDING_WALL_THICKNESS : width,
      height,
    ));
  };
  if (openingCoordinate === undefined) {
    const sidePieceSpan = (span - openingWidth) / 2;
    addHorizontalPiece("left", -(openingWidth + sidePieceSpan) / 2, sidePieceSpan, storyBottom + building.storyHeight / 2, building.storyHeight);
    addHorizontalPiece("right", (openingWidth + sidePieceSpan) / 2, sidePieceSpan, storyBottom + building.storyHeight / 2, building.storyHeight);
    addHorizontalPiece("sill", 0, openingWidth, (storyBottom + openingBottom) / 2, openingBottom - storyBottom);
    addHorizontalPiece("lintel", 0, openingWidth, (openingTop + storyTop) / 2, storyTop - openingTop);
  } else {
    const leftPieceSpan = span / 2 + openingOffset - openingWidth / 2;
    const rightPieceSpan = span / 2 - openingOffset - openingWidth / 2;
    addHorizontalPiece(
      "left",
      -span / 2 + leftPieceSpan / 2,
      leftPieceSpan,
      storyBottom + building.storyHeight / 2,
      building.storyHeight,
    );
    addHorizontalPiece(
      "right",
      openingOffset + openingWidth / 2 + rightPieceSpan / 2,
      rightPieceSpan,
      storyBottom + building.storyHeight / 2,
      building.storyHeight,
    );
    addHorizontalPiece(
      "sill",
      openingOffset,
      openingWidth,
      (storyBottom + openingBottom) / 2,
      openingBottom - storyBottom,
    );
    addHorizontalPiece(
      "lintel",
      openingOffset,
      openingWidth,
      (openingTop + storyTop) / 2,
      storyTop - openingTop,
    );
  }
  return { wallSegments: segments, opening };
}

function facadePosition(building: MapBuilding, side: MapWallOpening["side"]): { x: number; z: number } {
  if (side === "front") {
    return { x: building.center.x, z: round(building.center.z - building.depth / 2 + BUILDING_WALL_THICKNESS / 2) };
  }
  if (side === "back") {
    return { x: building.center.x, z: round(building.center.z + building.depth / 2 - BUILDING_WALL_THICKNESS / 2) };
  }
  if (side === "left") {
    return { x: round(building.center.x - building.width / 2 + BUILDING_WALL_THICKNESS / 2), z: building.center.z };
  }
  return { x: round(building.center.x + building.width / 2 - BUILDING_WALL_THICKNESS / 2), z: building.center.z };
}

function wallSegmentAt(
  obstacle: MapBuilding,
  suffix: string,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
): MapWallSegment {
  return {
    id: `${obstacle.id}-wall-${suffix}`,
    obstacleId: obstacle.id,
    center: { x: round(x), y: round(y), z: round(z) },
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
  rockObstacles: readonly MapRockObstacle[],
  coverObstacles: readonly MapCoverObstacle[],
  random: () => number,
  medicalRandom: () => number,
): { points: Vector3State[]; counts: number[] } {
  const counts = createLootZoneCounts(random);
  const allSelected: Vector3State[] = [];
  const outdoorBlockers = [...obstacles, ...rockObstacles, ...coverObstacles];
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
          y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
          z,
        };
        if (
          !isClearLootPoint(candidate, wallSegments, roofRamps, selected, outdoorBlockers, minimumSpacing) ||
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
        y: round(terrainHeightFromHills(obstacle.center.x, obstacle.center.z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT),
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
      const candidate = { x, y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT), z };
      if (
        isClearLootPoint(candidate, wallSegments, roofRamps, selected, outdoorBlockers, minimumSpacing) &&
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
  const medicalPoints: Vector3State[] = [];
  for (let slot = 0; slot < RANDOM_MEDICAL_LOOT_POINTS; slot += 1) {
    const landingZone = landingZones[slot % landingZones.length] ?? landingZones[0];
    if (!landingZone) throw new Error("Medical loot requires a landing zone");
    let placed = false;
    for (let attempt = 0; attempt < 320; attempt += 1) {
      const angle = medicalRandom() * Math.PI * 2;
      const radius = Math.sqrt(randomBetween(medicalRandom, 90 ** 2, 420 ** 2));
      const x = round(landingZone.position.x + Math.cos(angle) * radius);
      const z = round(landingZone.position.z + Math.sin(angle) * radius);
      const candidate = { x, y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT), z };
      if (!isClearLootPoint(candidate, wallSegments, roofRamps, allSelected, outdoorBlockers, 12)) continue;
      medicalPoints.push(candidate);
      allSelected.push(candidate);
      placed = true;
      break;
    }
    if (!placed) throw new Error(`Not enough open medical loot points for slot ${slot}`);
  }
  return { points: [...points, ...medicalPoints], counts };
}

function createHospitalMedicalPoints(
  hospital: MapBuilding,
  terrainHills: readonly TerrainHill[],
  wallSegments: readonly MapWallSegment[],
  roofRamps: readonly RoofRamp[],
  existingLoot: readonly Vector3State[],
): [Vector3State, Vector3State] {
  const xOffsets = [-1, 0, 1];
  const zOffsets = [-0.3, -0.15, 0, 0.15, 0.3].map((fraction) => hospital.depth * fraction);
  const candidates = xOffsets.flatMap((xOffset) => zOffsets.map((zOffset) => {
    const x = round(hospital.center.x + xOffset);
    const z = round(hospital.center.z + zOffset);
    return { x, y: round(terrainHeightFromHills(x, z, terrainHills) + GROUND_LOOT_POSITION_HEIGHT), z };
  })).filter((candidate) =>
    isClearLootPoint(candidate, wallSegments, roofRamps, existingLoot, [], 3)
  );
  let selected: [Vector3State, Vector3State] | null = null;
  let maximumDistance = 0;
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (!left) continue;
    for (const right of candidates.slice(leftIndex + 1)) {
      const distance = Math.hypot(left.x - right.x, left.z - right.z);
      if (distance >= 6 && distance > maximumDistance) {
        selected = [left, right];
        maximumDistance = distance;
      }
    }
  }
  if (!selected) throw new Error(`Hospital ${hospital.id} has no clear ground-floor medical points`);
  return selected;
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
