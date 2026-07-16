import { MAP_HALF_SIZE, MAP_OBSTACLES, type MapObstacle } from "../../config/map";
import type { Vector3State } from "../../game/state/types";

const DEFAULT_CLEARANCE = 0.4;
const WAYPOINT_PADDING = 0.05;

export class GridNavigator {
  public constructor(
    private readonly obstacles: readonly MapObstacle[] = MAP_OBSTACLES,
    private readonly clearance = DEFAULT_CLEARANCE,
  ) {}

  public findPath(start: Vector3State, target: Vector3State): Vector3State[] {
    if (this.isBlocked(start) || this.isBlocked(target)) {
      return [];
    }
    if (start.x === target.x && start.z === target.z) {
      return [{ ...start }];
    }
    if (this.hasLineOfSight(start, target)) {
      return [{ ...start }, { ...target }];
    }

    const points: Vector3State[] = [{ ...start }, { ...target }];
    const cornerOffset = this.clearance + WAYPOINT_PADDING;
    for (const obstacle of this.obstacles) {
      const halfWidth = obstacle.width / 2 + cornerOffset;
      const halfDepth = obstacle.depth / 2 + cornerOffset;
      for (const xDirection of [-1, 1]) {
        for (const zDirection of [-1, 1]) {
          const point = {
            x: obstacle.center.x + xDirection * halfWidth,
            y: start.y,
            z: obstacle.center.z + zDirection * halfDepth,
          };
          if (!this.isBlocked(point)) {
            points.push(point);
          }
        }
      }
    }

    const distances = Array<number>(points.length).fill(Number.POSITIVE_INFINITY);
    const previous = Array<number>(points.length).fill(-1);
    const visited = Array<boolean>(points.length).fill(false);
    distances[0] = 0;

    for (let iteration = 0; iteration < points.length; iteration += 1) {
      let current = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (!visited[index] && (current === -1 || distances[index] < distances[current])) {
          current = index;
        }
      }
      if (current === -1 || !Number.isFinite(distances[current]) || current === 1) {
        break;
      }

      visited[current] = true;
      for (let next = 0; next < points.length; next += 1) {
        if (visited[next] || next === current || !this.hasLineOfSight(points[current], points[next])) {
          continue;
        }
        const distance = distances[current] + horizontalDistance(points[current], points[next]);
        if (distance < distances[next]) {
          distances[next] = distance;
          previous[next] = current;
        }
      }
    }

    if (!Number.isFinite(distances[1])) {
      return [];
    }

    const path: Vector3State[] = [];
    for (let current = 1; current !== -1; current = previous[current]) {
      path.push({ ...points[current] });
    }
    path.reverse();
    return path;
  }

  private isBlocked(point: Vector3State): boolean {
    const mapLimit = MAP_HALF_SIZE - this.clearance;
    if (point.x < -mapLimit || point.x > mapLimit || point.z < -mapLimit || point.z > mapLimit) {
      return true;
    }
    return this.obstacles.some((obstacle) => pointInsideObstacle(point, obstacle, this.clearance));
  }

  private hasLineOfSight(start: Vector3State, target: Vector3State): boolean {
    return !this.obstacles.some((obstacle) => segmentIntersectsObstacle(start, target, obstacle, this.clearance));
  }
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
        return false;
      }
      continue;
    }
    const firstTime = (minimum - origin) / delta;
    const secondTime = (maximum - origin) / delta;
    minimumTime = Math.max(minimumTime, Math.min(firstTime, secondTime));
    maximumTime = Math.min(maximumTime, Math.max(firstTime, secondTime));
    if (minimumTime > maximumTime) {
      return false;
    }
  }
  return true;
}

function horizontalDistance(start: Vector3State, target: Vector3State): number {
  return Math.hypot(target.x - start.x, target.z - start.z);
}
