import {
  BUILDING_ROOF_CAP_HEIGHT,
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

export class SimulationCombatWorld implements CombatWorld {
  public constructor(private readonly state: MatchState) {}

  public traceShot(trace: ShotTrace): EntityId | null {
    return this.traceShotDetailed(trace).targetId;
  }

  public traceShotDetailed(trace: ShotTrace): ShotResult {
    const direction = normalize(trace.direction);
    if (!direction || !Number.isFinite(trace.range) || trace.range <= 0) {
      return missResult(trace.origin, { x: 0, y: 0, z: 1 }, 0);
    }

    const layout = createMapLayout(this.state.mapSeed);
    let nearestEnvironment: SurfaceHit | null = intersectTerrain(trace.origin, direction, trace.range, layout);
    for (const wall of layout.wallSegments) {
      const hit = intersectObstacle(trace.origin, direction, trace.range, wall);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }
    for (const rock of layout.rockObstacles) {
      const hit = intersectObstacle(trace.origin, direction, trace.range, rock);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }
    for (const obstacle of layout.obstacles) {
      const hit = intersectRoofCap(trace.origin, direction, trace.range, obstacle);
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
    const actors = Object.values(this.state.actors).sort((left, right) => compareIds(left.id, right.id));
    for (const actor of actors) {
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
    return { distance: 0, normal: scale(direction, -1) };
  }

  let nearest = Number.POSITIVE_INFINITY;
  let nearestNormal: Vector3State = scale(direction, -1);
  const radialA = direction.x ** 2 + direction.z ** 2;
  if (radialA > GEOMETRY_EPSILON) {
    const offsetX = origin.x - actor.position.x;
    const offsetZ = origin.z - actor.position.z;
    const radialB = 2 * (offsetX * direction.x + offsetZ * direction.z);
    const radialC = offsetX ** 2 + offsetZ ** 2 - ACTOR_HIT_RADIUS ** 2;
    const discriminant = radialB ** 2 - 4 * radialA * radialC;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const distances = [(-radialB - root) / (2 * radialA), (-radialB + root) / (2 * radialA)];
      for (const distance of distances) {
        const y = origin.y + direction.y * distance;
        if (distance >= 0 && distance <= range && y >= segmentMinY && y <= segmentMaxY) {
          if (distance < nearest) {
            nearest = distance;
            const point = pointAlong(origin, direction, distance);
            nearestNormal = normalize({ x: point.x - actor.position.x, y: 0, z: point.z - actor.position.z }) ?? nearestNormal;
          }
        }
      }
    }
  }

  for (const centerY of [segmentMinY, segmentMaxY]) {
    const distance = intersectSphere(
      origin,
      direction,
      range,
      { x: actor.position.x, y: centerY, z: actor.position.z },
      ACTOR_HIT_RADIUS,
    );
    if (distance !== null) {
      if (distance < nearest) {
        nearest = distance;
        const point = pointAlong(origin, direction, distance);
        nearestNormal = normalize(subtract(point, { x: actor.position.x, y: centerY, z: actor.position.z })) ?? nearestNormal;
      }
    }
  }
  return Number.isFinite(nearest) ? { distance: nearest, normal: nearestNormal } : null;
}

function intersectSphere(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  center: Vector3State,
  radius: number,
): number | null {
  const offset = subtract(origin, center);
  const projected = dot(offset, direction);
  const discriminant = projected ** 2 - (dot(offset, offset) - radius ** 2);
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
  return intersectBox(
    origin,
    direction,
    range,
    [
      ["x", obstacle.center.x - obstacle.width / 2, obstacle.center.x + obstacle.width / 2],
      ["y", obstacle.center.y - obstacle.height / 2, obstacle.center.y + obstacle.height / 2],
      ["z", obstacle.center.z - obstacle.depth / 2, obstacle.center.z + obstacle.depth / 2],
    ],
  );
}

function intersectBox(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  bounds: readonly (readonly [keyof Vector3State, number, number])[],
): SurfaceHit | null {
  let near = 0;
  let far = range;
  let hitNormal: Vector3State = { x: 0, y: 0, z: 0 };
  for (const [axis, minimum, maximum] of bounds) {
    if (Math.abs(direction[axis]) <= GEOMETRY_EPSILON) {
      if (origin[axis] < minimum || origin[axis] > maximum) {
        return null;
      }
      continue;
    }
    const first = (minimum - origin[axis]) / direction[axis];
    const second = (maximum - origin[axis]) / direction[axis];
    const axisNear = Math.min(first, second);
    if (axisNear > near) {
      near = axisNear;
      hitNormal = { x: 0, y: 0, z: 0 };
      hitNormal[axis] = first < second ? -1 : 1;
    }
    far = Math.min(far, Math.max(first, second));
    if (near > far) {
      return null;
    }
  }
  return near <= range ? { distance: near, normal: hitNormal } : null;
}

function intersectRoofCap(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  obstacle: MapObstacle,
): SurfaceHit | null {
  const roofMinimumY = obstacle.center.y + obstacle.height / 2;
  const roofMaximumY = roofMinimumY + BUILDING_ROOF_CAP_HEIGHT;
  return intersectBox(
    origin,
    direction,
    range,
    [
      ["x", obstacle.center.x - obstacle.width / 2, obstacle.center.x + obstacle.width / 2],
      ["y", roofMinimumY, roofMaximumY],
      ["z", obstacle.center.z - obstacle.depth / 2, obstacle.center.z + obstacle.depth / 2],
    ],
  );
}

function intersectTerrain(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  layout: MapLayout,
): SurfaceHit | null {
  const initialOffset = terrainOffset(origin, layout);
  if (initialOffset !== null && initialOffset <= 0) {
    return { distance: 0, normal: terrainNormal(origin.x, origin.z, layout) };
  }
  const stepSize = Math.max(0.5, Math.min(2, range / 80));
  let previousDistance = 0;
  let previousOffset = initialOffset;
  for (let distance = stepSize; distance <= range + stepSize; distance += stepSize) {
    const boundedDistance = Math.min(distance, range);
    const point = pointAlong(origin, direction, boundedDistance);
    const offset = terrainOffset(point, layout);
    if (offset !== null && offset <= 0 && (previousOffset === null || previousOffset > 0)) {
      let low = previousDistance;
      let high = boundedDistance;
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const middle = (low + high) / 2;
        const middlePoint = pointAlong(origin, direction, middle);
        const middleOffset = terrainOffset(middlePoint, layout);
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

function terrainOffset(point: Vector3State, layout: MapLayout): number | null {
  if (Math.abs(point.x) > MAP_HALF_SIZE || Math.abs(point.z) > MAP_HALF_SIZE) return null;
  return point.y - getTerrainHeight(point.x, point.z, layout);
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

function compareIds(left: EntityId, right: EntityId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
