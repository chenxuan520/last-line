import type { AssetCatalog } from "../../assets/AssetCatalog";
import { BATTLE_ROYALE_CONFIG } from "../../config/battleRoyale";
import { ITEMS } from "../../config/items";
import { createMapLayout, createMapRoadSegments, MAP_SIZE } from "../../config/map";
import { WEAPONS } from "../../config/weapons";
import { getItemIconAssetId } from "../itemIcon";
import {
  getActiveWeapon,
  getItemLabel,
  getReserveAmmo,
  type ActorState,
  type GameEvent,
  type MatchResult,
  type MatchState,
} from "../../game/state/types";
import { createMinimapView, projectToMinimap } from "./minimap";
import { findNearbyLootCandidate, findPickupCandidate } from "../../game/systems/InventorySystem";

export class GameHud {
  private readonly elements = new Map<string, HTMLElement>();
  private readonly hitMarker: HTMLElement;
  private readonly damageFlash: HTMLElement;
  private readonly killFeed: HTMLElement;
  private resultVisible = false;
  private inventorySignature = "";
  private weaponIconId = "";
  private minimapSignature = "";
  private healingSignature = "";
  private promptSignature = "";

  public constructor(
    private readonly root: HTMLDivElement,
    private readonly assets: AssetCatalog,
    mapSeed: number,
    onResume: () => void,
    private readonly onRestart: () => void,
    private readonly options: { online?: boolean; actorLabels?: Readonly<Record<string, string>> } = {},
  ) {
    const crosshair = assets.resolve("ui.crosshair", "svg");
    const mapLayout = createMapLayout(mapSeed);
    const mapPoints = mapLayout.mapPoints;
    const hospitalPoint = projectToMinimap(mapLayout.hospital.position);
    const mapRoadPath = createMapRoadSegments(mapLayout.landingZones).map(([startX, startZ, endX, endZ]) => {
      const start = projectToMinimap({ x: startX, y: 0, z: startZ });
      const end = projectToMinimap({ x: endX, y: 0, z: endZ });
      return `M${start.x} ${start.y}L${end.x} ${end.y}`;
    }).join(" ");
    root.className = "is-playing";
    root.innerHTML = `
      <section class="hud" aria-label="游戏状态">
        <header class="hud-topbar">
          <div class="location-block"><span class="hud-kicker">LAST LINE // 01</span><strong>苍岬岛</strong><small data-hud="phase">航线部署</small></div>
          <div class="zone-block"><span data-hud="zone-label">安全区待命</span><strong data-hud="zone-time">--:--</strong><i></i></div>
          <div class="alive-counter"><small>存活</small><span data-hud="alive">${BATTLE_ROYALE_CONFIG.participantCount}</span><b data-hud="kills">0 击杀</b></div>
        </header>
        <img class="crosshair" data-hud="crosshair" src="${crosshair.url}" alt="" />
        <div class="scope-overlay" data-hud="scope" aria-hidden="true"><i></i><b></b></div>
        <div class="hit-marker" data-hud="hit-marker">×</div>
        <div class="damage-flash" data-hud="damage-flash"></div>
        <div class="kill-feed" data-hud="kill-feed" aria-live="polite"></div>
        <aside class="minimap-card" aria-label="小地图">
          <div class="minimap-heading"><strong>TACTICAL MAP</strong><span data-hud="map-status">安全区内</span></div>
          <svg class="minimap" viewBox="0 0 200 200" role="img" aria-label="苍岬岛小地图">
            <rect class="minimap-sea" width="200" height="200" />
            <rect class="minimap-island" x="10" y="10" width="180" height="180" rx="5" />
            <g class="minimap-grid">
              <path d="M50 10V190 M100 10V190 M150 10V190 M10 50H190 M10 100H190 M10 150H190" />
            </g>
            <g class="minimap-roads"><path d="${mapRoadPath}" /></g>
            <g class="minimap-pois">${mapPoints.map((point) => {
              const projected = projectToMinimap(point.position);
              return `<g transform="translate(${projected.x} ${projected.y})"><circle r="2" /><text y="-5">${point.name}</text></g>`;
            }).join("")}</g>
            <g class="minimap-hospital" transform="translate(${hospitalPoint.x} ${hospitalPoint.y})"><title>医院</title><circle r="2" /><text y="-5">医院</text></g>
            <line class="minimap-flight" data-hud="map-flight" />
            <circle class="minimap-target-zone" data-hud="map-target-zone" />
            <circle class="minimap-current-zone" data-hud="map-current-zone" />
            <g class="minimap-player" data-hud="map-player"><path d="M0 -7 L5 6 L0 3 L-5 6 Z" /></g>
            <text class="minimap-north" x="188" y="13">N</text>
          </svg>
          <div class="minimap-scale"><span></span><small>${Math.round(MAP_SIZE * 0.17 / 100) * 100} M</small></div>
        </aside>
        <div class="interaction-prompt" data-hud="prompt"></div>
        <div class="healing-progress" data-hud="healing" hidden>
          <span data-hud="healing-label">治疗中</span>
          <strong data-hud="healing-time">0.0s</strong>
          <div><i data-hud="healing-bar"></i></div>
          <small>移动或开火会中断</small>
        </div>
        <aside class="controls-card">
          <span><b>WASD</b>移动</span><span><b>SHIFT</b>冲刺</span><span><b>SPACE</b>跳伞 / 跳跃</span><span><b>F</b>拾取</span>
          <span><b>1 / 2</b>切枪</span><span><b>Q</b>绷带</span><span><b>H</b>急救包</span><span><b>R</b>换弹</span>
        </aside>
        <aside class="inventory-card">
          <div class="weapon-slots" data-hud="weapon-slots"></div>
          <div class="backpack" data-hud="backpack"></div>
        </aside>
        <footer class="hud-footer">
          <div class="vitals">
            <div class="vital-block health-vital"><span>生命值</span><strong data-hud="health">100</strong><i><b data-hud="health-bar"></b></i></div>
            <div class="vital-block armor-vital"><span>护甲值</span><strong data-hud="armor">0</strong><i><b data-hud="armor-bar"></b></i></div>
            <div class="helmet-vital"><span>头盔</span><strong>LV.<b data-hud="helmet">0</b></strong></div>
          </div>
          <div class="performance" data-hud="performance">-- FPS</div>
          <div class="weapon-status">
            <img data-hud="weapon-icon" src="" alt="" hidden />
            <div><small data-hud="weapon-name">未装备</small><strong data-hud="ammo">--</strong><span><i>RES</i> <span data-hud="reserve">0</span></span></div>
          </div>
        </footer>
        <div class="pause-card" data-hud="pause">
          <strong>${options.online ? "联机对局进行中" : "对局已暂停"}</strong>
          <span>${options.online ? "点击返回战斗；服务器不会暂停" : "点击继续并锁定鼠标"}</span>
          <button type="button" data-action="resume">继续游戏</button>
        </div>
        <div class="result-card" data-hud="result" hidden></div>
        <aside class="leaderboard" data-hud="leaderboard" hidden aria-label="本局排行榜">
          <header><strong>本局排行榜</strong><span>存活优先 · 击杀排序</span></header>
          <div data-hud="leaderboard-rows"></div>
        </aside>
      </section>
    `;
    for (const element of root.querySelectorAll<HTMLElement>("[data-hud]")) {
      const name = element.dataset.hud;
      if (name) this.elements.set(name, element);
    }
    this.hitMarker = this.requireElement("hit-marker");
    this.damageFlash = this.requireElement("damage-flash");
    this.killFeed = this.requireElement("kill-feed");
    root.querySelector<HTMLButtonElement>("[data-action='resume']")?.addEventListener("click", onResume);
  }

