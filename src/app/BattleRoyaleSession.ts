import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { CombatEffects } from "../client/render/CombatEffects";
import { createIslandScene, setActorParachuteVisual, setActorWeaponVisual } from "../client/render/scenes/IslandScene";
import { GameHud } from "../client/ui/GameHud";
import type { GameSettings } from "../config/settings";
import { WEAPONS } from "../config/weapons";
import { BotController } from "../controllers/BotController";
import { HumanController } from "../controllers/HumanController";
import type { ActorCommand } from "../game/commands/ActorCommand";
import { FixedStepClock } from "../game/FixedStepClock";
import { GameSimulation } from "../game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleState } from "../game/modes/BattleRoyaleMode";
import {
  getActiveWeapon,
  type ActorState,
  type EntityId,
  type GameEvent,
  type MatchState,
} from "../game/state/types";
import { SimulationCombatWorld } from "../game/systems/SimulationCombatWorld";

const PLAYER_ID = "player";

export class BattleRoyaleSession {
  public readonly scene;
  private readonly camera;
  private readonly actorRoots: Map<EntityId, TransformNode>;
  private readonly lootMeshes;
  private readonly syncLootMeshes;
  private readonly viewWeaponRoot;
  private readonly aircraftInteriorRoot;
  private readonly syncAircraftVisual;
  private readonly syncSafeZoneRing;
  private readonly simulation: GameSimulation;
  private readonly clock = new FixedStepClock();
  private readonly humanController: HumanController;
  private readonly botControllers = new Map<EntityId, BotController>();
  private readonly combatWorld: SimulationCombatWorld;
  private readonly audio: AudioFeedback;
  private readonly effects: CombatEffects;
  private readonly actorVisualSignatures = new Map<EntityId, string>();
  private reloadVisualActive = false;
  private hud: GameHud | null = null;
  private active = false;
  private playerEliminated = false;
  private spectatorActorId: EntityId | null = null;
  private lastVisualElapsedSeconds = -1;
  private lastVisualActorId: EntityId | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLDivElement,
    private readonly assets: AssetCatalog,
    settings: GameSettings,
    audio: AudioFeedback,
    private readonly onRestart: () => void,
    bundle: Awaited<ReturnType<typeof createIslandScene>>,
    state: MatchState,
  ) {
    const mode = new BattleRoyaleMode();
    this.simulation = new GameSimulation(state, mode, WEAPONS);
    this.scene = bundle.scene;
    this.camera = bundle.camera;
    this.actorRoots = bundle.actorRoots;
    this.lootMeshes = bundle.lootMeshes;
    this.syncLootMeshes = bundle.syncLootMeshes;
    this.viewWeaponRoot = bundle.viewWeaponRoot;
    this.aircraftInteriorRoot = bundle.aircraftInteriorRoot;
    this.syncAircraftVisual = bundle.syncAircraftVisual;
    this.syncSafeZoneRing = bundle.syncSafeZoneRing;
    this.humanController = new HumanController(canvas, settings.sensitivity);
    this.audio = audio;
    this.effects = new CombatEffects(this.scene);
    this.combatWorld = new SimulationCombatWorld(state);
    Object.values(state.actors).forEach((actor, index) => {
      if (actor.kind === "bot") this.botControllers.set(actor.id, new BotController(index));
    });
  }

  public static async create(
    engine: Engine,
    canvas: HTMLCanvasElement,
    uiRoot: HTMLDivElement,
    assets: AssetCatalog,
    settings: GameSettings,
    audio: AudioFeedback,
    onRestart: () => void,
  ): Promise<BattleRoyaleSession> {
    const state = createBattleRoyaleState(PLAYER_ID, undefined, Math.random, {
      startWithBandage: settings.startWithBandage,
    });
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot, state.mapSeed);
    return new BattleRoyaleSession(canvas, uiRoot, assets, settings, audio, onRestart, bundle, state);
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.hud = new GameHud(
      this.uiRoot,
      this.assets,
      this.simulation.state.mapSeed,
      () => this.requestPointerLock(),
      this.onRestart,
    );
    this.audio.start();
    this.simulation.start();
    this.processEvents();
    this.syncVisuals();
    this.requestPointerLock();
  }

  public update(frameSeconds: number, fps: number): void {
    if (!this.active) return;
    const player = this.getActor(PLAYER_ID);
    this.humanController.rememberActor(player);
    const spectatorSwitch = this.humanController.consumeSpectatorSwitchRequest();
    if (!player.alive && spectatorSwitch) {
      this.spectatorActorId = cycleSpectatorActorId(
        PLAYER_ID,
        this.spectatorActorId,
        this.simulation.state.actors,
        spectatorSwitch,
      );
    }
    const pointerLocked = document.pointerLockElement === this.canvas;
    const shouldAdvance = this.simulation.state.phase !== "finished" && (pointerLocked || !player.alive);
    if (shouldAdvance) {
      this.clock.advance(frameSeconds, (deltaSeconds) => this.fixedUpdate(deltaSeconds));
    }
    this.effects.update(frameSeconds);
    this.syncVisuals();
    this.hud?.update(
      this.simulation.state,
      player,
      this.spectatorActorId ? this.simulation.state.actors[this.spectatorActorId] ?? player : player,
      pointerLocked,
      fps,
      this.humanController.isScoped(player),
      this.humanController.isLeaderboardVisible(),
    );
  }

  public dispose(): void {
    this.active = false;
    this.humanController.dispose();
    this.effects.dispose();
    this.scene.dispose();
  }

  private fixedUpdate(deltaSeconds: number): void {
    if (this.simulation.state.phase === "finished") return;
    const commands = new Map<EntityId, ActorCommand>();
    const player = this.getActor(PLAYER_ID);
    this.humanController.rememberActor(player);
    if (player.alive) commands.set(PLAYER_ID, this.humanController.createCommand(player));
    for (const [actorId, controller] of this.botControllers) {
      const actor = this.getActor(actorId);
      if (actor.alive) commands.set(actorId, controller.update(actor, this.simulation.state, this.combatWorld, deltaSeconds, PLAYER_ID));
    }
    this.simulation.step(deltaSeconds, commands, this.combatWorld);
    this.processEvents();
  }

  private processEvents(): void {
    const events = this.simulation.drainEvents();
    this.hud?.handleEvents(events, PLAYER_ID);
    const player = this.getActor(PLAYER_ID);
    const observer = this.spectatorActorId ? this.simulation.state.actors[this.spectatorActorId] ?? player : player;
    this.audio.handleEvents(events, {
      playerId: PLAYER_ID,
      observerId: observer.id,
      position: observer.position,
    });
    this.effects.handleEvents(events, PLAYER_ID);
    let lootSyncNeeded = false;
    for (const event of events) {
      if (event.type === "shot-fired" && event.actorId === PLAYER_ID) {
        this.humanController.applyRecoil(WEAPONS[event.weaponId]?.recoil ?? 0);
      }
      if (event.type === "actor-died") {
        this.actorRoots.get(event.actorId)?.setEnabled(false);
        this.spectatorActorId = resolveSpectatorActorId(
          PLAYER_ID,
          this.spectatorActorId,
          event,
          this.simulation.state.actors,
        );
        if (event.actorId === PLAYER_ID && !this.playerEliminated) {
          this.playerEliminated = true;
          if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
          const placement = Object.values(this.simulation.state.actors).filter((actor) => actor.alive).length + 1;
          const killer = event.sourceId ? this.simulation.state.actors[event.sourceId] : undefined;
          const killerLabel = killer?.kind === "bot" ? `AI-${/\d+$/.exec(killer.id)?.[0] ?? killer.id}` : killer ? "玩家" : "安全区";
          const weaponLabel = event.weaponId ? WEAPONS[event.weaponId]?.label ?? event.weaponId : null;
          this.hud?.showEliminated(
            placement,
            this.getActor(PLAYER_ID).kills,
            event.sourceId ? `被 ${killerLabel} 使用 ${weaponLabel ?? "武器"} 淘汰` : "被安全区淘汰",
            Boolean(event.sourceId && this.spectatorActorId === event.sourceId),
          );
        }
      }
      if (event.type === "item-picked") {
        const loot = this.simulation.state.groundLoot[event.lootId];
        this.lootMeshes.get(event.lootId)?.setEnabled(Boolean(loot?.available));
      }
      if (event.type === "item-dropped") lootSyncNeeded = true;
      if (event.type === "match-finished") {
        if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
        this.hud?.showResult(event.result, PLAYER_ID, this.getActor(PLAYER_ID).kills);
      }
    }
    if (lootSyncNeeded) this.syncLootMeshes(this.simulation.state.groundLoot);
  }

  private syncVisuals(): void {
    const player = this.getActor(PLAYER_ID);
    const spectator = this.spectatorActorId ? this.simulation.state.actors[this.spectatorActorId] : undefined;
    const cameraActor = spectator ?? player;
    const activeViewWeapon = getActiveWeapon(cameraActor);
    const scoped = cameraActor.id === PLAYER_ID && this.humanController.isScoped(player);
    this.camera.fov = scoped ? WEAPONS[activeViewWeapon?.weaponId ?? ""]?.scopeFov ?? 1.18 : 1.18;
    this.viewWeaponRoot.setEnabled(Boolean(activeViewWeapon) && !scoped && cameraActor.deployment === "grounded");
    setActorWeaponVisual(this.viewWeaponRoot, activeViewWeapon?.weaponId ?? null);
    this.syncReloadVisual(activeViewWeapon);
    if (
      this.lastVisualElapsedSeconds !== this.simulation.state.elapsedSeconds ||
      this.lastVisualActorId !== cameraActor.id
    ) {
      this.lastVisualElapsedSeconds = this.simulation.state.elapsedSeconds;
      this.lastVisualActorId = cameraActor.id;
      this.aircraftInteriorRoot.setEnabled(cameraActor.id === PLAYER_ID && player.deployment === "aircraft");
      this.syncAircraftVisual(
        this.simulation.state.flight,
        this.simulation.state.phase === "flight" && player.deployment !== "aircraft",
      );
      this.camera.position.set(cameraActor.position.x, cameraActor.position.y, cameraActor.position.z);
      this.camera.rotation.set(cameraActor.pitch, cameraActor.yaw, 0);
      for (const [actorId, root] of this.actorRoots) {
        const actor = this.getActor(actorId);
        root.position.set(actor.position.x, actor.position.y, actor.position.z);
        root.rotation.y = actor.yaw;
        const signature = `${actor.alive}:${actor.deployment}:${getActiveWeapon(actor)?.weaponId ?? "none"}:${actorId === cameraActor.id}`;
        if (this.actorVisualSignatures.get(actorId) !== signature) {
          root.setEnabled(actor.alive && actor.deployment !== "aircraft" && actorId !== cameraActor.id);
          if (actor.kind === "bot") {
            setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
            setActorParachuteVisual(root, actor.deployment === "parachuting");
          }
          this.actorVisualSignatures.set(actorId, signature);
        }
      }
      for (const [lootId, mesh] of this.lootMeshes) {
        const loot = this.simulation.state.groundLoot[lootId];
        mesh.setEnabled(Boolean(loot?.available));
        if (loot?.available) mesh.rotation.y += 0.06;
      }
      const zone = this.simulation.state.safeZone;
      this.syncSafeZoneRing(zone.center.x, zone.center.z, zone.radius);
    }
  }

  private syncReloadVisual(weapon: ReturnType<typeof getActiveWeapon>): void {
    const transform = getReloadVisualTransform(weapon);
    if (transform) {
      this.viewWeaponRoot.position.set(0, transform.y, 0);
      this.viewWeaponRoot.rotation.set(transform.rotationX, 0, transform.rotationZ);
      this.reloadVisualActive = true;
    } else if (this.reloadVisualActive) {
      this.viewWeaponRoot.position.setAll(0);
      this.viewWeaponRoot.rotation.setAll(0);
      this.reloadVisualActive = false;
    }
  }

  private getActor(actorId: EntityId): ActorState {
    const actor = this.simulation.state.actors[actorId];
    if (!actor) throw new Error(`角色不存在: ${actorId}`);
    return actor;
  }

  private requestPointerLock(): void {
    this.audio.start();
    void this.canvas.requestPointerLock().catch(() => {
      // Embedded and headless browsers may reject pointer lock; the resume card remains available.
    });
  }
}

