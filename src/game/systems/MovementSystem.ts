import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  MAP_HALF_SIZE,
  type MapLayout,
  type MapWallSegment,
} from "../../config/map";
import type { ActorCommand } from "../commands/ActorCommand";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";

const WALK_SPEED = 8.7;
export const SPRINT_SPEED = 11.5;
const MIN_GLIDE_SPEED = 8;
const MAX_GLIDE_SPEED = 64;
const GLIDE_ACCELERATION_ALTITUDE = 20;
const GLIDE_SPEED_PER_METER = 0.4;
const PARACHUTE_DESCENT_SPEED = 5;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const EYE_HEIGHT = 1.76;
const ACTOR_RADIUS = 0.42;
const MAX_COLLISION_STEP = ACTOR_RADIUS / 2;
const MAX_STEP_UP = 0.35;
const SURFACE_EPSILON = 0.08;
const WALL_COLLISION_CELL_SIZE = 64;
const wallCollisionIndexes = new WeakMap<MapLayout, Map<string, MapWallSegment[]>>();

export class MovementSystem {
  public processCommand(
    state: MatchState,
    actorId: EntityId,
    command: ActorCommand,
    deltaSeconds: number,
  ): void {
    const actor = state.actors[actorId];
    if (!actor?.alive || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    const layout = createMapLayout(state.mapSeed);

    const aimLength = Math.hypot(command.aimDirection.x, command.aimDirection.z);
    if (aimLength > 0) {
      actor.yaw = Math.atan2(command.aimDirection.x, command.aimDirection.z);
      actor.pitch = Math.atan2(-command.aimDirection.y, aimLength);
    }

    if (actor.deployment === "aircraft") {
      const deploymentLimit = MAP_HALF_SIZE - ACTOR_RADIUS;
      if (
        !command.jump ||
        Math.abs(actor.position.x) > deploymentLimit ||
        Math.abs(actor.position.z) > deploymentLimit
      ) {
        return;
      }
      actor.deployment = "parachuting";
      actor.velocity = { x: 0, y: -PARACHUTE_DESCENT_SPEED, z: 0 };
    }

    if (actor.deployment === "parachuting") {
      const terrainEyeY = getTerrainHeight(actor.position.x, actor.position.z, layout) + EYE_HEIGHT;
      const altitude = Math.max(0, actor.position.y - terrainEyeY);
      const glideSpeed = clamp(
        MIN_GLIDE_SPEED + Math.max(0, altitude - GLIDE_ACCELERATION_ALTITUDE) * GLIDE_SPEED_PER_METER,
        MIN_GLIDE_SPEED,
        MAX_GLIDE_SPEED,
      );
      this.moveHorizontally(actor, command.move, glideSpeed, deltaSeconds, layout);
      actor.velocity.y = -PARACHUTE_DESCENT_SPEED;
      actor.position.y += actor.velocity.y * deltaSeconds;
      const supportEyeY = getSupportHeight(actor.position.x, actor.position.z, Number.POSITIVE_INFINITY, layout) + EYE_HEIGHT;
      if (actor.position.y <= supportEyeY) {
        actor.position.y = supportEyeY;
        actor.velocity = { x: 0, y: 0, z: 0 };
        actor.deployment = "grounded";
      }
      return;
    }

    this.moveHorizontally(actor, command.move, command.sprint ? SPRINT_SPEED : WALK_SPEED, deltaSeconds, layout);
    this.moveVertically(actor, command.jump, deltaSeconds, layout);
  }

  private moveHorizontally(
    actor: ActorState,
    movement: Vector3State,
    speed: number,
    deltaSeconds: number,
    layout: MapLayout,
  ): void {
    const inputLength = Math.hypot(movement.x, movement.z);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    actor.velocity.x = movement.x * inputScale * speed;
    actor.velocity.z = movement.z * inputScale * speed;

    const startingSupport = getSupportHeight(
      actor.position.x,
      actor.position.z,
      actor.position.y - EYE_HEIGHT + SURFACE_EPSILON,
      layout,
    );
    const wasSupported = actor.velocity.y <= 0 && Math.abs(actor.position.y - (startingSupport + EYE_HEIGHT)) <= SURFACE_EPSILON;
    const deltaX = actor.velocity.x * deltaSeconds;
    const deltaZ = actor.velocity.z * deltaSeconds;
    const stepCount = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / MAX_COLLISION_STEP));
    for (let step = 0; step < stepCount; step += 1) {
      actor.position.x = moveAxis(actor, actor.position.x, actor.position.z, deltaX / stepCount, "x", layout);
      actor.position.z = moveAxis(actor, actor.position.z, actor.position.x, deltaZ / stepCount, "z", layout);
      const feetY = actor.position.y - EYE_HEIGHT;
      const support = getSupportHeight(
        actor.position.x,
        actor.position.z,
        feetY + MAX_STEP_UP,
        layout,
      );
      const supportDelta = support - feetY;
      if (
        actor.velocity.y <= 0 &&
        supportDelta >= -SURFACE_EPSILON &&
        supportDelta <= MAX_STEP_UP &&
        (wasSupported || supportDelta >= 0)
      ) {
        actor.position.y = support + EYE_HEIGHT;
        actor.velocity.y = 0;
      }
    }
  }

  private moveVertically(actor: ActorState, jump: boolean, deltaSeconds: number, layout: MapLayout): void {
    const feetY = actor.position.y - EYE_HEIGHT;
    const support = getSupportHeight(actor.position.x, actor.position.z, feetY + SURFACE_EPSILON, layout);
    const supportEyeY = support + EYE_HEIGHT;
    const onSurface = actor.velocity.y <= 0 && Math.abs(actor.position.y - supportEyeY) <= SURFACE_EPSILON;
    if (onSurface) {
      actor.position.y = supportEyeY;
      actor.velocity.y = jump ? JUMP_SPEED : 0;
    }

    if (actor.velocity.y === 0 && onSurface) {
      return;
    }

    const previousY = actor.position.y;
    actor.position.y += actor.velocity.y * deltaSeconds - 0.5 * GRAVITY * deltaSeconds * deltaSeconds;
    actor.velocity.y -= GRAVITY * deltaSeconds;
    const landingSupport = getSupportHeight(
      actor.position.x,
      actor.position.z,
      previousY - EYE_HEIGHT + SURFACE_EPSILON,
      layout,
    ) + EYE_HEIGHT;
    if (actor.velocity.y <= 0 && previousY >= landingSupport - SURFACE_EPSILON && actor.position.y <= landingSupport) {
      actor.position.y = landingSupport;
      actor.velocity.y = 0;
    }
  }
}

