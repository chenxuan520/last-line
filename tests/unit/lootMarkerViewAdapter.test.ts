import { describe, expect, it, vi } from "vitest";
import {
  syncLootMarkerViews,
  type LootMarkerViewAdapter,
} from "../../src/client/render/LootMarkerViewAdapter";
import type { GroundLootState } from "../../src/game/state/types";

interface Marker {
  itemId: string;
  x: number;
  enabled: boolean;
}

function createLoot(id: string, itemId: string, x: number): GroundLootState {
  return {
    id,
    itemId,
    quantity: 1,
    position: { x, y: 0, z: 0 },
    available: true,
  };
}

describe("syncLootMarkerViews", () => {
  it("creates only missing markers and updates existing visibility", () => {
    const markers = new Map<string, Marker>();
    const groundLoot: Record<string, GroundLootState> = {
      first: createLoot("first", "weapon.rifle", 1),
    };
    const create = vi.fn((loot: GroundLootState): Marker => ({
      itemId: loot.itemId,
      x: loot.position.x,
      enabled: loot.available,
    }));
    const adapter: LootMarkerViewAdapter<Marker> = {
      create,
      update(marker, loot) {
        marker.itemId = loot.itemId;
        marker.x = loot.position.x;
        marker.enabled = loot.available;
      },
    };

    syncLootMarkerViews(markers, groundLoot, adapter);
    const firstMarker = markers.get("first");

    groundLoot.first.available = false;
    groundLoot.first.position.x = 4;
    groundLoot.second = createLoot("second", "bandage", 8);
    syncLootMarkerViews(markers, groundLoot, adapter);
    syncLootMarkerViews(markers, groundLoot, adapter);

    expect(create).toHaveBeenCalledTimes(2);
    expect(markers.size).toBe(2);
    expect(markers.get("first")).toBe(firstMarker);
    expect(firstMarker).toEqual({ itemId: "weapon.rifle", x: 4, enabled: false });
    expect(markers.get("second")).toEqual({ itemId: "bandage", x: 8, enabled: true });
  });
});
