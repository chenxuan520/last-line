import type { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { createIslandScene } from "../client/render/scenes/IslandScene";
import { GameHud } from "../client/ui/GameHud";
import type { GameSettings } from "../config/settings";
import { WEAPONS } from "../config/weapons";
import { BotController } from "../controllers/BotController";
import { HumanController } from "../controllers/HumanController";
import type { ActorCommand } from "../game/commands/ActorCommand";
import { FixedStepClock } from "../game/FixedStepClock";
import { GameSimulation } from "../game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleState } from "../game/modes/BattleRoyaleMode";
import { getActiveWeapon, type ActorState, type EntityId, type MatchState } from "../game/state/types";
import { SimulationCombatWorld } from "../game/systems/SimulationCombatWorld";

const PLAYER_ID = "player";

export class BattleRoyaleSession {
  public readonly scene;
  private readonly camera;
  private readonly actorRoots: Map<EntityId, TransformNode>;
  private readonly lootMeshes;
  private readonly syncLootMeshes;
  private readonly safeZoneRing;
  private readonly simulation: GameSimulation;
  private readonly clock = new FixedStepClock();
  private readonly humanController: HumanController;
  private readonly botControllers = new Map<EntityId, BotController>();
  private readonly combatWorld: SimulationCombatWorld;
  private readonly audio: AudioFeedback;
  private hud: GameHud | null = null;
  private active = false;
  private playerEliminated = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLDivElement,
    private readonly assets: AssetCatalog,
    settings: GameSettings,
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
    this.safeZoneRing = bundle.safeZoneRing;
    this.humanController = new HumanController(canvas, settings.sensitivity);
    this.audio = new AudioFeedback(settings.volume);
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
    onRestart: () => void,
  ): Promise<BattleRoyaleSession> {
    const state = createBattleRoyaleState(PLAYER_ID);
    const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot);
    return new BattleRoyaleSession(canvas, uiRoot, assets, settings, onRestart, bundle, state);
  }

  public start(): void {
    if (this.active) return;
    this.active = true;
    this.hud = new GameHud(this.uiRoot, this.assets, () => this.requestPointerLock(), this.onRestart);
    this.audio.start();
    this.simulation.start();
    this.processEvents();
    this.syncVisuals();
    this.requestPointerLock();
  }

  public update(frameSeconds: number, fps: number): void {
    if (!this.active) return;
    const player = this.getActor(PLAYER_ID);
    const pointerLocked = document.pointerLockElement === this.canvas;
    const shouldAdvance = this.simulation.state.phase !== "finished" && (pointerLocked || !player.alive);
    if (shouldAdvance) {
      this.clock.advance(frameSeconds, (deltaSeconds) => this.fixedUpdate(deltaSeconds));
    }
    this.syncVisuals();
    this.hud?.update(this.simulation.state, player, pointerLocked, fps);
  }

  public dispose(): void {
    this.active = false;
    this.humanController.dispose();
    this.audio.dispose();
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
    this.audio.handleEvents(events, PLAYER_ID);
    for (const event of events) {
      if (event.type === "shot-fired" && event.actorId === PLAYER_ID) {
        const weapon = getActiveWeapon(this.getActor(PLAYER_ID));
        if (weapon) this.humanController.applyRecoil(WEAPONS[weapon.weaponId]?.recoil ?? 0);
      }
      if (event.type === "actor-died") {
        this.actorRoots.get(event.actorId)?.setEnabled(false);
        if (event.actorId === PLAYER_ID && !this.playerEliminated) {
          this.playerEliminated = true;
          if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
          const placement = Object.values(this.simulation.state.actors).filter((actor) => actor.alive).length + 1;
          this.hud?.showEliminated(placement, this.getActor(PLAYER_ID).kills);
        }
      }
      if (event.type === "item-picked") this.lootMeshes.get(event.lootId)?.setEnabled(false);
      if (event.type === "match-finished") {
        if (document.pointerLockElement === this.canvas) void document.exitPointerLock();
        this.hud?.showResult(event.result, PLAYER_ID, this.getActor(PLAYER_ID).kills);
      }
    }
  }

  private syncVisuals(): void {
    const player = this.getActor(PLAYER_ID);
    this.camera.position.set(player.position.x, player.position.y, player.position.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
    for (const [actorId, root] of this.actorRoots) {
      const actor = this.getActor(actorId);
      root.position.set(actor.position.x, actor.position.y, actor.position.z);
      root.rotation.y = actor.yaw;
      root.setEnabled(actor.alive);
    }
    this.syncLootMeshes(this.simulation.state.groundLoot);
    for (const [lootId, mesh] of this.lootMeshes) {
      const loot = this.simulation.state.groundLoot[lootId];
      mesh.setEnabled(Boolean(loot?.available));
      mesh.rotation.y += 0.015;
    }
    const zone = this.simulation.state.safeZone;
    const baseRadius = Number(this.safeZoneRing.metadata?.baseRadius) || zone.radius;
    this.safeZoneRing.position.set(zone.center.x, 0.18, zone.center.z);
    this.safeZoneRing.scaling = new Vector3(zone.radius / baseRadius, 1, zone.radius / baseRadius);
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
