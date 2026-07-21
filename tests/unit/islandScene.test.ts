import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import {
  applyActorVisualPose,
  createIslandScene,
  setActorEquipmentVisual,
  setActorWeaponVisual,
} from "../../src/client/render/scenes/IslandScene";
import { createMapLayout, getTerrainHeight, HOSPITAL_WALL_COLOR } from "../../src/config/map";
import { createBattleRoyaleState, createBattleRoyaleStateForHumans } from "../../src/game/modes/BattleRoyaleMode";
import { createWeaponState } from "../../src/game/state/types";
import { getSupportHeight } from "../../src/game/systems/MovementSystem";

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
      const expectedLootScale = showGroundLootModels ? 1.45 : 1;
      expect(engine.scenes).toHaveLength(1);
      expect(bundle.lootMeshes.size).toBe(Object.keys(state.groundLoot).length);
      expect([...bundle.lootMeshes.values()].every((mesh) =>
        mesh.isPickable
        && mesh.scaling.x === expectedLootScale
        && mesh.scaling.y === expectedLootScale
        && mesh.scaling.z === expectedLootScale
      )).toBe(true);
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
      const collisionMeshes = bundle.scene.meshes.filter((mesh) => mesh.metadata?.collision);
      const ground = bundle.scene.getMeshByName("island-ground");
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
      expect(treeFoliage.every((mesh) => mesh.getTotalVertices() < 160)).toBe(true);
      expect(hospitalCrosses).toHaveLength(1);
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
      expect(bundle.scene.meshes.filter((mesh) => mesh.name.startsWith("ocean-"))).toHaveLength(4);
      const floorMeshes = bundle.scene.meshes.filter(
        (mesh) =>
          mesh.name === "island-ground" ||
          mesh.name.startsWith("island-beach-") ||
          mesh.name.startsWith("island-wet-shore-") ||
          mesh.name.startsWith("ocean-"),
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
      const hospitalSlabs = layout.floorSlabs.filter((slab) => slab.obstacleId === layout.hospital.buildingId);
      const regularSlabs = layout.floorSlabs.filter((slab) => slab.obstacleId !== layout.hospital.buildingId);
      const slabBatch = bundle.scene.getMeshByName("building-slabs-batch");
      const hospitalSlabBatch = bundle.scene.getMeshByName("hospital-slabs-batch");
      expect(slabBatch?.metadata?.sourceCount).toBe(regularSlabs.length);
      expect(slabBatch?.getTotalVertices()).toBe(regularSlabs.length * 24);
      expect(hospitalSlabBatch?.metadata?.sourceCount).toBe(hospitalSlabs.length);
      expect(hospitalSlabBatch?.getTotalVertices()).toBe(hospitalSlabs.length * 24);
      expect(hospitalSlabBatch?.material).toBeInstanceOf(StandardMaterial);
      expect((hospitalSlabBatch?.material as StandardMaterial).diffuseColor.toHexString().toLowerCase()).toBe(
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
      bundle.syncSafeZoneRing(40, -30, 100);
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
      lootModelScale: 1.45,
      modelId: "weapon.rifle",
    });
    expect(marker.billboardMode).toBe(0);
    expect(marker.getTotalVertices()).toBeGreaterThan(24);
    expect(marker.getChildMeshes()).toHaveLength(0);
    expect(bundle.lootMeshes.size).toBe(Object.keys(state.groundLoot).length);
    expect(bundle.scene.meshes.filter((mesh) => mesh.name.startsWith("loot-model-template-"))).toHaveLength(15);
    expect(bundle.scene.materials.filter((entry) => entry.name.startsWith("loot-model-material-"))).toHaveLength(14);
    const secondRifle = [...bundle.lootMeshes.values()].find((candidate) =>
      candidate !== marker && candidate.metadata?.itemId === "weapon.rifle"
    );
    expect(secondRifle?.geometry).toBe(rifleGeometry);
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
    );

    expect(bundle.scene.getMeshByName("body-human-1")).toBeNull();
    expect(bundle.scene.getMeshByName("body-human-2")).not.toBeNull();
    expect(bundle.actorRoots.get("human-2")?.getChildMeshes(false)
      .some((mesh) => mesh.metadata?.actorVisual === "parachute")).toBe(true);

    bundle.scene.dispose();
    engine.dispose();
  }, 30_000);

  it("loads and switches all three catalog weapon models for first and third person", async () => {
    const assets = await createGlbAssets();
    const state = createBattleRoyaleState("player", {
      participantCount: 2,
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
    if (!botRoot) throw new Error("test bot root missing");
    const viewMeshes = bundle.viewWeaponRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.actorVisual === "weapon");
    const botMeshes = botRoot.getChildMeshes(false)
      .filter((mesh) => mesh.metadata?.actorVisual === "weapon");

    for (const weaponId of ["rifle", "smg", "shotgun", "sniper"] as const) {
      expect(viewMeshes.some((mesh) => mesh.metadata?.visualModel === `model.weapon.${weaponId}`)).toBe(true);
      expect(botMeshes.some((mesh) => mesh.metadata?.visualModel === `model.weapon.${weaponId}`)).toBe(true);
    }
    expect(botMeshes.some((mesh) => mesh.metadata?.visualModel === "model.character.enemy")).toBe(false);
    expect(botRoot.getChildMeshes(false).filter((mesh) => mesh.metadata?.actorVisual === "parachute")
      .every((mesh) => mesh.isEnabled(false))).toBe(true);
    expect(botMeshes.filter((mesh) => mesh.metadata?.weaponId === "smg" && mesh.metadata?.visualModel)
      .every((mesh) => mesh.isEnabled(false))).toBe(true);
    setActorWeaponVisual(bundle.viewWeaponRoot, "shotgun");
    expect(viewMeshes.filter((mesh) => mesh.metadata?.visualModel === "model.weapon.shotgun")
      .every((mesh) => mesh.isEnabled(false))).toBe(true);
    expect(viewMeshes.filter((mesh) => mesh.metadata?.visualModel && mesh.metadata?.weaponId !== "shotgun")
      .every((mesh) => !mesh.isEnabled(false))).toBe(true);
    expect(viewMeshes.filter((mesh) => mesh.metadata?.weaponFallbackSuppressed === true)
      .every((mesh) => !mesh.isEnabled(false))).toBe(true);

    bundle.scene.dispose();
    expect(engine.scenes).toHaveLength(0);
    engine.dispose();
  }, 30_000);
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
  return new AssetCatalog({
    version: 1,
    assets: [
      { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
      { id: "fallback.model", type: "procedural-model", metadata: { color: "#cf4b3f" } },
      { id: "ui.crosshair", type: "svg", url: "/crosshair.svg", fallback: "fallback.ui" },
      ...iconAssetIds.map((id) => ({ id, type: "svg" as const, url: `/${id}.svg`, fallback: "fallback.ui" })),
      { id: "model.character.player", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#809d5e" } },
      { id: "model.character.enemy", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#bd6357" } },
      { id: "model.weapon.rifle", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#283126" } },
      { id: "model.weapon.smg", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#263838" } },
      { id: "model.weapon.shotgun", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#3b3028" } },
      { id: "model.weapon.sniper", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#354238" } },
    ],
  });
}

async function createGlbAssets(): Promise<AssetCatalog> {
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
          { id: "model.character.player", type: "procedural-model", fallback: "fallback.model" },
          { id: "model.character.enemy", type: "model", url: "/enemy.glb", fallback: "fallback.model" },
          ...["rifle", "smg", "shotgun", "sniper"].map((weaponId) => ({
            id: `model.weapon.${weaponId}`,
            type: "model",
            url: `/${weaponId}.glb`,
            fallback: "fallback.model",
          })),
        ],
      });
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

function createMinimalGlb(): Uint8Array<ArrayBuffer> {
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "root", mesh: 0 }],
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
