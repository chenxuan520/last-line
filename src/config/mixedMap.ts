import type { TownBuildingKind } from "./townMap";

export type MixedRegionKind = "town" | "rural" | "forest";

export interface MixedRegionSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: MixedRegionKind;
  readonly fixed: boolean;
  readonly centerX: number;
  readonly centerZ: number;
  readonly width: number;
  readonly depth: number;
}

export interface MixedPointSpec {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly regionId: string;
}

export interface MixedHillSpec {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly regionId: string;
}

export interface MixedBuildingSpec {
  readonly id: string;
  readonly regionId: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly storyCount: 1 | 2 | 3 | 4;
  readonly storyHeight: number;
  readonly color: string;
  readonly stairwellSide: -1 | 1;
  readonly townKind?: TownBuildingKind;
}

export interface MixedMapBlueprint {
  readonly regions: readonly MixedRegionSpec[];
  readonly mapPoints: readonly MixedPointSpec[];
  readonly landingZones: readonly MixedPointSpec[];
  readonly terrainHills: readonly MixedHillSpec[];
  readonly roadSegments: readonly (readonly [number, number, number, number])[];
  readonly urbanRoadSegments: readonly (readonly [number, number, number, number])[];
  readonly buildings: readonly MixedBuildingSpec[];
  readonly hospitalBuildingId: string;
}

interface RegionPosition {
  readonly centerX: number;
  readonly centerZ: number;
}

export const MIXED_REGION_COUNT = 6;
export const FIXED_MIXED_REGION_NAMES: Readonly<Record<MixedRegionKind, string>> = {
  town: "赤钟城区",
  rural: "风穗乡",
  forest: "沉杉岭",
};

export const MIXED_RANDOM_REGION_NAMES: Readonly<Record<MixedRegionKind, readonly string[]>> = {
  town: ["白塔旧城", "铜灯街区", "断桥坊"],
  rural: ["雁栖庄", "麦风坳", "石篱村"],
  forest: ["乌松岭", "雾鹿峰", "暮鸦山"],
};

export const MIXED_REGION_WIDTH = 780;
export const MIXED_REGION_DEPTH = 780;
export const MIXED_ROAD_HALF_WIDTH = 5;
export const MIXED_ROAD_SHOULDER_HALF_WIDTH = 8;
export const MIXED_TOWN_MINIMUM_OWNED_COVERAGE = 0.38;

const REGION_CENTER_LIMIT = 760;
const REGION_CENTER_MINIMUM_DISTANCE = 625;
const REGION_NEAREST_CENTER_MAXIMUM_DISTANCE = 820;
const REGION_CENTER_MAXIMUM_SPAN = 1_400;
const REGION_CENTER_MAXIMUM_AREA = 1_450_000;
const REGION_CONNECTOR_MAXIMUM_LENGTH = 820;
const REGION_CONNECTOR_MAXIMUM_TOTAL_LENGTH = 3_900;
const REGION_COORDINATE_SEPARATION = 36;
const MIXED_MAP_HALF_SIZE = 1_200;
const RANDOM_REGION_KINDS: readonly MixedRegionKind[] = ["town", "rural", "forest"];
const TOWN_COLORS = ["#5b605d", "#6a6259", "#555b55", "#756958", "#4f595c", "#67584e"] as const;
const RURAL_COLORS = ["#80715b", "#766953", "#8b7b60", "#685f50"] as const;
const FOREST_COLORS = ["#655b49", "#5d5547", "#71654f"] as const;
const TOWN_KINDS: readonly TownBuildingKind[] = [
  "factory",
  "warehouse",
  "rowhouse",
  "commercial",
  "corner",
  "tower",
];

export function createMixedMapBlueprint(seed: number): MixedMapBlueprint {
  const normalizedSeed = seed >>> 0;
  const regions = createMixedRegionSpecs(normalizedSeed);
  const mapPoints = regions.map<MixedPointSpec>((region) => ({
    name: region.name,
    x: region.centerX,
    z: region.centerZ,
    regionId: region.id,
  }));
  const landingZones = createLandingZones(regions, normalizedSeed);
  const { roadSegments, urbanRoadSegments } = createMixedRoadSegments(regions);
  const terrainHills = createMixedTerrainHills(regions, normalizedSeed);
  const buildings = createMixedBuildings(regions, landingZones, roadSegments, terrainHills, normalizedSeed);
  const fixedTown = regions.find((region) => region.fixed && region.kind === "town");
  if (!fixedTown) throw new Error("Mixed map fixed town region missing");
  const hospital = buildings.find((building) => building.regionId === fixedTown.id);
  if (!hospital) throw new Error("Mixed map hospital building missing");
  return {
    regions,
    mapPoints,
    landingZones,
    terrainHills,
    roadSegments,
    urbanRoadSegments,
    buildings,
    hospitalBuildingId: hospital.id,
  };
}

