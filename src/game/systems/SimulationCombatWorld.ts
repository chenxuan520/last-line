import {
  createMapLayout,
  getTerrainHeight,
  getRampHeight,
  MAP_HALF_SIZE,
  type MapLayout,
  type MapObstacle,
  type RoofRamp,
} from "../../config/map";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";
import type { CombatWorld, ShotResult, ShotTrace } from "./CombatSystem";

const ACTOR_HIT_HEIGHT = 1.8;
const ACTOR_HIT_RADIUS = 0.42;
const ACTOR_EYE_TO_FEET = 1.76;
const GEOMETRY_EPSILON = 1e-9;
const COMBAT_GRID_CELL_SIZE = 32;
const COMBAT_GRID_KEY_OFFSET = 32_768;

export class SimulationCombatWorld implements CombatWorld {
  private layout: MapLayout;
  private layoutSeed: number;
  private environmentObstacles: readonly MapObstacle[];
  private obstacleIndex: StaticObstacleIndex;

  public constructor(
    private readonly state: MatchState,
    private readonly useSpatialIndex = true,
  ) {
    this.layoutSeed = state.mapSeed;
    this.layout = createMapLayout(state.mapSeed);
    this.environmentObstacles = environmentObstacles(this.layout);
    this.obstacleIndex = new StaticObstacleIndex(this.environmentObstacles);
  }

  public traceShot(trace: ShotTrace): EntityId | null {
    return this.traceShotDetailed(trace).targetId;
  }

  public traceShotDetailed(trace: ShotTrace): ShotResult {
    const direction = normalize(trace.direction);
    if (!direction || !Number.isFinite(trace.range) || trace.range <= 0) {
      return missResult(trace.origin, { x: 0, y: 0, z: 1 }, 0);
    }

    const layout = this.getLayout();
    let nearestEnvironment: SurfaceHit | null = intersectTerrain(trace.origin, direction, trace.range, layout);
    const obstacles = this.useSpatialIndex
      ? this.obstacleIndex.query(trace.origin, direction, trace.range)
      : this.environmentObstacles;
    for (const obstacle of obstacles) {
      const hit = intersectObstacle(trace.origin, direction, trace.range, obstacle);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }
    for (const ramp of layout.roofRamps) {
      const hit = intersectRamp(trace.origin, direction, trace.range, ramp);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }

    let nearestActorId: EntityId | null = null;
    let nearestActorHit: ActorSurfaceHit | null = null;
    for (const actorId in this.state.actors) {
      const actor = this.state.actors[actorId];
      if (!actor) continue;
      if (!actor.alive || actor.deployment === "aircraft" || actor.id === trace.shooterId) {
        continue;
      }
      const hit = intersectActor(trace.origin, direction, trace.range, actor);
      if (
        hit &&
        (!nearestActorHit || hit.distance < nearestActorHit.distance - GEOMETRY_EPSILON ||
          (Math.abs(hit.distance - nearestActorHit.distance) <= GEOMETRY_EPSILON &&
            (nearestActorId === null || actor.id < nearestActorId)))
      ) {
        nearestActorId = actor.id;
        nearestActorHit = hit;
      }
    }

    if (nearestActorId && nearestActorHit && (!nearestEnvironment || nearestActorHit.distance < nearestEnvironment.distance - GEOMETRY_EPSILON)) {
      return {
        targetId: nearestActorId,
        point: pointAlong(trace.origin, direction, nearestActorHit.distance),
        normal: nearestActorHit.normal,
        hitType: "actor",
      };
    }
    if (nearestEnvironment) {
      return {
        targetId: null,
        point: pointAlong(trace.origin, direction, nearestEnvironment.distance),
        normal: nearestEnvironment.normal,
        hitType: "environment",
      };
    }
    return missResult(trace.origin, direction, trace.range);
  }

