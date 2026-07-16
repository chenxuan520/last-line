import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import type { AssetCatalog } from "../../assets/AssetCatalog";
import type { ActorState, EntityId } from "../../game/state/types";

export interface TrainingSceneBundle {
  scene: Scene;
  camera: UniversalCamera;
  actorRoots: Map<EntityId, TransformNode>;
  playerHitMesh: Mesh;
}

export function createTrainingScene(
  engine: Engine,
  assets: AssetCatalog,
  actors: Readonly<Record<EntityId, ActorState>>,
): TrainingSceneBundle {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.34, 0.46, 0.52, 1);
  scene.collisionsEnabled = true;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = 36;
  scene.fogEnd = 92;
  scene.fogColor = new Color3(0.42, 0.5, 0.48);

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.76;
  ambient.diffuse = new Color3(0.82, 0.9, 0.78);
  ambient.groundColor = new Color3(0.2, 0.24, 0.18);

  const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.4), scene);
  sun.position = new Vector3(20, 38, -24);
  sun.intensity = 1.1;

  createEnvironment(scene);

  const camera = new UniversalCamera("player-camera", new Vector3(0, 1.76, -16), scene);
  camera.minZ = 0.05;
  camera.fov = 1.18;
  camera.checkCollisions = true;
  camera.inertia = 0;
  camera.ellipsoid = new Vector3(0.42, 0.88, 0.42);
  camera.ellipsoidOffset = new Vector3(0, -0.88, 0);
  scene.activeCamera = camera;
  createViewWeapon(scene, camera, assets);

  const actorRoots = new Map<EntityId, TransformNode>();
  for (const actor of Object.values(actors)) {
    if (actor.kind !== "bot") {
      continue;
    }
    actorRoots.set(actor.id, createSoldier(scene, actor, assets));
  }

  const playerHitMesh = MeshBuilder.CreateCapsule(
    "player-hitbox",
    { height: 1.72, radius: 0.42, tessellation: 8 },
    scene,
  );
  const hitboxMaterial = new StandardMaterial("player-hitbox-material", scene);
  hitboxMaterial.alpha = 0.001;
  playerHitMesh.material = hitboxMaterial;
  playerHitMesh.isPickable = true;
  playerHitMesh.metadata = { actorId: "player" };

  return { scene, camera, actorRoots, playerHitMesh };
}

function createEnvironment(scene: Scene): void {
  const groundMaterial = material(scene, "ground-material", "#59694a");
  const ground = MeshBuilder.CreateGround("training-ground", { width: 80, height: 80 }, scene);
  ground.material = groundMaterial;
  markEnvironment(ground);

  const wallMaterial = material(scene, "wall-material", "#40483c");
  const wallDefinitions: Array<[number, number, number, number]> = [
    [0, 2.5, 40, 80],
    [0, 2.5, -40, 80],
    [40, 2.5, 0, 80],
    [-40, 2.5, 0, 80],
  ];
  wallDefinitions.forEach(([x, y, z, width], index) => {
    const alongX = z !== 0;
    const wall = MeshBuilder.CreateBox(
      `perimeter-${index}`,
      { width: alongX ? width : 0.7, height: 5, depth: alongX ? 0.7 : width },
      scene,
    );
    wall.position.set(x, y, z);
    wall.material = wallMaterial;
    markEnvironment(wall);
  });

  const crateMaterial = material(scene, "crate-material", "#807056");
  const crates = [
    [-7, 1, -2, 3, 2, 3],
    [7, 1.25, 5, 4, 2.5, 2],
    [-11, 1.5, 14, 3, 3, 6],
    [13, 1, 17, 5, 2, 2],
    [1, 1, 24, 4, 2, 4],
  ];
  crates.forEach(([x, y, z, width, height, depth], index) => {
    const crate = MeshBuilder.CreateBox(`cover-${index}`, { width, height, depth }, scene);
    crate.position.set(x, y, z);
    crate.material = crateMaterial;
    markEnvironment(crate);
  });

  const stripeMaterial = material(scene, "stripe-material", "#b5da7f");
  for (let index = -3; index <= 3; index += 1) {
    const stripe = MeshBuilder.CreateBox(`range-stripe-${index}`, { width: 0.08, height: 0.012, depth: 70 }, scene);
    stripe.position.set(index * 10, 0.015, 0);
    stripe.material = stripeMaterial;
    stripe.isPickable = false;
  }
}

function createSoldier(scene: Scene, actor: ActorState, assets: AssetCatalog): TransformNode {
  const descriptor = assets.resolve("model.character.enemy", "model");
  const color = typeof descriptor.metadata?.color === "string" ? descriptor.metadata.color : "#bd6357";
  const root = new TransformNode(`actor-${actor.id}`, scene);
  root.position.set(actor.position.x, actor.position.y, actor.position.z);

  const bodyMaterial = material(scene, `body-material-${actor.id}`, color);
  const gearMaterial = material(scene, `gear-material-${actor.id}`, "#272f27");
  const body = MeshBuilder.CreateCapsule(
    `body-${actor.id}`,
    { height: 1.42, radius: 0.38, tessellation: 8 },
    scene,
  );
  body.parent = root;
  body.position.y = -0.72;
  body.material = bodyMaterial;
  markActor(body, actor.id);

  const head = MeshBuilder.CreateSphere(`head-${actor.id}`, { diameter: 0.48, segments: 8 }, scene);
  head.parent = root;
  head.position.y = 0.13;
  head.material = gearMaterial;
  markActor(head, actor.id);

  const rifle = MeshBuilder.CreateBox(
    `rifle-${actor.id}`,
    { width: 0.13, height: 0.13, depth: 1.05 },
    scene,
  );
  rifle.parent = root;
  rifle.position.set(0.28, -0.46, 0.28);
  rifle.rotation.x = -0.12;
  rifle.material = gearMaterial;
  rifle.isPickable = false;
  return root;
}

function createViewWeapon(scene: Scene, camera: UniversalCamera, assets: AssetCatalog): void {
  const descriptor = assets.resolve("model.weapon.rifle", "model");
  const color = typeof descriptor.metadata?.color === "string" ? descriptor.metadata.color : "#283126";
  const weaponMaterial = material(scene, "view-rifle-material", color);
  const accentMaterial = material(scene, "view-rifle-accent", "#71845d");

  const receiver = MeshBuilder.CreateBox("view-rifle", { width: 0.22, height: 0.2, depth: 0.82 }, scene);
  receiver.parent = camera;
  receiver.position.set(0.38, -0.34, 0.76);
  receiver.rotation.y = -0.04;
  receiver.material = weaponMaterial;
  receiver.isPickable = false;

  const barrel = MeshBuilder.CreateCylinder("view-barrel", { diameter: 0.07, height: 0.72, tessellation: 8 }, scene);
  barrel.parent = camera;
  barrel.position.set(0.38, -0.29, 1.46);
  barrel.rotation.x = Math.PI / 2;
  barrel.material = accentMaterial;
  barrel.isPickable = false;
}

function markEnvironment(mesh: Mesh): void {
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.metadata = { environment: true };
}

function markActor(mesh: Mesh, actorId: EntityId): void {
  mesh.isPickable = true;
  mesh.metadata = { actorId };
}

function material(scene: Scene, name: string, hex: string): StandardMaterial {
  const value = Color3.FromHexString(hex);
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = value;
  result.specularColor = value.scale(0.12);
  return result;
}
