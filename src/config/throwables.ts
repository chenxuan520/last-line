import type { Vector3State } from "../game/state/types";

export const FRAG_GRENADE_ITEM_ID = "grenade.frag";

export type GrenadeThrowMode = "high" | "low";

export interface FragGrenadeConfig {
  itemId: typeof FRAG_GRENADE_ITEM_ID;
  fuseSeconds: number;
  gravity: number;
  radius: number;
  maximumDamage: number;
  fullDamageRadius: number;
  collisionRadius: number;
  restitution: number;
  tangentialDamping: number;
  highThrowSpeed: number;
  highThrowLift: number;
  lowThrowSpeed: number;
  lowThrowLift: number;
}

export const FRAG_GRENADE_CONFIG: Readonly<FragGrenadeConfig> = {
  itemId: FRAG_GRENADE_ITEM_ID,
  fuseSeconds: 3.5,
  gravity: 18,
  radius: 8,
  maximumDamage: 120,
  fullDamageRadius: 1.5,
  collisionRadius: 0.18,
  restitution: 0.42,
  tangentialDamping: 0.72,
  highThrowSpeed: 23,
  highThrowLift: 7,
  lowThrowSpeed: 12,
  lowThrowLift: 1.8,
};

export function createGrenadeThrowVelocity(
  aimDirection: Vector3State,
  mode: GrenadeThrowMode,
  config: FragGrenadeConfig = FRAG_GRENADE_CONFIG,
): Vector3State {
  const length = Math.hypot(aimDirection.x, aimDirection.y, aimDirection.z);
  const direction = length > 0.0001
    ? {
        x: aimDirection.x / length,
        y: aimDirection.y / length,
        z: aimDirection.z / length,
      }
    : { x: 0, y: 0, z: 1 };
  const speed = mode === "low" ? config.lowThrowSpeed : config.highThrowSpeed;
  const lift = mode === "low" ? config.lowThrowLift : config.highThrowLift;
  return {
    x: direction.x * speed,
    y: direction.y * speed + lift,
    z: direction.z * speed,
  };
}
