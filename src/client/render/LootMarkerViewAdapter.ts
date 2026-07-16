import type { EntityId, GroundLootState } from "../../game/state/types";

export interface LootMarkerViewAdapter<TMarker extends object> {
  create(loot: GroundLootState): TMarker;
  update(marker: TMarker, loot: GroundLootState): void;
}

export function syncLootMarkerViews<TMarker extends object>(
  markers: Map<EntityId, TMarker>,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  adapter: LootMarkerViewAdapter<TMarker>,
): void {
  for (const loot of Object.values(groundLoot)) {
    let marker = markers.get(loot.id);
    if (!marker) {
      marker = adapter.create(loot);
      markers.set(loot.id, marker);
    }
    adapter.update(marker, loot);
  }
}
