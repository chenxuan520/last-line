import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface Arguments {
  repository: string;
  mapId: "island" | "town" | "mixed";
  seed: number;
  quality: "low" | "medium" | "high";
}

function parseArguments(): Arguments {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${name ?? ""}`);
    values.set(name.slice(2), value);
  }
  const repository = values.get("repository");
  const mapId = values.get("map") as Arguments["mapId"] | undefined;
  const quality = values.get("quality") as Arguments["quality"] | undefined;
  const seed = Number(values.get("seed"));
  if (!repository || !mapId || !["island", "town", "mixed"].includes(mapId)) {
    throw new Error("Expected --repository and --map island|town|mixed");
  }
  if (!quality || !["low", "medium", "high"].includes(quality)) {
    throw new Error("Expected --quality low|medium|high");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error("Expected --seed uint32");
  }
  return { repository, mapId, seed, quality };
}

function deterministicRandom(seed: number): () => number {
  let first = true;
  let value = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    if (first) {
      first = false;
      return seed / 4_294_967_296;
    }
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

async function main(): Promise<void> {
  const { repository, mapId, seed, quality } = parseArguments();
  const moduleUrl = (relativePath: string): string =>
    pathToFileURL(`${repository}/${relativePath}`).href;
  const [
    { NullEngine },
    { Scene },
    { AssetCatalog },
    { createIslandScene },
    { createBattleRoyaleState },
    { createMapLayout },
  ] = await Promise.all([
    import(moduleUrl("node_modules/@babylonjs/core/Engines/nullEngine.js")),
    import(moduleUrl("node_modules/@babylonjs/core/scene.js")),
    import(moduleUrl("src/assets/AssetCatalog.ts")),
    import(moduleUrl("src/client/render/scenes/IslandScene.ts")),
    import(moduleUrl("src/game/modes/BattleRoyaleMode.ts")),
    import(moduleUrl("src/config/map.ts")),
  ]);
  const manifest = JSON.parse(
    await readFile(`${repository}/public/assets/asset-manifest.json`, "utf8"),
  ) as { version: number; assets: Array<Record<string, unknown>> };
  const assets = new AssetCatalog({
    version: manifest.version,
    assets: manifest.assets.map((entry) =>
      entry.type === "model"
        ? { ...entry, type: "procedural-model", url: undefined }
        : entry
    ),
  });

  global.gc?.();
  const random = deterministicRandom(seed);
  const stateStarted = performance.now();
  const state = createBattleRoyaleState("player", undefined, random, { mapId });
  const stateMilliseconds = performance.now() - stateStarted;
  createMapLayout(mapId, state.mapSeed);

  let meshAdds = 0;
  let meshRemoves = 0;
  const originalAddMesh = Scene.prototype.addMesh;
  const originalRemoveMesh = Scene.prototype.removeMesh;
  Scene.prototype.addMesh = function (...args: Parameters<typeof originalAddMesh>): void {
    meshAdds += 1;
    return originalAddMesh.apply(this, args);
  };
  Scene.prototype.removeMesh = function (...args: Parameters<typeof originalRemoveMesh>): number {
    meshRemoves += 1;
    return originalRemoveMesh.apply(this, args);
  };

  const engine = new NullEngine({
    renderWidth: 1280,
    renderHeight: 720,
    deterministicLockstep: true,
    lockstepMaxSteps: 4,
  });
  try {
    const sceneStarted = performance.now();
    const bundle = await createIslandScene(
      engine,
      assets,
      state.actors,
      state.groundLoot,
      state.mapSeed,
      true,
      "player",
      quality,
      mapId,
    );
    const sceneMilliseconds = performance.now() - sceneStarted;
    global.gc?.();
    const heapUsedBytes = process.memoryUsage().heapUsed;
    const meshes = bundle.scene.meshes;
    console.log(JSON.stringify({
      mapId,
      seed: state.mapSeed,
      quality,
      startupMilliseconds: stateMilliseconds + sceneMilliseconds,
      heapUsedBytes,
      meshAdds,
      meshRemoves,
      meshes: meshes.length,
      materials: bundle.scene.materials.length,
      textures: bundle.scene.textures.length,
      geometries: bundle.scene.geometries.length,
      thinInstances: meshes.reduce(
        (total: number, mesh: { thinInstanceCount?: number }) =>
          total + Math.max(0, Number(mesh.thinInstanceCount ?? 0)),
        0,
      ),
      vertices: meshes.reduce((total: number, mesh: { getTotalVertices(): number }) =>
        total + mesh.getTotalVertices(), 0),
      indices: meshes.reduce((total: number, mesh: { getTotalIndices(): number }) =>
        total + mesh.getTotalIndices(), 0),
    }));
    bundle.scene.dispose();
  } finally {
    Scene.prototype.addMesh = originalAddMesh;
    Scene.prototype.removeMesh = originalRemoveMesh;
    engine.dispose();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
