import type { AssetEntry, AssetManifest, AssetType } from "./types";
import { validateAssetManifest } from "./validateAssetManifest";

const FALLBACK_BY_TYPE: Readonly<Record<AssetType, string>> = {
  svg: "fallback.ui",
  image: "fallback.ui",
  model: "fallback.model",
  "procedural-model": "fallback.model",
};

export class AssetCatalog {
  private readonly entries: ReadonlyMap<string, AssetEntry>;
  private readonly unavailable = new Set<string>();
  private readonly payloads = new Map<string, ArrayBuffer>();
  private readonly payloadRequests = new Map<string, Promise<ArrayBuffer>>();

  public constructor(manifest: AssetManifest) {
    this.entries = new Map(manifest.assets.map((entry) => [entry.id, entry]));
  }

  public static async load(
    url = "./assets/asset-manifest.json",
    onProgress: (progress: number) => void = () => undefined,
  ): Promise<AssetCatalog> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`资源清单加载失败: ${response.status} ${response.statusText}`);
    }

    const catalog = new AssetCatalog(validateAssetManifest(await response.json()));
    await catalog.preload(onProgress);
    return catalog;
  }

  public resolve(id: string, expectedType: AssetType): AssetEntry {
    const requested = this.entries.get(id);
    if (requested && !this.unavailable.has(requested.id) && isCompatibleType(requested.type, expectedType)) {
      return requested;
    }

    const fallbackId = requested?.fallback ?? FALLBACK_BY_TYPE[expectedType];
    const fallback = this.entries.get(fallbackId);
    if (!fallback || this.unavailable.has(fallback.id) || !isCompatibleType(fallback.type, expectedType)) {
      throw new Error(`资源 ${id} 不可用，fallback ${fallbackId} 也不存在`);
    }

    console.warn(`资源 ${id} 缺失或类型不符，使用 ${fallback.id}`);
    return fallback;
  }

  public has(id: string): boolean {
    return this.entries.has(id);
  }

  public getPayload(id: string): ArrayBuffer | undefined {
    return this.payloads.get(id);
  }

  public async loadPayload(id: string): Promise<ArrayBuffer | undefined> {
    const cached = this.payloads.get(id);
    if (cached) return cached;
    const entry = this.entries.get(id);
    if (!entry?.url || this.unavailable.has(id)) return undefined;
    let request = this.payloadRequests.get(id);
    if (!request) {
      request = fetch(entry.url).then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const payload = await response.arrayBuffer();
        await assertDecodable(entry.type, payload);
        this.payloads.set(id, payload);
        return payload;
      }).catch((error) => {
        this.unavailable.add(id);
        throw error;
      }).finally(() => this.payloadRequests.delete(id));
      this.payloadRequests.set(id, request);
    }
    return request;
  }

  private async preload(onProgress: (progress: number) => void): Promise<void> {
    const remoteEntries = [...this.entries.values()].filter((entry) => entry.url && entry.type !== "model");
    if (remoteEntries.length === 0) {
      onProgress(1);
      return;
    }
    let completed = 0;
    onProgress(0);
    await Promise.all(
      remoteEntries.map(async (entry) => {
        try {
          const response = await fetch(entry.url as string);
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          const payload = await response.arrayBuffer();
          await assertDecodable(entry.type, payload);
          this.payloads.set(entry.id, payload);
        } catch (error) {
          this.unavailable.add(entry.id);
          console.error(`资源 ${entry.id} 加载失败，将使用 fallback`, error);
        } finally {
          completed += 1;
          onProgress(completed / remoteEntries.length);
        }
      }),
    );
  }
}

function isCompatibleType(actual: AssetType, expected: AssetType): boolean {
  if (actual === expected) {
    return true;
  }

  if ((actual === "svg" || actual === "image") && (expected === "svg" || expected === "image")) {
    return true;
  }

  return (actual === "model" || actual === "procedural-model") &&
    (expected === "model" || expected === "procedural-model");
}

async function assertDecodable(type: AssetType, payload: ArrayBuffer): Promise<void> {
  if (type === "svg") {
    assertSvgDecodable(payload);
  } else if (type === "image") {
    await assertImageDecodable(payload);
  }
}

function assertSvgDecodable(payload: ArrayBuffer): void {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  const root = source
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "");
  const openingTag = /^<svg(?:\s[^>]*)?\/?>/i.exec(root);
  const remainder = openingTag ? root.slice(openingTag[0].length) : "";
  const hasSvgRoot = openingTag && /\/\s*>$/.test(openingTag[0])
    ? remainder.trim() === ""
    : /<\/svg\s*>\s*$/i.test(remainder);

  if (!openingTag || !hasSvgRoot) {
    throw new Error("SVG 内容无效");
  }

  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.documentElement.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) {
      throw new Error("SVG 内容无法解析");
    }
  }
}

async function assertImageDecodable(payload: ArrayBuffer): Promise<void> {
  const blob = new Blob([payload]);
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    return;
  }

  if (typeof Image === "undefined") {
    throw new Error("当前环境不支持图片解码验证");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
