import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("samples new ultra explicitly and preserves strict gates once a matching baseline exists", async () => {
  const comparison = await import(pathToFileURL(resolve("scripts/compare-performance.mjs")).href);
  const { assertUltraPresentation } = await import(pathToFileURL(resolve("scripts/performance-presentation.ts")).href);
  // 浏览器执行同一自包含函数，缺少实际增强时不得把 high 当作 ultra。
  const browserAssertion = new Function(`return (${assertUltraPresentation.toString()})`)();
  for (const assertion of [assertUltraPresentation, browserAssertion]) {
    for (const mapId of ["town", "island", "mixed"]) {
      expect(() => assertion(mapId, "ultra", [])).toThrow(`Ultra ${mapId} presentation was not constructed`);
      expect(() => assertion(mapId, "ultra", ["ultra-town-static-shadows", "ultra-road-surface-mask"])).not.toThrow();
      expect(() => assertion(mapId, "ultra", ["ultra-town-static-shadows"])).toThrow();
      expect(() => assertion(mapId, "high", [])).not.toThrow();
    }
  }
  const runtime = Object.fromEntries([
    "startupMilliseconds", "heapUsedBytes", "meshAdds", "meshRemoves", "meshes", "materials",
    "textures", "geometries", "thinInstances", "vertices", "indices",
  ].map((key) => [key, 100]));
  const browser = Object.fromEntries([
    "entryMilliseconds", "startupFps", "startupFrameP95Milliseconds", "startupFrameP99Milliseconds",
    "startupLongFrames50", "startupLongFrames100", "stableFps", "stableFrameP95Milliseconds",
    "stableFrameP99Milliseconds", "stableLongFrames50", "stableLongFrames100", "jsHeapUsedBytes", "nodes",
  ].map((key) => [key, 100]));
  const baseline: Record<string, Record<string, number>> = {
    "island-high": { ...runtime }, "town-high": { ...runtime }, "mixed-high": { ...runtime },
    browser: { ...browser }, "town-ultra": { ...runtime },
    "browser-ultra": { ...browser, gpuTexturesCreated: 100, gpuTexturesDeleted: 0, gpuTexturesLive: 100,
      sceneMeshes: 100, sceneMaterials: 100, sceneGeometries: 100, sceneVertices: 100, sceneIndices: 100 },
  };
  for (const mapId of ["island", "mixed"]) {
    baseline[`${mapId}-ultra`] = { ...runtime };
    baseline[`browser-${mapId}-ultra`] = { ...baseline["browser-ultra"] };
  }
  for (const section of ["browser-ultra", "browser-island-ultra", "browser-mixed-ultra"]) {
    const cleaned = structuredClone(baseline);
    cleaned[section]!.gpuTexturesDeleted = 1;
    for (const [before, after] of [[baseline, cleaned], [cleaned, baseline]]) {
      expect(comparison.compareCollectedPerformance(before, after, true)
        .find((row: { section: string; metric: string }) => row.section === section && row.metric === "gpuTexturesDeleted"))
        .toMatchObject({ gated: false, passed: true });
    }
    for (const metric of ["gpuTexturesCreated", "gpuTexturesLive"]) {
      const increased = structuredClone(cleaned);
      increased[section]![metric] = 116;
      expect(comparison.compareCollectedPerformance(baseline, increased, true)
        .find((row: { section: string; metric: string }) => row.section === section && row.metric === metric))
        .toMatchObject({ gated: true, passed: false });
    }
    delete cleaned[section]!.gpuTexturesDeleted;
    expect(() => comparison.compareCollectedPerformance(baseline, cleaned, true)).toThrow(/metrics mismatch/);
    cleaned[section]!.gpuTexturesDeleted = Number.NaN;
    expect(() => comparison.compareCollectedPerformance(baseline, cleaned, true)).toThrow(/must be finite/);
  }
  for (const section of ["island-ultra", "mixed-ultra", "browser-island-ultra", "browser-mixed-ultra"]) {
    const missing = structuredClone(baseline);
    delete missing[section];
    expect(() => comparison.compareCollectedPerformance(baseline, missing, false)).toThrow(/sections mismatch/);
    const metric = section.startsWith("browser") ? "sceneVertices" : "vertices";
    const invalid = structuredClone(baseline);
    delete invalid[section]![metric];
    expect(() => comparison.compareCollectedPerformance(baseline, invalid, false)).toThrow(/metrics mismatch/);
    invalid[section]![metric] = Number.NaN;
    expect(() => comparison.compareCollectedPerformance(baseline, invalid, false)).toThrow(/must be finite/);
    invalid[section]![metric] = 116;
    expect(comparison.compareCollectedPerformance(baseline, invalid, false)
      .find((row: { section: string; metric: string }) => row.section === section && row.metric === metric))
      .toMatchObject({ referenceQuality: "high", gated: false, passed: true });
    expect(comparison.compareCollectedPerformance(baseline, invalid, true)
      .find((row: { section: string; metric: string }) => row.section === section && row.metric === metric))
      .toMatchObject({ gated: true, passed: false });
  }
  const mixedRounds = [{ ...runtime }, { ...runtime, textures: undefined }, { ...runtime }];
  expect(() => mixedRounds.forEach((sample) => comparison.validatePerformanceSample("round", sample, Object.keys(runtime))))
    .toThrow(/must be finite/);
  const missingMetric = { ...runtime };
  delete missingMetric.textures;
  expect(() => comparison.validatePerformanceSample("warmup", missingMetric, Object.keys(runtime))).toThrow(/metrics mismatch/);
  const head = structuredClone(baseline);
  head["town-ultra"]!.textures = 150;
  head["browser-ultra"]!.gpuTexturesLive = 150;
  head["browser-ultra"]!.sceneVertices = 150;
  expect(comparison.ultraBaselineQuality(false, true)).toBe("high");
  expect(comparison.ultraBaselineQuality(true, true)).toBe("ultra");
  expect(() => comparison.ultraBaselineQuality(true, false)).toThrow(/HEAD must support/);
  expect(() => comparison.ultraBaselineQuality(undefined, true)).toThrow(/Invalid baseline/);
  const bootstrap = comparison.compareCollectedPerformance(baseline, head, false);
  expect(bootstrap.every((row: { passed: boolean }) => row.passed)).toBe(true);
  expect(bootstrap.find((row: { section: string; metric: string }) => row.section === "town-ultra" && row.metric === "textures"))
    .toMatchObject({ referenceQuality: "high", gated: false, baseline: 100, candidate: 150 });
  const strict = comparison.compareCollectedPerformance(baseline, head, true);
  expect(strict.filter((row: { passed: boolean }) => !row.passed)).toHaveLength(3);
  const missingScene = structuredClone(head);
  Reflect.deleteProperty(missingScene["browser-ultra"]!, "sceneVertices");
  expect(() => comparison.compareCollectedPerformance(baseline, missingScene, false)).toThrow(/metrics mismatch/);
  head["town-high"]!.meshAdds = 116;
  expect(comparison.compareCollectedPerformance(baseline, head, false).some((row: { passed: boolean }) => !row.passed)).toBe(true);
  expect(() => comparison.compareCollectedPerformance(baseline, { ...head, "town-ultra": undefined }, false)).toThrow();
  head["browser-ultra"]!.gpuTexturesLive = Number.NaN;
  expect(() => comparison.compareCollectedPerformance(baseline, head, false)).toThrow(/must be finite/);
  const markdown = comparison.markdownReport({ threshold: 0.15, comparisons: bootstrap, ultraBaselineQuality: "high", passed: true });
  expect(markdown).toContain("town-ultra (main high reference)");
  expect(markdown).toContain("INFO");
  expect(markdown).toContain("Once main supports ultra");
  const probe = execFileSync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs", "scripts/capture-runtime-performance.ts",
    "--repository", process.cwd(), "--map", "town", "--seed", "7", "--quality", "ultra", "--probe-quality", "true",
  ], { encoding: "utf8" });
  expect(JSON.parse(probe)).toEqual({ supported: true });
});
