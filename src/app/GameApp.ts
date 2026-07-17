import { Engine } from "@babylonjs/core/Engines/engine";
import { AssetCatalog } from "../assets/AssetCatalog";
import { DEFAULT_SETTINGS, type GameSettings, type QualityLevel } from "../config/settings";
import { BattleRoyaleSession } from "./BattleRoyaleSession";

const SETTINGS_KEY = "last-line.settings.v1";

export class GameApp {
  private readonly engine: Engine;
  private assets: AssetCatalog | null = null;
  private session: BattleRoyaleSession | null = null;
  private settings = loadSettings();
  private starting = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLDivElement,
  ) {
    this.engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: false });
    this.applyQuality();
  }

  public async initialize(): Promise<void> {
    this.renderLoading(0);
    try {
      this.assets = await AssetCatalog.load("./assets/asset-manifest.json", (progress) => this.renderLoading(progress));
      this.renderMenu();
    } catch (error) {
      this.renderError(error);
    }
    this.engine.runRenderLoop(() => {
      this.session?.update(this.engine.getDeltaTime() / 1000, this.engine.getFps());
      this.session?.scene.render();
    });
    window.addEventListener("resize", this.handleResize);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.engine.stopRenderLoop();
    this.session?.dispose();
    this.engine.dispose();
  }

  private startMatch = async (): Promise<void> => {
    if (!this.assets || this.starting) return;
    this.starting = true;
    this.session?.dispose();
    this.session = null;
    this.applyQuality();
    this.renderLoading(1);
    try {
      this.session = await BattleRoyaleSession.create(
        this.engine,
        this.canvas,
        this.uiRoot,
        this.assets,
        this.settings,
        this.startMatch,
      );
      this.session.start();
    } catch (error) {
      this.renderError(error);
    } finally {
      this.starting = false;
    }
  };

  private readonly handleResize = (): void => this.engine.resize();

  private renderLoading(progress: number): void {
    this.uiRoot.className = "";
    this.uiRoot.innerHTML = `<section class="loading-panel" aria-live="polite"><p>正在部署战区</p><strong>${Math.round(progress * 100)}%</strong><div><i style="width:${progress * 100}%"></i></div></section>`;
  }

  private renderMenu(): void {
    if (!this.assets) return;
    const logo = this.assets.resolve("ui.logo", "svg");
    const backdrop = this.assets.resolve("ui.menu.backdrop", "image");
    this.uiRoot.className = "";
    const backdropUrl = backdrop.url ? new URL(backdrop.url, document.baseURI).href : null;
    this.uiRoot.style.setProperty("--menu-backdrop", backdropUrl ? `url("${backdropUrl}")` : "none");
    this.uiRoot.innerHTML = `
      <section class="menu-panel" aria-labelledby="game-title">
        <div class="menu-index"><span>OPERATION</span><b>LL-01</b></div>
        <p class="eyebrow">20 人 AI BATTLE ROYALE</p>
        <h1 id="game-title"><span class="sr-only">最后防线</span><img class="game-logo" src="${logo.url}" alt="" /></h1>
        <p class="menu-description">穿越随机航线空降苍岬岛，搜集武器和补给，在不断收缩的安全区内成为最后一名幸存者。</p>
        <div class="settings-grid" aria-label="游戏设置">
          <label>画面质量<select data-setting="quality"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label>主音量<input data-setting="volume" type="range" min="0" max="1" step="0.1" value="${this.settings.volume}" /></label>
          <label>鼠标灵敏度<input data-setting="sensitivity" type="range" min="0.4" max="2" step="0.1" value="${this.settings.sensitivity}" /></label>
        </div>
        <button class="primary-button" data-action="start"><span>开始游戏</span><b>DEPLOY</b></button>
        <p class="build-label">PRE-ALPHA 0.2 <span></span> SINGLE PLAYER / 19 AI</p>
      </section>
    `;
    const quality = this.uiRoot.querySelector<HTMLSelectElement>("[data-setting='quality']");
    if (quality) quality.value = this.settings.quality;
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='start']")?.addEventListener("click", () => {
      this.readSettings();
      void this.startMatch();
    });
  }

  private readSettings(): void {
    const quality = this.uiRoot.querySelector<HTMLSelectElement>("[data-setting='quality']")?.value;
    const volume = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='volume']")?.value);
    const sensitivity = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='sensitivity']")?.value);
    this.settings = {
      quality: isQuality(quality) ? quality : DEFAULT_SETTINGS.quality,
      volume: Number.isFinite(volume) ? volume : DEFAULT_SETTINGS.volume,
      sensitivity: Number.isFinite(sensitivity) ? sensitivity : DEFAULT_SETTINGS.sensitivity,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  private applyQuality(): void {
    this.engine.setHardwareScalingLevel(this.settings.quality === "high" ? 1 : this.settings.quality === "medium" ? 1.35 : 1.75);
  }

  private renderError(error: unknown): void {
    const message = error instanceof Error ? error.message : "未知错误";
    this.uiRoot.innerHTML = `<section class="menu-panel"><p class="eyebrow">LOAD FAILED</p><h1>无法加载游戏</h1><p class="menu-description">${message}</p></section>`;
  }
}

function loadSettings(): GameSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<GameSettings> | null;
    return {
      quality: isQuality(value?.quality) ? value.quality : DEFAULT_SETTINGS.quality,
      volume: typeof value?.volume === "number" ? value.volume : DEFAULT_SETTINGS.volume,
      sensitivity: typeof value?.sensitivity === "number" ? value.sensitivity : DEFAULT_SETTINGS.sensitivity,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function isQuality(value: unknown): value is QualityLevel {
  return value === "low" || value === "medium" || value === "high";
}
