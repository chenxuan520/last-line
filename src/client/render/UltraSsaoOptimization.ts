import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";

const PASS_NAME = "ultra-distance-ssao";
const DEFINE = "#define ULTRA_SSAO_DISTANCE_CUTOFF";
const registered = new WeakSet<PostProcess>();
let users = 0;

// 距离衰减已在 maxZ 处归零；远处不需要随机纹理、法线或遮蔽采样。
export function optimizeSsaoShader(shaderType: string, code: string): string {
  if (shaderType !== "fragment") return code;
  const random = "vec3 random=textureLod(randomSampler,vUV*randTextureTiles,0.0).rgb;";
  const depth = "depth=depth*depthSign;";
  if (!code.includes(random) || !code.includes(depth)) return code;
  return code.replace(random, "").replace(depth, `${depth}
if (depth >= maxZ) { gl_FragColor = vec4(vec3(clamp(1.0 + base, 0.0, 1.0)), 1.0); return; }
${random}`);
}

// 精确按专属名称注册，独立 define 隔离 Effect；后续相机／采样重编译仍使用同一处理器。
export function addSsaoDistanceOptimization(pass: PostProcess): void {
  if (pass.getEngine().isWebGPU || registered.has(pass)) return;
  const previousName = pass.name;
  pass.name = PASS_NAME;
  registered.add(pass);
  if (users++ === 0) {
    PostProcess.RegisterShaderCodeProcessing(PASS_NAME, {
      defineCustomBindings: (_name, defines) => defines?.includes(DEFINE) ? defines : `${defines ?? ""}\n${DEFINE}`,
      processCodeAfterIncludes: (_name, type, code) => optimizeSsaoShader(type, code),
    });
  }
  let active = true;
  const release = (): void => {
    if (!active) return;
    active = false;
    if (--users === 0) PostProcess.RegisterShaderCodeProcessing(PASS_NAME);
  };
  pass.onDisposeObservable.addOnce(release);
  try {
    pass.updateEffect(pass.getEffect()?.defines ?? null);
  } catch (error) {
    pass.name = previousName;
    registered.delete(pass);
    release();
    throw error;
  }
}
