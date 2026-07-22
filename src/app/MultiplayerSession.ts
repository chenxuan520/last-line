import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { CombatEffects } from "../client/render/CombatEffects";
import {
  applyActorVisualPose,
  createIslandScene,
  setActorParachuteVisual,
  setActorEquipmentVisual,
  setActorWeaponVisual,
} from "../client/render/scenes/IslandScene";
import { GameHud } from "../client/ui/GameHud";
import { createMapLayout } from "../config/map";
import type { GameSettings } from "../config/settings";
import { WEAPONS } from "../config/weapons";
import { HumanController } from "../controllers/HumanController";
import { FixedStepClock } from "../game/FixedStepClock";
import {
  getActiveWeapon,
  type ActorState,
  type EntityId,
  type GameEvent,
  type MatchState,
  type Vector3State,
} from "../game/state/types";
import { MAX_GLIDE_SPEED, MovementSystem, PARACHUTE_DESCENT_SPEED } from "../game/systems/MovementSystem";
import { MultiplayerConnection } from "../network/MultiplayerClient";
import {
  advancePositionTransition,
  createCorrectionTransition,
  createPositionTransition,
  createRemotePositionTransition,
  positionTransitionComplete,
  samplePositionTransition,
  snapshotElapsedSeconds,
  snapshotInterpolationSeconds,
  type PositionTransition,
} from "../network/PositionSmoothing";
import type { ClientMessage, SequencedGameEvent, ServerMessage } from "../network/protocol";
import {
  cycleSpectatorActorId,
  getReloadVisualTransform,
  resolveSpectatorActorId,
  updateJumpVisualPose,
  type JumpVisualState,
} from "./BattleRoyaleSession";
import type { GameSession } from "./GameSession";

type FullMessage = Extract<ServerMessage, { type: "match.full" }>;
type SnapshotMessage = Extract<ServerMessage, { type: "match.snapshot" }>;

interface PendingInput {
  sequence: number;
  command: Extract<ClientMessage, { type: "match.input" }>["command"];
}