  public dispose(): void {
    this.elements.clear();
    if (this.root.classList.contains("is-playing")) this.root.replaceChildren();
  }

  public update(
    state: MatchState,
    player: ActorState,
    viewedActor: ActorState,
    pointerLocked: boolean,
    fps: number,
    scoped = false,
    leaderboardVisible = false,
  ): void {
    this.setText("health", Math.ceil(viewedActor.health).toString());
    this.setText("armor", Math.ceil(viewedActor.armor).toString());
    this.setText("helmet", viewedActor.inventory.helmetLevel.toString());
    setWidth(this.requireElement("health-bar"), viewedActor.health / viewedActor.maxHealth * 100);
    setWidth(this.requireElement("armor-bar"), viewedActor.maxArmor > 0 ? viewedActor.armor / viewedActor.maxArmor * 100 : 0);
    this.setText("alive", Object.values(state.actors).filter((actor) => actor.alive).length.toString());
    this.setText("kills", combatCounterLabel(state, player));
    this.setText("performance", `${Math.round(fps)} FPS`);
    this.setText("phase", player.alive ? phaseLabel(state, player) : `观战 · ${this.actorLabel(viewedActor.id, player.id)}`);
    this.setText("zone-label", zoneLabel(state));
    this.setText("zone-time", formatSeconds(state.safeZone.secondsRemaining));
    const minimapSignature = createMinimapSignature(state, viewedActor);
    if (minimapSignature !== this.minimapSignature) {
      this.updateMinimap(state, viewedActor);
      this.minimapSignature = minimapSignature;
    }
    const healingSignature = viewedActor.inventory.usingItem
      ? `${viewedActor.id}:${viewedActor.inventory.usingItem.itemId}:${viewedActor.inventory.usingItem.remainingSeconds.toFixed(1)}`
      : "none";
    if (healingSignature !== this.healingSignature) {
      this.updateHealing(viewedActor);
      this.healingSignature = healingSignature;
    }

    const weapon = getActiveWeapon(viewedActor);
    const config = weapon ? WEAPONS[weapon.weaponId] : undefined;
    const scopedWeapon = config?.scopeFov !== undefined;
    this.requireElement("scope").classList.toggle("is-visible", scoped);
    this.requireElement("crosshair").classList.toggle("is-hidden", scopedWeapon);
    const weaponIconId = weapon ? getItemIconAssetId(`weapon.${weapon.weaponId}`) : "";
    if (weaponIconId !== this.weaponIconId) {
      const weaponIcon = this.requireElement("weapon-icon") as HTMLImageElement;
      weaponIcon.hidden = !weaponIconId;
      weaponIcon.src = weaponIconId ? this.resolveIconUrl(weaponIconId) : "";
      weaponIcon.alt = config?.label ?? "";
      this.weaponIconId = weaponIconId;
    }
    this.setText("weapon-name", config?.label ?? "未装备");
    this.setText("ammo", weapon ? weapon.ammoInMagazine.toString().padStart(2, "0") : "--");
    this.setText("reserve", getReserveAmmo(viewedActor).toString());
    const inventorySignature = JSON.stringify({
      actorId: viewedActor.id,
      activeWeaponSlot: viewedActor.inventory.activeWeaponSlot,
      weaponIds: viewedActor.inventory.weaponSlots.map((slot) => slot?.weaponId ?? null),
      backpack: viewedActor.inventory.backpack,
    });
    if (inventorySignature !== this.inventorySignature) {
      this.renderWeaponSlots(viewedActor);
      this.renderBackpack(viewedActor);
      this.inventorySignature = inventorySignature;
    }
    const promptSignature = pickupPromptSignature(player, state.groundLoot);
    if (promptSignature !== this.promptSignature) {
      this.setText("prompt", pickupPromptText(player, state.groundLoot));
      this.promptSignature = promptSignature;
    }
    this.requireElement("pause").classList.toggle("is-visible", !pointerLocked && player.alive && !this.resultVisible);
    this.updateLeaderboard(state, player.id, leaderboardVisible);
  }

