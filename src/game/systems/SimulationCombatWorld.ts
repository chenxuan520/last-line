import {
  createMapLayout,
  getTerrainHeight,
  getRampHeight,
  MAP_HALF_SIZE,
  type MapLayout,
  type MapObstacle,
  type RoofRamp,
} from "../../config/map";
import { ACTOR_EYE_HEIGHT, ACTOR_HEIGHT, ACTOR_RADIUS } from "../rules/actorGeometry";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";
import { StaticGridIndex } from "../spatial/StaticGridIndex";
import type {
  CombatWorld,
  ShotResult,
  ShotTrace,
  ThrowableCollision,
} from "./CombatSystem";

const GEOMETRY_EPSILON = 1e-9;
const COMBAT_GRID_CELL_SIZE = 32;

export type ActorHitboxState = Pick<ActorState, "id" | "position" | "alive" | "deployment">;

export class SimulationCombatWorld implements CombatWorld {
  private layout: MapLayout;
  private layoutMapId: MatchState["mapId"];
  private layoutSeed: number;
  private environmentObstacles: readonly MapObstacle[];
  private obstacleIndex: StaticGridIndex<MapObstacle>;
  private rampIndex: StaticGridIndex<RoofRamp>;

  public constructor(
    private readonly state: MatchState,
    private readonly useSpatialIndex = true,
    initialLayout: MapLayout = createMapLayout(state.mapId, state.mapSeed),
  ) {
    this.layoutMapId = initialLayout.mapId;
    this.layoutSeed = initialLayout.seed;
    this.layout = initialLayout;
    this.environmentObstacles = environmentObstacles(this.layout);
    this.obstacleIndex = createObstacleIndex(this.environmentObstacles);
    this.rampIndex = createRampIndex(this.layout.roofRamps);
  }

  public traceShot(trace: ShotTrace): EntityId | null {
    return this.traceShotDetailed(trace).targetId;
  }

  public traceShotDetailed(trace: ShotTrace): ShotResult {
    return this.traceShotDetailedAgainstActors(trace, this.state.actors);
  }

