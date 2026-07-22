import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { BackgroundMaterial } from "@babylonjs/core/Materials/Background/backgroundMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../../assets/AssetCatalog";
import type { AssetEntry } from "../../../assets/types";
import { ITEMS } from "../../../config/items";
import {
  createMapRoadSegments,
  createMapLayout,
  getTerrainHeight,
  HOSPITAL_WALL_COLOR,
  MAP_SIZE,
  TERRAIN_GRID_SUBDIVISIONS,
  type MapLayout,
  type MapWallOpening,
} from "../../../config/map";
import { getActiveWeapon, type ActorState, type EntityId, type FlightState, type GroundLootState } from "../../../game/state/types";
import { QUALITY_PROFILES, type QualityLevel, type QualityProfile } from "../../../config/settings";
import { syncLootMarkerViews, type LootMarkerViewAdapter } from "../LootMarkerViewAdapter";
import { loadCatalogModel } from "../loadCatalogModel";
import { getPoiVisualType } from "../../poiVisuals";

const INITIAL_SAFE_ZONE_RADIUS = MAP_SIZE * 0.36;
const SKY_ASSET_IDS = ["texture.sky.clearing", "texture.sky.overcast", "texture.sky.storm"] as const;
const TERRAIN_PATCHES: ReadonlyArray<readonly [number, number, number, number, number, "mud" | "grass"]> = [
  [-620, -380, 184, 116, 0.2, "grass"],
  [-520, 168, 144, 84, -0.45, "mud"],
  [-236, 556, 208, 108, 0.14, "grass"],
  [84, 568, 164, 88, -0.28, "mud"],
  [496, 448, 220, 124, 0.32, "grass"],
  [620, 184, 148, 96, -0.52, "mud"],
  [584, -208, 184, 104, 0.22, "grass"],
  [496, -572, 224, 112, -0.16, "mud"],
  [144, -612, 176, 100, 0.42, "grass"],
  [-164, -516, 216, 128, -0.22, "mud"],
  [-572, -612, 156, 92, 0.31, "grass"],
  [-664, 36, 152, 104, -0.12, "mud"],
  [-96, 84, 188, 116, 0.38, "grass"],
  [164, -108, 140, 84, -0.35, "mud"],
  [644, 660, 128, 76, 0.18, "grass"],
  [-660, 644, 172, 96, -0.28, "mud"],
];
const TERRAIN_COLORS = {
  ground: Color3.FromHexString("#5f704f"),
  highland: Color3.FromHexString("#4c5943"),
  mud: Color3.FromHexString("#756548"),
  grass: Color3.FromHexString("#71805a"),
  roadShoulder: Color3.FromHexString("#746b52"),
  paving: Color3.FromHexString("#64645b"),
  road: Color3.FromHexString("#4b504b"),
  poiAccent: Color3.FromHexString("#a37848"),
  poiDark: Color3.FromHexString("#434b4f"),
} as const;
type WeaponPiece = readonly [string, "body" | "gear" | "barrel", number, number, number, number, number, number, number?];
type WeaponVisualId = "rifle" | "smg" | "shotgun" | "sniper";

interface IslandMaterials {
  ground: MultiMaterial;
  wallTexture: Texture | null;
  beach: StandardMaterial;
  shoreWet: StandardMaterial;
  roadShoulder: StandardMaterial;
  trunk: StandardMaterial;
  foliage: StandardMaterial;
  shrub: StandardMaterial;
  rock: StandardMaterial;
  fence: StandardMaterial;
  hay: StandardMaterial;
  poiAccent: StandardMaterial;
  poiDark: StandardMaterial;
  floor: StandardMaterial;
  roof: StandardMaterial;
  hospitalCeiling: StandardMaterial;
  wallTrim: StandardMaterial;
  hospitalCross: StandardMaterial;
  window: StandardMaterial;
  door: StandardMaterial;
  botBody: StandardMaterial;
  actorArmor: StandardMaterial;
  playerHitbox: StandardMaterial;
  gear: StandardMaterial;
  weaponRifle: StandardMaterial;
  weaponSmg: StandardMaterial;
  weaponShotgun: StandardMaterial;
  weaponSniper: StandardMaterial;
  loot: StandardMaterial;
  deathLoot: StandardMaterial;
  safeZone: StandardMaterial;
  aircraftTrail: StandardMaterial;
}

export interface IslandSceneBundle {
  scene: Scene;
  camera: UniversalCamera;
  actorRoots: Map<EntityId, TransformNode>;
  actorVisualRoots: Map<EntityId, TransformNode>;
  lootMeshes: Map<EntityId, Mesh>;
  syncLootMeshes: (groundLoot: Readonly<Record<EntityId, GroundLootState>>) => void;
  viewWeaponRoot: TransformNode;
  aircraftInteriorRoot: TransformNode;
  aircraftVisualRoot: TransformNode;
  syncAircraftVisual: (flight: FlightState, visible: boolean) => void;
  safeZoneRing: Mesh;
  syncSafeZoneRing: (centerX: number, centerZ: number, radius: number) => void;
}

export async function createIslandScene(
  engine: Engine,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  mapSeed = 0,
  showGroundLootModels = true,
  localActorId?: EntityId,
  quality: QualityLevel = "high",
): Promise<IslandSceneBundle> {
  const player = (localActorId ? actors[localActorId] : undefined) ??
    Object.values(actors).find((actor) => actor.kind === "player");
  if (!player) {
    throw new Error("Island scene requires one player actor");
  }
  const layout = createMapLayout(mapSeed);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.36, 0.44, 0.46, 1);
  scene.collisionsEnabled = true;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = MAP_SIZE * 0.65;
  scene.fogEnd = MAP_SIZE * 1.1;
  scene.fogColor = new Color3(0.46, 0.53, 0.53);
  scene.skipPointerMovePicking = true;

  const ambient = new HemisphericLight("island-ambient", new Vector3(0.2, 1, 0.12), scene);
  ambient.intensity = 0.74;
  ambient.diffuse = new Color3(0.78, 0.82, 0.72);
  ambient.groundColor = new Color3(0.16, 0.2, 0.18);

  const sun = new DirectionalLight("island-sun", new Vector3(-0.55, -1, 0.35), scene);
  sun.position = new Vector3(180, 260, -140);
  sun.intensity = 0.98;
  sun.diffuse = new Color3(0.94, 0.88, 0.73);
  sun.specular = new Color3(0.42, 0.46, 0.43);

  const materials = createMaterials(scene, assets);
  createSkyDome(scene, assets, mapSeed);
  const qualityProfile = QUALITY_PROFILES[quality];
  createIslandEnvironment(scene, materials, layout, qualityProfile);
  createPois(scene, materials, layout);

  const { actorRoots, actorVisualRoots } = createActors(scene, actors, materials, player.id);
  const camera = createCamera(scene, player);
  const aircraftInteriorRoot = createAircraftInterior(scene, camera, materials);
  aircraftInteriorRoot.setEnabled(player.deployment === "aircraft");
  const aircraftVisualRoot = createAircraftVisual(scene, materials);
  aircraftVisualRoot.setEnabled(false);
  const syncAircraftVisual = (flight: FlightState, visible: boolean): void => {
    const progress = Math.max(0, Math.min(1, flight.progress));
    const x = lerp(flight.start.x, flight.end.x, progress);
    const y = lerp(flight.start.y, flight.end.y, progress);
    const z = lerp(flight.start.z, flight.end.z, progress);
    if (!aircraftVisualRoot.position.equalsToFloats(x, y, z)) aircraftVisualRoot.position.set(x, y, z);
    const yaw = Math.atan2(flight.end.x - flight.start.x, flight.end.z - flight.start.z);
    if (aircraftVisualRoot.rotation.y !== yaw) aircraftVisualRoot.rotation.y = yaw;
    const enabled = visible && progress < 1;
    if (aircraftVisualRoot.isEnabled() !== enabled) aircraftVisualRoot.setEnabled(enabled);
  };
  const viewWeaponRoot = createViewWeapon(scene, camera, materials);
  setActorWeaponVisual(viewWeaponRoot, getActiveWeapon(player)?.weaponId ?? null);
  viewWeaponRoot.setEnabled(Boolean(getActiveWeapon(player)));
  if (quality !== "low") {
    await replaceCatalogModels(
      scene,
      camera,
      assets,
      actors,
      actorRoots,
      actorVisualRoots,
      player.id,
      qualityProfile.modelLodDistance,
    );
  }

  const { lootMeshes, syncLootMeshes } = createLootMeshes(
    scene,
    groundLoot,
    materials.loot,
    materials.deathLoot,
    showGroundLootModels,
  );
  const { mesh: safeZoneRing, sync: syncSafeZoneRing } = createSafeZoneRing(scene, materials.safeZone, layout);

  return {
    scene,
    camera,
    actorRoots,
    actorVisualRoots,
    lootMeshes,
    syncLootMeshes,
    viewWeaponRoot,
    aircraftInteriorRoot,
    aircraftVisualRoot,
    syncAircraftVisual,
    safeZoneRing,
    syncSafeZoneRing,
  };
}

export function getSkyAssetId(mapSeed: number): (typeof SKY_ASSET_IDS)[number] {
  return SKY_ASSET_IDS[(mapSeed >>> 0) % SKY_ASSET_IDS.length] ?? SKY_ASSET_IDS[0];
}

