import {
  BUILDING_ROOF_CAP_HEIGHT,
  MAP_HALF_SIZE,
  MAP_OBSTACLES,
  MAP_ROOF_RAMPS,
  MAP_WALL_SEGMENTS,
  type MapObstacle,
  type RoofRamp,
} from "../../config/map";
import type { Vector3State } from "../../game/state/types";

const DEFAULT_CLEARANCE = 0.4;
const PATH_CLEARANCE = 0.64;
const WAYPOINT_PADDING = 0.13;
const MAX_PATH_SEARCH_NODES = 256;

export class GridNavigator {
  public constructor(
    private readonly obstacles: readonly MapObstacle[] = MAP_OBSTACLES,
    private readonly roofRamps: readonly RoofRamp[] = MAP_ROOF_RAMPS,
    private readonly blockingObstacles: readonly MapObstacle[] = MAP_WALL_SEGMENTS,
    private readonly clearance = DEFAULT_CLEARANCE,
  ) {}

  public findPath(start: Vector3State, target: Vector3State): Vector3State[] {
    const startRoof = this.findRoof(start);
    const targetRoof = this.findRoof(target);
    if (startRoof?.id === targetRoof?.id && startRoof) {
      return [{ ...start }, { ...target }];
    }
    const startRamp = startRoof ? this.findRamp(startRoof) : null;
    const targetRamp = targetRoof ? this.findRamp(targetRoof) : null;
    if ((startRoof && !startRamp) || (targetRoof && !targetRamp)) return [];

    const groundStart = startRamp ? { x: startRamp.centerX, y: start.y, z: startRamp.startZ } : start;
    const groundTarget = targetRamp ? { x: targetRamp.centerX, y: target.y, z: targetRamp.startZ } : target;
    const groundPath = this.findGroundPath(groundStart, groundTarget);
    if (groundPath.length === 0) return [];

    const path: Vector3State[] = startRamp
      ? [{ ...start }, { x: startRamp.centerX, y: start.y, z: startRamp.endZ }, ...groundPath]
      : groundPath;
    if (targetRamp) {
      path.push({ x: targetRamp.centerX, y: target.y, z: targetRamp.endZ }, { ...target });
    }
    return path;
  }

  private findGroundPath(start: Vector3State, target: Vector3State): Vector3State[] {
    if (this.isBlocked(start) || this.isBlocked(target)) {
      return [];
    }
    if (start.x === target.x && start.z === target.z) {
      return [{ ...start }];
    }
    if (this.hasLineOfSight(start, target)) {
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
      if (this.hasLineOfSight(current.point, target)) {
        return [...current.path, { ...target }];
      }

      const blockers = this.blockingObstacles
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

      for (const { obstacle } of blockers) {
        for (const waypoint of obstacleCorners(obstacle, start.y, cornerOffset)) {
          if (this.isBlocked(waypoint) || !this.hasLineOfSight(current.point, waypoint)) continue;
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

  private findRoof(point: Vector3State): MapObstacle | null {
    return this.obstacles.find((obstacle) => {
      const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
      return point.y >= roofY + 0.2 && pointInsideObstacle(point, obstacle, 0);
    }) ?? null;
  }

  private findRamp(obstacle: MapObstacle): RoofRamp | null {
    return this.roofRamps.find((ramp) => ramp.id === `ramp-${obstacle.id}`) ?? null;
  }

  private isBlocked(point: Vector3State): boolean {
    const mapLimit = MAP_HALF_SIZE - this.clearance;
    if (point.x < -mapLimit || point.x > mapLimit || point.z < -mapLimit || point.z > mapLimit) {
      return true;
    }
    return this.blockingObstacles.some((obstacle) => pointInsideObstacle(point, obstacle, this.clearance));
  }

  private hasLineOfSight(start: Vector3State, target: Vector3State): boolean {
    return !this.blockingObstacles.some((obstacle) =>
      segmentIntersectsObstacle(start, target, obstacle, Math.max(this.clearance, PATH_CLEARANCE)),
    );
  }
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
