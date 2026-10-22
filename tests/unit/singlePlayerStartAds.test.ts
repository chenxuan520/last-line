import { afterEach, describe, expect, it, vi } from "vitest";
import { SinglePlayerStartAds, type GoogleAdConfig, type GoogleAdsWindow, type GoogleStartAd } from "../../src/client/SinglePlayerStartAds";
import { getSinglePlayerAdsConfig, SINGLE_PLAYER_AD_STORAGE_KEY } from "../../src/config/ads";

const CLIENT = "ca-pub-0000000000000000";

describe("Single-player start ads", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("defaults off and requires an explicit switch and valid publisher", () => {
    for (const enabled of [undefined, null, false, true, "false", "TRUE", "1"]) {
      expect(getSinglePlayerAdsConfig(enabled, CLIENT)).toBeNull();
    }
    for (const client of [undefined, "", "pub-0000000000000000", "ca-pub-123", `${CLIENT}?test=on`]) {
      expect(getSinglePlayerAdsConfig("true", client)).toBeNull();
    }
    expect(getSinglePlayerAdsConfig("true", ` ${CLIENT} `)).toEqual({ client: CLIENT });
  });

  it("does not load scripts while disabled offline or frequency capped", () => {
    const environment = createEnvironment();
    for (const config of [null, { client: CLIENT }]) {
      environment.windowTarget.navigator.onLine = config === null;
      const ads = new SinglePlayerStartAds(config, environment.windowTarget as unknown as GoogleAdsWindow, environment.documentTarget);
      expect(ads.request(new AbortController().signal, vi.fn(), false)).toBeNull();
      ads.dispose();
    }
    environment.windowTarget.navigator.onLine = true;
    environment.storage.set(SINGLE_PLAYER_AD_STORAGE_KEY, String(Date.now()));
    const ads = environment.createAds();
    expect(ads.request(new AbortController().signal, vi.fn(), false)).toBeNull();
    expect(environment.createElement).not.toHaveBeenCalled();
    expect(environment.commands).toEqual([]);
    ads.dispose();
  });

  it("times out initialization without treating script load as readiness", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const before = vi.fn();
    const request = ads.request(new AbortController().signal, before, false);
    environment.script.dispatchEvent(new Event("load"));
    expect(environment.commands).toHaveLength(1);
    expect(environment.script.src).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`);
    expect(environment.script.async).toBe(true);
    expect(environment.script.crossOrigin).toBe("anonymous");
    expect(environment.script.dataset.adFrequencyHint).toBe("300s");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(request).resolves.toBe(false);
    await environment.ready();
    expect(environment.commands.some((command) => "type" in command)).toBe(false);
    expect(before).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    ads.dispose();
    expect(environment.script.remove).toHaveBeenCalled();
  });

  it("skips script failures and contains synchronous SDK errors", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    let ads = environment.createAds();
    const failed = ads.request(new AbortController().signal, vi.fn(), false);
    environment.script.dispatchEvent(new Event("error"));
    await expect(failed).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    ads.dispose();
    const broken = createEnvironment();
    ads = broken.createAds();
    const request = ads.request(new AbortController().signal, vi.fn(), true);
    broken.windowTarget.adsbygoogle.push.mockImplementation(() => { throw new Error("SDK failed"); });
    await broken.ready();
    await expect(request).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    ads.dispose();
  });

  it("preserves the five-minute cap across reload only after a viewed ad", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const environment = createEnvironment();
    const ads = environment.createAds();
    const before = vi.fn();
    const request = ads.request(new AbortController().signal, before, false);
    await environment.ready();
    const placement = environment.placement();
    expect(placement.type).toBe("start");
    placement.beforeAd();
    placement.adBreakDone({ breakStatus: "viewed" });
    await expect(request).resolves.toBe(true);
    expect(before).toHaveBeenCalledOnce();
    expect(environment.storage.get(SINGLE_PLAYER_AD_STORAGE_KEY)).toBe("10000");
    const reloaded = environment.createAds();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(reloaded.request(new AbortController().signal, vi.fn(), false)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const next = reloaded.request(new AbortController().signal, vi.fn(), false);
    expect(next).not.toBeNull();
    reloaded.dispose();
    await expect(next).resolves.toBe(false);
    ads.dispose();
  });

  it("does not count no-fill errors or unshown results as impressions", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const before = vi.fn();
    const first = ads.request(new AbortController().signal, before, false);
    await environment.ready();
    for (const status of ["noAdPreloaded", "error", "frequencyCapped", "viewed"]) {
      const request = status === "noAdPreloaded" ? first : ads.request(new AbortController().signal, before, false);
      await settle();
      environment.placement().adBreakDone({ breakStatus: status });
      await expect(request).resolves.toBe(false);
    }
    expect(before).not.toHaveBeenCalled();
    expect(environment.storage.size).toBe(0);
    ads.dispose();
  });

  it("retries a failed initialization on the next explicit startup", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const first = ads.request(new AbortController().signal, vi.fn(), false);
    environment.script.dispatchEvent(new Event("error"));
    await expect(first).resolves.toBe(false);
    const next = ads.request(new AbortController().signal, vi.fn(), false);
    await environment.ready();
    expect(environment.placement()).toBeDefined();
    environment.placement().beforeAd();
    environment.placement().adBreakDone({ breakStatus: "viewed" });
    await expect(next).resolves.toBe(true);
    ads.dispose();
  });

  it("can register readiness again after timeout without loading a second script", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const first = ads.request(new AbortController().signal, vi.fn(), false);
    const originalReady = (environment.commands[0] as GoogleAdConfig).onReady!;
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(first).resolves.toBe(false);
    const second = ads.request(new AbortController().signal, vi.fn(), false);
    originalReady();
    await settle();
    expect(environment.placement()).toBeUndefined();
    expect(environment.createElement).toHaveBeenCalledOnce();
    expect(environment.commands.filter((command) => "preloadAdBreaks" in command)).toHaveLength(1);
    await environment.ready();
    environment.placement().adBreakDone({ breakStatus: "noAdPreloaded" });
    await expect(second).resolves.toBe(false);
    ads.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from a late script error after timeout without clearing a replacement script", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const first = ads.request(new AbortController().signal, vi.fn(), false);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(first).resolves.toBe(false);
    environment.script.dispatchEvent(new Event("error"));
    const second = ads.request(new AbortController().signal, vi.fn(), false);
    await environment.ready();
    expect(environment.createElement).toHaveBeenCalledTimes(2);
    environment.script.dispatchEvent(new Event("error"));
    environment.placement().beforeAd();
    environment.placement().adBreakDone({ breakStatus: "viewed" });
    await expect(second).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    ads.dispose();
  });

  it("records a displayed ad completed after cancellation without reviving the old request", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const controller = new AbortController();
    const before = vi.fn();
    const request = ads.request(controller.signal, before, false);
    await environment.ready();
    const placement = environment.placement();
    placement.beforeAd();
    controller.abort();
    await expect(request).resolves.toBe(false);
    placement.adBreakDone({ breakStatus: "viewed" });
    const timestamp = environment.storage.get(SINGLE_PLAYER_AD_STORAGE_KEY);
    expect(timestamp).toBe(String(Date.now()));
    expect(environment.createAds().request(new AbortController().signal, vi.fn(), false)).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    placement.adBreakDone({ breakStatus: "viewed" });
    expect(environment.storage.get(SINGLE_PLAYER_AD_STORAGE_KEY)).toBe(timestamp);
    expect(before).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    ads.dispose();
  });

  it("does not end an already displayed ad when the initialization timeout expires", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const settled = vi.fn();
    const request = ads.request(new AbortController().signal, vi.fn(), false)!;
    void request.then(settled);
    await environment.ready();
    environment.placement().beforeAd();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    environment.placement().adBreakDone({ breakStatus: "viewed" });
    await expect(request).resolves.toBe(true);
    ads.dispose();
  });

  it("rejects late display callbacks after request timeout abort or offline", async () => {
    vi.useFakeTimers();
    for (const reason of ["timeout", "abort", "offline"] as const) {
      const environment = createEnvironment();
      const ads = environment.createAds();
      const controller = new AbortController();
      const before = vi.fn();
      const request = ads.request(controller.signal, before, false);
      await environment.ready();
      const placement = environment.placement();
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(2_000);
      else if (reason === "abort") controller.abort();
      else {
        environment.windowTarget.navigator.onLine = false;
        environment.windowTarget.dispatchEvent(new Event("offline"));
      }
      await expect(request).resolves.toBe(false);
      expect(() => placement.beforeAd()).toThrow("广告请求已失效");
      placement.adBreakDone({ breakStatus: "viewed" });
      expect(before).not.toHaveBeenCalled();
      expect(environment.storage.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      ads.dispose();
    }
  });

  it("cleans disposal and keeps an in-memory cap when session storage is unavailable", async () => {
    vi.useFakeTimers();
    const environment = createEnvironment();
    const ads = environment.createAds();
    const controller = new AbortController();
    const request = ads.request(controller.signal, vi.fn(), false);
    ads.dispose();
    await expect(request).resolves.toBe(false);
    await environment.ready();
    expect(environment.script.remove).toHaveBeenCalled();
    expect(ads.request(controller.signal, vi.fn(), false)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const unavailable = createEnvironment();
    unavailable.windowTarget.sessionStorage.getItem.mockImplementation(() => { throw new Error("storage blocked"); });
    unavailable.windowTarget.sessionStorage.setItem.mockImplementation(() => { throw new Error("storage blocked"); });
    const capped = unavailable.createAds();
    const viewed = capped.request(new AbortController().signal, vi.fn(), false);
    await unavailable.ready();
    unavailable.placement().beforeAd();
    unavailable.placement().adBreakDone({ breakStatus: "viewed" });
    await expect(viewed).resolves.toBe(true);
    expect(capped.request(new AbortController().signal, vi.fn(), false)).toBeNull();
    capped.dispose();
  });
});

function createEnvironment() {
  const commands: Array<GoogleAdConfig | GoogleStartAd> = [];
  const storage = new Map<string, string>();
  const script = Object.assign(new EventTarget(), {
    async: false,
    crossOrigin: "",
    src: "",
    dataset: {} as Record<string, string>,
    remove: vi.fn(),
  });
  const createElement = vi.fn()
    .mockImplementationOnce(() => script as unknown as HTMLScriptElement)
    .mockImplementation(() => Object.assign(new EventTarget(), {
      async: false, crossOrigin: "", src: "", dataset: {}, remove: vi.fn(),
    }) as unknown as HTMLScriptElement);
  const documentTarget = {
    createElement,
    head: { append: vi.fn() } as unknown as HTMLHeadElement,
  } as Pick<Document, "createElement" | "head">;
  const windowTarget = Object.assign(new EventTarget(), {
    navigator: { onLine: true },
    sessionStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
    },
    setTimeout: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    adsbygoogle: { push: vi.fn((command: GoogleAdConfig | GoogleStartAd) => { commands.push(command); }) },
  });
  return {
    commands,
    storage,
    script,
    createElement,
    windowTarget,
    documentTarget,
    createAds: () => new SinglePlayerStartAds({ client: CLIENT }, windowTarget as unknown as GoogleAdsWindow, documentTarget),
    ready: async () => {
      const config = commands.filter((command): command is GoogleAdConfig => "onReady" in command).at(-1);
      config?.onReady?.();
      await settle();
    },
    placement: () => commands.filter((command): command is GoogleStartAd => "type" in command).at(-1)!,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
