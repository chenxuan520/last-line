import { WEAPONS } from "../config/weapons";
import type { ActorCommand } from "../game/commands/ActorCommand";
import {
  getActiveWeapon,
  type ActorState,
  type GameEvent,
  type Vector3State,
} from "../game/state/types";
import type { SequencedGameEvent } from "./protocol";

type ShotFiredEvent = Extract<GameEvent, { type: "shot-fired" }>;
type ShotTracedEvent = Extract<GameEvent, { type: "shot-traced" }>;

export interface PredictedLocalShot {
  inputSequence: number;
  weaponId: string;
  fired: ShotFiredEvent;
  trace: ShotTracedEvent;
}

export interface ReconciledShotEvents {
  audioEvents: GameEvent[];
  effectEvents: GameEvent[];
  impactOnlyEvents: GameEvent[];
  unpredictedLocalWeaponIds: string[];
}

interface PendingPredictedShot {
  inputSequence: number;
  weaponId: string;
}

const TIMER_EPSILON_SECONDS = 1e-9;
const MAX_PENDING_SHOTS = 64;
const MAX_CONFIRMATION_INPUT_AGE = 30;
const MAX_VISUAL_RECOIL_RADIANS = 0.16;
const VISUAL_RECOIL_RECOVERY_RADIANS_PER_SECOND = 0.18;

export class LocalRecoilPresentation {
  private value = 0;

  public get pitchOffset(): number {
    return this.value;
  }

  public add(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.value = Math.max(-MAX_VISUAL_RECOIL_RADIANS, this.value - amount);
  }

  public advance(deltaSeconds: number): void {
    if (!(deltaSeconds > 0) || this.value >= 0) return;
    this.value = Math.min(0, this.value + VISUAL_RECOIL_RECOVERY_RADIANS_PER_SECOND * deltaSeconds);
  }

  public reset(): void {
    this.value = 0;
  }
}

export class LocalShotPredictor {
  private weaponId: string | null = null;
  private cooldownSeconds = 0;
  private predictedAmmoInMagazine = 0;
  private readonly pending: PendingPredictedShot[] = [];

  public predict(
    actor: ActorState,
    command: ActorCommand,
    deltaSeconds: number,
    inputSequence: number,
  ): PredictedLocalShot | null {
    this.prunePending(inputSequence);
    const elapsedSeconds = Math.max(0, deltaSeconds);
    this.cooldownSeconds = Math.max(this.cooldownSeconds - elapsedSeconds, -elapsedSeconds);
    const weapon = getActiveWeapon(actor);
    const config = weapon ? WEAPONS[weapon.weaponId] : undefined;
    if (this.weaponId !== weapon?.weaponId) {
      this.weaponId = weapon?.weaponId ?? null;
      this.cooldownSeconds = Math.max(0, weapon?.cooldownSeconds ?? 0);
      this.predictedAmmoInMagazine = weapon?.ammoInMagazine ?? 0;
    }
    if (
      !command.fire ||
      command.reload ||
      command.switchWeapon !== null ||
      command.useItem !== null ||
      command.dropItem !== null ||
      !actor.alive ||
      actor.deployment !== "grounded" ||
      !weapon ||
      !config ||
      weapon.reloadSeconds > 0 ||
      weapon.ammoInMagazine <= 0 ||
      this.predictedAmmoInMagazine <= 0 ||
      this.cooldownSeconds > TIMER_EPSILON_SECONDS
    ) {
      return null;
    }

    this.cooldownSeconds += 60 / config.roundsPerMinute;
    this.predictedAmmoInMagazine -= 1;
    this.pending.push({ inputSequence, weaponId: config.id });
    if (this.pending.length > MAX_PENDING_SHOTS) this.pending.shift();
    const origin = { ...actor.position };
    const direction = normalize(command.aimDirection);
    return {
      inputSequence,
      weaponId: config.id,
      fired: {
        type: "shot-fired",
        actorId: actor.id,
        weaponId: config.id,
        origin,
      },
      trace: {
        type: "shot-traced",
        actorId: actor.id,
        origin,
        end: {
          x: origin.x + direction.x * config.range,
          y: origin.y + direction.y * config.range,
          z: origin.z + direction.z * config.range,
        },
        normal: { x: -direction.x, y: -direction.y, z: -direction.z },
        hitType: "miss",
        targetId: null,
      },
    };
  }