  public hasLineOfSight(observerId: EntityId, targetId: EntityId): boolean {
    const observer = this.state.actors[observerId];
    const target = this.state.actors[targetId];
    if (!observer?.alive || !target?.alive) {
      return false;
    }
    if (observerId === targetId) {
      return true;
    }

    const offset = subtract(target.position, observer.position);
    const distance = length(offset);
    if (distance <= GEOMETRY_EPSILON) {
      return true;
    }
    return this.traceShot({
      shooterId: observerId,
      origin: observer.position,
      direction: offset,
      range: distance + GEOMETRY_EPSILON,
    }) === targetId;
  }

  private getLayout(): MapLayout {
    if (this.layoutSeed !== this.state.mapSeed) {
      this.layoutSeed = this.state.mapSeed;
      this.layout = createMapLayout(this.state.mapSeed);
      this.environmentObstacles = environmentObstacles(this.layout);
      this.obstacleIndex = new StaticObstacleIndex(this.environmentObstacles);
    }
    return this.layout;
  }
}

class StaticObstacleIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly visited: Uint32Array;
  private readonly candidateIndices: number[] = [];
  private readonly candidates: MapObstacle[] = [];
  private generation = 0;

  public constructor(private readonly obstacles: readonly MapObstacle[]) {
    this.visited = new Uint32Array(obstacles.length);
    for (let index = 0; index < obstacles.length; index += 1) {
      const obstacle = obstacles[index];
      if (!obstacle) continue;
      const minimumX = Math.floor((obstacle.center.x - obstacle.width / 2 - GEOMETRY_EPSILON) / COMBAT_GRID_CELL_SIZE);
      const maximumX = Math.floor((obstacle.center.x + obstacle.width / 2 + GEOMETRY_EPSILON) / COMBAT_GRID_CELL_SIZE);
      const minimumZ = Math.floor((obstacle.center.z - obstacle.depth / 2 - GEOMETRY_EPSILON) / COMBAT_GRID_CELL_SIZE);
      const maximumZ = Math.floor((obstacle.center.z + obstacle.depth / 2 + GEOMETRY_EPSILON) / COMBAT_GRID_CELL_SIZE);
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        for (let cellZ = minimumZ; cellZ <= maximumZ; cellZ += 1) {
          const key = combatGridKey(cellX, cellZ);
          const cell = this.cells.get(key);
          if (cell) cell.push(index);
          else this.cells.set(key, [index]);
        }
      }
    }
  }

  public query(origin: Vector3State, direction: Vector3State, range: number): readonly MapObstacle[] {
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.visited.fill(0);
      this.generation = 1;
    }
    this.candidateIndices.length = 0;
    this.candidates.length = 0;

    let cellX = Math.floor(origin.x / COMBAT_GRID_CELL_SIZE);
    let cellZ = Math.floor(origin.z / COMBAT_GRID_CELL_SIZE);
    const endX = origin.x + direction.x * range;
    const endZ = origin.z + direction.z * range;
    const endCellX = Math.floor(endX / COMBAT_GRID_CELL_SIZE);
    const endCellZ = Math.floor(endZ / COMBAT_GRID_CELL_SIZE);
    const stepX = direction.x > GEOMETRY_EPSILON ? 1 : direction.x < -GEOMETRY_EPSILON ? -1 : 0;
    const stepZ = direction.z > GEOMETRY_EPSILON ? 1 : direction.z < -GEOMETRY_EPSILON ? -1 : 0;
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(COMBAT_GRID_CELL_SIZE / direction.x);
    const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(COMBAT_GRID_CELL_SIZE / direction.z);
    const boundaryX = stepX > 0 ? (cellX + 1) * COMBAT_GRID_CELL_SIZE : cellX * COMBAT_GRID_CELL_SIZE;
    const boundaryZ = stepZ > 0 ? (cellZ + 1) * COMBAT_GRID_CELL_SIZE : cellZ * COMBAT_GRID_CELL_SIZE;
    let distanceX = stepX === 0 ? Number.POSITIVE_INFINITY : (boundaryX - origin.x) / direction.x;
    let distanceZ = stepZ === 0 ? Number.POSITIVE_INFINITY : (boundaryZ - origin.z) / direction.z;
    const maximumCells = Math.abs(endCellX - cellX) + Math.abs(endCellZ - cellZ) + 3;

    for (let visitedCells = 0; visitedCells < maximumCells; visitedCells += 1) {
      this.addCell(cellX, cellZ);
      if (cellX === endCellX && cellZ === endCellZ) break;
      if (Math.abs(distanceX - distanceZ) <= GEOMETRY_EPSILON) {
        this.addCell(cellX + stepX, cellZ);
        this.addCell(cellX, cellZ + stepZ);
        cellX += stepX;
        cellZ += stepZ;
        distanceX += deltaX;
        distanceZ += deltaZ;
      } else if (distanceX < distanceZ) {
        cellX += stepX;
        distanceX += deltaX;
      } else {
        cellZ += stepZ;
        distanceZ += deltaZ;
      }
    }

    this.candidateIndices.sort(compareNumbers);
    for (const index of this.candidateIndices) {
      const obstacle = this.obstacles[index];
      if (obstacle) this.candidates.push(obstacle);
    }
    return this.candidates;
  }

  private addCell(cellX: number, cellZ: number): void {
    const cell = this.cells.get(combatGridKey(cellX, cellZ));
    if (!cell) return;
    for (const index of cell) {
      if (this.visited[index] === this.generation) continue;
      this.visited[index] = this.generation;
      this.candidateIndices.push(index);
    }
  }
}

