export type ItemKind = "weapon" | "ammo" | "medical" | "armor" | "helmet";

export interface ItemConfig {
  id: string;
  label: string;
  kind: ItemKind;
  maxStack: number;
  weaponId?: string;
  healAmount?: number;
  useSeconds?: number;
  level?: 1 | 2;
}

export const ITEMS: Readonly<Record<string, ItemConfig>> = {
  "weapon.rifle": { id: "weapon.rifle", label: "R-7 步枪", kind: "weapon", maxStack: 1, weaponId: "rifle" },
  "weapon.smg": { id: "weapon.smg", label: "V-9 冲锋枪", kind: "weapon", maxStack: 1, weaponId: "smg" },
  "weapon.shotgun": { id: "weapon.shotgun", label: "K-12 霰弹枪", kind: "weapon", maxStack: 1, weaponId: "shotgun" },
  "weapon.sniper": { id: "weapon.sniper", label: "M-24 狙击枪", kind: "weapon", maxStack: 1, weaponId: "sniper" },
  "ammo.rifle": { id: "ammo.rifle", label: "步枪弹", kind: "ammo", maxStack: 120 },
  "ammo.light": { id: "ammo.light", label: "轻型弹", kind: "ammo", maxStack: 150 },
  "ammo.shell": { id: "ammo.shell", label: "霰弹", kind: "ammo", maxStack: 30 },
  "ammo.sniper": { id: "ammo.sniper", label: "狙击弹", kind: "ammo", maxStack: 40 },
  bandage: { id: "bandage", label: "绷带", kind: "medical", maxStack: 5, healAmount: 18, useSeconds: 2.5 },
  medkit: { id: "medkit", label: "急救包", kind: "medical", maxStack: 2, healAmount: 65, useSeconds: 5 },
  "armor.1": { id: "armor.1", label: "一级护甲", kind: "armor", maxStack: 1, level: 1 },
  "armor.2": { id: "armor.2", label: "二级护甲", kind: "armor", maxStack: 1, level: 2 },
  "helmet.1": { id: "helmet.1", label: "一级头盔", kind: "helmet", maxStack: 1, level: 1 },
  "helmet.2": { id: "helmet.2", label: "二级头盔", kind: "helmet", maxStack: 1, level: 2 },
};
