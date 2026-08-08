import { ITEMS } from "../config/items";

export function getItemIconAssetId(itemId: string): string {
  const item = ITEMS[itemId];
  if (!item) return "fallback.ui";
  if (item.kind === "throwable") return "ui.item.grenade";
  return item.kind === "weapon" && item.weaponId
    ? `ui.weapon.${item.weaponId}`
    : `ui.item.${item.id}`;
}
