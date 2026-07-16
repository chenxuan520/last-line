import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
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
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../../assets/AssetCatalog";
import type { AssetEntry } from "../../../assets/types";
import { MAP_OBSTACLES, MAP_POINTS, MAP_SIZE } from "../../../config/map";
import type { ActorState, EntityId, GroundLootState } from "../../../game/state/types";
import { syncLootMarkerViews, type LootMarkerViewAdapter } from "../LootMarkerViewAdapter";
import { loadCatalogModel } from "../loadCatalogModel";

const INITIAL_SAFE_ZONE_RADIUS = MAP_SIZE * 0.36;

interface IslandMaterials {
  ground: StandardMaterial;
  beach: StandardMaterial;
  water: StandardMaterial;
  highland: StandardMaterial;
  trunk: StandardMaterial;
  foliage: StandardMaterial;
  poiAccent: StandardMaterial;
  poiDark: StandardMaterial;
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
  safeZoneRing: Mesh;
}

export async function createIslandScene(
  engine: Engine,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  groundLoot: Readonly<Record<EntityId, GroundLootState>>,
): Promise<IslandSceneBundle> {
  const player = Object.values(actors).find((actor) => actor.kind === "player");
  if (!player) {
    throw new Error("Island scene requires one player actor");
  }

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.42, 0.62, 0.7, 1);
  scene.collisionsEnabled = true;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 320;
  scene.fogEnd = 720;
  scene.fogColor = new Color3(0.55, 0.68, 0.7);
  scene.skipPointerMovePicking = true;

  const ambient = new HemisphericLight("island-ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.82;
  ambient.diffuse = new Color3(0.9, 0.94, 0.8);
  ambient.groundColor = new Color3(0.18, 0.24, 0.2);

  const sun = new DirectionalLight("island-sun", new Vector3(-0.55, -1, 0.35), scene);
  sun.position = new Vector3(180, 260, -140);
  sun.intensity = 1.05;

  const materials = createMaterials(scene, assets);
  createIslandEnvironment(scene, materials);
  createPois(scene, materials);

  const actorRoots = createActors(scene, actors, materials);
  const camera = createCamera(scene, player);
  createViewWeapon(scene, camera, materials);
  await replaceCatalogModels(scene, assets, actors, actorRoots, camera);

  const { lootMeshes, syncLootMeshes } = createLootMeshes(scene, groundLoot, materials.loot);
  const safeZoneRing = createSafeZoneRing(scene, materials.safeZone);

  return { scene, camera, actorRoots, lootMeshes, syncLootMeshes, safeZoneRing };
}

async function replaceCatalogModels(
  scene: Scene,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
  actorRoots: Map<EntityId, TransformNode>,
  camera: UniversalCamera,
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
    attachModel(instance.rootNodes, camera, weapon.descriptor);
    scene.onDisposeObservable.addOnce(() => weapon.container.dispose());
  }
}

function attachModel(
  nodes: readonly Node[],
  parent: TransformNode | UniversalCamera,
  descriptor: AssetEntry,
): void {
  const scale = numberMetadata(descriptor, "scale", 1);
  const characterModel = parent instanceof TransformNode;
  const x = numberMetadata(descriptor, "offsetX", characterModel ? 0 : 0.38);
  const y = numberMetadata(descriptor, "offsetY", characterModel ? -1.76 : -0.34);
  const z = numberMetadata(descriptor, "offsetZ", characterModel ? 0 : 0.76);
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

  const water = material(scene, "island-water-material", "#32778b");
  water.alpha = 0.86;
  water.specularColor = new Color3(0.38, 0.56, 0.62);

  const playerHitbox = material(scene, "player-hitbox-material", playerColor);
  playerHitbox.alpha = 0.001;

  const loot = material(scene, "loot-marker-material", lootColor);
  loot.emissiveColor = Color3.FromHexString(lootColor).scale(0.48);

  const safeZone = material(scene, "safe-zone-material", hudColor);
  safeZone.emissiveColor = Color3.FromHexString(hudColor);
  safeZone.disableLighting = true;
  safeZone.alpha = 0.9;

  return {
    ground: material(scene, "island-ground-material", "#667d4f"),
    beach: material(scene, "island-beach-material", "#b6a56f"),
    water,
    highland: material(scene, "highland-material", "#526044"),
    trunk: material(scene, "tree-trunk-material", "#66513b"),
    foliage: material(scene, "tree-foliage-material", "#355a3d"),
    poiAccent: material(scene, "poi-accent-material", "#b8874d"),
    poiDark: material(scene, "poi-dark-material", "#485057"),
    botBody: material(scene, "bot-body-material", botColor),
    playerHitbox,
    gear: material(scene, "actor-gear-material", "#252d2b"),
    weapon: material(scene, "weapon-material", weaponColor),
    loot,
    safeZone,
  };
}

