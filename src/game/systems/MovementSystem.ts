import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  MAP_HALF_SIZE,
  type MapLayout,
} from "../../config/map";
import type { ActorCommand } from "../commands/ActorCommand";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";

const WALK_SPEED = 5.8;
const SPRINT_SPEED = 8.5;
const GLIDE_SPEED = 10;
const PARACHUTE_DESCENT_SPEED = 5;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const EYE_HEIGHT = 1.76;
const ACTOR_RADIUS = 0.42;
const MAX_COLLISION_STEP = ACTOR_RADIUS / 2;
const MAX_STEP_UP = 0.35;
const SURFACE_EPSILON = 0.08;

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
      this.moveHorizontally(actor, command.move, GLIDE_SPEED, deltaSeconds, layout);
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
  if (!collides(axis === "x" ? target : otherAxis, axis === "z" ? target : otherAxis, actor.position.y, layout)) {
    return target;
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
  for (const obstacle of layout.obstacles) {
    const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
    if (effectiveFeetY >= roofY - SURFACE_EPSILON) continue;
    const halfWidth = obstacle.width / 2;
    const halfDepth = obstacle.depth / 2;
    const closestX = clamp(x, obstacle.center.x - halfWidth, obstacle.center.x + halfWidth);
    const closestZ = clamp(z, obstacle.center.z - halfDepth, obstacle.center.z + halfDepth);
    const deltaX = x - closestX;
    const deltaZ = z - closestZ;
    if (deltaX * deltaX + deltaZ * deltaZ < ACTOR_RADIUS * ACTOR_RADIUS) {
      return true;
    }
  }
  return false;
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
