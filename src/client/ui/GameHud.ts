import type { AssetCatalog } from "../../assets/AssetCatalog";
import { ITEMS } from "../../config/items";
import { MAP_POINTS } from "../../config/map";
import { WEAPONS } from "../../config/weapons";
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
    root: HTMLDivElement,
    private readonly assets: AssetCatalog,
    onResume: () => void,
    private readonly onRestart: () => void,
  ) {
    const crosshair = assets.resolve("ui.crosshair", "svg");
    root.className = "is-playing";
    root.innerHTML = `
      <section class="hud" aria-label="游戏状态">
        <header class="hud-topbar">
          <div class="location-block"><span class="hud-kicker">LAST LINE // 01</span><strong>苍岬岛</strong><small data-hud="phase">航线部署</small></div>
          <div class="zone-block"><span data-hud="zone-label">安全区待命</span><strong data-hud="zone-time">--:--</strong><i></i></div>
          <div class="alive-counter"><small>存活</small><span data-hud="alive">20</span><b data-hud="kills">0 击杀</b></div>
        </header>
        <img class="crosshair" src="${crosshair.url}" alt="" />
        <div class="hit-marker" data-hud="hit-marker">×</div>
        <div class="damage-flash" data-hud="damage-flash"></div>
        <div class="kill-feed" data-hud="kill-feed" aria-live="polite"></div>
        <aside class="minimap-card" aria-label="小地图">
          <div class="minimap-heading"><strong>TACTICAL MAP</strong><span data-hud="map-status">安全区内</span></div>
          <svg class="minimap" viewBox="0 0 200 200" role="img" aria-label="苍岬岛小地图">
            <rect class="minimap-sea" width="200" height="200" />
            <path class="minimap-island" d="M18 50 L48 18 L103 10 L158 28 L190 72 L184 142 L151 186 L91 194 L37 171 L10 122 Z" />
            <g class="minimap-grid">
              <path d="M50 10V190 M100 10V190 M150 10V190 M10 50H190 M10 100H190 M10 150H190" />
            </g>
            <g class="minimap-roads"><path d="M48 49 L130 61 L146 129 L61 129 Z M48 49 L61 129 M130 61 L61 129" /></g>
            <g class="minimap-pois">${MAP_POINTS.map((point) => {
              const projected = projectToMinimap(point.position);
              return `<g transform="translate(${projected.x} ${projected.y})"><circle r="2" /><text y="-5">${point.name}</text></g>`;
            }).join("")}</g>
            <line class="minimap-flight" data-hud="map-flight" />
            <circle class="minimap-target-zone" data-hud="map-target-zone" />
            <circle class="minimap-current-zone" data-hud="map-current-zone" />
            <g class="minimap-player" data-hud="map-player"><path d="M0 -7 L5 6 L0 3 L-5 6 Z" /></g>
            <text class="minimap-north" x="188" y="13">N</text>
          </svg>
          <div class="minimap-scale"><span></span><small>200 M</small></div>
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
          <strong>对局已暂停</strong>
          <span>点击继续并锁定鼠标</span>
          <button type="button" data-action="resume">继续游戏</button>
        </div>
        <div class="result-card" data-hud="result" hidden></div>
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

  public update(state: MatchState, player: ActorState, pointerLocked: boolean, fps: number): void {
    this.setText("health", Math.ceil(player.health).toString());
    this.setText("armor", Math.ceil(player.armor).toString());
    this.setText("helmet", player.inventory.helmetLevel.toString());
    setWidth(this.requireElement("health-bar"), player.health / player.maxHealth * 100);
    setWidth(this.requireElement("armor-bar"), player.maxArmor > 0 ? player.armor / player.maxArmor * 100 : 0);
    this.setText("alive", Object.values(state.actors).filter((actor) => actor.alive).length.toString());
    this.setText("kills", `${player.kills} 击杀`);
    this.setText("performance", `${Math.round(fps)} FPS`);
    this.setText("phase", phaseLabel(state, player));
    this.setText("zone-label", zoneLabel(state));
    this.setText("zone-time", formatSeconds(state.safeZone.secondsRemaining));
    const minimapSignature = [
      state.phase,
      player.deployment,
      player.position.x.toFixed(1),
      player.position.z.toFixed(1),
      player.yaw.toFixed(3),
      state.safeZone.center.x.toFixed(1),
      state.safeZone.center.z.toFixed(1),
      state.safeZone.radius.toFixed(1),
      state.safeZone.targetCenter.x.toFixed(1),
      state.safeZone.targetCenter.z.toFixed(1),
      state.safeZone.targetRadius.toFixed(1),
    ].join(":");
    if (minimapSignature !== this.minimapSignature) {
      this.updateMinimap(state, player);
      this.minimapSignature = minimapSignature;
    }
    const healingSignature = player.inventory.usingItem
      ? `${player.inventory.usingItem.itemId}:${player.inventory.usingItem.remainingSeconds.toFixed(1)}`
      : "none";
    if (healingSignature !== this.healingSignature) {
      this.updateHealing(player);
      this.healingSignature = healingSignature;
    }

    const weapon = getActiveWeapon(player);
    const config = weapon ? WEAPONS[weapon.weaponId] : undefined;
    const weaponIconId = weapon ? `ui.weapon.${weapon.weaponId}` : "";
    if (weaponIconId !== this.weaponIconId) {
      const weaponIcon = this.requireElement("weapon-icon") as HTMLImageElement;
      weaponIcon.hidden = !weaponIconId;
      weaponIcon.src = weaponIconId ? this.resolveIconUrl(weaponIconId) : "";
      weaponIcon.alt = config?.label ?? "";
      this.weaponIconId = weaponIconId;
    }
    this.setText("weapon-name", config?.label ?? "未装备");
    this.setText("ammo", weapon ? weapon.ammoInMagazine.toString().padStart(2, "0") : "--");
    this.setText("reserve", getReserveAmmo(player).toString());
    const inventorySignature = JSON.stringify({
      activeWeaponSlot: player.inventory.activeWeaponSlot,
      weaponIds: player.inventory.weaponSlots.map((slot) => slot?.weaponId ?? null),
      backpack: player.inventory.backpack,
    });
    if (inventorySignature !== this.inventorySignature) {
      this.renderWeaponSlots(player);
      this.renderBackpack(player);
      this.inventorySignature = inventorySignature;
    }
    const promptSignature = `${state.elapsedSeconds.toFixed(3)}:${player.position.x.toFixed(2)}:${player.position.z.toFixed(2)}`;
    if (promptSignature !== this.promptSignature) {
      let nearestLoot: MatchState["groundLoot"][string] | null = null;
      let nearestDistance = 3;
      for (const loot of Object.values(state.groundLoot)) {
        if (!loot.available) continue;
        const distance = Math.hypot(loot.position.x - player.position.x, loot.position.z - player.position.z);
        if (distance <= nearestDistance) {
          nearestLoot = loot;
          nearestDistance = distance;
        }
      }
      this.setText("prompt", nearestLoot ? `F 拾取 ${getItemLabel(nearestLoot.itemId)}` : "");
      this.promptSignature = promptSignature;
    }
    this.requireElement("pause").classList.toggle("is-visible", !pointerLocked && player.alive && !this.resultVisible);
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
        this.appendFeed(
          event.sourceId
            ? `${actorLabel(event.sourceId, playerId)} 淘汰 ${actorLabel(event.actorId, playerId)}`
            : `${actorLabel(event.actorId, playerId)} 倒在安全区外`,
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

  public showEliminated(placement: number, kills: number): void {
    this.showResultCard("任务失败", `第 ${placement} 名 · ${kills} 次淘汰`, "重新部署");
  }

  public showResult(result: MatchResult, playerId: string, kills: number): void {
    const victory = result.winnerId === playerId;
    this.showResultCard(victory ? "最后防线" : "对局结束", victory ? `成功存活 · ${kills} 次淘汰` : `胜者 ${result.winnerId ?? "无"}`, "再来一局");
  }

  private showResultCard(title: string, detail: string, buttonLabel: string): void {
    if (this.resultVisible) return;
    this.resultVisible = true;
    const result = this.requireElement("result");
    result.hidden = false;
    result.innerHTML = `<p>${title}</p><strong>${detail}</strong><button type="button" data-action="restart">${buttonLabel}</button>`;
    result.querySelector<HTMLButtonElement>("[data-action='restart']")?.addEventListener("click", this.onRestart);
  }

  private appendFeed(text: string): void {
    const entry = document.createElement("div");
    entry.textContent = text;
    this.killFeed.prepend(entry);
    while (this.killFeed.childElementCount > 5) this.killFeed.lastElementChild?.remove();
  }

  private setText(name: string, value: string): void {
    const element = this.requireElement(name);
    if (element.textContent !== value) element.textContent = value;
  }

  private renderWeaponSlots(player: ActorState): void {
    this.requireElement("weapon-slots").innerHTML = player.inventory.weaponSlots
      .map((candidate, index) => {
        const active = index === player.inventory.activeWeaponSlot;
        const label = candidate ? WEAPONS[candidate.weaponId]?.label ?? candidate.weaponId : "空";
        const icon = candidate
          ? `<img src="${this.resolveIconUrl(`ui.weapon.${candidate.weaponId}`)}" alt="" />`
          : `<span class="empty-slot-mark">—</span>`;
        return `<span class="inventory-slot${active ? " is-active" : ""}">${icon}<span>${index + 1} ${label}</span></span>`;
      })
      .join("");
  }

  private renderBackpack(player: ActorState): void {
    const backpack = this.requireElement("backpack");
    backpack.innerHTML = player.inventory.backpack.length > 0
      ? player.inventory.backpack.map((stack) => `
          <span class="item-stack">
            <img src="${this.resolveIconUrl(`ui.item.${stack.itemId}`)}" alt="" />
            <span>${getItemLabel(stack.itemId)} ×${stack.quantity}</span>
          </span>
        `).join("")
      : "背包为空";
  }

  private updateMinimap(state: MatchState, player: ActorState): void {
    const view = createMinimapView(state, player);
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
      : player.deployment === "parachuting"
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

function assetUrl(url: string | undefined): string {
  return url ? new URL(url, document.baseURI).href : "";
}

function actorLabel(actorId: string, playerId: string): string {
  if (actorId === playerId) return "你";
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
