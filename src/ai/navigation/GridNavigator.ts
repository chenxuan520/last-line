import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  MAP_COVER_OBSTACLES,
  MAP_HALF_SIZE,
  MAP_ROCK_OBSTACLES,
  MAP_ROOF_RAMPS,
  MAP_WALL_SEGMENTS,
  type MapBuilding,
  type MapLayout,
  type MapObstacle,
  type RoofRamp,
} from "../../config/map";
import type { Vector3State } from "../../game/state/types";

const DEFAULT_CLEARANCE = 0.4;
const PATH_CLEARANCE = 0.64;
const WAYPOINT_PADDING = 0.13;
const MAX_PATH_SEARCH_NODES = 256;
const ACTOR_EYE_HEIGHT = 1.76;
const ACTOR_HEIGHT = 1.8;
const DEFAULT_BLOCKING_OBSTACLES = [...MAP_WALL_SEGMENTS, ...MAP_ROCK_OBSTACLES, ...MAP_COVER_OBSTACLES];

export class GridNavigator {
  private readonly layout: MapLayout | null;
  private readonly obstacles: readonly MapObstacle[];
  private readonly buildings: readonly MapBuilding[];
  private readonly roofRamps: readonly RoofRamp[];
  private readonly blockingObstacles: readonly MapObstacle[];
  private readonly clearance: number;

  public constructor(
    layoutOrObstacles: MapLayout | readonly MapObstacle[] = createMapLayout(0),
    roofRamps: readonly RoofRamp[] = MAP_ROOF_RAMPS,
    blockingObstacles: readonly MapObstacle[] = DEFAULT_BLOCKING_OBSTACLES,
    clearance = DEFAULT_CLEARANCE,
  ) {
    this.layout = isMapLayout(layoutOrObstacles) ? layoutOrObstacles : null;
    this.obstacles = this.layout?.obstacles ?? layoutOrObstacles as readonly MapObstacle[];
    this.buildings = this.obstacles.filter(isMapBuilding);
    this.roofRamps = this.layout?.roofRamps ?? roofRamps;
    this.blockingObstacles = this.layout
      ? [...this.layout.wallSegments, ...this.layout.rockObstacles, ...this.layout.coverObstacles]
      : blockingObstacles;
    this.clearance = clearance;
  }

  public findPath(start: Vector3State, target: Vector3State): Vector3State[] {
    const startLocation = this.findLocation(start);
    const targetLocation = this.findLocation(target);
    const normalizedStart = this.normalizePoint(start, startLocation);
    const normalizedTarget = this.normalizePoint(target, targetLocation);
    if (sameLocation(startLocation, targetLocation)) {
      const directPath = this.findSurfacePath(normalizedStart, normalizedTarget, startLocation);
      if (directPath.length > 0) return directPath;
      if (startLocation.level === 0) {
        return this.findGroundDoorPath(normalizedStart, normalizedTarget);
      }
      return [];
    }

    const startExit = this.pathToGround(normalizedStart, startLocation);
    const targetEntrance = this.pathFromGround(normalizedTarget, targetLocation);
    if (!startExit || !targetEntrance) return [];
    const groundPath = this.findSurfacePath(startExit.ground, targetEntrance.ground, GROUND_LOCATION);
    if (groundPath.length === 0) return [];
    const path = [...startExit.path];
    appendPath(path, groundPath);
    appendPath(path, targetEntrance.path);
    return path;
  }

