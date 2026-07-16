import { MAP_HALF_SIZE, MAP_SIZE } from "../../config/map";
import type { ActorState, MatchState, Vector3State } from "../../game/state/types";

export const MINIMAP_VIEW_SIZE = 200;

export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapCircle extends MinimapPoint {
  radius: number;
}

export interface MinimapView {
  player: MinimapPoint & { rotationDegrees: number };
  currentZone: MinimapCircle;
  targetZone: MinimapCircle;
  flight: { start: MinimapPoint; end: MinimapPoint };
  outsideZoneMeters: number;
}

export function createMinimapView(state: MatchState, player: ActorState): MinimapView {
  const playerPoint = projectToMinimap(player.position, true);
  const distanceFromZoneCenter = Math.hypot(
    player.position.x - state.safeZone.center.x,
    player.position.z - state.safeZone.center.z,
  );
  return {
    player: {
      ...playerPoint,
      rotationDegrees: player.yaw * 180 / Math.PI,
    },
    currentZone: projectCircle(state.safeZone.center, state.safeZone.radius),
    targetZone: projectCircle(state.safeZone.targetCenter, state.safeZone.targetRadius),
    flight: {
      start: projectToMinimap(state.flight.start),
      end: projectToMinimap(state.flight.end),
    },
    outsideZoneMeters: Math.max(0, distanceFromZoneCenter - state.safeZone.radius),
  };
}

export function projectToMinimap(position: Vector3State, clampToMap = false): MinimapPoint {
  const x = (position.x + MAP_HALF_SIZE) / MAP_SIZE * MINIMAP_VIEW_SIZE;
  const y = (MAP_HALF_SIZE - position.z) / MAP_SIZE * MINIMAP_VIEW_SIZE;
  if (!clampToMap) {
    return { x, y };
  }
  return {
    x: clamp(x, 5, MINIMAP_VIEW_SIZE - 5),
    y: clamp(y, 5, MINIMAP_VIEW_SIZE - 5),
  };
}

function projectCircle(center: Vector3State, radius: number): MinimapCircle {
  return {
    ...projectToMinimap(center),
    radius: Math.max(0, radius / MAP_SIZE * MINIMAP_VIEW_SIZE),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
