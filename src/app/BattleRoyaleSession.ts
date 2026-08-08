import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { CombatEffects } from "../client/render/CombatEffects";
import { GrenadePresentation } from "../client/render/GrenadePresentation";
import {
  applyActorVisualPose,
  createIslandScene,
  setActorParachuteVisual,
  setActorEquipmentVisual,
  setActorWeaponVisual,
} from "../client/render/scenes/IslandScene";
import { GameHud } from "../client/ui/GameHud";
import type { MobileFullscreenController } from "../client/ui/MobileFullscreenController";
import type { GameSettings } from "../config/settings";
import { createMapLayout } from "../config/map";
import { ITEMS } from "../config/items";
import { WEAPONS } from "../config/weapons";
import {
  createGrenadeThrowVelocity,
  FRAG_GRENADE_ITEM_ID,
} from "../config/throwables";
import { BotController } from "../controllers/BotController";
import { HumanController } from "../controllers/HumanController";
import { requestDesktopPointerLockSafely } from "../controllers/pointerLock";
import type { ActorCommand } from "../game/commands/ActorCommand";
import { FixedStepClock } from "../game/FixedStepClock";
import { GameSimulation } from "../game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleState } from "../game/modes/BattleRoyaleMode";
import { SIMULATION_STEP_SECONDS } from "../game/simulationTiming";
import {
  getActiveWeapon,
  type ActorState,
  type EntityId,
  type GameEvent,
  type MatchState,
} from "../game/state/types";
import type { DamageSystem } from "../game/systems/DamageSystem";
import { SimulationCombatWorld } from "../game/systems/SimulationCombatWorld";
import type {
  SinglePlayerDebugAction,
  SinglePlayerDebugSystem,
} from "../game/systems/SinglePlayerDebugSystem";
import { sampleGrenadeTrajectory } from "../game/systems/ThrowableSystem";

const PLAYER_ID = "player";
const LANDING_VISUAL_SECONDS = 0.24;

export interface JumpVisualState {
  wasAirborne: boolean;
  landingStartedSeconds: number;
}

export interface JumpVisualPose {
  actorY: number;
  actorRotationX: number;
  cameraY: number;
  weaponY: number;
  weaponRotationX: number;
}

interface SinglePlayerDebugPanelHandle {
  update(state: MatchState, player: ActorState, frameSeconds: number): void;
  dispose(): void;
  focus(): void;
}

interface SinglePlayerDebugSupport {
  damage: DamageSystem;
  system: SinglePlayerDebugSystem;
  createPanel(
    root: HTMLDivElement,
    onAction: (action: SinglePlayerDebugAction) => void,
  ): SinglePlayerDebugPanelHandle;
}

