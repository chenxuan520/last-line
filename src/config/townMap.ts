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

interface TownParcel {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

interface TownBuildingGeometry {
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface TownStreetGrid {
  verticalRoads: number[];
  horizontalRoads: number[];
  verticalEdges: boolean[][];
  horizontalEdges: boolean[][];
  roadSegments: Array<readonly [number, number, number, number]>;
}

const CORE_BLOCK_COUNT = 8;
const CORE_BUILDINGS_PER_BLOCK = 6;
const CORE_ROAD_EXTENT = 720;
const MINIMUM_BLOCK_SPAN = 150;
const MAXIMUM_BLOCK_SPAN = 205;
const ROAD_BUILDING_SETBACK = 14.25;
const MERGED_BLOCK_SETBACK = 7;
const PUBLIC_SPACE_STRIP_DEPTH = 24;
const ROAD_NODE_JITTER = 7;
const MINIMUM_PARCEL_SPAN = 34;
const MINIMUM_PARCEL_AREA = 1_450;
const MINIMUM_BUILDING_SPAN = 28;
const MAXIMUM_BUILDING_ASPECT_RATIO = 3.2;
export const TOWN_ROAD_HALF_WIDTH = 3.75;
export const TOWN_ROAD_SHOULDER_HALF_WIDTH = 6;
export const TOWN_POINT_OBSTACLE_CLEARANCE = 1.5;
export const TOWN_POINT_HALF_WIDTH = 4;
export const TOWN_POINT_HALF_DEPTH = 9;
const TOWN_POINT_ENTRANCE_HALF_WIDTH = 4.1;
const TOWN_POINT_ENTRANCE_DEPTH = 10;
const TOWN_POINT_CANDIDATE_COUNT = 192;
const CORE_BUILDING_COUNT = CORE_BLOCK_COUNT * CORE_BLOCK_COUNT * CORE_BUILDINGS_PER_BLOCK;
const PERIMETER_BUILDING_COUNT = 64;
const TOTAL_BUILDING_COUNT = CORE_BUILDING_COUNT + PERIMETER_BUILDING_COUNT;
const HIGH_STORY_BUILDING_COUNT = 54;
const MULTI_STORY_BUILDING_COUNT = 233;
const SKYBRIDGE_COUNT = 32;
const STORY_HEIGHT = 4.6;
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
const MAP_POINT_BLOCKS = [
  [3, 3],
  [1, 1],
  [6, 1],
  [1, 6],
  [6, 6],
  [3, 6],
  [3, 1],
  [6, 3],
] as const;
const SECONDARY_POINT_BLOCKS = [
  [2, 7],
  [5, 7],
  [0, 2],
  [0, 5],
  [7, 2],
  [7, 5],
  [2, 0],
  [5, 0],
] as const;
const POINT_BLOCKS = new Set(
  [...MAP_POINT_BLOCKS, ...SECONDARY_POINT_BLOCKS].map(([x, z]) => `${x}:${z}`),
);
const BLOCK_BUILDING_KINDS: readonly (readonly TownBuildingKind[])[] = [
  ["factory", "warehouse", "factory", "commercial", "warehouse", "tower"],
  ["rowhouse", "commercial", "corner", "rowhouse", "commercial", "tower"],
  BUILDING_KINDS,
];

export function createTownMapBlueprint(seed: number): TownMapBlueprint {
  const random = createSeededRandom(seed ^ 0x4f1bbcdc);
  const streetGrid = createStreetGrid(createSeededRandom(seed ^ 0x2f6e2b1d));
  const buildings = createBuildingSpecs(streetGrid, random);
  const mapPointRandom = createSeededRandom(seed ^ 0x8da6b343);
  const mapPoints = MAP_POINTS.map((point, index) =>
    pointForBlock(
      point,
      streetGrid,
      MAP_POINT_BLOCKS[index] ?? [3, 3],
      buildings,
      streetGrid.roadSegments,
      mapPointRandom,
    )
  );
  const secondaryPoints = SECONDARY_POINTS.map((point, index) =>
    pointForBlock(
      point,
      streetGrid,
      SECONDARY_POINT_BLOCKS[index] ?? [3, 3],
      buildings,
      streetGrid.roadSegments,
      mapPointRandom,
    )
  );
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
    mapPoints,
    landingZones: [...mapPoints, ...secondaryPoints],
    roadSegments: createRoadSegments(streetGrid),
    buildings,
    skybridges,
    hospitalBuildingId: hospital.id,
  };
}

function pointForBlock(
  point: TownPointSpec,
  streetGrid: TownStreetGrid,
  block: readonly [number, number],
  buildings: readonly TownBuildingSpec[],
  roads: readonly (readonly [number, number, number, number])[],
  random: () => number,
): TownPointSpec {
  const minimumX = streetGrid.verticalRoads[block[0]];
  const maximumX = streetGrid.verticalRoads[block[0] + 1];
  const minimumZ = streetGrid.horizontalRoads[block[1]];
  const maximumZ = streetGrid.horizontalRoads[block[1] + 1];
  if (minimumX === undefined || maximumX === undefined || minimumZ === undefined || maximumZ === undefined) {
    throw new Error(`Town point block missing: ${point.name}`);
  }
  const horizontalPadding = TOWN_ROAD_SHOULDER_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE;
  const minimumPointX = minimumX + horizontalPadding + TOWN_POINT_HALF_WIDTH;
  const maximumPointX = maximumX - horizontalPadding - TOWN_POINT_HALF_WIDTH;
  const minimumPointZ = minimumZ + horizontalPadding + TOWN_POINT_HALF_DEPTH;
  const maximumPointZ = maximumZ - horizontalPadding - TOWN_POINT_HALF_DEPTH;
  const pointClearsMap = (candidate: { x: number; z: number }): boolean =>
    buildings.every((building) => pointClearsTownBuilding(candidate, building)) &&
    townFootprintClearsRoads(
      roads,
      candidate.x,
      candidate.z,
      TOWN_POINT_HALF_WIDTH * 2,
      TOWN_POINT_HALF_DEPTH * 2,
      TOWN_POINT_OBSTACLE_CLEARANCE,
    );
  for (let attempt = 0; attempt < TOWN_POINT_CANDIDATE_COUNT; attempt += 1) {
    const edge = attempt < TOWN_POINT_CANDIDATE_COUNT * 0.75 ? Math.floor(random() * 4) : -1;
    const inset = randomBetween(random, 0, 4);
    const candidate = {
      x: edge === 0 ? minimumPointX + inset : edge === 1 ? maximumPointX - inset :
        randomBetween(random, minimumPointX, maximumPointX),
      z: edge === 2 ? minimumPointZ + inset : edge === 3 ? maximumPointZ - inset :
        randomBetween(random, minimumPointZ, maximumPointZ),
    };
    if (pointClearsMap(candidate)) return { ...point, ...candidate };
  }
  for (let x = minimumPointX; x <= maximumPointX; x += 4) {
    for (let z = minimumPointZ; z <= maximumPointZ; z += 4) {
      if (pointClearsMap({ x, z })) return { ...point, x, z };
    }
  }
  throw new Error(`Town point block has no clear public space: ${point.name}`);
}

function pointClearsTownBuilding(
  candidate: { x: number; z: number },
  building: TownBuildingSpec,
): boolean {
  const clearanceX = TOWN_POINT_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE;
  const clearanceZ = TOWN_POINT_HALF_DEPTH + TOWN_POINT_OBSTACLE_CLEARANCE;
  const clearsFootprint =
    Math.abs(candidate.x - building.x) > building.width / 2 + clearanceX ||
    Math.abs(candidate.z - building.z) > building.depth / 2 + clearanceZ;
  if (!clearsFootprint) return false;
  const frontZ = building.z - building.depth / 2;
  return (
    Math.abs(candidate.x - building.x) >
      TOWN_POINT_ENTRANCE_HALF_WIDTH + clearanceX ||
    candidate.z + clearanceZ < frontZ - TOWN_POINT_ENTRANCE_DEPTH ||
    candidate.z - clearanceZ > frontZ + 1
  );
}

function createBuildingSpecs(streetGrid: TownStreetGrid, random: () => number): TownBuildingSpec[] {
  const buildings: TownBuildingSpec[] = [];
  const blockStyles = Array.from(
    { length: CORE_BLOCK_COUNT * CORE_BLOCK_COUNT },
    (_, index) => index % BLOCK_BUILDING_KINDS.length,
  );
  shuffleInPlace(blockStyles, random);
  for (let blockZ = 0; blockZ < CORE_BLOCK_COUNT; blockZ += 1) {
    for (let blockX = 0; blockX < CORE_BLOCK_COUNT; blockX += 1) {
      const blockIndex = blockZ * CORE_BLOCK_COUNT + blockX;
      const minimumRoadX = streetGrid.verticalRoads[blockX];
      const maximumRoadX = streetGrid.verticalRoads[blockX + 1];
      const minimumRoadZ = streetGrid.horizontalRoads[blockZ];
      const maximumRoadZ = streetGrid.horizontalRoads[blockZ + 1];
      if (
        minimumRoadX === undefined ||
        maximumRoadX === undefined ||
        minimumRoadZ === undefined ||
        maximumRoadZ === undefined
      ) {
        throw new Error(`Town street block missing: ${blockIndex}`);
      }
      const style = blockStyles[blockIndex] ?? 2;
      const leftSetback = streetGrid.verticalEdges[blockX]?.[blockZ]
        ? ROAD_BUILDING_SETBACK
        : MERGED_BLOCK_SETBACK;
      const rightSetback = streetGrid.verticalEdges[blockX + 1]?.[blockZ]
        ? ROAD_BUILDING_SETBACK
        : MERGED_BLOCK_SETBACK;
      const lowerSetback = streetGrid.horizontalEdges[blockZ]?.[blockX]
        ? ROAD_BUILDING_SETBACK
        : MERGED_BLOCK_SETBACK;
      const upperSetback = streetGrid.horizontalEdges[blockZ + 1]?.[blockX]
        ? ROAD_BUILDING_SETBACK
        : MERGED_BLOCK_SETBACK;
      const geometries = createCoreBlockGeometries({
        minimumX: minimumRoadX + leftSetback,
        maximumX: maximumRoadX - rightSetback,
        minimumZ: minimumRoadZ + lowerSetback,
        maximumZ: maximumRoadZ - upperSetback -
          (POINT_BLOCKS.has(`${blockX}:${blockZ}`) ? PUBLIC_SPACE_STRIP_DEPTH : 0),
      }, random, style, streetGrid.roadSegments);
      const kinds = BLOCK_BUILDING_KINDS[style] ?? BUILDING_KINDS;
      for (const [localIndex, geometry] of geometries.entries()) {
        buildings.push(buildingSpec(
          coreBuildingId(blockIndex, localIndex),
          geometry.x,
          geometry.z,
          geometry.width,
          geometry.depth,
          buildings.length,
          random,
          kinds[localIndex] ?? "factory",
        ));
      }
    }
  }
  const perimeterCoordinates = Array.from({ length: 16 }, (_, index) => -825 + index * 110);
  for (const coordinate of perimeterCoordinates) {
    const horizontalLength = randomBetween(random, 54, 78);
    const horizontalDepth = randomBetween(random, 34, 54);
    const verticalWidth = randomBetween(random, 34, 54);
    const verticalLength = randomBetween(random, 54, 78);
    const alongJitter = randomBetween(random, -10, 10);
    const edgeJitter = randomBetween(random, -10, 10);
    buildings.push(buildingSpec(
      `town-perimeter-north-${coordinate}`,
      coordinate + alongJitter,
      940 + edgeJitter,
      horizontalLength,
      horizontalDepth,
      buildings.length,
      random,
    ));
    buildings.push(buildingSpec(
      `town-perimeter-south-${coordinate}`,
      coordinate - alongJitter,
      -940 - edgeJitter,
      randomBetween(random, 54, 78),
      randomBetween(random, 34, 54),
      buildings.length,
      random,
    ));
    buildings.push(buildingSpec(
      `town-perimeter-east-${coordinate}`,
      940 + randomBetween(random, -10, 10),
      coordinate + randomBetween(random, -10, 10),
      verticalWidth,
      verticalLength,
      buildings.length,
      random,
    ));
    buildings.push(buildingSpec(
      `town-perimeter-west-${coordinate}`,
      -940 + randomBetween(random, -10, 10),
      coordinate + randomBetween(random, -10, 10),
      randomBetween(random, 34, 54),
      randomBetween(random, 54, 78),
      buildings.length,
      random,
    ));
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
  kind: TownBuildingKind = buildingKind(index),
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
    kind,
  };
}

function buildingKind(index: number): TownBuildingKind {
  return BUILDING_KINDS[index % BUILDING_KINDS.length] ?? "factory";
}

function createCoreBlockGeometries(
  root: TownParcel,
  random: () => number,
  style: number,
  roads: readonly (readonly [number, number, number, number])[],
): TownBuildingGeometry[] {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const rootSplits = parcelSplitOptions(root, CORE_BUILDINGS_PER_BLOCK)
      .filter((option) =>
        option.axis === "x" &&
        option.firstCount >= 2 &&
        option.firstCount <= CORE_BUILDINGS_PER_BLOCK - 2
      );
    shuffleInPlace(rootSplits, random);
    const rootSplit = rootSplits[0];
    if (!rootSplit) break;
    const [leftRoot, rightRoot] = splitParcel(root, rootSplit, random);
    const leftParcels = partitionParcel(leftRoot, rootSplit.firstCount, random);
    const rightParcels = partitionParcel(
      rightRoot,
      CORE_BUILDINGS_PER_BLOCK - rootSplit.firstCount,
      random,
    );
    if (!leftParcels || !rightParcels) continue;
    const left = leftParcels.map((parcel) => buildingGeometry(parcel, random, style));
    const right = rightParcels.map((parcel) => buildingGeometry(parcel, random, style));
    const bridgePairs = left.flatMap((leftGeometry, leftIndex) =>
      right.flatMap((rightGeometry, rightIndex) => {
        const gap = rightGeometry.x - rightGeometry.width / 2 -
          (leftGeometry.x + leftGeometry.width / 2);
        const zDifference = Math.abs(leftGeometry.z - rightGeometry.z);
        const overlap = Math.min(
          leftGeometry.z + leftGeometry.depth / 2,
          rightGeometry.z + rightGeometry.depth / 2,
        ) - Math.max(
          leftGeometry.z - leftGeometry.depth / 2,
          rightGeometry.z - rightGeometry.depth / 2,
        );
        return gap >= 1 &&
            gap <= 18 &&
            overlap >= 8 &&
            zDifference <= Math.min(leftGeometry.depth, rightGeometry.depth) - 6
          ? [{ leftIndex, rightIndex, overlap, gap }]
          : [];
      })
    ).sort((first, second) =>
      second.overlap - first.overlap ||
      first.gap - second.gap ||
      first.leftIndex - second.leftIndex ||
      first.rightIndex - second.rightIndex
    );
    const bridgePair = randomEntry(bridgePairs.slice(0, Math.min(3, bridgePairs.length)), random);
    if (!bridgePair) continue;
    const from = left[bridgePair.leftIndex];
    const to = right[bridgePair.rightIndex];
    if (!from || !to) continue;
    const remaining = [
      ...left.filter((_, index) => index !== bridgePair.leftIndex),
      ...right.filter((_, index) => index !== bridgePair.rightIndex),
    ];
    shuffleInPlace(remaining, random);
    const result = [from, to, ...remaining];
    if (result.some((geometry) => !townFootprintClearsRoads(
      roads,
      geometry.x,
      geometry.z,
      geometry.width,
      geometry.depth,
      0.5,
    ))) continue;
    return result;
  }
  throw new Error("Town core block cannot generate a valid random layout");
}

