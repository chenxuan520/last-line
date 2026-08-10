import assert from "node:assert/strict";
import {
  comparePerformanceSection,
  PERFORMANCE_REGRESSION_THRESHOLD,
  validatePerformanceMetrics,
} from "./compare-performance.mjs";

const compare = (baseline, candidate) =>
  comparePerformanceSection("fixture", baseline, candidate);

assert.equal(PERFORMANCE_REGRESSION_THRESHOLD, 0.15);
assert.equal(compare({ startupMilliseconds: 100 }, { startupMilliseconds: 115 })[0]?.passed, true);
assert.equal(compare({ startupMilliseconds: 100 }, { startupMilliseconds: 115.01 })[0]?.passed, false);
assert.equal(compare({ stableFps: 60 }, { stableFps: 60 / 1.15 })[0]?.passed, true);
assert.equal(compare({ stableFps: 60 }, { stableFps: 60 / 1.151 })[0]?.passed, false);
assert.equal(compare({ meshAdds: 1_000 }, { meshAdds: 1_150 })[0]?.passed, true);
assert.equal(compare({ meshAdds: 1_000 }, { meshAdds: 1_151 })[0]?.passed, false);
assert.equal(compare({ gzipBytes: 100 }, { gzipBytes: 1_000 }).length, 0);
const runtime = {
  startupMilliseconds: 1,
  heapUsedBytes: 1,
  meshAdds: 1,
  meshRemoves: 1,
  meshes: 1,
  materials: 1,
  textures: 1,
  geometries: 1,
  thinInstances: 1,
  vertices: 1,
  indices: 1,
};
const browser = {
  entryMilliseconds: 1,
  startupFps: 1,
  startupFrameP95Milliseconds: 1,
  startupFrameP99Milliseconds: 1,
  startupLongFrames50: 1,
  startupLongFrames100: 1,
  stableFps: 1,
  stableFrameP95Milliseconds: 1,
  stableFrameP99Milliseconds: 1,
  stableLongFrames50: 1,
  stableLongFrames100: 1,
  jsHeapUsedBytes: 1,
  nodes: 1,
};
const complete = {
  "island-high": { mapId: "island", seed: 7, quality: "high", ...runtime },
  "town-high": { mapId: "town", seed: 7, quality: "high", ...runtime },
  "mixed-high": { mapId: "mixed", seed: 395, quality: "high", ...runtime },
  browser: { mapId: "town", seed: 7, quality: "high", ...browser },
};
validatePerformanceMetrics("fixture", complete);
assert.throws(
  () => validatePerformanceMetrics("fixture", {
    ...complete,
    browser: { ...complete.browser, stableFps: undefined },
  }),
  /metrics mismatch|must be finite/,
);
assert.throws(
  () => validatePerformanceMetrics("fixture", {
    ...complete,
    "town-high": { ...complete["town-high"], startupMilliseconds: Number.NaN },
  }),
  /must be finite/,
);

console.log("Performance comparison threshold semantics: PASS");