  public traceShotDetailedAgainstActors(
    trace: ShotTrace,
    actors: Readonly<Record<EntityId, ActorHitboxState>>,
  ): ShotResult {
    const direction = normalize(trace.direction);
    if (!direction || !Number.isFinite(trace.range) || trace.range <= 0) {
      return missResult(trace.origin, { x: 0, y: 0, z: 1 }, 0);
    }

    const layout = this.getLayout();
    let nearestEnvironment: SurfaceHit | null = intersectTerrain(trace.origin, direction, trace.range, layout);
    const obstacles = this.useSpatialIndex
      ? this.obstacleIndex.querySegment(
        trace.origin.x,
        trace.origin.z,
        trace.origin.x + direction.x * trace.range,
        trace.origin.z + direction.z * trace.range,
      )
      : this.environmentObstacles;
    for (const obstacle of obstacles) {
      const hit = intersectObstacle(trace.origin, direction, trace.range, obstacle);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }
    const ramps = this.useSpatialIndex
      ? this.rampIndex.querySegment(
        trace.origin.x,
        trace.origin.z,
        trace.origin.x + direction.x * trace.range,
        trace.origin.z + direction.z * trace.range,
      )
      : layout.roofRamps;
    for (const ramp of ramps) {
      const hit = intersectRamp(trace.origin, direction, trace.range, ramp);
      if (hit && (!nearestEnvironment || hit.distance < nearestEnvironment.distance)) {
        nearestEnvironment = hit;
      }
    }

    let nearestActorId: EntityId | null = null;
    let nearestActorHit: ActorSurfaceHit | null = null;
    for (const actorId in actors) {
      const actor = actors[actorId];
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

  public traceThrowable(
    origin: Vector3State,
    displacement: Vector3State,
    radius: number,
  ): ThrowableCollision | null {
    const distance = length(displacement);
    const direction = normalize(displacement);
    if (!direction || !Number.isFinite(radius) || radius < 0) return null;
    const layout = this.getLayout();
    let nearest = intersectTerrain(
      { ...origin, y: origin.y - radius },
      direction,
      distance,
      layout,
    );
    const obstacles = this.useSpatialIndex
      ? this.obstacleIndex.querySegment(
        origin.x,
        origin.z,
        origin.x + displacement.x,
        origin.z + displacement.z,
        radius,
      )
      : this.environmentObstacles;
    for (const obstacle of obstacles) {
      const hit = intersectExpandedObstacle(origin, direction, distance, obstacle, radius);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    const ramps = this.useSpatialIndex
      ? this.rampIndex.querySegment(
        origin.x,
        origin.z,
        origin.x + displacement.x,
        origin.z + displacement.z,
        radius,
      )
      : layout.roofRamps;
    for (const ramp of ramps) {
      const hit = intersectExpandedRamp(origin, direction, distance, ramp, radius);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    return nearest
      ? {
          point: pointAlong(origin, direction, Math.max(0, nearest.distance - 0.001)),
          normal: nearest.normal,
        }
      : null;
  }

  public hasExplosionLineOfSight(origin: Vector3State, target: Vector3State): boolean {
    const offset = subtract(target, origin);
    const distance = length(offset);
    const direction = normalize(offset);
    if (!direction || distance <= GEOMETRY_EPSILON) return true;
    const result = this.traceShotDetailedAgainstActors(
      {
        shooterId: "__grenade__",
        origin,
        direction,
        range: Math.max(0, distance - 0.05),
      },
      {},
    );
    return result.hitType === "miss";
  }

  private getLayout(): MapLayout {
    if (this.layoutMapId !== this.state.mapId || this.layoutSeed !== this.state.mapSeed) {
      this.layoutMapId = this.state.mapId;
      this.layoutSeed = this.state.mapSeed;
      this.layout = createMapLayout(this.state.mapId, this.state.mapSeed);
      this.environmentObstacles = environmentObstacles(this.layout);
      this.obstacleIndex = createObstacleIndex(this.environmentObstacles);
      this.rampIndex = createRampIndex(this.layout.roofRamps);
    }
    return this.layout;
  }
}

function createObstacleIndex(obstacles: readonly MapObstacle[]): StaticGridIndex<MapObstacle> {
  return new StaticGridIndex(obstacles, COMBAT_GRID_CELL_SIZE, (obstacle) => ({
    minimumX: obstacle.center.x - obstacle.width / 2,
    maximumX: obstacle.center.x + obstacle.width / 2,
    minimumZ: obstacle.center.z - obstacle.depth / 2,
    maximumZ: obstacle.center.z + obstacle.depth / 2,
  }));
}

function createRampIndex(ramps: readonly RoofRamp[]): StaticGridIndex<RoofRamp> {
  return new StaticGridIndex(ramps, COMBAT_GRID_CELL_SIZE, (ramp) => ({
    minimumX: ramp.centerX - ramp.width / 2,
    maximumX: ramp.centerX + ramp.width / 2,
    minimumZ: Math.min(ramp.startZ, ramp.endZ),
    maximumZ: Math.max(ramp.startZ, ramp.endZ),
  }));
}

function environmentObstacles(layout: MapLayout): readonly MapObstacle[] {
  return [
    ...layout.wallSegments,
    ...layout.rockObstacles,
    ...layout.coverObstacles,
    ...layout.treeTrunks,
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
  actor: ActorHitboxState,
): ActorSurfaceHit | null {
    const feetY = actor.position.y - ACTOR_EYE_HEIGHT;
    const segmentMinY = feetY + ACTOR_RADIUS;
    const segmentMaxY = feetY + ACTOR_HEIGHT - ACTOR_RADIUS;
  const closestY = clamp(origin.y, segmentMinY, segmentMaxY);
  const originDistanceSquared =
    (origin.x - actor.position.x) ** 2 +
    (origin.y - closestY) ** 2 +
    (origin.z - actor.position.z) ** 2;
    if (originDistanceSquared <= ACTOR_RADIUS ** 2) {
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
    const radialC = offsetX ** 2 + offsetZ ** 2 - ACTOR_RADIUS ** 2;
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
      ACTOR_RADIUS,
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

function intersectExpandedObstacle(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  obstacle: MapObstacle,
  radius: number,
): SurfaceHit | null {
  return intersectBoxBounds(
    origin,
    direction,
    range,
    obstacle.center.x - obstacle.width / 2 - radius,
    obstacle.center.x + obstacle.width / 2 + radius,
    obstacle.center.y - obstacle.height / 2 - radius,
    obstacle.center.y + obstacle.height / 2 + radius,
    obstacle.center.z - obstacle.depth / 2 - radius,
    obstacle.center.z + obstacle.depth / 2 + radius,
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

function intersectExpandedRamp(
  origin: Vector3State,
  direction: Vector3State,
  range: number,
  ramp: RoofRamp,
  radius: number,
): SurfaceHit | null {
  const radiusSquared = radius ** 2;
  const start = rampDistanceSquared(origin, ramp);
  if (start.distanceSquared <= radiusSquared) {
    return {
      distance: 0,
      normal: rampContactNormal(origin, start.closest, direction, ramp),
    };
  }

  let minimum = 0;
  let maximum = range;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const first = minimum + (maximum - minimum) / 3;
    const second = maximum - (maximum - minimum) / 3;
    const firstDistance = rampDistanceSquared(pointAlong(origin, direction, first), ramp).distanceSquared;
    const secondDistance = rampDistanceSquared(pointAlong(origin, direction, second), ramp).distanceSquared;
    if (firstDistance <= secondDistance) maximum = second;
    else minimum = first;
  }
  const nearestDistance = (minimum + maximum) / 2;
  if (
    nearestDistance <= GEOMETRY_EPSILON ||
    rampDistanceSquared(pointAlong(origin, direction, nearestDistance), ramp).distanceSquared >
      radiusSquared + GEOMETRY_EPSILON
  ) return null;

  let outsideDistance = 0;
  let insideDistance = nearestDistance;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (outsideDistance + insideDistance) / 2;
    const distanceSquared = rampDistanceSquared(pointAlong(origin, direction, middle), ramp).distanceSquared;
    if (distanceSquared <= radiusSquared) insideDistance = middle;
    else outsideDistance = middle;
  }
  const point = pointAlong(origin, direction, insideDistance);
  const contact = rampDistanceSquared(point, ramp);
  return {
    distance: insideDistance,
    normal: rampContactNormal(point, contact.closest, direction, ramp),
  };
}

function rampDistanceSquared(
  point: Vector3State,
  ramp: RoofRamp,
): { distanceSquared: number; closest: Vector3State } {
  const center = {
    x: ramp.centerX,
    y: (ramp.bottomY + ramp.topY) / 2,
    z: (ramp.startZ + ramp.endZ) / 2,
  };
  const deltaY = ramp.topY - ramp.bottomY;
  const deltaZ = ramp.endZ - ramp.startZ;
  const rampLength = Math.hypot(deltaY, deltaZ);
  const alongY = rampLength > GEOMETRY_EPSILON ? deltaY / rampLength : 0;
  const alongZ = rampLength > GEOMETRY_EPSILON ? deltaZ / rampLength : 1;
  const offset = subtract(point, center);
  const across = clamp(offset.x, -ramp.width / 2, ramp.width / 2);
  const along = clamp(
    offset.y * alongY + offset.z * alongZ,
    -rampLength / 2,
    rampLength / 2,
  );
  const closest = {
    x: center.x + across,
    y: center.y + alongY * along,
    z: center.z + alongZ * along,
  };
  const distance = subtract(point, closest);
  return {
    distanceSquared: dot(distance, distance),
    closest,
  };
}

function rampContactNormal(
  point: Vector3State,
  closest: Vector3State,
  direction: Vector3State,
  ramp: RoofRamp,
): Vector3State {
  const contactNormal = normalize(subtract(point, closest));
  if (contactNormal) return contactNormal;
  const slope = (ramp.topY - ramp.bottomY) / (ramp.endZ - ramp.startZ);
  let planeNormal = normalize({ x: 0, y: 1, z: -slope }) ?? { x: 0, y: 1, z: 0 };
  if (dot(planeNormal, direction) > 0) planeNormal = scale(planeNormal, -1);
  return planeNormal;
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
