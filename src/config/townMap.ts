export interface TownPointSpec {
  name: string;
  x: number;
  z: number;
}

export type TownBuildingKind =
  | "factory"
  | "warehouse"
  | "rowhouse"
  | "commercial"
  | "corner"
  | "tower";

export interface TownBuildingSpec {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  storyCount: 1 | 2 | 3 | 4 | 5;
  storyHeight: number;
  color: string;
  stairwellSide: -1 | 1;
  kind: TownBuildingKind;
}

export interface TownSkybridgeSpec {
  id: string;
  fromBuildingId: string;
  toBuildingId: string;
  fromSide: "left" | "right";
  toSide: "left" | "right";
}

export interface TownMapBlueprint {
  mapPoints: TownPointSpec[];
  landingZones: TownPointSpec[];
  roadSegments: Array<readonly [number, number, number, number]>;
  buildings: TownBuildingSpec[];
  skybridges: TownSkybridgeSpec[];
  hospitalBuildingId: string;
}

const CORE_BLOCK_COUNT = 8;
const CORE_BLOCK_PITCH = 180;
const CORE_BUILDINGS_PER_BLOCK = 6;
const CORE_BUILDING_COUNT = CORE_BLOCK_COUNT * CORE_BLOCK_COUNT * CORE_BUILDINGS_PER_BLOCK;
const PERIMETER_BUILDING_COUNT = 64;
const TOTAL_BUILDING_COUNT = CORE_BUILDING_COUNT + PERIMETER_BUILDING_COUNT;
const HIGH_STORY_BUILDING_COUNT = 54;
const MULTI_STORY_BUILDING_COUNT = 233;
const SKYBRIDGE_COUNT = 32;
const STORY_HEIGHT = 4.6;
const CORE_CENTERS = Array.from(
  { length: CORE_BLOCK_COUNT },
  (_, index) => -630 + index * CORE_BLOCK_PITCH,
);
const TOWN_COLORS = ["#59605f", "#6a6259", "#545b55", "#756958", "#4f595c", "#66584f"] as const;
const BUILDING_KINDS = [
  "factory",
  "warehouse",
  "rowhouse",
  "commercial",
  "corner",
  "tower",
] as const;

const MAP_POINTS: readonly TownPointSpec[] = [
  { name: "灰炉广场", x: 0, z: 0 },
  { name: "铸造工业园", x: -540, z: -540 },
  { name: "旧火车站", x: 540, z: -540 },
  { name: "工人住宅区", x: -540, z: 540 },
  { name: "仓储港区", x: 540, z: 540 },
  { name: "老城区", x: 0, z: 540 },
  { name: "商业街", x: 0, z: -540 },
  { name: "城市公园", x: 540, z: 0 },
];

const SECONDARY_POINTS: readonly TownPointSpec[] = [
  { name: "北部货场", x: -270, z: 810 },
  { name: "炉渣仓库", x: 270, z: 810 },
  { name: "西侧厂区", x: -810, z: -270 },
  { name: "旧供电站", x: -810, z: 270 },
  { name: "东部车场", x: 810, z: -270 },
  { name: "废水工场", x: 810, z: 270 },
  { name: "南部工棚", x: -270, z: -810 },
  { name: "物流站场", x: 270, z: -810 },
];

export function createTownMapBlueprint(seed: number): TownMapBlueprint {
  const random = createSeededRandom(seed ^ 0x4f1bbcdc);
  const buildings = createBuildingSpecs(random);
  const bridgeBlocks = shuffledIndexes(
    CORE_BLOCK_COUNT * CORE_BLOCK_COUNT,
    createSeededRandom(seed ^ 0x7f4a7c15),
  ).slice(0, SKYBRIDGE_COUNT);
  const bridgeBuildingIds = new Set<string>();
  for (const blockIndex of bridgeBlocks) {
    const from = buildings.find((building) => building.id === coreBuildingId(blockIndex, 0));
    const to = buildings.find((building) => building.id === coreBuildingId(blockIndex, 1));
    if (!from || !to) throw new Error(`Town skybridge endpoint building missing for block ${blockIndex}`);
    from.stairwellSide = -1;
    to.stairwellSide = 1;
    bridgeBuildingIds.add(from.id);
    bridgeBuildingIds.add(to.id);
  }
  assignStories(buildings, bridgeBuildingIds, createSeededRandom(seed ^ 0x85ebca6b));
  const skybridges = bridgeBlocks.map((blockIndex, index) => ({
    id: `town-skybridge-${index}`,
    fromBuildingId: coreBuildingId(blockIndex, 0),
    toBuildingId: coreBuildingId(blockIndex, 1),
    fromSide: "right" as const,
    toSide: "left" as const,
  }));
  const hospital = buildings
    .filter((building) => building.storyCount >= 2)
    .sort((left, right) =>
      distanceSquared(left.x, left.z, -540, 0) - distanceSquared(right.x, right.z, -540, 0) ||
      left.id.localeCompare(right.id)
    )[0];
  if (!hospital) throw new Error("Town hospital building missing");
  return {
    mapPoints: MAP_POINTS.map((point) => ({ ...point })),
    landingZones: [...MAP_POINTS, ...SECONDARY_POINTS].map((point) => ({ ...point })),
    roadSegments: createRoadSegments(),
    buildings,
    skybridges,
    hospitalBuildingId: hospital.id,
  };
}

