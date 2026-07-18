import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { loadCatalogModel } from "../../src/client/render/loadCatalogModel";

describe("loadCatalogModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads a GLB and validates required nodes", async () => {
    const catalog = await loadCatalog("root");
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const loaded = await loadCatalogModel(scene, catalog, "model.test");

    expect(loaded?.descriptor.id).toBe("model.test");
    expect(loaded?.container.getNodes().some((node) => node.name === "root")).toBe(true);
    loaded?.container.dispose();
    scene.dispose();
    engine.dispose();
  }, 30_000);

  it("returns the procedural fallback path when node validation fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const catalog = await loadCatalog("muzzle,grip");
    const engine = new NullEngine();
    const scene = new Scene(engine);

    const loaded = await loadCatalogModel(scene, catalog, "model.test");

    expect(loaded).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("model.test"), expect.any(Error));
    scene.dispose();
    engine.dispose();
  });

  it("rejects a GLB that contains no renderable mesh", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const catalog = await loadCatalog("root", false);
    const engine = new NullEngine();
    const scene = new Scene(engine);

    expect(await loadCatalogModel(scene, catalog, "model.test")).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("model.test"), expect.any(Error));
    scene.dispose();
    engine.dispose();
  });
});

async function loadCatalog(requiredNodes: string, withMesh = true): Promise<AssetCatalog> {
  const glb = createMinimalGlb(withMesh);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === "/manifest.json") {
      return Response.json({
        version: 1,
        assets: [
          { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
          { id: "fallback.model", type: "procedural-model" },
          {
            id: "model.test",
            type: "model",
            url: "/test.glb",
            fallback: "fallback.model",
            metadata: { requiredNodes },
          },
        ],
      });
    }
    if (url === "/fallback.svg") {
      return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    }
    if (url === "/test.glb") {
      return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
    }
    return new Response(null, { status: 404 });
  }));
  return AssetCatalog.load("/manifest.json");
}

function createMinimalGlb(withMesh: boolean): Uint8Array<ArrayBuffer> {
  const document: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "root" }],
  };
  if (withMesh) {
    document.buffers = [{ byteLength: 36 }];
    document.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }];
    document.accessors = [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }];
    document.meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }];
    document.nodes = [{ name: "root", mesh: 0 }];
  }
  const json = JSON.stringify(document);
  const source = new TextEncoder().encode(json);
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const binaryLength = withMesh ? 36 : 0;
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + (withMesh ? 8 + binaryLength : 0));
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const output = new Uint8Array(buffer);
  output.fill(0x20, 20);
  output.set(source, 20);
  if (withMesh) {
    const chunkOffset = 20 + jsonLength;
    view.setUint32(chunkOffset, binaryLength, true);
    view.setUint32(chunkOffset + 4, 0x004e4942, true);
    const positions = new Float32Array(buffer, chunkOffset + 8, 9);
    positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  }
  return output;
}