export class MultiplayerSession implements GameSession {
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
  private readonly humanController: HumanController;
  private readonly effects: CombatEffects;
  private readonly clock = new FixedStepClock();
  private readonly movement: MovementSystem;
  private readonly queuedMessages: ServerMessage[] = [];
  private readonly pendingInputs: PendingInput[] = [];
  private readonly actorVisualSignatures = new Map<EntityId, string>();
  private readonly jumpVisualStates = new Map<EntityId, JumpVisualState>();
  private readonly remotePoses = new Map<EntityId, PositionTransition>();
  private state: MatchState;
  private displayNames: Record<EntityId, string>;
  private hud: GameHud | null = null;
  private active = false;
  private disposed = false;
  private inputSequence = 0;
  private lastSnapshotSequence = -1;
  private lastSnapshotTick = -1;
  private lastEventSequence = -1;
  private localCorrection: PositionTransition | null = null;
  private playerEliminated = false;
  private spectatorActorId: EntityId | null = null;
  private visibleActorIds = new Set<EntityId>();
  private lastViewWeaponId: string | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLDivElement,
    private readonly assets: AssetCatalog,
    settings: GameSettings,
    private readonly audio: AudioFeedback,
    private readonly connection: MultiplayerConnection,
    private readonly localActorId: EntityId,
    private readonly onExit: () => void,
    bundle: Awaited<ReturnType<typeof createIslandScene>>,
    initial: FullMessage,
  ) {
    this.state = initial.state;
    this.displayNames = initial.displayNames;
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
    this.movement = new MovementSystem(createMapLayout(initial.state.mapSeed));
    this.humanController = new HumanController(canvas, settings.sensitivity, { touchRoot: uiRoot });
    this.effects = new CombatEffects(this.scene);
    this.lastSnapshotSequence = initial.snapshotSequence;
    this.lastSnapshotTick = initial.tick;
    this.processSequencedEvents(initial.events);
    for (const actor of Object.values(this.state.actors)) {
      this.remotePoses.set(actor.id, createPositionTransition(actor.position, actor.position, 0));
      if (actor.position.y > -5_000) this.visibleActorIds.add(actor.id);
    }
    this.connection.setMessageHandler((message) => this.enqueueMessage(message));
  }

  public static async create(
    engine: Engine,
    canvas: HTMLCanvasElement,
    uiRoot: HTMLDivElement,
    assets: AssetCatalog,
    settings: GameSettings,
    audio: AudioFeedback,
    connection: MultiplayerConnection,
    initial: FullMessage,
    onExit: () => void,
  ): Promise<MultiplayerSession> {
    const bundle = await createIslandScene(
      engine,
      assets,
      initial.state.actors,
      initial.state.groundLoot,
      initial.state.mapSeed,
      settings.showGroundLootModels,
      initial.localActorId,
      settings.quality,
    );
    return new MultiplayerSession(
      canvas,
      uiRoot,
      assets,
      settings,
      audio,
      connection,
      initial.localActorId,
      onExit,
      bundle,
      initial,
    );
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.hud = new GameHud(
      this.uiRoot,
      this.assets,
      this.state.mapSeed,
      () => this.resumeInput(),
      this.onExit,
      { online: true, actorLabels: this.displayNames, touchInput: this.humanController.usesTouchControls() },
    );
    this.audio.start();
    this.syncVisuals(0);
    this.synchronizeOutcome();
    this.resumeInput();
  }

  public update(frameSeconds: number, fps: number): void {
    if (!this.active) return;
    this.advanceVisualSmoothing(frameSeconds);
    if (!this.processMessages()) return;
    const player = this.getActor(this.localActorId);
    this.humanController.rememberActor(player);
    const spectatorSwitch = this.humanController.consumeSpectatorSwitchRequest();
    if (!player.alive && spectatorSwitch) {
      this.spectatorActorId = cycleSpectatorActorId(
        this.localActorId,
        this.spectatorActorId,
        this.state.actors,
        spectatorSwitch,
      );
    }
    if (this.state.phase !== "finished") {
      this.clock.advance(frameSeconds, (deltaSeconds) => this.sendInput(deltaSeconds));
    }
    this.effects.update(frameSeconds);
    this.syncVisuals(frameSeconds);
    const viewedActor = this.spectatorActorId ? this.state.actors[this.spectatorActorId] ?? player : player;
    const inputActive = this.humanController.isGameplayInputActive();
    this.hud?.update(
      this.state,
      player,
      viewedActor,
      inputActive,
      frameSeconds,
      fps,
      this.humanController.isScoped(player),
      this.humanController.isLeaderboardVisible(),
      this.humanController.isOrientationBlocked(),
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.connection.setMessageHandler(null);
    this.connection.setStatusHandler(null);
    this.connection.close();
    this.humanController.dispose();
    this.hud?.dispose();
    this.hud = null;
    this.effects.dispose();
    this.scene.dispose();
    this.queuedMessages.length = 0;
    this.pendingInputs.length = 0;
    this.actorRoots.clear();
    this.actorVisualRoots.clear();
    this.lootMeshes.clear();
    this.actorVisualSignatures.clear();
    this.jumpVisualStates.clear();
    this.remotePoses.clear();
    this.visibleActorIds.clear();
  }

  private processMessages(): boolean {
    for (const message of this.queuedMessages.splice(0)) {
      if (message.type === "error" && (message.code === "room-closed" || message.code === "account-disabled")) {
        this.onExit();
        return false;
      }
      if (message.type === "match.full") this.applyFull(message);
      if (message.type === "match.snapshot") this.applySnapshot(message);
    }
    return true;
  }

  private applyFull(message: FullMessage): void {
    if (message.localActorId !== this.localActorId) return;
    this.state = message.state;
    this.displayNames = message.displayNames;
    const restoredPlayer = this.state.actors[this.localActorId];
    if (restoredPlayer?.alive && this.state.phase !== "finished") {
      this.playerEliminated = false;
      this.spectatorActorId = null;
      this.hud?.clearResult();
    }
    this.lastSnapshotSequence = message.snapshotSequence;
    this.lastSnapshotTick = message.tick;
    this.lastEventSequence = -1;
    this.pendingInputs.length = 0;
    this.localCorrection = null;
    this.remotePoses.clear();
    for (const actor of Object.values(this.state.actors)) {
      this.remotePoses.set(actor.id, createPositionTransition(actor.position, actor.position, 0));
    }
    this.visibleActorIds = new Set(Object.values(this.state.actors)
      .filter((actor) => actor.position.y > -5_000)
      .map((actor) => actor.id));
    this.syncLootMeshes(this.state.groundLoot);
    this.processSequencedEvents(message.events);
    this.synchronizeOutcome();
  }

  private applySnapshot(message: SnapshotMessage): void {
    const frame = message.frame;
    if (frame.snapshotSequence <= this.lastSnapshotSequence) return;
    this.lastSnapshotSequence = frame.snapshotSequence;
    const snapshotSeconds = snapshotElapsedSeconds(this.lastSnapshotTick, frame.tick);
    const interpolationSeconds = snapshotInterpolationSeconds(this.lastSnapshotTick, frame.tick);
    this.lastSnapshotTick = frame.tick;
    const renderedPositions = new Map<EntityId, Vector3State>();
    const previouslyVisibleActorIds = this.visibleActorIds;
    const previousActors = this.state.actors;
    const previousLocalActor = previousActors[this.localActorId];
    for (const [actorId, actor] of Object.entries(this.state.actors)) {
      renderedPositions.set(actorId, this.visualPosition(actorId, actor.position));
    }
    this.state = {
      ...this.state,
      phase: frame.phase,
      elapsedSeconds: frame.elapsedSeconds,
      flight: frame.flight,
      safeZone: frame.safeZone,
      result: frame.result,
      actors: frame.actors,
      groundLoot: { ...this.state.groundLoot },
    };
    for (const loot of frame.lootChanges) this.state.groundLoot[loot.id] = loot;
    this.visibleActorIds = new Set(frame.visibleActorIds);
    const player = this.state.actors[this.localActorId];
    const firstUnacknowledged = this.pendingInputs.findIndex((input) => input.sequence > message.ackSequence);
    if (firstUnacknowledged < 0) this.pendingInputs.length = 0;
    else this.pendingInputs.splice(0, firstUnacknowledged);
    if (player) {
      for (const input of this.pendingInputs) {
        this.movement.processCommand(this.state, this.localActorId, input.command, 1 / 30);
      }
      this.beginLocalCorrection(
        renderedPositions.get(this.localActorId) ?? player.position,
        previousLocalActor,
        player,
        interpolationSeconds,
      );
    } else {
      this.localCorrection = null;
    }
    this.remotePoses.clear();
    for (const actor of Object.values(this.state.actors)) {
      const newlyVisible = this.visibleActorIds.has(actor.id) && !previouslyVisibleActorIds.has(actor.id);
      this.remotePoses.set(actor.id, createRemotePositionTransition(
        renderedPositions.get(actor.id) ?? actor.position,
        previousActors[actor.id],
        actor,
        interpolationSeconds,
        snapshotSeconds,
        Math.hypot(MAX_GLIDE_SPEED, PARACHUTE_DESCENT_SPEED),
        newlyVisible,
      ));
    }
    this.syncLootMeshes(this.state.groundLoot);
    this.processSequencedEvents(frame.events);
    this.synchronizeOutcome();
  }

  private sendInput(deltaSeconds: number): void {
    const player = this.state.actors[this.localActorId];
    if (!player?.alive) return;
    this.humanController.rememberActor(player);
    const command = this.humanController.createCommand(player);
    this.inputSequence += 1;
    const message: ClientMessage = { type: "match.input", sequence: this.inputSequence, command };
    if (this.connection.send(message)) {
      this.pendingInputs.push({ sequence: this.inputSequence, command });
      if (this.pendingInputs.length > 180) this.pendingInputs.shift();
      this.movement.processCommand(this.state, this.localActorId, command, deltaSeconds);
    }
  }

  private processSequencedEvents(events: readonly SequencedGameEvent[]): void {
    const fresh = events.filter((entry) => entry.sequence > this.lastEventSequence);
    if (fresh.length === 0) return;
    this.lastEventSequence = Math.max(this.lastEventSequence, ...fresh.map((entry) => entry.sequence));
    this.processEvents(fresh.map((entry) => entry.event));
  }

  private enqueueMessage(message: ServerMessage): void {
    if (message.type === "match.full") {
      for (let index = this.queuedMessages.length - 1; index >= 0; index -= 1) {
        if (this.queuedMessages[index]?.type === "match.snapshot" || this.queuedMessages[index]?.type === "match.full") {
          this.queuedMessages.splice(index, 1);
        }
      }
      this.queuedMessages.push(message);
      return;
    }
    if (message.type !== "match.snapshot") {
      this.queuedMessages.push(message);
      return;
    }
    let previousIndex = -1;
    for (let index = this.queuedMessages.length - 1; index >= 0; index -= 1) {
      const queued = this.queuedMessages[index];
      if (queued?.type === "match.full") break;
      if (queued?.type === "match.snapshot") {
        previousIndex = index;
        break;
      }
    }
    if (previousIndex < 0) {
      this.queuedMessages.push(message);
      return;
    }
    const previous = this.queuedMessages[previousIndex] as SnapshotMessage;
    const eventMap = new Map([...previous.frame.events, ...message.frame.events].map((entry) => [entry.sequence, entry]));
    const lootMap = new Map([...previous.frame.lootChanges, ...message.frame.lootChanges].map((loot) => [loot.id, loot]));
    this.queuedMessages[previousIndex] = {
      ...message,
      frame: {
        ...message.frame,
        events: [...eventMap.values()].sort((left, right) => left.sequence - right.sequence),
        lootChanges: [...lootMap.values()],
      },
    };
  }

  private synchronizeOutcome(): void {
    const player = this.state.actors[this.localActorId];
    if (!player || !this.hud) return;
    if (this.state.phase === "finished" && this.state.result) {
      if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
      this.hud.showResult(this.state.result, this.localActorId, player.kills);
      return;
    }
    if (!player.alive && !this.playerEliminated) {
      if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
      this.playerEliminated = true;
      this.spectatorActorId = Object.values(this.state.actors)
        .filter((actor) => actor.alive && actor.id !== this.localActorId)
        .sort((left, right) => left.id.localeCompare(right.id))[0]?.id ?? null;
      const placement = Object.values(this.state.actors).filter((actor) => actor.alive).length + 1;
      this.hud.showEliminated(placement, player.kills, "断线期间被淘汰", false);
    }
  }

  private processEvents(events: readonly GameEvent[]): void {
    this.hud?.handleEvents(events, this.localActorId);
    const player = this.getActor(this.localActorId);
    const observer = this.spectatorActorId ? this.state.actors[this.spectatorActorId] ?? player : player;
    this.audio.handleEvents(events, {
      playerId: this.localActorId,
      observerId: observer.id,
      position: observer.position,
    });
    this.effects.handleEvents(events, this.localActorId);
    for (const event of events) {
      if (event.type === "shot-fired" && event.actorId === this.localActorId) {
        this.humanController.applyRecoil(WEAPONS[event.weaponId]?.recoil ?? 0);
      }
      if (event.type === "actor-died") {
        this.actorRoots.get(event.actorId)?.setEnabled(false);
        this.spectatorActorId = resolveSpectatorActorId(
          this.localActorId,
          this.spectatorActorId,
          event,
          this.state.actors,
        );
        if (event.actorId === this.localActorId && !this.playerEliminated) {
          this.playerEliminated = true;
          if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
          const placement = Object.values(this.state.actors).filter((actor) => actor.alive).length + 1;
          const sourceLabel = event.sourceId
            ? this.displayNames[event.sourceId] ?? event.sourceId
            : "安全区";
          const weaponLabel = event.weaponId ? WEAPONS[event.weaponId]?.label ?? event.weaponId : "武器";
          this.hud?.showEliminated(
            placement,
            player.kills,
            event.sourceId ? `被 ${sourceLabel} 使用 ${weaponLabel} 淘汰` : "被安全区淘汰",
            Boolean(event.sourceId && this.spectatorActorId === event.sourceId),
          );
        }
      }
      if (event.type === "match-finished") {
        if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
        this.hud?.showResult(event.result, this.localActorId, player.kills);
      }
    }
  }

  private syncVisuals(frameSeconds: number): void {
    const player = this.getActor(this.localActorId);
    const spectator = this.spectatorActorId ? this.state.actors[this.spectatorActorId] : undefined;
    const cameraActor = spectator ?? player;
    const activeViewWeapon = getActiveWeapon(cameraActor);
    const scoped = cameraActor.id === this.localActorId && this.humanController.isScoped(player);
    const targetFov = scoped ? WEAPONS[activeViewWeapon?.weaponId ?? ""]?.scopeFov ?? 1.18 : 1.18;
    if (this.camera.fov !== targetFov) this.camera.fov = targetFov;
    const viewWeaponEnabled = Boolean(activeViewWeapon) && !scoped && cameraActor.deployment === "grounded";
    if (this.viewWeaponRoot.isEnabled() !== viewWeaponEnabled) this.viewWeaponRoot.setEnabled(viewWeaponEnabled);
    const viewWeaponId = activeViewWeapon?.weaponId ?? null;
    if (this.lastViewWeaponId !== viewWeaponId) {
      setActorWeaponVisual(this.viewWeaponRoot, viewWeaponId);
      this.lastViewWeaponId = viewWeaponId;
    }
    const aircraftInteriorEnabled = cameraActor.id === this.localActorId && player.deployment === "aircraft";
    if (this.aircraftInteriorRoot.isEnabled() !== aircraftInteriorEnabled) {
      this.aircraftInteriorRoot.setEnabled(aircraftInteriorEnabled);
    }
    this.syncAircraftVisual(this.state.flight, this.state.phase === "flight" && player.deployment !== "aircraft");
    const cameraPose = this.getJumpVisualPose(cameraActor);
    const cameraPosition = this.visualPosition(cameraActor.id, cameraActor.position);
    const cameraY = cameraPosition.y + cameraPose.cameraY;
    if (!this.camera.position.equalsToFloats(cameraPosition.x, cameraY, cameraPosition.z)) {
      this.camera.position.set(cameraPosition.x, cameraY, cameraPosition.z);
    }
    if (!this.camera.rotation.equalsToFloats(cameraActor.pitch, cameraActor.yaw, 0)) {
      this.camera.rotation.set(cameraActor.pitch, cameraActor.yaw, 0);
    }
    this.syncViewWeaponVisual(activeViewWeapon, cameraPose.weaponY, cameraPose.weaponRotationX);
    for (const [actorId, root] of this.actorRoots) {
      const actor = this.getActor(actorId);
      const position = this.visualPosition(actorId, actor.position);
      if (!root.position.equalsToFloats(position.x, position.y, position.z)) {
        root.position.set(position.x, position.y, position.z);
      }
      if (root.rotation.y !== actor.yaw) root.rotation.y = actor.yaw;
      const pose = this.getJumpVisualPose(actor);
      const visualRoot = this.actorVisualRoots.get(actorId);
      if (visualRoot) applyActorVisualPose(visualRoot, pose.actorY, pose.actorRotationX);
      const signature = `${actor.alive}:${actor.deployment}:${getActiveWeapon(actor)?.weaponId ?? "none"}:${actor.inventory.armorLevel}:${actor.inventory.helmetLevel}:${actorId === cameraActor.id}:${this.visibleActorIds.has(actorId)}`;
      if (this.actorVisualSignatures.get(actorId) !== signature) {
        root.setEnabled(
          actor.alive &&
          actor.deployment !== "aircraft" &&
          actorId !== cameraActor.id &&
          this.visibleActorIds.has(actorId),
        );
        if (actorId !== this.localActorId) {
          setActorWeaponVisual(root, getActiveWeapon(actor)?.weaponId ?? null);
          setActorParachuteVisual(root, actor.deployment === "parachuting");
          setActorEquipmentVisual(root, actor.inventory.armorLevel, actor.inventory.helmetLevel);
        }
        this.actorVisualSignatures.set(actorId, signature);
      }
    }
    for (const [lootId, mesh] of this.lootMeshes) {
      const loot = this.state.groundLoot[lootId];
      const enabled = Boolean(loot?.available);
      if (mesh.isEnabled(false) !== enabled) mesh.setEnabled(enabled);
      if (enabled) {
        mesh.rotation.y += (mesh.metadata?.lootModel === true ? 0.24 : 1.8) * Math.min(frameSeconds, 0.1);
      }
    }
    this.syncSafeZoneRing(this.state.safeZone.center.x, this.state.safeZone.center.z, this.state.safeZone.radius);
  }

  private visualPosition(actorId: EntityId, fallback: Vector3State): Vector3State {
    if (actorId === this.localActorId) {
      if (!this.localCorrection) return fallback;
      const offset = samplePositionTransition(this.localCorrection);
      return { x: fallback.x + offset.x, y: fallback.y + offset.y, z: fallback.z + offset.z };
    }
    const pose = this.remotePoses.get(actorId);
    if (!pose) return fallback;
    return samplePositionTransition(pose);
  }

  private advanceVisualSmoothing(frameSeconds: number): void {
    for (const pose of this.remotePoses.values()) advancePositionTransition(pose, frameSeconds);
    if (!this.localCorrection) return;
    advancePositionTransition(this.localCorrection, frameSeconds);
    if (positionTransitionComplete(this.localCorrection)) this.localCorrection = null;
  }

  private beginLocalCorrection(
    previousVisualPosition: Vector3State,
    previousActor: ActorState | undefined,
    player: ActorState,
    durationSeconds: number,
  ): void {
    if (!previousActor || previousActor.alive !== player.alive || previousActor.deployment !== player.deployment) {
      this.localCorrection = null;
      return;
    }
    this.localCorrection = createCorrectionTransition(
      previousVisualPosition,
      player.position,
      durationSeconds,
      6,
    );
  }

  private syncViewWeaponVisual(
    weapon: ReturnType<typeof getActiveWeapon>,
    jumpY: number,
    jumpRotationX: number,
  ): void {
    const reload = getReloadVisualTransform(weapon);
    const y = (reload?.y ?? 0) + jumpY;
    const rotationX = (reload?.rotationX ?? 0) + jumpRotationX;
    const rotationZ = reload?.rotationZ ?? 0;
    if (!this.viewWeaponRoot.position.equalsToFloats(0, y, 0)) this.viewWeaponRoot.position.set(0, y, 0);
    if (!this.viewWeaponRoot.rotation.equalsToFloats(rotationX, 0, rotationZ)) {
      this.viewWeaponRoot.rotation.set(rotationX, 0, rotationZ);
    }
  }

  private getJumpVisualPose(actor: ActorState) {
    let state = this.jumpVisualStates.get(actor.id);
    if (!state) {
      state = { wasAirborne: false, landingStartedSeconds: Number.NEGATIVE_INFINITY };
      this.jumpVisualStates.set(actor.id, state);
    }
    return updateJumpVisualPose(actor, state, this.state.elapsedSeconds);
  }

  private getActor(actorId: EntityId): ActorState {
    const actor = this.state.actors[actorId];
    if (!actor) throw new Error(`角色不存在: ${actorId}`);
    return actor;
  }

  private resumeInput(): void {
    this.audio.start();
    if (this.humanController.usesTouchControls()) {
      this.humanController.resumeInput();
      return;
    }
    void this.canvas.requestPointerLock().catch(() => {});
  }
}