function partitionParcel(parcel: TownParcel, count: number, random: () => number): TownParcel[] | null {
  if (count === 1) return [parcel];
  const options = parcelSplitOptions(parcel, count);
  if (options.length === 0) return null;
  const preferredAxis = parcelWidth(parcel) >= parcelDepth(parcel) ? "x" : "z";
  const preferred = options.filter((option) => option.axis === preferredAxis);
  const ordered = [...options];
  shuffleInPlace(ordered, random);
  if (preferred.length > 0 && random() < 0.72) {
    ordered.sort((first, second) =>
      Number(second.axis === preferredAxis) - Number(first.axis === preferredAxis)
    );
  }
  for (const option of ordered) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [first, second] = splitParcel(parcel, option, random);
      const firstParcels = partitionParcel(first, option.firstCount, random);
      if (!firstParcels) continue;
      const secondParcels = partitionParcel(second, count - option.firstCount, random);
      if (!secondParcels) continue;
      return [...firstParcels, ...secondParcels];
    }
  }
  return null;
}

function parcelSplitOptions(
  parcel: TownParcel,
  count: number,
): Array<{ axis: "x" | "z"; firstCount: number; minimumCut: number; maximumCut: number }> {
  const options: Array<{ axis: "x" | "z"; firstCount: number; minimumCut: number; maximumCut: number }> = [];
  const width = parcelWidth(parcel);
  const depth = parcelDepth(parcel);
  for (let firstCount = 1; firstCount < count; firstCount += 1) {
    const secondCount = count - firstCount;
    const firstWidth = Math.max(MINIMUM_PARCEL_SPAN, firstCount * MINIMUM_PARCEL_AREA / depth);
    const secondWidth = Math.max(MINIMUM_PARCEL_SPAN, secondCount * MINIMUM_PARCEL_AREA / depth);
    if (firstWidth + secondWidth <= width) {
      options.push({
        axis: "x",
        firstCount,
        minimumCut: parcel.minimumX + firstWidth,
        maximumCut: parcel.maximumX - secondWidth,
      });
    }
    const firstDepth = Math.max(MINIMUM_PARCEL_SPAN, firstCount * MINIMUM_PARCEL_AREA / width);
    const secondDepth = Math.max(MINIMUM_PARCEL_SPAN, secondCount * MINIMUM_PARCEL_AREA / width);
    if (firstDepth + secondDepth <= depth) {
      options.push({
        axis: "z",
        firstCount,
        minimumCut: parcel.minimumZ + firstDepth,
        maximumCut: parcel.maximumZ - secondDepth,
      });
    }
  }
  return options;
}

