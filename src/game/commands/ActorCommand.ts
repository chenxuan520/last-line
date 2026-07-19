import type { EntityId, Vector3State, WeaponSlot } from "../state/types";

export interface ActorCommand {
  move: Vector3State;
  aimDirection: Vector3State;
  fire: boolean;
  reload: boolean;
  sprint: boolean;
  jump: boolean;
  interact: boolean;
  interactLootId: EntityId | null;
  interactLootGeneration: number | null;
  switchWeapon: WeaponSlot | null;
  useItem: string | null;
  dropItem: string | null;
}

export function createIdleCommand(): ActorCommand {
  return {
    move: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: 1 },
    fire: false,
    reload: false,
    sprint: false,
    jump: false,
    interact: false,
    interactLootId: null,
    interactLootGeneration: null,
    switchWeapon: null,
    useItem: null,
    dropItem: null,
  };
}