async function replaceCatalogModels(
  scene: Scene,
  camera: UniversalCamera,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  actorRoots: Map<EntityId, TransformNode>,
  actorVisualRoots: Map<EntityId, TransformNode>,
  localActorId: EntityId,
  modelLodDistance: number,
): Promise<void> {
  const characterIds = ["player", "enemy"] as const;
  const requiredCharacterIds = characterIds.filter((kind) => Object.values(actors).some((actor) =>
    actor.id !== localActorId && (actor.kind === "player" ? "player" : "enemy") === kind
  ));
  const loadIfDeclared = (assetId: string) => assets.has(assetId)
    ? loadCatalogModel(scene, assets, assetId)
    : Promise.resolve(null);
  const loadedCharacters = await Promise.all(requiredCharacterIds.flatMap((kind) => [
    loadIfDeclared(`model.character.${kind}`),
    loadIfDeclared(`model.character.${kind}.lod1`),
  ]));
  const characterModels = new Map(requiredCharacterIds.map((kind, index) => [kind, {
    base: loadedCharacters[index * 2] ?? null,
    lod1: loadedCharacters[index * 2 + 1] ?? null,
  }]));
  const loadedContainers = loadedCharacters
    .flatMap((loaded) => loaded ? [loaded.container] : []);

  const actorLods: Array<{
    actorRoot: TransformNode;
    base: TransformNode | null;
    lod1: TransformNode | null;
  }> = [];
  for (const actor of Object.values(actors)) {
    if (actor.id === localActorId) continue;
    const actorRoot = actorRoots.get(actor.id);
    const visualRoot = actorVisualRoots.get(actor.id);
    if (!actorRoot || !visualRoot) continue;
    const kind = actor.kind === "player" ? "player" : "enemy";
    const character = characterModels.get(kind);
    if (!character?.base) continue;
    const base = instantiateCharacterModel(scene, character.base, actor, visualRoot, "base");
    if (!base) continue;
    const lod1 = character.lod1
      ? instantiateCharacterModel(scene, character.lod1, actor, visualRoot, "lod1")
      : null;
    suppressProceduralCharacter(actorRoot);
    const visuals = [base, lod1].filter((visual): visual is ImportedCharacterVisual => visual !== null);
    suppressProceduralEquipment(actorRoot, visuals);
    setActorWeaponVisual(actorRoot, getActiveWeapon(actor)?.weaponId ?? null);
    setActorEquipmentVisual(actorRoot, actor.inventory.armorLevel, actor.inventory.helmetLevel);
    actorLods.push({ actorRoot, base: base?.group ?? null, lod1: lod1?.group ?? null });
  }

  const lodDistanceSquared = modelLodDistance * modelLodDistance;
  const updateModelLods = (): void => {
    const cameraPosition = camera.globalPosition;
    for (const visual of actorLods) {
      const useLod1 = Boolean(
        visual.base &&
        visual.lod1 &&
        Vector3.DistanceSquared(cameraPosition, visual.actorRoot.getAbsolutePosition()) > lodDistanceSquared
      );
      const baseEnabled = !visual.lod1 || !useLod1;
      const lod1Enabled = !visual.base || useLod1;
      if (visual.base && visual.base.isEnabled() !== baseEnabled) visual.base.setEnabled(baseEnabled);
      if (visual.lod1 && visual.lod1.isEnabled() !== lod1Enabled) visual.lod1.setEnabled(lod1Enabled);
    }
  };
  updateModelLods();
  const lodObserver = actorLods.length > 0 ? scene.onBeforeRenderObservable.add(updateModelLods) : null;
  scene.onDisposeObservable.addOnce(() => {
    if (lodObserver) scene.onBeforeRenderObservable.remove(lodObserver);
    actorLods.length = 0;
    for (const container of loadedContainers) container.dispose();
  });
}

type LoadedCatalogModel = NonNullable<Awaited<ReturnType<typeof loadCatalogModel>>>;

interface ImportedCharacterVisual {
  group: TransformNode;
  weaponSocket: TransformNode;
  lod: "base" | "lod1";
  hasArmor: boolean;
  hasHelmet: boolean;
}

function instantiateCharacterModel(
  scene: Scene,
  loaded: LoadedCatalogModel,
  actor: ActorState,
  visualRoot: TransformNode,
  lod: "base" | "lod1",
): ImportedCharacterVisual | null {
  const instance = loaded.container.instantiateModelsToScene((name) => `${actor.id}-${lod}-${name}`);
  const group = new TransformNode(`${actor.id}-character-${lod}`, scene);
  group.parent = visualRoot;
  group.metadata = { visualModel: loaded.descriptor.id, modelLod: lod };
  attachModel(instance.rootNodes, group, loaded.descriptor);
  const weaponSocket = findImportedNode(instance.rootNodes, "weapon_socket");
  if (!weaponSocket) {
    group.dispose();
    return null;
  }
  const armorMeshes = metadataNames(loaded.descriptor, "armorMeshes");
  const helmetMeshes = metadataNames(loaded.descriptor, "helmetMeshes");
  let hasArmor = false;
  let hasHelmet = false;
  for (const mesh of group.getChildMeshes(false)) {
    const actorVisual = matchesImportedName(mesh.name, armorMeshes)
      ? "vest"
      : matchesImportedName(mesh.name, helmetMeshes)
        ? "helmet"
        : undefined;
    if (actorVisual === "vest") hasArmor = true;
    if (actorVisual === "helmet") hasHelmet = true;
    mesh.metadata = {
      ...mesh.metadata,
      actorId: actor.id,
      modelLod: lod,
      ...(actorVisual ? { actorVisual } : {}),
    };
  }
  return { group, weaponSocket, lod, hasArmor, hasHelmet };
}

function findImportedNode(nodes: readonly Node[], name: string): TransformNode | null {
  for (const root of nodes) {
    const candidates = [root, ...root.getDescendants(false)];
    const match = candidates.find((node) => node.name === name || node.name.endsWith(`-${name}`));
    if (match instanceof TransformNode) return match;
  }
  return null;
}

function suppressProceduralCharacter(root: TransformNode): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.visualModel) continue;
    if (!["weapon", "parachute", "vest", "helmet"].includes(mesh.metadata?.actorVisual)) {
      mesh.setEnabled(false);
    }
  }
}

function suppressProceduralEquipment(
  root: TransformNode,
  visuals: readonly ImportedCharacterVisual[],
): void {
  const hasArmor = visuals.some((visual) => visual.hasArmor);
  const hasHelmet = visuals.some((visual) => visual.hasHelmet);
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.visualModel) continue;
    if ((mesh.metadata?.actorVisual === "vest" && hasArmor) ||
      (mesh.metadata?.actorVisual === "helmet" && hasHelmet)) {
      mesh.metadata = { ...mesh.metadata, equipmentFallbackSuppressed: true };
      mesh.setEnabled(false);
    }
  }
}

function attachModel(
  nodes: readonly Node[],
  parent: TransformNode | UniversalCamera,
  descriptor: AssetEntry,
): void {
  const scale = numberMetadata(descriptor, "scale", 1);
  const x = numberMetadata(descriptor, "offsetX", 0);
  const y = numberMetadata(descriptor, "offsetY", -1.76);
  const z = numberMetadata(descriptor, "offsetZ", 0);
  for (const node of nodes) {
    if (!(node instanceof TransformNode)) continue;
    node.parent = parent;
    node.position.set(x, y, z);
    node.scaling.scaleInPlace(scale);
    const meshes = node instanceof Mesh ? [node, ...node.getChildMeshes()] : node.getChildMeshes();
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.metadata = { visualModel: descriptor.id };
    }
  }
}

function numberMetadata(descriptor: AssetEntry, name: string, fallback: number): number {
  const value = descriptor.metadata?.[name];
  return typeof value === "number" ? value : fallback;
}

function metadataNames(descriptor: AssetEntry, name: string): string[] {
  const value = descriptor.metadata?.[name];
  return typeof value === "string"
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function matchesImportedName(actualName: string, expectedNames: readonly string[]): boolean {
  return expectedNames.some((expected) => actualName === expected || actualName.endsWith(`-${expected}`));
}

function createMaterials(scene: Scene, assets: AssetCatalog): IslandMaterials {
  const playerColor = assetColor(assets, "model.character.player", "model", "#809d5e");
  const botColor = assetColor(assets, "model.character.enemy", "model", "#bd6357");
  const rifleColor = assetColor(assets, "model.weapon.rifle", "model", "#283126");
  const smgColor = assetColor(assets, "model.weapon.smg", "model", "#263838");
  const shotgunColor = assetColor(assets, "model.weapon.shotgun", "model", "#3b3028");
  const sniperColor = assetColor(assets, "model.weapon.sniper", "model", "#354238");
  const hudColor = assetColor(assets, "ui.crosshair", "svg", "#74d9cb");
  const lootColor = assetColor(assets, "ui.weapon.rifle", "svg", "#e2c66d");

  const windowMaterial = material(scene, "building-window-material", "#26383b");
  windowMaterial.emissiveColor = new Color3(0.025, 0.035, 0.034);

  const playerHitbox = material(scene, "player-hitbox-material", playerColor);
  playerHitbox.alpha = 0.001;

  const loot = material(scene, "loot-marker-material", lootColor);
  loot.emissiveColor = Color3.FromHexString(lootColor).scale(0.48);
  const deathLoot = material(scene, "death-loot-marker-material", "#f06445");
  deathLoot.emissiveColor = Color3.FromHexString("#f06445").scale(0.62);

  const safeZone = material(scene, "safe-zone-material", hudColor);
  safeZone.emissiveColor = Color3.FromHexString(hudColor);
  safeZone.disableLighting = true;
  safeZone.alpha = 0.9;
  safeZone.backFaceCulling = false;
  const aircraftTrail = material(scene, "aircraft-trail-material", "#dfe8de");
  aircraftTrail.emissiveColor = Color3.FromHexString("#dfe8de").scale(0.7);
  aircraftTrail.disableLighting = true;
  aircraftTrail.alpha = 0.16;

  const groundGrass = texturedMaterial(
    scene,
    assets,
    "island-ground-grass-material",
    "#ffffff",
    "texture.terrain.grass",
    MAP_SIZE / 24,
  );
  const groundMud = texturedMaterial(
    scene,
    assets,
    "island-ground-mud-material",
    "#ffffff",
    "texture.terrain.mud",
    MAP_SIZE / 24,
  );
  const groundRoad = texturedMaterial(
    scene,
    assets,
    "island-ground-road-material",
    "#ffffff",
    "texture.road",
    MAP_SIZE / 18,
  );
  const ground = new MultiMaterial("island-ground-material", scene);
  ground.subMaterials = [groundGrass, groundMud, groundRoad];
  const roadShoulder = material(scene, "road-shoulder-material", "#746b52");
  const wallTexture = catalogTexture(scene, assets, "texture.building.wall", 2.5);

  return {
    ground,
    wallTexture,
    beach: material(scene, "island-beach-material", "#a99b70"),
    shoreWet: material(scene, "island-wet-shore-material", "#746f59"),
    roadShoulder,
    trunk: material(scene, "tree-trunk-material", "#5d4b38"),
    foliage: material(scene, "tree-foliage-material", "#34533a"),
    shrub: material(scene, "shrub-material", "#496545"),
    rock: material(scene, "rock-material", "#65685e"),
    fence: material(scene, "fence-material", "#655443"),
    hay: material(scene, "hay-material", "#a28a4f"),
    poiAccent: material(scene, "poi-accent-material", "#a37848"),
    poiDark: material(scene, "poi-dark-material", "#434b4f"),
    floor: material(scene, "building-floor-material", "#343b3b"),
    roof: texturedMaterial(scene, assets, "building-roof-material", "#69706d", "texture.building.roof", 2),
    hospitalCeiling: material(scene, "hospital-ceiling-material", HOSPITAL_WALL_COLOR),
    wallTrim: material(scene, "building-trim-material", "#8a8069"),
    hospitalCross: material(scene, "hospital-cross-material", "#d8473f"),
    window: windowMaterial,
    door: material(scene, "building-door-material", "#4c3d31"),
    botBody: material(scene, "bot-body-material", botColor),
    actorArmor: material(scene, "actor-armor-material", "#465248"),
    playerHitbox,
    gear: material(scene, "actor-gear-material", "#252d2b"),
    weaponRifle: material(scene, "weapon-rifle-material", rifleColor),
    weaponSmg: material(scene, "weapon-smg-material", smgColor),
    weaponShotgun: material(scene, "weapon-shotgun-material", shotgunColor),
    weaponSniper: material(scene, "weapon-sniper-material", sniperColor),
    loot,
    deathLoot,
    safeZone,
    aircraftTrail,
  };
}

function createIslandEnvironment(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
  quality: QualityProfile,
): void {
  createIslandPerimeter(scene, materials);

  const ground = CreateGround(
    "island-ground",
    { width: MAP_SIZE, height: MAP_SIZE, subdivisions: TERRAIN_GRID_SUBDIVISIONS, updatable: true },
    scene,
  );
  applyTerrainSurface(ground, layout, materials.ground);
  ground.material = materials.ground;
  markEnvironment(ground, "island-ground");

  const buildingMaterials = new Map<string, StandardMaterial>();
  const buildingWallMeshes = new Map<string, Mesh[]>();
  const doorSillIds = new Set(
    layout.wallOpenings
      .filter((opening) => opening.kind === "door")
      .map((opening) => `${opening.obstacleId}-wall-${opening.side}-${opening.storyIndex}-sill`),
  );
  for (const wall of layout.wallSegments) {
    if (doorSillIds.has(wall.id)) continue;
    let buildingMaterial = buildingMaterials.get(wall.color);
    if (!buildingMaterial) {
      buildingMaterial = material(scene, `building-material-${buildingMaterials.size}`, wall.color);
      buildingMaterial.diffuseTexture = materials.wallTexture;
      buildingMaterials.set(wall.color, buildingMaterial);
    }

    const wallMesh = CreateBox(
      wall.id,
      { width: wall.width, height: wall.height, depth: wall.depth },
      scene,
    );
    wallMesh.position.set(wall.center.x, wall.center.y, wall.center.z);
    wallMesh.material = buildingMaterial;
    const meshes = buildingWallMeshes.get(wall.color);
    if (meshes) meshes.push(wallMesh);
    else buildingWallMeshes.set(wall.color, [wallMesh]);
  }
  for (const [color, meshes] of buildingWallMeshes) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) throw new Error(`Unable to merge building walls for ${color}`);
    merged.name = `building-walls-${color.replace("#", "")}`;
    merged.material = buildingMaterials.get(color) ?? null;
    markEnvironment(merged, `building-walls-${color}`);
    merged.metadata = { ...merged.metadata, sourceCount: meshes.length };
  }

  createHospitalCross(scene, materials.hospitalCross, layout);

  createBuildingDetails(scene, materials, layout);
  createRoofRamps(scene, materials, layout);
  createCoverProps(scene, materials, layout);
  createVegetation(scene, materials.trunk, materials.foliage, layout, quality);
  createNaturalDetails(scene, materials.rock, materials.shrub, layout, quality);
  mergeStaticBatch(
    scene,
    "building-floor-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      mesh.metadata?.detailType === "floor" &&
      mesh.metadata?.obstacleId !== layout.hospital.buildingId,
    { decoration: "building-detail", detailType: "floor-slabs" },
  );
  mergeStaticBatch(
    scene,
    "building-roof-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      mesh.metadata?.detailType === "roof",
    { decoration: "building-detail", detailType: "roof-slabs" },
  );
  mergeStaticBatch(
    scene,
    "hospital-floor-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      mesh.metadata?.detailType === "floor" &&
      mesh.metadata?.obstacleId === layout.hospital.buildingId,
    {
      decoration: "building-detail",
      detailType: "hospital-floor-slabs",
      obstacleId: layout.hospital.buildingId,
    },
  );
  mergeStaticBatch(
    scene,
    "building-openings-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      (mesh.metadata?.detailType === "door" || mesh.metadata?.detailType === "window"),
    { decoration: "building-detail", detailType: "openings" },
  );
  mergeStaticBatch(
    scene,
    "building-ramps-batch",
    (mesh) => mesh.metadata?.decoration === "roof-ramp",
    { decoration: "roof-ramp" },
  );
  mergeStaticBatch(
    scene,
    "fence-cover-batch",
    (mesh) => mesh.metadata?.decoration === "cover-prop" && mesh.metadata?.coverKind === "fence",
    { decoration: "cover-prop", coverKind: "fence" },
  );
  mergeStaticBatch(
    scene,
    "hay-cover-batch",
    (mesh) => mesh.metadata?.decoration === "cover-prop" && mesh.metadata?.coverKind === "hay",
    { decoration: "cover-prop", coverKind: "hay" },
  );
}