export class BattleRoyaleSession {
  public readonly scene;
  private readonly camera;
  private readonly actorRoots: Map<EntityId, TransformNode>;
  private readonly actorVisualRoots: Map<EntityId, TransformNode>;
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
  private readonly grenadePresentation: GrenadePresentation;
  private readonly actorVisualSignatures = new Map<EntityId, string>();
  private readonly jumpVisualStates = new Map<EntityId, JumpVisualState>();
  private hud: GameHud | null = null;
  private debugPanel: SinglePlayerDebugPanelHandle | null = null;
  private readonly debugSystem: SinglePlayerDebugSystem | null;
  private readonly createDebugPanel: SinglePlayerDebugSupport["createPanel"] | null;
  private active = false;
  private playerEliminated = false;
  private spectatorActorId: EntityId | null = null;
  private lastVisualElapsedSeconds = -1;
  private lastVisualActorId: EntityId | null = null;
  private lastViewWeaponId: string | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLDivElement,
    private readonly assets: AssetCatalog,
    private readonly settings: GameSettings,
    audio: AudioFeedback,
    private readonly mobileFullscreen: MobileFullscreenController,
    private readonly onRestart: () => void,
    private readonly onExit: () => void,
    debugSupport: SinglePlayerDebugSupport | null,
    bundle: Awaited<ReturnType<typeof createIslandScene>>,
    state: MatchState,
  ) {
    const layout = createMapLayout(state.mapId, state.mapSeed);
    const damage = debugSupport?.damage;
    const mode = new BattleRoyaleMode(undefined, undefined, damage);
    this.simulation = new GameSimulation(state, mode, WEAPONS, layout, damage);
    this.debugSystem = debugSupport?.system ?? null;
    this.createDebugPanel = debugSupport?.createPanel ?? null;
    this.scene = bundle.scene;
    this.camera = bundle.camera;
    this.actorRoots = bundle.actorRoots;
    this.actorVisualRoots = bundle.actorVisualRoots;
    this.lootMeshes = bundle.lootMeshes;
    this.syncLootMeshes = bundle.syncLootMeshes;
    this.viewWeaponRoot = bundle.viewWeaponRoot;
    this.aircraftInteriorRoot = bundle.aircraftInteriorRoot;
    this.syncAircraftVisual = bundle.syncAircraftVisual;
    this.syncSafeZoneRing = bundle.syncSafeZoneRing;
    this.humanController = new HumanController(canvas, settings.sensitivity, {
      touchRoot: uiRoot,
      onLeaderboardScroll: (deltaY, deltaMode) => this.hud?.scrollLeaderboard(deltaY, deltaMode),
    });
    this.audio = audio;
    this.effects = new CombatEffects(this.scene);
    this.grenadePresentation = new GrenadePresentation(this.scene);
    this.combatWorld = new SimulationCombatWorld(state, true, layout);
    Object.values(state.actors).forEach((actor, index) => {
      if (actor.kind === "bot") {
        this.botControllers.set(actor.id, new BotController(index, Math.random, settings.disableAiSnipers, layout));
      }
    });
  }

  public static async create(
    engine: Engine,
    canvas: HTMLCanvasElement,
    uiRoot: HTMLDivElement,
    assets: AssetCatalog,
    settings: GameSettings,
    audio: AudioFeedback,
    mobileFullscreen: MobileFullscreenController,
    onRestart: () => void,
    onExit: () => void,
  ): Promise<BattleRoyaleSession> {
    const state = createBattleRoyaleState(PLAYER_ID, undefined, Math.random, {
      startWithBandage: settings.startWithBandage,
      mapId: settings.mapId,
    });
    const debugSupport = await loadSinglePlayerDebugSupport(state);
    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      settings.showGroundLootModels,
      undefined,
      settings.quality,
      state.mapId,
    );
    return new BattleRoyaleSession(
      canvas,
      uiRoot,
      assets,
      settings,
      audio,
      mobileFullscreen,
      onRestart,
      onExit,
      debugSupport,
      bundle,
      state,
    );
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.hud = new GameHud(
      this.uiRoot,
      this.assets,
      this.simulation.state.mapSeed,
      () => this.resumeInput(),
      this.onRestart,
      {
        mapId: this.simulation.state.mapId,
        touchInput: this.humanController.usesTouchControls(),
        onRequestFullscreen: () => this.mobileFullscreen.requestFromUserGesture(),
        onDropBackpackItem: (index, itemId, snapshot) =>
          this.humanController.requestDropBackpackItem(index, itemId, snapshot),
        onExit: this.onExit,
        quality: this.settings.quality,
      },
    );
    this.audio.start();
    this.simulation.start();
    if (this.debugSystem && this.createDebugPanel) {
      this.debugPanel = this.createDebugPanel(
        this.uiRoot,
        (action) => this.debugSystem?.apply(this.simulation.state, action),
      );
      document.addEventListener("keydown", this.handleDebugKeyDown);
    }
    this.processEvents();
    this.syncVisuals();
    this.resumeInput();
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
    const inputActive = this.humanController.isGameplayInputActive();
    const shouldAdvance = this.simulation.state.phase !== "finished" && (inputActive || !player.alive);
    if (shouldAdvance) {
      this.clock.advance(frameSeconds, (deltaSeconds) => this.fixedUpdate(deltaSeconds));
    }
    this.effects.update(frameSeconds);
    this.syncVisuals();
    const orientationBlocked = this.humanController.isOrientationBlocked();
    this.hud?.update(
      this.simulation.state,
      player,
      this.spectatorActorId ? this.simulation.state.actors[this.spectatorActorId] ?? player : player,
      inputActive,
      frameSeconds,
      fps,
      this.humanController.isScoped(player),
      this.humanController.isLeaderboardVisible(),
      orientationBlocked,
      this.mobileFullscreen.needsAction(orientationBlocked),
      this.humanController.isGrenadeSelected(),
      this.humanController.isGrenadePreparing(),
      this.humanController.getGrenadeThrowMode(),
    );
    this.debugPanel?.update(this.simulation.state, player, frameSeconds);
  }

  public dispose(): void {
    this.active = false;
    this.humanController.dispose();
    this.hud?.dispose();
    this.hud = null;
    this.debugPanel?.dispose();
    this.debugPanel = null;
    document.removeEventListener("keydown", this.handleDebugKeyDown);
    this.effects.dispose();
    this.grenadePresentation.dispose();
    this.scene.dispose();
  }

  private fixedUpdate(deltaSeconds: number): void {
    if (this.simulation.state.phase === "finished") return;
    const commands = new Map<EntityId, ActorCommand>();
    const player = this.getActor(PLAYER_ID);
    let livingActorCount: number | undefined;
    this.humanController.rememberActor(player);
    if (player.alive) commands.set(PLAYER_ID, this.humanController.createCommand(player));
    for (const [actorId, controller] of this.botControllers) {
      const actor = this.getActor(actorId);
      if (actor.alive) {
        if (actor.deployment === "grounded") {
          livingActorCount ??= Object.values(this.simulation.state.actors).filter((candidate) => candidate.alive).length;
        }
        commands.set(actorId, controller.update(
          actor,
          this.simulation.state,
          this.combatWorld,
          deltaSeconds,
          PLAYER_ID,
          livingActorCount,
        ));
      }
    }
    this.simulation.step(
      deltaSeconds,
      commands,
      this.combatWorld,
      new Set(this.botControllers.keys()),
    );
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
          const weaponLabel = event.weaponId
            ? WEAPONS[event.weaponId]?.label ?? ITEMS[event.weaponId]?.label ?? event.weaponId
            : null;
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
    const grenadeSelected = cameraActor.id === PLAYER_ID && this.humanController.isGrenadeSelected();
    const scoped = cameraActor.id === PLAYER_ID && this.humanController.isScoped(player);
    const targetFov = scoped ? WEAPONS[activeViewWeapon?.weaponId ?? ""]?.scopeFov ?? 1.18 : 1.18;
    if (this.camera.fov !== targetFov) this.camera.fov = targetFov;
    const viewWeaponEnabled = Boolean(activeViewWeapon || grenadeSelected) &&
      !scoped &&
      cameraActor.deployment === "grounded";
    if (this.viewWeaponRoot.isEnabled() !== viewWeaponEnabled) this.viewWeaponRoot.setEnabled(viewWeaponEnabled);
    const viewWeaponId = grenadeSelected ? FRAG_GRENADE_ITEM_ID : activeViewWeapon?.weaponId ?? null;
    if (this.lastViewWeaponId !== viewWeaponId) {
      setActorWeaponVisual(this.viewWeaponRoot, viewWeaponId);
      this.lastViewWeaponId = viewWeaponId;
    }
    if (
      this.lastVisualElapsedSeconds !== this.simulation.state.elapsedSeconds ||
      this.lastVisualActorId !== cameraActor.id
    ) {
      const visualDeltaSeconds = this.lastVisualElapsedSeconds < 0
        ? SIMULATION_STEP_SECONDS
        : Math.min(0.1, Math.max(0, this.simulation.state.elapsedSeconds - this.lastVisualElapsedSeconds));
      this.lastVisualElapsedSeconds = this.simulation.state.elapsedSeconds;
      this.lastVisualActorId = cameraActor.id;
      const aircraftInteriorEnabled = cameraActor.id === PLAYER_ID && player.deployment === "aircraft";
      if (this.aircraftInteriorRoot.isEnabled() !== aircraftInteriorEnabled) {
        this.aircraftInteriorRoot.setEnabled(aircraftInteriorEnabled);
      }
      this.syncAircraftVisual(
        this.simulation.state.flight,
        this.simulation.state.phase === "flight" && player.deployment !== "aircraft",
      );
      const jumpPoses = new Map<EntityId, JumpVisualPose>();
      for (const actor of Object.values(this.simulation.state.actors)) {
        jumpPoses.set(actor.id, this.getJumpVisualPose(actor));
      }
      const cameraJumpPose = jumpPoses.get(cameraActor.id) ?? neutralJumpVisualPose();
      const cameraY = cameraActor.position.y + cameraJumpPose.cameraY;
      if (!this.camera.position.equalsToFloats(cameraActor.position.x, cameraY, cameraActor.position.z)) {
        this.camera.position.set(cameraActor.position.x, cameraY, cameraActor.position.z);
      }
      if (!this.camera.rotation.equalsToFloats(cameraActor.pitch, cameraActor.yaw, 0)) {
        this.camera.rotation.set(cameraActor.pitch, cameraActor.yaw, 0);
      }
      this.syncViewWeaponVisual(activeViewWeapon, cameraJumpPose, grenadeSelected);
      for (const [actorId, root] of this.actorRoots) {
        const actor = this.getActor(actorId);
        if (!root.position.equalsToFloats(actor.position.x, actor.position.y, actor.position.z)) {
          root.position.set(actor.position.x, actor.position.y, actor.position.z);
        }
        if (root.rotation.y !== actor.yaw) root.rotation.y = actor.yaw;
        const pose = jumpPoses.get(actorId) ?? neutralJumpVisualPose();
        const visualRoot = this.actorVisualRoots.get(actorId);
        if (visualRoot) applyActorVisualPose(visualRoot, pose.actorY, pose.actorRotationX);
        const signature = `${actor.alive}:${actor.deployment}:${getActiveWeapon(actor)?.weaponId ?? "none"}:${actor.inventory.armorLevel}:${actor.inventory.helmetLevel}:${actorId === cameraActor.id}`;
        if (this.actorVisualSignatures.get(actorId) !== signature) {
          root.setEnabled(actor.alive && actor.deployment !== "aircraft" && actorId !== cameraActor.id);
          if (actor.kind === "bot") {
            setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
            setActorParachuteVisual(root, actor.deployment === "parachuting");
            setActorEquipmentVisual(root, actor.inventory.armorLevel, actor.inventory.helmetLevel);
          }
          this.actorVisualSignatures.set(actorId, signature);
        }
      }
      for (const [lootId, mesh] of this.lootMeshes) {
        const loot = this.simulation.state.groundLoot[lootId];
        const enabled = Boolean(loot?.available);
        if (mesh.isEnabled(false) !== enabled) mesh.setEnabled(enabled);
        if (enabled) mesh.rotation.y += (mesh.metadata?.lootModel === true ? 0.24 : 1.8) * visualDeltaSeconds;
      }
      const zone = this.simulation.state.safeZone;
      this.syncSafeZoneRing(zone.center.x, zone.center.z, zone.radius);
      this.grenadePresentation.sync(this.simulation.state.activeGrenades, visualDeltaSeconds);
      this.grenadePresentation.showTrajectory(this.localGrenadeTrajectory(player));
    }
  }

  private localGrenadeTrajectory(player: ActorState): ReturnType<typeof sampleGrenadeTrajectory> | null {
    if (!this.humanController.isGrenadePreparing() || player.deployment !== "grounded") return null;
    const origin = { x: player.position.x, y: player.position.y - 0.3, z: player.position.z };
    const velocity = createGrenadeThrowVelocity(
      this.humanController.getAimDirection(),
      this.humanController.getGrenadeThrowMode(),
    );
    return sampleGrenadeTrajectory(origin, velocity, this.combatWorld);
  }

  private syncViewWeaponVisual(
    weapon: ReturnType<typeof getActiveWeapon>,
    jumpPose: JumpVisualPose,
    grenadeSelected = false,
  ): void {
    const reload = getReloadVisualTransform(weapon);
    const y = (reload?.y ?? 0) + jumpPose.weaponY + (grenadeSelected ? 0.03 : 0);
    const rotationX = (reload?.rotationX ?? 0) + jumpPose.weaponRotationX + (grenadeSelected ? -0.08 : 0);
    const rotationZ = reload?.rotationZ ?? 0;
    if (!this.viewWeaponRoot.position.equalsToFloats(0, y, 0)) this.viewWeaponRoot.position.set(0, y, 0);
    if (!this.viewWeaponRoot.rotation.equalsToFloats(rotationX, 0, rotationZ)) {
      this.viewWeaponRoot.rotation.set(rotationX, 0, rotationZ);
    }
  }

  private getJumpVisualPose(actor: ActorState): JumpVisualPose {
    let state = this.jumpVisualStates.get(actor.id);
    if (!state) {
      state = { wasAirborne: false, landingStartedSeconds: Number.NEGATIVE_INFINITY };
      this.jumpVisualStates.set(actor.id, state);
    }
    return updateJumpVisualPose(actor, state, this.simulation.state.elapsedSeconds);
  }

  private getActor(actorId: EntityId): ActorState {
    const actor = this.simulation.state.actors[actorId];
    if (!actor) throw new Error(`角色不存在: ${actorId}`);
    return actor;
  }

  private resumeInput(): void {
    this.audio.start();
    if (this.humanController.usesTouchControls()) {
      this.humanController.resumeInput();
      return;
    }
    requestDesktopPointerLockSafely(
      this.canvas,
      false,
      document.pointerLockElement,
    );
  }

  private readonly handleDebugKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "F10" || event.repeat || !this.debugPanel) return;
    event.preventDefault();
    if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
    this.debugPanel.focus();
  };
}