function splitParcel(
  parcel: TownParcel,
  option: ReturnType<typeof parcelSplitOptions>[number],
  random: () => number,
): [TownParcel, TownParcel] {
  const progress = 0.18 + random() * 0.64;
  const cut = option.minimumCut + (option.maximumCut - option.minimumCut) * progress;
  if (option.axis === "x") {
    return [
      { ...parcel, maximumX: cut },
      { ...parcel, minimumX: cut },
    ];
  }
  return [
    { ...parcel, maximumZ: cut },
    { ...parcel, minimumZ: cut },
  ];
}

function buildingGeometry(parcel: TownParcel, random: () => number, style: number): TownBuildingGeometry {
  const minimumInset = style === 1 ? 2 : style === 0 ? 4 : 3;
  const maximumInset = style === 1 ? 5 : style === 0 ? 8.5 : 7.5;
  const leftInset = randomBetween(random, minimumInset, maximumInset);
  const rightInset = randomBetween(random, minimumInset, maximumInset);
  const frontInset = randomBetween(random, minimumInset, maximumInset);
  const backInset = randomBetween(random, minimumInset, maximumInset);
  const minimumX = parcel.minimumX + leftInset;
  const maximumX = parcel.maximumX - rightInset;
  const minimumZ = parcel.minimumZ + frontInset;
  const maximumZ = parcel.maximumZ - backInset;
  let width = Math.max(MINIMUM_BUILDING_SPAN, maximumX - minimumX);
  let depth = Math.max(MINIMUM_BUILDING_SPAN, maximumZ - minimumZ);
  let x = (minimumX + maximumX) / 2;
  let z = (minimumZ + maximumZ) / 2;
  if (width > depth * MAXIMUM_BUILDING_ASPECT_RATIO) {
    const cappedWidth = depth * randomBetween(random, 2.35, MAXIMUM_BUILDING_ASPECT_RATIO);
    const courtyardWidth = width - cappedWidth;
    width = cappedWidth;
    x = minimumX + width / 2 + random() * courtyardWidth;
  } else if (depth > width * MAXIMUM_BUILDING_ASPECT_RATIO) {
    const cappedDepth = width * randomBetween(random, 2.35, MAXIMUM_BUILDING_ASPECT_RATIO);
    const courtyardDepth = depth - cappedDepth;
    depth = cappedDepth;
    z = minimumZ + depth / 2 + random() * courtyardDepth;
  }
  return {
    x,
    z,
    width,
    depth,
  };
}