export function mixedFootprintClearsRoads(
  roads: readonly (readonly [number, number, number, number])[],
  x: number,
  z: number,
  width: number,
  depth: number,
  clearance = 0,
): boolean {
  return roads.every(([startX, startZ, endX, endZ]) =>
    !segmentIntersectsRectangle(
      startX,
      startZ,
      endX,
      endZ,
      x,
      z,
      width + (MIXED_ROAD_SHOULDER_HALF_WIDTH + clearance) * 2,
      depth + (MIXED_ROAD_SHOULDER_HALF_WIDTH + clearance) * 2,
    )
  );
}

export function pointInMixedRegion(
  region: MixedRegionSpec,
  x: number,
  z: number,
  inset = 0,
): boolean {
  return (
    Math.abs(x - region.centerX) <= region.width / 2 - inset &&
    Math.abs(z - region.centerZ) <= region.depth / 2 - inset
  );
}

export function pointOwnedByMixedRegion(
  regions: readonly MixedRegionSpec[],
  region: MixedRegionSpec,
  x: number,
  z: number,
): boolean {
  const distance = Math.hypot(x - region.centerX, z - region.centerZ);
  return regions.every((candidate) =>
    candidate.id === region.id ||
    distance <= Math.hypot(x - candidate.centerX, z - candidate.centerZ)
  );
}

export function mixedRegionOwnedArea(
  regions: readonly MixedRegionSpec[],
  region: MixedRegionSpec,
): number {
  return polygonArea(mixedRegionOwnedPolygon(regions, region));
}

export function mixedRegionBuildingCoverage(
  regions: readonly MixedRegionSpec[],
  region: MixedRegionSpec,
  buildings: readonly Pick<MixedBuildingSpec, "x" | "z" | "width" | "depth">[],
): number {
  const ownedPolygon = mixedRegionOwnedPolygon(regions, region);
  const ownedArea = polygonArea(ownedPolygon);
  if (ownedArea <= 0) return 0;
  const buildingArea = buildings.reduce((total, building) => {
    let polygon = ownedPolygon;
    polygon = clipPolygonToHalfPlane(
      polygon,
      1,
      0,
      building.x + building.width / 2,
    );
    polygon = clipPolygonToHalfPlane(
      polygon,
      -1,
      0,
      -building.x + building.width / 2,
    );
    polygon = clipPolygonToHalfPlane(
      polygon,
      0,
      1,
      building.z + building.depth / 2,
    );
    polygon = clipPolygonToHalfPlane(
      polygon,
      0,
      -1,
      -building.z + building.depth / 2,
    );
    return total + polygonArea(polygon);
  }, 0);
  return buildingArea / ownedArea;
}

function mixedRegionOwnedPolygon(
  regions: readonly MixedRegionSpec[],
  region: MixedRegionSpec,
): Array<readonly [number, number]> {
  let polygon: Array<readonly [number, number]> = [
    [region.centerX - region.width / 2, region.centerZ - region.depth / 2],
    [region.centerX + region.width / 2, region.centerZ - region.depth / 2],
    [region.centerX + region.width / 2, region.centerZ + region.depth / 2],
    [region.centerX - region.width / 2, region.centerZ + region.depth / 2],
  ];
  for (const other of regions) {
    if (other.id === region.id) continue;
    const coefficientX = 2 * (other.centerX - region.centerX);
    const coefficientZ = 2 * (other.centerZ - region.centerZ);
    const boundary =
      other.centerX ** 2 + other.centerZ ** 2 -
      region.centerX ** 2 - region.centerZ ** 2;
    polygon = clipPolygonToHalfPlane(
      polygon,
      coefficientX,
      coefficientZ,
      boundary,
    );
    if (polygon.length === 0) return [];
  }
  return polygon;
}

