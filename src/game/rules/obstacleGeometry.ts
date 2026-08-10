import type { Vector3State } from "../state/types";

export interface OrientedObstacle {
  readonly center: Vector3State;
  readonly width: number;
  readonly depth: number;
  readonly rotationY?: number;
  readonly footprint?: ObstacleFootprint;
}

export type ObstacleFootprint = "rectangle" | "hexagon" | "round";

export interface Point2D {
  readonly x: number;
  readonly z: number;
}

export function obstacleLocalPoint(obstacle: OrientedObstacle, x: number, z: number): Point2D {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const offsetX = x - obstacle.center.x;
  const offsetZ = z - obstacle.center.z;
  return {
    x: offsetX * cosine - offsetZ * sine,
    z: offsetX * sine + offsetZ * cosine,
  };
}

export function obstacleWorldPoint(obstacle: OrientedObstacle, x: number, z: number): Point2D {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: obstacle.center.x + x * cosine + z * sine,
    z: obstacle.center.z - x * sine + z * cosine,
  };
}

export function obstacleLocalDirection(obstacle: OrientedObstacle, x: number, z: number): Point2D {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: x * cosine - z * sine,
    z: x * sine + z * cosine,
  };
}

export function obstacleWorldDirection(obstacle: OrientedObstacle, x: number, z: number): Point2D {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: x * cosine + z * sine,
    z: -x * sine + z * cosine,
  };
}

export function closestPointOnObstacle2D(
  obstacle: OrientedObstacle,
  x: number,
  z: number,
  padding = 0,
): Point2D {
  const local = obstacleLocalPoint(obstacle, x, z);
  const halfWidth = obstacle.width / 2 + padding;
  const halfDepth = obstacle.depth / 2 + padding;
  return obstacleWorldPoint(
    obstacle,
    Math.max(-halfWidth, Math.min(halfWidth, local.x)),
    Math.max(-halfDepth, Math.min(halfDepth, local.z)),
  );
}

export function pointInsideObstacle2D(
  obstacle: OrientedObstacle,
  x: number,
  z: number,
  padding = 0,
): boolean {
  const local = obstacleLocalPoint(obstacle, x, z);
  if (obstacle.footprint && obstacle.footprint !== "rectangle") {
    return pointInsidePolygon2D(
      local.x,
      local.z,
      obstacleFootprintVertices(obstacle.footprint, obstacle.width + padding * 2, obstacle.depth + padding * 2),
    );
  }
  return (
    Math.abs(local.x) <= obstacle.width / 2 + padding &&
    Math.abs(local.z) <= obstacle.depth / 2 + padding
  );
}

export function obstacleFootprintVertices(
  footprint: ObstacleFootprint,
  width: number,
  depth: number,
): readonly Point2D[] {
  if (footprint === "rectangle") {
    return [
      { x: -width / 2, z: -depth / 2 },
      { x: width / 2, z: -depth / 2 },
      { x: width / 2, z: depth / 2 },
      { x: -width / 2, z: depth / 2 },
    ];
  }
  const count = footprint === "hexagon" ? 6 : 10;
  const startAngle = -Math.PI / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + index / count * Math.PI * 2;
    return {
      x: Math.cos(angle) * width / 2,
      z: Math.sin(angle) * depth / 2,
    };
  });
}

export function pointInsidePolygon2D(x: number, z: number, vertices: readonly Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const currentVertex = vertices[index];
    const previousVertex = vertices[previous];
    if (!currentVertex || !previousVertex) continue;
    const edgeX = currentVertex.x - previousVertex.x;
    const edgeZ = currentVertex.z - previousVertex.z;
    const pointX = x - previousVertex.x;
    const pointZ = z - previousVertex.z;
    const cross = edgeX * pointZ - edgeZ * pointX;
    const dot = pointX * edgeX + pointZ * edgeZ;
    const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
    if (lengthSquared <= 1e-12) continue;
    if (Math.abs(cross) <= 1e-7 && dot >= -1e-7 && dot <= lengthSquared + 1e-7) return true;
    const intersects =
      (currentVertex.z > z) !== (previousVertex.z > z) &&
      x < (previousVertex.x - currentVertex.x) * (z - currentVertex.z) /
        (previousVertex.z - currentVertex.z) + currentVertex.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function obstacleBounds2D(
  obstacle: OrientedObstacle,
  padding = 0,
): { minimumX: number; maximumX: number; minimumZ: number; maximumZ: number } {
  const yaw = obstacle.rotationY ?? 0;
  const cosine = Math.abs(Math.cos(yaw));
  const sine = Math.abs(Math.sin(yaw));
  const halfWidth = obstacle.width / 2 + padding;
  const halfDepth = obstacle.depth / 2 + padding;
  const extentX = cosine * halfWidth + sine * halfDepth;
  const extentZ = sine * halfWidth + cosine * halfDepth;
  return {
    minimumX: obstacle.center.x - extentX,
    maximumX: obstacle.center.x + extentX,
    minimumZ: obstacle.center.z - extentZ,
    maximumZ: obstacle.center.z + extentZ,
  };
}

export function obstacleRecoveryPoints(
  obstacle: OrientedObstacle,
  x: number,
  z: number,
  padding: number,
): Point2D[] {
  const local = obstacleLocalPoint(obstacle, x, z);
  const halfWidth = obstacle.width / 2 + padding;
  const halfDepth = obstacle.depth / 2 + padding;
  return [
    obstacleWorldPoint(obstacle, -halfWidth, local.z),
    obstacleWorldPoint(obstacle, halfWidth, local.z),
    obstacleWorldPoint(obstacle, local.x, -halfDepth),
    obstacleWorldPoint(obstacle, local.x, halfDepth),
    obstacleWorldPoint(obstacle, -halfWidth, -halfDepth),
    obstacleWorldPoint(obstacle, -halfWidth, halfDepth),
    obstacleWorldPoint(obstacle, halfWidth, -halfDepth),
    obstacleWorldPoint(obstacle, halfWidth, halfDepth),
  ];
}

export function segmentObstacleEntryProgress2D(
  obstacle: OrientedObstacle,
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number,
  padding = 0,
): number | null {
  const start = obstacleLocalPoint(obstacle, startX, startZ);
  const target = obstacleLocalPoint(obstacle, targetX, targetZ);
  const footprint = obstacle.footprint ?? "rectangle";
  if (pointInsideObstacle2D(obstacle, startX, startZ, padding)) return 0;
  const vertices = obstacleFootprintVertices(
    footprint,
    obstacle.width + padding * 2,
    obstacle.depth + padding * 2,
  );
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index];
    const second = vertices[(index + 1) % vertices.length];
    if (!first || !second) continue;
    const progress = segmentIntersectionProgress(start, target, first, second);
    if (progress !== null && progress > 1e-6) nearest = Math.min(nearest, progress);
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function segmentIntersectionProgress(
  start: Point2D,
  target: Point2D,
  first: Point2D,
  second: Point2D,
): number | null {
  const segmentX = target.x - start.x;
  const segmentZ = target.z - start.z;
  const edgeX = second.x - first.x;
  const edgeZ = second.z - first.z;
  const denominator = segmentX * edgeZ - segmentZ * edgeX;
  if (Math.abs(denominator) < 1e-9) return null;
  const offsetX = first.x - start.x;
  const offsetZ = first.z - start.z;
  const progress = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
  const edgeProgress = (offsetX * segmentZ - offsetZ * segmentX) / denominator;
  return progress >= 0 && progress <= 1 && edgeProgress >= 0 && edgeProgress <= 1
    ? progress
    : null;
}