function moveAxis(
  actor: ActorState,
  current: number,
  otherAxis: number,
  delta: number,
  axis: "x" | "z",
  layout: MapLayout,
): number {
  if (delta === 0) {
    return current;
  }

  const limit = MAP_HALF_SIZE - ACTOR_RADIUS;
  const target = clamp(current + delta, -limit, limit);
  const targetX = axis === "x" ? target : otherAxis;
  const targetZ = axis === "z" ? target : otherAxis;
  if (!collides(targetX, targetZ, actor.position.y, layout)) {
    return target;
  }

  const currentX = axis === "x" ? current : otherAxis;
  const currentZ = axis === "z" ? current : otherAxis;
  if (collides(currentX, currentZ, actor.position.y, layout)) {
    resolveWallOverlap(actor, layout);
    const recoveredCurrent = axis === "x" ? actor.position.x : actor.position.z;
    const recoveredOther = axis === "x" ? actor.position.z : actor.position.x;
    if (collides(actor.position.x, actor.position.z, actor.position.y, layout)) return recoveredCurrent;
    return moveAxis(actor, recoveredCurrent, recoveredOther, delta, axis, layout);
  }

  let safe = current;
  let blocked = target;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const candidate = (safe + blocked) / 2;
    const x = axis === "x" ? candidate : otherAxis;
    const z = axis === "z" ? candidate : otherAxis;
    if (collides(x, z, actor.position.y, layout)) {
      blocked = candidate;
    } else {
      safe = candidate;
    }
  }
  return safe;
}

function collides(x: number, z: number, eyeY: number, layout: MapLayout): boolean {
  const feetY = eyeY - EYE_HEIGHT;
  const candidateSupport = getSupportHeight(x, z, feetY + MAX_STEP_UP, layout);
  const effectiveFeetY = Math.max(feetY, candidateSupport);
  for (const wall of getNearbyWalls(x, z, layout)) {
    if (collidesWithWall(x, z, effectiveFeetY, wall)) return true;
  }
  return false;
}

function collidesWithWall(
  x: number,
  z: number,
  feetY: number,
  wall: MapLayout["wallSegments"][number],
): boolean {
  const roofY = wall.center.y + wall.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
  if (feetY >= roofY - SURFACE_EPSILON) return false;
  const halfWidth = wall.width / 2;
  const halfDepth = wall.depth / 2;
  const closestX = clamp(x, wall.center.x - halfWidth, wall.center.x + halfWidth);
  const closestZ = clamp(z, wall.center.z - halfDepth, wall.center.z + halfDepth);
  const deltaX = x - closestX;
  const deltaZ = z - closestZ;
  return deltaX * deltaX + deltaZ * deltaZ < ACTOR_RADIUS * ACTOR_RADIUS;
}