function createSkyDome(scene: Scene, assets: AssetCatalog, mapSeed: number): void {
  const assetId = getSkyAssetId(mapSeed);
  const descriptor = assets.resolve(assetId, "image");
  if (descriptor.id !== assetId || !descriptor.url) return;

  const texture = new Texture(descriptor.url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = assetId;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1;

  const skyMaterial = new BackgroundMaterial("island-sky-material", scene);
  skyMaterial.disableDepthWrite = true;
  skyMaterial.primaryColor = Color3.White();
  skyMaterial.diffuseTexture = texture;
  skyMaterial.useEquirectangularFOV = true;
  skyMaterial.fovMultiplier = 1;
  skyMaterial.opacityFresnel = false;

  const sky = CreateSphere(
    "island-sky-dome",
    { diameter: MAP_SIZE * 1.8, segments: 32, sideOrientation: Mesh.BACKSIDE, updatable: assetId === "texture.sky.clearing" },
    scene,
  );
  if (assetId === "texture.sky.clearing") remapClearingSkyUvs(sky);
  sky.material = skyMaterial;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.checkCollisions = false;
  sky.applyFog = false;
  sky.metadata = { decoration: "sky", skyAssetId: assetId };
}

function remapClearingSkyUvs(sky: Mesh): void {
  const uvs = sky.getVerticesData(VertexBuffer.UVKind);
  if (!uvs) return;
  for (let index = 1; index < uvs.length; index += 2) {
    const viewV = uvs[index] ?? 0;
    uvs[index] = viewV <= 0.18
      ? viewV / 0.18 * 0.3
      : viewV <= 0.5
        ? 0.3 + (viewV - 0.18) / 0.32 * 0.32
        : 0.62 + (viewV - 0.5) / 0.5 * 0.38;
  }
  sky.updateVerticesData(VertexBuffer.UVKind, uvs);
}

function createHospitalCross(scene: Scene, crossMaterial: StandardMaterial, layout: MapLayout): void {
  const hospital = layout.obstacles.find((building) => building.id === layout.hospital.buildingId);
  if (!hospital) throw new Error("Hospital building missing from scene layout");
  const x = hospital.center.x + hospital.width * 0.27;
  const y = hospital.baseY + hospital.storyHeight * 1.5;
  const z = hospital.center.z - hospital.depth / 2 - 0.04;
  const vertical = CreateBox("hospital-cross-vertical", { width: 0.72, height: 2.8, depth: 0.12 }, scene);
  const horizontal = CreateBox("hospital-cross-horizontal", { width: 2.4, height: 0.72, depth: 0.12 }, scene);
  vertical.position.set(x, y, z);
  horizontal.position.set(x, y, z);
  vertical.material = crossMaterial;
  horizontal.material = crossMaterial;
  const cross = Mesh.MergeMeshes([vertical, horizontal], true, true);
  if (!cross) throw new Error("Unable to merge hospital cross");
  cross.name = "hospital-medical-cross";
  cross.material = crossMaterial;
  cross.checkCollisions = false;
  cross.isPickable = false;
  cross.metadata = {
    decoration: "hospital-cross",
    poiName: layout.hospital.name,
    poiType: "hospital",
    obstacleId: hospital.id,
  };
  cross.freezeWorldMatrix();
}

function mergeStaticBatch(
  scene: Scene,
  name: string,
  predicate: (mesh: Mesh) => boolean,
  metadata: Record<string, unknown>,
): void {
  const meshes = scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && predicate(mesh));
  if (meshes.length === 0) return;
  const material = meshes[0]?.material ?? null;
  const merged = Mesh.MergeMeshes(meshes, true, true);
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.name = name;
  merged.material = material;
  merged.checkCollisions = false;
  merged.isPickable = false;
  merged.metadata = { ...metadata, sourceCount: meshes.length };
  merged.freezeWorldMatrix();
}

function applyTerrainSurface(ground: Mesh, layout: MapLayout, groundMaterial: MultiMaterial): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const colors: number[] = [];
  const surfaceKinds: TerrainSurfaceKind[] = [];
  const roadSegments = createMapRoadSegments(layout.landingZones);
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const z = positions[index + 2] ?? 0;
    const height = getTerrainHeight(x, z, layout);
    const surface = getTerrainSurface(x, z, height, layout.seed, layout.mapPoints, roadSegments);
    positions[index + 1] = height;
    const materialIndex = terrainMaterialIndex(surface.kind);
    const surfaceMaterial = groundMaterial.subMaterials[materialIndex];
    const color = surfaceMaterial instanceof StandardMaterial && surfaceMaterial.diffuseTexture
      ? surface.textureTint
      : surface.color;
    colors.push(color.r, color.g, color.b, 1);
    surfaceKinds.push(surface.kind);
  }
  const indices = ground.getIndices();
  if (!indices) return;
  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  const surfaceIndices: number[][] = [[], [], []];
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const triangle = [indices[index] ?? 0, indices[index + 1] ?? 0, indices[index + 2] ?? 0];
    const kinds = triangle.map((vertexIndex) => surfaceKinds[vertexIndex] ?? "grass");
    const materialIndex = kinds.includes("road") ? 2 : kinds.includes("mud") ? 1 : 0;
    surfaceIndices[materialIndex]?.push(...triangle);
  }
  const groupedIndices = surfaceIndices.flat();
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  ground.setIndices(groupedIndices);
  ground.subMeshes = [];
  let indexStart = 0;
  surfaceIndices.forEach((surface, materialIndex) => {
    if (surface.length === 0) return;
    new SubMesh(materialIndex, 0, positions.length / 3, indexStart, surface.length, ground);
    indexStart += surface.length;
  });
  ground.useVertexColors = true;
  ground.refreshBoundingInfo();
  ground.freezeWorldMatrix();
}

function createIslandPerimeter(scene: Scene, materials: IslandMaterials): void {
  const islandHalfSize = MAP_SIZE / 2;
  createSquareBand(scene, "island-beach", islandHalfSize, islandHalfSize + 10, -0.28, materials.beach);
  createSquareBand(scene, "island-wet-shore", islandHalfSize + 10, islandHalfSize + 20, -0.34, materials.shoreWet);
}