  public consumeConfirmedShot(
    weaponId: string,
    latestInputSequence: number,
    authoritativeShotSequence?: number,
  ): boolean {
    this.prunePending(latestInputSequence);
    const index = this.pending.findIndex((shot) =>
      shot.weaponId === weaponId
      && (authoritativeShotSequence === undefined || shot.inputSequence === authoritativeShotSequence)
    );
    if (index < 0) return false;
    this.pending.splice(index, 1);
    return true;
  }

  public reconcileAuthoritativeEvents(
    entries: readonly SequencedGameEvent<GameEvent>[],
    localActorId: string,
    latestInputSequence: number,
  ): ReconciledShotEvents {
    const audioEvents: GameEvent[] = [];
    const effectEvents: GameEvent[] = [];
    const impactOnlyEvents: GameEvent[] = [];
    const unpredictedLocalWeaponIds: string[] = [];
    let suppressedLocalTraces = 0;
    for (const entry of entries) {
      const event = entry.event;
      if (event.type === "shot-fired" && event.actorId === localActorId) {
        if (this.consumeConfirmedShot(event.weaponId, latestInputSequence, entry.shotSequence)) {
          suppressedLocalTraces += WEAPONS[event.weaponId]?.pellets ?? 1;
        } else {
          audioEvents.push(event);
          unpredictedLocalWeaponIds.push(event.weaponId);
        }
      } else {
        audioEvents.push(event);
      }
      if (event.type === "shot-traced" && event.actorId === localActorId && suppressedLocalTraces > 0) {
        impactOnlyEvents.push(event);
        suppressedLocalTraces -= 1;
      } else {
        effectEvents.push(event);
      }
    }
    return { audioEvents, effectEvents, impactOnlyEvents, unpredictedLocalWeaponIds };
  }

  public synchronize(actor: ActorState, latestInputSequence = 0): void {
    this.prunePending(latestInputSequence);
    const weapon = getActiveWeapon(actor);
    if (this.weaponId !== weapon?.weaponId) {
      this.cooldownSeconds = Math.max(0, weapon?.cooldownSeconds ?? 0);
    }
    this.weaponId = weapon?.weaponId ?? null;
    const pendingShotCount = this.pending.filter((shot) => shot.weaponId === weapon?.weaponId).length;
    this.predictedAmmoInMagazine = Math.max(0, (weapon?.ammoInMagazine ?? 0) - pendingShotCount);
  }

  public reset(): void {
    this.weaponId = null;
    this.cooldownSeconds = 0;
    this.predictedAmmoInMagazine = 0;
    this.pending.length = 0;
  }

  public cancelPredictedShot(sequence: number): void {
    const index = this.pending.findIndex((shot) => shot.inputSequence === sequence);
    if (index < 0) return;
    const [shot] = this.pending.splice(index, 1);
    const config = shot ? WEAPONS[shot.weaponId] : undefined;
    if (shot?.weaponId === this.weaponId) {
      this.predictedAmmoInMagazine += 1;
      this.cooldownSeconds = Math.max(0, this.cooldownSeconds - (config ? 60 / config.roundsPerMinute : 0));
    }
  }

  private prunePending(latestInputSequence: number): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const shot = this.pending[index];
      if (shot && latestInputSequence - shot.inputSequence > MAX_CONFIRMATION_INPUT_AGE) {
        this.pending.splice(index, 1);
      }
    }
  }
}

function normalize(value: Vector3State): Vector3State {
  const length = Math.hypot(value.x, value.y, value.z);
  return length <= TIMER_EPSILON_SECONDS
    ? { x: 0, y: 0, z: 1 }
    : { x: value.x / length, y: value.y / length, z: value.z / length };
}
