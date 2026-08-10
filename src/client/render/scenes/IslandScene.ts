import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { BackgroundMaterial } from "@babylonjs/core/Materials/Background/backgroundMaterial";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../../assets/AssetCatalog";
import type { AssetEntry } from "../../../assets/types";
import { ITEMS } from "../../../config/items";
import { FRAG_GRENADE_ITEM_ID } from "../../../config/throwables";
import {
  AMMUNITION_DEPOT_WALL_COLOR,
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  HOSPITAL_WALL_COLOR,
  MAP_SIZE,
  TERRAIN_GRID_SUBDIVISIONS,
  type MapFloorSlab,
  type MapLayout,
  type MapWallSegment,
  type MapWallOpening,
} from "../../../config/map";
import { getActiveWeapon, type ActorState, type EntityId, type FlightState, type GroundLootState } from "../../../game/state/types";
import { ACTOR_EYE_HEIGHT, ACTOR_HEIGHT, ACTOR_RADIUS } from "../../../game/rules/actorGeometry";
import { GROUND_LOOT_POSITION_HEIGHT } from "../../../game/rules/loot";
import { QUALITY_PROFILES, type QualityLevel, type QualityProfile } from "../../../config/settings";
import type { MapId } from "../../../config/maps";
import {
  createMixedRegionSpecs,
  MIXED_ROAD_HALF_WIDTH,
  MIXED_ROAD_SHOULDER_HALF_WIDTH,
  mixedFootprintClearsRoads,
  type MixedRegionKind,
  type MixedRegionSpec,
} from "../../../config/mixedMap";
import {
  TOWN_POINT_HALF_DEPTH,
  TOWN_POINT_HALF_WIDTH,
  TOWN_POINT_OBSTACLE_CLEARANCE,
  TOWN_ROAD_HALF_WIDTH,
  TOWN_ROAD_SHOULDER_HALF_WIDTH,
  townFootprintClearsRoads,
} from "../../../config/townMap";
import { syncLootMarkerViews, type LootMarkerViewAdapter } from "../LootMarkerViewAdapter";
import { clearDynamicChunkRecoveryAttempts } from "../../dynamicChunkRecovery";
import { loadCatalogModel } from "../loadCatalogModel";
import { getPoiVisualType } from "../../poiVisuals";
import { getBrandSignPlacements } from "../../brandSigns";

const INITIAL_SAFE_ZONE_RADIUS = MAP_SIZE * 0.36;
const HOSPITAL_SURFACE_COLOR = "#ffffff";
const TOWN_VISUAL_DETAIL = "town-visual-detail";
const ISLAND_VISUAL_DETAIL = "island-visual-detail";
const SKY_ASSET_IDS = ["texture.sky.clearing", "texture.sky.overcast", "texture.sky.storm"] as const;
const TERRAIN_TEXTURE_ASSET_IDS = {
  urbanConcrete: "texture.terrain.concrete-urban",
  drySoil: "texture.terrain.dry-soil",
  forestHumus: "texture.terrain.forest-humus",
  forestMoss: "texture.terrain.forest-moss-wet",
  gravel: "texture.terrain.gravel",
  sparseGrassMud: "texture.terrain.mud-sparse-grass",
  damagedAsphalt: "texture.road.asphalt-damaged",
} as const;
const WALL_TEXTURE_ASSET_IDS = {
  brick: "texture.building.brick-masonry",
  agedConcrete: "texture.building.concrete-wall-aged",
  agedPlaster: "texture.building.wall-plaster-aged",
} as const;
const ROOF_TEXTURE_ASSET_IDS = {
  flatMembrane: "texture.building.flat-roof-membrane",
  grayTile: "texture.building.roof-tile-gray",
  redBrownTile: "texture.building.roof-tile-red-brown",
  rustedMetal: "texture.industrial.metal-roof-rusted",
} as const;
type TerrainTextureAssetId = typeof TERRAIN_TEXTURE_ASSET_IDS[keyof typeof TERRAIN_TEXTURE_ASSET_IDS];
type WallTextureAssetId = typeof WALL_TEXTURE_ASSET_IDS[keyof typeof WALL_TEXTURE_ASSET_IDS];
type RoofTextureAssetId = typeof ROOF_TEXTURE_ASSET_IDS[keyof typeof ROOF_TEXTURE_ASSET_IDS];
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
  ground: Color3.FromHexString("#646965"),
  highland: Color3.FromHexString("#565c5a"),
  mud: Color3.FromHexString("#5b605f"),
  grass: Color3.FromHexString("#606760"),
  roadShoulder: Color3.FromHexString("#666a68"),
  paving: Color3.FromHexString("#626563"),
  road: Color3.FromHexString("#505553"),
  poiAccent: Color3.FromHexString("#a37848"),
  poiDark: Color3.FromHexString("#434b4f"),
} as const;
type WeaponPiece = readonly [string, "body" | "gear" | "barrel", number, number, number, number, number, number, number?];
type WeaponVisualId = "rifle" | "smg" | "shotgun" | "sniper";