  private updateLeaderboard(state: MatchState, playerId: string, visible: boolean): void {
    const leaderboard = this.requireElement("leaderboard");
    leaderboard.hidden = !visible;
    if (!visible) return;
    const actors = sortLeaderboardActors(Object.values(state.actors));
    const fragment = document.createDocumentFragment();
    actors.forEach((actor, index) => {
      const row = document.createElement("div");
      row.classList.add(actor.alive ? "is-alive" : "is-eliminated");
      if (actor.id === playerId) row.classList.add("is-player");
      for (const [tagName, text] of [
        ["b", `${index + 1}`],
        ["span", this.actorLabel(actor.id, playerId)],
        ["em", actor.alive ? "存活" : "淘汰"],
        ["strong", `${actor.kills} 击杀`],
      ] as const) {
        const element = document.createElement(tagName);
        element.textContent = text;
        row.append(element);
      }
      fragment.append(row);
    });
    this.requireElement("leaderboard-rows").replaceChildren(fragment);
  }

  public handleEvents(events: readonly GameEvent[], playerId: string): void {
    for (const event of events) {
      if (event.type === "actor-damaged" && event.sourceId === playerId) {
        replayAnimation(this.hitMarker);
      }
      if (event.type === "actor-damaged" && event.actorId === playerId) {
        replayAnimation(this.damageFlash);
      }
      if (event.type === "actor-died") {
        const weaponLabel = event.weaponId ? WEAPONS[event.weaponId]?.label ?? event.weaponId : null;
        this.appendFeed(
          event.sourceId
            ? `${this.actorLabel(event.sourceId, playerId)} 使用 ${weaponLabel ?? "武器"} 淘汰 ${this.actorLabel(event.actorId, playerId)}`
            : `${this.actorLabel(event.actorId, playerId)} 倒在安全区外`,
        );
      }
      if (event.type === "item-picked" && event.actorId === playerId) {
        this.appendFeed(`获得 ${getItemLabel(event.itemId)} ×${event.quantity}`);
      }
      if (event.type === "healing-started" && event.actorId === playerId) {
        this.appendFeed(`开始使用 ${getItemLabel(event.itemId)}`);
      }
      if (event.type === "healing-completed" && event.actorId === playerId) {
        this.appendFeed(`${getItemLabel(event.itemId)} 使用完成`);
      }
      if (event.type === "healing-interrupted" && event.actorId === playerId) {
        this.appendFeed("治疗已中断");
      }
    }
  }

