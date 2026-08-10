import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
export const PERFORMANCE_REGRESSION_THRESHOLD = 0.15;
const projectRoot = path.resolve(import.meta.dirname, "..");

function parseArguments() {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${name ?? ""}`);
    values.set(name.slice(2), value);
  }
  const baseline = values.get("baseline");
  const candidate = values.get("candidate") ?? projectRoot;
  const output = values.get("output") ?? path.join(projectRoot, "performance-report.json");
  const rounds = Number(values.get("rounds") ?? "3");
  const mode = values.get("mode") ?? "compare";
  if (mode !== "compare" && mode !== "baseline") throw new Error("Expected --mode compare|baseline");
  if (mode === "compare" && !baseline) throw new Error("Expected --baseline <repository>");
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error("Expected --rounds positive integer");
  return {
    mode,
    baseline: baseline ? path.resolve(baseline) : null,
    candidate: path.resolve(candidate),
    output: path.resolve(output),
    rounds,
  };
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

function lastJsonLine(output) {
  const line = output.trim().split(/\r?\n/).reverse().find((entry) => entry.startsWith("{"));
  if (!line) throw new Error(`JSON metric output missing:\n${output}`);
  return JSON.parse(line);
}

async function captureRuntime(repository, mapId, seed, quality) {
  return lastJsonLine(await run(
    process.execPath,
    [
      "--expose-gc",
      path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"),
      path.join(projectRoot, "scripts/capture-runtime-performance.ts"),
      "--repository", repository,
      "--map", mapId,
      "--seed", String(seed),
      "--quality", quality,
    ],
    { cwd: projectRoot },
  ));
}

async function captureBrowser(repository, mapId, seed, quality) {
  return lastJsonLine(await run(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"),
      path.join(projectRoot, "scripts/capture-browser-performance.ts"),
      "--repository", repository,
      "--map", mapId,
      "--seed", String(seed),
      "--quality", quality,
    ],
    { cwd: projectRoot },
  ));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function aggregate(samples) {
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample)));
  const result = {};
  for (const key of keys) {
    const values = samples.map((sample) => sample[key]).filter((value) => typeof value === "number");
    if (values.length > 0) result[key] = median(values);
  }
  return result;
}

const lowerIsBetter = new Set([
  "startupMilliseconds",
  "heapUsedBytes",
  "meshAdds",
  "meshRemoves",
  "meshes",
  "materials",
  "textures",
  "geometries",
  "thinInstances",
  "vertices",
  "indices",
  "entryMilliseconds",
  "startupFrameP95Milliseconds",
  "startupFrameP99Milliseconds",
  "startupLongFrames50",
  "startupLongFrames100",
  "stableFrameP95Milliseconds",
  "stableFrameP99Milliseconds",
  "stableLongFrames50",
  "stableLongFrames100",
  "jsHeapUsedBytes",
  "nodes",
]);
const higherIsBetter = new Set(["startupFps", "stableFps"]);
const informational = new Set([
  "mapId",
  "seed",
  "quality",
]);
const runtimeMetrics = [
  "startupMilliseconds",
  "heapUsedBytes",
  "meshAdds",
  "meshRemoves",
  "meshes",
  "materials",
  "textures",
  "geometries",
  "thinInstances",
  "vertices",
  "indices",
];
const browserMetrics = [
  "entryMilliseconds",
  "startupFps",
  "startupFrameP95Milliseconds",
  "startupFrameP99Milliseconds",
  "startupLongFrames50",
  "startupLongFrames100",
  "stableFps",
  "stableFrameP95Milliseconds",
  "stableFrameP99Milliseconds",
  "stableLongFrames50",
  "stableLongFrames100",
  "jsHeapUsedBytes",
  "nodes",
];
const requiredSections = {
  "island-high": runtimeMetrics,
  "town-high": runtimeMetrics,
  "mixed-high": runtimeMetrics,
  browser: browserMetrics,
};

export function validatePerformanceMetrics(label, sections) {
  const sectionNames = Object.keys(sections).sort();
  const expectedSections = Object.keys(requiredSections).sort();
  if (JSON.stringify(sectionNames) !== JSON.stringify(expectedSections)) {
    throw new Error(
      `${label} performance sections mismatch: expected ${expectedSections.join(", ")}, got ${sectionNames.join(", ")}`,
    );
  }
  for (const [section, requiredMetrics] of Object.entries(requiredSections)) {
    const metrics = sections[section];
    if (!metrics || typeof metrics !== "object") {
      throw new Error(`${label} performance section missing: ${section}`);
    }
    const actualMetrics = Object.keys(metrics)
      .filter((metric) => !informational.has(metric))
      .sort();
    const expectedMetrics = [...requiredMetrics].sort();
    if (JSON.stringify(actualMetrics) !== JSON.stringify(expectedMetrics)) {
      throw new Error(
        `${label} ${section} metrics mismatch: expected ${expectedMetrics.join(", ")}, got ${actualMetrics.join(", ")}`,
      );
    }
    for (const metric of requiredMetrics) {
      const value = metrics[metric];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${label} ${section}.${metric} must be finite`);
      }
    }
  }
}

