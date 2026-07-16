import { MAP_OBSTACLES, type MapObstacle } from "../../config/map";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";
import type { CombatWorld, ShotTrace } from "./CombatSystem";

const ACTOR_HIT_HEIGHT = 1.8;
const ACTOR_HIT_RADIUS = 0.42;
const ACTOR_EYE_TO_FEET = 1.76;
const GEOMETRY_EPSILON = 1e-9;

export class SimulationCombatWorld implements CombatWorld {
  public constructor(private readonly state: MatchState) {}

  public traceShot(trace: ShotTrace): EntityId | null {
    const direction = normalize(trace.direction);
    if (!direction || !Number.isFinite(trace.range) || trace.range <= 0) {
      return null;
    }

    let nearestObstacleDistance = Number.POSITIVE_INFINITY;
    for (const obstacle of MAP_OBSTACLES) {
      const distance = intersectObstacle(trace.origin, direction, trace.range, obstacle);
      if (distance !== null && distance < nearestObstacleDistance) {
        nearestObstacleDistance = distance;
      }
    }

    let nearestActorId: EntityId | null = null;
    let nearestActorDistance = Number.POSITIVE_INFINITY;
    const actors = Object.values(this.state.actors).sort((left, right) => compareIds(left.id, right.id));
    for (const actor of actors) {
      if (!actor.alive || actor.id === trace.shooterId) {
        continue;
      }
      const distance = intersectActor(trace.origin, direction, trace.range, actor);
      if (
        distance !== null &&
        (distance < nearestActorDistance - GEOMETRY_EPSILON ||
          (Math.abs(distance - nearestActorDistance) <= GEOMETRY_EPSILON &&
            (nearestActorId === null || actor.id < nearestActorId)))
      ) {
        nearestActorId = actor.id;
        nearestActorDistance = distance;
      }
    }

    return nearestActorId && nearestActorDistance < nearestObstacleDistance - GEOMETRY_EPSILON
      ? nearestActorId
      : null;
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

function intersectActor(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  actor: ActorState,
): number | null {
  const feetY = actor.position.y - ACTOR_EYE_TO_FEET;
  const segmentMinY = feetY + ACTOR_HIT_RADIUS;
  const segmentMaxY = feetY + ACTOR_HIT_HEIGHT - ACTOR_HIT_RADIUS;
  const closestY = clamp(origin.y, segmentMinY, segmentMaxY);
  const originDistanceSquared =
    (origin.x - actor.position.x) ** 2 +
    (origin.y - closestY) ** 2 +
    (origin.z - actor.position.z) ** 2;
  if (originDistanceSquared <= ACTOR_HIT_RADIUS ** 2) {
    return 0;
  }

  let nearest = Number.POSITIVE_INFINITY;
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
          nearest = Math.min(nearest, distance);
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
      nearest = Math.min(nearest, distance);
    }
  }
  return Number.isFinite(nearest) ? nearest : null;
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

function intersectObstacle(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  obstacle: MapObstacle,
): number | null {
  let near = 0;
  let far = range;
  const bounds: readonly [keyof Vector3State, number][] = [
    ["x", obstacle.width / 2],
    ["y", obstacle.height / 2],
    ["z", obstacle.depth / 2],
  ];
  for (const [axis, halfSize] of bounds) {
    const minimum = obstacle.center[axis] - halfSize;
    const maximum = obstacle.center[axis] + halfSize;
    if (Math.abs(direction[axis]) <= GEOMETRY_EPSILON) {
      if (origin[axis] < minimum || origin[axis] > maximum) {
        return null;
      }
      continue;
    }
    const first = (minimum - origin[axis]) / direction[axis];
    const second = (maximum - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) {
      return null;
    }
  }
  return near <= range ? near : null;
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
