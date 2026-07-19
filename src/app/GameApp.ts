import { Engine } from "@babylonjs/core/Engines/engine";
import { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { BATTLE_ROYALE_CONFIG } from "../config/battleRoyale";
import { DEFAULT_SETTINGS, type GameSettings, type QualityLevel } from "../config/settings";
import { BattleRoyaleSession } from "./BattleRoyaleSession";

const SETTINGS_KEY = "last-line.settings.v1";

export class GameApp {
  private readonly engine: Engine;
  private assets: AssetCatalog | null = null;
  private session: BattleRoyaleSession | null = null;
  private settings = loadSettings();
  private readonly menuAudio = new AudioFeedback(0);
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
    this.menuAudio.dispose();
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
        this.menuAudio,
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
        <p class="eyebrow">${BATTLE_ROYALE_CONFIG.participantCount} 人 BATTLE ROYALE</p>
        <h1 id="game-title"><span class="sr-only">最后防线</span><img class="game-logo" src="${logo.url}" alt="" /></h1>
        <p class="menu-description">穿越随机航线空降苍岬岛，搜集武器和补给，在不断收缩的安全区内成为最后一名幸存者。</p>
        <div class="settings-grid" aria-label="游戏设置">
          <label>画面质量<select data-setting="quality"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label class="volume-setting"><span>主音量 <output data-volume-output></output></span><input aria-label="主音量" data-setting="volume" type="range" min="0" max="1" step="0.1" value="${this.settings.volume}" /></label>
          <label>鼠标灵敏度<input data-setting="sensitivity" type="range" min="0.4" max="2" step="0.1" value="${this.settings.sensitivity}" /></label>
          <label class="starter-setting"><span>初始补给</span><span class="starter-option"><input data-setting="start-with-bandage" type="checkbox" ${this.settings.startWithBandage ? "checked" : ""} /><i></i><b>携带 1 条绷带</b></span></label>
          <label class="starter-setting ai-sniper-setting"><span>AI 规则</span><span class="starter-option"><input data-setting="disable-ai-snipers" type="checkbox" ${this.settings.disableAiSnipers ? "checked" : ""} /><i></i><b>禁用狙击枪与狙击弹</b></span></label>
        </div>
        <button class="primary-button" data-action="start"><span>开始游戏</span><b>DEPLOY</b></button>
        <p class="build-label">PRE-ALPHA 0.2 <span></span> SINGLE PLAYER / ${BATTLE_ROYALE_CONFIG.participantCount - 1} AI</p>
      </section>
    `;
    const quality = this.uiRoot.querySelector<HTMLSelectElement>("[data-setting='quality']");
    if (quality) quality.value = this.settings.quality;
    const volume = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='volume']");
    const volumeOutput = this.uiRoot.querySelector<HTMLOutputElement>("[data-volume-output]");
    const updateVolume = (preview: boolean): void => {
      if (!volume) return;
      const nextVolume = normalizeVolume(Number(volume.value));
      this.settings = { ...this.settings, volume: nextVolume };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      volume.style.setProperty("--range-progress", `${nextVolume * 100}%`);
      if (volumeOutput) volumeOutput.textContent = nextVolume === 0 ? "静音" : `${Math.round(nextVolume * 100)}%`;
      this.menuAudio.setVolume(nextVolume);
      if (preview) this.menuAudio.preview();
    };
    volume?.addEventListener("input", () => updateVolume(false));
    volume?.addEventListener("change", () => updateVolume(true));
    updateVolume(false);
    const startWithBandage = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='start-with-bandage']");
    startWithBandage?.addEventListener("change", () => {
      this.settings = { ...this.settings, startWithBandage: startWithBandage.checked };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    });
    const disableAiSnipers = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='disable-ai-snipers']");
    disableAiSnipers?.addEventListener("change", () => {
      this.settings = { ...this.settings, disableAiSnipers: disableAiSnipers.checked };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='start']")?.addEventListener("click", () => {
      this.readSettings();
      this.menuAudio.setVolume(this.settings.volume);
      this.menuAudio.start();
      void this.startMatch();
    });
  }

  private readSettings(): void {
    const quality = this.uiRoot.querySelector<HTMLSelectElement>("[data-setting='quality']")?.value;
    const volume = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='volume']")?.value);
    const sensitivity = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='sensitivity']")?.value);
    const startWithBandage = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='start-with-bandage']")?.checked;
    const disableAiSnipers = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='disable-ai-snipers']")?.checked;
    this.settings = {
      quality: isQuality(quality) ? quality : DEFAULT_SETTINGS.quality,
      volume: normalizeVolume(volume),
      sensitivity: Number.isFinite(sensitivity) ? sensitivity : DEFAULT_SETTINGS.sensitivity,
      startWithBandage: typeof startWithBandage === "boolean" ? startWithBandage : DEFAULT_SETTINGS.startWithBandage,
      disableAiSnipers: typeof disableAiSnipers === "boolean" ? disableAiSnipers : DEFAULT_SETTINGS.disableAiSnipers,
      showGroundLootIcons: false,
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
      volume: typeof value?.volume === "number" ? normalizeVolume(value.volume) : DEFAULT_SETTINGS.volume,
      sensitivity: typeof value?.sensitivity === "number" ? value.sensitivity : DEFAULT_SETTINGS.sensitivity,
      startWithBandage: typeof value?.startWithBandage === "boolean"
        ? value.startWithBandage
        : DEFAULT_SETTINGS.startWithBandage,
      disableAiSnipers: typeof value?.disableAiSnipers === "boolean"
        ? value.disableAiSnipers
        : DEFAULT_SETTINGS.disableAiSnipers,
      showGroundLootIcons: false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function isQuality(value: unknown): value is QualityLevel {
  return value === "low" || value === "medium" || value === "high";
}

function normalizeVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_SETTINGS.volume;
}
