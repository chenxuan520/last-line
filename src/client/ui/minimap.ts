import { MAP_HALF_SIZE, MAP_SIZE } from "../../config/map";
import type { ActorState, MatchState, Vector3State } from "../../game/state/types";

export const MINIMAP_VIEW_SIZE = 200;

export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapLabelOffset {
  x: number;
  y: number;
}

export interface MinimapLabelMarker {
  name: string;
  point: MinimapPoint;
}

export interface MinimapLabelPlacement extends MinimapLabelMarker {
  offset: MinimapLabelOffset;
}

export interface MinimapRectangle {
  left: number;
  right: number;
  top: number;
  bottom: number;
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

const DEFAULT_LABEL_OFFSET: MinimapLabelOffset = { x: 0, y: -10 };
const LABEL_HEIGHT = 9;
const LABEL_ASCENT = 7;
const MARKER_RADIUS = 6;
const LABEL_EDGE_MINIMUM = 10;
const LABEL_EDGE_MAXIMUM = MINIMAP_VIEW_SIZE - 10;

export function chooseMinimapLabelOffset(
  name: string,
  point: MinimapPoint,
  labelBlockers: readonly MinimapRectangle[],
  markerBlockers: readonly MinimapRectangle[],
): MinimapLabelOffset {
  for (const candidate of minimapLabelOffsetCandidates(name)) {
    const bounds = minimapLabelBounds(name, point, candidate);
    if (!rectangleInsideMinimap(bounds)) continue;
    if (
      labelBlockers.every((blocker) => !rectanglesOverlap(bounds, blocker)) &&
      markerBlockers.every((blocker) => !rectanglesOverlap(bounds, blocker))
    ) {
      return candidate;
    }
  }
  return DEFAULT_LABEL_OFFSET;
}

export function layoutMinimapLabels(
  markers: readonly MinimapLabelMarker[],
): MinimapLabelPlacement[] {
  const markerBlockers = markers.map((marker) => minimapMarkerBounds(marker.point));
  const labelBlockers: MinimapRectangle[] = [];
  return markers.map((marker) => {
    const offset = chooseMinimapLabelOffset(
      marker.name,
      marker.point,
      labelBlockers,
      markerBlockers,
    );
    labelBlockers.push(minimapLabelBounds(marker.name, marker.point, offset));
    return { ...marker, offset };
  });
}

export function minimapLabelBounds(
  name: string,
  point: MinimapPoint,
  offset: MinimapLabelOffset = DEFAULT_LABEL_OFFSET,
): MinimapRectangle {
  const width = minimapLabelWidth(name);
  const centerX = point.x + offset.x;
  const baselineY = point.y + offset.y;
  return {
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: baselineY - LABEL_ASCENT,
    bottom: baselineY - LABEL_ASCENT + LABEL_HEIGHT,
  };
}

export function minimapMarkerBounds(point: MinimapPoint): MinimapRectangle {
  return {
    left: point.x - MARKER_RADIUS,
    right: point.x + MARKER_RADIUS,
    top: point.y - MARKER_RADIUS,
    bottom: point.y + MARKER_RADIUS,
  };
}

export function rectanglesOverlap(left: MinimapRectangle, right: MinimapRectangle): boolean {
  return left.right > right.left &&
    right.right > left.left &&
    left.bottom > right.top &&
    right.bottom > left.top;
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

function minimapLabelWidth(name: string): number {
  return name.length * 7 + 2;
}

function minimapLabelOffsetCandidates(name: string): MinimapLabelOffset[] {
  const horizontalOffset = minimapLabelWidth(name) / 2 + MARKER_RADIUS + 3;
  const preferred: MinimapLabelOffset[] = [
    DEFAULT_LABEL_OFFSET,
    { x: 0, y: 18 },
    { x: horizontalOffset, y: 2 },
    { x: -horizontalOffset, y: 2 },
    { x: horizontalOffset, y: -10 },
    { x: -horizontalOffset, y: -10 },
    { x: 0, y: -18 },
  ];
  for (let radius = 24; radius <= 64; radius += 8) {
    preferred.push(
      { x: radius, y: 12 },
      { x: -radius, y: 12 },
      { x: radius, y: -12 },
      { x: -radius, y: -12 },
      { x: 0, y: radius },
      { x: 0, y: -radius },
      { x: radius, y: 2 },
      { x: -radius, y: 2 },
    );
  }
  return preferred;
}

function rectangleInsideMinimap(rectangle: MinimapRectangle): boolean {
  return rectangle.left >= LABEL_EDGE_MINIMUM &&
    rectangle.right <= LABEL_EDGE_MAXIMUM &&
    rectangle.top >= LABEL_EDGE_MINIMUM &&
    rectangle.bottom <= LABEL_EDGE_MAXIMUM;
}
