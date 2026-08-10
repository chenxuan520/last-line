import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { afterEach, describe, expect, it, vi } from "vitest";
import productionManifest from "../../public/assets/asset-manifest.json";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import type { AssetEntry } from "../../src/assets/types";
import {
  createIslandScene,
  selectTerrainTextureAssetId,
  terrainTextureTint,
} from "../../src/client/render/scenes/IslandScene";
import {
  AMMUNITION_DEPOT_WALL_COLOR,
  createMapLayout,
  HOSPITAL_WALL_COLOR,
  type MapLayout,
} from "../../src/config/map";
import { createMixedRegionSpecs } from "../../src/config/mixedMap";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

const GENERATED_MAP_TEXTURE_ASSET_IDS = [
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
] as const;

function createAssets(withImagePayloads = true): AssetCatalog {
  const catalog = new AssetCatalog({
    version: productionManifest.version,
    assets: productionManifest.assets as AssetEntry[],
  });
  const imageAssetIds = new Set(
    productionManifest.assets
      .filter((entry) => entry.type === "image")
      .map((entry) => entry.id),
  );
  const imagePayload = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer;
  vi.spyOn(catalog, "getPayload").mockImplementation((id) =>
    withImagePayloads && imageAssetIds.has(id) ? imagePayload : undefined
  );
  return catalog;
}

function expectedRenderedBuildingWallCount(layout: MapLayout): number {
  const doorSillIds = new Set(
    layout.wallOpenings
      .filter((opening) => opening.kind === "door")
      .flatMap((opening) => opening.sillWallId ? [opening.sillWallId] : []),
  );
  return layout.wallSegments.filter((wall) => !doorSillIds.has(wall.id)).length;
}

function renderedBuildingWallCount(bundle: Awaited<ReturnType<typeof createIslandScene>>): number {
  return bundle.scene.meshes
    .filter((mesh) => mesh.name.startsWith("building-walls-"))
    .reduce((total, mesh) => total + Number(mesh.metadata?.sourceCount ?? 0), 0);
}

