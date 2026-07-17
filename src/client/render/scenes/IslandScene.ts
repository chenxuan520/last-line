import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../../assets/AssetCatalog";
import type { AssetEntry } from "../../../assets/types";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  MAP_POINTS,
  MAP_SIZE,
  TERRAIN_GRID_SUBDIVISIONS,
  type MapLayout,
} from "../../../config/map";
import { getActiveWeapon, type ActorState, type EntityId, type GroundLootState } from "../../../game/state/types";
import { syncLootMarkerViews, type LootMarkerViewAdapter } from "../LootMarkerViewAdapter";
import { loadCatalogModel } from "../loadCatalogModel";

const INITIAL_SAFE_ZONE_RADIUS = MAP_SIZE * 0.36;
const TERRAIN_PATCHES: ReadonlyArray<readonly [number, number, number, number, number, "mud" | "grass"]> = [
  [-310, -190, 92, 58, 0.2, "grass"],
  [-260, 84, 72, 42, -0.45, "mud"],
  [-118, 278, 104, 54, 0.14, "grass"],
  [42, 284, 82, 44, -0.28, "mud"],
  [248, 224, 110, 62, 0.32, "grass"],
  [310, 92, 74, 48, -0.52, "mud"],
  [292, -104, 92, 52, 0.22, "grass"],
  [248, -286, 112, 56, -0.16, "mud"],
  [72, -306, 88, 50, 0.42, "grass"],
  [-82, -258, 108, 64, -0.22, "mud"],
  [-286, -306, 78, 46, 0.31, "grass"],
  [-332, 18, 76, 52, -0.12, "mud"],
  [-48, 42, 94, 58, 0.38, "grass"],
  [82, -54, 70, 42, -0.35, "mud"],
  [322, 330, 64, 38, 0.18, "grass"],
  [-330, 322, 86, 48, -0.28, "mud"],
];
const ROAD_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-210, 205, -30, 180],
  [-30, 180, 120, 155],
  [120, 155, 145, 0],
  [145, 0, 190, -185],
  [190, -185, 15, -150],
  [15, -150, -155, -115],
  [-155, -115, -190, 35],
  [-190, 35, -210, 205],
  [-190, 35, 145, 0],
];
const POI_TYPES = ["harbor", "town", "warehouse", "station"] as const;
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
  poiAccent: StandardMaterial;
  poiDark: StandardMaterial;
  roof: StandardMaterial;
  wallTrim: StandardMaterial;
  window: StandardMaterial;
  door: StandardMaterial;
  botBody: StandardMaterial;
  playerHitbox: StandardMaterial;
  gear: StandardMaterial;
  weapon: StandardMaterial;
  loot: StandardMaterial;
  safeZone: StandardMaterial;
}

export interface IslandSceneBundle {
  scene: Scene;
  camera: UniversalCamera;
  actorRoots: Map<EntityId, TransformNode>;
  lootMeshes: Map<EntityId, Mesh>;
  syncLootMeshes: (groundLoot: Readonly<Record<EntityId, GroundLootState>>) => void;
  viewWeaponRoot: TransformNode;
  aircraftVisualRoot: TransformNode;
  safeZoneRing: Mesh;
  syncSafeZoneRing: (centerX: number, centerZ: number, radius: number) => void;
}

export async function createIslandScene(
  engine: Engine,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  mapSeed = 0,
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
  scene.fogStart = 390;
  scene.fogEnd = 940;
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

  const actorRoots = createActors(scene, actors, materials);
  const camera = createCamera(scene, player);
  const aircraftVisualRoot = createAircraftVisual(scene, camera, materials);
  aircraftVisualRoot.setEnabled(player.deployment === "aircraft");
  const viewWeaponRoot = createViewWeapon(scene, camera, materials);
  viewWeaponRoot.setEnabled(Boolean(getActiveWeapon(player)));
  await replaceCatalogModels(scene, assets, actors, actorRoots, viewWeaponRoot);

  const { lootMeshes, syncLootMeshes } = createLootMeshes(scene, groundLoot, materials.loot);
  const { mesh: safeZoneRing, sync: syncSafeZoneRing } = createSafeZoneRing(scene, materials.safeZone, layout);

  return {
    scene,
    camera,
    actorRoots,
    lootMeshes,
    syncLootMeshes,
    viewWeaponRoot,
    aircraftVisualRoot,
    safeZoneRing,
    syncSafeZoneRing,
  };
}

