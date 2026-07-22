import { describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { validateAssetManifest } from "../../src/assets/validateAssetManifest";
import productionManifest from "../../public/assets/asset-manifest.json";

const manifest = validateAssetManifest({
  version: 1,
  assets: [
    { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
    { id: "fallback.model", type: "procedural-model" },
    { id: "ui.logo", type: "svg", url: "/logo.svg", fallback: "fallback.ui" },
  ],
});

describe("asset manifest", () => {
  it("rejects duplicate ids", () => {
    expect(() =>
      validateAssetManifest({
        version: 1,
        assets: [
          { id: "same", type: "svg", url: "/a.svg" },
          { id: "same", type: "svg", url: "/b.svg" },
        ],
      }),
    ).toThrow("资源 ID 重复");
  });

  it("resolves a declared asset", () => {
    const catalog = new AssetCatalog(manifest);
    expect(catalog.resolve("ui.logo", "svg").url).toBe("/logo.svg");
  });

  it("uses a typed fallback for a missing asset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const catalog = new AssetCatalog(manifest);

    expect(catalog.resolve("ui.missing", "svg").id).toBe("fallback.ui");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ui.missing"));
    warn.mockRestore();
  });

  it("rejects an incompatible fallback type", () => {
    expect(() =>
      validateAssetManifest({
        version: 1,
        assets: [
          { id: "fallback.model", type: "procedural-model" },
          { id: "ui.logo", type: "svg", url: "/logo.svg", fallback: "fallback.model" },
        ],
      }),
    ).toThrow("fallback 类型不兼容");
  });

  it("requires explicit equipment meshes for character GLBs", () => {
    expect(() => validateAssetManifest({
      version: 1,
      assets: [
        { id: "fallback.model", type: "procedural-model" },
        {
          id: "model.character.test",
          type: "model",
          url: "/character.glb",
          fallback: "fallback.model",
          metadata: { requiredNodes: "root,weapon_socket,backpack_socket" },
        },
      ],
    })).toThrow("armorMeshes");
  });

  it("declares character LOD GLBs and procedural held weapons", () => {
    const production = validateAssetManifest(productionManifest);
    for (const character of ["player", "enemy"]) {
      for (const suffix of ["", ".lod1"]) {
        const entry = production.assets.find((asset) => asset.id === `model.character.${character}${suffix}`);
        expect(entry).toMatchObject({
          type: "model",
          fallback: "fallback.model",
          metadata: {
            requiredNodes: "root,weapon_socket,backpack_socket",
            armorMeshes: expect.any(String),
            helmetMeshes: expect.any(String),
          },
        });
        expect(entry?.url).toMatch(/\.glb$/);
      }
    }
    const player = production.assets.find((asset) => asset.id === "model.character.player");
    const enemy = production.assets.find((asset) => asset.id === "model.character.enemy");
    expect(player?.metadata?.uniformColor).toBeUndefined();
    expect(enemy?.metadata).toMatchObject({
      uniformDarkColor: "#344550",
      uniformColor: "#526773",
      uniformLightColor: "#6C8290",
      armorColor: "#252C2E",
      helmetColor: "#30383A",
    });
    for (const weapon of ["rifle", "smg", "shotgun", "sniper"]) {
      const entry = production.assets.find((asset) => asset.id === `model.weapon.${weapon}`);
      expect(entry).toMatchObject({
        type: "procedural-model",
        fallback: "fallback.model",
        metadata: { shape: weapon, color: expect.any(String) },
      });
      expect(entry?.url).toBeUndefined();
      expect(production.assets.find((asset) => asset.id === `model.weapon.${weapon}.lod1`)).toBeUndefined();
    }
  });

  it("preloads payloads and falls back after a network failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "/manifest.json") {
        return Response.json({
          version: 1,
          assets: [
            { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
            { id: "fallback.model", type: "procedural-model" },
            { id: "ui.logo", type: "svg", url: "/missing.svg", fallback: "fallback.ui" },
          ],
        });
      }
      if (url === "/fallback.svg") return new Response("<svg>fallback</svg>", { status: 200 });
      return new Response("missing", { status: 404, statusText: "Not Found" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await AssetCatalog.load("/manifest.json");

    expect(catalog.resolve("ui.logo", "svg").id).toBe("fallback.ui");
    expect(new TextDecoder().decode(catalog.getPayload("fallback.ui"))).toBe("<svg>fallback</svg>");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ui.logo"), expect.anything());
    vi.unstubAllGlobals();
    error.mockRestore();
  });

  it("falls back when an SVG response has a 200 status but invalid content", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "/manifest.json") {
        return Response.json({
          version: 1,
          assets: [
            { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
            { id: "ui.logo", type: "svg", url: "/broken.svg", fallback: "fallback.ui" },
          ],
        });
      }
      if (url === "/fallback.svg") return new Response("<svg>fallback</svg>", { status: 200 });
      return new Response("this is not an svg", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await AssetCatalog.load("/manifest.json");

    expect(catalog.resolve("ui.logo", "svg").id).toBe("fallback.ui");
    expect(catalog.getPayload("ui.logo")).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("ui.logo"), expect.anything());
    vi.unstubAllGlobals();
    error.mockRestore();
  });
});