export function createMixedRegionSpecs(seed: number): MixedRegionSpec[] {
  const random = createSeededRandom(seed ^ 0x7f4a7c15);
  const fixedKinds: readonly MixedRegionKind[] = ["town", "rural", "forest"];
  const kinds = Array.from({ length: MIXED_REGION_COUNT }, (_, index) =>
    index < fixedKinds.length
      ? fixedKinds[index] as MixedRegionKind
      : RANDOM_REGION_KINDS[Math.floor(random() * RANDOM_REGION_KINDS.length)] as MixedRegionKind
  );
  const positions = createMixedRegionPositions(seed, kinds);
  const nameIndexes: Record<MixedRegionKind, number> = { town: 0, rural: 0, forest: 0 };
  return positions.map((position, index) => {
    const fixed = index < fixedKinds.length;
    const kind = kinds[index] as MixedRegionKind;
    const name = fixed
      ? FIXED_MIXED_REGION_NAMES[kind]
      : MIXED_RANDOM_REGION_NAMES[kind][nameIndexes[kind]++] as string;
    return {
      id: `mixed-region-${index}`,
      name,
      kind,
      fixed,
      centerX: position.centerX,
      centerZ: position.centerZ,
      width: MIXED_REGION_WIDTH,
      depth: MIXED_REGION_DEPTH,
    };
  });
}

function createMixedRegionPositions(
  seed: number,
  kinds: readonly MixedRegionKind[],
): RegionPosition[] {
  const random = createSeededRandom(seed ^ 0xb5297a4d);
  for (let layoutAttempt = 0; layoutAttempt < 2_048; layoutAttempt += 1) {
    const positions: RegionPosition[] = [];
    for (let regionIndex = 0; regionIndex < MIXED_REGION_COUNT; regionIndex += 1) {
      let selected: RegionPosition | null = null;
      for (let attempt = 0; attempt < 1_500; attempt += 1) {
        const candidate = {
          centerX: round(randomBetween(random, -REGION_CENTER_LIMIT, REGION_CENTER_LIMIT)),
          centerZ: round(randomBetween(random, -REGION_CENTER_LIMIT, REGION_CENTER_LIMIT)),
        };
        if (positions.some((position) =>
          Math.hypot(candidate.centerX - position.centerX, candidate.centerZ - position.centerZ) <
            REGION_CENTER_MINIMUM_DISTANCE ||
          Math.abs(candidate.centerX - position.centerX) < REGION_COORDINATE_SEPARATION ||
          Math.abs(candidate.centerZ - position.centerZ) < REGION_COORDINATE_SEPARATION
        )) continue;
        selected = candidate;
        break;
      }
      if (!selected) break;
      positions.push(selected);
    }
    if (positions.length !== MIXED_REGION_COUNT) continue;
    const xCoordinates = positions.map((position) => position.centerX);
    const zCoordinates = positions.map((position) => position.centerZ);
    const width = Math.max(...xCoordinates) - Math.min(...xCoordinates);
    const depth = Math.max(...zCoordinates) - Math.min(...zCoordinates);
    if (
      width > REGION_CENTER_MAXIMUM_SPAN ||
      depth > REGION_CENTER_MAXIMUM_SPAN ||
      width * depth > REGION_CENTER_MAXIMUM_AREA
    ) continue;
    const isolated = positions.some((position, index) =>
      Math.min(...positions
        .filter((_, otherIndex) => otherIndex !== index)
        .map((other) => Math.hypot(
          position.centerX - other.centerX,
          position.centerZ - other.centerZ,
        ))) > REGION_NEAREST_CENTER_MAXIMUM_DISTANCE
    );
    if (isolated) continue;
    const path = measureShortestCenterConnectors(positions);
    if (
      path.longestSegment > REGION_CONNECTOR_MAXIMUM_LENGTH ||
      path.totalLength > REGION_CONNECTOR_MAXIMUM_TOTAL_LENGTH
    ) continue;
    const connectorRegions = positions.map<MixedRegionSpec>((position, index) => ({
      id: `mixed-region-${index}`,
      name: "",
      kind: kinds[index] as MixedRegionKind,
      fixed: index < 3,
      centerX: position.centerX,
      centerZ: position.centerZ,
      width: MIXED_REGION_WIDTH,
      depth: MIXED_REGION_DEPTH,
    }));
    try {
      createRegionConnectorSegments(connectorRegions);
    } catch {
      continue;
    }
    return positions;
  }
  throw new Error("Mixed map compact region placement failed");
}