function parcelWidth(parcel: TownParcel): number {
  return parcel.maximumX - parcel.minimumX;
}

function parcelDepth(parcel: TownParcel): number {
  return parcel.maximumZ - parcel.minimumZ;
}

function randomEntry<T>(values: readonly T[], random: () => number): T | undefined {
  return values[Math.floor(random() * values.length)];
}

function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target] as T, values[index] as T];
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

function createStreetGrid(random: () => number): TownStreetGrid {
  const verticalRoads = createRoadAxes(random);
  const horizontalRoads = createRoadAxes(random);
  const nodes = horizontalRoads.map((z) =>
    verticalRoads.map((x) => ({
      x: x + randomBetween(random, -ROAD_NODE_JITTER, ROAD_NODE_JITTER),
      z: z + randomBetween(random, -ROAD_NODE_JITTER, ROAD_NODE_JITTER),
    }))
  );
  const horizontalEdges = Array.from({ length: CORE_BLOCK_COUNT + 1 }, (_, row) =>
    row % 2 === 0 ? Array.from({ length: CORE_BLOCK_COUNT }, () => true) : createLocalRoadEdges(random)
  );
  const verticalEdges = Array.from({ length: CORE_BLOCK_COUNT + 1 }, (_, column) =>
    column % 2 === 0 ? Array.from({ length: CORE_BLOCK_COUNT }, () => true) : createLocalRoadEdges(random)
  );
  const roadSegments: Array<readonly [number, number, number, number]> = [];
  for (let row = 0; row <= CORE_BLOCK_COUNT; row += 1) {
    for (let column = 0; column < CORE_BLOCK_COUNT; column += 1) {
      if (!horizontalEdges[row]?.[column]) continue;
      const start = nodes[row]?.[column];
      const end = nodes[row]?.[column + 1];
      if (start && end) roadSegments.push([start.x, start.z, end.x, end.z]);
    }
    if (row % 2 !== 0) continue;
    const first = nodes[row]?.[0];
    const last = nodes[row]?.[CORE_BLOCK_COUNT];
    if (first) roadSegments.push([-850, first.z, first.x, first.z]);
    if (last) roadSegments.push([last.x, last.z, 850, last.z]);
  }
  for (let column = 0; column <= CORE_BLOCK_COUNT; column += 1) {
    for (let row = 0; row < CORE_BLOCK_COUNT; row += 1) {
      if (!verticalEdges[column]?.[row]) continue;
      const start = nodes[row]?.[column];
      const end = nodes[row + 1]?.[column];
      if (start && end) roadSegments.push([start.x, start.z, end.x, end.z]);
    }
    if (column % 2 !== 0) continue;
    const first = nodes[0]?.[column];
    const last = nodes[CORE_BLOCK_COUNT]?.[column];
    if (first) roadSegments.push([first.x, -850, first.x, first.z]);
    if (last) roadSegments.push([last.x, last.z, last.x, 850]);
  }
  return { verticalRoads, horizontalRoads, verticalEdges, horizontalEdges, roadSegments };
}

