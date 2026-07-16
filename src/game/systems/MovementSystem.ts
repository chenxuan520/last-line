import { MAP_HALF_SIZE, MAP_OBSTACLES } from "../../config/map";
import type { ActorCommand } from "../commands/ActorCommand";
import type { ActorState, EntityId, MatchState, Vector3State } from "../state/types";

const WALK_SPEED = 5.8;
const SPRINT_SPEED = 8.5;
const GLIDE_SPEED = 7;
const PARACHUTE_DESCENT_SPEED = 5;
const JUMP_SPEED = 6.5;
const GRAVITY = 18;
const GROUND_HEIGHT = 1.76;
const ACTOR_RADIUS = 0.42;
const MAX_COLLISION_STEP = ACTOR_RADIUS / 2;

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

    const aimLength = Math.hypot(command.aimDirection.x, command.aimDirection.z);
    if (aimLength > 0) {
      actor.yaw = Math.atan2(command.aimDirection.x, command.aimDirection.z);
      actor.pitch = Math.atan2(-command.aimDirection.y, aimLength);
    }

    if (actor.deployment === "aircraft") {
      if (!command.jump) {
        return;
      }
      actor.deployment = "parachuting";
      actor.velocity = { x: 0, y: -PARACHUTE_DESCENT_SPEED, z: 0 };
    }

    if (actor.deployment === "parachuting") {
      this.moveHorizontally(actor, command.move, GLIDE_SPEED, deltaSeconds);
      actor.velocity.y = -PARACHUTE_DESCENT_SPEED;
      actor.position.y += actor.velocity.y * deltaSeconds;
      if (actor.position.y <= GROUND_HEIGHT) {
        actor.position.y = GROUND_HEIGHT;
        actor.velocity = { x: 0, y: 0, z: 0 };
        actor.deployment = "grounded";
      }
      return;
    }

    this.moveHorizontally(actor, command.move, command.sprint ? SPRINT_SPEED : WALK_SPEED, deltaSeconds);
    this.moveVertically(actor, command.jump, deltaSeconds);
  }

  private moveHorizontally(
    actor: ActorState,
    movement: Vector3State,
    speed: number,
    deltaSeconds: number,
  ): void {
    const inputLength = Math.hypot(movement.x, movement.z);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    actor.velocity.x = movement.x * inputScale * speed;
    actor.velocity.z = movement.z * inputScale * speed;

    const deltaX = actor.velocity.x * deltaSeconds;
    const deltaZ = actor.velocity.z * deltaSeconds;
    const stepCount = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / MAX_COLLISION_STEP));
    for (let step = 0; step < stepCount; step += 1) {
      actor.position.x = moveAxis(actor.position.x, actor.position.z, deltaX / stepCount, "x");
      actor.position.z = moveAxis(actor.position.z, actor.position.x, deltaZ / stepCount, "z");
    }
  }

  private moveVertically(actor: ActorState, jump: boolean, deltaSeconds: number): void {
    const onGround = actor.position.y <= GROUND_HEIGHT && actor.velocity.y <= 0;
    if (onGround) {
      actor.position.y = GROUND_HEIGHT;
      actor.velocity.y = jump ? JUMP_SPEED : 0;
    }

    if (actor.velocity.y === 0) {
      return;
    }

    actor.position.y += actor.velocity.y * deltaSeconds - 0.5 * GRAVITY * deltaSeconds * deltaSeconds;
    actor.velocity.y -= GRAVITY * deltaSeconds;
    if (actor.position.y <= GROUND_HEIGHT) {
      actor.position.y = GROUND_HEIGHT;
      actor.velocity.y = 0;
    }
  }
}

function moveAxis(current: number, otherAxis: number, delta: number, axis: "x" | "z"): number {
  if (delta === 0) {
    return current;
  }

  const limit = MAP_HALF_SIZE - ACTOR_RADIUS;
  const target = clamp(current + delta, -limit, limit);
  if (!collides(axis === "x" ? target : otherAxis, axis === "z" ? target : otherAxis)) {
    return target;
  }

  let safe = current;
  let blocked = target;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const candidate = (safe + blocked) / 2;
    const x = axis === "x" ? candidate : otherAxis;
    const z = axis === "z" ? candidate : otherAxis;
    if (collides(x, z)) {
      blocked = candidate;
    } else {
      safe = candidate;
    }
  }
  return safe;
}

function collides(x: number, z: number): boolean {
  for (const obstacle of MAP_OBSTACLES) {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