interface IslandMaterials {
  ground: MultiMaterial;
  terrainMaterialIndexes: ReadonlyMap<TerrainTextureAssetId, number>;
  terrainTextures: ReadonlyMap<TerrainTextureAssetId, Texture | null>;
  wallTextures: ReadonlyMap<WallTextureAssetId, Texture | null>;
  roofMaterials: ReadonlyMap<RoofTextureAssetId, StandardMaterial>;
  beach: StandardMaterial;
  shoreWet: StandardMaterial;
  roadShoulder: StandardMaterial;
  roadWet: StandardMaterial;
  roadMarking: StandardMaterial;
  trunk: StandardMaterial;
  foliage: StandardMaterial;
  shrub: StandardMaterial;
  rock: StandardMaterial;
  fence: StandardMaterial;
  hay: StandardMaterial;
  poiAccent: StandardMaterial;
  poiDark: StandardMaterial;
  weathering: StandardMaterial;
  floor: StandardMaterial;
  hospitalSurface: StandardMaterial;
  ammunitionDepotSurface: StandardMaterial;
  wallTrim: StandardMaterial;
  hospitalCross: StandardMaterial;
  window: StandardMaterial;
  townWindow: StandardMaterial;
  industrialLight: StandardMaterial;
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

interface BuildingTextureAssignments {
  readonly walls: ReadonlyMap<string, WallTextureAssetId>;
  readonly roofs: ReadonlyMap<string, RoofTextureAssetId>;
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
  mapId: MapId = "island",
): Promise<IslandSceneBundle> {
  const player = (localActorId ? actors[localActorId] : undefined) ??
    Object.values(actors).find((actor) => actor.kind === "player");
  if (!player) {
    throw new Error("Island scene requires one player actor");
  }
  const layout = createMapLayout(mapId, mapSeed);

  const highPresentation = quality === "high";
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.skipPointerMovePicking = true;
  configureScenePresentation(scene);

  const ambient = new HemisphericLight("island-ambient", new Vector3(0.2, 1, 0.12), scene);
  ambient.intensity = 0.74;
  ambient.diffuse = new Color3(0.78, 0.82, 0.72);
  ambient.groundColor = new Color3(0.16, 0.2, 0.18);

  const sun = new DirectionalLight("island-sun", new Vector3(-0.55, -1, 0.35), scene);
  sun.position = new Vector3(180, 260, -140);
  sun.intensity = 0.98;
  sun.diffuse = new Color3(0.94, 0.88, 0.73);
  sun.specular = new Color3(0.42, 0.46, 0.43);

  const materials = createMaterials(scene, assets, highPresentation, layout);
  createSkyDome(scene, assets, mapSeed);
  const qualityProfile = QUALITY_PROFILES[quality];
  createIslandEnvironment(scene, assets, materials, layout, qualityProfile, quality);
  createPois(scene, materials, layout);
  createBrandSigns(scene, assets, layout);

  const { actorRoots, actorVisualRoots } = createActors(scene, actors, materials, player.id, highPresentation);
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
      materials,
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

export function bindTextureWhenReady(
  scene: Pick<Scene, "isDisposed">,
  texture: Pick<Texture, "isReady" | "loadingError" | "onLoadObservable">,
  bind: () => void,
): void {
  let bound = false;
  const bindIfAvailable = (): void => {
    if (bound || scene.isDisposed || texture.loadingError || !texture.isReady()) return;
    bound = true;
    bind();
  };
  if (texture.isReady()) {
    bindIfAvailable();
    return;
  }
  const observer = texture.onLoadObservable.addOnce(bindIfAvailable);
  if (texture.isReady()) {
    texture.onLoadObservable.remove(observer);
    bindIfAvailable();
  }
}

export function getSkyAssetId(mapSeed: number): (typeof SKY_ASSET_IDS)[number] {
  return SKY_ASSET_IDS[(mapSeed >>> 0) % SKY_ASSET_IDS.length] ?? SKY_ASSET_IDS[0];
}

function configureScenePresentation(scene: Scene): void {
  scene.clearColor = new Color4(0.36, 0.44, 0.46, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = MAP_SIZE * 0.65;
  scene.fogEnd = MAP_SIZE * 1.1;
  scene.fogColor = new Color3(0.46, 0.53, 0.53);

  const processing = scene.imageProcessingConfiguration;
  processing.isEnabled = false;
  processing.toneMappingEnabled = false;
  processing.ditheringEnabled = false;
  processing.vignetteEnabled = false;
}

async function replaceCatalogModels(
  scene: Scene,
  camera: UniversalCamera,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  actorRoots: Map<EntityId, TransformNode>,
  actorVisualRoots: Map<EntityId, TransformNode>,
  materials: IslandMaterials,
  localActorId: EntityId,
  modelLodDistance: number,
): Promise<void> {
  const weaponIds = ["rifle", "smg", "shotgun", "sniper"] as const;
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
  if (loadedCharacters.length > 0 && loadedCharacters.every((loaded) => loaded !== null)) {
    clearDynamicChunkRecoveryAttempts(() =>
      typeof sessionStorage === "undefined" ? null : sessionStorage
    );
  }
  const characterModels = new Map(requiredCharacterIds.map((kind, index) => [kind, {
    base: loadedCharacters[index * 2] ?? null,
    lod1: loadedCharacters[index * 2 + 1] ?? null,
  }]));
  for (const models of characterModels.values()) {
    if (models.base) applyCharacterPalette(models.base);
    if (models.lod1) applyCharacterPalette(models.lod1);
  }
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
    for (const weaponId of weaponIds) suppressProceduralWeapon(actorRoot, weaponId);
    for (const visual of visuals) {
      for (const weaponId of weaponIds) {
        createWeaponModel(
          scene,
          visual.weaponSocket,
          `${actor.id}-${visual.lod}`,
          weaponId,
          materials,
          false,
          true,
        );
      }
    }
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

function applyCharacterPalette(loaded: LoadedCatalogModel): void {
  const materialMetadata = [
    ["uniformDark", "uniformDarkColor"],
    ["uniform", "uniformColor"],
    ["uniformLight", "uniformLightColor"],
    ["armor", "armorColor"],
    ["strap", "strapColor"],
    ["helmet", "helmetColor"],
  ] as const;
  for (const [materialName, metadataName] of materialMetadata) {
    const color = loaded.descriptor.metadata?.[metadataName];
    const sceneMaterial = loaded.container.materials.find((material) => material.name === materialName);
    if (typeof color !== "string" || sceneMaterial?.getClassName() !== "PBRMaterial") continue;
    (sceneMaterial as PBRMaterial).albedoColor = Color3.FromHexString(color);
  }
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
    if (!["weapon", "parachute", "vest", "helmet", "high-detail-gear"].includes(mesh.metadata?.actorVisual)) {
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
  const y = numberMetadata(descriptor, "offsetY", -ACTOR_EYE_HEIGHT);
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

function createMaterials(
  scene: Scene,
  assets: AssetCatalog,
  highPresentation: boolean,
  layout: MapLayout,
): IslandMaterials {
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
  const townWindow = material(scene, "town-window-material", "#a9d3d5");
  townWindow.diffuseColor = new Color3(0.56, 0.72, 0.74);
  townWindow.emissiveColor = new Color3(0.05, 0.075, 0.08);
  townWindow.specularColor = new Color3(0.78, 0.88, 0.9);
  townWindow.alpha = 0.16;
  townWindow.backFaceCulling = false;

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

  const terrainAssetIds = terrainTextureAssetIds(layout.mapId);
  const ground = new MultiMaterial("island-ground-material", scene);
  ground.subMaterials = terrainAssetIds.map((assetId) =>
    material(scene, `terrain-surface-${assetSlug(assetId)}-material`, "#ffffff")
  );
  const terrainMaterialIndexes = new Map(terrainAssetIds.map((assetId, index) => [assetId, index]));
  const terrainTextures = new Map(terrainAssetIds.map((assetId) => [
    assetId,
    catalogTexture(
      scene,
      assets,
      assetId,
      assetId === TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt ? MAP_SIZE / 18 : MAP_SIZE / 24,
    ),
  ]));
  const roadShoulder = material(scene, "road-shoulder-material", "#666a68");
  const wallTextures = new Map(wallTextureAssetIds(layout.mapId).map((assetId) => [
    assetId,
    catalogTexture(scene, assets, assetId, 2.5),
  ]));
  const roofMaterials = new Map(roofTextureAssetIds(layout.mapId).map((assetId) => [
    assetId,
    texturedMaterial(
      scene,
      assets,
      `building-roof-${assetSlug(assetId)}-material`,
      "#69706d",
      assetId,
      2,
    ),
  ]));
  const poiAccent = material(scene, "poi-accent-material", "#a37848");
  const poiDark = material(scene, "poi-dark-material", "#434b4f");
  const wallTrim = material(scene, "building-trim-material", "#8a8069");
  const roadWet = highPresentation ? material(scene, "road-wet-detail-material", "#202a2b") : roadShoulder;
  if (highPresentation) {
    roadWet.alpha = 0.48;
    roadWet.specularColor = new Color3(0.35, 0.45, 0.44);
  }
  const roadMarking = highPresentation ? material(scene, "road-marking-material", "#d0c68b") : roadShoulder;
  if (highPresentation) {
    roadMarking.alpha = 0.62;
    roadMarking.emissiveColor = Color3.FromHexString("#d0c68b").scale(0.08);
  }
  const weathering = highPresentation ? material(scene, "town-weathering-material", "#55584e") : poiDark;
  if (highPresentation) {
    weathering.alpha = 0.24;
    weathering.specularColor = Color3.Black();
  }
  const industrialLight = highPresentation ? material(scene, "town-industrial-light-material", "#f0c76e") : poiAccent;
  if (highPresentation) {
    industrialLight.emissiveColor = Color3.FromHexString("#f0c76e").scale(0.75);
    industrialLight.specularColor = Color3.FromHexString("#ffe4a6").scale(0.28);
  }
  const ammunitionDepotSurface = texturedMaterial(
    scene,
    assets,
    "ammunition-depot-surface-material",
    AMMUNITION_DEPOT_WALL_COLOR,
    "texture.industrial.metal",
    1.8,
  );

  return {
    ground,
    terrainMaterialIndexes,
    terrainTextures,
    wallTextures,
    roofMaterials,
    beach: material(scene, "island-beach-material", "#a99b70"),
    shoreWet: material(scene, "island-wet-shore-material", "#746f59"),
    roadShoulder,
    roadWet,
    roadMarking,
    trunk: material(scene, "tree-trunk-material", "#5d4b38"),
    foliage: material(scene, "tree-foliage-material", "#34533a"),
    shrub: material(scene, "shrub-material", "#496545"),
    rock: material(scene, "rock-material", "#65685e"),
    fence: material(scene, "fence-material", "#655443"),
    hay: material(scene, "hay-material", "#b86b22"),
    poiAccent,
    poiDark,
    weathering,
    floor: material(scene, "building-floor-material", "#343b3b"),
    hospitalSurface: material(scene, "hospital-surface-material", HOSPITAL_SURFACE_COLOR),
    ammunitionDepotSurface,
    wallTrim,
    hospitalCross: material(scene, "hospital-cross-material", "#d8473f"),
    window: windowMaterial,
    townWindow,
    industrialLight,
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

function terrainTextureAssetIds(mapId: MapId): TerrainTextureAssetId[] {
  if (mapId === "town") {
    return [
      TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete,
      TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt,
    ];
  }
  if (mapId === "mixed") {
    return [
      TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete,
      TERRAIN_TEXTURE_ASSET_IDS.drySoil,
      TERRAIN_TEXTURE_ASSET_IDS.forestHumus,
      TERRAIN_TEXTURE_ASSET_IDS.forestMoss,
      TERRAIN_TEXTURE_ASSET_IDS.gravel,
      TERRAIN_TEXTURE_ASSET_IDS.sparseGrassMud,
      TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt,
    ];
  }
  return [
    TERRAIN_TEXTURE_ASSET_IDS.gravel,
    TERRAIN_TEXTURE_ASSET_IDS.drySoil,
    TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt,
  ];
}

function wallTextureAssetIds(mapId: MapId): WallTextureAssetId[] {
  return mapId === "town"
    ? [WALL_TEXTURE_ASSET_IDS.agedConcrete, WALL_TEXTURE_ASSET_IDS.brick]
    : [WALL_TEXTURE_ASSET_IDS.agedPlaster, WALL_TEXTURE_ASSET_IDS.brick, WALL_TEXTURE_ASSET_IDS.agedConcrete];
}

function roofTextureAssetIds(mapId: MapId): RoofTextureAssetId[] {
  if (mapId === "town") {
    return [ROOF_TEXTURE_ASSET_IDS.flatMembrane, ROOF_TEXTURE_ASSET_IDS.rustedMetal];
  }
  if (mapId === "mixed") {
    return [
      ROOF_TEXTURE_ASSET_IDS.flatMembrane,
      ROOF_TEXTURE_ASSET_IDS.rustedMetal,
      ROOF_TEXTURE_ASSET_IDS.grayTile,
      ROOF_TEXTURE_ASSET_IDS.redBrownTile,
    ];
  }
  return [
    ROOF_TEXTURE_ASSET_IDS.flatMembrane,
    ROOF_TEXTURE_ASSET_IDS.grayTile,
    ROOF_TEXTURE_ASSET_IDS.redBrownTile,
  ];
}

function createBuildingTextureAssignments(layout: MapLayout): BuildingTextureAssignments {
  const mixedRegions = layout.mapId === "mixed" ? createMixedRegionSpecs(layout.seed) : [];
  const regionKinds = new Map(mixedRegions.map((region) => [region.id, region.kind]));
  const walls = new Map<string, WallTextureAssetId>();
  const roofs = new Map<string, RoofTextureAssetId>();
  const familyOrdinals = new Map<string, number>();
  for (const building of layout.obstacles) {
    if (building.id === layout.hospital.buildingId || building.id === layout.ammunitionDepot.buildingId) continue;
    const regionKind = building.regionId ? regionKinds.get(building.regionId) : undefined;
    const familyKey = `${layout.mapId}:${regionKind ?? "default"}`;
    const ordinal = familyOrdinals.get(familyKey) ?? 0;
    familyOrdinals.set(familyKey, ordinal + 1);
    const wallFamily = wallTextureFamily(layout.mapId, regionKind);
    const roofFamily = roofTextureFamily(layout.mapId, regionKind);
    walls.set(building.id, wallFamily[ordinal % wallFamily.length] ?? wallFamily[0]!);
    roofs.set(building.id, roofFamily[ordinal % roofFamily.length] ?? roofFamily[0]!);
  }
  return { walls, roofs };
}

function wallTextureFamily(mapId: MapId, regionKind?: MixedRegionKind): readonly WallTextureAssetId[] {
  if (mapId === "town" || regionKind === "town") {
    return [WALL_TEXTURE_ASSET_IDS.agedConcrete, WALL_TEXTURE_ASSET_IDS.brick];
  }
  if (regionKind === "forest") {
    return [WALL_TEXTURE_ASSET_IDS.agedPlaster, WALL_TEXTURE_ASSET_IDS.agedConcrete];
  }
  if (regionKind === "rural") {
    return [WALL_TEXTURE_ASSET_IDS.agedPlaster, WALL_TEXTURE_ASSET_IDS.brick];
  }
  return [
    WALL_TEXTURE_ASSET_IDS.agedPlaster,
    WALL_TEXTURE_ASSET_IDS.brick,
    WALL_TEXTURE_ASSET_IDS.agedConcrete,
  ];
}

function roofTextureFamily(mapId: MapId, regionKind?: MixedRegionKind): readonly RoofTextureAssetId[] {
  if (mapId === "town" || regionKind === "town") {
    return [ROOF_TEXTURE_ASSET_IDS.flatMembrane, ROOF_TEXTURE_ASSET_IDS.rustedMetal];
  }
  if (regionKind === "forest") return [ROOF_TEXTURE_ASSET_IDS.grayTile];
  if (regionKind === "rural") {
    return [ROOF_TEXTURE_ASSET_IDS.grayTile, ROOF_TEXTURE_ASSET_IDS.redBrownTile];
  }
  return [
    ROOF_TEXTURE_ASSET_IDS.flatMembrane,
    ROOF_TEXTURE_ASSET_IDS.grayTile,
    ROOF_TEXTURE_ASSET_IDS.redBrownTile,
  ];
}

function buildingWallBatchName(materialKey: string): string {
  return materialKey.startsWith("#")
    ? `building-walls-${materialKey.replace("#", "")}`
    : `building-walls-${assetSlug(materialKey)}`;
}

function wallTextureFallbackColor(assetId: WallTextureAssetId): string {
  if (assetId === WALL_TEXTURE_ASSET_IDS.brick) return "#725b4d";
  if (assetId === WALL_TEXTURE_ASSET_IDS.agedConcrete) return "#626866";
  return "#756b59";
}

function assetSlug(assetId: string): string {
  return assetId.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function createIslandEnvironment(
  scene: Scene,
  assets: AssetCatalog,
  materials: IslandMaterials,
  layout: MapLayout,
  quality: QualityProfile,
  qualityLevel: QualityLevel,
): void {
  if (layout.mapId === "island") createIslandPerimeter(scene, materials);

  const ground = CreateGround(
    "island-ground",
    { width: MAP_SIZE, height: MAP_SIZE, subdivisions: TERRAIN_GRID_SUBDIVISIONS, updatable: true },
    scene,
  );
  applyTerrainSurface(
    ground,
    layout,
    materials.ground,
    materials.terrainMaterialIndexes,
    materials.terrainTextures,
  );
  ground.material = materials.ground;
  markEnvironment(ground, "island-ground");
  if (layout.mapId === "town") createTownPoiPaving(scene, materials, layout);

  const buildingTextureAssignments = createBuildingTextureAssignments(layout);
  const defaultWallTextureAssetId = wallTextureAssetIds(layout.mapId)[0];
  const buildingMaterials = new Map<string, StandardMaterial>();
  const architecturalMaterials = new Map<string, StandardMaterial>();
  const buildingWallMeshes = new Map<string, Mesh[]>();
  const architecturalWalls = new Map<string, MapWallSegment[]>();
  const doorSillIds = new Set(
    layout.wallOpenings
      .filter((opening) => opening.kind === "door")
      .flatMap((opening) => opening.sillWallId ? [opening.sillWallId] : []),
  );
  for (const wall of layout.wallSegments) {
    if (doorSillIds.has(wall.id)) continue;
    const architectural = wall.role === "architectural";
    const materialCache = architectural ? architecturalMaterials : buildingMaterials;
    const specialSurface = wall.color === AMMUNITION_DEPOT_WALL_COLOR || wall.color === HOSPITAL_WALL_COLOR;
    const wallTextureAssetId = buildingTextureAssignments.walls.get(wall.obstacleId) ??
      defaultWallTextureAssetId;
    const materialKey = specialSurface ? wall.color : wallTextureAssetId;
    let buildingMaterial = specialSurface
      ? materialCache.get(materialKey)
      : buildingMaterials.get(materialKey) ?? architecturalMaterials.get(materialKey);
    if (!buildingMaterial) {
      buildingMaterial = wall.color === AMMUNITION_DEPOT_WALL_COLOR
        ? architectural
          ? materials.ammunitionDepotSurface.clone("ammunition-depot-surface-material-architecture")
          : materials.ammunitionDepotSurface
        : wall.color === HOSPITAL_WALL_COLOR
          ? architectural
            ? materials.hospitalSurface.clone("hospital-surface-material-architecture")
            : materials.hospitalSurface
          : material(
              scene,
              `building-material-${assetSlug(materialKey)}`,
              wallTextureFallbackColor(wallTextureAssetId),
            );
      if (architectural) {
        buildingMaterial.backFaceCulling = true;
        buildingMaterial.twoSidedLighting = false;
      }
      if (
        wall.color !== HOSPITAL_WALL_COLOR &&
        wall.color !== AMMUNITION_DEPOT_WALL_COLOR &&
        wallTextureAssetId
      ) {
        const wallTexture = materials.wallTextures.get(wallTextureAssetId);
        if (wallTexture) {
          const targetMaterial = buildingMaterial;
          bindTextureWhenReady(scene, wallTexture, () => {
            targetMaterial.diffuseTexture = wallTexture;
          });
        }
      }
      if (specialSurface) {
        materialCache.set(materialKey, buildingMaterial);
      } else {
        buildingMaterials.set(materialKey, buildingMaterial);
        architecturalMaterials.set(materialKey, buildingMaterial);
      }
    }

    if (architectural) {
      const walls = architecturalWalls.get(materialKey);
      if (walls) walls.push(wall);
      else architecturalWalls.set(materialKey, [wall]);
      continue;
    }
    const wallMesh = CreateBox(
      wall.id,
      { width: wall.width, height: wall.height, depth: wall.depth },
      scene,
    );
    wallMesh.position.set(wall.center.x, wall.center.y, wall.center.z);
    wallMesh.rotation.y = wall.rotationY ?? 0;
    wallMesh.material = buildingMaterial;
    const meshes = buildingWallMeshes.get(materialKey);
    if (meshes) meshes.push(wallMesh);
    else buildingWallMeshes.set(materialKey, [wallMesh]);
  }
  for (const [materialKey, meshes] of buildingWallMeshes) {
    const merged = Mesh.MergeMeshes(meshes, true, true);
    if (!merged) throw new Error(`Unable to merge building walls for ${materialKey}`);
    merged.name = buildingWallBatchName(materialKey);
    merged.material = buildingMaterials.get(materialKey) ?? null;
    markEnvironment(merged, merged.name);
    merged.metadata = { ...merged.metadata, sourceCount: meshes.length };
  }
  for (const [materialKey, walls] of architecturalWalls) {
    const mesh = createArchitecturalWallInstances(scene, materialKey, walls);
    mesh.material = architecturalMaterials.get(materialKey) ?? null;
    markEnvironment(mesh, mesh.name);
    mesh.metadata = { ...mesh.metadata, sourceCount: walls.length };
  }

  createHospitalCross(scene, materials.hospitalCross, layout);
  createAmmunitionDepotSign(scene, assets, materials.ammunitionDepotSurface, layout);

  createBuildingDetails(scene, materials, layout, buildingTextureAssignments);
  createRooftopRailings(scene, materials, layout);
  if (qualityLevel === "high") {
    createIslandHighQualityDetails(scene, materials, layout);
    createTownRoadDetails(scene, materials, layout);
    createTownFacadeDetail(scene, materials, layout);
    createTownStreetFurniture(scene, materials, layout);
    createTownWeatheringDetails(scene, materials, layout);
    createTownIndustrialSkyline(scene, materials, layout);
  }
  createRoofRamps(scene, materials, layout);
  createCoverProps(scene, materials, layout);
  createVegetation(scene, materials.trunk, materials.foliage, layout, quality);
  createNaturalDetails(scene, materials.rock, materials.shrub, layout, quality);
  mergeStaticBatch(
    scene,
    "building-floor-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      mesh.metadata?.detailType === "floor" &&
      mesh.metadata?.obstacleId !== layout.hospital.buildingId &&
      mesh.metadata?.obstacleId !== layout.ammunitionDepot.buildingId,
    { decoration: "building-detail", detailType: "floor-slabs" },
  );
  mergeStaticBatch(
    scene,
    "building-roof-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      mesh.metadata?.detailType === "roof" &&
      mesh.metadata?.obstacleId !== layout.hospital.buildingId &&
      mesh.metadata?.obstacleId !== layout.ammunitionDepot.buildingId,
    { decoration: "building-detail", detailType: "roof-slabs" },
    true,
  );
  mergeStaticBatch(
    scene,
    "ammunition-depot-surfaces-batch",
    (mesh) => mesh.metadata?.obstacleId === layout.ammunitionDepot.buildingId &&
      (
        mesh.metadata?.decoration === "building-detail" &&
        (mesh.metadata?.detailType === "floor" || mesh.metadata?.detailType === "roof")
      ),
    {
      decoration: "building-detail",
      detailType: "ammunition-depot-surfaces",
      obstacleId: layout.ammunitionDepot.buildingId,
    },
  );
  mergeStaticBatch(
    scene,
    "hospital-surfaces-batch",
    (mesh) => mesh.metadata?.obstacleId === layout.hospital.buildingId &&
      (
        mesh.metadata?.decoration === "building-detail" &&
        (mesh.metadata?.detailType === "floor" || mesh.metadata?.detailType === "roof")
      ),
    {
      decoration: "building-detail",
      detailType: "hospital-surfaces",
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

function createArchitecturalWallInstances(
  scene: Scene,
  materialKey: string,
  walls: readonly MapWallSegment[],
): Mesh {
  const mesh = CreateBox(
    `${buildingWallBatchName(materialKey)}-architecture`,
    { size: 1 },
    scene,
  );
  const matrices = new Float32Array(walls.length * 16);
  for (const [index, wall] of walls.entries()) {
    Matrix.Compose(
      new Vector3(wall.width, wall.height, wall.depth),
      Quaternion.FromEulerAngles(0, wall.rotationY ?? 0, 0),
      new Vector3(wall.center.x, wall.center.y, wall.center.z),
    ).copyToArray(matrices, index * 16);
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(true);
  return mesh;
}

function createSkyDome(scene: Scene, assets: AssetCatalog, mapSeed: number): void {
  const assetId = getSkyAssetId(mapSeed);
  const texture = catalogTexture(scene, assets, assetId, 1, Texture.CLAMP_ADDRESSMODE);
  if (!texture) return;
  texture.anisotropicFilteringLevel = 1;

  const skyMaterial = new BackgroundMaterial("island-sky-material", scene);
  skyMaterial.disableDepthWrite = true;
  skyMaterial.primaryColor = Color3.White();
  bindTextureWhenReady(scene, texture, () => {
    skyMaterial.diffuseTexture = texture;
  });
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

function createAmmunitionDepotSign(
  scene: Scene,
  assets: AssetCatalog,
  fallbackMaterial: StandardMaterial,
  layout: MapLayout,
): void {
  const building = layout.obstacles.find((candidate) => candidate.id === layout.ammunitionDepot.buildingId);
  if (!building) throw new Error("Ammunition depot building missing from scene layout");
  const texture = catalogTexture(scene, assets, "ui.item.ammo-depot", 1, Texture.CLAMP_ADDRESSMODE);
  const signMaterial = new StandardMaterial("ammunition-depot-sign-material", scene);
  signMaterial.diffuseColor = fallbackMaterial.diffuseColor.scale(1.35);
  signMaterial.emissiveColor = Color3.FromHexString("#9aa88d").scale(0.12);
  signMaterial.specularColor = Color3.Black();
  signMaterial.backFaceCulling = false;
  if (texture) {
    bindTextureWhenReady(scene, texture, () => {
      signMaterial.diffuseTexture = texture;
      signMaterial.useAlphaFromDiffuseTexture = true;
    });
  }
  const sign = CreatePlane(
    "ammunition-depot-sign",
    { width: Math.min(5.2, building.width * 0.28), height: 2.4, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  sign.position.set(
    building.center.x,
    building.baseY + Math.min(building.storyHeight - 0.8, 3.5),
    building.center.z - building.depth / 2 - 0.04,
  );
  sign.material = signMaterial;
  sign.checkCollisions = false;
  sign.isPickable = false;
  sign.metadata = {
    decoration: "ammunition-depot-sign",
    poiName: layout.ammunitionDepot.name,
    poiType: "ammo-depot",
    obstacleId: building.id,
  };
  sign.freezeWorldMatrix();
}

function mergeStaticBatch(
  scene: Scene,
  name: string,
  predicate: (mesh: Mesh) => boolean,
  metadata: Record<string, unknown>,
  preserveMaterials = false,
): void {
  const meshes = scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && predicate(mesh));
  if (!meshes.length) return;
  const merged = Mesh.MergeMeshes(
    meshes,
    true,
    true,
    undefined,
    false,
    preserveMaterials && meshes.some((mesh) => mesh.material !== meshes[0]!.material),
  );
  if (!merged) throw new Error(`Unable to merge ${name}`);
  merged.name = name;
  merged.checkCollisions = false;
  merged.isPickable = false;
  merged.metadata = { ...metadata, sourceCount: meshes.length };
  merged.freezeWorldMatrix();
}

function mergeVisualDetailBatch(
  scene: Scene,
  name: string,
  detailType: string,
  decoration = TOWN_VISUAL_DETAIL,
): void {
  mergeStaticBatch(
    scene,
    name,
    (mesh) => mesh.metadata?.decoration === decoration && mesh.metadata?.detailType === detailType,
    { decoration, detailType },
    decoration === TOWN_VISUAL_DETAIL,
  );
}

function applyTerrainSurface(
  ground: Mesh,
  layout: MapLayout,
  groundMaterial: MultiMaterial,
  terrainMaterialIndexes: ReadonlyMap<TerrainTextureAssetId, number>,
  terrainTextures: ReadonlyMap<TerrainTextureAssetId, Texture | null>,
): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const colors: number[] = [];
  const surfaceKinds: TerrainSurface[] = [];
  const roadSegments = layout.roadSegments;
  const mixedRegions = layout.mapId === "mixed" ? createMixedRegionSpecs(layout.seed) : [];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const z = positions[index + 2] ?? 0;
    const height = getTerrainHeight(x, z, layout);
    const surface = getTerrainSurface(
      x,
      z,
      height,
      layout.mapId,
      layout.seed,
      layout.mapPoints,
      roadSegments,
      mixedRegions,
    );
    positions[index + 1] = height;
    const materialIndex = terrainMaterialIndexes.get(surface.assetId);
    if (materialIndex === undefined) throw new Error(`Terrain material missing for ${surface.assetId}`);
    const surfaceMaterial = groundMaterial.subMaterials[materialIndex];
    const color = surfaceMaterial instanceof StandardMaterial && surfaceMaterial.diffuseTexture
      ? surface.textureTint
      : surface.color;
    colors.push(color.r, color.g, color.b, 1);
    surfaceKinds.push(surface);
  }
  const indices = ground.getIndices();
  if (!indices) return;
  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  const surfaceIndices = Array.from({ length: groundMaterial.subMaterials.length }, () => [] as number[]);
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const triangle = [indices[index] ?? 0, indices[index + 1] ?? 0, indices[index + 2] ?? 0];
    const surfaces = triangle.map((vertexIndex) => surfaceKinds[vertexIndex]);
    const selectedSurface = surfaces.find((surface) => surface?.kind === "road") ??
      surfaces.find((surface) => surface?.kind === "road-shoulder") ??
      surfaces.find((surface) => surface?.kind === "mud") ??
      surfaces[0];
    const materialIndex = selectedSurface
      ? terrainMaterialIndexes.get(selectedSurface.assetId)
      : undefined;
    if (materialIndex === undefined) throw new Error("Terrain triangle material missing");
    surfaceIndices[materialIndex]?.push(...triangle);
  }
  const groupedIndices = surfaceIndices.flat();
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.setVerticesData(VertexBuffer.ColorKind, colors, true);
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
  bindTerrainTexturesWhenReady(
    ground,
    groundMaterial,
    terrainMaterialIndexes,
    terrainTextures,
    surfaceKinds,
    colors,
  );
}

function bindTerrainTexturesWhenReady(
  ground: Mesh,
  groundMaterial: MultiMaterial,
  terrainMaterialIndexes: ReadonlyMap<TerrainTextureAssetId, number>,
  terrainTextures: ReadonlyMap<TerrainTextureAssetId, Texture | null>,
  surfaces: readonly TerrainSurface[],
  colors: number[],
): void {
  const scene = ground.getScene();
  for (const [assetId, texture] of terrainTextures) {
    if (!texture) continue;
    const materialIndex = terrainMaterialIndexes.get(assetId);
    const surfaceMaterial = materialIndex === undefined
      ? undefined
      : groundMaterial.subMaterials[materialIndex];
    if (!(surfaceMaterial instanceof StandardMaterial)) continue;
    bindTerrainTextureWhenReady(
      scene,
      ground,
      surfaceMaterial,
      texture,
      assetId,
      surfaces,
      colors,
    );
  }
}

export function bindTerrainTextureWhenReady(
  scene: Pick<Scene, "isDisposed">,
  ground: Pick<Mesh, "isDisposed" | "updateVerticesData">,
  surfaceMaterial: StandardMaterial,
  texture: Texture,
  assetId: string,
  surfaces: readonly { readonly assetId: string; readonly textureTint: Color3 }[],
  colors: number[],
): void {
  bindTextureWhenReady(scene, texture, () => {
    surfaceMaterial.diffuseTexture = texture;
    for (let vertexIndex = 0; vertexIndex < surfaces.length; vertexIndex += 1) {
      const surface = surfaces[vertexIndex];
      if (surface?.assetId !== assetId) continue;
      const colorOffset = vertexIndex * 4;
      colors[colorOffset] = surface.textureTint.r;
      colors[colorOffset + 1] = surface.textureTint.g;
      colors[colorOffset + 2] = surface.textureTint.b;
    }
    if (!ground.isDisposed()) {
      ground.updateVerticesData(VertexBuffer.ColorKind, colors);
    }
  });
}

function createIslandPerimeter(scene: Scene, materials: IslandMaterials): void {
  const islandHalfSize = MAP_SIZE / 2;
  createSquareBand(scene, "island-beach", islandHalfSize, islandHalfSize + 10, -0.28, materials.beach);
  createSquareBand(scene, "island-wet-shore", islandHalfSize + 10, islandHalfSize + 20, -0.34, materials.shoreWet);
}

function createIslandHighQualityDetails(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  if (layout.mapId !== "island") return;
  const halfSize = MAP_SIZE / 2;
  const random = createVisualRandom(layout.seed ^ 0x4c8d2f11);
  createSquareBand(scene, "island-shore-foam", halfSize - 7, halfSize - 4, -0.235, materials.aircraftTrail);

  layout.roadSegments.forEach(([startX, startZ, endX, endZ], index) => {
    if (index % 3 !== 0) return;
    const progress = 0.18 + random() * 0.64;
    const x = lerp(startX, endX, progress);
    const z = lerp(startZ, endZ, progress);
    const yaw = Math.atan2(endX - startX, endZ - startZ);
    const patch = CreateBox(
      `island-road-wet-${index}`,
      { width: 2.4 + random() * 2.8, height: 0.035, depth: 7 + random() * 9 },
      scene,
    );
    patch.position.set(x, getTerrainHeight(x, z, layout) + 0.06, z);
    patch.rotation.y = yaw + (random() - 0.5) * 0.24;
    patch.material = materials.roadWet;
    markIslandVisualDetail(patch, "road-wet-patch");
  });

  layout.mapPoints.forEach((point, index) => {
    if (index % 2 !== 0) return;
    const light = CreateBox(
      `island-poi-light-${index}`,
      { width: 1.2, height: 0.18, depth: 0.18 },
      scene,
    );
    light.position.set(point.position.x, getTerrainHeight(point.position.x, point.position.z, layout) + 2.8, point.position.z);
    light.rotation.y = random() * Math.PI;
    light.material = materials.industrialLight;
    markIslandVisualDetail(light, "poi-light");
  });

  for (const detailType of ["road-wet-patch", "poi-light"] as const) {
    mergeVisualDetailBatch(scene, `island-${detailType}-batch`, detailType, ISLAND_VISUAL_DETAIL);
  }
}

function createTownPoiPaving(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  for (const [index, point] of layout.mapPoints.entries()) {
    const paving = CreateGround(
      `town-poi-paving-${index}`,
      { width: TOWN_POINT_HALF_WIDTH * 2, height: TOWN_POINT_HALF_DEPTH * 2 },
      scene,
    );
    paving.position.set(
      point.position.x,
      getTerrainHeight(point.position.x, point.position.z, layout) + 0.015,
      point.position.z,
    );
    paving.material = index % 2 === 0 ? materials.poiDark : materials.roadShoulder;
    markDecoration(paving, "town-poi-paving");
  }
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

export type TerrainSurfaceKind = "grass" | "mud" | "road" | "road-shoulder";
interface TerrainSurface {
  readonly color: Color3;
  readonly textureTint: Color3;
  readonly kind: TerrainSurfaceKind;
  readonly assetId: TerrainTextureAssetId;
}

const TERRAIN_TEXTURE_TINTS: Readonly<Record<TerrainTextureAssetId, Color3>> = {
  [TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete]: Color3.FromHexString("#777874"),
  [TERRAIN_TEXTURE_ASSET_IDS.drySoil]: Color3.FromHexString("#455f82"),
  [TERRAIN_TEXTURE_ASSET_IDS.forestHumus]: Color3.FromHexString("#55574f"),
  [TERRAIN_TEXTURE_ASSET_IDS.forestMoss]: Color3.FromHexString("#586157"),
  [TERRAIN_TEXTURE_ASSET_IDS.gravel]: Color3.FromHexString("#747673"),
  [TERRAIN_TEXTURE_ASSET_IDS.sparseGrassMud]: Color3.FromHexString("#526b78"),
  [TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt]: Color3.FromHexString("#5d6261"),
};

export function terrainTextureTint(assetId: string): readonly [number, number, number] | null {
  const tint = TERRAIN_TEXTURE_TINTS[assetId as TerrainTextureAssetId];
  return tint ? [tint.r, tint.g, tint.b] : null;
}

function getTerrainSurface(
  x: number,
  z: number,
  height: number,
  mapId: MapId,
  seed: number,
  mapPoints: MapLayout["mapPoints"],
  roadSegments: ReadonlyArray<readonly [number, number, number, number]>,
  mixedRegions: readonly MixedRegionSpec[],
): TerrainSurface {
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
  if (roadSegments.some(([startX, startZ, endX, endZ]) =>
    pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= roadShoulderHalfWidth(mapId)
  )) {
    color = TERRAIN_COLORS.roadShoulder;
    kind = "road-shoulder";
    naturalSurface = false;
  }
  if (mapId === "island") {
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
  }
  if (roadSegments.some(([startX, startZ, endX, endZ]) =>
    pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= roadHalfWidth(mapId)
  )) {
    color = TERRAIN_COLORS.road;
    kind = "road";
    naturalSurface = false;
  }
  if (mapId === "island") {
    mapPoints.forEach((point, index) => {
      if (Math.hypot(x - point.position.x, z - point.position.z) <= 15) {
        color = index % 2 === 0 ? TERRAIN_COLORS.poiDark : TERRAIN_COLORS.poiAccent;
        kind = "road";
        naturalSurface = false;
      }
    });
  }
  const shade = naturalSurface ? terrainSurfaceShade(x, z, height, seed) : 1;
  const assetId = terrainTextureAssetId(mapId, mixedRegions, x, z, kind);
  return {
    color: naturalSurface ? color.scale(shade) : color,
    textureTint: TERRAIN_TEXTURE_TINTS[assetId].scale(shade),
    kind,
    assetId,
  };
}

function terrainTextureAssetId(
  mapId: MapId,
  mixedRegions: readonly MixedRegionSpec[],
  x: number,
  z: number,
  kind: TerrainSurfaceKind,
): TerrainTextureAssetId {
  if (kind === "road") return TERRAIN_TEXTURE_ASSET_IDS.damagedAsphalt;
  if (mapId === "town") return TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete;
  if (mapId === "island") {
    if (kind === "road-shoulder") return TERRAIN_TEXTURE_ASSET_IDS.gravel;
    return kind === "mud" ? TERRAIN_TEXTURE_ASSET_IDS.drySoil : TERRAIN_TEXTURE_ASSET_IDS.gravel;
  }
  const regionKind = mixedRegionKindAt(mixedRegions, x, z);
  if (kind === "road-shoulder") {
    return regionKind === "town"
      ? TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete
      : TERRAIN_TEXTURE_ASSET_IDS.gravel;
  }
  if (regionKind === "town") return TERRAIN_TEXTURE_ASSET_IDS.urbanConcrete;
  if (regionKind === "rural") {
    return kind === "mud"
      ? TERRAIN_TEXTURE_ASSET_IDS.sparseGrassMud
      : TERRAIN_TEXTURE_ASSET_IDS.drySoil;
  }
  return kind === "mud"
    ? TERRAIN_TEXTURE_ASSET_IDS.forestHumus
    : TERRAIN_TEXTURE_ASSET_IDS.forestMoss;
}

export function selectTerrainTextureAssetId(
  mapId: MapId,
  seed: number,
  x: number,
  z: number,
  kind: TerrainSurfaceKind,
): string {
  const mixedRegions = mapId === "mixed" ? createMixedRegionSpecs(seed) : [];
  return terrainTextureAssetId(mapId, mixedRegions, x, z, kind);
}

function mixedRegionKindAt(
  regions: readonly MixedRegionSpec[],
  x: number,
  z: number,
): MixedRegionKind {
  let selected: MixedRegionSpec | undefined;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const distance = Math.hypot(x - region.centerX, z - region.centerZ);
    if (distance >= selectedDistance) continue;
    selected = region;
    selectedDistance = distance;
  }
  return selected?.kind ?? "forest";
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

function roadHalfWidth(mapId: MapId): number {
  return mapId === "mixed" ? MIXED_ROAD_HALF_WIDTH : TOWN_ROAD_HALF_WIDTH;
}

function roadShoulderHalfWidth(mapId: MapId): number {
  return mapId === "mixed" ? MIXED_ROAD_SHOULDER_HALF_WIDTH : TOWN_ROAD_SHOULDER_HALF_WIDTH;
}

function hasTownPresentation(layout: MapLayout): boolean {
  return layout.obstacles.some((building) => Boolean(building.townKind));
}

export function selectTownPresentationRoads(
  layout: MapLayout,
): ReadonlyArray<readonly [number, number, number, number]> {
  return layout.urbanRoadSegments;
}

function createBuildingDetails(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
  textureAssignments: BuildingTextureAssignments,
): void {
  const roofTemplate = CreateBox("building-roof-template", { size: 1 }, scene);
  roofTemplate.material = materials.roofMaterials.values().next().value ?? materials.floor;
  roofTemplate.isVisible = false;
  roofTemplate.isPickable = false;
  const trimTemplate = CreateBox("building-opening-trim-template", { size: 1 }, scene);
  trimTemplate.material = materials.wallTrim;
  trimTemplate.isVisible = false;
  trimTemplate.isPickable = false;

  for (const slab of layout.floorSlabs) {
    const mesh = slab.footprintVertices
      ? createPolygonFloorSlabMesh(scene, slab)
      : roofTemplate.clone(slab.id);
    if (!mesh) continue;
    const roofAssetId = textureAssignments.roofs.get(slab.obstacleId);
    if (!slab.footprintVertices) {
      mesh.position.set(slab.center.x, slab.center.y, slab.center.z);
      mesh.scaling.set(slab.width, slab.height, slab.depth);
      mesh.rotation.y = slab.rotationY ?? 0;
    }
    mesh.material = slab.obstacleId === layout.hospital.buildingId
      ? materials.hospitalSurface
      : slab.obstacleId === layout.ammunitionDepot.buildingId
        ? materials.ammunitionDepotSurface
      : slab.kind === "roof"
        ? roofAssetId
          ? materials.roofMaterials.get(roofAssetId) ?? materials.floor
          : materials.floor
        : materials.floor;
    mesh.isVisible = true;
    markBuildingDetail(mesh, slab.obstacleId, slab.kind);
  }

  layout.wallOpenings.forEach((opening, index) => createWallOpeningFrame(trimTemplate, opening, index));
}

export function createPolygonFloorSlabMesh(scene: Scene, slab: MapFloorSlab): Mesh {
  const vertices = slab.footprintVertices;
  if (!vertices || vertices.length < 3) throw new Error(`Polygon floor slab vertices missing: ${slab.id}`);
  const mesh = new Mesh(slab.id, scene);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const y of [-slab.height / 2, slab.height / 2]) {
    for (const vertex of vertices) {
      positions.push(vertex.x - slab.center.x, y, vertex.z - slab.center.z);
      uvs.push(
        slab.width > 0 ? (vertex.x - slab.center.x) / slab.width + 0.5 : 0.5,
        slab.depth > 0 ? (vertex.z - slab.center.z) / slab.depth + 0.5 : 0.5,
      );
    }
  }
  const topOffset = vertices.length;
  const signedArea = vertices.reduce((total, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return next ? total + vertex.x * next.z - next.x * vertex.z : total;
  }, 0);
  for (let index = 1; index < vertices.length - 1; index += 1) {
    if (signedArea >= 0) {
      indices.push(0, index + 1, index);
      indices.push(topOffset, topOffset + index, topOffset + index + 1);
    } else {
      indices.push(0, index, index + 1);
      indices.push(topOffset, topOffset + index + 1, topOffset + index);
    }
  }
  for (let index = 0; index < vertices.length; index += 1) {
    const next = (index + 1) % vertices.length;
    indices.push(index, next, topOffset + next, index, topOffset + next, topOffset + index);
  }
  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.position.set(slab.center.x, slab.center.y, slab.center.z);
  return mesh;
}

function createRooftopRailings(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
): void {
  const eligible = layout.obstacles.filter((building) =>
    (building.footprint ?? "rectangle") === "rectangle" &&
    building.id !== layout.hospital.buildingId &&
    building.id !== layout.ammunitionDepot.buildingId &&
    selectRooftopRailing(layout.mapId, layout.seed, building.id)
  );
  if (eligible.length === 0) return;
  const transforms: Matrix[] = [];
  for (const building of eligible) {
    const roofY = building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT;
    const inset = 0.34;
    const halfWidth = building.width / 2 - inset;
    const halfDepth = building.depth / 2 - inset;
    const postSpacing = 4;
    const addPiece = (
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      depth: number,
    ): void => {
      transforms.push(Matrix.Compose(
        new Vector3(width, height, depth),
        Quaternion.Identity(),
        new Vector3(x, y, z),
      ));
    };
    for (const [fixed, span, horizontal] of [
      [-halfDepth, halfWidth * 2, true],
      [halfDepth, halfWidth * 2, true],
      [-halfWidth, halfDepth * 2, false],
      [halfWidth, halfDepth * 2, false],
    ] as const) {
      const postCount = Math.max(2, Math.ceil(span / postSpacing));
      for (let index = 0; index <= postCount; index += 1) {
        const offset = -span / 2 + index / postCount * span;
        addPiece(
          building.center.x + (horizontal ? offset : fixed),
          roofY + 0.25,
          building.center.z + (horizontal ? fixed : offset),
          0.08,
          0.5,
          0.08,
        );
      }
      for (const railHeight of [0.18, 0.42]) {
        addPiece(
          building.center.x + (horizontal ? 0 : fixed),
          roofY + railHeight,
          building.center.z + (horizontal ? fixed : 0),
          horizontal ? span : 0.07,
          0.06,
          horizontal ? 0.07 : span,
        );
      }
    }
  }
  const railing = CreateBox("rooftop-railing-batch", { size: 1 }, scene);
  const matrices = new Float32Array(transforms.length * 16);
  transforms.forEach((transform, index) => transform.copyToArray(matrices, index * 16));
  railing.thinInstanceSetBuffer("matrix", matrices, 16, true);
  railing.thinInstanceRefreshBoundingInfo(true);
  railing.material = materials.fence;
  railing.checkCollisions = false;
  railing.isPickable = false;
  railing.metadata = {
    decoration: "rooftop-railing",
    detailType: "penetrable-railing",
    sourceCount: transforms.length,
  };
}

export function selectRooftopRailing(mapId: MapId, seed: number, buildingId: string): boolean {
  let hash = (seed ^ 0x13198a2e) >>> 0;
  const identity = `${mapId}:${buildingId}:railing`;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash % 100 < 15;
}

function createTownRoadDetails(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
): void {
  if (!hasTownPresentation(layout)) return;
  const random = createVisualRandom(layout.seed ^ 0x46d1a3f7);
  const roadStride = 2;
  const markingLimit = 168;
  const wetPatchLimit = 72;
  const roadWidth = roadHalfWidth(layout.mapId);
  let markings = 0;
  let wetPatches = 0;

  const addRoadBox = (
    name: string,
    material: StandardMaterial,
    x: number,
    z: number,
    width: number,
    depth: number,
    yaw: number,
    detailType: string,
    height = 0.035,
    yOffset = 0.055,
  ): void => {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, getTerrainHeight(x, z, layout) + yOffset, z);
    mesh.rotation.y = yaw;
    mesh.material = material;
    markTownVisualDetail(mesh, detailType);
  };

  selectTownPresentationRoads(layout).forEach(([startX, startZ, endX, endZ], roadIndex) => {
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const length = Math.hypot(deltaX, deltaZ);
    if (length < 28) return;
    const yaw = Math.atan2(deltaX, deltaZ);
    const normalX = Math.cos(yaw);
    const normalZ = -Math.sin(yaw);

    const edgeDepth = Math.min(116, Math.max(24, length * 0.82));
    for (const side of [-1, 1] as const) {
      addRoadBox(
        `town-road-edge-${roadIndex}-${side}`,
        materials.wallTrim,
        (startX + endX) / 2 + normalX * side * (roadWidth + 0.38),
        (startZ + endZ) / 2 + normalZ * side * (roadWidth + 0.38),
        0.24,
        edgeDepth,
        yaw,
        "road-edge",
        0.16,
        0.11,
      );
    }

    if (roadIndex % roadStride === 0 && markings < markingLimit) {
      const dashCount = Math.min(5, Math.max(1, Math.floor(length / 70)));
      for (let dash = 0; dash < dashCount && markings < markingLimit; dash += 1) {
        const progress = (dash + 0.5) / dashCount;
        const x = lerp(startX, endX, progress);
        const z = lerp(startZ, endZ, progress);
        addRoadBox(
          `town-road-marking-${roadIndex}-${dash}`,
          materials.roadMarking,
          x,
          z,
          0.28,
          Math.min(10, length / (dashCount * 2.4)),
          yaw,
          "road-marking",
        );
        markings += 1;
      }
    }

    if (wetPatches >= wetPatchLimit || roadIndex % 2 !== 0) return;
    const patchCount = length > 120 ? 2 : 1;
    for (let patch = 0; patch < patchCount && wetPatches < wetPatchLimit; patch += 1) {
      const progress = 0.16 + random() * 0.68;
      const sideOffset = (random() - 0.5) * roadWidth * 1.3;
      const x = lerp(startX, endX, progress) + normalX * sideOffset;
      const z = lerp(startZ, endZ, progress) + normalZ * sideOffset;
      addRoadBox(
        `town-road-wet-${roadIndex}-${patch}`,
        materials.roadWet,
        x,
        z,
        2.4 + random() * 3.8,
        6 + random() * 12,
        yaw + (random() - 0.5) * 0.18,
        "road-wet-patch",
      );
      wetPatches += 1;
    }
  });

  mergeVisualDetailBatch(scene, "town-road-edges-batch", "road-edge");
  mergeVisualDetailBatch(scene, "town-road-markings-batch", "road-marking");
  mergeVisualDetailBatch(scene, "town-road-wet-patches-batch", "road-wet-patch");
}

function createTownFacadeDetail(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
): void {
  if (!hasTownPresentation(layout)) return;
  const random = createVisualRandom(layout.seed ^ 0x94d049bb);
  const openingStride = 1;

  layout.wallOpenings.forEach((opening, index) => {
    if (opening.kind !== "window" || index % openingStride !== 0) return;
    if (!layout.obstacles.some((building) =>
      building.id === opening.obstacleId && Boolean(building.townKind)
    )) return;
    const paneLayout = createTownWindowDetailLayout(opening, 0.72, 0.055);
    const pane = CreateBox(
      `town-window-glass-${index}`,
      {
        width: paneLayout.width,
        height: Math.max(0.35, opening.height * 0.56),
        depth: paneLayout.depth,
      },
      scene,
    );
    pane.position.set(
      opening.center.x + paneLayout.outward.x * 0.22,
      opening.center.y + opening.height * 0.02,
      opening.center.z + paneLayout.outward.z * 0.22,
    );
    pane.rotation.y = paneLayout.rotationY;
    pane.material = materials.townWindow;
    markTownVisualDetail(pane, "window-glass");

    if (index % 5 !== 0) return;
    const lightLayout = createTownWindowDetailLayout(opening, 0.6, 0.07);
    const light = CreateBox(
      `town-window-light-${index}`,
      {
        width: lightLayout.width,
        height: 0.16,
        depth: lightLayout.depth,
      },
      scene,
    );
    light.position.set(
      opening.center.x + lightLayout.outward.x * 0.3,
      opening.center.y + opening.height * 0.43,
      opening.center.z + lightLayout.outward.z * 0.3,
    );
    light.rotation.y = lightLayout.rotationY;
    light.material = materials.industrialLight;
    markTownVisualDetail(light, "industrial-light");
  });

  layout.obstacles.forEach((building, index) => {
    if (!building.townKind || (building.footprint ?? "rectangle") !== "rectangle") return;
    const roofY = building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT;
    const detailEvery = 2;
    if (index % detailEvery === 0 || building.storyCount >= 4) {
      const hvacHeight = 0.82 + (index % 3) * 0.16;
      const box = CreateBox(
        `${building.id}-roof-hvac`,
        {
          width: Math.min(5.8, building.width * 0.24),
          height: hvacHeight,
          depth: Math.min(4.4, building.depth * 0.2),
        },
        scene,
      );
      box.position.set(
        building.center.x + (random() - 0.5) * Math.max(0, building.width - 8) * 0.42,
        roofY + hvacHeight / 2 + 0.38,
        building.center.z + (random() - 0.5) * Math.max(0, building.depth - 8) * 0.42,
      );
      box.rotation.y = random() * Math.PI;
      box.material = materials.poiDark;
      markTownVisualDetail(box, "rooftop-equipment");

      const vent = CreateCylinder(
        `${building.id}-roof-vent`,
        { height: 1.2 + random() * 1.2, diameter: 0.62, tessellation: 8 },
        scene,
      );
      vent.position.set(
        building.center.x - building.width * 0.18,
        roofY + 0.95,
        building.center.z + building.depth * 0.18,
      );
      vent.material = materials.wallTrim;
      markTownVisualDetail(vent, "rooftop-equipment");
    }

    if ((building.townKind === "commercial" || building.townKind === "factory") && index % 5 === 0) {
      const sign = CreateBox(
        `${building.id}-facade-lightbox`,
        { width: Math.min(9, building.width * 0.46), height: 0.72, depth: 0.08 },
        scene,
      );
      sign.position.set(
        building.center.x,
        building.baseY + Math.min(building.height - 1, building.storyHeight * 0.78),
        building.center.z - building.depth / 2 - 0.08,
      );
      sign.material = materials.industrialLight;
      markTownVisualDetail(sign, "industrial-light");
    }

    if (
      (building.townKind === "factory" || building.townKind === "warehouse" || building.townKind === "commercial") &&
      index % 2 === 0
    ) {
      const opening = layout.wallOpenings.find((candidate) =>
        candidate.obstacleId === building.id &&
        candidate.kind === "door" &&
        candidate.side === "front" &&
        candidate.storyIndex === 0
      );
      if (!opening) return;
      const loadingBay = createLoadingBayLayout(opening);
      loadingBay.frameXs.forEach((x, frameIndex) => {
        const frame = CreateBox(
          `${building.id}-loading-bay-frame-${frameIndex === 0 ? "left" : "right"}`,
          { width: loadingBay.frameWidth, height: opening.height, depth: 0.12 },
          scene,
        );
        frame.position.set(x, opening.center.y, loadingBay.frontZ);
        frame.material = materials.door;
        markTownVisualDetail(frame, "loading-bay");
      });

      const canopy = CreateBox(
        `${building.id}-loading-canopy`,
        { width: loadingBay.canopyWidth, height: 0.18, depth: 1.15 },
        scene,
      );
      canopy.position.set(opening.center.x, loadingBay.canopyY, loadingBay.frontZ - 0.52);
      canopy.material = materials.wallTrim;
      markTownVisualDetail(canopy, "facade-canopy");
    }
  });

  mergeVisualDetailBatch(scene, "town-window-glass-batch", "window-glass");
  mergeVisualDetailBatch(scene, "town-industrial-lights-batch", "industrial-light");
  mergeVisualDetailBatch(scene, "town-rooftop-equipment-batch", "rooftop-equipment");
  mergeVisualDetailBatch(scene, "town-loading-bays-batch", "loading-bay");
  mergeVisualDetailBatch(scene, "town-facade-canopies-batch", "facade-canopy");
}

export function createLoadingBayLayout(opening: MapWallOpening): {
  frameXs: readonly [number, number];
  frameWidth: number;
  frontZ: number;
  canopyWidth: number;
  canopyY: number;
} {
  const frameWidth = 0.22;
  const frameOffset = (opening.width + frameWidth) / 2;
  return {
    frameXs: [opening.center.x - frameOffset, opening.center.x + frameOffset],
    frameWidth,
    frontZ: opening.center.z - 0.1,
    canopyWidth: opening.width + 1.3,
    canopyY: opening.center.y + opening.height / 2 + 0.48,
  };
}

function facadeOutward(side: MapWallOpening["side"]): { x: number; z: number } {
  if (side === "front") return { x: 0, z: -1 };
  if (side === "back") return { x: 0, z: 1 };
  if (side === "left") return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

function createTownStreetFurniture(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
): void {
  if (!hasTownPresentation(layout)) return;
  const random = createVisualRandom(layout.seed ^ 0xb73341ac);
  const lampStride = 2;
  const pipeStride = 4;
  const roadWidth = roadHalfWidth(layout.mapId);
  const shoulderWidth = roadShoulderHalfWidth(layout.mapId);
  let lampCount = 0;
  let cableCount = 0;

  const presentationRoads = selectTownPresentationRoads(layout);
  presentationRoads.forEach(([startX, startZ, endX, endZ], index) => {
    const length = Math.hypot(endX - startX, endZ - startZ);
    if (length < 70 || index % lampStride !== 0) return;
    const yaw = Math.atan2(endX - startX, endZ - startZ);
    const normalX = Math.cos(yaw);
    const normalZ = -Math.sin(yaw);
    for (const side of [-1, 1] as const) {
      const progress = 0.18 + random() * 0.64;
      const x = lerp(startX, endX, progress) + normalX * side * (shoulderWidth + 1.6);
      const z = lerp(startZ, endZ, progress) + normalZ * side * (shoulderWidth + 1.6);
      const terrainY = getTerrainHeight(x, z, layout);

      const post = CreateCylinder(
        `town-street-lamp-post-${lampCount}`,
        { height: 5.8, diameter: 0.22, tessellation: 7 },
        scene,
      );
      post.position.set(x, terrainY + 2.9, z);
      post.material = materials.fence;
      markTownVisualDetail(post, "street-furniture");

      const arm = CreateBox(
        `town-street-lamp-arm-${lampCount}`,
        { width: 0.16, height: 0.12, depth: 1.6 },
        scene,
      );
      arm.position.set(x - normalX * side * 0.74, terrainY + 5.55, z - normalZ * side * 0.74);
      arm.rotation.y = yaw;
      arm.material = materials.fence;
      markTownVisualDetail(arm, "street-furniture");

      const lamp = CreateBox(
        `town-street-lamp-head-${lampCount}`,
        { width: 0.48, height: 0.18, depth: 0.7 },
        scene,
      );
      lamp.position.set(x - normalX * side * 1.45, terrainY + 5.45, z - normalZ * side * 1.45);
      lamp.rotation.y = yaw;
      lamp.material = materials.industrialLight;
      markTownVisualDetail(lamp, "street-light");
      lampCount += 1;
    }
  });

  layout.obstacles.forEach((building, index) => {
    if (!building.townKind || index % pipeStride !== 0) return;
    const frontZ = building.center.z - building.depth / 2 - 0.12;
    const y = building.baseY + Math.min(building.height - 1.2, building.storyHeight * (0.55 + (index % 3) * 0.48));
    const pipe = CreateCylinder(
      `${building.id}-facade-pipe`,
      { height: Math.min(11, building.width * 0.58), diameter: 0.18, tessellation: 8 },
      scene,
    );
    pipe.position.set(building.center.x, y, frontZ);
    pipe.rotation.z = Math.PI / 2;
    pipe.material = materials.wallTrim;
    markTownVisualDetail(pipe, "industrial-pipe");

    const bracketCount = 3;
    for (let bracketIndex = 0; bracketIndex < bracketCount; bracketIndex += 1) {
      const offset = (bracketIndex - (bracketCount - 1) / 2) * Math.min(3.2, building.width * 0.18);
      const bracket = CreateBox(
        `${building.id}-pipe-bracket-${bracketIndex}`,
        { width: 0.12, height: 0.42, depth: 0.12 },
        scene,
      );
      bracket.position.set(building.center.x + offset, y, frontZ - 0.08);
      bracket.material = materials.fence;
      markTownVisualDetail(bracket, "industrial-pipe");
    }
  });

  const cableRoads = presentationRoads.filter(([, startZ, , endZ]) => Math.abs(startZ - endZ) < 0.01);
  for (let index = 0; index + 1 < cableRoads.length && cableCount < 52; index += 2) {
    const [startX, startZ, endX] = cableRoads[index] ?? [0, 0, 0];
    const centerX = (startX + endX) / 2;
    const centerZ = startZ + (random() - 0.5) * roadWidth;
    const cable = CreateBox(
      `town-overhead-cable-${cableCount}`,
      { width: Math.min(80, Math.abs(endX - startX) * 0.36), height: 0.055, depth: 0.055 },
      scene,
    );
    cable.position.set(centerX, getTerrainHeight(centerX, centerZ, layout) + 7.4 + random() * 1.1, centerZ);
    cable.material = materials.gear;
    markTownVisualDetail(cable, "overhead-cable");
    cableCount += 1;
  }

  for (const detailType of ["street-furniture", "street-light", "industrial-pipe", "overhead-cable"] as const) {
    mergeVisualDetailBatch(scene, `town-${detailType}-batch`, detailType);
  }
}

function createTownWeatheringDetails(
  scene: Scene,
  materials: IslandMaterials,
  layout: MapLayout,
): void {
  if (!hasTownPresentation(layout)) return;
  const random = createVisualRandom(layout.seed ^ 0x2fb87d4c);
  const facadeStride = 2;
  const roofStride = 3;
  const crackLimit = 132;
  const roadWidth = roadHalfWidth(layout.mapId);

  layout.obstacles.forEach((building, index) => {
    if (!building.townKind) return;
    if (index % facadeStride === 0 || building.storyCount >= 4) {
      const side = (index + layout.seed) % 3 === 0 ? "left" : (index + layout.seed) % 3 === 1 ? "front" : "back";
      const horizontalAlongX = side === "front" || side === "back";
      const outward = facadeOutward(side);
      const width = Math.min(horizontalAlongX ? building.width * 0.22 : building.depth * 0.22, 5.4);
      const height = Math.min(building.height * 0.22, 4.2);
      const y = building.baseY + Math.min(building.height - height / 2 - 0.45, building.storyHeight * (0.65 + random() * 1.6));
      const x = horizontalAlongX
        ? building.center.x + (random() - 0.5) * Math.max(0, building.width - width - 1)
        : building.center.x + outward.x * (building.width / 2 + 0.05);
      const z = horizontalAlongX
        ? building.center.z + outward.z * (building.depth / 2 + 0.05)
        : building.center.z + (random() - 0.5) * Math.max(0, building.depth - width - 1);
      const runoff = CreateBox(
        `${building.id}-wall-runoff`,
        {
          width: horizontalAlongX ? Math.max(0.18, width * 0.14) : 0.055,
          height,
          depth: horizontalAlongX ? 0.055 : Math.max(0.18, width * 0.14),
        },
        scene,
      );
      runoff.position.set(x, y, z);
      runoff.material = materials.weathering;
      markTownVisualDetail(runoff, "facade-weathering");

      if (index % (facadeStride * 2) === 0) {
        const rust = CreateBox(
          `${building.id}-rust-runoff`,
          {
            width: horizontalAlongX ? Math.max(0.22, width * 0.18) : 0.06,
            height: height * 0.9,
            depth: horizontalAlongX ? 0.06 : Math.max(0.22, width * 0.18),
          },
          scene,
        );
        rust.position.set(
          x + (horizontalAlongX ? width * (random() - 0.5) * 0.55 : 0),
          y - height * 0.12,
          z + (horizontalAlongX ? 0 : width * (random() - 0.5) * 0.55),
        );
        rust.material = materials.poiAccent;
        markTownVisualDetail(rust, "facade-rust");
      }
    }

    if (index % roofStride === 0) {
      const roofY = building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 0.065;
      const patch = CreateBox(
        `${building.id}-roof-patch`,
        {
          width: Math.min(9, building.width * (0.22 + random() * 0.16)),
          height: 0.045,
          depth: Math.min(7, building.depth * (0.18 + random() * 0.14)),
        },
        scene,
      );
      patch.position.set(
        building.center.x + (random() - 0.5) * Math.max(0, building.width - 9) * 0.55,
        roofY,
        building.center.z + (random() - 0.5) * Math.max(0, building.depth - 7) * 0.55,
      );
      patch.rotation.y = random() * Math.PI;
      patch.material = materials.weathering;
      markTownVisualDetail(patch, "roof-weathering");
    }
  });

  let crackCount = 0;
  for (const [roadIndex, [startX, startZ, endX, endZ]] of selectTownPresentationRoads(layout).entries()) {
    if (crackCount >= crackLimit || roadIndex % 2 !== 0) continue;
    const length = Math.hypot(endX - startX, endZ - startZ);
    if (length < 45) continue;
    const yaw = Math.atan2(endX - startX, endZ - startZ);
    const cracksOnRoad = length > 120 ? 2 : 1;
    for (let crack = 0; crack < cracksOnRoad && crackCount < crackLimit; crack += 1) {
      const progress = 0.12 + random() * 0.76;
      const sideOffset = (random() - 0.5) * roadWidth * 1.6;
      const normalX = Math.cos(yaw);
      const normalZ = -Math.sin(yaw);
      const x = lerp(startX, endX, progress) + normalX * sideOffset;
      const z = lerp(startZ, endZ, progress) + normalZ * sideOffset;
      const crackMesh = CreateBox(
        `town-asphalt-crack-${roadIndex}-${crack}`,
        { width: 0.08 + random() * 0.08, height: 0.04, depth: 3.8 + random() * 7.5 },
        scene,
      );
      crackMesh.position.set(x, getTerrainHeight(x, z, layout) + 0.07, z);
      crackMesh.rotation.y = yaw + (random() - 0.5) * 0.9;
      crackMesh.material = materials.weathering;
      markTownVisualDetail(crackMesh, "road-weathering");
      crackCount += 1;
    }
  }

  for (const detailType of ["facade-weathering", "roof-weathering", "road-weathering"] as const) {
    mergeVisualDetailBatch(scene, `town-${detailType}-batch`, detailType);
  }
  mergeVisualDetailBatch(scene, "town-facade-rust-batch", "facade-rust");
}

function createTownIndustrialSkyline(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  if (!hasTownPresentation(layout)) return;
  const random = createVisualRandom(layout.seed ^ 0x71d83b21);
  const factories = layout.obstacles
    .filter((building) => building.townKind === "factory" || building.townKind === "warehouse" || building.storyCount >= 4)
    .slice(0, 58);

  factories.forEach((building, index) => {
    const roofY = building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT;
    if (index % 3 === 0) {
      const height = 8 + random() * 8 + (building.storyCount >= 4 ? 3 : 0);
      const stack = CreateCylinder(
        `${building.id}-industrial-stack`,
        { height, diameter: 1.2 + random() * 0.9, tessellation: 10 },
        scene,
      );
      stack.position.set(
        building.center.x + (random() - 0.5) * building.width * 0.42,
        roofY + height / 2,
        building.center.z + (random() - 0.5) * building.depth * 0.42,
      );
      stack.material = materials.poiDark;
      markTownVisualDetail(stack, "industrial-skyline");

      for (let puffIndex = 0; puffIndex < 3; puffIndex += 1) {
        const puff = CreateSphere(
          `${building.id}-stack-smoke-${puffIndex}`,
          { diameter: 2.2 + puffIndex * 1.6, segments: 7 },
          scene,
        );
        puff.position.set(
          stack.position.x + (puffIndex - 1) * 1.8 + random() * 0.8,
          roofY + height + 1.6 + puffIndex * 2.8,
          stack.position.z - puffIndex * 2.2 + random() * 0.8,
        );
        puff.scaling.y = 0.52;
        puff.material = materials.aircraftTrail;
        markTownVisualDetail(puff, "industrial-smoke");
      }
    }

    if (index % 5 === 0) {
      const gantryHeight = 7 + random() * 4;
      const span = Math.min(32, Math.max(16, building.width * 0.92));
      const x = building.center.x;
      const z = building.center.z + building.depth * 0.45 + 5;
      const uprightA = CreateBox(
        `${building.id}-gantry-upright-a`,
        { width: 0.42, height: gantryHeight, depth: 0.42 },
        scene,
      );
      uprightA.position.set(x - span / 2, roofY + gantryHeight / 2, z);
      uprightA.material = materials.fence;
      markTownVisualDetail(uprightA, "industrial-skyline");
      const uprightB = CreateBox(
        `${building.id}-gantry-upright-b`,
        { width: 0.42, height: gantryHeight, depth: 0.42 },
        scene,
      );
      uprightB.position.set(x + span / 2, roofY + gantryHeight / 2, z);
      uprightB.material = materials.fence;
      markTownVisualDetail(uprightB, "industrial-skyline");
      const beam = CreateBox(
        `${building.id}-gantry-beam`,
        { width: span + 2, height: 0.38, depth: 0.5 },
        scene,
      );
      beam.position.set(x, roofY + gantryHeight, z);
      beam.material = materials.fence;
      markTownVisualDetail(beam, "industrial-skyline");
    }
  });

  const bridgeCandidates = layout.skybridges.slice(0, 20);
  bridgeCandidates.forEach((bridge, index) => {
    const pipe = CreateBox(
      `town-elevated-pipe-${index}`,
      { width: bridge.width * 0.9, height: 0.34, depth: 0.34 },
      scene,
    );
    pipe.position.set(bridge.center.x, bridge.floorY + bridge.height + 0.62, bridge.center.z);
    pipe.material = materials.wallTrim;
    markTownVisualDetail(pipe, "industrial-skyline");
  });

  mergeVisualDetailBatch(scene, "town-industrial-skyline-batch", "industrial-skyline");
  mergeVisualDetailBatch(scene, "town-industrial-smoke-batch", "industrial-smoke");
}

function createWallOpeningFrame(template: Mesh, opening: MapWallOpening, index: number): void {
  const horizontalAlongX = opening.side === "front" || opening.side === "back";
  const rotationY = opening.rotationY ?? 0;
  const tangentX = Math.cos(rotationY);
  const tangentZ = -Math.sin(rotationY);
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
      opening.center.x + (opening.rotationY === undefined
        ? horizontalAlongX ? horizontalOffset : 0
        : tangentX * horizontalOffset),
      opening.center.y + verticalOffset,
      opening.center.z + (opening.rotationY === undefined
        ? horizontalAlongX ? 0 : horizontalOffset
        : tangentZ * horizontalOffset),
    );
    if (opening.rotationY === undefined) {
      piece.scaling.set(
        horizontalAlongX ? (pieceName === "top" || pieceName === "bottom" ? opening.width : thickness) : thickness,
        pieceHeight,
        horizontalAlongX ? thickness : (pieceName === "top" || pieceName === "bottom" ? opening.width : thickness),
      );
    } else {
      piece.scaling.set(
        pieceName === "top" || pieceName === "bottom" ? opening.width : thickness,
        pieceHeight,
        thickness,
      );
      piece.rotation.y = rotationY;
    }
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

  const placements = createNaturalDetailPlacements(layout, quality);
  for (const placement of placements.filter((candidate) => candidate.detailType === "rock")) {
    const rock = rockTemplate.createInstance(placement.name);
    rock.position.set(
      placement.x,
      getTerrainHeight(placement.x, placement.z, layout) + placement.yOffset,
      placement.z,
    );
    rock.scaling.set(placement.scaleX, placement.scaleY, placement.scaleZ);
    rock.rotation.y = placement.rotationY;
    markNaturalDetail(rock, "rock");
  }

  const shrubTemplate = CreateSphere("shrub-template", { diameter: 1, segments: 6 }, scene);
  shrubTemplate.material = shrubMaterial;
  shrubTemplate.isVisible = false;
  shrubTemplate.isPickable = false;
  for (const placement of placements.filter((candidate) => candidate.detailType === "shrub")) {
    const shrub = shrubTemplate.createInstance(placement.name);
    shrub.position.set(
      placement.x,
      getTerrainHeight(placement.x, placement.z, layout) + placement.yOffset,
      placement.z,
    );
    shrub.scaling.set(placement.scaleX, placement.scaleY, placement.scaleZ);
    shrub.rotation.y = placement.rotationY;
    markNaturalDetail(shrub, "shrub");
  }
}

export interface NaturalDetailPlacement {
  name: string;
  detailType: "rock" | "shrub";
  x: number;
  z: number;
  yOffset: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationY: number;
}

export function createNaturalDetailPlacements(
  layout: MapLayout,
  quality: QualityProfile,
): NaturalDetailPlacement[] {
  const placements: NaturalDetailPlacement[] = [];
  const random = createVisualRandom(layout.seed ^ 0x02e5be93);
  for (let index = 0; index < quality.decorativeRockCount; index += 1) {
    const position = index < quality.mountainRockCount
      ? randomMountainPosition(random, layout, 3)
      : randomNaturalPosition(random, layout, 3);
    if (!position) continue;
    placements.push({
      name: `rock-${index}`,
      detailType: "rock",
      ...position,
      yOffset: 0.42 + (index % 3) * 0.12,
      scaleX: 1.2 + (index % 4) * 0.38,
      scaleY: 0.72 + (index % 3) * 0.18,
      scaleZ: 1 + ((index + 2) % 4) * 0.31,
      rotationY: random() * Math.PI * 2,
    });
  }
  for (let index = 0; index < quality.shrubCount; index += 1) {
    const position = randomNaturalPosition(random, layout, 2);
    if (!position) continue;
    placements.push({
      name: `shrub-${index}`,
      detailType: "shrub",
      ...position,
      yOffset: 0.68,
      scaleX: 2.1 + (index % 3) * 0.42,
      scaleY: 1.05 + (index % 2) * 0.24,
      scaleZ: 1.8 + ((index + 1) % 3) * 0.36,
      rotationY: random() * Math.PI * 2,
    });
  }
  return placements;
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

export function createTownWindowDetailLayout(
  opening: Pick<MapWallOpening, "side" | "width" | "rotationY">,
  widthScale: number,
  thickness: number,
): {
  width: number;
  depth: number;
  rotationY: number;
  outward: { x: number; z: number };
} {
  if (opening.rotationY !== undefined) {
    return {
      width: opening.width * widthScale,
      depth: thickness,
      rotationY: opening.rotationY,
      outward: {
        x: -Math.sin(opening.rotationY),
        z: -Math.cos(opening.rotationY),
      },
    };
  }
  const horizontalAlongX = opening.side === "front" || opening.side === "back";
  return {
    width: horizontalAlongX ? opening.width * widthScale : thickness,
    depth: horizontalAlongX ? thickness : opening.width * widthScale,
    rotationY: 0,
    outward: facadeOutward(opening.side),
  };
}

function createBrandSigns(scene: Scene, assets: AssetCatalog, layout: MapLayout): void {
  const postMaterial = material(scene, "brand-sign-post-material", "#343a31");
  for (const placement of getBrandSignPlacements(layout)) {
    const texture = catalogTexture(scene, assets, placement.assetId, 1);
    if (!texture) continue;
    texture.hasAlpha = true;
    const signMaterial = new StandardMaterial(`${placement.assetId}-material`, scene);
    signMaterial.diffuseColor = Color3.FromHexString("#68736c");
    bindTextureWhenReady(scene, texture, () => {
      signMaterial.diffuseTexture = texture;
      signMaterial.useAlphaFromDiffuseTexture = true;
    });
    signMaterial.emissiveColor = Color3.White().scale(0.16);
    signMaterial.specularColor = Color3.Black();
    signMaterial.backFaceCulling = false;
    const x = placement.x;
    const z = placement.z;
    const terrainY = getTerrainHeight(x, z, layout);
    const sign = CreatePlane(
      placement.assetId,
      { width: placement.width, height: placement.height, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    sign.position.set(x, terrainY + 3.1, z);
    sign.rotation.y = placement.yaw;
    sign.material = signMaterial;
    markDecoration(sign, "brand-sign");
    for (const side of [-1, 1]) {
      const post = CreateBox(
        `${placement.assetId}-post-${side < 0 ? "left" : "right"}`,
        { width: 0.14, height: 3.2, depth: 0.14 },
        scene,
      );
      const localX = side * placement.width * 0.36;
      post.position.set(
        x + Math.cos(placement.yaw) * localX,
        terrainY + 1.6,
        z - Math.sin(placement.yaw) * localX,
      );
      post.rotation.y = placement.yaw;
      post.material = postMaterial;
      markDecoration(post, "brand-sign-post");
    }
  }
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
  highPresentation: boolean,
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
      createBot(scene, visualRoot, actor.id, materials, highPresentation);
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
    { height: ACTOR_HEIGHT, radius: ACTOR_RADIUS, tessellation: 8, subdivisions: 1 },
    scene,
  );
  hitbox.parent = root;
  hitbox.position.y = ACTOR_HEIGHT / 2 - ACTOR_EYE_HEIGHT;
  hitbox.material = hitboxMaterial;
  markActor(hitbox, actorId);
}

function createBot(
  scene: Scene,
  root: TransformNode,
  actorId: EntityId,
  materials: IslandMaterials,
  highPresentation: boolean,
): void {
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

  if (highPresentation) {
    createHighQualityActorGear(scene, root, actorId, materials);
  }

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

function createHighQualityActorGear(
  scene: Scene,
  root: TransformNode,
  actorId: EntityId,
  materials: IslandMaterials,
): void {
  for (const side of [-1, 1] as const) {
    const shoulder = CreateBox(
      `shoulder-plate-${actorId}-${side}`,
      { width: 0.23, height: 0.12, depth: 0.28 },
      scene,
    );
    shoulder.parent = root;
    shoulder.position.set(side * 0.43, -0.28, 0.05);
    shoulder.rotation.z = side * 0.16;
    shoulder.material = materials.actorArmor;
    markActorVisual(shoulder, actorId, "high-detail-gear");

    const knee = CreateBox(
      `knee-pad-${actorId}-${side}`,
      { width: 0.18, height: 0.14, depth: 0.08 },
      scene,
    );
    knee.parent = root;
    knee.position.set(side * 0.16, -1.22, 0.3);
    knee.material = materials.gear;
    markActorVisual(knee, actorId, "high-detail-gear");
  }

  const belt = CreateBox(`utility-belt-${actorId}`, { width: 0.72, height: 0.12, depth: 0.18 }, scene);
  belt.parent = root;
  belt.position.set(0, -0.87, 0.18);
  belt.material = materials.gear;
  markActorVisual(belt, actorId, "high-detail-gear");
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

function suppressProceduralWeapon(root: TransformNode, weaponId: string): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (
      mesh.metadata?.actorVisual !== "weapon" ||
      mesh.metadata.weaponId !== weaponId ||
      mesh.metadata.weaponFallback !== true
    ) continue;
    mesh.metadata = { ...mesh.metadata, weaponFallbackSuppressed: true };
    mesh.setEnabled(false);
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
  camera.ellipsoid = new Vector3(ACTOR_RADIUS, ACTOR_EYE_HEIGHT / 2, ACTOR_RADIUS);
  camera.ellipsoidOffset = new Vector3(0, -ACTOR_EYE_HEIGHT / 2, 0);
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

function createViewWeapon(
  scene: Scene,
  camera: UniversalCamera,
  materials: IslandMaterials,
): TransformNode {
  const root = new TransformNode("view-weapon-root", scene);
  root.parent = camera;
  createWeaponModel(scene, root, "view", "rifle", materials, true);
  createWeaponModel(scene, root, "view", "smg", materials, true);
  createWeaponModel(scene, root, "view", "shotgun", materials, true);
  createWeaponModel(scene, root, "view", "sniper", materials, true);
  createViewGrenadeModel(scene, root, materials);
  return root;
}

function createViewGrenadeModel(
  scene: Scene,
  root: TransformNode,
  materials: IslandMaterials,
): void {
  const body = CreateSphere("view-grenade-body", { diameter: 0.3, segments: 10 }, scene);
  body.parent = root;
  body.position.set(0.38, -0.3, 0.76);
  body.scaling.set(0.82, 1.12, 0.82);
  body.material = materials.gear;
  body.isPickable = false;
  body.metadata = {
    actorVisual: "weapon",
    weaponId: FRAG_GRENADE_ITEM_ID,
    weaponFallback: true,
  };
  body.setEnabled(false);

  const lever = CreateBox("view-grenade-lever", { width: 0.06, height: 0.2, depth: 0.04 }, scene);
  lever.parent = root;
  lever.position.set(0.47, -0.16, 0.76);
  lever.rotation.z = -0.22;
  lever.material = materials.actorArmor;
  lever.isPickable = false;
  lever.metadata = {
    actorVisual: "weapon",
    weaponId: FRAG_GRENADE_ITEM_ID,
    weaponFallback: true,
  };
  lever.setEnabled(false);
}

function createWeaponModel(
  scene: Scene,
  root: TransformNode,
  prefix: string,
  weaponId: WeaponVisualId,
  materials: IslandMaterials,
  viewModel: boolean,
  socketModel = false,
): void {
  const scale = viewModel ? 1 : socketModel ? 0.48 : 0.62;
  const offset = viewModel
    ? { x: 0.38, y: -0.34, z: 0.72 }
    : socketModel
      ? { x: 0, y: 0, z: 0 }
      : { x: 0.28, y: -0.43, z: 0.32 };
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
    const isLight = itemId === "ammo.light";
    const crateWidth = isShell ? 0.72 : isSniper ? 0.92 : 0.82;
    addBox("crate", crateWidth, 0.36, 0.58, 0, -0.08, 0);
    addBox("lid", crateWidth + 0.06, 0.09, 0.62, 0, 0.14, 0);
    const cartridgeCount = isShell ? 3 : isSniper ? 2 : isLight ? 5 : 4;
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
  } else if (item?.kind === "throwable") {
    addCylinder("body", 0.72, 0.48, 0.58, 0, 0, 0, 10);
    addCylinder("fuse", 0.2, 0.18, 0.22, 0, 0.45, 0, 8);
    addBox("lever", 0.12, 0.42, 0.08, 0.2, 0.37, 0);
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

function markTownVisualDetail(mesh: Mesh, detailType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: TOWN_VISUAL_DETAIL, detailType };
  mesh.freezeWorldMatrix();
}

function markIslandVisualDetail(mesh: Mesh, detailType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: ISLAND_VISUAL_DETAIL, detailType };
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
  const texture = catalogTexture(scene, assets, assetId, scale);
  if (texture) {
    bindTextureWhenReady(scene, texture, () => {
      result.diffuseTexture = texture;
    });
  }
  return result;
}

function catalogTexture(
  scene: Scene,
  assets: AssetCatalog,
  assetId: string,
  scale: number,
  addressMode = Texture.WRAP_ADDRESSMODE,
): Texture | null {
  const descriptor = assets.resolve(assetId, "image");
  const payload = assets.getPayload(assetId);
  if (descriptor.id !== assetId || descriptor.type !== "image" || !descriptor.url || !payload) return null;
  const extension = new URL(descriptor.url, "https://asset.invalid").pathname.match(/\.[^.\/]+$/)?.[0] ?? ".png";
  const texture = Texture.LoadFromDataString(
    `${assetId}${extension}`,
    payload,
    scene,
    false,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
    null,
    null,
    undefined,
    undefined,
    extension,
  );
  texture.name = assetId;
  texture.isBlocking = false;
  texture.wrapU = addressMode;
  texture.wrapV = addressMode;
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
  return (
    [...layout.obstacles, ...layout.rockObstacles, ...layout.coverObstacles, ...layout.treeTrunks].some((obstacle) =>
      Math.abs(x - obstacle.center.x) <= obstacle.width / 2 + clearance &&
      Math.abs(z - obstacle.center.z) <= obstacle.depth / 2 + clearance
    ) ||
    layout.mapId === "town" && layout.landingZones.some((point) =>
      Math.abs(x - point.position.x) <=
        TOWN_POINT_HALF_WIDTH + clearance + TOWN_POINT_OBSTACLE_CLEARANCE &&
      Math.abs(z - point.position.z) <=
        TOWN_POINT_HALF_DEPTH + clearance + TOWN_POINT_OBSTACLE_CLEARANCE
    ) ||
    (
      layout.mapId === "town" &&
      !townFootprintClearsRoads(
        layout.roadSegments,
        x,
        z,
        clearance * 2,
        clearance * 2,
        0.5,
      )
    ) ||
    (
      layout.mapId === "mixed" &&
      (
        layout.landingZones.some((point) =>
          Math.hypot(x - point.position.x, z - point.position.z) <= 18 + clearance
        ) ||
        !mixedFootprintClearsRoads(
          layout.roadSegments,
          x,
          z,
          clearance * 2,
          clearance * 2,
          0.5,
        )
      )
    )
  );
}