function combatGridKey(cellX: number, cellZ: number): number {
  return (cellX + COMBAT_GRID_KEY_OFFSET) * 65_536 + cellZ + COMBAT_GRID_KEY_OFFSET;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function environmentObstacles(layout: MapLayout): readonly MapObstacle[] {
  return [
    ...layout.wallSegments,
    ...layout.rockObstacles,
    ...layout.coverObstacles,
    ...layout.floorSlabs,
  ];
}

interface ActorSurfaceHit {
  distance: number;
  normal: Vector3State;
}

function intersectActor(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  actor: ActorState,
): ActorSurfaceHit | null {
  const feetY = actor.position.y - ACTOR_EYE_TO_FEET;
  const segmentMinY = feetY + ACTOR_HIT_RADIUS;
  const segmentMaxY = feetY + ACTOR_HIT_HEIGHT - ACTOR_HIT_RADIUS;
  const closestY = clamp(origin.y, segmentMinY, segmentMaxY);
  const originDistanceSquared =
    (origin.x - actor.position.x) ** 2 +
    (origin.y - closestY) ** 2 +
    (origin.z - actor.position.z) ** 2;
  if (originDistanceSquared <= ACTOR_HIT_RADIUS ** 2) {
    return { distance: 0, normal: { x: -direction.x, y: -direction.y, z: -direction.z } };
  }

  let nearest = Number.POSITIVE_INFINITY;
  let normalX = -direction.x;
  let normalY = -direction.y;
  let normalZ = -direction.z;
  const radialA = direction.x ** 2 + direction.z ** 2;
  if (radialA > GEOMETRY_EPSILON) {
    const offsetX = origin.x - actor.position.x;
    const offsetZ = origin.z - actor.position.z;
    const radialB = 2 * (offsetX * direction.x + offsetZ * direction.z);
    const radialC = offsetX ** 2 + offsetZ ** 2 - ACTOR_HIT_RADIUS ** 2;
    const discriminant = radialB ** 2 - 4 * radialA * radialC;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const nearDistance = (-radialB - root) / (2 * radialA);
      const farDistance = (-radialB + root) / (2 * radialA);
      for (let rootIndex = 0; rootIndex < 2; rootIndex += 1) {
        const distance = rootIndex === 0 ? nearDistance : farDistance;
        const y = origin.y + direction.y * distance;
        if (distance >= 0 && distance <= range && y >= segmentMinY && y <= segmentMaxY) {
          if (distance < nearest) {
            nearest = distance;
            const offsetX = origin.x + direction.x * distance - actor.position.x;
            const offsetZ = origin.z + direction.z * distance - actor.position.z;
            const magnitude = Math.hypot(offsetX, offsetZ);
            if (magnitude > GEOMETRY_EPSILON) {
              normalX = offsetX / magnitude;
              normalY = 0;
              normalZ = offsetZ / magnitude;
            }
          }
        }
      }
    }
  }

  for (let capIndex = 0; capIndex < 2; capIndex += 1) {
    const centerY = capIndex === 0 ? segmentMinY : segmentMaxY;
    const distance = intersectSphereCoordinates(
      origin,
      direction,
      range,
      actor.position.x,
      centerY,
      actor.position.z,
      ACTOR_HIT_RADIUS,
    );
    if (distance !== null) {
      if (distance < nearest) {
        nearest = distance;
        const offsetX = origin.x + direction.x * distance - actor.position.x;
        const offsetY = origin.y + direction.y * distance - centerY;
        const offsetZ = origin.z + direction.z * distance - actor.position.z;
        const magnitude = Math.hypot(offsetX, offsetY, offsetZ);
        if (magnitude > GEOMETRY_EPSILON) {
          normalX = offsetX / magnitude;
          normalY = offsetY / magnitude;
          normalZ = offsetZ / magnitude;
        }
      }
    }
  }
  return Number.isFinite(nearest)
    ? { distance: nearest, normal: { x: normalX, y: normalY, z: normalZ } }
    : null;
}

