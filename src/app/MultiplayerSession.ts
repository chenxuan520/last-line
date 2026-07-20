import type { Engine } from "@babylonjs/core/Engines/engine";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { CombatEffects } from "../client/render/CombatEffects";
import {
  applyActorVisualPose,
  createIslandScene,
  setActorParachuteVisual,
  setActorWeaponVisual,
} from "../client/render/scenes/IslandScene";
import { GameHud } from "../client/ui/GameHud";
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
import { MovementSystem } from "../game/systems/MovementSystem";
import { MultiplayerConnection } from "../network/MultiplayerClient";
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

interface RemotePose {
  from: Vector3State;
  to: Vector3State;
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
  private readonly movement = new MovementSystem();
  private readonly queuedMessages: ServerMessage[] = [];
  private readonly pendingInputs: PendingInput[] = [];
  private readonly actorVisualSignatures = new Map<EntityId, string>();
  private readonly jumpVisualStates = new Map<EntityId, JumpVisualState>();
  private readonly remotePoses = new Map<EntityId, RemotePose>();
  private state: MatchState;
  private displayNames: Record<EntityId, string>;
  private hud: GameHud | null = null;
  private active = false;
  private disposed = false;
  private inputSequence = 0;
  private lastSnapshotSequence = -1;
  private lastEventSequence = -1;
  private interpolationProgress = 1;
  private playerEliminated = false;
  private spectatorActorId: EntityId | null = null;
  private visibleActorIds = new Set<EntityId>();

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
    this.humanController = new HumanController(canvas, settings.sensitivity);
    this.effects = new CombatEffects(this.scene);
    this.lastSnapshotSequence = initial.snapshotSequence;
    this.processSequencedEvents(initial.events);
    for (const actor of Object.values(this.state.actors)) {
      this.remotePoses.set(actor.id, { from: { ...actor.position }, to: { ...actor.position } });
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
      settings.showGroundLootIcons,
      initial.localActorId,
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
      () => this.requestPointerLock(),
      this.onExit,
      { online: true, actorLabels: this.displayNames },
    );
    this.audio.start();
    this.syncVisuals();
    this.synchronizeOutcome();
    this.requestPointerLock();
  }

  public update(frameSeconds: number, fps: number): void {
    if (!this.active) return;
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
    this.interpolationProgress = Math.min(1, this.interpolationProgress + frameSeconds * 10);
    this.effects.update(frameSeconds);
    this.syncVisuals();
    const viewedActor = this.spectatorActorId ? this.state.actors[this.spectatorActorId] ?? player : player;
    const pointerLocked = document.pointerLockElement === this.canvas;
    this.hud?.update(
      this.state,
      player,
      viewedActor,
      pointerLocked,
      fps,
      this.humanController.isScoped(player),
      this.humanController.isLeaderboardVisible(),
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.connection.setMessageHandler(null);
    this.connection.setStatusHandler(null);
    this.connection.close();
    this.hud?.dispose();
    this.hud = null;
    this.humanController.dispose();
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
    this.lastEventSequence = -1;
    this.pendingInputs.length = 0;
    this.remotePoses.clear();
    for (const actor of Object.values(this.state.actors)) {
      this.remotePoses.set(actor.id, { from: { ...actor.position }, to: { ...actor.position } });
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
    const renderedPositions = new Map<EntityId, Vector3State>();
    const previouslyVisibleActorIds = this.visibleActorIds;
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
    }
    this.remotePoses.clear();
    for (const actor of Object.values(this.state.actors)) {
      const from = this.visibleActorIds.has(actor.id) && !previouslyVisibleActorIds.has(actor.id)
        ? actor.position
        : renderedPositions.get(actor.id) ?? actor.position;
      this.remotePoses.set(actor.id, { from: { ...from }, to: { ...actor.position } });
    }
    this.interpolationProgress = 0;
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

  private syncVisuals(): void {
    const player = this.getActor(this.localActorId);
    const spectator = this.spectatorActorId ? this.state.actors[this.spectatorActorId] : undefined;
    const cameraActor = spectator ?? player;
    const activeViewWeapon = getActiveWeapon(cameraActor);
    const scoped = cameraActor.id === this.localActorId && this.humanController.isScoped(player);
    this.camera.fov = scoped ? WEAPONS[activeViewWeapon?.weaponId ?? ""]?.scopeFov ?? 1.18 : 1.18;
    this.viewWeaponRoot.setEnabled(Boolean(activeViewWeapon) && !scoped && cameraActor.deployment === "grounded");
    setActorWeaponVisual(this.viewWeaponRoot, activeViewWeapon?.weaponId ?? null);
    this.aircraftInteriorRoot.setEnabled(cameraActor.id === this.localActorId && player.deployment === "aircraft");
    this.syncAircraftVisual(this.state.flight, this.state.phase === "flight" && player.deployment !== "aircraft");
    const cameraPose = this.getJumpVisualPose(cameraActor);
    const cameraPosition = this.visualPosition(cameraActor.id, cameraActor.position);
    this.camera.position.set(cameraPosition.x, cameraPosition.y + cameraPose.cameraY, cameraPosition.z);
    this.camera.rotation.set(cameraActor.pitch, cameraActor.yaw, 0);
    this.syncViewWeaponVisual(activeViewWeapon, cameraPose.weaponY, cameraPose.weaponRotationX);
    for (const [actorId, root] of this.actorRoots) {
      const actor = this.getActor(actorId);
      const position = this.visualPosition(actorId, actor.position);
      root.position.set(position.x, position.y, position.z);
      root.rotation.y = actor.yaw;
      const pose = this.getJumpVisualPose(actor);
      const visualRoot = this.actorVisualRoots.get(actorId);
      if (visualRoot) applyActorVisualPose(visualRoot, pose.actorY, pose.actorRotationX);
      const signature = `${actor.alive}:${actor.deployment}:${getActiveWeapon(actor)?.weaponId ?? "none"}:${actorId === cameraActor.id}:${this.visibleActorIds.has(actorId)}`;
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
        }
        this.actorVisualSignatures.set(actorId, signature);
      }
    }
    for (const [lootId, mesh] of this.lootMeshes) {
      const loot = this.state.groundLoot[lootId];
      mesh.setEnabled(Boolean(loot?.available));
      if (loot?.available && mesh.metadata?.lootIcon !== true) mesh.rotation.y += 0.06;
    }
    this.syncSafeZoneRing(this.state.safeZone.center.x, this.state.safeZone.center.z, this.state.safeZone.radius);
  }

  private visualPosition(actorId: EntityId, fallback: Vector3State): Vector3State {
    if (actorId === this.localActorId) return fallback;
    const pose = this.remotePoses.get(actorId);
    if (!pose) return fallback;
    const amount = this.interpolationProgress;
    return {
      x: pose.from.x + (pose.to.x - pose.from.x) * amount,
      y: pose.from.y + (pose.to.y - pose.from.y) * amount,
      z: pose.from.z + (pose.to.z - pose.from.z) * amount,
    };
  }

  private syncViewWeaponVisual(
    weapon: ReturnType<typeof getActiveWeapon>,
    jumpY: number,
    jumpRotationX: number,
  ): void {
    const reload = getReloadVisualTransform(weapon);
    this.viewWeaponRoot.position.set(0, (reload?.y ?? 0) + jumpY, 0);
    this.viewWeaponRoot.rotation.set(
      (reload?.rotationX ?? 0) + jumpRotationX,
      0,
      reload?.rotationZ ?? 0,
    );
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

  private requestPointerLock(): void {
    this.audio.start();
    void this.canvas.requestPointerLock().catch(() => {});
  }
}
