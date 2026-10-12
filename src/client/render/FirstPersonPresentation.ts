import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Vector3State } from "../../game/state/types";
import type { SimulationCombatWorld } from "../../game/systems/SimulationCombatWorld";

type ViewWorld = Pick<SimulationCombatWorld, "traceThrowable">;
interface WeaponBounds { x: number; y: number; rear: number; front: number; radius: number }
const NEAR = 0.12;
const EYE_RADIUS = 0.025;

/** 只约束第一人称表现；复用权威环境查询，不写入比赛状态。 */
export class FirstPersonPresentation {
  private readonly bounds = new Map<string, WeaponBounds>();
  private readonly cameraRotation = Matrix.Identity();
  private readonly weaponRotation = Matrix.Identity();
  private readonly local = new Vector3();
  private readonly offset = new Vector3();
  private readonly rear = new Vector3();
  private readonly front = new Vector3();
  private readonly lastPosition = new Vector3(Number.NaN, 0, 0);
  private readonly lastRotation = new Vector3();
  private lastFov = -1;
  private lastAspect = -1;
  private lastWorld: ViewWorld | null = null;
  private cameraChanged = true;
  private lastWeapon: string | null = null;
  private lastY = Number.NaN;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastEnabled = false;
  private target = 0;
  private obstruction = 0;

  public constructor(private readonly camera: UniversalCamera, private readonly weapon: TransformNode) {
    const scene = camera.getScene();
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);
    const inverse = weapon.computeWorldMatrix(true).clone().invert();
    const ranges = new Map<string, { min: Vector3; max: Vector3 }>();
    for (const mesh of weapon.getChildMeshes(false)) {
      mesh.renderingGroupId = 1;
      const id = mesh.metadata?.weaponId as string | undefined;
      if (!id) continue;
      let range = ranges.get(id);
      if (!range) {
        range = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
        ranges.set(id, range);
      }
      mesh.computeWorldMatrix(true);
      for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        Vector3.TransformCoordinatesToRef(corner, inverse, this.local);
        range.min.minimizeInPlace(this.local);
        range.max.maximizeInPlace(this.local);
      }
    }
    for (const [id, { min, max }] of ranges) {
      this.bounds.set(id, {
        x: (min.x + max.x) / 2, y: (min.y + max.y) / 2,
        rear: min.z, front: max.z,
        radius: Math.hypot(max.x - min.x, max.y - min.y) / 2,
      });
    }
  }

  public updateCamera(world: ViewWorld, eye: Vector3State, desired: Vector3State, visualY: number): void {
    const camera = this.camera;
    this.offset.set(desired.x - eye.x, desired.y + visualY - eye.y, desired.z - eye.z);
    const hit = this.offset.lengthSquared() > 1e-10
      ? world.traceThrowable(eye, this.offset, EYE_RADIUS)
      : null;
    const position = hit?.point ?? desired;
    const cameraY = hit ? position.y : desired.y + visualY;
    if (!camera.position.equalsToFloats(position.x, cameraY, position.z)) camera.position.set(position.x, cameraY, position.z);
    const aspect = camera.getEngine().getAspectRatio(camera);
    this.cameraChanged = world !== this.lastWorld || !this.lastPosition.equals(camera.position) ||
      !this.lastRotation.equals(camera.rotation) || this.lastFov !== camera.fov || this.lastAspect !== aspect;
    if (!this.cameraChanged) return;
    this.lastWorld = world;
    this.lastPosition.copyFrom(camera.position);
    this.lastRotation.copyFrom(camera.rotation);
    this.lastFov = camera.fov;
    this.lastAspect = aspect;
    Matrix.RotationYawPitchRollToRef(camera.rotation.y, camera.rotation.x, camera.rotation.z, this.cameraRotation);
    // 扫掠球包住整个近裁剪矩形，也覆盖矩形内部的窄门框／立柱。
    const halfHeight = NEAR * Math.tan(camera.fov / 2);
    const radius = halfHeight * Math.hypot(aspect, 1);
    this.local.set(0, 0, NEAR);
    Vector3.TransformNormalToRef(this.local, this.cameraRotation, this.offset);
    const contact = world.traceThrowable(camera.position, this.offset, radius);
    const safeNear = EYE_RADIUS * 0.8 / Math.hypot(1, radius / NEAR);
    camera.minZ = contact
      ? Math.max(safeNear, Math.min(NEAR, Math.hypot(contact.point.x - camera.position.x,
        contact.point.y - camera.position.y, contact.point.z - camera.position.z) * 0.98))
      : NEAR;
  }

  public updateWeapon(world: ViewWorld, id: string | null, y: number, rotationX: number, rotationZ: number, seconds: number): void {
    const enabled = this.weapon.isEnabled();
    const bounds = id && enabled ? this.bounds.get(id) : undefined;
    const changed = this.lastWeapon !== id;
    if (this.cameraChanged || changed || enabled !== this.lastEnabled || this.lastY !== y || this.lastX !== rotationX || this.lastZ !== rotationZ) {
      this.target = 0;
      if (bounds) {
        Matrix.RotationYawPitchRollToRef(0, rotationX, rotationZ, this.weaponRotation);
        this.weaponPoint(bounds.x, bounds.y, bounds.rear, y, this.rear);
        this.weaponPoint(bounds.x, bounds.y, bounds.front + 0.2, y, this.front);
        this.rear.subtractToRef(this.camera.position, this.offset);
        if (world.traceThrowable(this.camera.position, this.offset, EYE_RADIUS)) this.target = 1;
        else {
          this.front.subtractToRef(this.rear, this.offset);
          const contact = world.traceThrowable(this.rear, this.offset, bounds.radius);
          if (contact) {
            const clear = Math.hypot(contact.point.x - this.rear.x, contact.point.y - this.rear.y, contact.point.z - this.rear.z);
            this.target = Math.min(1, (this.offset.length() - clear) / 0.65);
          }
        }
      }
    }
    if (!bounds) this.target = this.obstruction = 0;
    else if (changed) this.obstruction = this.target;
    else this.obstruction += (this.target - this.obstruction) * (1 - Math.exp(-Math.min(0.1, Math.max(0, seconds)) * 18));
    this.lastWeapon = id;
    this.lastY = y;
    this.lastX = rotationX;
    this.lastZ = rotationZ;
    this.lastEnabled = enabled;
    const heldY = y - this.obstruction * 0.04, back = -this.obstruction * 0.08;
    // 换弹已向上抬枪时减少额外旋转，避免两种姿态相加把武器举出屏幕。
    const lift = 0.35 * (1 - Math.min(1, Math.max(0, -rotationX) / 0.5));
    const heldX = rotationX - this.obstruction * lift;
    if (!this.weapon.position.equalsToFloats(0, heldY, back)) this.weapon.position.set(0, heldY, back);
    if (!this.weapon.rotation.equalsToFloats(heldX, 0, rotationZ)) this.weapon.rotation.set(heldX, 0, rotationZ);
  }

  private weaponPoint(x: number, y: number, z: number, offsetY: number, result: Vector3): void {
    this.local.set(x, y, z);
    Vector3.TransformNormalToRef(this.local, this.weaponRotation, result);
    result.y += offsetY;
    Vector3.TransformNormalToRef(result, this.cameraRotation, result);
    result.addInPlace(this.camera.position);
  }
}