function resolveWallOverlap(actor: ActorState, layout: MapLayout): void {
  const feetY = actor.position.y - EYE_HEIGHT;
  const limit = MAP_HALF_SIZE - ACTOR_RADIUS;
  const padding = ACTOR_RADIUS + 0.001;
  for (let iteration = 0; iteration < 8 && collides(actor.position.x, actor.position.z, actor.position.y, layout); iteration += 1) {
    const candidates = getNearbyWalls(actor.position.x, actor.position.z, layout)
      .filter((wall) => collidesWithWall(actor.position.x, actor.position.z, feetY, wall))
      .flatMap((wall) => {
        const minimumX = wall.center.x - wall.width / 2 - padding;
        const maximumX = wall.center.x + wall.width / 2 + padding;
        const minimumZ = wall.center.z - wall.depth / 2 - padding;
        const maximumZ = wall.center.z + wall.depth / 2 + padding;
        return [
          { x: minimumX, z: actor.position.z },
          { x: maximumX, z: actor.position.z },
          { x: actor.position.x, z: minimumZ },
          { x: actor.position.x, z: maximumZ },
          { x: minimumX, z: minimumZ },
          { x: minimumX, z: maximumZ },
          { x: maximumX, z: minimumZ },
          { x: maximumX, z: maximumZ },
        ];
      })
      .filter((candidate) => Math.abs(candidate.x) <= limit && Math.abs(candidate.z) <= limit)
      .sort((left, right) =>
        Math.hypot(left.x - actor.position.x, left.z - actor.position.z) -
        Math.hypot(right.x - actor.position.x, right.z - actor.position.z)
      );
    const safe = candidates.find((candidate) => !collides(candidate.x, candidate.z, actor.position.y, layout));
    const recovery = safe ?? candidates[0];
    if (!recovery) return;
    actor.position.x = recovery.x;
    actor.position.z = recovery.z;
  }
}

function getNearbyWalls(x: number, z: number, layout: MapLayout): readonly MapWallSegment[] {
  let index = wallCollisionIndexes.get(layout);
  if (!index) {
    index = new Map<string, MapWallSegment[]>();
    for (const wall of layout.wallSegments) {
      const minimumCellX = wallCell(wall.center.x - wall.width / 2 - ACTOR_RADIUS);
      const maximumCellX = wallCell(wall.center.x + wall.width / 2 + ACTOR_RADIUS);
      const minimumCellZ = wallCell(wall.center.z - wall.depth / 2 - ACTOR_RADIUS);
      const maximumCellZ = wallCell(wall.center.z + wall.depth / 2 + ACTOR_RADIUS);
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        for (let cellZ = minimumCellZ; cellZ <= maximumCellZ; cellZ += 1) {
          const key = `${cellX}:${cellZ}`;
          const walls = index.get(key);
          if (walls) walls.push(wall);
          else index.set(key, [wall]);
        }
      }
    }
    wallCollisionIndexes.set(layout, index);
  }
  return index.get(`${wallCell(x)}:${wallCell(z)}`) ?? [];
}

export function getWallCollisionCandidateCount(x: number, z: number, layout: MapLayout): number {
  return getNearbyWalls(x, z, layout).length;
}

function wallCell(value: number): number {
  return Math.floor((value + MAP_HALF_SIZE) / WALL_COLLISION_CELL_SIZE);
}

export function getSupportHeight(
  x: number,
  z: number,
  maximumY = Number.POSITIVE_INFINITY,
  layout: MapLayout = createMapLayout(0),
): number {
  let support = getTerrainHeight(x, z, layout);
  for (const ramp of layout.roofRamps) {
    const rampHeight = getRampHeight(ramp, x, z);
    if (rampHeight !== null && rampHeight <= maximumY + SURFACE_EPSILON) {
      support = Math.max(support, rampHeight);
    }
  }
  for (const obstacle of layout.obstacles) {
    const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
    if (
      roofY <= maximumY + SURFACE_EPSILON &&
      Math.abs(x - obstacle.center.x) <= obstacle.width / 2 &&
      Math.abs(z - obstacle.center.z) <= obstacle.depth / 2
    ) {
      support = Math.max(support, roofY);
    }
  }
  return support;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
