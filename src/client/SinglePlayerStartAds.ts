import {
  getSinglePlayerAdsConfig,
  SINGLE_PLAYER_AD_INTERVAL_MS,
  SINGLE_PLAYER_AD_STORAGE_KEY,
  SINGLE_PLAYER_AD_TIMEOUT_MS,
  type SinglePlayerAdsConfig,
} from "../config/ads";

export interface GoogleAdConfig {
  preloadAdBreaks?: "on";
  sound: "on" | "off";
  onReady?: () => void;
}

export interface GoogleStartAd {
  type: "start";
  name: "single-player-start";
  beforeAd(): void;
  adBreakDone(info: { breakStatus: string }): void;
}

export interface GoogleAdsWindow extends Pick<Window,
  "navigator" | "sessionStorage" | "setTimeout" | "clearTimeout" | "addEventListener" | "removeEventListener"
> {
  adsbygoogle?: { push(command: GoogleAdConfig | GoogleStartAd): unknown };
}

export class SinglePlayerStartAds {
  private ready: Promise<boolean> | null = null;
  private preloadConfigured = false;
  private cancelInitialization: (() => void) | null = null;
  private cancelRequest: (() => void) | null = null;
  private script: HTMLScriptElement | null = null;
  private lastShown: number | null = null;
  private disposed = false;
  private readonly handleScriptError = (event: Event): void => {
    if (event.currentTarget !== this.script) return;
    this.script?.remove();
    this.script = null;
    this.ready = null;
    this.cancelInitialization?.();
  };

  public constructor(
    private readonly config: SinglePlayerAdsConfig | null = getSinglePlayerAdsConfig(
      import.meta.env.VITE_SINGLE_PLAYER_ADS_ENABLED,
      import.meta.env.VITE_GOOGLE_ADS_CLIENT,
    ),
    private readonly windowTarget: GoogleAdsWindow = window,
    private readonly documentTarget: Pick<Document, "createElement" | "head"> = document,
    private readonly now: () => number = Date.now,
  ) {
    if (!config) return;
    try {
      const stored = windowTarget.sessionStorage.getItem(SINGLE_PLAYER_AD_STORAGE_KEY);
      const timestamp = stored === null ? NaN : Number(stored);
      if (Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= this.now()) this.lastShown = timestamp;
    } catch {}
  }

  public request(
    signal: AbortSignal,
    beforeAd: () => void,
    sound: boolean,
  ): Promise<boolean> | null {
    if (!this.config || this.disposed || signal.aborted || this.cancelRequest || !this.isOnline()) return null;
    if (this.lastShown !== null && this.now() - this.lastShown < SINGLE_PLAYER_AD_INTERVAL_MS) return null;
    return new Promise((resolve) => {
      let active = true;
      let shown = false;
      let accounted = false;
      const deadline = this.now() + SINGLE_PLAYER_AD_TIMEOUT_MS;
      const finish = (result: boolean): void => {
        if (!active) return;
        active = false;
        this.windowTarget.clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
        this.windowTarget.removeEventListener("offline", offline);
        this.cancelRequest = null;
        resolve(result);
      };
      const cancel = (): void => finish(false);
      const offline = (): void => { if (!shown) finish(false); };
      const timeout = this.windowTarget.setTimeout(() => finish(false), SINGLE_PLAYER_AD_TIMEOUT_MS);
      this.cancelRequest = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      this.windowTarget.addEventListener("offline", offline);
      void this.initialize(sound).then((ready) => {
        if (!active) return;
        if (!ready || !this.isOnline() || this.now() >= deadline) {
          finish(false);
          return;
        }
        try {
          this.windowTarget.adsbygoogle?.push({ sound: sound ? "on" : "off" });
          this.windowTarget.adsbygoogle?.push({
            type: "start",
            name: "single-player-start",
            beforeAd: () => {
              if (!active || signal.aborted || !this.isOnline() || this.now() >= deadline) {
                throw new Error("广告请求已失效");
              }
              beforeAd();
              shown = true;
              this.windowTarget.clearTimeout(timeout);
            },
            adBreakDone: (info) => {
              if (shown && !accounted && info.breakStatus === "viewed") {
                accounted = true;
                this.lastShown = this.now();
                try {
                  this.windowTarget.sessionStorage.setItem(SINGLE_PLAYER_AD_STORAGE_KEY, String(this.lastShown));
                } catch {}
              }
              finish(shown);
            },
          });
        } catch {
          finish(shown);
        }
      }).catch(() => finish(shown));
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelRequest?.();
    this.cancelInitialization?.();
    this.script?.removeEventListener("error", this.handleScriptError);
    this.script?.remove();
    this.script = null;
  }

  private isOnline(): boolean {
    return this.windowTarget.navigator.onLine !== false;
  }

  private initialize(sound: boolean): Promise<boolean> {
    if (this.ready) return this.ready;
    const attempt = new Promise<boolean>((resolve) => {
      let active = true;
      const newScript = this.script === null;
      const script = this.script ?? this.documentTarget.createElement("script");
      const finish = (ready: boolean): void => {
        if (!active) return;
        active = false;
        this.windowTarget.clearTimeout(timeout);
        this.cancelInitialization = null;
        resolve(ready);
      };
      const fail = (): void => {
        script.removeEventListener("error", this.handleScriptError);
        script.remove();
        if (this.script === script) this.script = null;
        finish(false);
      };
      const timeout = this.windowTarget.setTimeout(() => finish(false), SINGLE_PLAYER_AD_TIMEOUT_MS);
      this.cancelInitialization = fail;
      this.script = script;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${this.config!.client}`;
      script.dataset.adFrequencyHint = "300s";
      if (newScript) script.addEventListener("error", this.handleScriptError, { once: true });
      try {
        this.windowTarget.adsbygoogle ??= [];
        this.windowTarget.adsbygoogle.push({
          ...(this.preloadConfigured ? {} : { preloadAdBreaks: "on" }),
          sound: sound ? "on" : "off",
          onReady: () => finish(true),
        });
        this.preloadConfigured = true;
        if (newScript) this.documentTarget.head.append(script);
      } catch {
        fail();
      }
    });
    this.ready = attempt;
    void attempt.then((ready) => {
      if (!ready && this.ready === attempt) this.ready = null;
    });
    return attempt;
  }
}