function createSquareBand(
  scene: Scene,
  name: string,
  innerHalfSize: number,
  outerHalfSize: number,
  y: number,
  bandMaterial: StandardMaterial,
): void {
  const thickness = outerHalfSize - innerHalfSize;
  const bands: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, -innerHalfSize - thickness / 2, outerHalfSize * 2, thickness],
    [0, innerHalfSize + thickness / 2, outerHalfSize * 2, thickness],
    [-innerHalfSize - thickness / 2, 0, thickness, innerHalfSize * 2],
    [innerHalfSize + thickness / 2, 0, thickness, innerHalfSize * 2],
  ];
  bands.forEach(([x, z, width, height], index) => {
    const band = CreateGround(`${name}-${index}`, { width, height }, scene);
    band.position.set(x, y, z);
    band.material = bandMaterial;
    markDecoration(band, name);
  });
}

type TerrainSurfaceKind = "grass" | "mud" | "road";

function terrainMaterialIndex(kind: TerrainSurfaceKind): number {
  return kind === "road" ? 2 : kind === "mud" ? 1 : 0;
}

function getTerrainSurface(
  x: number,
  z: number,
  height: number,
  seed: number,
  mapPoints: MapLayout["mapPoints"],
  roadSegments: ReadonlyArray<readonly [number, number, number, number]>,
): { color: Color3; textureTint: Color3; kind: TerrainSurfaceKind } {
  let color = height > 4 ? TERRAIN_COLORS.highland : TERRAIN_COLORS.ground;
  let kind: TerrainSurfaceKind = height > 4 ? "mud" : "grass";
  let naturalSurface = true;
  for (const [patchX, patchZ, width, depth, rotation, type] of TERRAIN_PATCHES) {
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const offsetX = x - patchX;
    const offsetZ = z - patchZ;
    const localX = offsetX * cosine - offsetZ * sine;
    const localZ = offsetX * sine + offsetZ * cosine;
    if ((localX / (width / 2)) ** 2 + (localZ / (depth / 2)) ** 2 <= 1) {
      color = type === "mud" ? TERRAIN_COLORS.mud : TERRAIN_COLORS.grass;
      kind = type;
      break;
    }
  }
  if (roadSegments.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 6)) {
    color = TERRAIN_COLORS.roadShoulder;
    kind = "road";
    naturalSurface = false;
  }
  mapPoints.forEach((point, index) => {
    const poiType = getPoiVisualType(point.name);
    if (!poiType) return;
    const width = poiType === "harbor" ? 138 : 126;
    const depth = poiType === "town" ? 118 : 106;
    if (Math.abs(x - point.position.x) <= width / 2 && Math.abs(z - point.position.z) <= depth / 2) {
      color = index % 2 === 0 ? TERRAIN_COLORS.paving : TERRAIN_COLORS.roadShoulder;
      kind = "road";
      naturalSurface = false;
    }
  });
  if (roadSegments.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 3.75)) {
    color = TERRAIN_COLORS.road;
    kind = "road";
    naturalSurface = false;
  }
  mapPoints.forEach((point, index) => {
    if (Math.hypot(x - point.position.x, z - point.position.z) <= 15) {
      color = index % 2 === 0 ? TERRAIN_COLORS.poiDark : TERRAIN_COLORS.poiAccent;
      kind = "road";
      naturalSurface = false;
    }
  });
  const shade = naturalSurface ? terrainSurfaceShade(x, z, height, seed) : 1;
  return {
    color: naturalSurface ? color.scale(shade) : color,
    textureTint: Color3.White().scale(shade),
    kind,
  };
}

function terrainSurfaceShade(x: number, z: number, height: number, seed: number): number {
  const seedOffset = (seed & 1023) * 0.013;
  const broadPatches = Math.sin(x * 0.016 + seedOffset) * Math.cos(z * 0.014 - seedOffset);
  const groundStreaks = Math.sin(x * 0.075 + z * 0.03 + seedOffset * 1.7);
  const contourBands = Math.sin(height * 1.9 + x * 0.005 - z * 0.004);
  return 0.98 + broadPatches * 0.055 + groundStreaks * 0.028 + contourBands * 0.018;
}

function pointToSegmentDistance(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const progress = Math.max(0, Math.min(1, ((x - startX) * deltaX + (z - startZ) * deltaZ) / lengthSquared));
  return Math.hypot(x - lerp(startX, endX, progress), z - lerp(startZ, endZ, progress));
}

function createBuildingDetails(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  const roofTemplate = CreateBox("building-roof-template", { size: 1 }, scene);
  roofTemplate.material = materials.roof;
  roofTemplate.isVisible = false;
  roofTemplate.isPickable = false;
  const trimTemplate = CreateBox("building-opening-trim-template", { size: 1 }, scene);
  trimTemplate.material = materials.wallTrim;
  trimTemplate.isVisible = false;
  trimTemplate.isPickable = false;

  for (const slab of layout.floorSlabs) {
    const mesh = roofTemplate.clone(slab.id);
    if (!mesh) continue;
    mesh.position.set(slab.center.x, slab.center.y, slab.center.z);
    mesh.scaling.set(slab.width, slab.height, slab.depth);
    mesh.material = slab.kind === "roof"
      ? materials.roof
      : slab.obstacleId === layout.hospital.buildingId
        ? materials.hospitalCeiling
        : materials.floor;
    mesh.isVisible = true;
    markBuildingDetail(mesh, slab.obstacleId, slab.kind);
  }

  layout.wallOpenings.forEach((opening, index) => createWallOpeningFrame(trimTemplate, opening, index));
}

function createWallOpeningFrame(template: Mesh, opening: MapWallOpening, index: number): void {
  const horizontalAlongX = opening.side === "front" || opening.side === "back";
  const thickness = 0.12;
  const pieces: Array<readonly [string, number, number, number]> = [
    ["left", -opening.width / 2, 0, opening.height],
    ["right", opening.width / 2, 0, opening.height],
    ["top", 0, opening.height / 2, thickness],
  ];
  if (opening.kind === "window") pieces.push(["bottom", 0, -opening.height / 2, thickness]);
  for (const [pieceName, horizontalOffset, verticalOffset, pieceHeight] of pieces) {
    const piece = template.clone(`building-opening-${index}-${pieceName}`);
    if (!piece) continue;
    piece.position.set(
      opening.center.x + (horizontalAlongX ? horizontalOffset : 0),
      opening.center.y + verticalOffset,
      opening.center.z + (horizontalAlongX ? 0 : horizontalOffset),
    );
    piece.scaling.set(
      horizontalAlongX ? (pieceName === "top" || pieceName === "bottom" ? opening.width : thickness) : thickness,
      pieceHeight,
      horizontalAlongX ? thickness : (pieceName === "top" || pieceName === "bottom" ? opening.width : thickness),
    );
    piece.isVisible = true;
    markBuildingDetail(piece, opening.obstacleId, opening.kind);
  }
}

function createRoofRamps(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  for (const ramp of layout.roofRamps) {
    const horizontalLength = ramp.endZ - ramp.startZ;
    const verticalHeight = ramp.topY - ramp.bottomY;
    const length = Math.hypot(horizontalLength, verticalHeight);
    const mesh = CreateBox(
      ramp.id,
      { width: ramp.width, height: 0.18, depth: length },
      scene,
    );
    mesh.rotation.x = -Math.atan2(verticalHeight, horizontalLength);
    const halfThickness = 0.09;
    const slope = verticalHeight / horizontalLength;
    const normalLength = Math.hypot(1, slope);
    const normalY = 1 / normalLength;
    const normalZ = -slope / normalLength;
    mesh.position.set(
      ramp.centerX,
      (ramp.bottomY + ramp.topY) / 2 - normalY * halfThickness,
      (ramp.startZ + ramp.endZ) / 2 - normalZ * halfThickness,
    );
    mesh.material = materials.roadShoulder;
    markDecoration(mesh, "roof-ramp");
  }
}

function createCoverProps(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  for (const cover of layout.coverObstacles) {
    if (cover.kind === "hay") {
      const baseY = cover.center.y - cover.height / 2;
      for (const [pieceIndex, xOffset, yRatio, widthRatio, heightRatio] of [
        [0, -0.24, 0.28, 0.48, 0.56],
        [1, 0.24, 0.28, 0.48, 0.56],
        [2, 0, 0.76, 0.52, 0.4],
      ] as const) {
        const pieceHeight = cover.height * heightRatio;
        const hay = CreateBox(
          `${cover.id}-bale-${pieceIndex}`,
          { width: cover.width * widthRatio, height: pieceHeight, depth: cover.depth * 0.9 },
          scene,
        );
        hay.position.set(
          cover.center.x + cover.width * xOffset,
          baseY + cover.height * yRatio,
          cover.center.z,
        );
        hay.material = materials.hay;
        markCoverProp(hay, cover.id, cover.kind);
      }
      continue;
    }
    const horizontal = cover.width > cover.depth;
    const longSize = horizontal ? cover.width : cover.depth;
    const baseY = cover.center.y - cover.height / 2;
    for (const [railIndex, heightRatio] of [0.38, 0.72].entries()) {
      const rail = CreateBox(
        `${cover.id}-rail-${railIndex}`,
        {
          width: horizontal ? longSize : 0.16,
          height: 0.16,
          depth: horizontal ? 0.16 : longSize,
        },
        scene,
      );
      rail.position.set(cover.center.x, baseY + cover.height * heightRatio, cover.center.z);
      rail.material = materials.fence;
      markCoverProp(rail, cover.id, cover.kind);
    }
    for (const [postIndex, offset] of [-0.5, 0, 0.5].entries()) {
      const post = CreateBox(
        `${cover.id}-post-${postIndex}`,
        { width: 0.22, height: cover.height, depth: 0.22 },
        scene,
      );
      post.position.set(
        cover.center.x + (horizontal ? longSize * offset : 0),
        cover.center.y,
        cover.center.z + (horizontal ? 0 : longSize * offset),
      );
      post.material = materials.fence;
      markCoverProp(post, cover.id, cover.kind);
    }
  }
}

