import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const metricNames = [
  "statements",
  "branches",
  "functions",
  "lines",
] as const;

type MetricName = (typeof metricNames)[number];

interface CoverageSuite {
  readonly name: string;
  readonly summary: unknown;
}

export interface CoverageRow {
  readonly Scope: string;
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const percentage = (covered: number, total: number): number =>
  total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;

const readMetric = (
  suiteName: string,
  summary: unknown,
  metricName: MetricName,
): { covered: number; total: number } => {
  if (!isRecord(summary) || !isRecord(summary.total)) {
    throw new Error(`Invalid coverage summary for ${suiteName}`);
  }
  const metric = summary.total[metricName];
  if (!isRecord(metric)) {
    throw new Error(`Missing ${metricName} coverage for ${suiteName}`);
  }
  const { covered, total } = metric;
  if (
    typeof covered !== "number" ||
    typeof total !== "number" ||
    !Number.isInteger(covered) ||
    !Number.isInteger(total) ||
    covered < 0 ||
    total < 0 ||
    covered > total
  ) {
    throw new Error(`Invalid ${metricName} coverage for ${suiteName}`);
  }
  return { covered, total };
};

export const createCoverageRows = (
  suites: readonly CoverageSuite[],
): CoverageRow[] => {
  const totals = Object.fromEntries(
    metricNames.map((metricName) => [
      metricName,
      { covered: 0, total: 0 },
    ]),
  ) as Record<MetricName, { covered: number; total: number }>;

  const rows = suites.map((suite): CoverageRow => {
    const metrics = Object.fromEntries(
      metricNames.map((metricName) => {
        const metric = readMetric(suite.name, suite.summary, metricName);
        totals[metricName].covered += metric.covered;
        totals[metricName].total += metric.total;
        return [metricName, percentage(metric.covered, metric.total)];
      }),
    ) as Record<MetricName, number>;
    return { Scope: suite.name, ...metrics };
  });

  rows.push({
    Scope: "Weighted total",
    ...Object.fromEntries(
      metricNames.map((metricName) => [
        metricName,
        percentage(totals[metricName].covered, totals[metricName].total),
      ]),
    ),
  } as CoverageRow);
  return rows;
};

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const reportFiles = [
  {
    name: "Application (src)",
    path: join(
      rootDirectory,
      "node_modules/.cache/coverage/unit/coverage-summary.json",
    ),
  },
  {
    name: "Cloudflare Worker",
    path: join(
      rootDirectory,
      "node_modules/.cache/coverage/worker/coverage-summary.json",
    ),
  },
  {
    name: "Standalone server",
    path: join(
      rootDirectory,
      "node_modules/.cache/coverage/standalone/coverage-summary.json",
    ),
  },
] as const;

const run = (): void => {
  const rows = createCoverageRows(
    reportFiles.map((report) => ({
      name: report.name,
      summary: JSON.parse(readFileSync(report.path, "utf8")) as unknown,
    })),
  );
  console.log("\nCoverage baseline (%):");
  console.table(rows);
};

const entryPath = process.argv[1];
if (
  entryPath &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  run();
}