async function replaceCatalogModels(
  scene: Scene,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  actorRoots: Map<EntityId, TransformNode>,
  viewWeaponRoot: TransformNode,
): Promise<void> {
  const [character, weapon] = await Promise.all([
    loadCatalogModel(scene, assets, "model.character.enemy"),
    loadCatalogModel(scene, assets, "model.weapon.rifle"),
  ]);

  if (character) {
    for (const actor of Object.values(actors)) {
      if (actor.kind !== "bot") continue;
      const root = actorRoots.get(actor.id);
      if (!root) continue;
      root.getChildMeshes().forEach((mesh) => mesh.setEnabled(false));
      const instance = character.container.instantiateModelsToScene((name) => `${actor.id}-${name}`);
      attachModel(instance.rootNodes, root, character.descriptor);
    }
    scene.onDisposeObservable.addOnce(() => character.container.dispose());
  }

  if (weapon) {
    scene.meshes.filter((mesh) => mesh.name.startsWith("view-rifle-")).forEach((mesh) => mesh.setEnabled(false));
    const instance = weapon.container.instantiateModelsToScene((name) => `view-${name}`);
    attachModel(instance.rootNodes, viewWeaponRoot, weapon.descriptor, true);
    scene.onDisposeObservable.addOnce(() => weapon.container.dispose());
  }
}

