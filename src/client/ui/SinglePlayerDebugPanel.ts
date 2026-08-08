import { ITEMS } from "../../config/items";
import { WEAPONS } from "../../config/weapons";
import type { SinglePlayerDebugAction } from "../../game/systems/SinglePlayerDebugSystem";
import {
  getActiveWeapon,
  getItemLabel,
  type ActorState,
  type MatchState,
} from "../../game/state/types";

export class SinglePlayerDebugPanel {
  private readonly panel: HTMLElement;
  private readonly properties: HTMLElement;
  private refreshSeconds = 0;

  public constructor(
    root: HTMLDivElement,
    private readonly onAction: (action: SinglePlayerDebugAction) => void,
  ) {
    this.panel = document.createElement("aside");
    this.panel.className = "debug-panel";
    this.panel.setAttribute("aria-label", "单机调试面板");
    const itemOptions = Object.values(ITEMS)
      .map((item) => `<option value="${item.id}">${item.label} · ${item.id}</option>`)
      .join("");
    this.panel.innerHTML = `
      <header><div><span>LOCAL DEBUG · F10 释放鼠标</span><strong>单机调试面板</strong></div><button type="button" data-debug="toggle">收起</button></header>
      <div class="debug-panel-body">
        <pre data-debug="properties"></pre>
        <div class="debug-actions">
          <button type="button" data-debug-action="land-now">立即落地</button>
          <button type="button" data-debug-action="grant-loadout">发放测试套装</button>
          <button type="button" data-debug-action="clear-inventory">清空装备</button>
        </div>
        <div class="debug-fields">
          <label for="debug-health">生命<input id="debug-health" name="debug-health" data-debug-input="health" type="number" min="1" max="100" value="100" /></label>
          <button type="button" data-debug-action="set-health">设置</button>
          <label for="debug-armor">护甲<input id="debug-armor" name="debug-armor" data-debug-input="armor" type="number" min="0" max="100" value="100" /></label>
          <button type="button" data-debug-action="set-armor">设置</button>
          <label for="debug-kills">击杀<input id="debug-kills" name="debug-kills" data-debug-input="kills" type="number" min="0" max="999" value="0" /></label>
          <button type="button" data-debug-action="set-kills">设置</button>
        </div>
        <div class="debug-grant">
          <select name="debug-item" aria-label="发放物品" data-debug-input="item">${itemOptions}</select>
          <input name="debug-quantity" data-debug-input="quantity" type="number" min="1" max="999" value="6" aria-label="发放数量" />
          <button type="button" data-debug-action="grant-item">发放物品</button>
        </div>
        <small>仅当前单机对局生效 · 玩家免疫所有伤害</small>
      </div>
    `;
    root.querySelector(".hud")?.append(this.panel);
    this.properties = this.requireElement("properties");
    this.panel.querySelector<HTMLButtonElement>("[data-debug='toggle']")?.addEventListener("click", (event) => {
      const collapsed = this.panel.classList.toggle("is-collapsed");
      (event.currentTarget as HTMLButtonElement).textContent = collapsed ? "展开" : "收起";
    });
    this.panel.addEventListener("click", this.handleAction);
  }

  public update(state: MatchState, player: ActorState, frameSeconds: number): void {
    this.refreshSeconds += Math.max(0, frameSeconds);
    if (this.refreshSeconds < 0.1) return;
    this.refreshSeconds %= 0.1;
    const weapon = getActiveWeapon(player);
    const backpack = player.inventory.backpack
      .map((stack) => `${getItemLabel(stack.itemId)}×${stack.quantity}`)
      .join(" / ") || "空";
    this.properties.textContent = [
      `阶段 ${state.phase} · ${player.deployment}`,
      `坐标 ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`,
      `生命 ${player.health.toFixed(0)}/${player.maxHealth} · 护甲 ${player.armor.toFixed(0)}/${player.maxArmor}`,
      `击杀 ${player.kills} · 武器 ${weapon ? WEAPONS[weapon.weaponId]?.label ?? weapon.weaponId : "无"}`,
      `背包 ${backpack}`,
    ].join("\n");
  }

  public dispose(): void {
    this.panel.removeEventListener("click", this.handleAction);
    this.panel.remove();
  }

  public focus(): void {
    this.panel.classList.remove("is-collapsed");
    const toggle = this.panel.querySelector<HTMLButtonElement>("[data-debug='toggle']");
    if (toggle) {
      toggle.textContent = "收起";
      toggle.focus();
    }
  }

  private readonly handleAction = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-debug-action]");
    if (!button) return;
    const action = button.dataset.debugAction;
    if (action === "land-now" || action === "grant-loadout" || action === "clear-inventory") {
      this.onAction({ type: action });
      return;
    }
    if (action === "set-health" || action === "set-armor" || action === "set-kills") {
      this.onAction({
        type: action,
        value: this.inputNumber(action.slice("set-".length)),
      });
      return;
    }
    if (action === "grant-item") {
      const itemId = this.panel.querySelector<HTMLSelectElement>("[data-debug-input='item']")?.value ?? "";
      this.onAction({
        type: "grant-item",
        itemId,
        quantity: this.inputNumber("quantity"),
      });
    }
  };

  private inputNumber(name: string): number {
    return Number(this.panel.querySelector<HTMLInputElement>(`[data-debug-input='${name}']`)?.value);
  }

  private requireElement(name: string): HTMLElement {
    const element = this.panel.querySelector<HTMLElement>(`[data-debug='${name}']`);
    if (!element) throw new Error(`调试面板元素缺失: ${name}`);
    return element;
  }
}
