import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { FirstPersonPresentation } from "../../src/client/render/FirstPersonPresentation";
import { createMapLayout, type MapWallSegment } from "../../src/config/map";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

function fixture(walls: MapWallSegment[]) {
  const engine = new NullEngine({ renderWidth: 1600, renderHeight: 900, textureSize: 256, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine);
  const camera = new UniversalCamera("view", new Vector3(0, 100, 0), scene);
  camera.fov = 1.18;
  const root = new TransformNode("gun", scene);
  root.parent = camera;
  const long = CreateBox("long", { width: 0.2, height: 0.3, depth: 1.5 }, scene);
  long.position.set(0.38, -0.34, 1);
  long.parent = root;
  long.metadata = { weaponId: "rifle" };
  const short = CreateBox("short", { size: 0.2 }, scene);
  short.position.set(0.38, -0.34, 0.35);
  short.parent = root;
  short.metadata = { weaponId: "grenade.frag" };
  short.setEnabled(false);
  const environment = CreateBox("wall", { size: 1 }, scene);
  const state = createBattleRoyaleState("player", undefined, () => 0);
  const layout = { ...createMapLayout(0), wallSegments: walls, rockObstacles: [], treeTrunks: [],
    coverObstacles: [], floorSlabs: [], roofRamps: [] };
  const world = new SimulationCombatWorld(state, true, layout);
  const before = JSON.stringify(state);
  const presentation = new FirstPersonPresentation(camera, root);
  return { engine, scene, camera, root, long, short, environment, world, state, before, presentation,
    close: () => { scene.dispose(); engine.dispose(); } };
}

function wall(x = 0, y = 100, z = 1): MapWallSegment {
  return { id: "wall", obstacleId: "building", center: { x, y, z }, width: 8, height: 5, depth: 0.2, color: "#fff" };
}

describe("FirstPersonPresentation", () => {
  it("clamps visual correction and landing offsets without moving authoritative actors", () => {
    const f = fixture([wall(), { ...wall(0, 100.2, 0), height: 0.2, depth: 8 }]);
    try {
      const eye = new Vector3(0, 100, 0);
      f.presentation.updateCamera(f.world, eye, new Vector3(0, 100, 2), 0);
      expect(f.camera.position.z).toBeLessThan(0.88);
      expect(f.camera.position.z).toBeGreaterThan(0.8);
      f.presentation.updateCamera(f.world, eye, eye, 0.4);
      expect(f.camera.position.y).toBeLessThan(100.08);
      expect(f.camera.position.y).toBeGreaterThan(100);
      expect(JSON.stringify(f.state)).toBe(f.before);
    } finally { f.close(); }
  });

  it("keeps the full near plane below a low ceiling while looking up on a wide screen", () => {
    const f = fixture([{ ...wall(0, 100.14, 0), height: 0.2, depth: 8 }]);
    try {
      const eye = new Vector3(0, 100, 0);
      f.camera.rotation.x = -0.7;
      f.presentation.updateCamera(f.world, eye, eye, 0);
      expect(f.camera.minZ).toBeLessThan(0.04);
      const matrix = Matrix.RotationYawPitchRoll(0, -0.7, 0);
      const half = f.camera.minZ * Math.tan(f.camera.fov / 2);
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
        const corner = Vector3.TransformNormal(new Vector3(x * half * 1600 / 900, y * half, f.camera.minZ), matrix);
        expect(f.world.traceThrowable(eye, corner, 0)).toBeNull();
      }
      f.camera.rotation.x = 0;
      const clearEye = new Vector3(0, 98, 0);
      f.presentation.updateCamera(f.world, clearEye, clearEye, 0);
      expect(f.camera.minZ).toBe(0.12);
    } finally { f.close(); }
  });

  it("retracts long weapons near walls and restores short weapons and a reopened scope", () => {
    const f = fixture([wall()]);
    try {
      const eye = f.camera.position.clone();
      f.presentation.updateCamera(f.world, eye, eye, 0);
      f.presentation.updateWeapon(f.world, "rifle", 0, 0, 0, 1 / 30);
      expect(f.root.position.z).toBeLessThan(-0.04);
      expect(f.root.rotation.x).toBeLessThan(-0.3);
      f.presentation.updateWeapon(f.world, "rifle", -0.18, -0.5, 0.22, 1 / 30);
      expect(f.root.rotation.x).toBeCloseTo(-0.5);
      f.long.setEnabled(false); f.short.setEnabled(true);
      f.presentation.updateWeapon(f.world, "grenade.frag", 0, 0, 0, 1 / 30);
      expect(f.root.position.z).toBeCloseTo(0);
      f.short.setEnabled(false); f.long.setEnabled(true);
      f.presentation.updateWeapon(f.world, "rifle", 0, 0, 0, 1 / 30);
      f.root.setEnabled(false);
      f.presentation.updateWeapon(f.world, "rifle", 0, 0, 0, 1 / 30);
      f.presentation.updateCamera(f.world, eye, eye, 0);
      f.root.setEnabled(true);
      f.presentation.updateWeapon(f.world, "rifle", 0, 0, 0, 1 / 30);
      expect(f.root.position.z).toBeLessThan(0);
      const clearEye = new Vector3(0, 100, -4);
      for (let i = 0; i < 30; i += 1) {
        f.presentation.updateCamera(f.world, clearEye, clearEye, 0);
        f.presentation.updateWeapon(f.world, "rifle", -0.1, 0.2, 0.1, 1 / 30);
      }
      expect(f.root.position.z).toBeCloseTo(0, 5);
      expect(f.root.position.y).toBeCloseTo(-0.1, 5);
      expect(f.root.rotation.x).toBeCloseTo(0.2, 5);
      expect(f.root.rotation.z).toBe(0.1);
    } finally { f.close(); }
  });

  it("isolates hand-held depth and bounds queries while preserving wall shot occlusion", () => {
    const f = fixture([wall()]);
    try {
      expect(f.long.renderingGroupId).toBe(1);
      expect(f.short.renderingGroupId).toBe(1);
      expect(f.environment.renderingGroupId).toBe(0);
      expect(f.scene.meshes).toHaveLength(3);
      let queries = 0;
      const world = { traceThrowable: (...args: Parameters<SimulationCombatWorld["traceThrowable"]>) => {
        queries += 1; return f.world.traceThrowable(...args);
      } };
      const eye = f.camera.position.clone();
      f.presentation.updateCamera(world, eye, eye, 0);
      f.presentation.updateWeapon(world, "rifle", 0, 0, 0, 1 / 30);
      expect(queries).toBeLessThanOrEqual(3);
      const initial = queries;
      for (let i = 0; i < 60; i += 1) {
        f.presentation.updateCamera(world, eye, eye, 0);
        f.presentation.updateWeapon(world, "rifle", 0, 0, 0, 1 / 60);
      }
      expect(queries).toBe(initial);
      expect(f.world.traceShotDetailed({ shooterId: "player", origin: eye,
        direction: { x: 0, y: 0, z: 1 }, range: 10 }).hitType).toBe("environment");
      expect(JSON.stringify(f.state)).toBe(f.before);
    } finally { f.close(); }
  });

  it("respects rotated walls and open doorways when constraining a camera correction", () => {
    const diagonal = fixture([{ ...wall(0, 100, 0), rotationY: Math.PI / 4 }]);
    try {
      const eye = new Vector3(-1, 100, -1);
      diagonal.presentation.updateCamera(diagonal.world, eye, new Vector3(1, 100, 1), 0);
      expect(diagonal.camera.position.x + diagonal.camera.position.z).toBeLessThan(0);
    } finally { diagonal.close(); }
    const door = fixture([{ ...wall(-1, 100, 0), width: 1 }, { ...wall(1, 100, 0), width: 1 }]);
    try {
      const eye = new Vector3(0, 100, -1), desired = new Vector3(0, 100, 1);
      door.presentation.updateCamera(door.world, eye, desired, 0);
      expect(door.camera.position.asArray()).toEqual(desired.asArray());
    } finally { door.close(); }
  });
});
