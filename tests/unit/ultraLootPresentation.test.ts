import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { createIslandScene } from "../../src/client/render/scenes/IslandScene";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

// 完整地图回归单独隔离，避免在原重型场景文件的进程内再累计一张整图。
describe("ultra ground loot presentation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps ultra ground loot readable and reuses its fill after death and record recycling", async () => {
    const engine = new NullEngine();
    const state = createBattleRoyaleState("player", undefined, () => 7 / 0x100000000);
    const before = JSON.stringify(state);
    const bundle = await createIslandScene(engine, createAssets(), state.actors, state.groundLoot, 7, true, "player", "ultra");
    expect(JSON.stringify(state)).toBe(before);
    const materials = new Set<PBRMaterial>();
    for (const marker of bundle.lootMeshes.values()) {
      const material = marker.material as PBRMaterial;
      expect(material).toBeInstanceOf(PBRMaterial);
      expect(material.emissiveColor.r).toBeGreaterThan(0.1);
      expect(material.unlit).toBe(false);
      expect(marker.getVerticesData("color")).not.toBeNull();
      materials.add(material);
    }
    expect(materials.size).toBe(15);
    const wall = bundle.scene.materials.find((material) => material.name === "building-floor-material") as PBRMaterial;
    expect(wall.emissiveColor.asArray()).toEqual([0, 0, 0]);
    const rifle = Object.values(state.groundLoot).find((loot) => loot.itemId === "weapon.rifle")!;
    const marker = bundle.lootMeshes.get(rifle.id)!;
    const original = { material: marker.material, geometry: marker.geometry, position: marker.position.asArray(), colors: marker.getVerticesData("color")!.slice() };
    const resources = { meshes: bundle.scene.meshes.length, geometries: bundle.scene.geometries.length, textures: bundle.scene.textures.length };
    rifle.source = "death";
    bundle.syncLootMeshes(state.groundLoot);
    const deathMaterial = marker.material as PBRMaterial;
    expect(deathMaterial.emissiveColor.r).toBeGreaterThan(0.1);
    expect(deathMaterial.emissiveColor.r).toBeGreaterThan(deathMaterial.emissiveColor.g);
    const materialCount = bundle.scene.materials.length;
    for (let i = 0; i < 5; i += 1) {
      rifle.available = false;
      bundle.syncLootMeshes(state.groundLoot);
      expect(marker.isEnabled()).toBe(false);
      rifle.available = true;
      rifle.generation = (rifle.generation ?? 0) + 1;
      rifle.source = "spawn";
      bundle.syncLootMeshes(state.groundLoot);
      expect(marker.material).toBe(original.material);
      rifle.source = "death";
      bundle.syncLootMeshes(state.groundLoot);
      expect(marker.material).toBe(deathMaterial);
    }
    expect(marker.geometry).toBe(original.geometry);
    expect(marker.position.asArray()).toEqual(original.position);
    expect(marker.getVerticesData("color")).toEqual(original.colors);
    expect(bundle.scene.materials.length).toBe(materialCount);
    expect({ meshes: bundle.scene.meshes.length, geometries: bundle.scene.geometries.length, textures: bundle.scene.textures.length }).toEqual(resources);
    // 只有验收中的物资记录切换，构建与材质适配不得写入权威状态。
    const restored = JSON.parse(before);
    restored.groundLoot[rifle.id] = rifle;
    expect(JSON.stringify(state)).toBe(JSON.stringify(restored));
    bundle.scene.dispose();
    expect(bundle.lootMeshes.size).toBe(0);
    engine.dispose();
  }, 60_000);
});

function createAssets(): AssetCatalog {
  const iconAssetIds = [
    "ui.weapon.rifle",
    "ui.weapon.smg",
    "ui.weapon.shotgun",
    "ui.weapon.sniper",
    "ui.item.ammo.rifle",
    "ui.item.ammo.light",
    "ui.item.ammo.shell",
    "ui.item.ammo.sniper",
    "ui.item.armor.1",
    "ui.item.armor.2",
    "ui.item.helmet.1",
    "ui.item.helmet.2",
    "ui.item.bandage",
    "ui.item.medkit",
  ];
  const textureAssetIds = [
    "ui.item.ammo-depot",
    "decal.poi.ammo-depot",
    "texture.terrain.grass",
    "texture.terrain.mud",
    "texture.road",
    "texture.building.roof",
    "texture.building.wall",
    "texture.industrial.metal",
    "texture.terrain.concrete-urban",
    "texture.terrain.dry-soil",
    "texture.terrain.forest-humus",
    "texture.terrain.forest-moss-wet",
    "texture.terrain.gravel",
    "texture.terrain.mud-sparse-grass",
    "texture.road.asphalt-damaged",
    "texture.building.brick-masonry",
    "texture.building.concrete-wall-aged",
    "texture.building.flat-roof-membrane",
    "texture.building.roof-tile-gray",
    "texture.building.roof-tile-red-brown",
    "texture.building.wall-plaster-aged",
    "texture.industrial.metal-roof-rusted",
    "texture.sky.clearing",
    "texture.sky.overcast",
    "texture.sky.storm",
    "decal.brand.drop-zone",
    "decal.brand.island-operations",
    "decal.brand.property-ll01",
    "decal.brand.restricted-area",
    "decal.brand.supply",
  ];
  const catalog = new AssetCatalog({
    version: 1,
    assets: [
      { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
      { id: "fallback.model", type: "procedural-model", metadata: { color: "#cf4b3f" } },
      { id: "ui.crosshair", type: "svg", url: "/crosshair.svg", fallback: "fallback.ui" },
      ...iconAssetIds.map((id) => ({ id, type: "svg" as const, url: `/${id}.svg`, fallback: "fallback.ui" })),
      ...textureAssetIds.map((id) => ({ id, type: "image" as const, url: `/${id}.webp`, fallback: "fallback.ui" })),
      { id: "model.character.player", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#809d5e" } },
      { id: "model.character.enemy", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#bd6357" } },
      { id: "model.weapon.rifle", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#283126" } },
      { id: "model.weapon.smg", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#263838" } },
      { id: "model.weapon.shotgun", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#3b3028" } },
      { id: "model.weapon.sniper", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#354238" } },
    ],
  });
  const imagePayload = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
  vi.spyOn(catalog, "getPayload").mockImplementation((id) =>
    textureAssetIds.includes(id) ? imagePayload : undefined
  );
  return catalog;
}
