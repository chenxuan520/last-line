import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { BackgroundMaterial } from "@babylonjs/core/Materials/Background/backgroundMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import type { AssetEntry } from "../../src/assets/types";
import {
  applyActorVisualPose,
  createIslandScene,
  getSkyAssetId,
  setActorEquipmentVisual,
  setActorWeaponVisual,
} from "../../src/client/render/scenes/IslandScene";
import { createMapLayout, getTerrainHeight, HOSPITAL_WALL_COLOR, MAP_SIZE } from "../../src/config/map";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { createBattleRoyaleState, createBattleRoyaleStateForHumans } from "../../src/game/modes/BattleRoyaleMode";
import { createWeaponState } from "../../src/game/state/types";
import { InventorySystem } from "../../src/game/systems/InventorySystem";
import { getSupportHeight } from "../../src/game/systems/MovementSystem";
import productionManifest from "../../public/assets/asset-manifest.json";

describe("IslandScene lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("releases scenes and loot marker references across restarts", async () => {
    const engine = new NullEngine();
    const assets = createAssets();

    for (let restart = 0; restart < 4; restart += 1) {
      const state = createBattleRoyaleState("player", undefined, () => 0.5);
      const showGroundLootModels = restart > 0;
      const bundle = await createIslandScene(
        engine,
        assets,
        state.actors,
        state.groundLoot,
        state.mapSeed,
        showGroundLootModels,
      );
      const layout = createMapLayout(state.mapSeed);
      expect(engine.scenes).toHaveLength(1);
      expect(bundle.lootMeshes.size).toBe(Object.keys(state.groundLoot).length);
      expect([...bundle.lootMeshes.values()].every((mesh) => {
        const expectedLootScale = showGroundLootModels
          ? String(mesh.metadata?.itemId).startsWith("weapon.") ? 2 : 1.45
          : 1;
        return mesh.isPickable
          && mesh.scaling.x === expectedLootScale
          && mesh.scaling.y === expectedLootScale
          && mesh.scaling.z === expectedLootScale;
      })).toBe(true);
      expect([...bundle.lootMeshes.values()].every((mesh) => mesh.metadata?.lootModel === showGroundLootModels)).toBe(true);
      if (!showGroundLootModels) {
        expect([...bundle.lootMeshes.values()].every((mesh) => mesh.getTotalVertices() === 24)).toBe(true);
      }
      const spawnMarker = bundle.lootMeshes.values().next().value;
      const spawnMaterial = spawnMarker?.material;
      state.groundLoot.death = {
        id: "death",
        itemId: "weapon.rifle",
        quantity: 1,
        weapon: createWeaponState("rifle"),
        position: { x: 0, y: 0.45, z: 0 },
        available: true,
        source: "death",
      };
      bundle.syncLootMeshes(state.groundLoot);
      expect(bundle.lootMeshes.get("death")?.material).not.toBe(spawnMaterial);
      expect(bundle.lootMeshes.get("death")?.metadata?.lootSource).toBe("death");
      expect(bundle.viewWeaponRoot.isEnabled()).toBe(false);
      expect(bundle.camera.minZ).toBeGreaterThanOrEqual(0.1);
      expect(bundle.aircraftInteriorRoot.isEnabled()).toBe(true);
      expect(bundle.aircraftVisualRoot.isEnabled()).toBe(false);
      const sceneMeshCount = bundle.scene.meshes.length;
      bundle.syncAircraftVisual({
        start: { x: -100, y: 180, z: -50 },
        end: { x: 100, y: 180, z: 50 },
        durationSeconds: 60,
        progress: 0.5,
      }, true);
      expect(bundle.aircraftVisualRoot.isEnabled()).toBe(true);
      expect(bundle.aircraftVisualRoot.position.asArray()).toEqual([0, 180, 0]);
      expect(bundle.aircraftVisualRoot.parent).toBeNull();
      expect(bundle.aircraftInteriorRoot.parent).toBe(bundle.camera);
      expect(bundle.aircraftVisualRoot.getChildMeshes().filter((mesh) => mesh.metadata?.aircraftTrail)).toHaveLength(2);
      expect(bundle.aircraftVisualRoot.getChildMeshes().every((mesh) => !mesh.isPickable && !mesh.checkCollisions)).toBe(true);
      for (let sync = 0; sync < 100; sync += 1) {
        bundle.syncAircraftVisual({ ...state.flight, progress: sync / 100 }, true);
      }
      expect(bundle.scene.meshes).toHaveLength(sceneMeshCount);
      expect(bundle.viewWeaponRoot.getChildMeshes().every((mesh) => !mesh.isEnabled())).toBe(true);
      expect([...bundle.actorRoots.values()].every((root) => !root.isEnabled())).toBe(true);

      const layeredSurfaces = bundle.scene.meshes.filter((mesh) => mesh.metadata?.surfaceType);
      const decorations = bundle.scene.meshes.filter((mesh) => mesh.metadata?.decoration);
      const hospitalCrosses = decorations.filter((mesh) => mesh.metadata?.decoration === "hospital-cross");
      const brandSigns = decorations.filter((mesh) => mesh.metadata?.decoration === "brand-sign");
      const collisionMeshes = bundle.scene.meshes.filter((mesh) => mesh.metadata?.collision);
      const ground = bundle.scene.getMeshByName("island-ground");
      const sky = bundle.scene.getMeshByName("island-sky-dome");
      expect(sky).toMatchObject({ isPickable: false, checkCollisions: false, infiniteDistance: true });
      expect(sky?.metadata).toMatchObject({ decoration: "sky", skyAssetId: getSkyAssetId(state.mapSeed) });
      expect(sky?.material).toBeInstanceOf(BackgroundMaterial);
      const skyTexture = (sky?.material as BackgroundMaterial).diffuseTexture as Texture | null;
      expect(skyTexture?.name).toBe(getSkyAssetId(state.mapSeed));
      if (getSkyAssetId(state.mapSeed) === "texture.sky.clearing") {
        const skyPositions = sky?.getVerticesData("position") ?? [];
        const skyUvs = sky?.getVerticesData("uv") ?? [];
        const topVertex = skyPositions.findIndex((value, index) => index % 3 === 1 && value > MAP_SIZE * 0.89);
        expect(skyUvs[Math.floor(topVertex / 3) * 2 + 1]).toBeCloseTo(0, 5);
        expect(Math.min(...skyUvs.filter((_, index) => index % 2 === 1))).toBeCloseTo(0, 5);
        expect(Math.max(...skyUvs.filter((_, index) => index % 2 === 1))).toBeCloseTo(1, 5);
      }
      expect(ground?.material).toBeInstanceOf(MultiMaterial);
      const groundMaterials = (ground?.material as MultiMaterial).subMaterials;
      expect(groundMaterials.map((surface) => (surface as StandardMaterial).diffuseTexture?.name)).toEqual([
        "texture.terrain.grass",
        "texture.terrain.mud",
        "texture.road",
      ]);
      expect(new Set(ground?.subMeshes?.map((subMesh) => subMesh.materialIndex))).toEqual(new Set([0, 1, 2]));
      const positions = ground?.getVerticesData("position") ?? [];
      const indices = ground?.getIndices() ?? [];
      const heights = positions.filter((_, index) => index % 3 === 1);
      const colors = ground?.getVerticesData("color") ?? [];
      const terrainColors = new Set(
        Array.from({ length: colors.length / 4 }, (_, index) =>
          Array.from(colors.slice(index * 4, index * 4 + 3), (channel) => channel.toFixed(3)).join(","),
        ),
      );
      const treeTrunks = bundle.scene.meshes.filter((mesh) => /^tree-trunk-\d+$/.test(mesh.name));
      const treeFoliage = bundle.scene.meshes.filter((mesh) => /^tree-foliage-\d+$/.test(mesh.name));
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
      expect(terrainColors.size).toBeGreaterThan(100);
      expect(treeTrunks).toHaveLength(384);
      expect(treeFoliage).toHaveLength(384);
      expect(treeTrunks.every((mesh) => mesh instanceof InstancedMesh)).toBe(true);
      expect(treeFoliage.every((mesh) => mesh instanceof InstancedMesh)).toBe(true);
      expect(treeFoliage.every((mesh) => mesh.getTotalVertices() < 160)).toBe(true);
      expect(layout.treeTrunks.every((tree) => {
        const mesh = bundle.scene.getMeshByName(tree.id);
        return mesh?.position.equalsToFloats(tree.center.x, tree.center.y, tree.center.z) === true &&
          mesh.scaling.equalsToFloats(tree.width / 1.1, tree.height / 5.8, tree.depth / 1.1);
      })).toBe(true);
      expect(hospitalCrosses).toHaveLength(1);
      expect(brandSigns).toHaveLength(5);
      expect(new Set(brandSigns.map((mesh) => mesh.name))).toEqual(new Set([
        "decal.brand.drop-zone",
        "decal.brand.island-operations",
        "decal.brand.property-ll01",
        "decal.brand.restricted-area",
        "decal.brand.supply",
      ]));
      expect(hospitalCrosses[0]).toMatchObject({ isPickable: false, checkCollisions: false });
      expect(hospitalCrosses[0]?.metadata).toMatchObject({ poiName: "医院", poiType: "hospital" });
      const hospitalWalls = layout.wallSegments.filter((wall) => wall.obstacleId === layout.hospital.buildingId);
      const hospitalDoorSills = new Set(
        layout.wallOpenings
          .filter((opening) => opening.obstacleId === layout.hospital.buildingId && opening.kind === "door")
          .map((opening) => `${opening.obstacleId}-wall-${opening.side}-${opening.storyIndex}-sill`),
      );
      const hospitalWallBatch = bundle.scene.getMeshByName("building-walls-eef2ef");
      expect(hospitalWallBatch?.metadata?.sourceCount).toBe(
        hospitalWalls.filter((wall) => !hospitalDoorSills.has(wall.id)).length,
      );
      expect(hospitalWallBatch?.getTotalVertices()).toBe(
        hospitalWalls.filter((wall) => !hospitalDoorSills.has(wall.id)).length * 24,
      );
      const wallMaterials = bundle.scene.materials.filter((sceneMaterial) =>
        sceneMaterial.name.startsWith("building-material-")
      ) as StandardMaterial[];
      expect(wallMaterials.every((sceneMaterial) =>
        sceneMaterial.diffuseTexture?.name === "texture.building.wall"
      )).toBe(true);
      expect(new Set(wallMaterials.map((sceneMaterial) => sceneMaterial.diffuseTexture)).size).toBe(1);
      expect(treeFoliage.every((mesh) =>
        mesh.getBoundingInfo().boundingBox.maximumWorld.y - getTerrainHeight(mesh.position.x, mesh.position.z, layout) > 15
      )).toBe(true);
      expect(Math.max(...treeFoliage.map((mesh) =>
        mesh.getBoundingInfo().boundingBox.maximumWorld.y - getTerrainHeight(mesh.position.x, mesh.position.z, layout)
      ))).toBeGreaterThan(24);
      expect(layout.rockObstacles.every((rock) => {
        const mesh = bundle.scene.getMeshByName(rock.id);
        return mesh?.metadata?.obstacleId === rock.id &&
          mesh.scaling.x === rock.width && mesh.scaling.y === rock.height && mesh.scaling.z === rock.depth;
      })).toBe(true);
      const coverMeshes = bundle.scene.meshes.filter((mesh) => mesh.metadata?.decoration === "cover-prop");
      expect(coverMeshes.filter((mesh) => mesh.metadata?.coverKind === "fence")).toHaveLength(1);
      expect(coverMeshes.find((mesh) => mesh.metadata?.coverKind === "fence")?.metadata?.sourceCount).toBe(96 * 5);
      expect(coverMeshes.filter((mesh) => mesh.metadata?.coverKind === "hay")).toHaveLength(1);
      expect(coverMeshes.find((mesh) => mesh.metadata?.coverKind === "hay")?.metadata?.sourceCount).toBe(72 * 3);
      expect((coverMeshes.find((mesh) => mesh.metadata?.coverKind === "hay")?.material as StandardMaterial)
        .diffuseColor.toHexString()).toBe("#B86B22");
      const decorativeRocks = bundle.scene.meshes.filter((mesh) => /^rock-\d+$/.test(mesh.name));
      expect(decorativeRocks).toHaveLength(96);
      const mountainTrees = treeTrunks.filter((mesh) => layout.terrainHills.some((hill) =>
        hill.height >= 24 && Math.hypot(mesh.position.x - hill.x, mesh.position.z - hill.z) <= hill.radius * 0.72
      ));
      const mountainRocks = decorativeRocks.filter((mesh) => layout.terrainHills.some((hill) =>
        hill.height >= 24 && Math.hypot(mesh.position.x - hill.x, mesh.position.z - hill.z) <= hill.radius * 0.72
      ));
      expect(mountainTrees.length).toBeGreaterThanOrEqual(150);
      expect(mountainRocks.length).toBeGreaterThanOrEqual(44);
      expect(bundle.scene.meshes.filter((mesh) => /^shrub-\d+$/.test(mesh.name))).toHaveLength(180);
      expect(layeredSurfaces).toHaveLength(0);
      expect(bundle.scene.meshes.filter((mesh) => mesh.name.startsWith("ocean-"))).toHaveLength(0);
      const floorMeshes = bundle.scene.meshes.filter(
        (mesh) =>
          mesh.name === "island-ground" ||
          mesh.name.startsWith("island-beach-") ||
          mesh.name.startsWith("island-wet-shore-"),
      );
      for (let leftIndex = 0; leftIndex < floorMeshes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < floorMeshes.length; rightIndex += 1) {
          const left = floorMeshes[leftIndex]?.getBoundingInfo().boundingBox;
          const right = floorMeshes[rightIndex]?.getBoundingInfo().boundingBox;
          if (!left || !right) continue;
          const overlapX = Math.min(left.maximumWorld.x, right.maximumWorld.x) - Math.max(left.minimumWorld.x, right.minimumWorld.x);
          const overlapZ = Math.min(left.maximumWorld.z, right.maximumWorld.z) - Math.max(left.minimumWorld.z, right.minimumWorld.z);
          expect(overlapX <= 0.001 || overlapZ <= 0.001).toBe(true);
        }
      }
      for (let triangleIndex = 0; triangleIndex + 2 < indices.length; triangleIndex += 3 * 257) {
        const first = (indices[triangleIndex] ?? 0) * 3;
        const second = (indices[triangleIndex + 1] ?? 0) * 3;
        const third = (indices[triangleIndex + 2] ?? 0) * 3;
        const x = ((positions[first] ?? 0) + (positions[second] ?? 0) + (positions[third] ?? 0)) / 3;
        const y = ((positions[first + 1] ?? 0) + (positions[second + 1] ?? 0) + (positions[third + 1] ?? 0)) / 3;
        const z = ((positions[first + 2] ?? 0) + (positions[second + 2] ?? 0) + (positions[third + 2] ?? 0)) / 3;
        expect(getTerrainHeight(x, z, layout)).toBeCloseTo(y, 5);
      }
      expect(decorations.every((mesh) => !mesh.isPickable && !mesh.checkCollisions)).toBe(true);
      expect(collisionMeshes).toHaveLength(new Set(layout.wallSegments.map((wall) => wall.color)).size + 1);
      expect(bundle.scene.meshes.length).toBeLessThan(4_000);
      const hospitalFloors = layout.floorSlabs.filter((slab) =>
        slab.obstacleId === layout.hospital.buildingId && slab.kind === "floor"
      );
      const regularFloors = layout.floorSlabs.filter((slab) =>
        slab.obstacleId !== layout.hospital.buildingId && slab.kind === "floor"
      );
      const roofs = layout.floorSlabs.filter((slab) => slab.kind === "roof");
      const floorBatch = bundle.scene.getMeshByName("building-floor-slabs-batch");
      const roofBatch = bundle.scene.getMeshByName("building-roof-slabs-batch");
      const hospitalFloorBatch = bundle.scene.getMeshByName("hospital-floor-slabs-batch");
      expect(floorBatch?.metadata?.sourceCount).toBe(regularFloors.length);
      expect(floorBatch?.getTotalVertices()).toBe(regularFloors.length * 24);
      expect((floorBatch?.material as StandardMaterial).diffuseTexture).toBeNull();
      expect(roofBatch?.metadata?.sourceCount).toBe(roofs.length);
      expect(roofBatch?.getTotalVertices()).toBe(roofs.length * 24);
      expect((roofBatch?.material as StandardMaterial).diffuseTexture?.name).toBe("texture.building.roof");
      expect(hospitalFloorBatch?.metadata?.sourceCount).toBe(hospitalFloors.length);
      expect(hospitalFloorBatch?.getTotalVertices()).toBe(hospitalFloors.length * 24);
      expect(hospitalFloorBatch?.material).toBeInstanceOf(StandardMaterial);
      expect((hospitalFloorBatch?.material as StandardMaterial).diffuseColor.toHexString().toLowerCase()).toBe(
        HOSPITAL_WALL_COLOR,
      );
      const openingPieceCount =
        layout.wallOpenings.filter((opening) => opening.kind === "window").length * 4 +
        layout.wallOpenings.filter((opening) => opening.kind === "door").length * 3;
      expect(bundle.scene.getMeshByName("building-openings-batch")?.metadata?.sourceCount).toBe(openingPieceCount);
      expect(bundle.scene.getMeshByName("building-ramps-batch")?.metadata?.sourceCount).toBe(layout.roofRamps.length);
      const ringPositions = bundle.safeZoneRing.getVerticesData("position") ?? [];
      for (let ringIndex = 0; ringIndex < ringPositions.length; ringIndex += 6 * 12) {
        const x = ringPositions[ringIndex] ?? 0;
        const lowerY = ringPositions[ringIndex + 1] ?? 0;
        const z = ringPositions[ringIndex + 2] ?? 0;
        const upperY = ringPositions[ringIndex + 4] ?? 0;
        expect(lowerY).toBeCloseTo(getTerrainHeight(x, z, layout) + 0.12, 5);
        expect(upperY).toBeCloseTo(getTerrainHeight(x, z, layout) + 1.5, 5);
      }
      const positionBuffer = bundle.safeZoneRing.getVertexBuffer(VertexBuffer.PositionKind);
      bundle.syncSafeZoneRing(40, -30, 100);
      expect(bundle.safeZoneRing.getVertexBuffer(VertexBuffer.PositionKind)).toBe(positionBuffer);
      expect(bundle.safeZoneRing.getVertexBuffer(VertexBuffer.NormalKind)).toBeFalsy();
      const movedRingPositions = bundle.safeZoneRing.getVerticesData("position") ?? [];
      expect(movedRingPositions[0]).toBeCloseTo(140);
      expect(movedRingPositions[2]).toBeCloseTo(-30);
      expect(movedRingPositions[1]).toBeCloseTo(getTerrainHeight(140, -30, layout) + 0.12, 5);
      bundle.syncSafeZoneRing(0, 0, 400);
      const edgeRingPositions = bundle.safeZoneRing.getVerticesData("position") ?? [];
      for (let ringIndex = 0; ringIndex + 10 < edgeRingPositions.length; ringIndex += 6) {
        const midpointX = ((edgeRingPositions[ringIndex] ?? 0) + (edgeRingPositions[ringIndex + 6] ?? 0)) / 2;
        const midpointZ = ((edgeRingPositions[ringIndex + 2] ?? 0) + (edgeRingPositions[ringIndex + 8] ?? 0)) / 2;
        const upperMidpointY = ((edgeRingPositions[ringIndex + 4] ?? 0) + (edgeRingPositions[ringIndex + 10] ?? 0)) / 2;
        expect(upperMidpointY - getTerrainHeight(midpointX, midpointZ, layout)).toBeGreaterThan(0.2);
      }

      const bot = state.actors["bot-1"];
      const botRoot = bundle.actorRoots.get("bot-1");
      const botVisualRoot = bundle.actorVisualRoots.get("bot-1");
      if (!bot || !botRoot || !botVisualRoot) throw new Error("test bot missing");
      expect(botVisualRoot.parent).toBe(botRoot);
      expect(botRoot.getChildMeshes(true)).toHaveLength(0);
      const originalBotPosition = botRoot.position.clone();
      applyActorVisualPose(botVisualRoot, -0.1, 0.12);
      expect(botVisualRoot.position.y).toBe(-0.1);
      expect(botVisualRoot.rotation.x).toBe(0.12);
      expect(botRoot.position).toEqual(originalBotPosition);
      const weaponMeshes = botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "weapon");
      const parachuteMeshes = botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "parachute");
      const vestMeshes = botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "vest");
      const helmetMeshes = botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "helmet");
      expect(parachuteMeshes).toHaveLength(1);
      expect(parachuteMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      expect(vestMeshes).toHaveLength(1);
      expect(helmetMeshes).toHaveLength(1);
      expect(vestMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      expect(helmetMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      expect(vestMeshes[0]?.material).not.toBe(bundle.scene.getMaterialByName("actor-gear-material"));
      setActorEquipmentVisual(botRoot, 1, 2);
      expect(vestMeshes.every((mesh) => mesh.isEnabled(false))).toBe(true);
      expect(helmetMeshes.every((mesh) => mesh.isEnabled(false))).toBe(true);
      setActorEquipmentVisual(botRoot, 0, 0);
      expect(vestMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      expect(helmetMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      const weaponIds = new Set(weaponMeshes.map((mesh) => mesh.metadata?.weaponId));
      expect(weaponIds).toEqual(new Set(["rifle", "smg", "shotgun", "sniper"]));
      expect(weaponMeshes.every((mesh) => !mesh.isEnabled(false))).toBe(true);
      bot.inventory.weaponSlots[0] = createWeaponState("rifle");
      setActorWeaponVisual(botRoot, "rifle");
      expect(weaponMeshes.filter((mesh) => mesh.metadata?.weaponId === "rifle").every((mesh) => mesh.isEnabled(false))).toBe(true);
      expect(weaponMeshes.filter((mesh) => mesh.metadata?.weaponId !== "rifle").every((mesh) => !mesh.isEnabled(false))).toBe(true);
      setActorWeaponVisual(botRoot, "shotgun");
      expect(weaponMeshes.filter((mesh) => mesh.metadata?.weaponId === "shotgun").every((mesh) => mesh.isEnabled(false))).toBe(true);
      expect(weaponMeshes.filter((mesh) => mesh.metadata?.weaponId !== "shotgun").every((mesh) => !mesh.isEnabled(false))).toBe(true);
      const viewWeaponMeshes = bundle.viewWeaponRoot.getChildMeshes(false)
        .filter((mesh) => mesh.metadata?.actorVisual === "weapon");
      expect(new Set(viewWeaponMeshes.map((mesh) => mesh.metadata?.weaponId))).toEqual(new Set(["rifle", "smg", "shotgun", "sniper"]));
      setActorWeaponVisual(bundle.viewWeaponRoot, "smg");
      expect(viewWeaponMeshes.filter((mesh) => mesh.metadata?.weaponId === "smg").every((mesh) => mesh.isEnabled(false))).toBe(true);
      expect(viewWeaponMeshes.filter((mesh) => mesh.metadata?.weaponId !== "smg").every((mesh) => !mesh.isEnabled(false))).toBe(true);

      bundle.scene.dispose();

      expect(bundle.scene.isDisposed).toBe(true);
      expect(engine.scenes).toHaveLength(0);
      expect(bundle.lootMeshes.size).toBe(0);
    }
    engine.dispose();
  }, 60_000);

  it("uses reusable low-poly ground loot models when the setting is enabled", async () => {
    const engine = new NullEngine();
    const assets = createAssets();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const loot = Object.values(state.groundLoot).find((entry) => entry.itemId === "weapon.rifle");
    if (!loot) throw new Error("rifle loot missing");
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed, true);
    const marker = bundle.lootMeshes.get(loot.id);
    if (!marker) throw new Error("rifle marker missing");
    const rifleGeometry = marker.geometry;
    const spawnMaterial = marker.material;
    const layout = createMapLayout(state.mapSeed);

    expect(marker.metadata).toMatchObject({
      itemId: "weapon.rifle",
      lootModel: true,
      lootModelScale: 2,
      modelId: "weapon.rifle",
    });
    expect(marker.billboardMode).toBe(0);
    expect(marker.getTotalVertices()).toBeGreaterThan(24);
    expect(marker.getChildMeshes()).toHaveLength(0);
    expect(bundle.lootMeshes.size).toBe(Object.keys(state.groundLoot).length);
    expect(bundle.scene.meshes.filter((mesh) => mesh.name.startsWith("loot-model-template-"))).toHaveLength(15);
    expect(bundle.scene.materials.filter((entry) => entry.name.startsWith("loot-model-material-"))).toHaveLength(14);
    expect(bundle.scene.materials
      .filter((entry) => entry.name.startsWith("loot-model-material-"))
      .every((entry) => (entry as StandardMaterial).diffuseColor.toHexString() === "#E2C66D")).toBe(true);
    const secondRifle = [...bundle.lootMeshes.values()].find((candidate) =>
      candidate !== marker && candidate.metadata?.itemId === "weapon.rifle"
    );
    expect(secondRifle?.geometry).toBe(rifleGeometry);
    expect([...bundle.lootMeshes.values()].every((modelMarker) => {
      const expectedScale = String(modelMarker.metadata?.itemId).startsWith("weapon.") ? 2 : 1.45;
      return modelMarker.scaling.equals(new Vector3(expectedScale, expectedScale, expectedScale));
    })).toBe(true);
    const weaponGapProbes: Readonly<Record<string, number>> = {
      "weapon.rifle": 0.44175,
      "weapon.smg": 0.23275,
      "weapon.shotgun": 0.323,
      "weapon.sniper": 0.494,
    };
    for (const [itemId, localX] of Object.entries(weaponGapProbes)) {
      const weaponMarker = [...bundle.lootMeshes.values()].find((candidate) => candidate.metadata?.itemId === itemId);
      if (!weaponMarker) throw new Error(`${itemId} marker missing`);
      weaponMarker.computeWorldMatrix(true);
      const bounds = weaponMarker.getBoundingInfo().boundingBox;
      const ray = new Ray(
        new Vector3(
          weaponMarker.position.x + localX * weaponMarker.scaling.x,
          bounds.maximumWorld.y + 0.5,
          weaponMarker.position.z,
        ),
        Vector3.Down(),
        bounds.maximumWorld.y - bounds.minimumWorld.y + 1,
      );
      expect(bundle.scene.pickWithRay(ray, (candidate) => candidate === weaponMarker)?.hit).toBe(true);
    }
    const inventory = new InventorySystem(layout);
    const player = state.actors.player;
    player.deployment = "grounded";
    player.position = { x: 0, y: getTerrainHeight(0, 0, layout) + 1.76, z: 0 };
    player.inventory.weaponSlots = [createWeaponState("rifle"), null];
    player.inventory.activeWeaponSlot = 0;
    const reusableAmmoLoot = Object.values(state.groundLoot).find((entry) => entry.itemId === "ammo.rifle");
    if (!reusableAmmoLoot) throw new Error("reusable ammo loot missing");
    const reusableAmmoId = reusableAmmoLoot.id;
    const reusableAmmoGeneration = reusableAmmoLoot.generation ?? 0;
    const reusableAmmoMarker = bundle.lootMeshes.get(reusableAmmoId);
    if (!reusableAmmoMarker) throw new Error("reusable ammo marker missing");
    reusableAmmoLoot.available = false;
    inventory.processCommand(state, player.id, {
      ...createIdleCommand(),
      dropItem: "weapon.rifle",
    }, []);
    bundle.syncLootMeshes(state.groundLoot);
    const droppedRifleLoot = Object.values(state.groundLoot).find((entry) => entry.source === "drop" && entry.itemId === "weapon.rifle");
    if (!droppedRifleLoot) throw new Error("dropped rifle loot missing");
    const droppedRifle = bundle.lootMeshes.get(droppedRifleLoot.id);
    if (!droppedRifle) throw new Error("dropped rifle marker missing");
    expect(droppedRifleLoot.id).toBe(reusableAmmoId);
    expect(droppedRifleLoot.generation).toBe(reusableAmmoGeneration + 1);
    expect(droppedRifle).toBe(reusableAmmoMarker);
    expect(droppedRifle.geometry).toBe(rifleGeometry);
    expect(droppedRifle.scaling.equals(new Vector3(2, 2, 2))).toBe(true);
    expect((droppedRifle.material as StandardMaterial).diffuseColor.toHexString()).toBe("#E2C66D");
    expect(droppedRifle.metadata).toMatchObject({
      itemId: "weapon.rifle",
      lootSource: "drop",
      lootModelScale: 2,
    });

    const bot = Object.values(state.actors).find((actor) => actor.kind === "bot");
    const smgLoot = Object.values(state.groundLoot).find((entry) => entry.itemId === "weapon.smg" && entry.source === "spawn");
    const independentSmgLoot = Object.values(state.groundLoot).find((entry) =>
      entry.itemId === "weapon.smg" && entry.source === "spawn" && entry.id !== smgLoot?.id
    );
    if (!bot || !smgLoot || !independentSmgLoot) throw new Error("death drop fixtures missing");
    const reusableSmgId = smgLoot.id;
    const reusableSmgGeneration = smgLoot.generation ?? 0;
    const reusableSmgMarker = bundle.lootMeshes.get(reusableSmgId);
    const independentNaturalSmg = bundle.lootMeshes.get(independentSmgLoot.id);
    if (!reusableSmgMarker || !independentNaturalSmg) throw new Error("smg marker fixtures missing");
    smgLoot.available = false;
    bot.deployment = "grounded";
    bot.position = { x: 2, y: getTerrainHeight(2, 0, layout) + 1.76, z: 0 };
    bot.inventory.weaponSlots = [createWeaponState("smg"), null];
    bot.inventory.activeWeaponSlot = 0;
    bot.inventory.backpack = [];
    bot.inventory.armorLevel = 0;
    bot.inventory.helmetLevel = 0;
    bot.alive = false;
    inventory.dropDeadInventories(state, []);
    bundle.syncLootMeshes(state.groundLoot);
    const deathSmgLoot = Object.values(state.groundLoot).find((entry) => entry.source === "death" && entry.itemId === "weapon.smg");
    if (!deathSmgLoot) throw new Error("death smg loot missing");
    const deathSmg = bundle.lootMeshes.get(deathSmgLoot.id);
    if (!deathSmg) throw new Error("death smg marker missing");
    expect(deathSmgLoot.id).toBe(reusableSmgId);
    expect(deathSmgLoot.generation).toBe(reusableSmgGeneration + 1);
    expect(deathSmg).toBe(reusableSmgMarker);
    expect(deathSmg).not.toBe(independentNaturalSmg);
    expect(deathSmg.geometry).toBe(independentNaturalSmg.geometry);
    expect(deathSmg.getTotalVertices()).toBe(independentNaturalSmg.getTotalVertices());
    expect(deathSmg.scaling.equals(new Vector3(2, 2, 2))).toBe(true);
    expect((deathSmg.material as StandardMaterial).diffuseColor.toHexString()).toBe("#C85E50");
    expect(deathSmg.metadata).toMatchObject({
      itemId: "weapon.smg",
      lootSource: "death",
      lootModelScale: 2,
    });
    const classicMarkerDiagonal = 0.62 * Math.sqrt(3);
    for (const modelMarker of bundle.lootMeshes.values()) {
      const modelLoot = state.groundLoot[String(modelMarker.metadata?.lootId)];
      if (!modelLoot) throw new Error("model loot missing");
      modelMarker.computeWorldMatrix(true);
      const bounds = modelMarker.getBoundingInfo().boundingBox;
      const support = getSupportHeight(
        modelLoot.position.x,
        modelLoot.position.z,
        modelLoot.position.y,
        layout,
      );
      expect(bounds.maximumWorld.subtract(bounds.minimumWorld).length()).toBeGreaterThanOrEqual(classicMarkerDiagonal);
      expect(bounds.minimumWorld.y).toBeCloseTo(support + 0.04, 2);
    }

    loot.itemId = "bandage";
    loot.generation = (loot.generation ?? 0) + 1;
    loot.source = "death";
    bundle.syncLootMeshes(state.groundLoot);

    expect(bundle.lootMeshes.get(loot.id)).toBe(marker);
    expect(marker.geometry).not.toBe(rifleGeometry);
    expect(marker.material).not.toBe(spawnMaterial);
    expect((marker.material as StandardMaterial).diffuseColor.toHexString()).toBe("#C85E50");
    expect(marker.metadata).toMatchObject({
      itemId: "bandage",
      lootSource: "death",
      lootModel: true,
      lootModelScale: 1.45,
      modelId: "bandage",
    });
    expect(marker.getTotalVertices()).toBeGreaterThan(24);
    expect(bundle.scene.meshes.filter((mesh) => mesh.name.startsWith("loot-model-template-"))).toHaveLength(15);
    expect(bundle.scene.materials.filter((entry) => entry.name.startsWith("loot-model-material-"))).toHaveLength(14);

    const roof = layout.floorSlabs.find((slab) => slab.kind === "roof");
    if (!roof) throw new Error("roof slab missing");
    expect(roof.kind).toBe("roof");
    const roofY = roof.center.y + roof.height / 2;
    const roofSupport = getSupportHeight(roof.center.x, roof.center.z, roofY + 0.45, layout);
    expect(roofSupport).toBeCloseTo(roofY);
    loot.position = { x: roof.center.x, y: roofY + 0.45, z: roof.center.z };
    loot.itemId = "future.unknown-item";
    loot.generation = (loot.generation ?? 0) + 1;
    bundle.syncLootMeshes(state.groundLoot);
    marker.computeWorldMatrix(true);
    expect(marker.metadata?.modelId).toBe("fallback");
    expect(marker.rotation.y).toBeCloseTo(Math.PI / 4);
    expect(marker.rotation.z).toBeCloseTo(Math.PI / 4);
    expect(marker.getBoundingInfo().boundingBox.minimumWorld.y).toBeCloseTo(roofSupport + 0.04, 2);

    loot.itemId = "weapon.sniper";
    loot.generation = (loot.generation ?? 0) + 1;
    bundle.syncLootMeshes(state.groundLoot);
    marker.computeWorldMatrix(true);
    expect(marker.metadata?.modelId).toBe("weapon.sniper");
    expect(marker.rotation.y).toBeCloseTo(0);
    expect(marker.rotation.z).toBeCloseTo(0);
    expect(marker.getBoundingInfo().boundingBox.minimumWorld.y).toBeCloseTo(roofSupport + 0.04, 2);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("renders remote human actors while keeping the explicit local actor first-person", async () => {
    const engine = new NullEngine();
    const assets = createAssets();
    const config = {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    };
    const state = createBattleRoyaleStateForHumans(["human-1", "human-2"], config, () => 0.5);

    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      false,
      "human-1",
      "low",
    );

    expect(bundle.scene.getMeshByName("body-human-1")).toBeNull();
    expect(bundle.scene.getMeshByName("body-human-2")).not.toBeNull();
    expect(bundle.actorRoots.get("human-2")?.getChildMeshes(false)
      .some((mesh) => mesh.metadata?.actorVisual === "parachute")).toBe(true);
    expect(bundle.scene.meshes.filter((mesh) => /^tree-trunk-\d+$/.test(mesh.name))).toHaveLength(384);
    expect(bundle.scene.meshes.filter((mesh) => /^tree-foliage-\d+$/.test(mesh.name))).toHaveLength(384);
    expect(bundle.scene.meshes.filter((mesh) => /^rock-\d+$/.test(mesh.name))).toHaveLength(32);
    expect(bundle.scene.meshes.filter((mesh) => /^shrub-\d+$/.test(mesh.name))).toHaveLength(60);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("loads and switches character LODs while keeping procedural held weapons", async () => {
    const assets = await createGlbAssets();
    const fetchMock = vi.mocked(fetch);
    const removeItem = vi.fn();
    vi.stubGlobal("sessionStorage", { removeItem });
    fetchMock.mockClear();
    const state = createBattleRoyaleStateForHumans(["player", "human-2"], {
      participantCount: 3,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const player = state.actors.player;
    const bot = state.actors["bot-1"];
    if (!player || !bot) throw new Error("test actors missing");
    player.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.inventory.weaponSlots[0] = createWeaponState("smg");
    bot.deployment = "parachuting";
    const engine = new NullEngine();

    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);
    const botRoot = bundle.actorRoots.get(bot.id);
    const humanRoot = bundle.actorRoots.get("human-2");
    if (!botRoot || !humanRoot) throw new Error("test remote roots missing");
    const viewMeshes = bundle.viewWeaponRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.actorVisual === "weapon");
    const botMeshes = botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.actorVisual === "weapon");

    for (const weaponId of ["rifle", "smg", "shotgun", "sniper"] as const) {
      expect(viewMeshes.filter((mesh) => mesh.metadata?.weaponId === weaponId)
        .every((mesh) => mesh.metadata?.weaponFallback === true && !mesh.metadata?.visualModel)).toBe(true);
      expect(botMeshes.filter((mesh) => mesh.metadata?.weaponId === weaponId)
        .every((mesh) => mesh.metadata?.weaponFallback === true && !mesh.metadata?.visualModel)).toBe(true);
    }
    expect(botMeshes.filter((mesh) => mesh.metadata?.weaponFallbackSuppressed !== true)
      .every((mesh) => mesh.parent?.name.includes("weapon_socket") === true)).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => input.toString().includes("/weapon-") && input.toString().endsWith(".glb")))
      .toBe(false);
    expect(removeItem).toHaveBeenCalledWith("last-line.dynamic-chunk-reloads.v1");
    const baseCharacter = bundle.scene.getTransformNodeByName(`${bot.id}-character-base`);
    const lodCharacter = bundle.scene.getTransformNodeByName(`${bot.id}-character-lod1`);
    expect(baseCharacter?.metadata?.visualModel).toBe("model.character.enemy");
    expect(lodCharacter?.metadata?.visualModel).toBe("model.character.enemy.lod1");
    expect(bundle.scene.getTransformNodeByName("human-2-character-base")?.metadata?.visualModel)
      .toBe("model.character.player");
    expect(bundle.scene.getTransformNodeByName("human-2-character-lod1")?.metadata?.visualModel)
      .toBe("model.character.player.lod1");
    bundle.camera.position.copyFrom(botRoot.position);
    bundle.scene.render();
    expect(baseCharacter?.isEnabled()).toBe(true);
    expect(lodCharacter?.isEnabled()).toBe(false);
    bundle.camera.position.set(1_000, 200, 1_000);
    bundle.scene.render();
    expect(baseCharacter?.isEnabled()).toBe(false);
    expect(lodCharacter?.isEnabled()).toBe(true);
    expect(botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "parachute")
      .every((mesh) => mesh.isEnabled(false))).toBe(true);
    expect(botMeshes.filter((mesh) => mesh.metadata?.weaponId === "smg" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    setActorWeaponVisual(bundle.viewWeaponRoot, "shotgun");
    expect(viewMeshes.filter((mesh) => mesh.metadata?.weaponId === "shotgun")
      .some((mesh) => mesh.isEnabled(false))).toBe(true);
    expect(viewMeshes.filter((mesh) => mesh.metadata?.weaponId !== "shotgun")
      .every((mesh) => !mesh.isEnabled(false))).toBe(true);

    bundle.scene.dispose();
    expect(engine.scenes).toHaveLength(0);
    engine.dispose();
  }, 30_000);

  it("preserves production character handedness while keeping procedural held weapons", async () => {
    const assets = createProductionGlbAssets();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const player = state.actors.player;
    const bot = state.actors["bot-1"];
    if (!player || !bot) throw new Error("production GLB actors missing");
    player.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.inventory.weaponSlots[0] = createWeaponState("rifle");
    player.deployment = "grounded";
    bot.deployment = "grounded";
    const engine = new NullEngine();
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);

    const characterRoot = bundle.scene.getMeshByName(`${bot.id}-base-__root__`);
    const botRoot = bundle.actorRoots.get(bot.id);
    if (!characterRoot || !botRoot) throw new Error("production character fixture missing");
    bundle.scene.render();

    expect(characterRoot.scaling.z).toBeLessThan(0);
    expect(characterRoot.isEnabled()).toBe(true);
    const uniform = bundle.scene.getMeshByName(`${bot.id}-base-character-merged-uniform`)?.material as
      { albedoColor?: Color3 } | null;
    const uniformDark = bundle.scene.getMeshByName(`${bot.id}-base-character-merged-uniformDark`)?.material as
      { albedoColor?: Color3 } | null;
    const uniformLight = bundle.scene.getMeshByName(`${bot.id}-base-character-merged-uniformLight`)?.material as
      { albedoColor?: Color3 } | null;
    const skin = bundle.scene.getMeshByName(`${bot.id}-base-character-merged-skin`)?.material as
      { albedoColor?: Color3 } | null;
    expect(uniform?.albedoColor?.toHexString()).toBe("#526773");
    expect(uniformDark?.albedoColor?.toHexString()).toBe("#344550");
    expect(uniformLight?.albedoColor?.toHexString()).toBe("#6C8290");
    expect(skin?.albedoColor?.toHexString()).toBe("#946F58");
    expect(bundle.viewWeaponRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    expect(botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    expect(botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallbackSuppressed !== true)
      .every((mesh) => mesh.parent?.name.includes("weapon_socket") === true)).toBe(true);
    expect(bundle.scene.meshes.some((mesh) => String(mesh.metadata?.visualModel).startsWith("model.weapon."))).toBe(false);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("keeps a medium production 50-actor scene within resource budgets", async () => {
    const assets = createProductionGlbAssets();
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const engine = new NullEngine();

    expect(Object.values(state.actors).filter((actor) => actor.kind === "player")).toHaveLength(1);
    expect(Object.values(state.actors).filter((actor) => actor.kind === "bot")).toHaveLength(49);

    try {
      const bundle = await createIslandScene(
        engine,
        assets,
        state.actors,
        state.groundLoot,
        state.mapSeed,
        true,
        "player",
        "medium",
      );
      try {
        expect(bundle.scene.transformNodes.filter((node) =>
          node.metadata?.visualModel === "model.character.enemy"
        )).toHaveLength(49);
        expect(bundle.scene.transformNodes.filter((node) =>
          node.metadata?.visualModel === "model.character.enemy.lod1"
        )).toHaveLength(49);
        const aggregateMeshVertices = bundle.scene.meshes.reduce(
          (total, mesh) => total + mesh.getTotalVertices(),
          0,
        );
        const aggregateMeshIndices = bundle.scene.meshes.reduce(
          (total, mesh) => total + mesh.getTotalIndices(),
          0,
        );
        const uniqueGeometryVertices = bundle.scene.geometries.reduce(
          (total, geometry) => total + geometry.getTotalVertices(),
          0,
        );
        const uniqueGeometryIndices = bundle.scene.geometries.reduce(
          (total, geometry) => total + geometry.getTotalIndices(),
          0,
        );

        expect(bundle.scene.meshes.length).toBeLessThanOrEqual(4_600);
        expect(bundle.scene.transformNodes.length).toBeLessThanOrEqual(520);
        expect(bundle.scene.materials.length).toBeLessThanOrEqual(75);
        expect(bundle.scene.geometries.length).toBeLessThanOrEqual(2_500);
        expect(aggregateMeshVertices).toBeLessThanOrEqual(580_000);
        expect(aggregateMeshIndices).toBeLessThanOrEqual(1_550_000);
        expect(uniqueGeometryVertices).toBeLessThanOrEqual(400_000);
        expect(uniqueGeometryIndices).toBeLessThanOrEqual(950_000);
      } finally {
        bundle.scene.dispose();
      }
    } finally {
      engine.dispose();
    }
    expect(engine.scenes).toHaveLength(0);
  }, 60_000);

  it("keeps procedural base models when only LOD1 GLBs load", async () => {
    const assets = await createGlbAssets(new Set(["/enemy.glb"]));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const player = state.actors.player;
    const bot = state.actors["bot-1"];
    if (!player || !bot) throw new Error("fallback actors missing");
    player.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.deployment = "grounded";
    const engine = new NullEngine();
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);
    const botRoot = bundle.actorRoots.get(bot.id);
    if (!botRoot) throw new Error("fallback bot root missing");
    setActorWeaponVisual(bundle.viewWeaponRoot, "rifle");
    setActorWeaponVisual(botRoot, "rifle");

    expect(bundle.scene.getTransformNodeByName(`${bot.id}-character-base`)).toBeNull();
    expect(bundle.scene.getTransformNodeByName(`${bot.id}-character-lod1`)).toBeNull();
    expect(bundle.scene.getMeshByName(`body-${bot.id}`)).not.toBeNull();
    expect(bundle.viewWeaponRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    expect(botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    expect(error).toHaveBeenCalled();

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("does not request catalog weapon models when character base succeeds", async () => {
    const assets = await createGlbAssets();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const player = state.actors.player;
    const bot = state.actors["bot-1"];
    if (!player || !bot) throw new Error("weapon fallback actors missing");
    player.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.deployment = "grounded";
    const engine = new NullEngine();
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);
    const botRoot = bundle.actorRoots.get(bot.id);
    if (!botRoot) throw new Error("weapon fallback bot root missing");
    setActorWeaponVisual(bundle.viewWeaponRoot, "rifle");
    setActorWeaponVisual(botRoot, "rifle");

    expect(bundle.scene.getTransformNodeByName(`${bot.id}-character-base`)).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => input.toString().includes("/rifle") && input.toString().endsWith(".glb")))
      .toBe(false);
    expect(bundle.viewWeaponRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);
    expect(botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("keeps a valid base character and procedural weapons active when character LOD1 fails", async () => {
    const assets = await createGlbAssets(new Set(["/enemy-lod1.glb"]));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("LOD fallback bot missing");
    bot.inventory.weaponSlots[0] = createWeaponState("rifle");
    bot.deployment = "grounded";
    const engine = new NullEngine();
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);
    const botRoot = bundle.actorRoots.get(bot.id);
    const baseCharacter = bundle.scene.getTransformNodeByName(`${bot.id}-character-base`);
    if (!botRoot || !baseCharacter) throw new Error("LOD fallback base character missing");
    bundle.camera.position.set(1_000, 200, 1_000);
    bundle.scene.render();

    expect(baseCharacter.isEnabled()).toBe(true);
    expect(bundle.scene.getTransformNodeByName(`${bot.id}-character-lod1`)).toBeNull();
    expect(botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.weaponId === "rifle" && mesh.metadata?.weaponFallback === true)
      .some((mesh) => mesh.isEnabled())).toBe(true);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("keeps procedural actors and does not download GLBs on low quality", async () => {
    const assets = await createGlbAssets();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 1, shrinkSeconds: 1, radius: 100, damagePerSecond: 1 }],
    }, () => 0.5);
    const engine = new NullEngine();

    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      false,
      undefined,
      "low",
    );

    expect(fetchMock.mock.calls.some(([input]) => input.toString().endsWith(".glb"))).toBe(false);
    expect(bundle.scene.getMeshByName("body-bot-1")).not.toBeNull();
    expect(bundle.scene.meshes.some((mesh) => mesh.metadata?.visualModel)).toBe(false);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("selects all sky panoramas deterministically from the map seed", () => {
    expect([0, 1, 2, 3, -1].map(getSkyAssetId)).toEqual([
      "texture.sky.clearing",
      "texture.sky.overcast",
      "texture.sky.storm",
      "texture.sky.clearing",
      "texture.sky.clearing",
    ]);
  });

  it("keeps the clearing sky poles stable while lifting the sun into the upper hemisphere", async () => {
    const engine = new NullEngine();
    const assets = createAssets();
    const state = createBattleRoyaleState("player", undefined, () => 0);
    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
    );
    const sky = bundle.scene.getMeshByName("island-sky-dome");
    const positions = sky?.getVerticesData("position") ?? [];
    const uvs = sky?.getVerticesData("uv") ?? [];
    const verticalUvs = uvs.filter((_, index) => index % 2 === 1);
    const targetY = MAP_SIZE * 0.9 * Math.cos(Math.PI * 0.18);
    let targetVertex = 0;
    for (let index = 0; index < positions.length; index += 3) {
      if (Math.abs((positions[index + 1] ?? 0) - targetY) < Math.abs((positions[targetVertex + 1] ?? 0) - targetY)) {
        targetVertex = index;
      }
    }

    expect(getSkyAssetId(state.mapSeed)).toBe("texture.sky.clearing");
    expect(Math.min(...verticalUvs)).toBeCloseTo(0, 5);
    expect(Math.max(...verticalUvs)).toBeCloseTo(1, 5);
    expect(uvs[targetVertex / 3 * 2 + 1]).toBeCloseTo(0.3, 1);

    bundle.scene.dispose();
    engine.dispose();
  });
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
  ];
  return new AssetCatalog({
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
}

async function createGlbAssets(failedModelUrls: ReadonlySet<string> = new Set()): Promise<AssetCatalog> {
  const glb = createMinimalGlb();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "/manifest.json") {
      return Response.json({
        version: 1,
        assets: [
          { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
          { id: "fallback.model", type: "procedural-model", metadata: { color: "#cf4b3f" } },
          { id: "ui.crosshair", type: "svg", url: "/crosshair.svg", fallback: "fallback.ui" },
          { id: "ui.weapon.rifle", type: "svg", url: "/rifle.svg", fallback: "fallback.ui" },
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
          ].map((id) => ({ id, type: "svg", url: `/${id}.svg`, fallback: "fallback.ui" })),
          ...["player", "enemy"].flatMap((kind) => [
            {
              id: `model.character.${kind}`,
              type: "model",
              url: `/${kind}.glb`,
              fallback: "fallback.model",
              metadata: {
                requiredNodes: "root,weapon_socket,backpack_socket",
                armorMeshes: "armor",
                helmetMeshes: "helmet",
              },
            },
            {
              id: `model.character.${kind}.lod1`,
              type: "model",
              url: `/${kind}-lod1.glb`,
              fallback: "fallback.model",
              metadata: {
                requiredNodes: "root,weapon_socket,backpack_socket",
                armorMeshes: "armor",
                helmetMeshes: "helmet",
              },
            },
          ]),
          ...["rifle", "smg", "shotgun", "sniper"].flatMap((weaponId) => [
            {
              id: `model.weapon.${weaponId}`,
              type: "model",
              url: `/${weaponId}.glb`,
              fallback: "fallback.model",
              metadata: { requiredNodes: "root,grip,muzzle" },
            },
            {
              id: `model.weapon.${weaponId}.lod1`,
              type: "model",
              url: `/${weaponId}-lod1.glb`,
              fallback: "fallback.model",
              metadata: { requiredNodes: "root,grip,muzzle" },
            },
          ]),
        ],
      });
    }
    if (failedModelUrls.has(url)) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    if (url.endsWith(".glb")) {
      return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
    }
    if (url.endsWith(".svg")) {
      return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    }
    return new Response(null, { status: 404 });
  }));
  return AssetCatalog.load("/manifest.json");
}

function createProductionGlbAssets(): AssetCatalog {
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

function createMinimalGlb(): Uint8Array<ArrayBuffer> {
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", children: [1, 2, 3, 4, 5, 6, 7] },
      { name: "visual", mesh: 0 },
      { name: "weapon_socket", translation: [0.32, 0.9, 0.27] },
      { name: "backpack_socket", translation: [0, 1.08, -0.42] },
      { name: "grip", translation: [0, -0.14, -0.08] },
      { name: "muzzle", translation: [0, 0, 1.2] },
      { name: "armor", mesh: 0 },
      { name: "helmet", mesh: 0 },
    ],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  };
  const source = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const binaryLength = 36;
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const output = new Uint8Array(buffer);
  output.fill(0x20, 20);
  output.set(source, 20);
  const chunkOffset = 20 + jsonLength;
  view.setUint32(chunkOffset, binaryLength, true);
  view.setUint32(chunkOffset + 4, 0x004e4942, true);
  new Float32Array(buffer, chunkOffset + 8, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return output;
}