function createLandingZones(
  regions: readonly MixedRegionSpec[],
  seed: number,
): MixedPointSpec[] {
  const points: MixedPointSpec[] = [];
  regions.forEach((region, index) => {
    const random = createSeededRandom(seed ^ Math.imul(index + 1, 0x27d4eb2f));
    const pointCount = index < 4 ? 3 : 2;
    const offsets = region.kind === "town"
      ? createTownLandingOffsets(region, random, pointCount)
      : region.kind === "rural"
        ? createRuralLandingOffsets(region, random, pointCount)
        : createForestLandingOffsets(random, pointCount);
    for (const [pointIndex, [offsetX, offsetZ]] of offsets.entries()) {
      points.push({
        name: pointIndex === 0 ? region.name : `${region.name} ${pointIndex + 1}`,
        x: round(region.centerX + offsetX),
        z: round(region.centerZ + offsetZ),
        regionId: region.id,
      });
    }
  });
  return points;
}

function createTownLandingOffsets(
  region: MixedRegionSpec,
  random: () => number,
  count: number,
): Array<readonly [number, number]> {
  const xOffset = region.width * 0.2875;
  const zOffset = region.depth * 0.2875;
  const candidates: Array<readonly [number, number]> = [
    [-xOffset, 0],
    [xOffset, 0],
    [0, -zOffset],
    [0, zOffset],
  ];
  shuffleInPlace(candidates, random);
  return candidates.slice(0, count);
}

function createRuralLandingOffsets(
  region: MixedRegionSpec,
  random: () => number,
  count: number,
): Array<readonly [number, number]> {
  const deltaX = region.width - 120;
  const deltaZ = -region.depth * 0.38;
  const length = Math.hypot(deltaX, deltaZ);
  const directionX = deltaX / length;
  const directionZ = deltaZ / length;
  const side = random() < 0.5 ? -1 : 1;
  const progress = count === 3 ? [0, -165, 165] : [0, side * 165];
  return progress.map((distance) => [
    directionX * distance,
    directionZ * distance,
  ] as const);
}

function createForestLandingOffsets(
  random: () => number,
  count: number,
): Array<readonly [number, number]> {
  const offsets: Array<readonly [number, number]> = [[0, 0]];
  const baseAngle = random() * Math.PI * 2;
  for (let index = 1; index < count; index += 1) {
    const angle = baseAngle + (index - 1) * Math.PI + randomBetween(random, -0.12, 0.12);
    const radius = randomBetween(random, 155, 180);
    offsets.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
    ]);
  }
  return offsets;
}

function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [
      values[swapIndex] as T,
      values[index] as T,
    ];
  }
}

function createMixedRoadSegments(
  regions: readonly MixedRegionSpec[],
): {
  roadSegments: Array<readonly [number, number, number, number]>;
  urbanRoadSegments: Array<readonly [number, number, number, number]>;
} {
  const roads = createRegionConnectorSegments(regions);
  const urbanRoads: Array<readonly [number, number, number, number]> = [];
  for (const region of regions) {
    if (region.kind === "town") {
      for (const offset of [-region.depth * 0.2875, region.depth * 0.2875]) {
        const road = [
          region.centerX - region.width / 2 + 24,
          round(region.centerZ + offset),
          region.centerX + region.width / 2 - 24,
          round(region.centerZ + offset),
        ] as const;
        roads.push(road);
        urbanRoads.push(road);
      }
      for (const offset of [-region.width * 0.2875, region.width * 0.2875]) {
        const road = [
          round(region.centerX + offset),
          region.centerZ - region.depth / 2 + 24,
          round(region.centerX + offset),
          region.centerZ + region.depth / 2 - 24,
        ] as const;
        roads.push(road);
        urbanRoads.push(road);
      }
    } else if (region.kind === "rural") {
      roads.push([
        region.centerX - region.width / 2 + 60,
        round(region.centerZ + region.depth * 0.19),
        region.centerX + region.width / 2 - 60,
        round(region.centerZ - region.depth * 0.19),
      ]);
    }
  }
  return { roadSegments: roads, urbanRoadSegments: urbanRoads };
}