function createVegetation(
  scene: Scene,
  trunkMaterial: StandardMaterial,
  foliageMaterial: StandardMaterial,
  layout: MapLayout,
  quality: QualityProfile,
): void {
  const trunkTemplate = CreateCylinder(
    "tree-trunk-template",
    { height: 5.8, diameterTop: 0.55, diameterBottom: 1.1, tessellation: 7 },
    scene,
  );
  trunkTemplate.material = trunkMaterial;
  trunkTemplate.isVisible = false;
  trunkTemplate.isPickable = false;

  const foliageLayers = [
    { y: -2.1, height: 7.2, diameterTop: 0.5, diameterBottom: 7 },
    { y: 1.4, height: 6, diameterTop: 0.4, diameterBottom: 5.8 },
    { y: 4.8, height: 5.2, diameterTop: 0.15, diameterBottom: 4.2 },
  ].map((layer, index) => {
    const mesh = CreateCylinder(
      `tree-foliage-layer-${index}`,
      { ...layer, tessellation: quality.foliageTessellation },
      scene,
    );
    mesh.position.y = layer.y;
    mesh.rotation.y = index * Math.PI / 7;
    return mesh;
  });
  const foliageTemplate = Mesh.MergeMeshes(foliageLayers, true, true);
  if (!foliageTemplate) throw new Error("Unable to create tree foliage template");
  foliageTemplate.name = "tree-foliage-template";
  foliageTemplate.material = foliageMaterial;
  foliageTemplate.isVisible = false;
  foliageTemplate.isPickable = false;

  const random = createVisualRandom(layout.seed ^ 0x68bc21eb);
  for (const [index, tree] of layout.treeTrunks.entries()) {
    const treeScale = tree.height / 5.8;
    const foliageScaleY = treeScale * (0.94 + (index % 4) * 0.055);

    const trunk = trunkTemplate.createInstance(tree.id);
    trunk.position.set(tree.center.x, tree.center.y, tree.center.z);
    trunk.scaling.set(tree.width / 1.1, tree.height / 5.8, tree.depth / 1.1);
    markDecoration(trunk, "vegetation");

    const foliage = foliageTemplate.createInstance(`tree-foliage-${index}`);
    foliage.position.set(
      tree.center.x,
      tree.center.y + tree.height / 2 + 5.7 * foliageScaleY - 0.25,
      tree.center.z,
    );
    foliage.rotation.y = random() * Math.PI * 2;
    foliage.scaling.set(
      treeScale * (0.9 + (index % 3) * 0.06),
      foliageScaleY,
      treeScale * (0.9 + ((index + 1) % 3) * 0.06),
    );
    markDecoration(foliage, "vegetation");
  }
}

function createNaturalDetails(
  scene: Scene,
  rockMaterial: StandardMaterial,
  shrubMaterial: StandardMaterial,
  layout: MapLayout,
  quality: QualityProfile,
): void {
  const rockCount = quality.decorativeRockCount;
  const mountainRockCount = quality.mountainRockCount;
  const shrubCount = quality.shrubCount;
  const random = createVisualRandom(layout.seed ^ 0x02e5be93);
  const rockTemplate = CreateSphere("rock-template", { diameter: 1, segments: 5 }, scene);
  rockTemplate.material = rockMaterial;
  rockTemplate.isVisible = false;
  rockTemplate.isPickable = false;

  for (const rock of layout.rockObstacles) {
    const mesh = rockTemplate.createInstance(rock.id);
    mesh.position.set(rock.center.x, rock.center.y, rock.center.z);
    mesh.scaling.set(rock.width, rock.height, rock.depth);
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.metadata = { decoration: "cover-rock", obstacleId: rock.id };
    mesh.freezeWorldMatrix();
  }

  for (let index = 0; index < rockCount; index += 1) {
    const rock = rockTemplate.createInstance(`rock-${index}`);
    const position = index < mountainRockCount
      ? randomMountainPosition(random, layout, 3)
      : randomNaturalPosition(random, layout, 3);
    if (!position) continue;
    const { x, z } = position;
    rock.position.set(x, getTerrainHeight(x, z, layout) + 0.42 + (index % 3) * 0.12, z);
    rock.scaling.set(1.2 + (index % 4) * 0.38, 0.72 + (index % 3) * 0.18, 1 + ((index + 2) % 4) * 0.31);
    rock.rotation.y = random() * Math.PI * 2;
    markNaturalDetail(rock, "rock");
  }

  const shrubTemplate = CreateSphere("shrub-template", { diameter: 1, segments: 6 }, scene);
  shrubTemplate.material = shrubMaterial;
  shrubTemplate.isVisible = false;
  shrubTemplate.isPickable = false;
  for (let index = 0; index < shrubCount; index += 1) {
    const shrub = shrubTemplate.createInstance(`shrub-${index}`);
    const position = randomNaturalPosition(random, layout, 2);
    if (!position) continue;
    const { x, z } = position;
    shrub.position.set(x, getTerrainHeight(x, z, layout) + 0.68, z);
    shrub.scaling.set(2.1 + (index % 3) * 0.42, 1.05 + (index % 2) * 0.24, 1.8 + ((index + 1) % 3) * 0.36);
    shrub.rotation.y = random() * Math.PI * 2;
    markNaturalDetail(shrub, "shrub");
  }
}

function createPois(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  layout.mapPoints.forEach((point) => {
    const poiType = getPoiVisualType(point.name);
    if (!poiType) {
      return;
    }

    const terrainY = getTerrainHeight(point.position.x, point.position.z, layout);

    if (poiType === "harbor") {
      for (let lane = -1; lane <= 1; lane += 1) {
        const dock = CreateBox(`poi-harbor-dock-${lane}`, { width: 7, height: 0.6, depth: 32 }, scene);
        dock.position.set(point.position.x + lane * 10, terrainY + 0.4, point.position.z + 8);
        dock.material = materials.poiAccent;
        markPoiDecoration(dock, point.name, poiType);
      }
      createCrane(scene, point.position.x - 16, terrainY, point.position.z - 8, materials.poiDark, point.name);
    } else if (poiType === "town") {
      const tower = CreateCylinder("poi-town-water-tower", { height: 14, diameter: 2.2, tessellation: 8 }, scene);
      tower.position.set(point.position.x, terrainY + 7, point.position.z);
      tower.material = materials.poiDark;
      markPoiDecoration(tower, point.name, poiType);

      const tank = CreateSphere("poi-town-water-tank", { diameter: 7, segments: 8 }, scene);
      tank.position.set(point.position.x, terrainY + 14, point.position.z);
      tank.scaling.y = 0.65;
      tank.material = materials.poiAccent;
      markPoiDecoration(tank, point.name, poiType);
    } else if (poiType === "warehouse") {
      for (let containerIndex = 0; containerIndex < 4; containerIndex += 1) {
        const container = CreateBox(
          `poi-warehouse-container-${containerIndex}`,
          { width: 3, height: 2.6, depth: 8 },
          scene,
        );
        container.position.set(
          point.position.x + (containerIndex % 2) * 5 - 2.5,
          terrainY + 1.35,
          point.position.z + Math.floor(containerIndex / 2) * 10 - 5,
        );
        container.material = containerIndex % 2 === 0 ? materials.poiAccent : materials.poiDark;
        markPoiDecoration(container, point.name, poiType);
      }
    } else {
      const mast = CreateCylinder("poi-station-mast", { height: 22, diameter: 1.2, tessellation: 8 }, scene);
      mast.position.set(point.position.x, terrainY + 11, point.position.z);
      mast.material = materials.poiDark;
      markPoiDecoration(mast, point.name, poiType);

      const beacon = CreateSphere("poi-station-beacon", { diameter: 3.8, segments: 8 }, scene);
      beacon.position.set(point.position.x, terrainY + 22.5, point.position.z);
      beacon.material = materials.poiAccent;
      markPoiDecoration(beacon, point.name, poiType);
    }
  });
}

function createCrane(
  scene: Scene,
  x: number,
  baseY: number,
  z: number,
  craneMaterial: StandardMaterial,
  poiName: string,
): void {
  const upright = CreateBox("poi-harbor-crane-upright", { width: 1.5, height: 13, depth: 1.5 }, scene);
  upright.position.set(x, baseY + 6.5, z);
  upright.material = craneMaterial;
  markPoiDecoration(upright, poiName, "harbor");

  const boom = CreateBox("poi-harbor-crane-boom", { width: 13, height: 1, depth: 1 }, scene);
  boom.position.set(x + 5, baseY + 12.5, z);
  boom.material = craneMaterial;
  markPoiDecoration(boom, poiName, "harbor");
}

function createActors(
  scene: Scene,
  actors: Readonly<Record<EntityId, ActorState>>,
  materials: IslandMaterials,
  localActorId: EntityId,
): { actorRoots: Map<EntityId, TransformNode>; actorVisualRoots: Map<EntityId, TransformNode> } {
  const actorRoots = new Map<EntityId, TransformNode>();
  const actorVisualRoots = new Map<EntityId, TransformNode>();

  for (const actor of Object.values(actors)) {
    const root = new TransformNode(`actor-${actor.id}`, scene);
    root.position.set(actor.position.x, actor.position.y, actor.position.z);
    root.rotation.y = actor.yaw;
    root.metadata = { actorId: actor.id, actorKind: actor.kind };
    root.setEnabled(actor.alive && actor.deployment !== "aircraft");
    const visualRoot = new TransformNode(`actor-visual-${actor.id}`, scene);
    visualRoot.parent = root;

    if (actor.id === localActorId) {
      createPlayerHitbox(scene, root, actor.id, materials.playerHitbox);
    } else {
      createBot(scene, visualRoot, actor.id, materials);
      setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
      setActorParachuteVisual(root, actor.deployment === "parachuting");
      setActorEquipmentVisual(root, actor.inventory.armorLevel, actor.inventory.helmetLevel);
    }

    actorRoots.set(actor.id, root);
    actorVisualRoots.set(actor.id, visualRoot);
  }

  return { actorRoots, actorVisualRoots };
}

export function applyActorVisualPose(root: TransformNode, y: number, rotationX: number): void {
  if (!root.position.equalsToFloats(0, y, 0)) root.position.set(0, y, 0);
  if (!root.rotation.equalsToFloats(rotationX, 0, 0)) root.rotation.set(rotationX, 0, 0);
}

function createPlayerHitbox(
  scene: Scene,
  root: TransformNode,
  actorId: EntityId,
  hitboxMaterial: StandardMaterial,
): void {
  const hitbox = CreateCapsule(
    "player-hitbox",
    { height: 1.8, radius: 0.42, tessellation: 8, subdivisions: 1 },
    scene,
  );
  hitbox.parent = root;
  hitbox.position.y = -0.86;
  hitbox.material = hitboxMaterial;
  markActor(hitbox, actorId);
}

