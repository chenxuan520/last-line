import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import type { AssetEntry } from "../../src/assets/types";
import productionManifest from "../../public/assets/asset-manifest.json";

export function createAssets(): AssetCatalog {
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


export function createProductionGlbAssets(): AssetCatalog {
  const modelEntries = productionManifest.assets.filter((entry) => entry.type === "model") as AssetEntry[];
  const proceduralWeaponEntries = productionManifest.assets.filter((entry) =>
    entry.type === "procedural-model" && entry.id.startsWith("model.weapon.")
  ) as AssetEntry[];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    const entry = modelEntries.find((candidate) => candidate.url === url);
    if (!entry?.url) return new Response(null, { status: 404 });
    const payload = await readFile(resolve(process.cwd(), "public", entry.url.replace(/^\.\//, "")));
    return new Response(new Uint8Array(payload), { headers: { "content-type": "model/gltf-binary" } });
  }));
  return new AssetCatalog({
    version: 1,
    assets: [
      { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
      { id: "fallback.model", type: "procedural-model", metadata: { color: "#cf4b3f" } },
      { id: "ui.crosshair", type: "svg", url: "/crosshair.svg", fallback: "fallback.ui" },
      { id: "ui.weapon.rifle", type: "svg", url: "/rifle.svg", fallback: "fallback.ui" },
      { id: "ui.item.ammo-depot", type: "image", url: "/ammo-depot.webp", fallback: "fallback.ui" },
      {
        id: "texture.industrial.metal",
        type: "image",
        url: "/industrial-metal.webp",
        fallback: "fallback.ui",
      },
      ...[
        "texture.terrain.grass",
        "texture.terrain.mud",
        "texture.road",
        "texture.building.roof",
        "texture.building.wall",
        "texture.sky.clearing",
        "texture.sky.overcast",
        "texture.sky.storm",
        "decal.brand.drop-zone",
        "decal.brand.island-operations",
        "decal.brand.property-ll01",
        "decal.brand.restricted-area",
        "decal.brand.supply",
      ].map((id) => ({ id, type: "svg" as const, url: `/${id}.svg`, fallback: "fallback.ui" })),
      ...modelEntries,
      ...proceduralWeaponEntries,
    ],
  });
}