  private findSurfacePath(start: Vector3State, target: Vector3State, location: SurfaceLocation): Vector3State[] {
    const blockers = this.blockersForLocation(location);
    if (this.isBlocked(start, blockers) || this.isBlocked(target, blockers)) {
      return [];
    }
    if (start.x === target.x && start.z === target.z) {
      return [{ ...start }];
    }
    if (this.hasLineOfSight(start, target, blockers)) {
      return [{ ...start }, { ...target }];
    }

    const cornerOffset = Math.max(this.clearance, PATH_CLEARANCE) + WAYPOINT_PADDING;
    const open: PathSearchNode[] = [{
      point: { ...start },
      path: [{ ...start }],
      distance: 0,
      score: horizontalDistance(start, target),
    }];
    const bestDistances = new Map<string, number>([[pointKey(start), 0]]);

    for (let searched = 0; searched < MAX_PATH_SEARCH_NODES && open.length > 0; searched += 1) {
      let currentIndex = 0;
      for (let index = 1; index < open.length; index += 1) {
        if ((open[index]?.score ?? Number.POSITIVE_INFINITY) < (open[currentIndex]?.score ?? Number.POSITIVE_INFINITY)) {
          currentIndex = index;
        }
      }
      const current = open.splice(currentIndex, 1)[0];
      if (!current) break;
      if (this.hasLineOfSight(current.point, target, blockers)) {
        return [...current.path, { ...target }];
      }

      const nearestBlockers = blockers
        .map((obstacle) => ({
          obstacle,
          progress: segmentObstacleEntryProgress(
            current.point,
            target,
            obstacle,
            Math.max(this.clearance, PATH_CLEARANCE),
          ),
        }))
        .filter((entry): entry is { obstacle: MapObstacle; progress: number } => entry.progress !== null)
        .sort((left, right) => left.progress - right.progress)
        .slice(0, 3);

      for (const { obstacle } of nearestBlockers) {
        for (const waypoint of obstacleCorners(obstacle, start.y, cornerOffset)) {
          if (this.isBlocked(waypoint, blockers) || !this.hasLineOfSight(current.point, waypoint, blockers)) continue;
          const distance = current.distance + horizontalDistance(current.point, waypoint);
          const key = pointKey(waypoint);
          if (distance >= (bestDistances.get(key) ?? Number.POSITIVE_INFINITY)) continue;
          bestDistances.set(key, distance);
          open.push({
            point: waypoint,
            path: [...current.path, waypoint],
            distance,
            score: distance + horizontalDistance(waypoint, target),
          });
        }
      }
    }
    return [];
  }

  private findGroundDoorPath(start: Vector3State, target: Vector3State): Vector3State[] {
    if (!this.layout) return [];
    const startBuilding = this.buildings.find((building) => pointInsideObstacle(start, building, 0));
    const targetBuilding = this.buildings.find((building) => pointInsideObstacle(target, building, 0));
    if ((!startBuilding && !targetBuilding) || startBuilding?.id === targetBuilding?.id) return [];
    const building = startBuilding ?? targetBuilding;
    if (!building) return [];
    const door = this.layout.wallOpenings.find((opening) =>
      opening.obstacleId === building.id && opening.storyIndex === 0 && opening.kind === "door"
    );
    if (!door || door.side !== "front") return [];
    const outsidePoint = { x: door.center.x, y: start.y, z: door.center.z - 1.1 };
    const insidePoint = { x: door.center.x, y: start.y, z: door.center.z + 1.1 };
    const outsideLocation = this.groundLocation(outsidePoint);
    const insideLocation = this.groundLocation(insidePoint);
    const outside = this.normalizePoint(outsidePoint, outsideLocation);
    const inside = this.normalizePoint(insidePoint, insideLocation);
    const path: Vector3State[] = [];
    if (targetBuilding) {
      const exteriorPath = this.findSurfacePath(start, outside, outsideLocation);
      const interiorPath = this.findSurfacePath(inside, target, insideLocation);
      if (exteriorPath.length === 0 || interiorPath.length === 0) return [];
      appendPath(path, exteriorPath);
      appendPoint(path, inside);
      appendPath(path, interiorPath);
      return path;
    }
    const interiorPath = this.findSurfacePath(start, inside, insideLocation);
    if (interiorPath.length === 0) return [];
    appendPath(path, interiorPath);
    appendPoint(path, outside);
    const exteriorPath = this.findSurfacePath(outside, target, outsideLocation);
    if (exteriorPath.length === 0) return path;
    appendPath(path, exteriorPath);
    return path;
  }

  private findLocation(point: Vector3State): SurfaceLocation {
    for (const building of this.buildings) {
      if (!pointInsideObstacle(point, building, 0)) continue;
      for (let level = building.storyCount; level >= 1; level -= 1) {
        const supportY = building.baseY + level * building.storyHeight + BUILDING_ROOF_CAP_HEIGHT;
        if (point.y >= supportY + 0.15) return { building, level, supportY };
      }
    }
    return { ...GROUND_LOCATION, supportY: this.groundSupport(point) };
  }

  private normalizePoint(point: Vector3State, location: SurfaceLocation): Vector3State {
    return { x: point.x, y: location.supportY + ACTOR_EYE_HEIGHT, z: point.z };
  }