function createRegionConnectorSegments(
  regions: readonly MixedRegionSpec[],
): Array<readonly [number, number, number, number]> {
  const edges = regions.flatMap((left, leftIndex) =>
    regions.slice(leftIndex + 1).flatMap((right, offset) => {
      const rightIndex = leftIndex + offset + 1;
      const leftEndpoint = regionConnectorEndpoint(left, right);
      const rightEndpoint = regionConnectorEndpoint(right, left);
      if (regions.some((region, index) =>
        index !== leftIndex &&
        index !== rightIndex &&
        segmentIntersectsRectangle(
          leftEndpoint.x,
          leftEndpoint.z,
          rightEndpoint.x,
          rightEndpoint.z,
          region.centerX,
          region.centerZ,
          region.width - 140,
          region.depth - 140,
        )
      )) return [];
      return [{
        leftIndex,
        rightIndex,
        leftEndpoint,
        rightEndpoint,
        length: Math.hypot(
          rightEndpoint.x - leftEndpoint.x,
          rightEndpoint.z - leftEndpoint.z,
        ),
      }];
    })
  ).sort((left, right) =>
    left.length - right.length ||
    left.leftIndex - right.leftIndex ||
    left.rightIndex - right.rightIndex
  );
  const parents = regions.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index] as number] as number;
      index = parents[index] as number;
    }
    return index;
  };
  const connectors: Array<{
    leftIndex: number;
    rightIndex: number;
    segment: readonly [number, number, number, number];
  }> = [];
  for (const edge of edges) {
    const leftRoot = find(edge.leftIndex);
    const rightRoot = find(edge.rightIndex);
    if (leftRoot === rightRoot) continue;
    const segment = [
      edge.leftEndpoint.x,
      edge.leftEndpoint.z,
      edge.rightEndpoint.x,
      edge.rightEndpoint.z,
    ] as const;
    if (connectors.some((connector) =>
      segmentsIntersect(connector.segment, segment)
    )) continue;
    parents[rightRoot] = leftRoot;
    connectors.push({
      leftIndex: edge.leftIndex,
      rightIndex: edge.rightIndex,
      segment,
    });
    if (connectors.length === regions.length - 1) break;
  }
  if (connectors.length !== regions.length - 1) {
    throw new Error("Mixed map connector graph is not connected");
  }
  return connectors.map((connector) => connector.segment);
}

function regionConnectorEndpoint(
  region: MixedRegionSpec,
  target: Pick<MixedRegionSpec, "centerX" | "centerZ">,
): { x: number; z: number } {
  const deltaX = target.centerX - region.centerX;
  const deltaZ = target.centerZ - region.centerZ;
  if (region.kind !== "town") {
    const distance = Math.hypot(deltaX, deltaZ);
    const insetDistance = Math.min(region.width, region.depth) * 0.28;
    return {
      x: round(region.centerX + deltaX / distance * insetDistance),
      z: round(region.centerZ + deltaZ / distance * insetDistance),
    };
  }
  if (Math.abs(deltaX) >= Math.abs(deltaZ)) {
    return {
      x: round(region.centerX + Math.sign(deltaX || 1) * (region.width / 2 - 24)),
      z: round(region.centerZ + Math.sign(deltaZ || 1) * region.depth * 0.2875),
    };
  }
  return {
    x: round(region.centerX + Math.sign(deltaX || 1) * region.width * 0.2875),
    z: round(region.centerZ + Math.sign(deltaZ || 1) * (region.depth / 2 - 24)),
  };
}

function measureShortestCenterConnectors(
  regions: readonly Pick<MixedRegionSpec, "centerX" | "centerZ">[],
): { totalLength: number; longestSegment: number } {
  if (regions.length === 0) return { totalLength: 0, longestSegment: 0 };
  const connected = new Set<number>([0]);
  let totalLength = 0;
  let longestSegment = 0;
  while (connected.size < regions.length) {
    let nextIndex = -1;
    let shortestDistance = Number.POSITIVE_INFINITY;
    for (const leftIndex of connected) {
      const left = regions[leftIndex];
      if (!left) continue;
      for (let rightIndex = 0; rightIndex < regions.length; rightIndex += 1) {
        if (connected.has(rightIndex)) continue;
        const right = regions[rightIndex];
        if (!right) continue;
        const distance = Math.hypot(
          right.centerX - left.centerX,
          right.centerZ - left.centerZ,
        );
        if (distance < shortestDistance) {
          shortestDistance = distance;
          nextIndex = rightIndex;
        }
      }
    }
    if (nextIndex < 0) throw new Error("Mixed map center graph is not connected");
    connected.add(nextIndex);
    totalLength += shortestDistance;
    longestSegment = Math.max(longestSegment, shortestDistance);
  }
  return { totalLength, longestSegment };
}