export function comparePerformanceSection(
  section,
  baseline,
  candidate,
  threshold = PERFORMANCE_REGRESSION_THRESHOLD,
) {
  const comparisons = [];
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(candidate)])) {
    if (informational.has(key)) continue;
    const base = baseline[key];
    const head = candidate[key];
    if (typeof base !== "number" || typeof head !== "number") continue;
    let degradation = 0;
    if (lowerIsBetter.has(key)) degradation = base === 0 ? (head === 0 ? 0 : Number.POSITIVE_INFINITY) : head / base - 1;
    else if (higherIsBetter.has(key)) degradation = head === 0 ? Number.POSITIVE_INFINITY : base / head - 1;
    else continue;
    comparisons.push({
      section,
      metric: key,
      baseline: base,
      candidate: head,
      degradation,
      passed: degradation <= threshold,
    });
  }
  return comparisons;
}

function markdownReport(report) {
  const lines = [
    "# Runtime Performance Comparison",
    "",
    `Threshold: ${(report.threshold * 100).toFixed(0)}%`,
    "",
    "| Section | Metric | main | head | Degradation | Result |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.comparisons) {
    const degradation = Number.isFinite(row.degradation)
      ? `${(row.degradation * 100).toFixed(2)}%`
      : "infinite";
    lines.push(
      `| ${row.section} | ${row.metric} | ${row.baseline.toFixed(2)} | ${row.candidate.toFixed(2)} | ${degradation} | ${row.passed ? "PASS" : "FAIL"} |`,
    );
  }
  lines.push("", report.passed ? "**PASS**" : "**FAIL**");
  return `${lines.join("\n")}\n`;
}

async function captureRepository(repository, rounds) {
  const scenarios = [
    { mapId: "island", seed: 7, quality: "high" },
    { mapId: "town", seed: 7, quality: "high" },
    { mapId: "mixed", seed: 395, quality: "high" },
  ];
  for (const scenario of scenarios) {
    await captureRuntime(repository, scenario.mapId, scenario.seed, scenario.quality);
  }
  await captureBrowser(repository, "town", 7, "high");
  const samples = Object.fromEntries(scenarios.map((scenario) => [
    `${scenario.mapId}-${scenario.quality}`,
    [],
  ]));
  samples.browser = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const scenario of scenarios) {
      samples[`${scenario.mapId}-${scenario.quality}`].push(await captureRuntime(
        repository,
        scenario.mapId,
        scenario.seed,
        scenario.quality,
      ));
    }
    samples.browser.push(await captureBrowser(repository, "town", 7, "high"));
  }
  return Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, aggregate(values)]));
}

async function main() {
  const args = parseArguments();
  if (args.mode === "baseline") {
    const metrics = await captureRepository(args.candidate, args.rounds);
    validatePerformanceMetrics("main", metrics);
    const report = {
      mode: "baseline",
      rounds: args.rounds,
      metrics,
      passed: true,
    };
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`);
    const markdownPath = args.output.replace(/\.json$/i, ".md");
    const markdown = [
      "# Runtime Performance Baseline",
      "",
      `Rounds: ${args.rounds}`,
      "",
      "```json",
      JSON.stringify(metrics, null, 2),
      "```",
      "",
      "**PASS**",
      "",
    ].join("\n");
    await writeFile(markdownPath, markdown);
    console.log(markdown);
    return;
  }
  const scenarios = [
    { mapId: "island", seed: 7, quality: "high" },
    { mapId: "town", seed: 7, quality: "high" },
    { mapId: "mixed", seed: 395, quality: "high" },
  ];
  const samples = { baseline: {}, candidate: {} };
  for (const scenario of scenarios) {
    const key = `${scenario.mapId}-${scenario.quality}`;
    samples.baseline[key] = [];
    samples.candidate[key] = [];
  }
  samples.baseline.browser = [];
  samples.candidate.browser = [];

  for (const [label, repository] of [[
    "baseline",
    args.baseline,
  ], [
    "candidate",
    args.candidate,
  ]]) {
    for (const scenario of scenarios) {
      await captureRuntime(repository, scenario.mapId, scenario.seed, scenario.quality);
    }
    await captureBrowser(repository, "town", 7, "high");
    console.log(`Performance warm-up complete: ${label}`);
  }

  for (let round = 0; round < args.rounds; round += 1) {
    const order = round % 2 === 0
      ? [["baseline", args.baseline], ["candidate", args.candidate]]
      : [["candidate", args.candidate], ["baseline", args.baseline]];
    for (const [label, repository] of order) {
      for (const scenario of scenarios) {
        const key = `${scenario.mapId}-${scenario.quality}`;
        samples[label][key].push(await captureRuntime(
          repository,
          scenario.mapId,
          scenario.seed,
          scenario.quality,
        ));
      }
      samples[label].browser.push(await captureBrowser(repository, "town", 7, "high"));
    }
  }

  const baseline = {};
  const candidate = {};
  for (const key of Object.keys(samples.baseline)) {
    baseline[key] = aggregate(samples.baseline[key]);
    candidate[key] = aggregate(samples.candidate[key]);
  }
  validatePerformanceMetrics("main", baseline);
  validatePerformanceMetrics("head", candidate);
  const comparisons = Object.keys(baseline).flatMap((key) =>
    comparePerformanceSection(key, baseline[key], candidate[key])
  );
  const report = {
    threshold: PERFORMANCE_REGRESSION_THRESHOLD,
    rounds: args.rounds,
    baseline,
    candidate,
    comparisons,
    passed: comparisons.every((comparison) => comparison.passed),
  };
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = args.output.replace(/\.json$/i, ".md");
  await writeFile(markdownPath, markdownReport(report));
  console.log(markdownReport(report));
  if (!report.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
