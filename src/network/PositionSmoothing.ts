import type { ActorState, Vector3State } from "../game/state/types";
import { SIMULATION_STEP_SECONDS } from "../game/simulationTiming";

const MIN_INTERPOLATION_SECONDS = 0.12;
const MAX_INTERPOLATION_SECONDS = 0.25;
const MAX_GROUNDED_TRANSITION_DISTANCE = 6;
const MAX_PARACHUTING_TRANSITION_DISTANCE = 18;
const PARACHUTING_DISTANCE_TOLERANCE = 0.35;

export interface PositionTransition {
  from: Vector3State;
  to: Vector3State;
  elapsedSeconds: number;
  durationSeconds: number;
}

export function createPositionTransition(
  from: Vector3State,
  to: Vector3State,
  durationSeconds: number,
): PositionTransition {
  return {
    from: { ...from },
    to: { ...to },
    elapsedSeconds: 0,
    durationSeconds: Math.max(0, durationSeconds),
  };
}

export function advancePositionTransition(transition: PositionTransition, deltaSeconds: number): void {
  transition.elapsedSeconds = Math.min(
    transition.durationSeconds,
    transition.elapsedSeconds + Math.max(0, deltaSeconds),
  );
}

export function samplePositionTransition(transition: PositionTransition): Vector3State {
  const amount = transition.durationSeconds <= 0
    ? 1
    : Math.min(1, transition.elapsedSeconds / transition.durationSeconds);
  return {
    x: transition.from.x + (transition.to.x - transition.from.x) * amount,
    y: transition.from.y + (transition.to.y - transition.from.y) * amount,
    z: transition.from.z + (transition.to.z - transition.from.z) * amount,
  };
}

export function positionTransitionComplete(transition: PositionTransition): boolean {
  return transition.elapsedSeconds >= transition.durationSeconds;
}

export function snapshotInterpolationSeconds(previousTick: number, nextTick: number): number {
  return Math.max(
    MIN_INTERPOLATION_SECONDS,
    Math.min(MAX_INTERPOLATION_SECONDS, snapshotElapsedSeconds(previousTick, nextTick)),
  );
}

export function snapshotElapsedSeconds(previousTick: number, nextTick: number): number {
  const tickDelta = previousTick >= 0 ? Math.max(1, nextTick - previousTick) : 3;
  return tickDelta * SIMULATION_STEP_SECONDS;
}

export function createCorrectionTransition(
  previousVisualPosition: Vector3State,
  correctedPosition: Vector3State,
  durationSeconds: number,
  maximumDistance: number,
): PositionTransition | null {
  const offset = {
    x: previousVisualPosition.x - correctedPosition.x,
    y: previousVisualPosition.y - correctedPosition.y,
    z: previousVisualPosition.z - correctedPosition.z,
  };
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  return distance > 0.0001 && distance <= maximumDistance
    ? createPositionTransition(offset, { x: 0, y: 0, z: 0 }, durationSeconds)
    : null;
}

export function createRemotePositionTransition(
  previousRenderedPosition: Vector3State,
  previousActor: ActorState | undefined,
  nextActor: ActorState,
  durationSeconds: number,
  snapshotSeconds: number,
  maximumParachutingSpeed: number,
  newlyVisible: boolean,
): PositionTransition {
  const maximumDistance = nextActor.deployment === "parachuting"
    ? Math.min(
      MAX_PARACHUTING_TRANSITION_DISTANCE,
      Math.max(0, snapshotSeconds) * maximumParachutingSpeed + PARACHUTING_DISTANCE_TOLERANCE,
    )
    : MAX_GROUNDED_TRANSITION_DISTANCE;
  const authoritativeDistance = previousActor
    ? Math.hypot(
      nextActor.position.x - previousActor.position.x,
      nextActor.position.y - previousActor.position.y,
      nextActor.position.z - previousActor.position.z,
    )
    : Number.POSITIVE_INFINITY;
  const snap = newlyVisible ||
    !previousActor ||
    previousActor.alive !== nextActor.alive ||
    previousActor.deployment !== nextActor.deployment ||
    authoritativeDistance > maximumDistance;
  return createPositionTransition(
    snap ? nextActor.position : previousRenderedPosition,
    nextActor.position,
    snap ? 0 : durationSeconds,
  );
}
