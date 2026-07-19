import { describe, expect, it } from "vitest";
import { getItemIconAssetId } from "../../src/client/itemIcon";

describe("item icon asset mapping", () => {
  it.each([
    ["weapon.rifle", "ui.weapon.rifle"],
    ["weapon.smg", "ui.weapon.smg"],
    ["weapon.shotgun", "ui.weapon.shotgun"],
    ["weapon.sniper", "ui.weapon.sniper"],
    ["ammo.rifle", "ui.item.ammo.rifle"],
    ["ammo.light", "ui.item.ammo.light"],
    ["ammo.shell", "ui.item.ammo.shell"],
    ["ammo.sniper", "ui.item.ammo.sniper"],
    ["armor.1", "ui.item.armor.1"],
    ["armor.2", "ui.item.armor.2"],
    ["helmet.1", "ui.item.helmet.1"],
    ["helmet.2", "ui.item.helmet.2"],
    ["bandage", "ui.item.bandage"],
    ["medkit", "ui.item.medkit"],
  ])("maps %s to %s", (itemId, assetId) => {
    expect(getItemIconAssetId(itemId)).toBe(assetId);
  });

  it("uses the UI fallback for unknown items", () => {
    expect(getItemIconAssetId("unknown")).toBe("fallback.ui");
  });
});