export function resolveSpectatorActorId(
  playerId: EntityId,
  currentSpectatorId: EntityId | null,
  event: Extract<GameEvent, { type: "actor-died" }>,
  actors: Readonly<Record<EntityId, ActorState>>,
): EntityId | null {
  if (event.actorId !== playerId || currentSpectatorId !== null) return currentSpectatorId;
  const killer = event.sourceId ? actors[event.sourceId] : undefined;
  if (killer?.alive && killer.id !== playerId) return killer.id;
  return Object.values(actors)
    .filter((actor) => actor.alive && actor.id !== playerId)
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id ?? null;
}

export function cycleSpectatorActorId(
  playerId: EntityId,
  currentSpectatorId: EntityId | null,
  actors: Readonly<Record<EntityId, ActorState>>,
  direction: -1 | 1,
): EntityId | null {
  const candidates = Object.values(actors)
    .filter((actor) => actor.alive && actor.id !== playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) return currentSpectatorId;
  const currentIndex = candidates.findIndex((actor) => actor.id === currentSpectatorId);
  if (currentIndex >= 0) {
    return candidates[(currentIndex + direction + candidates.length) % candidates.length]?.id ?? currentSpectatorId;
  }
  if (currentSpectatorId) {
    const next = direction > 0
      ? candidates.find((actor) => actor.id > currentSpectatorId) ?? candidates[0]
      : [...candidates].reverse().find((actor) => actor.id < currentSpectatorId) ?? candidates.at(-1);
    return next?.id ?? currentSpectatorId;
  }
  return direction > 0 ? candidates[0]?.id ?? null : candidates.at(-1)?.id ?? null;
}

export function getReloadVisualTransform(
  weapon: ReturnType<typeof getActiveWeapon>,
): { y: number; rotationX: number; rotationZ: number } | null {
  if (!weapon || weapon.reloadSeconds <= 0) return null;
  const totalSeconds = WEAPONS[weapon.weaponId]?.reloadSeconds ?? 1;
  const progress = 1 - weapon.reloadSeconds / totalSeconds;
  const dip = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI);
  return { y: -0.18 * dip, rotationX: -0.5 * dip, rotationZ: 0.22 * dip };
}