  private pathToGround(start: Vector3State, location: SurfaceLocation): GroundTransition | null {
    if (!location.building || location.level === 0) return { path: [{ ...start }], ground: { ...start } };
    const path = [{ ...start }];
    const firstRamp = this.rampForLevel(location.building, location.level - 1);
    if (!firstRamp) return null;
    const approach = this.rampApproach(location.building, firstRamp, location.level);
    const surfacePath = this.findSurfacePath(start, approach, location);
    if (surfacePath.length === 0) return null;
    path.length = 0;
    appendPath(path, surfacePath);
    for (let level = location.level - 1; level >= 0; level -= 1) {
      const ramp = this.rampForLevel(location.building, level);
      if (!ramp) return null;
      appendPoint(path, rampPoint(ramp, true));
      appendPoint(path, rampPoint(ramp, false));
    }
    const ground = path.at(-1);
    return ground ? { path, ground } : null;
  }

  private pathFromGround(target: Vector3State, location: SurfaceLocation): GroundTransition | null {
    if (!location.building || location.level === 0) return { path: [{ ...target }], ground: { ...target } };
    const ramps: RoofRamp[] = [];
    for (let level = 0; level < location.level; level += 1) {
      const ramp = this.rampForLevel(location.building, level);
      if (!ramp) return null;
      ramps.push(ramp);
    }
    const firstRamp = ramps[0];
    if (!firstRamp) return null;
    const ground = rampPoint(firstRamp, false);
    const path: Vector3State[] = [{ ...ground }];
    for (const ramp of ramps) {
      appendPoint(path, rampPoint(ramp, false));
      appendPoint(path, rampPoint(ramp, true));
    }
    const approach = this.rampApproach(location.building, ramps.at(-1) as RoofRamp, location.level);
    appendPoint(path, approach);
    const surfacePath = this.findSurfacePath(approach, target, location);
    if (surfacePath.length === 0) return null;
    appendPath(path, surfacePath);
    return { path, ground };
  }

  private rampForLevel(building: MapBuilding, fromLevel: number): RoofRamp | null {
    return this.roofRamps.find((ramp) => ramp.obstacleId === building.id && ramp.fromLevel === fromLevel) ?? null;
  }

  private rampApproach(building: MapBuilding, ramp: RoofRamp, level: number): Vector3State {
    const stairwell = building.stairwell;
    if (!stairwell) return rampPoint(ramp, true);
    return {
      x: stairwell.centerX - stairwell.side * (
        stairwell.width / 2 + Math.max(this.clearance, PATH_CLEARANCE) + WAYPOINT_PADDING + 0.1
      ),
      y: building.baseY + level * building.storyHeight + BUILDING_ROOF_CAP_HEIGHT + ACTOR_EYE_HEIGHT,
      z: ramp.endZ,
    };
  }

  private blockersForLocation(location: SurfaceLocation): MapObstacle[] {
    const supportY = location.supportY;
    const blockers = this.blockingObstacles.filter((obstacle) => {
      const bottomY = obstacle.center.y - obstacle.height / 2;
      const topY = obstacle.center.y + obstacle.height / 2;
      return bottomY < supportY + ACTOR_HEIGHT && topY > supportY + 0.05;
    });
    if (location.building?.stairwell && location.level > 0) {
      const stairwell = location.building.stairwell;
      blockers.push({
        id: `${location.building.id}-stairwell-${location.level}`,
        center: { x: stairwell.centerX, y: supportY + ACTOR_HEIGHT / 2, z: stairwell.centerZ },
        width: stairwell.width,
        height: ACTOR_HEIGHT,
        depth: stairwell.depth,
        color: "#000000",
      });
    }
    return blockers;
  }

  private groundSupport(point: Vector3State): number {
    return this.layout ? getTerrainHeight(point.x, point.z, this.layout) : point.y - ACTOR_EYE_HEIGHT;
  }

  private groundLocation(point: Vector3State): SurfaceLocation {
    return { ...GROUND_LOCATION, supportY: this.groundSupport(point) };
  }

  private isBlocked(point: Vector3State, blockers: readonly MapObstacle[]): boolean {
    const mapLimit = MAP_HALF_SIZE - this.clearance;
    if (point.x < -mapLimit || point.x > mapLimit || point.z < -mapLimit || point.z > mapLimit) {
      return true;
    }
    return blockers.some((obstacle) => pointInsideObstacle(point, obstacle, this.clearance));
  }

  private hasLineOfSight(start: Vector3State, target: Vector3State, blockers: readonly MapObstacle[]): boolean {
    return !blockers.some((obstacle) =>
      segmentIntersectsObstacle(start, target, obstacle, Math.max(this.clearance, PATH_CLEARANCE)),
    );
  }
}

