import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../../assets/AssetCatalog";
import type { AssetEntry } from "../../../assets/types";
import { getItemIconAssetId } from "../../itemIcon";
import {
  createMapRoadSegments,
  createMapLayout,
  getTerrainHeight,
  MAP_SIZE,
  TERRAIN_GRID_SUBDIVISIONS,
  type MapLayout,
  type MapWallOpening,
} from "../../../config/map";
import { getActiveWeapon, type ActorState, type EntityId, type FlightState, type GroundLootState } from "../../../game/state/types";
import { syncLootMarkerViews, type LootMarkerViewAdapter } from "../LootMarkerViewAdapter";
import { loadCatalogModel } from "../loadCatalogModel";

const INITIAL_SAFE_ZONE_RADIUS = MAP_SIZE * 0.36;
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
const POI_TYPES = ["harbor", "town", "warehouse", "station", "town", "station", "warehouse", "town"] as const;
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
  ground: StandardMaterial;
  beach: StandardMaterial;
  shoreWet: StandardMaterial;
  water: StandardMaterial;
  roadShoulder: StandardMaterial;
  trunk: StandardMaterial;
  foliage: StandardMaterial;
  shrub: StandardMaterial;
  rock: StandardMaterial;
  fence: StandardMaterial;
  hay: StandardMaterial;
  poiAccent: StandardMaterial;
  poiDark: StandardMaterial;
  roof: StandardMaterial;
  wallTrim: StandardMaterial;
  window: StandardMaterial;
  door: StandardMaterial;
  botBody: StandardMaterial;
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
  showGroundLootIcons = false,
): Promise<IslandSceneBundle> {
  const player = Object.values(actors).find((actor) => actor.kind === "player");
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
  createIslandEnvironment(scene, materials, layout);
  createPois(scene, materials, layout);

  const { actorRoots, actorVisualRoots } = createActors(scene, actors, materials);
  const camera = createCamera(scene, player);
  const aircraftInteriorRoot = createAircraftInterior(scene, camera, materials);
  aircraftInteriorRoot.setEnabled(player.deployment === "aircraft");
  const aircraftVisualRoot = createAircraftVisual(scene, materials);
  aircraftVisualRoot.setEnabled(false);
  const syncAircraftVisual = (flight: FlightState, visible: boolean): void => {
    const progress = Math.max(0, Math.min(1, flight.progress));
    aircraftVisualRoot.position.set(
      lerp(flight.start.x, flight.end.x, progress),
      lerp(flight.start.y, flight.end.y, progress),
      lerp(flight.start.z, flight.end.z, progress),
    );
    aircraftVisualRoot.rotation.y = Math.atan2(flight.end.x - flight.start.x, flight.end.z - flight.start.z);
    aircraftVisualRoot.setEnabled(visible && progress < 1);
  };
  const viewWeaponRoot = createViewWeapon(scene, camera, materials);
  setActorWeaponVisual(viewWeaponRoot, getActiveWeapon(player)?.weaponId ?? null);
  viewWeaponRoot.setEnabled(Boolean(getActiveWeapon(player)));
  await replaceCatalogModels(scene, assets, actors, actorRoots, actorVisualRoots, viewWeaponRoot);

  const { lootMeshes, syncLootMeshes } = createLootMeshes(
    scene,
    groundLoot,
    materials.loot,
    materials.deathLoot,
    assets,
    showGroundLootIcons,
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

async function replaceCatalogModels(
  scene: Scene,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  actorRoots: Map<EntityId, TransformNode>,
  actorVisualRoots: Map<EntityId, TransformNode>,
  viewWeaponRoot: TransformNode,
): Promise<void> {
  const weaponIds = ["rifle", "smg", "shotgun", "sniper"] as const;
  const [character, ...weapons] = await Promise.all([
    loadCatalogModel(scene, assets, "model.character.enemy"),
    ...weaponIds.map((weaponId) => loadCatalogModel(scene, assets, `model.weapon.${weaponId}`)),
  ]);

  if (character) {
    for (const actor of Object.values(actors)) {
      if (actor.kind !== "bot") continue;
      const root = actorRoots.get(actor.id);
      const visualRoot = actorVisualRoots.get(actor.id);
      if (!root || !visualRoot) continue;
      root.getChildMeshes()
        .filter((mesh) => mesh.metadata?.actorVisual !== "weapon" && mesh.metadata?.actorVisual !== "parachute")
        .forEach((mesh) => mesh.setEnabled(false));
      const instance = character.container.instantiateModelsToScene((name) => `${actor.id}-${name}`);
      attachModel(instance.rootNodes, visualRoot, character.descriptor);
    }
    scene.onDisposeObservable.addOnce(() => character.container.dispose());
  }

  for (const [index, weapon] of weapons.entries()) {
    const weaponId = weaponIds[index];
    if (!weapon || !weaponId) continue;
    suppressProceduralWeapon(viewWeaponRoot, weaponId);
    const viewInstance = weapon.container.instantiateModelsToScene((name) => `view-${weaponId}-${name}`);
    attachModel(viewInstance.rootNodes, viewWeaponRoot, weapon.descriptor, true, weaponId);
    for (const actor of Object.values(actors)) {
      if (actor.kind !== "bot") continue;
      const root = actorRoots.get(actor.id);
      const visualRoot = actorVisualRoots.get(actor.id);
      if (!root || !visualRoot) continue;
      suppressProceduralWeapon(root, weaponId);
      const instance = weapon.container.instantiateModelsToScene((name) => `${actor.id}-${weaponId}-${name}`);
      attachModel(instance.rootNodes, visualRoot, weapon.descriptor, false, weaponId);
      setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
    }
    const player = Object.values(actors).find((actor) => actor.kind === "player");
    setActorWeaponVisual(viewWeaponRoot, player ? getActiveWeapon(player)?.weaponId ?? null : null);
    scene.onDisposeObservable.addOnce(() => weapon.container.dispose());
  }
}

function attachModel(
  nodes: readonly Node[],
  parent: TransformNode | UniversalCamera,
  descriptor: AssetEntry,
  viewModel = false,
  weaponId?: WeaponVisualId,
): void {
  const scale = numberMetadata(descriptor, "scale", 1);
  const x = numberMetadata(descriptor, "offsetX", viewModel ? 0.38 : 0);
  const y = numberMetadata(descriptor, "offsetY", viewModel ? -0.34 : -1.76);
  const z = numberMetadata(descriptor, "offsetZ", viewModel ? 0.76 : 0);
  for (const node of nodes) {
    if (!(node instanceof TransformNode)) continue;
    node.parent = parent;
    node.position.set(x, y, z);
    node.scaling.setAll(scale);
    const meshes = node instanceof Mesh ? [node, ...node.getChildMeshes()] : node.getChildMeshes();
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.metadata = weaponId
        ? { visualModel: descriptor.id, actorVisual: "weapon", weaponId }
        : { visualModel: descriptor.id };
      if (weaponId) mesh.setEnabled(false);
    }
  }
}

function numberMetadata(descriptor: AssetEntry, name: string, fallback: number): number {
  const value = descriptor.metadata?.[name];
  return typeof value === "number" ? value : fallback;
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

  const water = material(scene, "island-water-material", "#3b6670");
  water.alpha = 0.92;
  water.specularColor = new Color3(0.28, 0.4, 0.43);
  water.specularPower = 56;

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

  const ground = material(scene, "island-ground-material", "#ffffff");
  const roadShoulder = material(scene, "road-shoulder-material", "#746b52");

  return {
    ground,
    beach: material(scene, "island-beach-material", "#a99b70"),
    shoreWet: material(scene, "island-wet-shore-material", "#746f59"),
    water,
    roadShoulder,
    trunk: material(scene, "tree-trunk-material", "#5d4b38"),
    foliage: material(scene, "tree-foliage-material", "#34533a"),
    shrub: material(scene, "shrub-material", "#496545"),
    rock: material(scene, "rock-material", "#65685e"),
    fence: material(scene, "fence-material", "#655443"),
    hay: material(scene, "hay-material", "#a28a4f"),
    poiAccent: material(scene, "poi-accent-material", "#a37848"),
    poiDark: material(scene, "poi-dark-material", "#434b4f"),
    roof: material(scene, "building-roof-material", "#343b3b"),
    wallTrim: material(scene, "building-trim-material", "#8a8069"),
    window: windowMaterial,
    door: material(scene, "building-door-material", "#4c3d31"),
    botBody: material(scene, "bot-body-material", botColor),
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

function createIslandEnvironment(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  createIslandPerimeter(scene, materials);

  const ground = CreateGround(
    "island-ground",
    { width: MAP_SIZE, height: MAP_SIZE, subdivisions: TERRAIN_GRID_SUBDIVISIONS, updatable: true },
    scene,
  );
  applyTerrainSurface(ground, layout);
  ground.material = materials.ground;
  markEnvironment(ground, "island-ground");

  const buildingMaterials = new Map<string, StandardMaterial>();
  const buildingWallMeshes = new Map<string, Mesh[]>();
  for (const wall of layout.wallSegments) {
    let buildingMaterial = buildingMaterials.get(wall.color);
    if (!buildingMaterial) {
      buildingMaterial = material(scene, `building-material-${buildingMaterials.size}`, wall.color);
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
  }

  createBuildingDetails(scene, materials, layout);
  createRoofRamps(scene, materials, layout);
  createCoverProps(scene, materials, layout);
  createVegetation(scene, materials.trunk, materials.foliage, layout);
  createNaturalDetails(scene, materials.rock, materials.shrub, layout);
  mergeStaticBatch(
    scene,
    "building-slabs-batch",
    (mesh) => mesh.metadata?.decoration === "building-detail" &&
      (mesh.metadata?.detailType === "floor" || mesh.metadata?.detailType === "roof"),
    { decoration: "building-detail", detailType: "floor-slabs" },
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

function applyTerrainSurface(ground: Mesh, layout: MapLayout): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const colors: number[] = [];
  const roadSegments = createMapRoadSegments(layout.landingZones);
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const z = positions[index + 2] ?? 0;
    const height = getTerrainHeight(x, z, layout);
    const color = getTerrainColor(x, z, height, layout.seed, layout.mapPoints, roadSegments);
    positions[index + 1] = height;
    colors.push(color.r, color.g, color.b, 1);
  }
  const indices = ground.getIndices();
  if (!indices) return;
  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.setVerticesData(VertexBuffer.ColorKind, colors);
  ground.useVertexColors = true;
  ground.refreshBoundingInfo();
  ground.freezeWorldMatrix();
}

function createIslandPerimeter(scene: Scene, materials: IslandMaterials): void {
  const islandHalfSize = MAP_SIZE / 2;
  createSquareBand(scene, "island-beach", islandHalfSize, islandHalfSize + 10, -0.28, materials.beach);
  createSquareBand(scene, "island-wet-shore", islandHalfSize + 10, islandHalfSize + 20, -0.34, materials.shoreWet);
  createSquareBand(scene, "ocean", islandHalfSize + 20, islandHalfSize + 140, -1.5, materials.water);
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

function getTerrainColor(
  x: number,
  z: number,
  height: number,
  seed: number,
  mapPoints: MapLayout["mapPoints"],
  roadSegments: ReadonlyArray<readonly [number, number, number, number]>,
): Color3 {
  let color = height > 4 ? TERRAIN_COLORS.highland : TERRAIN_COLORS.ground;
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
      break;
    }
  }
  if (roadSegments.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 6)) {
    color = TERRAIN_COLORS.roadShoulder;
    naturalSurface = false;
  }
  mapPoints.forEach((point, index) => {
    const poiType = POI_TYPES[index];
    if (!poiType) return;
    const width = poiType === "harbor" ? 138 : 126;
    const depth = poiType === "town" ? 118 : 106;
    if (Math.abs(x - point.position.x) <= width / 2 && Math.abs(z - point.position.z) <= depth / 2) {
      color = index % 2 === 0 ? TERRAIN_COLORS.paving : TERRAIN_COLORS.roadShoulder;
      naturalSurface = false;
    }
  });
  if (roadSegments.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 3.75)) {
    color = TERRAIN_COLORS.road;
    naturalSurface = false;
  }
  mapPoints.forEach((point, index) => {
    if (Math.hypot(x - point.position.x, z - point.position.z) <= 15) {
      color = index % 2 === 0 ? TERRAIN_COLORS.poiDark : TERRAIN_COLORS.poiAccent;
      naturalSurface = false;
    }
  });
  return naturalSurface ? color.scale(terrainSurfaceShade(x, z, height, seed)) : color;
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
    mesh.isVisible = true;
    markBuildingDetail(mesh, slab.obstacleId, slab.kind);
  }

  layout.obstacles.forEach((obstacle, index) => {
    if (obstacle.storyCount === 1) {
      createOpeningFrame(trimTemplate, obstacle, index, "door", -1);
      createOpeningFrame(trimTemplate, obstacle, index, "window", 1);
    }
  });
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

function createOpeningFrame(
  template: Mesh,
  obstacle: { id: string; center: { x: number; y: number; z: number }; width: number; height: number; depth: number },
  index: number,
  detailType: "door" | "window",
  side: -1 | 1,
): void {
  const baseY = obstacle.center.y - obstacle.height / 2;
  const openingWidth = detailType === "door" ? Math.min(4.2, obstacle.width * 0.34) : Math.min(3.6, obstacle.width * 0.3);
  const openingHeight = detailType === "door" ? 3.0 : 2.2;
  const z = obstacle.center.z + side * (obstacle.depth / 2 + 0.02);
  const y = baseY + openingHeight / 2;
  const thickness = 0.12;
  const pieces: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ["left", obstacle.center.x - openingWidth / 2, y, thickness, openingHeight],
    ["right", obstacle.center.x + openingWidth / 2, y, thickness, openingHeight],
    ["top", obstacle.center.x, baseY + openingHeight, openingWidth + thickness, thickness],
  ];
  for (const [pieceName, x, pieceY, width, height] of pieces) {
    const piece = template.clone(`building-${detailType}-frame-${index}-${pieceName}`);
    if (!piece) continue;
    piece.position.set(x, pieceY, z);
    piece.scaling.set(width, height, thickness);
    piece.isVisible = true;
    markBuildingDetail(piece, obstacle.id, detailType);
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
): void {
  const treeCount = 384;
  const mountainTreeCount = 160;
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
      { ...layer, tessellation: 7 },
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
  for (let index = 0; index < treeCount; index += 1) {
    const position = index < mountainTreeCount
      ? randomMountainPosition(random, layout, 5)
      : randomNaturalPosition(random, layout, 5);
    if (!position) continue;
    const { x, z } = position;
    const terrainY = getTerrainHeight(x, z, layout);
    const treeScale = index % 11 === 0 ? 1.4 : 0.96 + (index % 4) * 0.025;
    const foliageScaleY = treeScale * (0.94 + (index % 4) * 0.055);

    const trunk = trunkTemplate.clone(`tree-trunk-${index}`);
    if (trunk) {
      trunk.position.set(x, terrainY + 2.9 * treeScale, z);
      trunk.scaling.set(treeScale * (0.92 + (index % 3) * 0.04), treeScale, treeScale * 0.96);
      trunk.isVisible = true;
      markDecoration(trunk, "vegetation");
    }

    const foliage = foliageTemplate.clone(`tree-foliage-${index}`);
    if (foliage) {
      foliage.position.set(x, terrainY + 5.8 * treeScale + 5.7 * foliageScaleY - 0.25, z);
      foliage.isVisible = true;
      foliage.rotation.y = random() * Math.PI * 2;
      foliage.scaling.set(
        treeScale * (0.9 + (index % 3) * 0.06),
        foliageScaleY,
        treeScale * (0.9 + ((index + 1) % 3) * 0.06),
      );
      markDecoration(foliage, "vegetation");
    }
  }
}

function createNaturalDetails(
  scene: Scene,
  rockMaterial: StandardMaterial,
  shrubMaterial: StandardMaterial,
  layout: MapLayout,
): void {
  const rockCount = 96;
  const mountainRockCount = 48;
  const shrubCount = 180;
  const random = createVisualRandom(layout.seed ^ 0x02e5be93);
  const rockTemplate = CreateSphere("rock-template", { diameter: 1, segments: 5 }, scene);
  rockTemplate.material = rockMaterial;
  rockTemplate.isVisible = false;
  rockTemplate.isPickable = false;

  for (const rock of layout.rockObstacles) {
    const mesh = rockTemplate.clone(rock.id);
    if (!mesh) continue;
    mesh.position.set(rock.center.x, rock.center.y, rock.center.z);
    mesh.scaling.set(rock.width, rock.height, rock.depth);
    mesh.isVisible = true;
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.metadata = { decoration: "cover-rock", obstacleId: rock.id };
    mesh.freezeWorldMatrix();
  }

  for (let index = 0; index < rockCount; index += 1) {
    const rock = rockTemplate.clone(`rock-${index}`);
    if (!rock) continue;
    const position = index < mountainRockCount
      ? randomMountainPosition(random, layout, 3)
      : randomNaturalPosition(random, layout, 3);
    if (!position) continue;
    const { x, z } = position;
    rock.position.set(x, getTerrainHeight(x, z, layout) + 0.42 + (index % 3) * 0.12, z);
    rock.scaling.set(1.2 + (index % 4) * 0.38, 0.72 + (index % 3) * 0.18, 1 + ((index + 2) % 4) * 0.31);
    rock.rotation.y = random() * Math.PI * 2;
    rock.isVisible = true;
    markNaturalDetail(rock, "rock");
  }

  const shrubTemplate = CreateSphere("shrub-template", { diameter: 1, segments: 6 }, scene);
  shrubTemplate.material = shrubMaterial;
  shrubTemplate.isVisible = false;
  shrubTemplate.isPickable = false;
  for (let index = 0; index < shrubCount; index += 1) {
    const shrub = shrubTemplate.clone(`shrub-${index}`);
    if (!shrub) continue;
    const position = randomNaturalPosition(random, layout, 2);
    if (!position) continue;
    const { x, z } = position;
    shrub.position.set(x, getTerrainHeight(x, z, layout) + 0.68, z);
    shrub.scaling.set(2.1 + (index % 3) * 0.42, 1.05 + (index % 2) * 0.24, 1.8 + ((index + 1) % 3) * 0.36);
    shrub.rotation.y = random() * Math.PI * 2;
    shrub.isVisible = true;
    markNaturalDetail(shrub, "shrub");
  }
}

function createPois(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  layout.mapPoints.forEach((point, index) => {
    const poiType = POI_TYPES[index];
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

    if (actor.kind === "player") {
      createPlayerHitbox(scene, root, actor.id, materials.playerHitbox);
    } else {
      createBot(scene, visualRoot, actor.id, materials);
      setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
      setActorParachuteVisual(root, actor.deployment === "parachuting");
    }

    actorRoots.set(actor.id, root);
    actorVisualRoots.set(actor.id, visualRoot);
  }

  return { actorRoots, actorVisualRoots };
}

export function applyActorVisualPose(root: TransformNode, y: number, rotationX: number): void {
  root.position.set(0, y, 0);
  root.rotation.set(rotationX, 0, 0);
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

  const vest = CreateBox(`vest-${actorId}`, { width: 0.66, height: 0.64, depth: 0.09 }, scene);
  vest.parent = root;
  vest.position.set(0, -0.62, 0.4);
  vest.material = materials.gear;
  markActorVisual(vest, actorId, "vest");

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
      mesh.setEnabled(mesh.metadata.weaponId === weaponId && mesh.metadata.weaponFallbackSuppressed !== true);
    }
  }
}