function intersectSphereCoordinates(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
): number | null {
  const offsetX = origin.x - centerX;
  const offsetY = origin.y - centerY;
  const offsetZ = origin.z - centerZ;
  const projected = offsetX * direction.x + offsetY * direction.y + offsetZ * direction.z;
  const discriminant = projected ** 2 -
    (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ - radius ** 2);
  if (discriminant < 0) {
    return null;
  }
  const root = Math.sqrt(discriminant);
  const near = -projected - root;
  const far = -projected + root;
  const distance = near >= 0 ? near : far >= 0 ? far : null;
  return distance !== null && distance <= range ? distance : null;
}

interface SurfaceHit {
  distance: number;
  normal: Vector3State;
}

function intersectObstacle(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  obstacle: MapObstacle,
): SurfaceHit | null {
  return intersectBoxBounds(
    origin,
    direction,
    range,
    obstacle.center.x - obstacle.width / 2,
    obstacle.center.x + obstacle.width / 2,
    obstacle.center.y - obstacle.height / 2,
    obstacle.center.y + obstacle.height / 2,
    obstacle.center.z - obstacle.depth / 2,
    obstacle.center.z + obstacle.depth / 2,
  );
}

function intersectBoxBounds(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
  minimumZ: number,
  maximumZ: number,
): SurfaceHit | null {
  let near = 0;
  let far = range;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;

  if (Math.abs(direction.x) <= GEOMETRY_EPSILON) {
    if (origin.x < minimumX || origin.x > maximumX) return null;
  } else {
    const first = (minimumX - origin.x) / direction.x;
    const second = (maximumX - origin.x) / direction.x;
    const axisNear = Math.min(first, second);
    if (axisNear > near) {
      near = axisNear;
      normalX = first < second ? -1 : 1;
      normalY = 0;
      normalZ = 0;
    }
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }

  if (Math.abs(direction.y) <= GEOMETRY_EPSILON) {
    if (origin.y < minimumY || origin.y > maximumY) return null;
  } else {
    const first = (minimumY - origin.y) / direction.y;
    const second = (maximumY - origin.y) / direction.y;
    const axisNear = Math.min(first, second);
    if (axisNear > near) {
      near = axisNear;
      normalX = 0;
      normalY = first < second ? -1 : 1;
      normalZ = 0;
    }
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }

  if (Math.abs(direction.z) <= GEOMETRY_EPSILON) {
    if (origin.z < minimumZ || origin.z > maximumZ) return null;
  } else {
    const first = (minimumZ - origin.z) / direction.z;
    const second = (maximumZ - origin.z) / direction.z;
    const axisNear = Math.min(first, second);
    if (axisNear > near) {
      near = axisNear;
      normalX = 0;
      normalY = 0;
      normalZ = first < second ? -1 : 1;
    }
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  return near <= range
    ? { distance: near, normal: { x: normalX, y: normalY, z: normalZ } }
    : null;
}

function intersectTerrain(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  layout: MapLayout,
): SurfaceHit | null {
  const initialOffset = terrainOffsetAt(origin.x, origin.y, origin.z, layout);
  if (initialOffset !== null && initialOffset <= 0) {
    return { distance: 0, normal: terrainNormal(origin.x, origin.z, layout) };
  }
  const stepSize = Math.max(0.5, Math.min(2, range / 80));
  let previousDistance = 0;
  let previousOffset = initialOffset;
  for (let distance = stepSize; distance <= range + stepSize; distance += stepSize) {
    const boundedDistance = Math.min(distance, range);
    const pointX = origin.x + direction.x * boundedDistance;
    const pointY = origin.y + direction.y * boundedDistance;
    const pointZ = origin.z + direction.z * boundedDistance;
    const offset = terrainOffsetAt(pointX, pointY, pointZ, layout);
    if (offset !== null && offset <= 0 && (previousOffset === null || previousOffset > 0)) {
      let low = previousDistance;
      let high = boundedDistance;
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const middle = (low + high) / 2;
        const middleOffset = terrainOffsetAt(
          origin.x + direction.x * middle,
          origin.y + direction.y * middle,
          origin.z + direction.z * middle,
          layout,
        );
        if (middleOffset === null || middleOffset > 0) {
          low = middle;
        } else {
          high = middle;
        }
      }
      const impact = pointAlong(origin, direction, high);
      return { distance: high, normal: terrainNormal(impact.x, impact.z, layout) };
    }
    if (boundedDistance === range) break;
    previousDistance = boundedDistance;
    previousOffset = offset;
  }
  return null;
}