  public showEliminated(placement: number, kills: number, eliminatedBy: string, spectatingKiller: boolean): void {
    this.showResultCard(
      "任务失败",
      `${eliminatedBy} · 第 ${placement} 名 · ${kills} 次淘汰`,
      "重新部署",
      `${spectatingKiller ? "正在观察击杀者" : "正在观察存活角色"} · 空格或滚轮切换目标`,
    );
    this.requireElement("result").classList.add("is-eliminated");
  }

  public showResult(result: MatchResult, playerId: string, kills: number): void {
    const victory = result.winnerId === playerId;
    this.showResultCard(victory ? "最后防线" : "对局结束", victory ? `成功存活 · ${kills} 次淘汰` : `胜者 ${result.winnerId ?? "无"}`, "再来一局");
  }

  public clearResult(): void {
    this.resultVisible = false;
    const result = this.requireElement("result");
    result.hidden = true;
    result.classList.remove("is-eliminated");
    result.replaceChildren();
  }

  private showResultCard(title: string, detail: string, buttonLabel: string, hint?: string): void {
    if (this.resultVisible) return;
    this.resultVisible = true;
    const result = this.requireElement("result");
    result.hidden = false;
    const heading = document.createElement("p");
    heading.textContent = title;
    const body = document.createElement("strong");
    body.textContent = detail;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "restart";
    button.textContent = buttonLabel;
    button.addEventListener("click", this.onRestart);
    const hintElement = document.createElement("small");
    hintElement.textContent = hint ?? "";
    result.replaceChildren(heading, body, ...(hint ? [hintElement] : []), button);
  }

  private appendFeed(text: string): void {
    const entry = document.createElement("div");
    entry.textContent = text;
    this.killFeed.prepend(entry);
    while (this.killFeed.childElementCount > 5) this.killFeed.lastElementChild?.remove();
  }

  private actorLabel(actorId: string, playerId: string): string {
    if (actorId === playerId) return "你";
    return this.options.actorLabels?.[actorId] ?? defaultActorLabel(actorId);
  }

  private setText(name: string, value: string): void {
    const element = this.requireElement(name);
    if (element.textContent !== value) element.textContent = value;
  }