export function setActorParachuteVisual(root: TransformNode, parachuting: boolean): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual === "parachute") mesh.setEnabled(parachuting);
  }
}

function suppressProceduralWeapon(root: TransformNode, weaponId: string): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual !== "weapon" || mesh.metadata.weaponId !== weaponId) continue;
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

function createLootMeshes(
  scene: Scene,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  lootMaterial: StandardMaterial,
  deathLootMaterial: StandardMaterial,
  assets: AssetCatalog,
  showGroundLootIcons: boolean,
): {
  lootMeshes: Map<EntityId, Mesh>;
  syncLootMeshes: (groundLoot: Readonly<Record<EntityId, GroundLootState>>) => void;
} {
  const template = showGroundLootIcons
    ? CreatePlane("loot-marker-template", { size: 1.05 }, scene)
    : CreateBox("loot-marker-template", { size: 0.62 }, scene);
  if (showGroundLootIcons) {
    template.billboardMode = Mesh.BILLBOARDMODE_ALL | Mesh.BILLBOARDMODE_USE_POSITION;
  } else {
    template.rotation.set(0, Math.PI / 4, Math.PI / 4);
  }
  template.material = lootMaterial;
  template.isVisible = false;
  template.isPickable = false;
  const textures = new Map<string, Texture>();
  const iconMaterials = new Map<string, StandardMaterial>();
  const resolvedIcons = new Map<string, AssetEntry>();
  const getIconMaterial = (assetId: string, death: boolean): { material: StandardMaterial; resolvedId: string } => {
    let resolved = resolvedIcons.get(assetId);
    if (!resolved) {
      resolved = assets.resolve(assetId, "image");
      resolvedIcons.set(assetId, resolved);
    }
    const key = `${resolved.id}:${death ? "death" : "spawn"}`;
    let iconMaterial = iconMaterials.get(key);
    if (!iconMaterial) {
      let texture = textures.get(resolved.id);
      if (!texture) {
        if (!resolved.url) throw new Error(`Loot icon ${resolved.id} has no URL`);
        texture = new Texture(resolved.url, scene, false, false);
        texture.name = `loot-icon-texture-${resolved.id}`;
        texture.hasAlpha = resolved.type === "svg";
        textures.set(resolved.id, texture);
      }
      iconMaterial = new StandardMaterial(`loot-icon-material-${key}`, scene);
      iconMaterial.diffuseTexture = texture;
      iconMaterial.diffuseColor = death ? Color3.FromHexString("#ff8169") : Color3.White();
      iconMaterial.emissiveColor = death ? Color3.FromHexString("#7a251d") : Color3.FromHexString("#252a22");
      iconMaterial.specularColor = Color3.Black();
      iconMaterial.disableLighting = true;
      iconMaterial.backFaceCulling = false;
      iconMaterial.useAlphaFromDiffuseTexture = texture.hasAlpha;
      iconMaterials.set(key, iconMaterial);
    }
    return { material: iconMaterial, resolvedId: resolved.id };
  };

  const lootMeshes = new Map<EntityId, Mesh>();
  const adapter: LootMarkerViewAdapter<Mesh> = {
    create(loot) {
      const marker = template.clone(`loot-marker-${loot.id}`);
      if (!marker) {
        throw new Error(`Unable to create marker for loot ${loot.id}`);
      }
      marker.isVisible = true;
      marker.isPickable = true;
      return marker;
    },
    update(marker, loot) {
      const assetId = getItemIconAssetId(loot.itemId);
      const icon = showGroundLootIcons ? getIconMaterial(assetId, loot.source === "death") : null;
      marker.material = icon?.material ?? (loot.source === "death" ? deathLootMaterial : lootMaterial);
      marker.position.set(loot.position.x, loot.position.y + (showGroundLootIcons ? 0.5 : 0), loot.position.z);
      marker.metadata = {
        lootId: loot.id,
        itemId: loot.itemId,
        assetId,
        resolvedAssetId: icon?.resolvedId ?? assetId,
        lootSource: loot.source ?? "spawn",
        lootIcon: showGroundLootIcons,
      };
      marker.setEnabled(loot.available);
    },
  };
  const syncLootMeshes = (nextGroundLoot: Readonly<Record<EntityId, GroundLootState>>): void => {
    syncLootMarkerViews(lootMeshes, nextGroundLoot, adapter);
  };

  syncLootMeshes(groundLoot);
  scene.onDisposeObservable.addOnce(() => {
    lootMeshes.clear();
    textures.clear();
    iconMaterials.clear();
    resolvedIcons.clear();
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
  let lastSignature = "";
  const sync = (centerX: number, centerZ: number, radius: number): void => {
    const signature = `${centerX}:${centerZ}:${radius}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const positions: number[] = [];
    for (let segment = 0; segment <= segmentCount; segment += 1) {
      const angle = segment / segmentCount * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const terrainY = getTerrainHeight(x, z, layout);
      positions.push(x, terrainY + 0.12, z, x, terrainY + 1.5, z);
    }
    const normals = new Array<number>(positions.length).fill(0);
    VertexData.ComputeNormals(positions, indices, normals);
    ring.setVerticesData(VertexBuffer.PositionKind, positions, true);
    ring.setVerticesData(VertexBuffer.NormalKind, normals, true);
    ring.refreshBoundingInfo();
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

function markDecoration(mesh: Mesh, decoration: string): void {
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

function markNaturalDetail(mesh: Mesh, detailType: "rock" | "shrub"): void {
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
  return [...layout.obstacles, ...layout.rockObstacles, ...layout.coverObstacles].some((obstacle) =>
    Math.abs(x - obstacle.center.x) <= obstacle.width / 2 + clearance &&
    Math.abs(z - obstacle.center.z) <= obstacle.depth / 2 + clearance
  );
}