function intersectRamp(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  ramp: RoofRamp,
): SurfaceHit | null {
  const slope = (ramp.topY - ramp.bottomY) / (ramp.endZ - ramp.startZ);
  const denominator = direction.y - slope * direction.z;
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
  const distance = (ramp.bottomY + slope * (origin.z - ramp.startZ) - origin.y) / denominator;
  if (distance < 0 || distance > range) return null;
  const point = pointAlong(origin, direction, distance);
  if (Math.abs(point.x - ramp.centerX) > ramp.width / 2 || getRampHeight(ramp, point.x, point.z) === null) {
    return null;
  }
  let normal = normalize({ x: 0, y: 1, z: -slope }) ?? { x: 0, y: 1, z: 0 };
  if (dot(normal, direction) > 0) normal = scale(normal, -1);
  return { distance, normal };
}

function terrainOffsetAt(x: number, y: number, z: number, layout: MapLayout): number | null {
  if (Math.abs(x) > MAP_HALF_SIZE || Math.abs(z) > MAP_HALF_SIZE) return null;
  return y - getTerrainHeight(x, z, layout);
}

function terrainNormal(x: number, z: number, layout: MapLayout): Vector3State {
  const sample = 0.4;
  const left = getTerrainHeight(x - sample, z, layout);
  const right = getTerrainHeight(x + sample, z, layout);
  const back = getTerrainHeight(x, z - sample, layout);
  const front = getTerrainHeight(x, z + sample, layout);
  return normalize({ x: left - right, y: sample * 2, z: back - front }) ?? { x: 0, y: 1, z: 0 };
}

function normalize(value: Vector3State): Vector3State | null {
  const magnitude = length(value);
  return magnitude > GEOMETRY_EPSILON
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : null;
}

function subtract(left: Vector3State, right: Vector3State): Vector3State {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value: Vector3State, amount: number): Vector3State {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function pointAlong(origin: Vector3State, direction: Vector3State, distance: number): Vector3State {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

function missResult(origin: Vector3State, direction: Vector3State, range: number): ShotResult {
  return {
    targetId: null,
    point: pointAlong(origin, direction, range),
    normal: scale(direction, -1),
    hitType: "miss",
  };
}

function dot(left: Vector3State, right: Vector3State): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function length(value: Vector3State): number {
  return Math.hypot(value.x, value.y, value.z);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