function createBot(scene: Scene, root: TransformNode, actorId: EntityId, materials: IslandMaterials): void {
  const body = CreateCapsule(
    `body-${actorId}`,
    { height: 1.42, radius: 0.38, tessellation: 7, subdivisions: 1 },
    scene,
  );
  body.parent = root;
  body.position.y = -0.72;
  body.material = materials.botBody;
  markActor(body, actorId);

  const head = CreateSphere(`head-${actorId}`, { diameter: 0.42, segments: 6 }, scene);
  head.parent = root;
  head.position.y = 0.13;
  head.material = materials.gear;
  markActor(head, actorId);

  const helmet = CreateCylinder(
    `helmet-${actorId}`,
    { height: 0.18, diameterTop: 0.5, diameterBottom: 0.58, tessellation: 7 },
    scene,
  );
  helmet.parent = root;
  helmet.position.y = 0.35;
  helmet.material = materials.gear;
  markActorVisual(helmet, actorId, "helmet");
  helmet.setEnabled(false);

  const vest = CreateBox(`vest-${actorId}`, { width: 0.66, height: 0.64, depth: 0.09 }, scene);
  vest.parent = root;
  vest.position.set(0, -0.62, 0.4);
  vest.material = materials.actorArmor;
  markActorVisual(vest, actorId, "vest");
  vest.setEnabled(false);

  const backpack = CreateBox(`backpack-${actorId}`, { width: 0.48, height: 0.58, depth: 0.22 }, scene);
  backpack.parent = root;
  backpack.position.set(0, -0.58, -0.45);
  backpack.material = materials.gear;
  markActorVisual(backpack, actorId, "backpack");

  for (const side of [-1, 1] as const) {
    const arm = CreateCapsule(
      `arm-${actorId}-${side}`,
      { height: 0.64, radius: 0.1, tessellation: 6, subdivisions: 1 },
      scene,
    );
    arm.parent = root;
    arm.position.set(side * 0.42, -0.48, 0.1);
    arm.rotation.x = side * 0.48;
    arm.rotation.z = side * 0.16;
    arm.material = materials.botBody;
    markActorVisual(arm, actorId, "arm");
  }

  const parachute = CreateSphere(`parachute-${actorId}`, { diameter: 2.8, segments: 8 }, scene);
  parachute.parent = root;
  parachute.position.y = 2.25;
  parachute.scaling.y = 0.2;
  parachute.material = materials.gear;
  markActorVisual(parachute, actorId, "parachute");
  parachute.setEnabled(false);

  createWeaponModel(scene, root, `bot-${actorId}`, "rifle", materials, false);
  createWeaponModel(scene, root, `bot-${actorId}`, "smg", materials, false);
  createWeaponModel(scene, root, `bot-${actorId}`, "shotgun", materials, false);
  createWeaponModel(scene, root, `bot-${actorId}`, "sniper", materials, false);
}

export function setActorWeaponVisual(root: TransformNode, weaponId: string | null): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual === "weapon") {
      const enabled = mesh.metadata.weaponId === weaponId && mesh.metadata.weaponFallbackSuppressed !== true;
      if (mesh.isEnabled(false) !== enabled) mesh.setEnabled(enabled);
    }
  }
}

export function setActorParachuteVisual(root: TransformNode, parachuting: boolean): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual === "parachute" && mesh.isEnabled(false) !== parachuting) {
      mesh.setEnabled(parachuting);
    }
  }
}

export function setActorEquipmentVisual(
  root: TransformNode,
  armorLevel: number,
  helmetLevel: number,
): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual === "vest") {
      const enabled = armorLevel > 0 && mesh.metadata?.equipmentFallbackSuppressed !== true;
      if (mesh.isEnabled(false) !== enabled) mesh.setEnabled(enabled);
    }
    if (mesh.metadata?.actorVisual === "helmet") {
      const enabled = helmetLevel > 0 && mesh.metadata?.equipmentFallbackSuppressed !== true;
      if (mesh.isEnabled(false) !== enabled) mesh.setEnabled(enabled);
    }
  }
}

function createCamera(scene: Scene, player: ActorState): UniversalCamera {
  const camera = new UniversalCamera(
    "player-camera",
    new Vector3(player.position.x, player.position.y, player.position.z),
    scene,
  );
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.minZ = 0.12;
  camera.maxZ = MAP_SIZE * 1.2;
  camera.fov = 1.18;
  camera.inertia = 0;
  camera.speed = 0.78;
  camera.angularSensibility = 2_800;
  camera.checkCollisions = true;
  camera.ellipsoid = new Vector3(0.42, 0.88, 0.42);
  camera.ellipsoidOffset = new Vector3(0, -0.88, 0);
  scene.activeCamera = camera;
  return camera;
}

function createAircraftInterior(scene: Scene, camera: UniversalCamera, materials: IslandMaterials): TransformNode {
  const root = new TransformNode("aircraft-interior-root", scene);
  root.parent = camera;
  const frameMaterial = materials.gear;
  const pieces: ReadonlyArray<readonly [string, number, number, number, number, number, number]> = [
    ["aircraft-left-frame", -1.35, 0, 1.55, 0.07, 1.55, 0.08],
    ["aircraft-right-frame", 1.35, 0, 1.55, 0.07, 1.55, 0.08],
    ["aircraft-top-frame", 0, 0.78, 1.55, 2.76, 0.07, 0.08],
    ["aircraft-bottom-frame", 0, -0.78, 1.55, 2.76, 0.08, 0.08],
  ];
  pieces.forEach(([name, x, y, z, width, height, depth]) => {
    const piece = CreateBox(name, { width, height, depth }, scene);
    piece.parent = root;
    piece.position.set(x, y, z);
    piece.material = frameMaterial;
    piece.isPickable = false;
    piece.metadata = { decoration: "aircraft" };
  });
  return root;
}

function createAircraftVisual(scene: Scene, materials: IslandMaterials): TransformNode {
  const root = new TransformNode("aircraft-visual-root", scene);
  const addPart = (mesh: Mesh, material: StandardMaterial, trail = false): void => {
    mesh.parent = root;
    mesh.material = material;
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.metadata = { decoration: "aircraft", aircraftTrail: trail };
  };

  const fuselage = CreateCapsule("aircraft-fuselage", { height: 15, radius: 1.55, tessellation: 8, subdivisions: 2 }, scene);
  fuselage.rotation.x = Math.PI / 2;
  addPart(fuselage, materials.wallTrim);
  const wings = CreateBox("aircraft-wings", { width: 23, height: 0.42, depth: 4.2 }, scene);
  wings.position.z = -0.4;
  addPart(wings, materials.gear);
  const tailWing = CreateBox("aircraft-tail-wing", { width: 8.5, height: 0.32, depth: 2.2 }, scene);
  tailWing.position.z = -5.8;
  addPart(tailWing, materials.gear);
  const tailFin = CreateBox("aircraft-tail-fin", { width: 0.45, height: 3.8, depth: 2.4 }, scene);
  tailFin.position.set(0, 2, -5.8);
  addPart(tailFin, materials.gear);
  const cockpit = CreateBox("aircraft-cockpit", { width: 2.2, height: 1, depth: 3.2 }, scene);
  cockpit.position.set(0, 1.15, 4.4);
  addPart(cockpit, materials.window);
  for (const direction of [-1, 1]) {
    const engine = CreateCylinder(
      `aircraft-engine-${direction < 0 ? "left" : "right"}`,
      { height: 4.2, diameter: 1.55, tessellation: 8 },
      scene,
    );
    engine.position.set(direction * 5.2, -0.55, -0.1);
    engine.rotation.x = Math.PI / 2;
    addPart(engine, materials.poiDark);
    const trail = CreateBox(
      `aircraft-trail-${direction < 0 ? "left" : "right"}`,
      { width: 0.42, height: 0.42, depth: 76 },
      scene,
    );
    trail.position.set(direction * 5.2, -0.55, -40.2);
    addPart(trail, materials.aircraftTrail, true);
  }
  return root;
}

function createViewWeapon(scene: Scene, camera: UniversalCamera, materials: IslandMaterials): TransformNode {
  const root = new TransformNode("view-weapon-root", scene);
  root.parent = camera;
  createWeaponModel(scene, root, "view", "rifle", materials, true);
  createWeaponModel(scene, root, "view", "smg", materials, true);
  createWeaponModel(scene, root, "view", "shotgun", materials, true);
  createWeaponModel(scene, root, "view", "sniper", materials, true);
  return root;
}

function createWeaponModel(
  scene: Scene,
  root: TransformNode,
  prefix: string,
  weaponId: WeaponVisualId,
  materials: IslandMaterials,
  viewModel: boolean,
): void {
  const scale = viewModel ? 1 : 0.62;
  const offset = viewModel ? { x: 0.38, y: -0.34, z: 0.72 } : { x: 0.28, y: -0.43, z: 0.32 };
  const pieces = weaponPieces(weaponId, viewModel);
  pieces.forEach(([name, kind, x, y, z, width, height, depth, rotationX = 0]) => {
    const mesh = kind === "barrel"
      ? CreateCylinder(`${prefix}-${weaponId}-${name}`, { diameter: width * scale, height: depth * scale, tessellation: 8 }, scene)
      : CreateBox(`${prefix}-${weaponId}-${name}`, { width: width * scale, height: height * scale, depth: depth * scale }, scene);
    mesh.parent = root;
    mesh.position.set(offset.x + x * scale, offset.y + y * scale, offset.z + z * scale);
    mesh.rotation.x = kind === "barrel" ? Math.PI / 2 + rotationX : rotationX;
    mesh.material = kind === "body" ? weaponMaterial(materials, weaponId) : materials.gear;
    mesh.isPickable = false;
    mesh.metadata = { actorVisual: "weapon", weaponId, weaponFallback: true };
    mesh.setEnabled(false);
  });
}

function weaponPieces(
  weaponId: WeaponVisualId,
  viewModel: boolean,
): ReadonlyArray<WeaponPiece> {
  if (weaponId === "sniper") {
    if (!viewModel) {
      return [
        ["receiver", "body", 0, 0, 0, 0.2, 0.2, 0.74],
        ["long-barrel", "barrel", 0, 0.04, 1.08, 0.05, 0.05, 0.82],
        ["scope", "gear", 0, 0.2, 0.05, 0.18, 0.18, 0.42],
        ["stock", "gear", 0, -0.02, -0.52, 0.2, 0.22, 0.5, 0.1],
      ];
    }
    return [
      ["receiver", "body", 0, 0, 0, 0.22, 0.2, 0.78],
      ["long-barrel", "barrel", 0, 0.04, 1.18, 0.055, 0.055, 0.94],
      ["scope", "gear", 0, 0.22, 0.05, 0.2, 0.2, 0.46],
      ["scope-front", "barrel", 0, 0.22, 0.29, 0.2, 0.2, 0.08],
      ["scope-rear", "barrel", 0, 0.22, -0.19, 0.15, 0.15, 0.08],
      ["stock", "gear", 0, -0.02, -0.55, 0.22, 0.25, 0.52, 0.1],
      ["bolt", "gear", 0.15, 0.07, 0.2, 0.05, 0.05, 0.2],
    ];
  }
  if (weaponId === "smg") {
    if (!viewModel) {
      return [
        ["receiver", "body", 0, 0, 0, 0.24, 0.22, 0.46],
        ["short-barrel", "barrel", 0, 0.03, 0.43, 0.08, 0.08, 0.34],
        ["box-mag", "gear", -0.02, -0.27, 0.02, 0.16, 0.38, 0.16, 0.08],
      ];
    }
    const pieces: readonly WeaponPiece[] = [
      ["receiver", "body", 0, 0, 0, 0.26, 0.24, 0.48],
      ["short-barrel", "barrel", 0, 0.03, 0.46, 0.08, 0.08, 0.36],
      ["box-mag", "gear", -0.02, -0.27, 0.03, 0.17, 0.42, 0.18, 0.08],
      ["fold-stock", "gear", 0, 0.02, -0.36, 0.12, 0.12, 0.36, 0.18],
      ["foregrip", "gear", 0, -0.23, 0.38, 0.11, 0.31, 0.12],
    ];
    return pieces;
  }
  if (weaponId === "shotgun") {
    if (!viewModel) {
      return [
        ["receiver", "body", 0, 0, 0.05, 0.22, 0.2, 0.52],
        ["long-barrel", "barrel", 0, 0.04, 0.78, 0.065, 0.065, 0.82],
        ["pump", "gear", 0, -0.12, 0.52, 0.24, 0.13, 0.32],
      ];
    }
    const pieces: readonly WeaponPiece[] = [
      ["receiver", "body", 0, 0, 0.05, 0.24, 0.22, 0.56],
      ["long-barrel", "barrel", 0, 0.04, 0.78, 0.07, 0.07, 0.86],
      ["tube", "barrel", 0, -0.07, 0.72, 0.06, 0.06, 0.76],
      ["pump", "gear", 0, -0.12, 0.52, 0.26, 0.14, 0.34],
      ["stock", "gear", 0, -0.02, -0.39, 0.23, 0.24, 0.45, 0.12],
    ];
    return pieces;
  }
  if (!viewModel) {
    return [
      ["receiver", "body", 0, 0, 0, 0.2, 0.18, 0.62],
      ["barrel", "barrel", 0, 0.05, 0.9, 0.06, 0.06, 0.56],
      ["curved-mag", "gear", 0, -0.27, 0.02, 0.14, 0.34, 0.22, 0.17],
    ];
  }
  const pieces: readonly WeaponPiece[] = [
    ["receiver", "body", 0, 0, 0, 0.22, 0.2, 0.68],
    ["stock", "gear", 0.01, -0.03, -0.47, 0.2, 0.25, 0.38, 0.15],
    ["handguard", "body", 0, 0.02, 0.62, 0.18, 0.16, 0.52],
    ["barrel", "barrel", 0, 0.05, 1.12, 0.065, 0.065, 0.58],
    ["curved-mag", "gear", 0, -0.28, 0.02, 0.15, 0.38, 0.24, 0.17],
    ["rail", "gear", 0, 0.13, 0.2, 0.14, 0.035, 0.72],
    ["rear-sight", "gear", 0, 0.22, -0.05, 0.09, 0.11, 0.045],
    ["front-sight", "gear", 0, 0.22, 0.7, 0.09, 0.11, 0.045],
  ];
  return pieces;
}