function createIslandEnvironment(scene: Scene, materials: IslandMaterials): void {
  const water = CreateGround("ocean", { width: MAP_SIZE + 280, height: MAP_SIZE + 280 }, scene);
  water.position.y = -1.5;
  water.material = materials.water;
  water.isPickable = false;

  const beach = CreateGround("island-beach", { width: MAP_SIZE + 14, height: MAP_SIZE + 14 }, scene);
  beach.position.y = -0.28;
  beach.material = materials.beach;
  beach.isPickable = false;

  const ground = CreateGround("island-ground", { width: MAP_SIZE, height: MAP_SIZE }, scene);
  ground.material = materials.ground;
  markEnvironment(ground, "island-ground");

  const buildingMaterials = new Map<string, StandardMaterial>();
  for (const obstacle of MAP_OBSTACLES) {
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

  createHighlands(scene, materials.highland);
  createVegetation(scene, materials.trunk, materials.foliage);
}

function createHighlands(scene: Scene, highlandMaterial: StandardMaterial): void {
  const highlands: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [-326, -278, 86, 50, 14],
    [-286, 302, 72, 46, 11],
    [-42, 330, 90, 58, 16],
    [304, 286, 76, 48, 13],
    [328, -54, 68, 42, 10],
    [276, -310, 94, 56, 17],
    [-88, -334, 82, 50, 12],
    [-336, 34, 66, 44, 9],
  ];

  highlands.forEach(([x, z, width, depth, height], index) => {
    const hill = CreateCylinder(
      `highland-${index}`,
      {
        height,
        diameterTop: width * 0.7,
        diameterBottom: width,
        tessellation: 7,
      },
      scene,
    );
    hill.position.set(x, height / 2 - 0.2, z);
    hill.scaling.z = depth / width;
    hill.rotation.y = index * 0.37;
    hill.material = highlandMaterial;
    markDecoration(hill, "highland");
  });
}

function createVegetation(
  scene: Scene,
  trunkMaterial: StandardMaterial,
  foliageMaterial: StandardMaterial,
): void {
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

  for (let index = 0; index < 32; index += 1) {
    const angle = index * 2.39996;
    const radius = 270 + (index % 5) * 21;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const trunk = trunkTemplate.clone(`tree-trunk-${index}`);
    if (trunk) {
      trunk.position.set(x, 1.4, z);
      trunk.isVisible = true;
      markDecoration(trunk, "vegetation");
    }

    const foliage = foliageTemplate.clone(`tree-foliage-${index}`);
    if (foliage) {
      foliage.position.set(x, 5.7, z);
      foliage.isVisible = true;
      foliage.rotation.y = angle;
      foliage.scaling.y = 0.82 + (index % 3) * 0.12;
      markDecoration(foliage, "vegetation");
    }
  }
}

function createPois(scene: Scene, materials: IslandMaterials): void {
  const poiTypes = ["harbor", "town", "warehouse", "station"] as const;

  MAP_POINTS.forEach((point, index) => {
    const poiType = poiTypes[index];
    if (!poiType) {
      return;
    }

    const pad = CreateCylinder(
      `poi-${poiType}-pad`,
      { height: 0.12, diameter: 30, tessellation: poiType === "warehouse" ? 4 : 12 },
      scene,
    );
    pad.position.set(point.position.x, 0.07, point.position.z);
    pad.material = index % 2 === 0 ? materials.poiDark : materials.poiAccent;
    pad.rotation.y = Math.PI / 4;
    markPoiDecoration(pad, point.name, poiType);

    if (poiType === "harbor") {
      for (let lane = -1; lane <= 1; lane += 1) {
        const dock = CreateBox(`poi-harbor-dock-${lane}`, { width: 7, height: 0.6, depth: 32 }, scene);
        dock.position.set(point.position.x + lane * 10, 0.4, point.position.z + 8);
        dock.material = materials.poiAccent;
        markPoiDecoration(dock, point.name, poiType);
      }
      createCrane(scene, point.position.x - 16, point.position.z - 8, materials.poiDark, point.name);
    } else if (poiType === "town") {
      const tower = CreateCylinder("poi-town-water-tower", { height: 14, diameter: 2.2, tessellation: 8 }, scene);
      tower.position.set(point.position.x, 7, point.position.z);
      tower.material = materials.poiDark;
      markPoiDecoration(tower, point.name, poiType);

      const tank = CreateSphere("poi-town-water-tank", { diameter: 7, segments: 8 }, scene);
      tank.position.set(point.position.x, 14, point.position.z);
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
          1.35,
          point.position.z + Math.floor(containerIndex / 2) * 10 - 5,
        );
        container.material = containerIndex % 2 === 0 ? materials.poiAccent : materials.poiDark;
        markPoiDecoration(container, point.name, poiType);
      }
    } else {
      const mast = CreateCylinder("poi-station-mast", { height: 22, diameter: 1.2, tessellation: 8 }, scene);
      mast.position.set(point.position.x, 11, point.position.z);
      mast.material = materials.poiDark;
      markPoiDecoration(mast, point.name, poiType);

      const beacon = CreateSphere("poi-station-beacon", { diameter: 3.8, segments: 8 }, scene);
      beacon.position.set(point.position.x, 22.5, point.position.z);
      beacon.material = materials.poiAccent;
      markPoiDecoration(beacon, point.name, poiType);
    }
  });
}