  private renderWeaponSlots(player: ActorState): void {
    const fragment = document.createDocumentFragment();
    player.inventory.weaponSlots.forEach((candidate, index) => {
      const slot = document.createElement("span");
      slot.classList.add("inventory-slot");
      if (index === player.inventory.activeWeaponSlot) slot.classList.add("is-active");
      if (candidate) {
        const icon = document.createElement("img");
        icon.src = this.resolveIconUrl(getItemIconAssetId(`weapon.${candidate.weaponId}`));
        icon.alt = "";
        slot.append(icon);
      } else {
        const empty = document.createElement("span");
        empty.className = "empty-slot-mark";
        empty.textContent = "—";
        slot.append(empty);
      }
      const label = document.createElement("span");
      label.textContent = `${index + 1} ${candidate ? WEAPONS[candidate.weaponId]?.label ?? candidate.weaponId : "空"}`;
      slot.append(label);
      fragment.append(slot);
    });
    this.requireElement("weapon-slots").replaceChildren(fragment);
  }

  private renderBackpack(player: ActorState): void {
    const backpack = this.requireElement("backpack");
    if (player.inventory.backpack.length === 0) {
      backpack.textContent = "背包为空";
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const stack of player.inventory.backpack) {
      const item = document.createElement("span");
      item.className = "item-stack";
      const icon = document.createElement("img");
      icon.src = this.resolveIconUrl(getItemIconAssetId(stack.itemId));
      icon.alt = "";
      const label = document.createElement("span");
      label.textContent = `${getItemLabel(stack.itemId)} ×${stack.quantity}`;
      item.append(icon, label);
      fragment.append(item);
    }
    backpack.replaceChildren(fragment);
  }

  private updateMinimap(state: MatchState, actor: ActorState): void {
    const view = createMinimapView(state, actor);
    setCircle(this.requireElement("map-current-zone"), view.currentZone);
    setCircle(this.requireElement("map-target-zone"), view.targetZone);
    const flight = this.requireElement("map-flight");
    setAttribute(flight, "x1", view.flight.start.x.toString());
    setAttribute(flight, "y1", view.flight.start.y.toString());
    setAttribute(flight, "x2", view.flight.end.x.toString());
    setAttribute(flight, "y2", view.flight.end.y.toString());
    flight.classList.toggle("is-hidden", state.phase !== "flight");
    setAttribute(
      this.requireElement("map-player"),
      "transform",
      `translate(${view.player.x} ${view.player.y}) rotate(${view.player.rotationDegrees})`,
    );
    const mapStatus = state.phase === "flight"
      ? "航线飞行"
      : actor.deployment === "parachuting"
        ? "空降中"
        : view.outsideZoneMeters > 0
          ? `圈外 ${Math.ceil(view.outsideZoneMeters)}m`
          : "安全区内";
    this.setText("map-status", mapStatus);
  }

  private updateHealing(player: ActorState): void {
    const healing = this.requireElement("healing");
    const usingItem = player.inventory.usingItem;
    healing.hidden = !usingItem;
    if (!usingItem) {
      return;
    }
    const totalSeconds = ITEMS[usingItem.itemId]?.useSeconds ?? usingItem.remainingSeconds;
    this.setText("healing-label", `使用 ${getItemLabel(usingItem.itemId)}`);
    this.setText("healing-time", `${usingItem.remainingSeconds.toFixed(1)}s`);
    setWidth(this.requireElement("healing-bar"), (1 - usingItem.remainingSeconds / totalSeconds) * 100);
  }

  private resolveIconUrl(id: string): string {
    return assetUrl(this.assets.resolve(id, "image").url);
  }

  private requireElement(name: string): HTMLElement {
    const element = this.elements.get(name);
    if (!element) throw new Error(`HUD 元素缺失: ${name}`);
    return element;
  }
}

export function sortLeaderboardActors(actors: readonly ActorState[]): ActorState[] {
  return [...actors].sort((left, right) =>
    Number(right.alive) - Number(left.alive) ||
    right.kills - left.kills ||
    left.id.localeCompare(right.id),
  );
}

