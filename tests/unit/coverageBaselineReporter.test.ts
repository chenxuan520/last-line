import { describe, expect, it } from "vitest";
import { createCoverageRows } from "../../scripts/report-coverage-baseline";

const summary = (covered: number, total: number): unknown => ({
  total: {
    statements: { covered, total },
    branches: { covered, total },
    functions: { covered, total },
    lines: { covered, total },
  },
});

describe("coverage baseline reporter", () => {
  it("weights coverage using covered and total counts", () => {
    expect(
      createCoverageRows([
        { name: "small", summary: summary(1, 2) },
        { name: "large", summary: summary(8, 10) },
      ]),
    ).toEqual([
      {
        Scope: "small",
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
      {
        Scope: "large",
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      {
        Scope: "Weighted total",
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    ]);
  });

  it.each([
    ["negative", -1, 1],
    ["fractional", 1.5, 2],
    ["covered above total", 2, 1],
  ])("rejects %s coverage counts", (_name, covered, total) => {
    expect(() =>
      createCoverageRows([{ name: "invalid", summary: summary(covered, total) }]),
    ).toThrow("Invalid statements coverage for invalid");
  });

  it("rejects malformed coverage summaries", () => {
    expect(() =>
      createCoverageRows([{ name: "invalid", summary: { total: {} } }]),
    ).toThrow("Missing statements coverage for invalid");
  });
});