function createCrane(
  scene: Scene,
  x: number,
  z: number,
  craneMaterial: StandardMaterial,
  poiName: string,
): void {
  const upright = CreateBox("poi-harbor-crane-upright", { width: 1.5, height: 13, depth: 1.5 }, scene);
  upright.position.set(x, 6.5, z);
  upright.material = craneMaterial;
  markPoiDecoration(upright, poiName, "harbor");

  const boom = CreateBox("poi-harbor-crane-boom", { width: 13, height: 1, depth: 1 }, scene);
  boom.position.set(x + 5, 12.5, z);
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
    root.setEnabled(actor.alive);

    if (actor.kind === "player") {
      createPlayerHitbox(scene, root, actor.id, materials.playerHitbox);
    } else {
      createBot(scene, root, actor.id, materials);
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

  const head = CreateSphere(`head-${actorId}`, { diameter: 0.48, segments: 7 }, scene);
  head.parent = root;
  head.position.y = 0.13;
  head.material = materials.gear;
  markActor(head, actorId);

  const rifle = CreateBox(`rifle-${actorId}`, { width: 0.13, height: 0.15, depth: 1.02 }, scene);
  rifle.parent = root;
  rifle.position.set(0.28, -0.43, 0.3);
  rifle.rotation.x = -0.12;
  rifle.material = materials.weapon;
  rifle.isPickable = false;
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

function createViewWeapon(scene: Scene, camera: UniversalCamera, materials: IslandMaterials): void {
  const receiver = CreateBox("view-rifle-receiver", { width: 0.22, height: 0.2, depth: 0.82 }, scene);
  receiver.parent = camera;
  receiver.position.set(0.38, -0.34, 0.76);
  receiver.rotation.y = -0.04;
  receiver.material = materials.weapon;
  receiver.isPickable = false;

  const stock = CreateBox("view-rifle-stock", { width: 0.2, height: 0.25, depth: 0.38 }, scene);
  stock.parent = camera;
  stock.position.set(0.39, -0.37, 0.23);
  stock.rotation.x = 0.15;
  stock.material = materials.gear;
  stock.isPickable = false;

  const barrel = CreateCylinder(
    "view-rifle-barrel",
    { diameter: 0.07, height: 0.72, tessellation: 8 },
    scene,
  );
  barrel.parent = camera;
  barrel.position.set(0.38, -0.29, 1.46);
  barrel.rotation.x = Math.PI / 2;
  barrel.material = materials.gear;
  barrel.isPickable = false;
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

function createSafeZoneRing(scene: Scene, safeZoneMaterial: StandardMaterial): Mesh {
  const ring = CreateTorus(
    "safe-zone-ring",
    { diameter: INITIAL_SAFE_ZONE_RADIUS * 2, thickness: 1.2, tessellation: 64 },
    scene,
  );
  ring.position.y = 0.18;
  ring.material = safeZoneMaterial;
  ring.isPickable = false;
  ring.metadata = { visual: "safe-zone", baseRadius: INITIAL_SAFE_ZONE_RADIUS };
  return ring;
}

function markEnvironment(mesh: Mesh, obstacleId: string): void {
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.metadata = { environment: true, collision: true, obstacleId };
}

function markActor(mesh: Mesh, actorId: EntityId): void {
  mesh.isPickable = true;
  mesh.metadata = { actorId };
}

function markDecoration(mesh: Mesh, decoration: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration };
}

function markPoiDecoration(mesh: Mesh, poiName: string, poiType: string): void {
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { decoration: "poi", poiName, poiType };
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
