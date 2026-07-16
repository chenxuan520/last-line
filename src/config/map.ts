import type { Vector3State } from "../game/state/types";

export interface MapObstacle {
  id: string;
  center: Vector3State;
  width: number;
  height: number;
  depth: number;
  color: string;
}

export interface MapPoint {
  name: string;
  position: Vector3State;
}

export const MAP_SIZE = 800;
export const MAP_HALF_SIZE = MAP_SIZE / 2;

export const MAP_POINTS: readonly MapPoint[] = [
  { name: "北港", position: { x: -210, y: 0, z: 205 } },
  { name: "灰脊镇", position: { x: 120, y: 0, z: 155 } },
  { name: "旧仓区", position: { x: -155, y: 0, z: -115 } },
  { name: "高地站", position: { x: 190, y: 0, z: -185 } },
];

export const MAP_OBSTACLES: readonly MapObstacle[] = MAP_POINTS.flatMap((point, pointIndex) =>
  Array.from({ length: pointIndex === 1 ? 8 : 6 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const width = 18 + ((index + pointIndex) % 3) * 7;
    const depth = 16 + ((index * 2 + pointIndex) % 3) * 8;
    return {
      id: `building-${pointIndex}-${index}`,
      center: {
        x: point.position.x + (column - 1) * 44 + (row % 2) * 8,
        y: 6 + ((index + pointIndex) % 2) * 2,
        z: point.position.z + (row - 0.5) * 48,
      },
      width,
      height: 12 + ((index + pointIndex) % 2) * 4,
      depth,
      color: pointIndex % 2 === 0 ? "#59645b" : "#726955",
    };
  }),
);

const LOOT_POINTS_PER_AREA = 18;
const LOOT_OBSTACLE_CLEARANCE = 0.5;

export const LOOT_SPAWN_POINTS: readonly Vector3State[] = MAP_POINTS.flatMap((point, pointIndex) => {
  const candidates = Array.from({ length: LOOT_POINTS_PER_AREA * 2 }, (_, index) => {
    const angle = (index / LOOT_POINTS_PER_AREA) * Math.PI * 2 + pointIndex;
    const radius = 22 + (index % 4) * 15;
    return {
      x: point.position.x + Math.cos(angle) * radius,
      y: 0.45,
      z: point.position.z + Math.sin(angle) * radius,
    };
  });
  const clearCandidates = candidates.filter((candidate) =>
    MAP_OBSTACLES.every((obstacle) => !pointInsideObstacle(candidate, obstacle, LOOT_OBSTACLE_CLEARANCE)),
  );
  if (clearCandidates.length < LOOT_POINTS_PER_AREA) {
    throw new Error(`Not enough clear loot spawn points around ${point.name}`);
  }
  return clearCandidates.slice(0, LOOT_POINTS_PER_AREA);
});

export const BOT_SPAWN_POINTS: readonly Vector3State[] = Array.from({ length: 19 }, (_, index) => {
  const angle = (index / 19) * Math.PI * 2;
  const radius = 190 + (index % 4) * 35;
  return { x: Math.cos(angle) * radius, y: 1.76, z: Math.sin(angle) * radius };
});

function pointInsideObstacle(point: Vector3State, obstacle: MapObstacle, clearance: number): boolean {
  return (
    point.x >= obstacle.center.x - obstacle.width / 2 - clearance &&
    point.x <= obstacle.center.x + obstacle.width / 2 + clearance &&
    point.z >= obstacle.center.z - obstacle.depth / 2 - clearance &&
    point.z <= obstacle.center.z + obstacle.depth / 2 + clearance
  );
}
