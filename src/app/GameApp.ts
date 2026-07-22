import { Engine } from "@babylonjs/core/Engines/engine";
import { AssetCatalog } from "../assets/AssetCatalog";
import { AudioFeedback } from "../client/audio/AudioFeedback";
import { MobileFullscreenController } from "../client/ui/MobileFullscreenController";
import { BATTLE_ROYALE_CONFIG } from "../config/battleRoyale";
import { DEFAULT_SETTINGS, QUALITY_PROFILES, type GameSettings, type QualityLevel } from "../config/settings";
import {
  getDefaultMultiplayerApiUrl,
  MultiplayerAuthClient,
  MultiplayerClient,
  type MultiplayerConnection,
} from "../network/MultiplayerClient";
import type { LobbyView, RoomAdmission, ServerMessage } from "../network/protocol";
import { BattleRoyaleSession } from "./BattleRoyaleSession";
import type { GameSession } from "./GameSession";
import { MultiplayerSession } from "./MultiplayerSession";

const SETTINGS_KEY = "last-line.settings.v1";
const MULTIPLAYER_NAME_KEY = "last-line.multiplayer-name.v1";

export class GameApp {
  private readonly engine: Engine;
  private assets: AssetCatalog | null = null;
  private session: GameSession | null = null;
  private multiplayerConnection: MultiplayerConnection | null = null;
  private settings = loadSettings();
  private readonly menuAudio = new AudioFeedback(0);
  private readonly mobileFullscreen = new MobileFullscreenController();
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
    window.visualViewport?.addEventListener("resize", this.handleResize);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    window.visualViewport?.removeEventListener("resize", this.handleResize);
    this.engine.stopRenderLoop();
    this.session?.dispose();
    this.multiplayerConnection?.close();
    this.menuAudio.dispose();
    this.mobileFullscreen.dispose();
    this.engine.dispose();
  }

  private startMatch = async (): Promise<void> => {
    if (!this.assets || this.starting) return;
    this.starting = true;
    this.multiplayerConnection?.close();
    this.multiplayerConnection = null;
    this.session?.dispose();
    this.session = null;
    this.applyQuality();
    this.renderLoading(0.92, "正在准备战场");
    await waitForPaint();
    try {
      this.session = await BattleRoyaleSession.create(
        this.engine,
        this.canvas,
        this.uiRoot,
        this.assets,
        this.settings,
        this.menuAudio,
        this.mobileFullscreen,
        this.startSinglePlayerFromUserGesture,
      );
      this.session.start();
    } catch (error) {
      this.mobileFullscreen.deactivate();
      this.renderError(error);
    } finally {
      this.starting = false;
    }
  };

  private readonly handleResize = (): void => this.engine.resize();

  private readonly startSinglePlayerFromUserGesture = (): void => {
    if (!this.assets || this.starting) return;
    this.mobileFullscreen.activateFromUserGesture();
    void this.startMatch();
  };

  private renderLoading(progress: number, message = "正在加载资源"): void {
    this.uiRoot.className = "";
    this.uiRoot.innerHTML = `<section class="loading-panel" aria-live="polite"><p><span></span>${message}</p><strong>${Math.round(progress * 100)}%</strong><small>${message === "正在准备战场" ? "正在生成地图、建筑、物资与角色，请稍候" : "正在校验并载入战区资源"}</small><div><i style="width:${progress * 100}%"></i></div></section>`;
  }

  private renderMenu(): void {
    if (!this.assets) return;
    this.mobileFullscreen.deactivate();
    const multiplayerEnabled = getDefaultMultiplayerApiUrl() !== null;
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
          <label>视角灵敏度<input data-setting="sensitivity" type="range" min="0.4" max="2" step="0.1" value="${this.settings.sensitivity}" /></label>
          <label class="starter-setting"><span>初始补给</span><span class="starter-option"><input data-setting="start-with-bandage" type="checkbox" ${this.settings.startWithBandage ? "checked" : ""} /><i></i><b>携带 1 条绷带</b></span></label>
          <label class="starter-setting ai-sniper-setting"><span>AI 规则</span><span class="starter-option"><input data-setting="disable-ai-snipers" type="checkbox" ${this.settings.disableAiSnipers ? "checked" : ""} /><i></i><b>禁用狙击枪与狙击弹</b></span></label>
          <label class="starter-setting loot-model-setting"><span>物资显示</span><span class="starter-option"><input data-setting="show-ground-loot-models" type="checkbox" ${this.settings.showGroundLootModels ? "checked" : ""} /><i></i><b>显示三维物资模型</b></span></label>
        </div>
        <div class="menu-actions">
          <button class="primary-button" data-action="start"><span>开始游戏</span><b>DEPLOY</b></button>
          ${multiplayerEnabled ? '<button class="secondary-button" data-action="multiplayer"><span>联机模式</span><b>ONLINE</b></button>' : ""}
        </div>
        <footer class="menu-footer">
          <p class="build-label">PRE-ALPHA 0.2 <span></span> SINGLE PLAYER / ${BATTLE_ROYALE_CONFIG.participantCount - 1} AI</p>
          <a class="github-link" href="https://github.com/chenxuan520/last-line" target="_blank" rel="noreferrer" aria-label="在 GitHub 上查看最后防线源码">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.58c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
            <span>GitHub</span>
          </a>
        </footer>
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
    const showGroundLootModels = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='show-ground-loot-models']");
    showGroundLootModels?.addEventListener("change", () => {
      this.settings = { ...this.settings, showGroundLootModels: showGroundLootModels.checked };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='start']")?.addEventListener("click", () => {
      this.readSettings();
      this.menuAudio.setVolume(this.settings.volume);
      this.menuAudio.start();
      this.startSinglePlayerFromUserGesture();
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='multiplayer']")?.addEventListener("click", () => {
      this.readSettings();
      this.renderMultiplayerMenu();
    });
  }

  private renderMultiplayerMenu(): void {
    this.mobileFullscreen.deactivate();
    const apiUrl = getDefaultMultiplayerApiUrl();
    const savedName = localStorage.getItem(MULTIPLAYER_NAME_KEY) ?? `幸存者-${Math.floor(Math.random() * 9_000 + 1_000)}`;
    this.uiRoot.className = "";
    this.uiRoot.innerHTML = `
      <section class="menu-panel multiplayer-panel" aria-labelledby="multiplayer-title">
        <div class="menu-index"><span>NETWORK</span><b>BR-ONLINE</b></div>
        <p class="eyebrow">2–10 人真人联机 · AI 补满 50 人</p>
        <h1 id="multiplayer-title">联机大厅</h1>
        <p class="menu-description">快速匹配公开战局，或创建房间并邀请其他玩家。单机模式不会连接服务器。</p>
        <section class="multiplayer-auth hidden" data-multiplayer="auth">
          <div class="multiplayer-auth-head"><b>ACCOUNT GATE</b><span data-multiplayer="auth-state">需要账号验证</span></div>
          <div class="multiplayer-auth-form" data-multiplayer="auth-form">
            <label class="multiplayer-field">账号<input data-multiplayer="auth-username" minlength="3" maxlength="20" autocomplete="username" /></label>
            <label class="multiplayer-field">注册昵称<input data-multiplayer="auth-display-name" maxlength="20" value="${escapeAttribute(savedName)}" /></label>
            <label class="multiplayer-field">密码<input data-multiplayer="auth-password" type="password" minlength="12" maxlength="128" autocomplete="current-password" /></label>
            <div class="multiplayer-actions compact-actions">
              <button class="secondary-button compact" data-action="account-login">登录</button>
              <button class="secondary-button compact" data-action="account-register">注册</button>
            </div>
          </div>
          <button class="text-button hidden" data-action="account-logout">退出账号</button>
        </section>
        <label class="multiplayer-field" data-multiplayer="name-field">玩家代号<input data-multiplayer="name" maxlength="20" value="${escapeAttribute(savedName)}" /></label>
        <div class="multiplayer-actions">
          <button class="primary-button" data-action="quick" disabled><span>快速匹配</span><b>MATCH</b></button>
          <button class="secondary-button" data-action="create-public" disabled><span>创建公开房间</span><b>PUBLIC</b></button>
          <button class="secondary-button" data-action="create-private" disabled><span>创建私人房间</span><b>PRIVATE</b></button>
        </div>
        <div class="room-code-row">
          <input data-multiplayer="code" maxlength="6" placeholder="输入 6 位房间码" />
          <button class="secondary-button compact" data-action="join" disabled>加入</button>
        </div>
        <div class="public-room-list" data-multiplayer="rooms"><span>${apiUrl ? "正在读取联机规则…" : "尚未配置联机服务器地址"}</span></div>
        <p class="multiplayer-status" data-multiplayer="status">${apiUrl ? "正在连接身份服务…" : "请设置 VITE_MULTIPLAYER_URL"}</p>
        <button class="text-button" data-action="back">返回单机菜单</button>
      </section>
    `;
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='back']")?.addEventListener("click", () => this.renderMenu());
    if (!apiUrl) return;
    const panel = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='auth']")?.closest(".multiplayer-panel");
    const status = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='status']");
    const auth = new MultiplayerAuthClient(apiUrl);
    let accountDisplayName: string | null = null;
    let ready = false;
    const setActionsEnabled = (enabled: boolean): void => {
      for (const action of ["quick", "create-public", "create-private", "join"]) {
        const button = this.uiRoot.querySelector<HTMLButtonElement>(`[data-action='${action}']`);
        if (button) button.disabled = !enabled;
      }
    };
    const createClient = (): MultiplayerClient => {
      const nameInput = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='name']");
      const displayName = (accountDisplayName ?? nameInput?.value.trim()) || savedName;
      localStorage.setItem(MULTIPLAYER_NAME_KEY, displayName);
      return new MultiplayerClient(
        apiUrl,
        displayName,
        this.settings,
        accountDisplayName ? () => auth.ensureAccessToken() : null,
      );
    };
    const run = async (action: (client: MultiplayerClient) => Promise<RoomAdmission>): Promise<void> => {
      if (!ready) {
        if (status) status.textContent = "请先完成账号验证";
        return;
      }
      try {
        if (status) status.textContent = "正在建立联机身份…";
        const client = createClient();
        const admission = await action(client);
        await this.enterLobby(client, admission);
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : "联机请求失败";
      }
    };
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='quick']")?.addEventListener("click", () => {
      void run((client) => client.quickMatch());
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='create-public']")?.addEventListener("click", () => {
      void run((client) => client.createRoom("public"));
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='create-private']")?.addEventListener("click", () => {
      void run((client) => client.createRoom("private"));
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='join']")?.addEventListener("click", () => {
      const code = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='code']")?.value ?? "";
      void run((client) => client.joinRoom(code));
    });
    const completeAccount = async (account: { username: string; displayName: string }): Promise<void> => {
      if (!panel?.isConnected) return;
      accountDisplayName = account.displayName;
      const nameInput = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='name']");
      if (nameInput) nameInput.value = account.displayName;
      const authState = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='auth-state']");
      if (authState) authState.textContent = `${account.username} / ${account.displayName}`;
      this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='auth-form']")?.classList.add("hidden");
      this.uiRoot.querySelector<HTMLElement>("[data-action='account-logout']")?.classList.remove("hidden");
      ready = true;
      setActionsEnabled(true);
      if (status) status.textContent = "账号已验证，服务器待命";
      await this.refreshPublicRooms(createClient(), status);
    };
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='account-login']")?.addEventListener("click", () => {
      const username = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='auth-username']")?.value ?? "";
      const password = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='auth-password']")?.value ?? "";
      if (status) status.textContent = "正在登录…";
      void auth.login(username, password).then(completeAccount).catch((error: unknown) => {
        if (status) status.textContent = error instanceof Error ? error.message : "登录失败";
      });
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='account-register']")?.addEventListener("click", () => {
      const username = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='auth-username']")?.value ?? "";
      const password = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='auth-password']")?.value ?? "";
      const displayName = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='auth-display-name']")?.value ?? "";
      if (status) status.textContent = "正在注册…";
      void auth.register(username, password, displayName).then(completeAccount).catch((error: unknown) => {
        if (status) status.textContent = error instanceof Error ? error.message : "注册失败";
      });
    });
    this.uiRoot.querySelector<HTMLButtonElement>("[data-action='account-logout']")?.addEventListener("click", () => {
      void auth.logout().then(() => {
        if (!panel?.isConnected) return;
        accountDisplayName = null;
        ready = false;
        setActionsEnabled(false);
        this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='auth-form']")?.classList.remove("hidden");
        this.uiRoot.querySelector<HTMLElement>("[data-action='account-logout']")?.classList.add("hidden");
        const rooms = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='rooms']");
        if (rooms) rooms.textContent = "登录后读取公开房间";
        if (status) status.textContent = "已退出账号";
      }).catch((error: unknown) => {
        if (status) status.textContent = error instanceof Error ? error.message : "退出失败";
      });
    });
    const monitorPolicy = (expected: boolean): void => {
      setTimeout(() => {
        if (!panel?.isConnected) return;
        void auth.getConfiguration().then((configuration) => {
          if (!panel.isConnected) return;
          if (configuration.registrationLoginRequired !== expected) this.renderMultiplayerMenu();
          else monitorPolicy(expected);
        }).catch(() => monitorPolicy(expected));
      }, 5_000);
    };
    void (async () => {
      try {
        const configuration = await auth.getConfiguration();
        if (!panel?.isConnected) return;
        monitorPolicy(configuration.registrationLoginRequired);
        if (!configuration.registrationLoginRequired) {
          ready = true;
          setActionsEnabled(true);
          if (status) status.textContent = "游客模式，服务器待命";
          await this.refreshPublicRooms(createClient(), status);
          return;
        }
        this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='auth']")?.classList.remove("hidden");
        const nameInput = this.uiRoot.querySelector<HTMLInputElement>("[data-multiplayer='name']");
        if (nameInput) nameInput.disabled = true;
        const restored = await auth.restore();
        if (restored) await completeAccount(restored);
        else {
          const rooms = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='rooms']");
          if (rooms) rooms.textContent = "登录后读取公开房间";
          if (status) status.textContent = "请注册或登录后进入联机大厅";
        }
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : "身份服务不可用";
      }
    })();
  }

  private async refreshPublicRooms(client: MultiplayerClient, status: HTMLElement | null): Promise<void> {
    const root = this.uiRoot.querySelector<HTMLElement>("[data-multiplayer='rooms']");
    if (!root) return;
    try {
      const rooms = await client.listRooms();
      root.replaceChildren();
      if (rooms.length === 0) {
        const empty = document.createElement("span");
        empty.textContent = "当前没有等待中的公开房间";
        root.append(empty);
        return;
      }
      for (const room of rooms) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "room-list-entry";
        const label = document.createElement("span");
        label.textContent = `${room.hostName} · ${room.code}`;
        const count = document.createElement("b");
        count.textContent = `${room.playerCount}/${room.capacity}`;
        button.append(label, count);
        button.addEventListener("click", async () => {
          try {
            if (status) status.textContent = "正在加入房间…";
            const admission = await client.joinRoom(room.code);
            await this.enterLobby(client, admission);
          } catch (error) {
            if (status) status.textContent = error instanceof Error ? error.message : "加入失败";
          }
        });
        root.append(button);
      }
    } catch (error) {
      root.textContent = error instanceof Error ? error.message : "无法读取房间列表";
    }
  }

  private async enterLobby(client: MultiplayerClient, admission: RoomAdmission): Promise<void> {
    this.multiplayerConnection?.close();
    const connection = client.connect(admission);
    this.multiplayerConnection = connection;
    this.renderLobbyShell(admission.code);
    connection.setStatusHandler((connectionStatus) => {
      if (connectionStatus === "closed") this.mobileFullscreen.deactivate();
      const status = this.uiRoot.querySelector<HTMLElement>("[data-lobby='status']");
      if (status) status.textContent = connectionStatus === "connected"
        ? "已连接"
        : connectionStatus === "reconnecting"
          ? "正在重连…"
          : connectionStatus === "closed"
            ? "房间连接已关闭"
            : "正在连接…";
    });
    connection.setMessageHandler((message) => {
      if (message.type === "lobby.state") this.renderLobby(client, connection, message.lobby);
      if (message.type === "match.full") void this.startMultiplayerSession(connection, message);
      if (message.type === "error") {
        const status = this.uiRoot.querySelector<HTMLElement>("[data-lobby='status']");
        if (status) status.textContent = message.message;
        if (message.code === "cannot-start") this.mobileFullscreen.deactivate();
        if (message.code === "account-disabled" || message.code === "room-closed") {
          this.mobileFullscreen.deactivate();
          connection.close();
          if (this.multiplayerConnection === connection) this.multiplayerConnection = null;
          this.renderMultiplayerMenu();
        }
      }
    });
    await connection.open();
  }

  private renderLobbyShell(code: string): void {
    this.uiRoot.className = "";
    this.uiRoot.innerHTML = `
      <section class="menu-panel multiplayer-panel lobby-panel">
        <div class="menu-index"><span>ROOM</span><b>${code}</b></div>
        <p class="eyebrow">联机房间</p>
        <h1>等待部署</h1>
        <p class="menu-description" data-lobby="summary">正在同步房间状态…</p>
        <div class="lobby-members" data-lobby="members"></div>
        <div class="multiplayer-actions" data-lobby="actions"></div>
        <p class="multiplayer-status" data-lobby="status">正在连接…</p>
      </section>
    `;
  }

  private renderLobby(client: MultiplayerClient, connection: MultiplayerConnection, lobby: LobbyView): void {
    if (lobby.status === "waiting") this.mobileFullscreen.deactivate();
    const summary = this.uiRoot.querySelector<HTMLElement>("[data-lobby='summary']");
    if (!summary) return;
    const local = lobby.members.find((member) => member.playerId === client.playerId);
    summary.textContent = lobby.status === "countdown"
      ? "部署倒计时已启动"
      : `${lobby.visibility === "private" ? "私人" : "公开"}房间 · ${lobby.members.length}/${lobby.maximumPlayers} 真人 · AI 将补满 50 人`;
    const members = this.uiRoot.querySelector<HTMLElement>("[data-lobby='members']");
    members?.replaceChildren(...lobby.members.map((member) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = member.displayName;
      const state = document.createElement("b");
      state.textContent = member.host ? "房主" : member.ready ? "已准备" : "未准备";
      row.className = member.connected ? "is-connected" : "";
      row.append(name, state);
      return row;
    }));
    const actions = this.uiRoot.querySelector<HTMLElement>("[data-lobby='actions']");
    if (!actions) return;
    actions.replaceChildren();
    if (lobby.visibility === "private" && local && !local.host) {
      actions.append(this.actionButton(local.ready ? "取消准备" : "准备", "READY", () => {
        connection.send({ type: "lobby.ready", ready: !local.ready });
      }));
    }
    if (lobby.visibility === "private" && local?.host) {
      actions.append(this.actionButton("开始对局", "DEPLOY", () => {
        this.mobileFullscreen.activateFromUserGesture();
        connection.send({ type: "lobby.start" });
      }));
    }
    actions.append(this.actionButton("退出房间", "LEAVE", () => {
      this.mobileFullscreen.deactivate();
      connection.send({ type: "lobby.leave" });
      connection.close();
      this.multiplayerConnection = null;
      this.renderMultiplayerMenu();
    }, true));
  }

  private actionButton(label: string, tag: string, action: () => void, secondary = false): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = secondary ? "secondary-button" : "primary-button";
    const span = document.createElement("span");
    span.textContent = label;
    const badge = document.createElement("b");
    badge.textContent = tag;
    button.append(span, badge);
    button.addEventListener("click", action);
    return button;
  }

  private async startMultiplayerSession(
    connection: MultiplayerConnection,
    initial: Extract<ServerMessage, { type: "match.full" }>,
  ): Promise<void> {
    if (!this.assets || this.starting) return;
    this.starting = true;
    this.mobileFullscreen.activateWithoutUserGesture();
    connection.setMessageHandler(null);
    connection.setStatusHandler(null);
    this.applyQuality();
    this.renderLoading(0.92, "正在准备战场");
    await waitForPaint();
    try {
      const session = await MultiplayerSession.create(
        this.engine,
        this.canvas,
        this.uiRoot,
        this.assets,
        this.settings,
        this.menuAudio,
        this.mobileFullscreen,
        connection,
        initial,
        () => this.returnToMenu(),
      );
      this.session?.dispose();
      this.session = session;
      this.multiplayerConnection = null;
      session.start();
    } catch (error) {
      connection.close();
      this.mobileFullscreen.deactivate();
      this.renderError(error);
    } finally {
      this.starting = false;
    }
  }

  private returnToMenu(): void {
    this.mobileFullscreen.deactivate();
    this.session?.dispose();
    this.session = null;
    this.multiplayerConnection?.close();
    this.multiplayerConnection = null;
    this.renderMenu();
  }

  private readSettings(): void {
    const quality = this.uiRoot.querySelector<HTMLSelectElement>("[data-setting='quality']")?.value;
    const volume = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='volume']")?.value);
    const sensitivity = Number(this.uiRoot.querySelector<HTMLInputElement>("[data-setting='sensitivity']")?.value);
    const startWithBandage = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='start-with-bandage']")?.checked;
    const disableAiSnipers = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='disable-ai-snipers']")?.checked;
    const showGroundLootModels = this.uiRoot.querySelector<HTMLInputElement>("[data-setting='show-ground-loot-models']")?.checked;
    this.settings = {
      quality: isQuality(quality) ? quality : DEFAULT_SETTINGS.quality,
      volume: normalizeVolume(volume),
      sensitivity: Number.isFinite(sensitivity) ? sensitivity : DEFAULT_SETTINGS.sensitivity,
      startWithBandage: typeof startWithBandage === "boolean" ? startWithBandage : DEFAULT_SETTINGS.startWithBandage,
      disableAiSnipers: typeof disableAiSnipers === "boolean" ? disableAiSnipers : DEFAULT_SETTINGS.disableAiSnipers,
      showGroundLootModels: typeof showGroundLootModels === "boolean"
        ? showGroundLootModels
        : DEFAULT_SETTINGS.showGroundLootModels,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  private applyQuality(): void {
    const profile = QUALITY_PROFILES[this.settings.quality];
    this.engine.setHardwareScalingLevel(profile.hardwareScalingLevel);
    this.engine.maxFPS = profile.maxFps;
  }

  private renderError(error: unknown): void {
    const message = error instanceof Error ? error.message : "未知错误";
    this.uiRoot.innerHTML = `<section class="menu-panel"><p class="eyebrow">LOAD FAILED</p><h1>无法加载游戏</h1><p class="menu-description">${message}</p></section>`;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => ({ "&": "&amp;", "\"": "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character);
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
      showGroundLootModels: typeof value?.showGroundLootModels === "boolean"
        ? value.showGroundLootModels
        : DEFAULT_SETTINGS.showGroundLootModels,
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