interface SurfaceLocation {
  building: MapBuilding | null;
  level: number;
  supportY: number;
}

interface GroundTransition {
  path: Vector3State[];
  ground: Vector3State;
}

const GROUND_LOCATION: SurfaceLocation = { building: null, level: 0, supportY: 0 };

function sameLocation(left: SurfaceLocation, right: SurfaceLocation): boolean {
  return left.level === right.level && left.building?.id === right.building?.id;
}

function rampPoint(ramp: RoofRamp, top: boolean): Vector3State {
  return {
    x: ramp.centerX,
    y: (top ? ramp.topY : ramp.bottomY) + ACTOR_EYE_HEIGHT,
    z: top ? ramp.endZ : ramp.startZ,
  };
}

function appendPath(target: Vector3State[], points: readonly Vector3State[]): void {
  for (const point of points) appendPoint(target, point);
}

function appendPoint(target: Vector3State[], point: Vector3State): void {
  const previous = target.at(-1);
  if (previous && horizontalDistance(previous, point) < 1e-6 && Math.abs(previous.y - point.y) < 1e-6) return;
  target.push({ ...point });
}

function isMapLayout(value: MapLayout | readonly MapObstacle[]): value is MapLayout {
  return !Array.isArray(value) && "floorSlabs" in value;
}

function isMapBuilding(obstacle: MapObstacle): obstacle is MapBuilding {
  return "storyCount" in obstacle && "storyHeight" in obstacle && "baseY" in obstacle;
}

interface PathSearchNode {
  point: Vector3State;
  path: Vector3State[];
  distance: number;
  score: number;
}

function obstacleCorners(obstacle: MapObstacle, y: number, cornerOffset: number): Vector3State[] {
  const halfWidth = obstacle.width / 2 + cornerOffset;
  const halfDepth = obstacle.depth / 2 + cornerOffset;
  return [-1, 1].flatMap((xDirection) =>
    [-1, 1].map((zDirection) => ({
      x: obstacle.center.x + xDirection * halfWidth,
      y,
      z: obstacle.center.z + zDirection * halfDepth,
    })),
  );
}

function pointKey(point: Vector3State): string {
  return `${point.x.toFixed(3)}:${point.z.toFixed(3)}`;
}

function pointInsideObstacle(point: Vector3State, obstacle: MapObstacle, clearance: number): boolean {
  return (
    point.x >= obstacle.center.x - obstacle.width / 2 - clearance &&
    point.x <= obstacle.center.x + obstacle.width / 2 + clearance &&
    point.z >= obstacle.center.z - obstacle.depth / 2 - clearance &&
    point.z <= obstacle.center.z + obstacle.depth / 2 + clearance
  );
}

function segmentIntersectsObstacle(
  start: Vector3State,
  target: Vector3State,
  obstacle: MapObstacle,
  clearance: number,
): boolean {
  return segmentObstacleEntryProgress(start, target, obstacle, clearance) !== null;
}

function segmentObstacleEntryProgress(
  start: Vector3State,
  target: Vector3State,
  obstacle: MapObstacle,
  clearance: number,
): number | null {
  const minimumX = obstacle.center.x - obstacle.width / 2 - clearance;
  const maximumX = obstacle.center.x + obstacle.width / 2 + clearance;
  const minimumZ = obstacle.center.z - obstacle.depth / 2 - clearance;
  const maximumZ = obstacle.center.z + obstacle.depth / 2 + clearance;
  let minimumTime = 0;
  let maximumTime = 1;

  for (const [origin, delta, minimum, maximum] of [
    [start.x, target.x - start.x, minimumX, maximumX],
    [start.z, target.z - start.z, minimumZ, maximumZ],
  ] as const) {
    if (delta === 0) {
      if (origin < minimum || origin > maximum) {
        return null;
      }
      continue;
    }
    const firstTime = (minimum - origin) / delta;
    const secondTime = (maximum - origin) / delta;
    minimumTime = Math.max(minimumTime, Math.min(firstTime, secondTime));
    maximumTime = Math.min(maximumTime, Math.max(firstTime, secondTime));
    if (minimumTime > maximumTime) {
      return null;
    }
  }
  return maximumTime > 1e-6 ? minimumTime : null;
}

function horizontalDistance(start: Vector3State, target: Vector3State): number {
  return Math.hypot(target.x - start.x, target.z - start.z);
}