function weaponMaterial(materials: IslandMaterials, weaponId: WeaponVisualId): StandardMaterial {
  if (weaponId === "smg") return materials.weaponSmg;
  if (weaponId === "shotgun") return materials.weaponShotgun;
  if (weaponId === "sniper") return materials.weaponSniper;
  return materials.weaponRifle;
}

const CLASSIC_LOOT_MARKER_SIZE = 0.62;
const GROUND_LOOT_POSITION_HEIGHT = 0.45;
const GROUND_LOOT_MODEL_SCALE = 1.45;
const GROUND_LOOT_WEAPON_MODEL_SCALE = 2;
const GROUND_LOOT_MODEL_CLEARANCE = 0.04;
const GROUND_LOOT_SPAWN_COLOR = "#e2c66d";

function groundLootModelScale(modelId: string): number {
  return ITEMS[modelId]?.kind === "weapon" ? GROUND_LOOT_WEAPON_MODEL_SCALE : GROUND_LOOT_MODEL_SCALE;
}

function createLootModelMaterial(scene: Scene, itemId: string, death = false): StandardMaterial {
  const color = Color3.FromHexString(death ? "#c85e50" : GROUND_LOOT_SPAWN_COLOR);
  const material = new StandardMaterial(
    `${death ? "loot-model-death-material" : "loot-model-material"}-${itemId.replaceAll(".", "-")}`,
    scene,
  );
  material.diffuseColor = color;
  material.emissiveColor = color.scale(death ? 0.22 : 0.12);
  material.specularColor = Color3.Black();
  return material;
}

function createLootModelTemplates(scene: Scene, fallbackMaterial: StandardMaterial): Map<string, Mesh> {
  const templates = new Map<string, Mesh>();
  for (const itemId of Object.keys(ITEMS)) {
    templates.set(itemId, createLootModelTemplate(scene, itemId, createLootModelMaterial(scene, itemId)));
  }
  const fallback = CreateBox("loot-model-template-fallback", { size: CLASSIC_LOOT_MARKER_SIZE }, scene);
  fallback.rotation.set(0, Math.PI / 4, Math.PI / 4);
  fallback.material = fallbackMaterial;
  fallback.isVisible = false;
  fallback.isPickable = false;
  templates.set("fallback", fallback);
  return templates;
}

function createLootModelTemplate(scene: Scene, itemId: string, modelMaterial: StandardMaterial): Mesh {
  const parts: Mesh[] = [];
  const addBox = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x = 0,
    y = 0,
    z = 0,
  ): Mesh => {
    const mesh = CreateBox(`${itemId}-${name}`, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = modelMaterial;
    parts.push(mesh);
    return mesh;
  };
  const addCylinder = (
    name: string,
    height: number,
    diameterTop: number,
    diameterBottom: number,
    x = 0,
    y = 0,
    z = 0,
    tessellation = 8,
  ): Mesh => {
    const mesh = CreateCylinder(
      `${itemId}-${name}`,
      { height, diameterTop, diameterBottom, tessellation },
      scene,
    );
    mesh.position.set(x, y, z);
    mesh.material = modelMaterial;
    parts.push(mesh);
    return mesh;
  };

  const item = ITEMS[itemId];
  if (item?.kind === "weapon" && item.weaponId) {
    const weaponId = item.weaponId as WeaponVisualId;
    const scale = 0.95;
    const pieces = weaponPieces(weaponId, false);
    for (const [name, kind, x, y, z, width, height, depth, rotationX = 0] of pieces) {
      const mesh = kind === "barrel"
        ? addCylinder(name, depth * scale, width * scale, width * scale)
        : addBox(name, width * scale, height * scale, depth * scale);
      mesh.position.set(z * scale, 0.12 + y * scale, -x * scale);
      if (kind === "barrel") mesh.rotation.z = Math.PI / 2 + rotationX;
      else mesh.rotation.set(rotationX, Math.PI / 2, 0);
    }
    const receiver = pieces.find(([name]) => name === "receiver");
    const barrel = pieces.find(([name, kind]) => kind === "barrel" && name.includes("barrel"));
    if (receiver && barrel) {
      const [, , receiverX, receiverY, receiverZ, receiverWidth, receiverHeight, receiverDepth] = receiver;
      const [, , barrelX, barrelY, barrelZ, barrelWidth, , barrelDepth] = barrel;
      const receiverFront = (receiverZ + receiverDepth / 2) * scale;
      const barrelBack = (barrelZ - barrelDepth / 2) * scale;
      if (barrelBack > receiverFront) {
        const overlap = 0.04 * scale;
        addBox(
          "receiver-barrel-bridge",
          barrelBack - receiverFront + overlap * 2,
          Math.max(barrelWidth * 1.1, receiverHeight * 0.55) * scale,
          Math.max(barrelWidth * 1.35, receiverWidth * 0.58) * scale,
          (receiverFront + barrelBack) / 2,
          0.12 + (receiverY + barrelY) / 2 * scale,
          -(receiverX + barrelX) / 2 * scale,
        );
      }
    }
  } else if (item?.kind === "ammo") {
    const isShell = itemId === "ammo.shell";
    const isSniper = itemId === "ammo.sniper";
    const crateWidth = isShell ? 0.72 : isSniper ? 0.92 : 0.82;
    addBox("crate", crateWidth, 0.36, 0.58, 0, -0.08, 0);
    addBox("lid", crateWidth + 0.06, 0.09, 0.62, 0, 0.14, 0);
    const cartridgeCount = isShell ? 3 : isSniper ? 2 : 4;
    for (let index = 0; index < cartridgeCount; index += 1) {
      const spacing = cartridgeCount === 2 ? 0.28 : 0.18;
      const x = (index - (cartridgeCount - 1) / 2) * spacing;
      const cartridge = addCylinder(
        `cartridge-${index}`,
        isSniper ? 0.5 : isShell ? 0.38 : 0.42,
        isShell ? 0.11 : 0.07,
        isShell ? 0.12 : 0.09,
        x,
        0.33,
        -0.03,
        7,
      );
      cartridge.rotation.z = (index - (cartridgeCount - 1) / 2) * 0.09;
    }
  } else if (item?.kind === "armor") {
    const levelTwo = itemId === "armor.2";
    addBox("vest", 0.78, 0.68, 0.28, 0, 0.03, 0);
    addBox("left-strap", 0.16, 0.68, 0.16, -0.31, 0.28, 0);
    addBox("right-strap", 0.16, 0.68, 0.16, 0.31, 0.28, 0);
    addBox("front-plate", levelTwo ? 0.62 : 0.52, levelTwo ? 0.42 : 0.32, 0.1, 0, 0, -0.18);
    if (levelTwo) {
      addBox("left-pouch", 0.22, 0.22, 0.16, -0.22, -0.2, -0.22);
      addBox("right-pouch", 0.22, 0.22, 0.16, 0.22, -0.2, -0.22);
    }
  } else if (item?.kind === "helmet") {
    const levelTwo = itemId === "helmet.2";
    const shell = CreateSphere(`${itemId}-shell`, { diameter: levelTwo ? 0.9 : 0.82, segments: 8 }, scene);
    shell.position.y = 0.03;
    shell.scaling.y = levelTwo ? 0.62 : 0.55;
    shell.material = modelMaterial;
    parts.push(shell);
    addCylinder("rim", 0.1, levelTwo ? 0.96 : 0.88, levelTwo ? 0.96 : 0.88, 0, -0.16, 0, 8);
    if (levelTwo) addBox("visor", 0.7, 0.18, 0.08, 0, -0.02, -0.43);
  } else if (itemId === "bandage") {
    for (const [index, x, z] of [[0, -0.18, 0.08], [1, 0.18, -0.08]] as const) {
      const roll = addCylinder(`roll-${index}`, 0.5, 0.3, 0.3, x, 0, z, 10);
      roll.rotation.z = Math.PI / 2;
    }
    addBox("wrap", 0.74, 0.12, 0.2, 0, 0, 0);
  } else if (itemId === "medkit") {
    addBox("case", 0.78, 0.64, 0.36, 0, 0.01, 0);
    addBox("handle", 0.4, 0.12, 0.16, 0, 0.4, 0);
    addBox("cross-vertical", 0.14, 0.38, 0.08, 0, 0.02, -0.22);
    addBox("cross-horizontal", 0.38, 0.14, 0.08, 0, 0.02, -0.22);
  } else {
    addBox("fallback", CLASSIC_LOOT_MARKER_SIZE, CLASSIC_LOOT_MARKER_SIZE, CLASSIC_LOOT_MARKER_SIZE);
  }

  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`Unable to create loot model ${itemId}`);
  merged.name = `loot-model-template-${itemId.replaceAll(".", "-")}`;
  merged.material = modelMaterial;
  merged.isVisible = false;
  merged.isPickable = false;
  return merged;
}