function createMixedTerrainHills(
  regions: readonly MixedRegionSpec[],
  seed: number,
): MixedHillSpec[] {
  const hills: MixedHillSpec[] = [];
  for (const [regionIndex, region] of regions.entries()) {
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0x9e3779b1));
    if (region.kind === "forest") {
      const radius = round(randomBetween(random, 250, 280));
      hills.push({
        x: mixedHillCoordinate(random, region.centerX, -25, 25, radius),
        z: mixedHillCoordinate(random, region.centerZ, -35, 35, radius),
        radius,
        height: round(randomBetween(random, 34, 46)),
        regionId: region.id,
      });
      for (const direction of [-1, 1]) {
        const sideRadius = round(randomBetween(random, 145, 185));
        hills.push({
          x: mixedHillCoordinate(
            random,
            region.centerX,
            direction < 0 ? -145 : 105,
            direction < 0 ? -105 : 145,
            sideRadius,
          ),
          z: mixedHillCoordinate(
            random,
            region.centerZ,
            direction < 0 ? -120 : 0,
            direction < 0 ? 0 : 120,
            sideRadius,
          ),
          radius: sideRadius,
          height: round(randomBetween(random, 18, 28)),
          regionId: region.id,
        });
      }
    } else if (region.kind === "rural") {
      for (let index = 0; index < 2; index += 1) {
        const radius = round(randomBetween(random, 150, 210));
        hills.push({
          x: mixedHillCoordinate(random, region.centerX, -180, 180, radius),
          z: mixedHillCoordinate(random, region.centerZ, -260, 260, radius),
          radius,
          height: round(randomBetween(random, 3, 7)),
          regionId: region.id,
        });
      }
    }
  }
  return hills;
}

function mixedHillCoordinate(
  random: () => number,
  regionCenter: number,
  minimumOffset: number,
  maximumOffset: number,
  radius: number,
): number {
  const minimum = Math.max(
    regionCenter + minimumOffset,
    -MIXED_MAP_HALF_SIZE + radius,
  );
  const maximum = Math.min(
    regionCenter + maximumOffset,
    MIXED_MAP_HALF_SIZE - radius,
  );
  if (minimum > maximum) throw new Error("Mixed map hill footprint cannot fit inside the map");
  return round(randomBetween(random, minimum, maximum));
}

function createMixedBuildings(
  regions: readonly MixedRegionSpec[],
  landingZones: readonly MixedPointSpec[],
  roads: readonly (readonly [number, number, number, number])[],
  terrainHills: readonly MixedHillSpec[],
  seed: number,
): MixedBuildingSpec[] {
  const buildings: MixedBuildingSpec[] = [];
  for (const [regionIndex, region] of regions.entries()) {
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0x85ebca6b));
    const candidates = region.kind === "town"
      ? createTownBuildingCandidates(region, random)
      : createScatteredBuildingCandidates(region, random);
    const targetCount = region.kind === "town" ? 36 : region.kind === "rural" ? 9 : 2;
    for (const candidate of candidates) {
      if (buildings.filter((building) => building.regionId === region.id).length >= targetCount) break;
      if (!pointOwnedByMixedRegion(regions, region, candidate.x, candidate.z)) continue;
      if (!mixedFootprintClearsRoads(roads, candidate.x, candidate.z, candidate.width, candidate.depth, 1.5)) continue;
      if (landingZones.some((point) =>
        Math.abs(point.x - candidate.x) < candidate.width / 2 + 12 &&
        Math.abs(point.z - candidate.z) < candidate.depth / 2 + 12
      )) continue;
      if (buildings.some((building) => buildingsOverlap(building, candidate, 5))) continue;
      if (!buildingFootprintClearsTerrain(candidate, terrainHills)) continue;
      const localIndex = buildings.filter((building) => building.regionId === region.id).length;
      buildings.push({
        id: `mixed-building-${regionIndex}-${localIndex}`,
        regionId: region.id,
        x: round(candidate.x),
        z: round(candidate.z),
        width: round(candidate.width),
        depth: round(candidate.depth),
        storyCount: buildingStories(region.kind, localIndex, random),
        storyHeight: region.kind === "town" ? 4.6 : 4.2,
        color: buildingColor(region.kind, localIndex),
        stairwellSide: localIndex % 2 === 0 ? -1 : 1,
        ...(region.kind === "town" ? { townKind: TOWN_KINDS[localIndex % TOWN_KINDS.length] } : {}),
      });
    }
    const actualCount = buildings.filter((building) => building.regionId === region.id).length;
    if (actualCount !== targetCount) {
      throw new Error(`Mixed map ${region.kind} building generation failed: ${region.name} ${actualCount}/${targetCount}`);
    }
    if (region.kind === "town") {
      const coverage = mixedRegionBuildingCoverage(
        regions,
        region,
        buildings.filter((building) => building.regionId === region.id),
      );
      if (coverage < MIXED_TOWN_MINIMUM_OWNED_COVERAGE) {
        throw new Error(
          `Mixed map town density failed: ${region.name} ${coverage.toFixed(4)}/${MIXED_TOWN_MINIMUM_OWNED_COVERAGE}`,
        );
      }
    }
  }
  return buildings;
}