function attachModel(
  nodes: readonly Node[],
  parent: TransformNode | UniversalCamera,
  descriptor: AssetEntry,
  viewModel = false,
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
    for (const mesh of node.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.metadata = { visualModel: descriptor.id };
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
  const weaponColor = assetColor(assets, "model.weapon.rifle", "model", "#283126");
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

  const safeZone = material(scene, "safe-zone-material", hudColor);
  safeZone.emissiveColor = Color3.FromHexString(hudColor);
  safeZone.disableLighting = true;
  safeZone.alpha = 0.9;
  safeZone.backFaceCulling = false;

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
    poiAccent: material(scene, "poi-accent-material", "#a37848"),
    poiDark: material(scene, "poi-dark-material", "#434b4f"),
    roof: material(scene, "building-roof-material", "#343b3b"),
    wallTrim: material(scene, "building-trim-material", "#8a8069"),
    window: windowMaterial,
    door: material(scene, "building-door-material", "#4c3d31"),
    botBody: material(scene, "bot-body-material", botColor),
    playerHitbox,
    gear: material(scene, "actor-gear-material", "#252d2b"),
    weapon: material(scene, "weapon-material", weaponColor),
    loot,
    safeZone,
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
  for (const obstacle of layout.obstacles) {
    let buildingMaterial = buildingMaterials.get(obstacle.color);
    if (!buildingMaterial) {
      buildingMaterial = material(scene, `building-material-${buildingMaterials.size}`, obstacle.color);
      buildingMaterials.set(obstacle.color, buildingMaterial);
    }

    const building = CreateBox(
      obstacle.id,
      { width: obstacle.width, height: obstacle.height, depth: obstacle.depth },
      scene,
    );
    building.position.set(obstacle.center.x, obstacle.center.y, obstacle.center.z);
    building.material = buildingMaterial;
    markEnvironment(building, obstacle.id);
  }

  createBuildingDetails(scene, materials, layout);
  createRoofRamps(scene, materials, layout);
  createVegetation(scene, materials.trunk, materials.foliage, layout);
  createNaturalDetails(scene, materials.rock, materials.shrub, layout);
}

function applyTerrainSurface(ground: Mesh, layout: MapLayout): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const colors: number[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const z = positions[index + 2] ?? 0;
    const height = getTerrainHeight(x, z, layout);
    const color = getTerrainColor(x, z, height);
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

function getTerrainColor(x: number, z: number, height: number): Color3 {
  let color = height > 4 ? TERRAIN_COLORS.highland : TERRAIN_COLORS.ground;
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
  if (ROAD_SEGMENTS.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 6)) {
    color = TERRAIN_COLORS.roadShoulder;
  }
  MAP_POINTS.forEach((point, index) => {
    const poiType = POI_TYPES[index];
    if (!poiType) return;
    const width = poiType === "harbor" ? 138 : 126;
    const depth = poiType === "town" ? 118 : 106;
    if (Math.abs(x - point.position.x) <= width / 2 && Math.abs(z - point.position.z) <= depth / 2) {
      color = index % 2 === 0 ? TERRAIN_COLORS.paving : TERRAIN_COLORS.roadShoulder;
    }
  });
  if (ROAD_SEGMENTS.some(([startX, startZ, endX, endZ]) => pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= 3.75)) {
    color = TERRAIN_COLORS.road;
  }
  MAP_POINTS.forEach((point, index) => {
    if (Math.hypot(x - point.position.x, z - point.position.z) <= 15) {
      color = index % 2 === 0 ? TERRAIN_COLORS.poiDark : TERRAIN_COLORS.poiAccent;
    }
  });
  return color;
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
  const windowTemplate = CreateBox("building-window-template", { size: 1 }, scene);
  windowTemplate.material = materials.window;
  windowTemplate.isVisible = false;
  windowTemplate.isPickable = false;
  const doorTemplate = CreateBox("building-door-template", { size: 1 }, scene);
  doorTemplate.material = materials.door;
  doorTemplate.isVisible = false;
  doorTemplate.isPickable = false;

  layout.obstacles.forEach((obstacle, index) => {
    const roof = roofTemplate.clone(`building-roof-${index}`);
    if (roof) {
      roof.position.set(
        obstacle.center.x,
        obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT / 2,
        obstacle.center.z,
      );
      roof.scaling.set(obstacle.width, BUILDING_ROOF_CAP_HEIGHT, obstacle.depth);
      roof.isVisible = true;
      markBuildingDetail(roof, obstacle.id, "roof");
    }

    const door = doorTemplate.clone(`building-door-${index}`);
    if (door) {
      const baseY = obstacle.center.y - obstacle.height / 2;
      door.position.set(obstacle.center.x, baseY + 1.55, obstacle.center.z - obstacle.depth / 2 - 0.045);
      door.scaling.set(1.9, 3.1, 0.09);
      door.isVisible = true;
      markBuildingDetail(door, obstacle.id, "door");
    }

    const window = windowTemplate.clone(`building-window-${index}`);
    if (window) {
      window.position.set(
        obstacle.center.x + obstacle.width * 0.25,
        obstacle.center.y + obstacle.height * 0.15,
        obstacle.center.z - obstacle.depth / 2 - 0.055,
      );
      window.scaling.set(2.5, 1.65, 0.08);
      window.isVisible = true;
      markBuildingDetail(window, obstacle.id, "window");
    }
  });
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

function createVegetation(
  scene: Scene,
  trunkMaterial: StandardMaterial,
  foliageMaterial: StandardMaterial,
  layout: MapLayout,
): void {
  const treeCount = 24;
  const trunkTemplate = CreateCylinder(
    "tree-trunk-template",
    { height: 2.8, diameterTop: 0.5, diameterBottom: 0.8, tessellation: 5 },
    scene,
  );
  trunkTemplate.material = trunkMaterial;
  trunkTemplate.isVisible = false;
  trunkTemplate.isPickable = false;

  const foliageTemplate = CreateCylinder(
    "tree-foliage-template",
    { height: 6.2, diameterTop: 0.2, diameterBottom: 4.2, tessellation: 6 },
    scene,
  );
  foliageTemplate.material = foliageMaterial;
  foliageTemplate.isVisible = false;
  foliageTemplate.isPickable = false;

  for (let index = 0; index < treeCount; index += 1) {
    const angle = index * 2.39996;
    const radius = 118 + ((index * 47) % 238);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const terrainY = getTerrainHeight(x, z, layout);

    const trunk = trunkTemplate.clone(`tree-trunk-${index}`);
    if (trunk) {
      trunk.position.set(x, terrainY + 1.4, z);
      trunk.isVisible = true;
      markDecoration(trunk, "vegetation");
    }

    const foliage = foliageTemplate.clone(`tree-foliage-${index}`);
    if (foliage) {
      foliage.position.set(x, terrainY + 5.7, z);
      foliage.isVisible = true;
      foliage.rotation.y = angle;
      foliage.scaling.y = 0.82 + (index % 3) * 0.12;
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
  const rockCount = 10;
  const shrubCount = 12;
  const rockTemplate = CreateSphere("rock-template", { diameter: 1, segments: 5 }, scene);
  rockTemplate.material = rockMaterial;
  rockTemplate.isVisible = false;
  rockTemplate.isPickable = false;

  for (let index = 0; index < rockCount; index += 1) {
    const angle = index * 2.17 + 0.4;
    const radius = 92 + ((index * 73) % 278);
    const rock = rockTemplate.clone(`rock-${index}`);
    if (!rock) continue;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    rock.position.set(x, getTerrainHeight(x, z, layout) + 0.42 + (index % 3) * 0.12, z);
    rock.scaling.set(1.2 + (index % 4) * 0.38, 0.72 + (index % 3) * 0.18, 1 + ((index + 2) % 4) * 0.31);
    rock.rotation.y = angle * 1.7;
    rock.isVisible = true;
    markNaturalDetail(rock, "rock");
  }

  const shrubTemplate = CreateSphere("shrub-template", { diameter: 1, segments: 6 }, scene);
  shrubTemplate.material = shrubMaterial;
  shrubTemplate.isVisible = false;
  shrubTemplate.isPickable = false;
  for (let index = 0; index < shrubCount; index += 1) {
    const angle = index * 2.53 - 0.6;
    const radius = 76 + ((index * 59) % 302);
    const shrub = shrubTemplate.clone(`shrub-${index}`);
    if (!shrub) continue;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    shrub.position.set(x, getTerrainHeight(x, z, layout) + 0.68, z);
    shrub.scaling.set(2.1 + (index % 3) * 0.42, 1.05 + (index % 2) * 0.24, 1.8 + ((index + 1) % 3) * 0.36);
    shrub.rotation.y = angle;
    shrub.isVisible = true;
    markNaturalDetail(shrub, "shrub");
  }
}

function createPois(scene: Scene, materials: IslandMaterials, layout: MapLayout): void {
  MAP_POINTS.forEach((point, index) => {
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
): Map<EntityId, TransformNode> {
  const actorRoots = new Map<EntityId, TransformNode>();

  for (const actor of Object.values(actors)) {
    const root = new TransformNode(`actor-${actor.id}`, scene);
    root.position.set(actor.position.x, actor.position.y, actor.position.z);
    root.rotation.y = actor.yaw;
    root.metadata = { actorId: actor.id, actorKind: actor.kind };
    root.setEnabled(actor.alive && actor.deployment !== "aircraft");

    if (actor.kind === "player") {
      createPlayerHitbox(scene, root, actor.id, materials.playerHitbox);
    } else {
      createBot(scene, root, actor.id, materials);
      setActorWeaponVisual(root, Boolean(getActiveWeapon(actor)));
    }

    actorRoots.set(actor.id, root);
  }

  return actorRoots;
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

  const rifle = CreateBox(`rifle-${actorId}`, { width: 0.15, height: 0.17, depth: 0.72 }, scene);
  rifle.parent = root;
  rifle.position.set(0.28, -0.43, 0.31);
  rifle.rotation.x = -0.12;
  rifle.material = materials.weapon;
  markActorVisual(rifle, actorId, "rifle");

  const rifleStock = CreateBox(`rifle-stock-${actorId}`, { width: 0.17, height: 0.2, depth: 0.34 }, scene);
  rifleStock.parent = root;
  rifleStock.position.set(0.28, -0.44, -0.22);
  rifleStock.rotation.x = -0.12;
  rifleStock.material = materials.gear;
  markActorVisual(rifleStock, actorId, "rifle");

  const rifleBarrel = CreateCylinder(
    `rifle-barrel-${actorId}`,
    { diameter: 0.055, height: 0.62, tessellation: 7 },
    scene,
  );
  rifleBarrel.parent = root;
  rifleBarrel.position.set(0.28, -0.37, 0.94);
  rifleBarrel.rotation.x = Math.PI / 2 - 0.12;
  rifleBarrel.material = materials.gear;
  markActorVisual(rifleBarrel, actorId, "rifle");

  const magazine = CreateBox(`rifle-magazine-${actorId}`, { width: 0.12, height: 0.3, depth: 0.2 }, scene);
  magazine.parent = root;
  magazine.position.set(0.28, -0.62, 0.29);
  magazine.rotation.x = 0.18;
  magazine.material = materials.gear;
  markActorVisual(magazine, actorId, "rifle");
}

export function setActorWeaponVisual(root: TransformNode, armed: boolean): void {
  for (const mesh of root.getChildMeshes(false)) {
    if (mesh.metadata?.actorVisual === "rifle") mesh.setEnabled(armed);
  }
}

function createCamera(scene: Scene, player: ActorState): UniversalCamera {
  const camera = new UniversalCamera(
    "player-camera",
    new Vector3(player.position.x, player.position.y, player.position.z),
    scene,
  );
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.minZ = 0.05;
  camera.maxZ = 1_050;
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

function createAircraftVisual(scene: Scene, camera: UniversalCamera, materials: IslandMaterials): TransformNode {
  const root = new TransformNode("aircraft-visual-root", scene);
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

function createViewWeapon(scene: Scene, camera: UniversalCamera, materials: IslandMaterials): TransformNode {
  const root = new TransformNode("view-weapon-root", scene);
  root.parent = camera;
  const receiver = CreateBox("view-rifle-receiver", { width: 0.22, height: 0.2, depth: 0.68 }, scene);
  receiver.parent = root;
  receiver.position.set(0.38, -0.34, 0.7);
  receiver.rotation.y = -0.04;
  receiver.material = materials.weapon;
  receiver.isPickable = false;

  const stock = CreateBox("view-rifle-stock", { width: 0.2, height: 0.25, depth: 0.38 }, scene);
  stock.parent = root;
  stock.position.set(0.39, -0.37, 0.23);
  stock.rotation.x = 0.15;
  stock.material = materials.gear;
  stock.isPickable = false;

  const handguard = CreateBox("view-rifle-handguard", { width: 0.18, height: 0.16, depth: 0.52 }, scene);
  handguard.parent = root;
  handguard.position.set(0.38, -0.32, 1.27);
  handguard.material = materials.weapon;
  handguard.isPickable = false;

  const barrel = CreateCylinder(
    "view-rifle-barrel",
    { diameter: 0.065, height: 0.58, tessellation: 8 },
    scene,
  );
  barrel.parent = root;
  barrel.position.set(0.38, -0.29, 1.78);
  barrel.rotation.x = Math.PI / 2;
  barrel.material = materials.gear;
  barrel.isPickable = false;

  const muzzle = CreateCylinder("view-rifle-muzzle", { diameter: 0.095, height: 0.18, tessellation: 8 }, scene);
  muzzle.parent = root;
  muzzle.position.set(0.38, -0.29, 2.08);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.material = materials.gear;
  muzzle.isPickable = false;

  const magazine = CreateBox("view-rifle-magazine", { width: 0.15, height: 0.38, depth: 0.24 }, scene);
  magazine.parent = root;
  magazine.position.set(0.38, -0.57, 0.72);
  magazine.rotation.x = 0.17;
  magazine.material = materials.gear;
  magazine.isPickable = false;

  const grip = CreateBox("view-rifle-grip", { width: 0.12, height: 0.32, depth: 0.16 }, scene);
  grip.parent = root;
  grip.position.set(0.38, -0.53, 1.14);
  grip.rotation.x = -0.12;
  grip.material = materials.gear;
  grip.isPickable = false;

  const rail = CreateBox("view-rifle-rail", { width: 0.14, height: 0.035, depth: 0.72 }, scene);
  rail.parent = root;
  rail.position.set(0.38, -0.22, 0.95);
  rail.material = materials.gear;
  rail.isPickable = false;

  for (const [name, z] of [
    ["rear", 0.67],
    ["front", 1.42],
  ] as const) {
    const sight = CreateBox(`view-rifle-${name}-sight`, { width: 0.09, height: 0.11, depth: 0.045 }, scene);
    sight.parent = root;
    sight.position.set(0.38, -0.15, z);
    sight.material = materials.gear;
    sight.isPickable = false;
  }
  return root;
}

function createLootMeshes(
  scene: Scene,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
  lootMaterial: StandardMaterial,
): {
  lootMeshes: Map<EntityId, Mesh>;
  syncLootMeshes: (groundLoot: Readonly<Record<EntityId, GroundLootState>>) => void;
} {
  const template = CreateBox("loot-marker-template", { size: 0.62 }, scene);
  template.rotation.set(0, Math.PI / 4, Math.PI / 4);
  template.material = lootMaterial;
  template.isVisible = false;
  template.isPickable = false;

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
      marker.position.set(loot.position.x, loot.position.y, loot.position.z);
      marker.metadata = {
        lootId: loot.id,
        itemId: loot.itemId,
        assetId: "ui.weapon.rifle",
      };
      marker.setEnabled(loot.available);
    },
  };
  const syncLootMeshes = (nextGroundLoot: Readonly<Record<EntityId, GroundLootState>>): void => {
    syncLootMarkerViews(lootMeshes, nextGroundLoot, adapter);
  };

  syncLootMeshes(groundLoot);
  scene.onDisposeObservable.addOnce(() => lootMeshes.clear());

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