function createLootMeshes(
  scene: Scene,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  lootMaterial: StandardMaterial,
  deathLootMaterial: StandardMaterial,
  showGroundLootModels: boolean,
): {
  lootMeshes: Map<EntityId, Mesh>;
  syncLootMeshes: (groundLoot: Readonly<Record<EntityId, GroundLootState>>) => void;
} {
  const boxTemplate = CreateBox("loot-marker-template", { size: CLASSIC_LOOT_MARKER_SIZE }, scene);
  boxTemplate.rotation.set(0, Math.PI / 4, Math.PI / 4);
  boxTemplate.material = lootMaterial;
  boxTemplate.isVisible = false;
  boxTemplate.isPickable = false;
  const modelTemplates = showGroundLootModels ? createLootModelTemplates(scene, lootMaterial) : new Map<string, Mesh>();
  const modelGroundOffsets = new Map<string, number>();
  for (const [modelId, template] of modelTemplates) {
    template.computeWorldMatrix(true);
    const minimumY = template.getBoundingInfo().boundingBox.minimumWorld.y;
    modelGroundOffsets.set(
      modelId,
      -minimumY * groundLootModelScale(modelId) + GROUND_LOOT_MODEL_CLEARANCE,
    );
  }
  const deathMaterials = new Map<string, StandardMaterial>();
  const getModelId = (itemId: string): string => modelTemplates.has(itemId) ? itemId : "fallback";
  const getModelMaterial = (modelId: string, death: boolean): StandardMaterial => {
    if (!death) return (modelTemplates.get(modelId)?.material as StandardMaterial | null) ?? lootMaterial;
    if (modelId === "fallback") return deathLootMaterial;
    let modelDeathMaterial = deathMaterials.get(modelId);
    if (!modelDeathMaterial) {
      modelDeathMaterial = createLootModelMaterial(scene, modelId, true);
      deathMaterials.set(modelId, modelDeathMaterial);
    }
    return modelDeathMaterial;
  };

  const lootMeshes = new Map<EntityId, Mesh>();
  const adapter: LootMarkerViewAdapter<Mesh> = {
    create(loot) {
      const modelId = showGroundLootModels ? getModelId(loot.itemId) : "fallback";
      const marker = (showGroundLootModels ? modelTemplates.get(modelId) : boxTemplate)?.clone(`loot-marker-${loot.id}`);
      if (!marker) {
        throw new Error(`Unable to create marker for loot ${loot.id}`);
      }
      marker.isVisible = true;
      marker.isPickable = true;
      return marker;
    },
    update(marker, loot) {
      const modelId = showGroundLootModels ? getModelId(loot.itemId) : "fallback";
      const visualSignature = [
        loot.generation ?? 0,
        loot.itemId,
        loot.source ?? "spawn",
        loot.position.x,
        loot.position.y,
        loot.position.z,
      ].join(":");
      if (marker.metadata?.lootVisualSignature !== visualSignature) {
        const modelTemplate = modelTemplates.get(modelId);
        if (showGroundLootModels && marker.metadata?.modelId !== modelId) {
          modelTemplate?.geometry?.applyToMesh(marker);
          if (modelTemplate) {
            marker.rotation.copyFrom(modelTemplate.rotation);
            marker.rotationQuaternion = modelTemplate.rotationQuaternion?.clone() ?? null;
          }
        }
        marker.material = showGroundLootModels
          ? getModelMaterial(modelId, loot.source === "death")
          : (loot.source === "death" ? deathLootMaterial : lootMaterial);
        const modelScale = showGroundLootModels ? groundLootModelScale(modelId) : 1;
        if (!marker.scaling.equalsToFloats(modelScale, modelScale, modelScale)) marker.scaling.setAll(modelScale);
        const y = loot.position.y + (showGroundLootModels
          ? (modelGroundOffsets.get(modelId) ?? 0) - GROUND_LOOT_POSITION_HEIGHT
          : 0);
        if (!marker.position.equalsToFloats(loot.position.x, y, loot.position.z)) {
          marker.position.set(loot.position.x, y, loot.position.z);
        }
        marker.metadata = {
          lootId: loot.id,
          itemId: loot.itemId,
          lootSource: loot.source ?? "spawn",
          lootModel: showGroundLootModels,
          lootModelScale: modelScale,
          modelId,
          lootVisualSignature: visualSignature,
        };
      }
      if (marker.isEnabled(false) !== loot.available) marker.setEnabled(loot.available);
    },
  };
  const syncLootMeshes = (nextGroundLoot: Readonly<Record<EntityId, GroundLootState>>): void => {
    syncLootMarkerViews(lootMeshes, nextGroundLoot, adapter);
  };

  syncLootMeshes(groundLoot);
  scene.onDisposeObservable.addOnce(() => {
    lootMeshes.clear();
    modelTemplates.clear();
    modelGroundOffsets.clear();
    deathMaterials.clear();
  });

  return { lootMeshes, syncLootMeshes };
}

function createSafeZoneRing(
  scene: Scene,
  safeZoneMaterial: StandardMaterial,
  layout: MapLayout,
): { mesh: Mesh; sync: (centerX: number, centerZ: number, radius: number) => void } {
  const segmentCount = 256;
  const ring = new Mesh("safe-zone-ring", scene);
  const indices: number[] = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const current = segment * 2;
    const next = (segment + 1) * 2;
    indices.push(current, next, current + 1, current + 1, next, next + 1);
  }
  ring.setIndices(indices);
  ring.material = safeZoneMaterial;
  ring.isPickable = false;
  ring.metadata = { visual: "safe-zone" };
  const positions = new Float32Array((segmentCount + 1) * 6);
  let initialized = false;
  let lastCenterX = Number.NaN;
  let lastCenterZ = Number.NaN;
  let lastRadius = Number.NaN;
  const sync = (centerX: number, centerZ: number, radius: number): void => {
    if (centerX === lastCenterX && centerZ === lastCenterZ && radius === lastRadius) return;
    lastCenterX = centerX;
    lastCenterZ = centerZ;
    lastRadius = radius;
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const angle = segment / segmentCount * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const terrainY = getTerrainHeight(x, z, layout);
      const offset = segment * 6;
      positions[offset] = x;
      positions[offset + 1] = terrainY + 0.12;
      positions[offset + 2] = z;
      positions[offset + 3] = x;
      positions[offset + 4] = terrainY + 1.5;
      positions[offset + 5] = z;
    }
    if (initialized) ring.updateVerticesData(VertexBuffer.PositionKind, positions, true, false);
    else {
      ring.setVerticesData(VertexBuffer.PositionKind, positions, true);
      initialized = true;
    }
  };
  sync(0, 0, INITIAL_SAFE_ZONE_RADIUS);
  return { mesh: ring, sync };
}

function markEnvironment(mesh: Mesh, obstacleId: string): void {
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.metadata = { environment: true, collision: true, obstacleId };
  mesh.freezeWorldMatrix();
}

function markActor(mesh: Mesh, actorId: EntityId): void {
  mesh.isPickable = true;
  mesh.metadata = { actorId };
}

function markActorVisual(mesh: Mesh, actorId: EntityId, detailType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { actorId, actorVisual: detailType };
}

function markDecoration(mesh: AbstractMesh, decoration: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration };
  mesh.freezeWorldMatrix();
}

function markBuildingDetail(mesh: Mesh, obstacleId: string, detailType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: "building-detail", obstacleId, detailType };
  mesh.freezeWorldMatrix();
}

function markNaturalDetail(mesh: AbstractMesh, detailType: "rock" | "shrub"): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: "natural-detail", detailType };
  mesh.freezeWorldMatrix();
}

function markCoverProp(mesh: Mesh, obstacleId: string, coverKind: "fence" | "hay"): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: "cover-prop", obstacleId, coverKind };
  mesh.freezeWorldMatrix();
}

function markPoiDecoration(mesh: Mesh, poiName: string, poiType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: "poi", poiName, poiType };
  mesh.freezeWorldMatrix();
}

function assetColor(
  assets: AssetCatalog,
  id: string,
  expectedType: "model" | "svg",
  fallback: string,
): string {
  const descriptor = assets.resolve(id, expectedType);
  return typeof descriptor.metadata?.color === "string" ? descriptor.metadata.color : fallback;
}

function material(scene: Scene, name: string, hex: string): StandardMaterial {
  const color = Color3.FromHexString(hex);
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = color;
  result.specularColor = color.scale(0.08);
  return result;
}

function texturedMaterial(
  scene: Scene,
  assets: AssetCatalog,
  name: string,
  hex: string,
  assetId: string,
  scale: number,
): StandardMaterial {
  const result = material(scene, name, hex);
  result.diffuseTexture = catalogTexture(scene, assets, assetId, scale);
  return result;
}

function catalogTexture(
  scene: Scene,
  assets: AssetCatalog,
  assetId: string,
  scale: number,
): Texture | null {
  const descriptor = assets.resolve(assetId, "image");
  if (descriptor.id !== assetId || !descriptor.url) return null;
  const texture = new Texture(descriptor.url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = assetId;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = scale;
  texture.vScale = scale;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function createVisualRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomNaturalPosition(
  random: () => number,
  layout: MapLayout,
  clearance: number,
): { x: number; z: number } | null {
  const limit = MAP_SIZE / 2 - 35;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = lerp(-limit, limit, random());
    const z = lerp(-limit, limit, random());
    if (!isNaturalPositionBlocked(x, z, layout, clearance)) return { x, z };
  }
  return null;
}

function randomMountainPosition(
  random: () => number,
  layout: MapLayout,
  clearance: number,
): { x: number; z: number } | null {
  const mountains = layout.terrainHills.filter((hill) => hill.height >= 24);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const mountain = mountains[Math.floor(random() * mountains.length)];
    if (!mountain) return null;
    const angle = random() * Math.PI * 2;
    const radius = mountain.radius * Math.sqrt(lerp(0.02, 0.5, random()));
    const x = mountain.x + Math.cos(angle) * radius;
    const z = mountain.z + Math.sin(angle) * radius;
    if (Math.abs(x) > MAP_SIZE / 2 - 35 || Math.abs(z) > MAP_SIZE / 2 - 35) continue;
    if (!isNaturalPositionBlocked(x, z, layout, clearance)) return { x, z };
  }
  return randomNaturalPosition(random, layout, clearance);
}

function isNaturalPositionBlocked(x: number, z: number, layout: MapLayout, clearance: number): boolean {
  return [...layout.obstacles, ...layout.rockObstacles, ...layout.coverObstacles, ...layout.treeTrunks].some((obstacle) =>
    Math.abs(x - obstacle.center.x) <= obstacle.width / 2 + clearance &&
    Math.abs(z - obstacle.center.z) <= obstacle.depth / 2 + clearance
  );
}