function buildingFootprintClearsTerrain(
  building: { x: number; z: number; width: number; depth: number },
  terrainHills: readonly MixedHillSpec[],
): boolean {
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;
  for (let xStep = 0; xStep <= 4; xStep += 1) {
    for (let zStep = 0; zStep <= 4; zStep += 1) {
      const x = building.x - building.width / 2 + building.width * xStep / 4;
      const z = building.z - building.depth / 2 + building.depth * zStep / 4;
      const height = terrainHeightFromSpecs(x, z, terrainHills);
      minimumHeight = Math.min(minimumHeight, height);
      maximumHeight = Math.max(maximumHeight, height);
    }
  }
  return maximumHeight - minimumHeight <= 0.8;
}

function terrainHeightFromSpecs(
  x: number,
  z: number,
  terrainHills: readonly MixedHillSpec[],
): number {
  let height = 0;
  for (const hill of terrainHills) {
    const distance = Math.hypot(x - hill.x, z - hill.z);
    if (distance >= hill.radius) continue;
    const normalized = 1 - distance / hill.radius;
    const smooth = normalized * normalized * (3 - 2 * normalized);
    height = Math.max(height, hill.height * smooth);
  }
  return height;
}

function createTownBuildingCandidates(
  region: MixedRegionSpec,
  random: () => number,
): Array<{ x: number; z: number; width: number; depth: number }> {
  const candidates: Array<{ x: number; z: number; width: number; depth: number }> = [];
  const xRoadOffset = region.width * 0.2875;
  const zRoadOffset = region.depth * 0.2875;
  const xCells = [
    [-region.width / 2 + 14, -xRoadOffset - 12],
    [-xRoadOffset + 12, -12],
    [12, xRoadOffset - 12],
    [xRoadOffset + 12, region.width / 2 - 14],
  ] as const;
  const zCells = [
    [-region.depth / 2 + 14, -zRoadOffset - 12],
    [-zRoadOffset + 12, -12],
    [12, zRoadOffset - 12],
    [zRoadOffset + 12, region.depth / 2 - 14],
  ] as const;
  for (const [zIndex, [minimumZ, maximumZ]] of zCells.entries()) {
    for (const [xIndex, [minimumX, maximumX]] of xCells.entries()) {
      const slotCount = (xIndex === 1 || xIndex === 2) && (zIndex === 1 || zIndex === 2) ? 3 : 2;
      const cellWidth = maximumX - minimumX;
      const slotDepth = (maximumZ - minimumZ) / slotCount;
      for (let slot = 0; slot < slotCount; slot += 1) {
        const slotMinimumZ = minimumZ + slot * slotDepth;
        const slotMaximumZ = slotMinimumZ + slotDepth;
        candidates.push({
          x: region.centerX + (minimumX + maximumX) / 2 + randomBetween(random, -2.5, 2.5),
          z: region.centerZ + (slotMinimumZ + slotMaximumZ) / 2 + randomBetween(random, -2.5, 2.5),
          width: cellWidth * randomBetween(random, 0.7, 0.74),
          depth: slotDepth * randomBetween(random, 0.7, 0.76),
        });
      }
    }
  }
  candidates.push(...Array.from({ length: 6_000 }, () => {
    return {
      x: randomBetween(random, region.centerX - region.width / 2 + 42, region.centerX + region.width / 2 - 42),
      z: randomBetween(random, region.centerZ - region.depth / 2 + 42, region.centerZ + region.depth / 2 - 42),
      width: randomBetween(random, 44, 72),
      depth: randomBetween(random, 38, 64),
    };
  }).sort((left, right) => right.width * right.depth - left.width * left.depth));
  candidates.push(...Array.from({ length: 12_000 }, () => {
    return {
      x: randomBetween(random, region.centerX - region.width / 2 + 35, region.centerX + region.width / 2 - 35),
      z: randomBetween(random, region.centerZ - region.depth / 2 + 35, region.centerZ + region.depth / 2 - 35),
      width: randomBetween(random, 34, 58),
      depth: randomBetween(random, 30, 52),
    };
  }));
  return candidates;
}

