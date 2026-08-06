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

interface RegionSlot {
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

export const MIXED_REGION_WIDTH = 640;
export const MIXED_REGION_DEPTH = 880;
export const MIXED_ROAD_HALF_WIDTH = 5;
export const MIXED_ROAD_SHOULDER_HALF_WIDTH = 8;

const REGION_SLOTS: readonly RegionSlot[] = [
  { centerX: -760, centerZ: -560 },
  { centerX: 0, centerZ: -560 },
  { centerX: 760, centerZ: -560 },
  { centerX: -760, centerZ: 560 },
  { centerX: 0, centerZ: 560 },
  { centerX: 760, centerZ: 560 },
];
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
  const landingZones = createLandingZones(regions);
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

export function createMixedRegionSpecs(seed: number): MixedRegionSpec[] {
  const random = createSeededRandom(seed ^ 0x7f4a7c15);
  const fixedKinds: readonly MixedRegionKind[] = ["town", "rural", "forest"];
  const nameIndexes: Record<MixedRegionKind, number> = { town: 0, rural: 0, forest: 0 };
  return REGION_SLOTS.map((slot, index) => {
    const fixed = index < fixedKinds.length;
    const kind = fixed
      ? fixedKinds[index] as MixedRegionKind
      : RANDOM_REGION_KINDS[Math.floor(random() * RANDOM_REGION_KINDS.length)] as MixedRegionKind;
    const name = fixed
      ? FIXED_MIXED_REGION_NAMES[kind]
      : MIXED_RANDOM_REGION_NAMES[kind][nameIndexes[kind]++] as string;
    return {
      id: `mixed-region-${index}`,
      name,
      kind,
      fixed,
      centerX: slot.centerX,
      centerZ: slot.centerZ,
      width: MIXED_REGION_WIDTH,
      depth: MIXED_REGION_DEPTH,
    };
  });
}

function createLandingZones(regions: readonly MixedRegionSpec[]): MixedPointSpec[] {
  const points = regions.map<MixedPointSpec>((region) => ({
    name: region.name,
    x: region.centerX,
    z: region.centerZ,
    regionId: region.id,
  }));
  regions.forEach((region, index) => {
    const offsets = index < 4
      ? [[-150, 0], [150, 0]] as const
      : [[0, 150]] as const;
    offsets.forEach(([offsetX, offsetZ], offsetIndex) => {
      points.push({
        name: `${region.name} ${offsetIndex + 2}`,
        x: region.centerX + offsetX,
        z: region.centerZ + offsetZ,
        regionId: region.id,
      });
    });
  });
  return points;
}

function createMixedRoadSegments(
  regions: readonly MixedRegionSpec[],
): {
  roadSegments: Array<readonly [number, number, number, number]>;
  urbanRoadSegments: Array<readonly [number, number, number, number]>;
} {
  const roads: Array<readonly [number, number, number, number]> = [
    [-760, -560, 0, -560],
    [0, -560, 760, -560],
    [-760, 560, 0, 560],
    [0, 560, 760, 560],
    [-760, -560, -760, 560],
    [0, -560, 0, 560],
    [760, -560, 760, 560],
  ];
  const urbanRoads: Array<readonly [number, number, number, number]> = [];
  for (const region of regions) {
    if (region.kind === "town") {
      for (const offset of [-252, 252]) {
        const road = [
          region.centerX - region.width / 2 + 24,
          region.centerZ + offset,
          region.centerX + region.width / 2 - 24,
          region.centerZ + offset,
        ] as const;
        roads.push(road);
        urbanRoads.push(road);
      }
      for (const offset of [-184, 184]) {
        const road = [
          region.centerX + offset,
          region.centerZ - region.depth / 2 + 24,
          region.centerX + offset,
          region.centerZ + region.depth / 2 - 24,
        ] as const;
        roads.push(road);
        urbanRoads.push(road);
      }
    } else if (region.kind === "rural") {
      roads.push([
        region.centerX - region.width / 2 + 60,
        region.centerZ + 170,
        region.centerX + region.width / 2 - 60,
        region.centerZ - 170,
      ]);
    }
  }
  return { roadSegments: roads, urbanRoadSegments: urbanRoads };
}

function createMixedTerrainHills(
  regions: readonly MixedRegionSpec[],
  seed: number,
): MixedHillSpec[] {
  const hills: MixedHillSpec[] = [];
  for (const [regionIndex, region] of regions.entries()) {
    const random = createSeededRandom(seed ^ Math.imul(regionIndex + 1, 0x9e3779b1));
    if (region.kind === "forest") {
      hills.push({
        x: round(region.centerX + randomBetween(random, -25, 25)),
        z: round(region.centerZ + randomBetween(random, -35, 35)),
        radius: round(randomBetween(random, 250, 280)),
        height: round(randomBetween(random, 34, 46)),
        regionId: region.id,
      });
      for (const direction of [-1, 1]) {
        hills.push({
          x: round(region.centerX + direction * randomBetween(random, 105, 145)),
          z: round(region.centerZ + direction * randomBetween(random, -120, 120)),
          radius: round(randomBetween(random, 145, 185)),
          height: round(randomBetween(random, 18, 28)),
          regionId: region.id,
        });
      }
    } else if (region.kind === "rural") {
      for (let index = 0; index < 2; index += 1) {
        hills.push({
          x: round(region.centerX + randomBetween(random, -180, 180)),
          z: round(region.centerZ + randomBetween(random, -260, 260)),
          radius: round(randomBetween(random, 150, 210)),
          height: round(randomBetween(random, 3, 7)),
          regionId: region.id,
        });
      }
    }
  }
  return hills;
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
      if (!mixedFootprintClearsRoads(roads, candidate.x, candidate.z, candidate.width, candidate.depth, 1.5)) continue;
      if (landingZones.some((point) =>
        point.regionId === region.id &&
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
  const xCells = [
    [-306, -196],
    [-172, -12],
    [12, 172],
    [196, 306],
  ] as const;
  const zCells = [
    [-426, -264],
    [-240, -12],
    [12, 240],
    [264, 426],
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
  candidates.push(...Array.from({ length: 4_000 }, () => {
    const [minimumX, maximumX] = xCells[Math.floor(random() * xCells.length)] ?? xCells[0];
    const [minimumZ, maximumZ] = zCells[Math.floor(random() * zCells.length)] ?? zCells[0];
    const cellWidth = maximumX - minimumX;
    const cellDepth = maximumZ - minimumZ;
    return {
      x: region.centerX + randomBetween(random, minimumX + 30, maximumX - 30),
      z: region.centerZ + randomBetween(random, minimumZ + 30, maximumZ - 30),
      width: cellWidth * randomBetween(random, 0.42, 0.52),
      depth: cellDepth * randomBetween(random, 0.28, 0.38),
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
