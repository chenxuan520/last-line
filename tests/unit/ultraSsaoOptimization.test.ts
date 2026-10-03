import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { ssao2PixelShader } from "@babylonjs/core/Shaders/ssao2.fragment";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { describe, expect, it } from "vitest";
import { addSsaoDistanceOptimization, optimizeSsaoShader } from "../../src/client/render/UltraSsaoOptimization";

const ready = (effect: Effect): Promise<void> => new Promise((resolve) => effect.executeWhenCompiled(() => resolve()));

describe("ultra SSAO distance work", () => {
  it("isolates the far cutoff from ordinary effects through recompilation and overlapping lifetimes", async () => {
    const engine = new NullEngine();
    const defines = "#define SSAO\n#define SAMPLES 8\n#define EPSILON 0.0001";
    const create = (): PostProcess => new PostProcess("ssao", "ssao2", {
      engine, size: 0.5, defines, uniforms: ["maxZ", "base"], samplers: ["depthSampler", "randomSampler", "normalSampler"],
    });
    const ordinary = create(), first = create(), second = create();
    try {
      await ready(ordinary.getEffect()!);
      const original = ordinary.getEffect()!;
      addSsaoDistanceOptimization(first);
      addSsaoDistanceOptimization(second);
      await ready(first.getEffect()!);
      expect(first.getEffect()).not.toBe(original);
      expect(second.getEffect()).toBe(first.getEffect());
      expect(first.getEffect()!.defines).toContain("ULTRA_SSAO_DISTANCE_CUTOFF");
      expect(original.defines).not.toContain("ULTRA_SSAO_DISTANCE_CUTOFF");
      const source = first.getEffect()!._fragmentSourceCode;
      expect(source).toContain("if (depth >= maxZ)");
      expect(source.indexOf("if (depth >= maxZ)")).toBeLessThan(source.indexOf("textureLod(randomSampler"));
      expect(source).toContain("clamp(1.0 + base, 0.0, 1.0)");
      expect(source).toContain("smoothstep(maxZ*0.75,maxZ,depth)");
      first.dispose();
      second.updateEffect(`${defines}\n#define NORMAL_WORLDSPACE`);
      await ready(second.getEffect()!);
      expect(second.getEffect()!._fragmentSourceCode).toContain("if (depth >= maxZ)");
      expect(second.getEffect()!.defines).toContain("NORMAL_WORLDSPACE");
      ordinary.updateEffect(`${defines}\n#define NORMAL_WORLDSPACE`);
      await ready(ordinary.getEffect()!);
      expect(ordinary.getEffect()!._fragmentSourceCode).not.toContain("if (depth >= maxZ)");
      second.dispose();
      const after = new PostProcess("ultra-distance-ssao", "ssao2", { engine, size: 0.5, defines });
      await ready(after.getEffect()!);
      expect(after.getEffect()).toBe(original);
      after.dispose();
      expect(optimizeSsaoShader("vertex", ssao2PixelShader.shader)).toBe(ssao2PixelShader.shader);
      expect(optimizeSsaoShader("fragment", "unknown shader")).toBe("unknown shader");
    } finally {
      ordinary.dispose(); first.dispose(); second.dispose(); engine.dispose();
    }
  });
});