async function loadSinglePlayerDebugSupport(state: MatchState): Promise<SinglePlayerDebugSupport | null> {
  if (!__SINGLE_PLAYER_DEBUG__) return null;
  const [{ SinglePlayerDebugPanel }, debug] = await Promise.all([
    import("../client/ui/SinglePlayerDebugPanel"),
    import("../game/systems/SinglePlayerDebugSystem"),
    import("../styles/debug.css"),
  ]);
  const layout = createMapLayout(state.mapId, state.mapSeed);
  return {
    damage: debug.createSinglePlayerDebugDamageSystem(PLAYER_ID),
    system: new debug.SinglePlayerDebugSystem(PLAYER_ID, layout),
    createPanel: (root, onAction) => new SinglePlayerDebugPanel(root, onAction),
  };
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

function neutralJumpVisualPose(): JumpVisualPose {
  return {
    actorY: 0,
    actorRotationX: 0,
    cameraY: 0,
    weaponY: 0,
    weaponRotationX: 0,
  };
}

export function updateJumpVisualPose(
  actor: ActorState,
  state: JumpVisualState,
  elapsedSeconds: number,
): JumpVisualPose {
  if (actor.deployment !== "grounded") {
    state.wasAirborne = false;
    state.landingStartedSeconds = Number.NEGATIVE_INFINITY;
    return neutralJumpVisualPose();
  }
  const airborne = Math.abs(actor.velocity.y) > 0.01;
  if (state.wasAirborne && !airborne) state.landingStartedSeconds = elapsedSeconds;
  state.wasAirborne = airborne;
  if (airborne) {
    const vertical = Math.max(-1, Math.min(1, actor.velocity.y / 8));
    return {
      actorY: -0.045 * Math.max(0, vertical),
      actorRotationX: -0.13 * vertical,
      cameraY: 0,
      weaponY: -0.045 * vertical,
      weaponRotationX: -0.09 * vertical,
    };
  }
  const landingProgress = (elapsedSeconds - state.landingStartedSeconds) / LANDING_VISUAL_SECONDS;
  if (landingProgress < 0 || landingProgress >= 1) return neutralJumpVisualPose();
  const impact = Math.sin(landingProgress * Math.PI) * (1 - landingProgress * 0.35);
  return {
    actorY: -0.13 * impact,
    actorRotationX: 0.12 * impact,
    cameraY: -0.08 * impact,
    weaponY: -0.16 * impact,
    weaponRotationX: 0.18 * impact,
  };
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