function createLocalRoadEdges(random: () => number): boolean[] {
  const edgeCount = 3 + Math.floor(random() * 4);
  const selected = new Set(shuffledIndexes(CORE_BLOCK_COUNT, random).slice(0, edgeCount));
  return Array.from({ length: CORE_BLOCK_COUNT }, (_, index) => selected.has(index));
}

function createRoadAxes(random: () => number): number[] {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const weights = Array.from(
      { length: CORE_BLOCK_COUNT },
      () => randomBetween(random, 0.82, 1.18),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const spans = weights.map((weight) => weight / total * CORE_ROAD_EXTENT * 2);
    if (spans.some((span) => span < MINIMUM_BLOCK_SPAN || span > MAXIMUM_BLOCK_SPAN)) continue;
    const axes = [-CORE_ROAD_EXTENT];
    for (const span of spans) {
      axes.push((axes.at(-1) ?? -CORE_ROAD_EXTENT) + span);
    }
    axes[axes.length - 1] = CORE_ROAD_EXTENT;
    return axes;
  }
  throw new Error("Town road axes cannot satisfy block spans");
}

function createRoadSegments(streetGrid: TownStreetGrid): Array<readonly [number, number, number, number]> {
  return streetGrid.roadSegments;
}

export function townFootprintClearsRoads(
  roads: readonly (readonly [number, number, number, number])[],
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  clearance = 0,
): boolean {
  const padding = TOWN_ROAD_SHOULDER_HALF_WIDTH + clearance;
  return roads.every((road) => !segmentIntersectsRectangle(
    road,
    centerX - width / 2 - padding,
    centerX + width / 2 + padding,
    centerZ - depth / 2 - padding,
    centerZ + depth / 2 + padding,
  ));
}

function segmentIntersectsRectangle(
  road: readonly [number, number, number, number],
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
): boolean {
  const [startX, startZ, endX, endZ] = road;
  let minimumProgress = 0;
  let maximumProgress = 1;
  for (const [start, delta, minimum, maximum] of [
    [startX, endX - startX, minimumX, maximumX],
    [startZ, endZ - startZ, minimumZ, maximumZ],
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

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
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