export function createMinimapSignature(state: MatchState, actor: ActorState): string {
  return [
    state.phase,
    actor.id,
    actor.deployment,
    actor.position.x.toFixed(1),
    actor.position.z.toFixed(1),
    actor.yaw.toFixed(3),
    state.safeZone.center.x.toFixed(1),
    state.safeZone.center.z.toFixed(1),
    state.safeZone.radius.toFixed(1),
    state.safeZone.targetCenter.x.toFixed(1),
    state.safeZone.targetCenter.z.toFixed(1),
    state.safeZone.targetRadius.toFixed(1),
  ].join(":");
}

export function combatCounterLabel(state: MatchState, player: ActorState): string {
  if (state.phase !== "flight" || !player.alive || player.deployment === "grounded") {
    return `${player.kills} 击杀`;
  }
  const jumpedCount = Object.values(state.actors).filter((actor) => actor.deployment !== "aircraft").length;
  return `已跳伞 ${jumpedCount} / ${Object.keys(state.actors).length}`;
}

export function pickupPromptText(
  player: ActorState,
  groundLoot: MatchState["groundLoot"],
): string {
  const pickup = findPickupCandidate(player, groundLoot);
  const nearby = pickup ?? findNearbyLootCandidate(player, groundLoot);
  return pickup
    ? `F 拾取 ${getItemLabel(pickup.itemId)}`
    : nearby
      ? `${getItemLabel(nearby.itemId)} · 当前无法拾取`
      : "";
}

export function pickupPromptSignature(
  player: ActorState,
  groundLoot: MatchState["groundLoot"],
): string {
  const nearbyLootSignature = Object.values(groundLoot)
    .filter((loot) => loot.available && Math.hypot(
      loot.position.x - player.position.x,
      loot.position.y - player.position.y,
      loot.position.z - player.position.z,
    ) <= 3.2)
    .map((loot) => [
      loot.id,
      loot.itemId,
      loot.quantity,
      loot.position.x.toFixed(2),
      loot.position.y.toFixed(2),
      loot.position.z.toFixed(2),
    ].join(":"))
    .sort()
    .join("|");
  return [
    player.alive,
    player.deployment,
    player.position.x.toFixed(2),
    player.position.y.toFixed(2),
    player.position.z.toFixed(2),
    player.armor.toFixed(2),
    player.maxArmor.toFixed(2),
    player.inventory.armorLevel,
    player.inventory.helmetLevel,
    player.inventory.activeWeaponSlot,
    player.inventory.maxBackpackStacks,
    player.inventory.weaponSlots.map((weapon) => weapon?.weaponId ?? "none").join(","),
    player.inventory.backpack.map((stack) => `${stack.itemId}:${stack.quantity}`).join(","),
    nearbyLootSignature,
  ].join(":");
}

function assetUrl(url: string | undefined): string {
  return url ? new URL(url, document.baseURI).href : "";
}

function defaultActorLabel(actorId: string): string {
  const number = /\d+$/.exec(actorId)?.[0];
  return number ? `AI-${number.padStart(2, "0")}` : actorId;
}

function setCircle(element: HTMLElement, circle: { x: number; y: number; radius: number }): void {
  setAttribute(element, "cx", circle.x.toString());
  setAttribute(element, "cy", circle.y.toString());
  setAttribute(element, "r", circle.radius.toString());
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setWidth(element: HTMLElement, value: number): void {
  const width = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
  if (element.style.width !== width) element.style.width = width;
}

function phaseLabel(state: MatchState, player: ActorState): string {
  if (player.deployment === "aircraft") return `航线部署 ${Math.round(state.flight.progress * 100)}%`;
  if (player.deployment === "parachuting") return "滑翔降落";
  if (state.phase === "finished") return "对局结束";
  return "生存作战";
}

function zoneLabel(state: MatchState): string {
  if (state.phase === "flight") return "等待全员落地";
  if (state.safeZone.status === "shrinking") return `安全区收缩 · ${Math.round(state.safeZone.radius)}m`;
  if (state.safeZone.status === "closed") return "最终安全区";
  return `下次收缩 · ${Math.round(state.safeZone.radius)}m`;
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function replayAnimation(element: HTMLElement): void {
  element.classList.remove("is-visible");
  void element.offsetWidth;
  element.classList.add("is-visible");
}