describe("generated map texture integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      mapId: "island" as const,
      groundTextures: [
        "texture.terrain.gravel",
        "texture.terrain.dry-soil",
        "texture.road.asphalt-damaged",
      ],
      wallTextures: [
        "texture.building.wall-plaster-aged",
        "texture.building.brick-masonry",
        "texture.building.concrete-wall-aged",
      ],
      roofTextures: [
        "texture.building.flat-roof-membrane",
        "texture.building.roof-tile-gray",
        "texture.building.roof-tile-red-brown",
      ],
    },
    {
      mapId: "town" as const,
      groundTextures: [
        "texture.terrain.concrete-urban",
        "texture.road.asphalt-damaged",
      ],
      wallTextures: [
        "texture.building.concrete-wall-aged",
        "texture.building.brick-masonry",
      ],
      roofTextures: [
        "texture.building.flat-roof-membrane",
        "texture.industrial.metal-roof-rusted",
      ],
    },
    {
      mapId: "mixed" as const,
      groundTextures: [
        "texture.terrain.concrete-urban",
        "texture.terrain.dry-soil",
        "texture.terrain.forest-humus",
        "texture.terrain.forest-moss-wet",
        "texture.terrain.gravel",
        "texture.terrain.mud-sparse-grass",
        "texture.road.asphalt-damaged",
      ],
      wallTextures: [
        "texture.building.concrete-wall-aged",
        "texture.building.brick-masonry",
        "texture.building.wall-plaster-aged",
      ],
      roofTextures: [
        "texture.building.flat-roof-membrane",
        "texture.industrial.metal-roof-rusted",
        "texture.building.roof-tile-gray",
        "texture.building.roof-tile-red-brown",
      ],
    },
  ])("uses bounded generated texture families on the $mapId map", async ({
    mapId,
    groundTextures,
    wallTextures,
    roofTextures,
  }) => {
    const engine = new NullEngine();
    const assets = createAssets();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5, { mapId });
    const layout = createMapLayout(mapId, state.mapSeed);
    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      false,
      undefined,
      "low",
      mapId,
    );

    const ground = bundle.scene.getMeshByName("island-ground");
    const groundMaterial = ground?.material as MultiMaterial;
    const usedGroundTextures = new Set(ground?.subMeshes.map((subMesh) =>
      (groundMaterial.subMaterials[subMesh.materialIndex] as StandardMaterial).diffuseTexture?.name
    ));
    expect(usedGroundTextures).toEqual(new Set(groundTextures));

    const regularWallMaterials = bundle.scene.materials.filter((entry) =>
      entry.name.startsWith("building-material-") || entry.name.startsWith("building-architecture-material-")
    ) as StandardMaterial[];
    expect(new Set(regularWallMaterials.map((entry) => entry.diffuseTexture?.name)))
      .toEqual(new Set(wallTextures));

    const roofBatch = bundle.scene.getMeshByName("building-roof-slabs-batch");
    const roofMaterials = roofBatch?.material instanceof MultiMaterial
      ? roofBatch.material.subMaterials
      : [roofBatch?.material];
    expect(new Set(roofMaterials.map((entry) =>
      (entry as StandardMaterial | undefined)?.diffuseTexture?.name
    ))).toEqual(new Set(roofTextures));

    const hospitalWallBatch = bundle.scene.getMeshByName(
      `building-walls-${HOSPITAL_WALL_COLOR.replace("#", "")}`,
    );
    const depotWallBatch = bundle.scene.getMeshByName(
      `building-walls-${AMMUNITION_DEPOT_WALL_COLOR.replace("#", "")}`,
    );
    expect((hospitalWallBatch?.material as StandardMaterial).diffuseTexture).toBeNull();
    expect((bundle.scene.getMeshByName("hospital-surfaces-batch")?.material as StandardMaterial).diffuseTexture)
      .toBeNull();
    expect((depotWallBatch?.material as StandardMaterial).diffuseTexture?.name).toBe("texture.industrial.metal");
    expect(bundle.scene.getMeshByName("ammunition-depot-surfaces-batch")?.material)
      .toBe(depotWallBatch?.material);

    expect(bundle.scene.textures.filter((texture) =>
      GENERATED_MAP_TEXTURE_ASSET_IDS.includes(texture.name as typeof GENERATED_MAP_TEXTURE_ASSET_IDS[number])
    ).length).toBeLessThanOrEqual(GENERATED_MAP_TEXTURE_ASSET_IDS.length);
    expect(bundle.scene.materials.length).toBeLessThanOrEqual(75);
    expect(renderedBuildingWallCount(bundle)).toBe(expectedRenderedBuildingWallCount(layout));

    bundle.scene.dispose();
    engine.dispose();
  }, 60_000);

  it("selects mixed ground roles from the owning town, rural, and forest regions", () => {
    const seed = 0;
    const regions = createMixedRegionSpecs(seed);
    const regionByKind = (kind: "town" | "rural" | "forest") => {
      const region = regions.find((candidate) => candidate.kind === kind);
      if (!region) throw new Error(`Mixed ${kind} region missing`);
      return region;
    };
    const town = regionByKind("town");
    const rural = regionByKind("rural");
    const forest = regionByKind("forest");
    const select = (
      region: typeof town,
      kind: "grass" | "mud" | "road" | "road-shoulder",
    ) => selectTerrainTextureAssetId("mixed", seed, region.centerX, region.centerZ, kind);

    expect(select(town, "grass")).toBe("texture.terrain.concrete-urban");
    expect(select(town, "road-shoulder")).toBe("texture.terrain.concrete-urban");
    expect(select(town, "road")).toBe("texture.road.asphalt-damaged");
    expect(select(rural, "grass")).toBe("texture.terrain.dry-soil");
    expect(select(rural, "mud")).toBe("texture.terrain.mud-sparse-grass");
    expect(select(rural, "road-shoulder")).toBe("texture.terrain.gravel");
    expect(select(forest, "grass")).toBe("texture.terrain.forest-moss-wet");
    expect(select(forest, "mud")).toBe("texture.terrain.forest-humus");
    expect(select(forest, "road-shoulder")).toBe("texture.terrain.gravel");
  });

  it("keeps every generated ground texture tint muted and neutral", () => {
    const terrainIds = GENERATED_MAP_TEXTURE_ASSET_IDS.filter((assetId) =>
      assetId.startsWith("texture.terrain.") || assetId.startsWith("texture.road.")
    );
    for (const assetId of terrainIds) {
      const tint = terrainTextureTint(assetId);
      if (!tint) throw new Error(`Terrain tint missing: ${assetId}`);
      const maximum = Math.max(...tint);
      const minimum = Math.min(...tint);
      expect(maximum, assetId).toBeLessThan(0.56);
      expect(maximum - minimum, assetId).toBeLessThan(0.24);
    }
    const drySoil = terrainTextureTint("texture.terrain.dry-soil");
    const sparseGrassMud = terrainTextureTint("texture.terrain.mud-sparse-grass");
    if (!drySoil || !sparseGrassMud) throw new Error("Cool soil tint missing");
    expect(drySoil[2] - drySoil[0]).toBeGreaterThan(0.2);
    expect(sparseGrassMud[2] - sparseGrassMud[0]).toBeGreaterThan(0.12);
  });

  it("keeps semantic ground, wall, and roof fallbacks readable without image payloads", async () => {
    const engine = new NullEngine();
    const assets = createAssets(false);
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      false,
      undefined,
      "low",
      state.mapId,
    );

    const groundMaterials = (bundle.scene.getMeshByName("island-ground")?.material as MultiMaterial)
      .subMaterials as StandardMaterial[];
    const wallMaterials = bundle.scene.materials.filter((entry) =>
      entry.name.startsWith("building-material-")
    ) as StandardMaterial[];
    const roofMaterial = bundle.scene.getMeshByName("building-roof-slabs-batch")?.material;
    const roofMaterials = roofMaterial instanceof MultiMaterial
      ? roofMaterial.subMaterials as StandardMaterial[]
      : [roofMaterial as StandardMaterial];
    const semanticMaterials = [...groundMaterials, ...wallMaterials, ...roofMaterials];

    expect(semanticMaterials.every((entry) => entry.diffuseTexture === null)).toBe(true);
    expect(semanticMaterials.every((entry) =>
      entry.diffuseColor.r + entry.diffuseColor.g + entry.diffuseColor.b > 0.9
    )).toBe(true);
    expect(bundle.scene.getMeshByName("island-ground")).toMatchObject({ isVisible: true });
    expect(renderedBuildingWallCount(bundle)).toBeGreaterThan(0);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);
});