function createScatteredBuildingCandidates(
  region: MixedRegionSpec,
  random: () => number,
): Array<{ x: number; z: number; width: number; depth: number }> {
  return Array.from({ length: 4_000 }, () => ({
    x: randomBetween(random, region.centerX - region.width / 2 + 45, region.centerX + region.width / 2 - 45),
    z: randomBetween(random, region.centerZ - region.depth / 2 + 55, region.centerZ + region.depth / 2 - 55),
    width: region.kind === "rural" ? randomBetween(random, 24, 34) : randomBetween(random, 20, 28),
    depth: region.kind === "rural" ? randomBetween(random, 28, 40) : randomBetween(random, 24, 34),
  }));
}

function buildingStories(
  kind: MixedRegionKind,
  index: number,
  random: () => number,
): 1 | 2 | 3 | 4 {
  if (kind !== "town") return kind === "rural" && index % 5 === 0 ? 2 : 1;
  if (index === 0) return 2;
  const value = random();
  return value < 0.08 ? 4 : value < 0.32 ? 3 : value < 0.68 ? 2 : 1;
}

function buildingColor(kind: MixedRegionKind, index: number): string {
  const colors = kind === "town" ? TOWN_COLORS : kind === "rural" ? RURAL_COLORS : FOREST_COLORS;
  return colors[index % colors.length] as string;
}

function buildingsOverlap(
  left: { x: number; z: number; width: number; depth: number },
  right: { x: number; z: number; width: number; depth: number },
  padding: number,
): boolean {
  return (
    Math.abs(left.x - right.x) < (left.width + right.width) / 2 + padding &&
    Math.abs(left.z - right.z) < (left.depth + right.depth) / 2 + padding
  );
}

function segmentIntersectsRectangle(
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
  if (
    Math.max(startX, endX) < minimumX ||
    Math.min(startX, endX) > maximumX ||
    Math.max(startZ, endZ) < minimumZ ||
    Math.min(startZ, endZ) > maximumZ
  ) return false;
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

function segmentsIntersect(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  const [leftStartX, leftStartZ, leftEndX, leftEndZ] = left;
  const [rightStartX, rightStartZ, rightEndX, rightEndZ] = right;
  const leftDeltaX = leftEndX - leftStartX;
  const leftDeltaZ = leftEndZ - leftStartZ;
  const rightDeltaX = rightEndX - rightStartX;
  const rightDeltaZ = rightEndZ - rightStartZ;
  const denominator = leftDeltaX * rightDeltaZ - leftDeltaZ * rightDeltaX;
  const offsetX = rightStartX - leftStartX;
  const offsetZ = rightStartZ - leftStartZ;
  if (Math.abs(denominator) < 1e-9) return false;
  const leftProgress = (offsetX * rightDeltaZ - offsetZ * rightDeltaX) / denominator;
  const rightProgress = (offsetX * leftDeltaZ - offsetZ * leftDeltaX) / denominator;
  return (
    leftProgress > 1e-6 &&
    leftProgress < 1 - 1e-6 &&
    rightProgress > 1e-6 &&
    rightProgress < 1 - 1e-6
  );
}

function clipPolygonToHalfPlane(
  polygon: readonly (readonly [number, number])[],
  coefficientX: number,
  coefficientZ: number,
  boundary: number,
): Array<readonly [number, number]> {
  const clipped: Array<readonly [number, number]> = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index] as readonly [number, number];
    const end = polygon[(index + 1) % polygon.length] as readonly [number, number];
    const startValue = coefficientX * start[0] + coefficientZ * start[1] - boundary;
    const endValue = coefficientX * end[0] + coefficientZ * end[1] - boundary;
    const startInside = startValue <= 1e-9;
    const endInside = endValue <= 1e-9;
    if (startInside) clipped.push(start);
    if (startInside === endInside) continue;
    const progress = startValue / (startValue - endValue);
    clipped.push([
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
    ]);
  }
  return clipped;
}

function polygonArea(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 3) return 0;
  return Math.abs(polygon.reduce((area, [x, z], index) => {
    const [nextX, nextZ] = polygon[(index + 1) % polygon.length] as readonly [number, number];
    return area + x * nextZ - nextX * z;
  }, 0)) / 2;
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
