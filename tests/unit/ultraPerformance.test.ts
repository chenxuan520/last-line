import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("samples new ultra explicitly and preserves strict gates once a matching baseline exists", async () => {
  const comparison = await import(pathToFileURL(resolve("scripts/compare-performance.mjs")).href);
  const runtime = Object.fromEntries([
    "startupMilliseconds", "heapUsedBytes", "meshAdds", "meshRemoves", "meshes", "materials",
    "textures", "geometries", "thinInstances", "vertices", "indices",
  ].map((key) => [key, 100]));
  const browser = Object.fromEntries([
    "entryMilliseconds", "startupFps", "startupFrameP95Milliseconds", "startupFrameP99Milliseconds",
    "startupLongFrames50", "startupLongFrames100", "stableFps", "stableFrameP95Milliseconds",
    "stableFrameP99Milliseconds", "stableLongFrames50", "stableLongFrames100", "jsHeapUsedBytes", "nodes",
  ].map((key) => [key, 100]));
  const baseline = {
    "island-high": { ...runtime }, "town-high": { ...runtime }, "mixed-high": { ...runtime },
    browser: { ...browser }, "town-ultra": { ...runtime },
    "browser-ultra": { ...browser, gpuTexturesCreated: 100, gpuTexturesDeleted: 0, gpuTexturesLive: 100 },
  };
  const mixedRounds = [{ ...runtime }, { ...runtime, textures: undefined }, { ...runtime }];
  expect(() => mixedRounds.forEach((sample) => comparison.validatePerformanceSample("round", sample, Object.keys(runtime))))
    .toThrow(/must be finite/);
  const missingMetric = { ...runtime };
  delete missingMetric.textures;
  expect(() => comparison.validatePerformanceSample("warmup", missingMetric, Object.keys(runtime))).toThrow(/metrics mismatch/);
  const head = structuredClone(baseline);
  head["town-ultra"].textures = 150;
  head["browser-ultra"].gpuTexturesLive = 150;
  expect(comparison.ultraBaselineQuality(false, true)).toBe("high");
  expect(comparison.ultraBaselineQuality(true, true)).toBe("ultra");
  expect(() => comparison.ultraBaselineQuality(true, false)).toThrow(/HEAD must support/);
  expect(() => comparison.ultraBaselineQuality(undefined, true)).toThrow(/Invalid baseline/);
  const bootstrap = comparison.compareCollectedPerformance(baseline, head, false);
  expect(bootstrap.every((row: { passed: boolean }) => row.passed)).toBe(true);
  expect(bootstrap.find((row: { section: string; metric: string }) => row.section === "town-ultra" && row.metric === "textures"))
    .toMatchObject({ referenceQuality: "high", gated: false, baseline: 100, candidate: 150 });
  const strict = comparison.compareCollectedPerformance(baseline, head, true);
  expect(strict.filter((row: { passed: boolean }) => !row.passed)).toHaveLength(2);
  head["town-high"].meshAdds = 116;
  expect(comparison.compareCollectedPerformance(baseline, head, false).some((row: { passed: boolean }) => !row.passed)).toBe(true);
  expect(() => comparison.compareCollectedPerformance(baseline, { ...head, "town-ultra": undefined }, false)).toThrow();
  head["browser-ultra"].gpuTexturesLive = Number.NaN;
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