function createBuildingSpecs(random: () => number): TownBuildingSpec[] {
  const buildings: TownBuildingSpec[] = [];
  for (let blockZ = 0; blockZ < CORE_BLOCK_COUNT; blockZ += 1) {
    for (let blockX = 0; blockX < CORE_BLOCK_COUNT; blockX += 1) {
      const blockIndex = blockZ * CORE_BLOCK_COUNT + blockX;
      const centerX = CORE_CENTERS[blockX] ?? 0;
      const centerZ = CORE_CENTERS[blockZ] ?? 0;
      for (let localIndex = 0; localIndex < CORE_BUILDINGS_PER_BLOCK; localIndex += 1) {
        const column = localIndex % 3;
        const row = Math.floor(localIndex / 3);
        const kind = buildingKind(buildings.length);
        const [width, depth] = coreBuildingDimensions(kind, random);
        buildings.push(buildingSpec(
          coreBuildingId(blockIndex, localIndex),
          centerX + (column - 1) * 52,
          centerZ + (row === 0 ? -35 : 35),
          width,
          depth,
          buildings.length,
          random,
        ));
      }
    }
  }
  const perimeterCoordinates = Array.from({ length: 16 }, (_, index) => -825 + index * 110);
  for (const coordinate of perimeterCoordinates) {
    buildings.push(buildingSpec(`town-perimeter-north-${coordinate}`, coordinate, 940, 72, 42, buildings.length, random));
    buildings.push(buildingSpec(`town-perimeter-south-${coordinate}`, coordinate, -940, 72, 42, buildings.length, random));
    buildings.push(buildingSpec(`town-perimeter-east-${coordinate}`, 940, coordinate, 42, 72, buildings.length, random));
    buildings.push(buildingSpec(`town-perimeter-west-${coordinate}`, -940, coordinate, 42, 72, buildings.length, random));
  }
  if (buildings.length !== TOTAL_BUILDING_COUNT) throw new Error("Town building count mismatch");
  return buildings;
}

function buildingSpec(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  index: number,
  random: () => number,
): TownBuildingSpec {
  return {
    id,
    x,
    z,
    width,
    depth,
    storyCount: 1,
    storyHeight: STORY_HEIGHT,
    color: TOWN_COLORS[index % TOWN_COLORS.length] ?? "#59605f",
    stairwellSide: random() < 0.5 ? -1 : 1,
    kind: buildingKind(index),
  };
}

function buildingKind(index: number): TownBuildingKind {
  return BUILDING_KINDS[index % BUILDING_KINDS.length] ?? "factory";
}

function coreBuildingDimensions(
  kind: TownBuildingKind,
  random: () => number,
): readonly [number, number] {
  const widthJitter = Math.floor(random() * 3);
  const depthJitter = Math.floor(random() * 3);
  switch (kind) {
    case "factory":
      return [48 + widthJitter, 62 + depthJitter];
    case "warehouse":
      return [49 + widthJitter, 58 + depthJitter];
    case "rowhouse":
      return [45 + widthJitter, 62 + depthJitter];
    case "commercial":
      return [48 + widthJitter, 58 + depthJitter];
    case "corner":
      return [48 + widthJitter, 60 + depthJitter];
    case "tower":
      return [44 + widthJitter, 56 + depthJitter];
  }
}

function assignStories(
  buildings: TownBuildingSpec[],
  bridgeBuildingIds: ReadonlySet<string>,
  random: () => number,
): void {
  const ranked = buildings
    .map((building) => ({ building, score: random() }))
    .sort((left, right) => left.score - right.score || left.building.id.localeCompare(right.building.id));
  const bridgeBuildings = ranked.filter(({ building }) => bridgeBuildingIds.has(building.id));
  const otherBuildings = ranked.filter(({ building }) => !bridgeBuildingIds.has(building.id));
  const highStory = otherBuildings
    .filter(({ building }) => building.kind === "tower")
    .slice(0, HIGH_STORY_BUILDING_COUNT);
  const highIds = new Set(highStory.map(({ building }) => building.id));
  const multiStory = [
    ...highStory,
    ...bridgeBuildings,
    ...otherBuildings.filter(({ building }) => !highIds.has(building.id)),
  ].slice(0, MULTI_STORY_BUILDING_COUNT);
  const multiIds = new Set(multiStory.map(({ building }) => building.id));
  for (const [index, building] of buildings.entries()) {
    if (highIds.has(building.id)) {
      building.storyCount = index % 2 === 0 ? 4 : 5;
    } else if (multiIds.has(building.id)) {
      building.storyCount = index % 3 === 0 ? 3 : 2;
    }
  }
}

function createRoadSegments(): Array<readonly [number, number, number, number]> {
  const roads = Array.from({ length: 9 }, (_, index) => -720 + index * 180);
  return [
    ...roads.map((x) => [x, -850, x, 850] as const),
    ...roads.map((z) => [-850, z, 850, z] as const),
  ];
}

function coreBuildingId(blockIndex: number, localIndex: number): string {
  return `town-building-${blockIndex}-${localIndex}`;
}

function shuffledIndexes(count: number, random: () => number): number[] {
  const values = Array.from({ length: count }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target] as number, values[index] as number];
  }
  return values;
}

function distanceSquared(x: number, z: number, targetX: number, targetZ: number): number {
  return (x - targetX) ** 2 + (z - targetZ) ** 2;
}

function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
